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
from conversation_recording import ConversationRecording
import io
import zipfile
import uuid
from datetime import datetime, timezone
from network_diagnostics import Diagnostics
from storage_paths import archive_mounted
from transcribe_recording import safe_transcribe, private_json

ROOT=Path(__file__).parent
PRIVATE=Path('/tmp/lukas-operator-private')
ARCHIVE=Path(os.getenv('DEMO_ARCHIVE_DIR','/data/conversations'))
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
        self.recording=None;self.transcription_task=None;self.test_task=None
        self.diagnostics=None;self.archive_ready=False;self.test_actions=set()
        self.pc_ticket=None;self.pc_ticket_until=0;self.pc_session=None;self.pc_task=None;self.pc_uses=0
        self.pc_connector=None;self.pc_transcribe=safe_transcribe

    def pc_ticket_valid(self,request):
        ticket=request.cookies.get('pc_voice','')
        return bool(self.pc_ticket and time.monotonic()<self.pc_ticket_until and secrets.compare_digest(ticket,self.pc_ticket))

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
        if request.path=='/pc/stream' and self.pc_ticket_valid(request):good=True
        if not good:
            self.failed_logins[peer]=attempts+[now]
            return web.Response(status=401,headers={'WWW-Authenticate':'Basic realm="LUKAS Demo", charset="UTF-8"'})
        if request.method=='POST' or request.path=='/pc/stream':
            origin=request.headers.get('Origin','')
            parsed=urlsplit(origin)
            local=parsed.hostname in ('localhost','127.0.0.1','::1')
            if (parsed.scheme!='https' and not (local and parsed.scheme=='http')) or parsed.netloc!=request.host or (request.method=='POST' and request.content_type!='application/json'):
                return web.Response(status=403,text='Origin rejected')
        try:response=await handler(request)
        except web.HTTPException:raise
        except Exception as exc:
            self.failure=type(exc).__name__
            response=web.json_response({'error':'Bedienung angehalten. Status prüfen.'},status=409)
        response.headers.update({'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
            'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
            'Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"})
        return response

    async def guard(self,route):
        req=route.request;u=urlsplit(req.url)
        if u.hostname=='career.corporatellm.de' and req.method not in ('GET','HEAD','OPTIONS'):
            allowed={'/api/voice-interview/status','/api/voice-interview/rollout','/api/voice-interview/widget-event'}
            if u.path=='/api/voice-interview/widget-session':
                if not self.armed or self.used or not self.worker or self.worker.stop.is_set():
                    await route.abort();return
                # Exactly one real attempt. Never automatically retry this POST.
                if os.getenv('DEMO_REAL_INTERVIEW_ENABLED')!='1' or not self.archive_ready:
                    self.failure='RealInterviewNotReleased';await route.abort();return
                for label in (PRIVACY,RECORDING):
                    if not await self.page.get_by_role('checkbox',name=label,exact=True).is_checked():
                        self.failure='ConsentMissing';await route.abort();return
                self.recording=ConversationRecording(self.new_archive('interview'),self.consent)
                try:await self.recording.start()
                except Exception:
                    self.worker.halt('recording_start_failed')
                    await route.abort();return
                self.worker.recording=self.recording
                self.used=True;self.interview='Start angefordert; Verbindung unbestätigt'
            elif u.path not in allowed:
                await route.abort();return  # Includes application submissions and phone-call path.
        await route.continue_()

    async def open(self):
        PRIVATE.mkdir(mode=0o700,exist_ok=True);PRIVATE.chmod(0o700)
        context=os.environ.pop('DEMO_CONTEXT_JSON')
        cp=PRIVATE/'context.json';cp.write_text(context);cp.chmod(0o600)
        self.context_path=cp
        ARCHIVE.mkdir(parents=True,exist_ok=True,mode=0o700);ARCHIVE.chmod(0o700)
        self.archive_ready=archive_mounted() or os.getenv('DEMO_ALLOW_LOCAL_STORAGE')=='1'
        self.diagnostics=Diagnostics(ARCHIVE.parent/'network-diagnostics.json')
        self.identity=json.loads(os.environ.pop('DEMO_APPLICANT_JSON'))
        self.consent=json.loads(os.environ.pop('DEMO_CONSENT_JSON'))
        if os.getenv('DEMO_PC_ONLY')=='1':
            self.monitor_task=asyncio.create_task(self.monitor())
            return  # The operator opens Eva in their own browser, never here.
        self.pw=await async_playwright().start()
        proxy=os.environ.get('HTTPS_PROXY')
        self.browser=await self.pw.chromium.launch(executable_path='/usr/bin/chromium',
            headless=not bool(os.environ.get('DISPLAY')),env=browser_env(),
            proxy={'server':proxy} if proxy else None,ignore_default_args=['--mute-audio'],
            args=['--autoplay-policy=no-user-gesture-required','--disable-dev-shm-usage'])
        ctx=await self.browser.new_context(viewport={'width':1100,'height':900},permissions=['microphone'])
        await ctx.route('https://career.corporatellm.de/**',self.guard)
        self.page=await ctx.new_page();self.surface=EvaSurface(self.page)
        await self.diagnostics.attach(self.page)
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
            if self.recording and not self.recording.closed:
                if any(t.done() for t in self.recording.tasks):
                    self.worker.halt('recording_failure')
                if self.worker.stop.is_set():await self.finish_recording('voice_stopped')
            if self.worker and self.worker.stop.is_set():
                self.armed=False
                if self.used:self.interview='abgebrochen'
            if self.used and self.page and not self.page.is_closed():
                # Read visible UI only. Consented audio and draft text are stored separately.
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
            'archive_ready':self.archive_ready,'real_interview_enabled':os.getenv('DEMO_REAL_INTERVIEW_ENABLED')=='1',
            'test_running':bool(self.test_task and not self.test_task.done()),
            'expires_in_seconds':max(0,3600-int(time.monotonic()-self.created))})

    async def screen(self,request):
        if not self.page or self.page.is_closed():raise web.HTTPGone()
        return web.Response(body=await self.page.screenshot(type='jpeg',quality=70),content_type='image/jpeg')

    async def action(self,request):
        data=await request.json();action=request.match_info['action']
        if action=='stop':
            if self.pc_session:self.pc_session.halt('pc_stop')
            self.pc_ticket=None
            if self.test_task and not self.test_task.done():
                self.test_task.cancel();await asyncio.gather(self.test_task,return_exceptions=True)
            self.armed=False;self.closed=True
            if self.worker:self.worker.halt('operator_stop')
            elif self.browser:await self.browser.close()
            if self.recording:await self.finish_recording('operator_stop')
            if self.interview!='nicht gestartet':self.interview='abgebrochen'
            return web.json_response({'ok':True})
        async with self.lock:
            if self.pc_task and not self.pc_task.done():raise web.HTTPConflict(text='PC-Audiotest aktiv.')
            if action=='prepare':
                await self.prepare()
            elif action in ('recording-test','voice-test','voice-test-baseline'):
                if self.used or self.worker or action in self.test_actions or (self.test_task and not self.test_task.done()):raise web.HTTPConflict(text='Test bereits ausgeführt oder Sitzung aktiv.')
                if not self.archive_ready:raise web.HTTPConflict(text='Privates Volume fehlt.')
                from recording_test_job import run_test, run_voice_test
                self.test_actions.add(action)
                root=self.new_archive('test')
                job=run_voice_test(root,self.consent,self.context_path,baseline=action=='voice-test-baseline') if action.startswith('voice-test') else run_test(root,self.consent)
                self.test_task=asyncio.create_task(job)
            elif action=='review-test-timing':
                if self.worker or (self.test_task and not self.test_task.done()):raise web.HTTPConflict(text='Sitzung aktiv.')
                from content_review import review_content
                for root in sorted(ARCHIVE.glob('*-test-*'))[-10:]:
                    report=root/'test-report.json'
                    if not report.is_file() or (root/'content-review.json').exists() or not (root/'transcript.json').exists():continue
                    saved=json.loads(report.read_text())
                    if saved.get('variant') not in ('baseline','optimized'):continue
                    private_json(root/'test-report-uncorrected.json',saved)
                    review_content(root,saved['metrics'])
                    saved['timing_review']='Unvalidated word timestamps removed; see content-review.json. Original retained in test-report-uncorrected.json.'
                    private_json(report,saved)
            elif action=='connect':
                if self.test_task and not self.test_task.done():raise web.HTTPConflict(text='Test läuft.')
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

    def new_archive(self,kind):
        if sum(p.stat().st_size for p in ARCHIVE.rglob('*') if p.is_file())>800_000_000:
            raise ValueError('Private archive capacity reached')
        name=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+kind+'-'+uuid.uuid4().hex[:8]
        root=ARCHIVE/name;root.mkdir(mode=0o700)
        private_json(root/'manifest.json',{'kind':kind,'utc':datetime.now(timezone.utc).isoformat(),'consent':self.consent})
        return root

    async def finish_recording(self,reason):
        if self.recording and not self.recording.closed:
            await self.recording.close(reason)
            self.transcription_task=asyncio.create_task(safe_transcribe(self.recording.root))

    async def archives(self,request):
        entries=[]
        for root in sorted(ARCHIVE.glob('*'),reverse=True):
            if root.is_dir() and (root/'manifest.json').exists():
                status=root/'transcription-status.json'
                entries.append({'id':root.name,'manifest':json.loads((root/'manifest.json').read_text()),
                    'transcription':json.loads(status.read_text()) if status.exists() else {'state':'pending'},
                    'download':'/conversation.zip?id='+root.name})
        return web.json_response(entries)

    async def diagnostic_report(self,request):
        path=ARCHIVE.parent/'network-diagnostics.json'
        return web.json_response(json.loads(path.read_text()) if path.exists() else [])

    async def download(self,request):
        ident=request.query.get('id')
        if ident:
            import re
            if not re.fullmatch(r'[0-9TZ]+-(?:interview|test|pc-test)-[a-f0-9]{8}',ident):raise web.HTTPBadRequest()
            root=ARCHIVE/ident
        elif self.recording:root=self.recording.root
        else:
            roots=sorted(p for p in ARCHIVE.glob('*') if p.is_dir() and (p/'manifest.json').exists())
            if not roots:raise web.HTTPNotFound(text='Noch kein Gespräch aufgezeichnet.')
            root=roots[-1]
        if not root.is_dir():raise web.HTTPNotFound()
        if self.recording and root==self.recording.root and not self.recording.closed:
            raise web.HTTPConflict(text='Zuerst Gespräch stoppen.')
        if not (root/'README.txt').exists():raise web.HTTPConflict(text='Aufnahme noch nicht abgeschlossen oder nach Absturz unvollständig.')
        data=io.BytesIO()
        with zipfile.ZipFile(data,'w',compression=zipfile.ZIP_STORED) as archive:
            for name in ('Eva.wav','LUKAS.wav','transcript-draft.jsonl','README.txt','manifest.json','transcript.txt','transcript.json','transcription-status.json','test-report.json','content-timing.json','content-review.json','test-report-uncorrected.json','pc-report.json','pc-status.json'):
                path=root/name
                if path.is_file():archive.write(path,name)
        return web.Response(body=data.getvalue(),content_type='application/zip',headers={'Content-Disposition':'attachment; filename=eva-lukas-gespraech.zip'})

    async def close(self):
        self.closed=True;self.armed=False
        if self.pc_session:self.pc_session.halt('operator_shutdown')
        if self.pc_task:await self.pc_task
        if self.worker:self.worker.halt('operator_shutdown')
        if self.worker_task:await self.worker_task
        if self.recording:await self.finish_recording('operator_shutdown')
        if hasattr(self,'monitor_task'):
            self.monitor_task.cancel();await asyncio.gather(self.monitor_task,return_exceptions=True)
        if self.browser:
            try:await self.browser.close()
            except Exception:pass
        if hasattr(self,'pw'):
            try:await self.pw.stop()
            except Exception:pass

    async def pc_start(self,request):
        data=await request.json()
        if data!={'mode':'test','recording_consent':True}:
            raise web.HTTPBadRequest(text='Nur ausdrücklich bestätigte Testaufnahmen sind freigegeben.')
        async with self.lock:
            if self.pc_ticket and time.monotonic()>=self.pc_ticket_until:self.pc_ticket=None
            if self.closed or self.worker or self.pc_ticket or (self.pc_task and not self.pc_task.done()) or (self.test_task and not self.test_task.done()):
                raise web.HTTPConflict(text='Sitzung bereits reserviert oder aktiv.')
            if self.pc_uses>=3:raise web.HTTPConflict(text='Drei PC-Tests erreicht. Kein automatischer Neustart.')
            if not self.archive_ready:raise web.HTTPConflict(text='Privates Aufnahme-Volume nicht bereit.')
            if not hasattr(self,'context_path') or not self.context_path.is_file():raise web.HTTPConflict(text='Privater Kontext nicht bereit.')
            if self.consent.get('recording_allowed') is not True:raise web.HTTPConflict(text='Aufnahmefreigabe fehlt.')
            if not os.getenv('OPENAI_API_KEY'):raise web.HTTPConflict(text='OPENAI_API_KEY fehlt im geschützten Worker.')
            self.pc_uses+=1;self.pc_ticket=secrets.token_urlsafe(32);self.pc_ticket_until=time.monotonic()+60
            response=web.json_response({'mode':'test','max_seconds':660,'context_available':True})
            response.set_cookie('pc_voice',self.pc_ticket,max_age=60,path='/pc/stream',httponly=True,samesite='Strict',
                secure=request.host.split(':')[0] not in ('localhost','127.0.0.1'))
            return response

    async def pc_stop(self,request):
        self.pc_ticket=None
        if self.pc_session:self.pc_session.halt('pc_stop')
        return web.json_response({'stop_requested':True})

    async def pc_status(self,request):
        return web.json_response({'mode':'test','real_interview_control':False,'archive_ready':self.archive_ready,
            'remaining_tests':max(0,3-self.pc_uses),'active':bool(self.pc_task and not self.pc_task.done()),
            'voice':self.pc_session.status if self.pc_session else {'state':'not_started'}})

    def app(self):
        app=web.Application(middlewares=[self.secure],client_max_size=8192)
        async def index(request):return web.FileResponse(ROOT/('pc.html' if os.getenv('DEMO_PC_ONLY')=='1' else 'operator.html'))
        async def js(request):return web.Response(text=ROOT.joinpath('operator-client.txt').read_text(),content_type='application/javascript')
        app.router.add_get('/',index);app.router.add_get('/client.js',js)
        app.router.add_get('/healthz',index);app.router.add_get('/status',self.status)
        app.router.add_get('/conversation.zip',self.download)
        app.router.add_get('/archives',self.archives);app.router.add_get('/diagnostics',self.diagnostic_report)
        app.router.add_get('/screen',self.screen);app.router.add_post('/action/{action}',self.action)
        from pc_voice import pc_socket
        async def pc_page(request):return web.FileResponse(ROOT/'pc.html')
        async def pc_js(request):return web.FileResponse(ROOT/'pc-client.js')
        async def pc_worklet(request):return web.FileResponse(ROOT/'pc-audio-worklet.js')
        async def pc_partner(request):return web.FileResponse(ROOT/'pc-partner.html')
        async def pc_partner_js(request):return web.FileResponse(ROOT/'pc-partner.js')
        async def pc_stream(request):return await pc_socket(request,self)
        app.router.add_get('/pc',pc_page);app.router.add_get('/pc-client.js',pc_js);app.router.add_get('/pc-audio-worklet.js',pc_worklet)
        app.router.add_post('/pc/start',self.pc_start);app.router.add_post('/pc/stop',self.pc_stop)
        app.router.add_get('/pc/status',self.pc_status);app.router.add_get('/pc/stream',pc_stream)
        app.router.add_get('/pc/partner',pc_partner);app.router.add_get('/pc-partner.js',pc_partner_js)
        return app

async def main():
    operator=Operator(os.environ.pop('DEMO_OPERATOR_PASSWORD',''))
    runner=web.AppRunner(operator.app(),access_log=None);await runner.setup()
    await web.TCPSite(runner,'0.0.0.0',int(os.environ.get('PORT','8080'))).start()
    stop=asyncio.Event()
    for sig in (signal.SIGINT,signal.SIGTERM):asyncio.get_running_loop().add_signal_handler(sig,stop.set)
    try:
        await operator.open()
        print('OPERATOR_READY: authenticated portal available; interview not started',flush=True)
        try:
            if os.getenv('DEMO_PC_ONLY')=='1':await stop.wait()
            else:await asyncio.wait_for(stop.wait(),3600)
        except asyncio.TimeoutError:
            await operator.close()
            # Keep authenticated archive downloads available; browser/model remain closed.
            await stop.wait()
    except Exception as exc:
        print('OPERATOR_START_FAILED '+type(exc).__name__,flush=True)
        raise SystemExit(1)
    finally:await operator.close();await runner.cleanup()

if __name__=='__main__':asyncio.run(main())
