"""Authenticated human-operated browser. Never solves a challenge or reapplies."""
import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import secrets
import signal
import time
from urllib.parse import urlsplit
from aiohttp import web
from playwright.async_api import async_playwright
from worker import Worker, browser_env, GREETING
from eva_surface import EvaSurface

ROOT=Path(__file__).parent
PRIVATE=Path('/tmp/lukas-operator-private')
PRIVACY='Ich habe die Datenschutzhinweise gelesen und bin mit der Verarbeitung meiner Angaben für das Voice Interview einverstanden.'
RECORDING='Ich bin damit einverstanden, dass das Gespräch aufgezeichnet und zur Auswertung meiner Bewerbung genutzt wird. Diese Einwilligung kann ich jederzeit per E-Mail an info@everlastconsulting.de widerrufen.'

class Operator:
    def __init__(self,password):
        if len(password)<24:raise ValueError('DEMO_OPERATOR_PASSWORD needs at least 24 characters')
        self.password=password;self.page=None;self.browser=None;self.worker=None
        self.worker_task=None;self.armed=False;self.used=False;self.closed=False
        self.created=time.monotonic();self.failure=None;self.failed_logins={}
        self.greeted=False;self.interview='nicht gestartet';self.lock=asyncio.Lock()
        self.prepared=False;self.prepare_attempts=0

    @web.middleware
    async def secure(self,request,handler):
        if request.path=='/healthz':return web.Response(text='ok')
        peer=request.remote or '?';now=time.monotonic()
        attempts=[x for x in self.failed_logins.get(peer,[]) if now-x<60]
        if len(attempts)>=15:return web.Response(status=429,text='Bitte eine Minute warten.')
        try:
            scheme,token=request.headers.get('Authorization','').split(' ',1)
            credentials=base64.b64decode(token,validate=True).decode()
            good=scheme.lower()=='basic' and secrets.compare_digest(credentials,'issa:'+self.password)
        except Exception:good=False
        if not good:
            self.failed_logins[peer]=attempts+[now]
            return web.Response(status=401,headers={'WWW-Authenticate':'Basic realm="LUKAS Demo", charset="UTF-8"'})
        if request.method=='POST':
            origin=request.headers.get('Origin','')
            if urlsplit(origin).netloc!=request.host or request.content_type!='application/json':
                return web.Response(status=403,text='Origin rejected')
        try:response=await handler(request)
        except web.HTTPException:raise
        except Exception as exc:
            self.failure=type(exc).__name__
            response=web.json_response({'error':'Bedienung angehalten. Status prüfen.'},status=409)
        response.headers.update({'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
            'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
            'Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"})
        return response

    async def guard(self,route):
        req=route.request;u=urlsplit(req.url)
        if u.hostname=='career.corporatellm.de' and req.method not in ('GET','HEAD','OPTIONS'):
            allowed={'/api/voice-interview/status','/api/voice-interview/rollout','/api/voice-interview/widget-event'}
            if u.path=='/api/voice-interview/widget-session':
                if not self.armed or self.used or not self.worker or self.worker.stop.is_set():
                    await route.abort();return
                # Exactly one real attempt. Never automatically retry this POST.
                self.used=True;self.interview='Start angefordert; Verbindung unbestätigt'
            elif u.path not in allowed:
                await route.abort();return  # Includes application submissions and phone-call path.
        await route.continue_()

    async def open(self):
        PRIVATE.mkdir(mode=0o700,exist_ok=True);PRIVATE.chmod(0o700)
        context=os.environ.pop('DEMO_CONTEXT_JSON')
        cp=PRIVATE/'context.json';cp.write_text(context);cp.chmod(0o600)
        self.context_path=cp
        self.pw=await async_playwright().start()
        proxy=os.environ.get('HTTPS_PROXY')
        self.browser=await self.pw.chromium.launch(executable_path='/usr/bin/chromium',
            headless=not bool(os.environ.get('DISPLAY')),env=browser_env(),
            proxy={'server':proxy} if proxy else None,ignore_default_args=['--mute-audio'],
            args=['--autoplay-policy=no-user-gesture-required','--disable-dev-shm-usage'])
        ctx=await self.browser.new_context(viewport={'width':1100,'height':900},permissions=['microphone'])
        await ctx.route('https://career.corporatellm.de/**',self.guard)
        self.page=await ctx.new_page();self.surface=EvaSurface(self.page)
        self.identity=json.loads(os.environ.pop('DEMO_APPLICANT_JSON'))
        self.consent=json.loads(os.environ.pop('DEMO_CONSENT_JSON'))
        try:await self.prepare()
        except Exception as exc:self.failure=type(exc).__name__
        self.monitor_task=asyncio.create_task(self.monitor())

    async def prepare(self):
        if self.used or self.worker or self.prepare_attempts>=3:raise ValueError('Preparation limit reached')
        self.prepare_attempts+=1
        await self.surface.inspect()
        identity=self.identity;consent=self.consent
        if consent.get('recording_allowed') is not True or consent.get('processing_allowed') is not True:
            raise ValueError('Explicit consent missing')
        for placeholder,key in [('Max','first_name'),('Mustermann','last_name'),('max@beispiel.de','email')]:
            field=self.page.get_by_placeholder(placeholder,exact=True)
            if await field.count()==1:await field.fill(identity[key])
        # Exact, previously reviewed labels; the user explicitly approved this one demo.
        for label in (PRIVACY,RECORDING):
            await self.page.get_by_role('checkbox',name=label,exact=True).check()
        (PRIVATE/'consent.json').write_text(json.dumps(consent));(PRIVATE/'consent.json').chmod(0o600)
        self.prepared=True;self.failure=None

    async def monitor(self):
        while not self.closed:
            if self.worker and self.worker.stop.is_set():
                self.armed=False
                if self.used:self.interview='abgebrochen'
            if self.used and self.page and not self.page.is_closed():
                # Read only visible UI. No interview transcript or recording is saved.
                listening=self.page.get_by_text('Ich höre zu',exact=True)
                speaking=self.page.get_by_text('Eva antwortet',exact=True)
                if not self.greeted and (await listening.count() or await speaking.count()):
                    self.interview='gestartet'
                    if self.worker:self.worker.status['interview']='gestartet'
                    if await listening.count() and self.worker and not self.worker.stop.is_set():
                        await self.worker.send({'type':'session.commentary.append','delegation_id':None,'content':GREETING})
                        self.greeted=True
            await asyncio.sleep(.5)

    async def status(self,request):
        ready=await self.surface.readiness() if self.page and not self.page.is_closed() else {}
        return web.json_response({'browser_open':bool(self.page and not self.page.is_closed()),
            'prepared':self.prepared,'checks':ready,'lukas':self.worker.status if self.worker else {'state':'nicht verbunden'},
            'interview':self.interview,'attempt_used':self.used,'armed':self.armed,
            'consent_recorded':True,'error_type':self.failure,
            'expires_in_seconds':max(0,3600-int(time.monotonic()-self.created))})

    async def screen(self,request):
        if not self.page or self.page.is_closed():raise web.HTTPGone()
        return web.Response(body=await self.page.screenshot(type='jpeg',quality=70),content_type='image/jpeg')

    async def action(self,request):
        data=await request.json();action=request.match_info['action']
        if action=='stop':
            self.armed=False;self.closed=True
            if self.worker:self.worker.halt('operator_stop')
            elif self.browser:await self.browser.close()
            if self.interview!='nicht gestartet':self.interview='abgebrochen'
            return web.json_response({'ok':True})
        async with self.lock:
            if action=='prepare':
                await self.prepare()
            elif action=='connect':
                if not self.prepared:raise web.HTTPConflict(text='Zuerst Interviewfenster vorbereiten.')
                if self.worker or self.closed:raise web.HTTPConflict(text='Sitzung bereits verwendet')
                ready=await self.surface.readiness()
                if not ready['security_check_complete'] or ready['identity_fields_empty']:
                    raise web.HTTPConflict(text='Zuerst die reguläre Sicherheitsprüfung abschließen.')
                args=argparse.Namespace(context=str(self.context_path),private_dir=str(PRIVATE),port=8765,max_seconds=660)
                self.worker=Worker(args,prepared_page=self.page)
                self.worker_task=asyncio.create_task(self.worker.run())
                for _ in range(400):
                    if self.worker.status['state']=='ready' or self.worker_task.done():break
                    await asyncio.sleep(.05)
                if self.closed or self.worker.stop.is_set() or self.worker.status['state']!='ready':raise web.HTTPConflict(text='Sprachverbindung nicht bereit.')
                self.armed=True
            elif action=='click':
                x=float(data['x']);y=float(data['y'])
                if not 0<=x<=1100 or not 0<=y<=900:raise web.HTTPBadRequest()
                await self.page.mouse.click(x,y)
            elif action=='scroll':await self.page.mouse.wheel(0,max(-700,min(700,int(data['y']))))
            elif action=='key':
                if data.get('key') not in ('Tab','Enter','Escape','Backspace'):raise web.HTTPBadRequest()
                await self.page.keyboard.press(data['key'])
            elif action=='tone':
                if self.used:raise web.HTTPConflict(text='Kein Testsignal während des Interviews.')
                # Only the regular preflight microphone hears the tone. No audio file.
                import numpy as np
                from audio import Audio
                audio=Audio();await audio.new_player()
                try:
                    pcm=(np.sin(2*np.pi*440*np.arange(24000*4)/24000)*5000).astype('<i2').tobytes()
                    for i in range(0,len(pcm),960):await audio.write(pcm[i:i+960]);await asyncio.sleep(.02)
                    await asyncio.sleep(.2)
                finally:await audio.close()
            else:raise web.HTTPNotFound()
        return web.json_response({'ok':True})

    async def close(self):
        self.closed=True;self.armed=False
        if self.worker:self.worker.halt('operator_shutdown')
        if self.worker_task:await self.worker_task
        if hasattr(self,'monitor_task'):
            self.monitor_task.cancel();await asyncio.gather(self.monitor_task,return_exceptions=True)
        if self.browser:await self.browser.close()
        if hasattr(self,'pw'):await self.pw.stop()

    def app(self):
        app=web.Application(middlewares=[self.secure],client_max_size=8192)
        async def index(request):return web.FileResponse(ROOT/'operator.html')
        async def js(request):return web.Response(text=ROOT.joinpath('operator-client.txt').read_text(),content_type='application/javascript')
        app.router.add_get('/',index);app.router.add_get('/client.js',js)
        app.router.add_get('/healthz',index);app.router.add_get('/status',self.status)
        app.router.add_get('/screen',self.screen);app.router.add_post('/action/{action}',self.action)
        return app

async def main():
    operator=Operator(os.environ.pop('DEMO_OPERATOR_PASSWORD',''))
    runner=web.AppRunner(operator.app(),access_log=None);await runner.setup()
    await web.TCPSite(runner,'0.0.0.0',int(os.environ.get('PORT','8080'))).start()
    stop=asyncio.Event()
    for sig in (signal.SIGINT,signal.SIGTERM):asyncio.get_running_loop().add_signal_handler(sig,stop.set)
    try:
        await operator.open()
        print('OPERATOR_READY: authenticated browser available; interview not started',flush=True)
        try:await asyncio.wait_for(stop.wait(),3600)
        except asyncio.TimeoutError:pass
    except Exception as exc:
        print('OPERATOR_START_FAILED '+type(exc).__name__,flush=True)
        raise SystemExit(1)
    finally:await operator.close();await runner.cleanup()

if __name__=='__main__':asyncio.run(main())
