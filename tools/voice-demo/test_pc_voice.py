"""PC transport tests: real HTTP/WebSocket/Chromium, simulated voice provider."""
import asyncio
import base64
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
import wave
import zipfile
from unittest.mock import AsyncMock, patch

import numpy as np
from aiohttp import WSServerHandshakeError, WSMsgType
from aiohttp.test_utils import TestClient, TestServer
from playwright.async_api import async_playwright
from operator_portal import Operator
from test_worker import Provider
from pc_voice import RATE, BYTES, PcRecording


class TestPcVoice(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.env=patch.dict(os.environ,{'OPENAI_API_KEY':'unit-test-only','DEMO_REAL_INTERVIEW_ENABLED':'0'})
        self.env.start()
        self.archive=self.root/'archive';self.archive.mkdir()
        self.paths=patch('operator_portal.ARCHIVE',self.archive);self.paths.start()
        self.operator=Operator('unit-test-password-with-no-real-access')
        self.operator.archive_ready=True;self.operator.consent={'recording_allowed':True}
        self.operator.context_path=self.root/'context.json'
        self.operator.context_path.write_text('{"user_confirmed":{"name":"Issa Hareb"},"verified":"PC TEST CONTEXT"}')
        self.provider=Provider();self.operator.pc_connector=lambda *a,**kw:self.provider
        self.operator.pc_transcribe=AsyncMock()
        self.client=TestClient(TestServer(self.operator.app()));await self.client.start_server()
        self.auth={'Authorization':'Basic '+base64.b64encode(('issa:'+self.operator.password).encode()).decode()}
        self.origin=str(self.client.make_url('/')).rstrip('/')
        self.headers={**self.auth,'Origin':self.origin}

    async def asyncTearDown(self):
        if self.operator.pc_session:self.operator.pc_session.halt('test_cleanup')
        if self.operator.pc_task:await asyncio.wait_for(self.operator.pc_task,20)
        await self.client.close();self.paths.stop();self.env.stop();self.tmp.cleanup()

    async def reserve(self):
        response=await self.client.post('/pc/start',json={'mode':'test','recording_consent':True},headers=self.headers)
        self.assertEqual(response.status,200,await response.text())
        cookie=response.cookies['pc_voice'];self.assertTrue(cookie['httponly']);self.assertEqual(cookie['samesite'],'Strict')
        return cookie.value

    async def connect(self):
        await self.reserve()
        socket=await self.client.ws_connect('/pc/stream',headers={'Origin':self.origin})
        while True:
            event=await socket.receive_json(timeout=3)
            if event.get('type')=='ready':break
        return socket

    async def done(self,socket):
        await socket.send_json({'type':'stop'})
        while True:
            message=await socket.receive(timeout=20)
            if message.type!=WSMsgType.TEXT:break
            event=json.loads(message.data)
            if event.get('type')=='stopped':self.assertTrue(event['status']['provider_finalized']);break
        await socket.close()
        await self.operator.pc_task

    async def test_auth_origin_consent_and_interview_gate(self):
        for path in ('/pc','/pc-client.js','/pc/partner','/pc-partner.js','/pc/status','/conversation.zip'):
            self.assertEqual((await self.client.get(path)).status,401)
        self.assertEqual((await self.client.post('/pc/start',json={'mode':'eva','recording_consent':True},headers=self.headers)).status,400)
        self.assertEqual((await self.client.post('/pc/start',json={'mode':'test','recording_consent':False},headers=self.headers)).status,400)
        with self.assertRaises(WSServerHandshakeError):await self.client.ws_connect('/pc/stream',headers=self.headers)
        await self.reserve()
        with self.assertRaises(WSServerHandshakeError):await self.client.ws_connect('/pc/stream',headers={'Origin':'https://elsewhere.invalid'})
        self.assertIsNone(self.operator.pc_task)
        self.assertEqual((await self.client.post('/pc/start',json={'mode':'test','recording_consent':True},headers=self.headers)).status,409)

    async def test_pc_only_home_and_https_origin(self):
        with patch.dict(os.environ,{'DEMO_PC_ONLY':'1'}):
            response=await self.client.get('/',headers=self.auth)
            self.assertIn('PC-Sprachtest',await response.text())
        response=await self.client.post('/pc/start',json={'mode':'test','recording_consent':True},
            headers={**self.auth,'Host':'worker.example','Origin':'http://worker.example'})
        self.assertEqual(response.status,403)

    async def test_audio_context_separation_stop_and_restart_download(self):
        socket=await self.connect()
        start=next(e for e in self.provider.sent if e['type']=='session.start')
        self.assertIn('PC TEST CONTEXT',start['session']['instructions'])
        self.assertNotIn('tools',start['session']);self.assertIn('niemals Issa selbst',start['session']['instructions'])
        signal=(np.sin(np.arange(480)*2*np.pi*660/RATE)*4000).astype('<i2').tobytes()
        await self.provider.events.put({'type':'session.output_audio.delta','delta':base64.b64encode(signal).decode()})
        while True:
            event=await socket.receive_json(timeout=3)
            if event.get('type')=='audio':break
        received=base64.b64decode(event['pcm']);self.assertEqual(received,signal)
        # Only incoming audio reaches the model, never the recorded rendered track.
        incoming=b'\x00'*BYTES
        await socket.send_bytes(struct.pack('<I',0)+incoming+received)
        for _ in range(30):
            if any(e['type']=='session.input_audio.append' for e in self.provider.sent):break
            await asyncio.sleep(.01)
        self.assertEqual(base64.b64decode(next(e['audio'] for e in self.provider.sent if e['type']=='session.input_audio.append')),incoming)
        await self.done(socket)
        root=next(self.archive.iterdir())
        for name,expected in [('Eva',incoming),('LUKAS',received)]:
            with wave.open(str(root/(name+'.wav'))) as wav:
                self.assertEqual(wav.getframerate(),RATE);self.assertEqual(wav.readframes(480),expected)
        self.assertEqual(json.loads((root/'pc-report.json').read_text())['reason'],'pc_stop')
        # A new application instance can download the completed private evidence.
        restarted=TestClient(TestServer(Operator(self.operator.password).app()));await restarted.start_server()
        try:
            url='/conversation.zip?id='+root.name
            self.assertEqual((await restarted.get(url)).status,401)
            response=await restarted.get(url,headers=self.auth);self.assertEqual(response.status,200)
            self.assertEqual(response.headers['Cache-Control'],'no-store')
            with zipfile.ZipFile(io.BytesIO(await response.read())) as z:self.assertIn('pc-report.json',z.namelist())
        finally:await restarted.close()

    async def test_interruption_flushes_old_generation(self):
        socket=await self.connect()
        loud=(np.ones(480)*4000).astype('<i2').tobytes()
        for i in range(3):await socket.send_bytes(struct.pack('<I',i*480)+loud+b'\x00'*BYTES)
        while True:
            event=await socket.receive_json(timeout=3)
            if event.get('type')=='clear':break
        self.assertGreater(event['generation'],0)
        self.assertEqual(self.operator.pc_session.status['interruptions'],1)
        await self.done(socket)

    async def test_invalid_sequence_stops_and_marks_incomplete(self):
        socket=await self.connect()
        await socket.send_bytes(struct.pack('<I',480)+b'\x00'*(BYTES*2))
        await asyncio.wait_for(self.operator.pc_task,20)
        self.assertEqual(self.operator.pc_session.status['reason'],'component_failure')
        self.assertTrue(self.operator.pc_session.status['provider_finalized'])
        self.assertEqual(self.operator.pc_session.recording.samples,0)

    async def test_disconnect_closes_provider(self):
        socket=await self.connect();await socket.close()
        await asyncio.wait_for(self.operator.pc_task,20)
        self.assertEqual(self.operator.pc_session.status['reason'],'pc_connection_lost')
        self.assertTrue(any(e['type']=='session.close' for e in self.provider.sent))

    async def test_chromium_microphone_worklet_and_stop(self):
        async with async_playwright() as p:
            browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
                args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--no-sandbox'])
            try:
                ctx=await browser.new_context(http_credentials={'username':'issa','password':self.operator.password},permissions=['microphone'])
                page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                await page.goto(self.origin+'/pc');await page.click('#devices')
                for _ in range(100):
                    if await page.locator('#input').input_value():break
                    await asyncio.sleep(.03)
                self.assertTrue(await page.locator('#input').input_value(),await page.locator('#status').text_content())
                await page.check('#consent');await page.click('#start')
                for _ in range(150):
                    if 'Test läuft' in await page.locator('#status').text_content():break
                    await asyncio.sleep(.05)
                self.assertIn('Test läuft',await page.locator('#status').text_content())
                signal=(np.sin(np.arange(480)*2*np.pi*660/RATE)*6000).astype('<i2').tobytes()
                for _ in range(15):
                    await self.provider.events.put({'type':'session.output_audio.delta','delta':base64.b64encode(signal).decode()})
                    await asyncio.sleep(.02)
                await asyncio.sleep(.3)
                self.assertGreater(self.operator.pc_session.frames,5)
                await page.click('#stop')
                for _ in range(200):
                    if 'Sprachsitzung beendet' in await page.locator('#status').text_content():break
                    await asyncio.sleep(.05)
                self.assertIn('Sprachsitzung beendet',await page.locator('#status').text_content())
                await self.operator.pc_task
                self.assertFalse(errors,errors)
                self.assertEqual(await page.locator('audio').count(),0)
                root=self.operator.pc_session.recording.root
                with wave.open(str(root/'LUKAS.wav')) as w:
                    self.assertGreater(np.max(np.abs(np.frombuffer(w.readframes(w.getnframes()),dtype='<i2'))),0)
                print('Chromium: real getUserMedia/AudioWorklet/WebSocket audio and rendered-output recording passed; Windows driver routing not tested.')
            finally:await browser.close()


if __name__=='__main__':unittest.main()
