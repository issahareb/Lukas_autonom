"""Reviewed UI-only Eva integration. Never posts an application or bypasses gates."""
import hashlib
import json
from pathlib import Path

THANK_YOU='https://career.corporatellm.de/fullstack-developer/danke'

class EvaSurface:
    def __init__(self,page):self.page=page

    async def inspect(self):
        await self.page.goto(THANK_YOU,wait_until='domcontentloaded')
        await self.page.get_by_role('button',name='Jetzt Vorsprung sichern',exact=True).wait_for(state='visible',timeout=20000)
        cookies=self.page.get_by_role('button',name='Nur Notwendige',exact=True)
        if await cookies.count()==1: await cookies.click()
        button=self.page.get_by_role('button',name='Jetzt Vorsprung sichern',exact=True)
        if await button.count()!=1:
            button=self.page.get_by_role('link',name='Jetzt Vorsprung sichern',exact=True)
        if await button.count()!=1: raise RuntimeError('Interview entry requires UI review')
        await button.click()
        # Only expose the regular page. No API calls, consent checks or start clicks.
        await self.page.wait_for_timeout(1000)
        return await self.snapshot()

    async def snapshot(self):
        frames=[]
        for index,frame in enumerate(self.page.frames):
            if frame.url.startswith('https://challenges.cloudflare.com/'):
                continue  # Never inspect, solve or alter the security challenge.
            text=await frame.locator('body').inner_text(timeout=5000)
            frames.append({'index':index,'url':frame.url,'text':text})
        raw=json.dumps(frames,ensure_ascii=False,sort_keys=True)
        return {'frames':frames,'sha256':hashlib.sha256(raw.encode()).hexdigest(),
                'interview':'nicht gestartet'}

    async def readiness(self):
        challenge=self.page.locator('input[name="cf-turnstile-response"]')
        return {'security_check_present':await challenge.count()>0,
            'security_check_complete':await challenge.evaluate_all('(es)=>es.length===0||es.every(e=>e.value.length>0)'),
            'identity_fields_empty':await self.page.locator('input[type="text"],input[type="email"]').evaluate_all('(es)=>es.some(e=>!e.value.trim())'),
            'microphone_preflight_visible':await self.page.get_by_role('button',name='Mikrofon testen',exact=True).count()>0}

    async def start_reviewed(self,review):
        required=('real_voice_test_passed','knowledge_test_passed','interrupt_test_passed',
                  'stop_test_passed','consents_reviewed','ai_demo_allowed')
        if not all(review.get(k) is True for k in required):
            raise RuntimeError('Acceptance or consent review incomplete')
        current=await self.snapshot()
        if review.get('surface_sha256')!=current['sha256']:
            raise RuntimeError('Interview surface changed; review again')
        ready=await self.readiness()
        if not ready['security_check_complete']:
            raise RuntimeError('Security check requires operator; no bypass or start')
        if ready['identity_fields_empty'] or not review.get('existing_application_linked'):
            raise RuntimeError('Existing application must be linked in regular UI; never reapply')
        if not review.get('microphone_preflight_passed'):
            raise RuntimeError('Regular microphone preflight not reviewed')
        index=review.get('frame_index')
        if not isinstance(index,int) or not 0<=index<len(self.page.frames):
            raise RuntimeError('Reviewed frame missing')
        frame=self.page.frames[index]
        labels=review.get('consent_labels')
        if not isinstance(labels,list) or not labels or not all(isinstance(x,str) and x for x in labels):
            raise RuntimeError('Exact consent labels required')
        # No model-generated selector or generic checkbox acceptance.
        for label in labels:
            checkbox=frame.get_by_role('checkbox',name=label,exact=True)
            if await checkbox.count()!=1: raise RuntimeError('Consent changed')
            await checkbox.check()
        button=frame.get_by_role('button',name='Voice Interview starten',exact=True)
        if await button.count()!=1 or not await button.is_enabled():
            raise RuntimeError('Reviewed start button unavailable')
        await button.click()
        # A click may only reveal the normal microphone preflight. It is not
        # evidence that an interview connection has actually begun.
        return {'interview':'Start angefordert; Verbindung unbestätigt','completion_confirmed':False}

    async def wait_for_audio_ready(self):
        await self.page.locator('elevenlabs-convai').wait_for(state='visible',timeout=20000)
        await self.page.get_by_text('Ich höre zu',exact=True).wait_for(state='visible',timeout=20000)
        return {'interview':'gestartet','completion_confirmed':False}
