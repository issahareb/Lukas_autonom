"""Lifecycle tests with real Chromium and audio processes, simulated provider."""
import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
import numpy as np
from worker import Worker, session_config, browser_env

class Provider:
    def __init__(self,disconnect=False):
        self.events=asyncio.Queue();self.sent=[];self.disconnect=disconnect
    async def __aenter__(self): return self
    async def __aexit__(self,*_): pass
    def __aiter__(self): return self
    async def __anext__(self):
        v=await self.events.get()
        if v is None: raise StopAsyncIteration
        return json.dumps(v)
    async def send(self,raw):
        event=json.loads(raw);self.sent.append(event)
        if event['type']=='session.start':
            await self.events.put({'type':'session.started','session':event['session']})
            if self.disconnect: await self.events.put(None)
        elif event['type']=='session.close': await self.events.put({'type':'session.closed'})

async def request(port,path,method='GET',token='wrong'):
    r,w=await asyncio.open_connection('127.0.0.1',port)
    w.write(f'{method} {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\n\r\n'.encode())
    await w.drain();response=await r.read();w.close();await w.wait_closed();return response

class TestWorker(unittest.IsolatedAsyncioTestCase):
    async def setup_worker(self,disconnect=False,limit=30):
        self.tmp=tempfile.TemporaryDirectory();private=Path(self.tmp.name);private.chmod(0o700)
        ctx=private/'context.json';ctx.write_text('{"verified":"test context only"}')
        os.environ['OPENAI_API_KEY']='unit-test-no-real-credential'
        args=argparse.Namespace(context=str(ctx),private_dir=str(private),port=8878,max_seconds=limit)
        self.provider=Provider(disconnect)
        self.worker=Worker(args,connector=lambda *a,**kw:self.provider)
        self.runner_task=asyncio.create_task(self.worker.run())
        for _ in range(100):
            if self.worker.status['state']=='ready' or self.runner_task.done(): break
            await asyncio.sleep(.05)
        return self.worker

    async def asyncTearDown(self):
        if hasattr(self,'runner_task') and not self.runner_task.done():
            self.worker.halt('test_cleanup');await asyncio.wait_for(self.runner_task,20)
        os.environ.pop('OPENAI_API_KEY',None)
        if hasattr(self,'tmp'):self.tmp.cleanup()

    async def test_manual_stop_closes_everything(self):
        w=await self.setup_worker()
        self.assertIn(b'401',await request(8878,'/stop','POST'))
        self.assertFalse(w.stop.is_set())
        self.assertIn(b'200',await request(8878,'/status',token=w.token))
        self.assertIn(b'200',await request(8878,'/stop','POST',w.token))
        await asyncio.wait_for(self.runner_task,20)
        self.assertTrue(w.finalized.is_set())
        self.assertFalse(w.browser.is_connected())
        self.assertIsNotNone(w.audio.capture.returncode)
        self.assertIsNotNone(w.audio.player.returncode)

    async def test_disconnect_stops_without_success_claim(self):
        w=await self.setup_worker(disconnect=True)
        await asyncio.wait_for(self.runner_task,20)
        self.assertFalse(w.finalized.is_set())
        self.assertEqual(w.status['interview'],'nicht gestartet')
        self.assertFalse(w.browser.is_connected())

    async def test_runtime_limit(self):
        w=await self.setup_worker(limit=1)
        await asyncio.wait_for(self.runner_task,20)
        self.assertTrue(w.finalized.is_set())
        self.assertEqual(w.status['state'],'stopped')

    async def test_delegation_has_no_execution(self):
        w=await self.setup_worker()
        await self.provider.events.put({'type':'session.delegation.created',
            'delegation':{'id':'test-1','target':'client','command':'delete repository'}})
        await asyncio.sleep(.15)
        replies=[e for e in self.provider.sent if e['type']=='session.commentary.append']
        self.assertEqual(len(replies),1)
        self.assertIn('keine Aktionen',replies[0]['content'])

    async def test_output_overflow_fails_closed(self):
        w=await self.setup_worker()
        await self.provider.events.put({'type':'session.output_audio.delta',
            'delta':base64.b64encode(bytes(960*101)).decode()})
        await asyncio.wait_for(self.runner_task,20)
        self.assertEqual(w.status['error_type'],'QueueFull')
        self.assertTrue(w.finalized.is_set())

    async def test_browser_audio_through_provider_protocol(self):
        w=await self.setup_worker()
        page=w.browser.contexts[0].pages[0]
        # Let capture settle, then a 100ms onset marker followed by a different tone.
        await asyncio.sleep(.5)
        marker=len(self.provider.sent)
        await page.evaluate('''()=>{
          const t=ac.currentTime;
          for(const [hz,delay,duration] of [[1200,0,.1],[440,.1,.5]]){
            const o=ac.createOscillator(),g=ac.createGain();o.frequency.value=hz;
            g.gain.value=.2;o.connect(g).connect(ac.destination);
            o.start(t+delay);o.stop(t+delay+duration);
          }
        }''')
        for _ in range(60):
            await asyncio.sleep(.05)
            chunks=[base64.b64decode(e['audio']) for e in self.provider.sent[marker:]
                    if e['type']=='session.input_audio.append']
            x=np.frombuffer(b''.join(chunks),dtype='<i2').astype(float)
            active=np.flatnonzero(abs(x)>800)
            if len(active)>2000: break
        self.assertGreater(len(active),1000)
        onset=x[active[0]:active[0]+1440]  # First 60ms must contain the onset marker.
        freq=np.fft.rfftfreq(len(onset),1/24000)[np.argmax(abs(np.fft.rfft(onset)))]
        self.assertAlmostEqual(freq,1200,delta=30)
        self.assertGreater(w.status['interruptions'],0)
        await asyncio.sleep(.8)  # Let the simulated question and local VAD finish.
        # Return raw 24kHz PCM through actual session.output_audio.delta handler.
        data=(np.sin(2*np.pi*880*np.arange(12000)/24000)*6000).astype('<i2').tobytes()
        await self.provider.events.put({'type':'session.output_audio.delta',
            'delta':base64.b64encode(data).decode()})
        for _ in range(40):
            spec=await page.evaluate('spectrum()')
            if spec['db'] is not None and abs(spec['hz']-880)<30 and spec['db']>-40: break
            await asyncio.sleep(.02)
        self.assertAlmostEqual(spec['hz'],880,delta=30)
        self.assertGreater(spec['db'],-40)

    def test_no_browser_credentials_or_tools(self):
        os.environ['OPENAI_API_KEY']='secret'
        self.assertNotIn('OPENAI_API_KEY',browser_env())
        config=session_config('facts')
        self.assertEqual(config['delegation'],{'type':'client'})
        self.assertFalse(config['store'])
        self.assertIn('niemals Issa selbst',config['instructions'])

if __name__=='__main__':unittest.main()
