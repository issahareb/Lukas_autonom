import asyncio
import base64
import json
import unittest
from aiohttp.test_utils import TestClient,TestServer
from operator_portal import Operator

class TestOperatorSecurity(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.operator=Operator('unit-test-password-with-no-real-access')
        self.client=TestClient(TestServer(self.operator.app()));await self.client.start_server()
        self.auth={'Authorization':'Basic '+base64.b64encode(('issa:'+self.operator.password).encode()).decode()}
    async def asyncTearDown(self):await self.client.close()
    async def test_auth_and_cross_site_stop(self):
        self.assertEqual((await self.client.get('/screen')).status,401)
        self.assertEqual((await self.client.get('/healthz')).status,200)
        self.assertEqual((await self.client.get('/',headers=self.auth)).status,200)
        response=await self.client.post('/action/stop',json={},headers={**self.auth,'Origin':'https://untrusted.invalid'})
        self.assertEqual(response.status,403);self.assertFalse(self.operator.closed)
        response=await self.client.post('/action/stop',json={},headers={**self.auth,'Origin':str(self.client.make_url('/')).rstrip('/')})
        self.assertEqual(response.status,200);self.assertTrue(self.operator.closed)
    async def test_interview_route_requires_ready_worker_and_one_attempt(self):
        class Request:method='POST';url='https://career.corporatellm.de/api/voice-interview/widget-session'
        class Route:
            request=Request()
            def __init__(self):self.aborted=False;self.continued=False
            async def abort(self):self.aborted=True
            async def continue_(self):self.continued=True
        first=Route();await self.operator.guard(first);self.assertTrue(first.aborted)
        class Worker:stop=asyncio.Event()
        self.operator.worker=Worker();self.operator.armed=True
        second=Route();await self.operator.guard(second);self.assertTrue(second.continued)
        third=Route();await self.operator.guard(third);self.assertTrue(third.aborted)
        application=Route();application.request=type('Request',(),{'method':'POST','url':'https://career.corporatellm.de/api/application'})()
        await self.operator.guard(application);self.assertTrue(application.aborted)
    async def test_stop_does_not_wait_for_browser_lock(self):
        await self.operator.lock.acquire()
        response=await asyncio.wait_for(self.client.post('/action/stop',json={},headers={**self.auth,'Origin':str(self.client.make_url('/')).rstrip('/')}),1)
        self.assertEqual(response.status,200);self.operator.lock.release()

class TestPreparedBrowser(unittest.IsolatedAsyncioTestCase):
    async def test_existing_browser_kept_until_manual_stop(self):
        import argparse,os,tempfile
        from pathlib import Path
        from playwright.async_api import async_playwright
        from worker import Worker,browser_env
        from test_worker import Provider
        with tempfile.TemporaryDirectory() as d:
            private=Path(d);private.chmod(0o700);cp=private/'context.json';cp.write_text('{}')
            async with async_playwright() as p:
                browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,env=browser_env())
                ctx=await browser.new_context();page=await ctx.new_page();await page.set_content('<p>Existing browser session</p>')
                args=argparse.Namespace(context=str(cp),private_dir=d,port=8879,max_seconds=30)
                provider=Provider();previous=os.environ.get('OPENAI_API_KEY');os.environ['OPENAI_API_KEY']='unit-test'
                worker=Worker(args,connector=lambda *a,**k:provider,prepared_page=page)
                task=asyncio.create_task(worker.run())
                try:
                    for _ in range(100):
                        if worker.status['state']=='ready' or task.done():break
                        await asyncio.sleep(.05)
                    self.assertEqual(worker.status['state'],'ready')
                    self.assertEqual(await page.locator('p').inner_text(),'Existing browser session')
                    start=next(x for x in provider.sent if x['type']=='session.start')
                    self.assertEqual(start['session']['input'],[])
                    worker.halt('manual_stop');await asyncio.wait_for(task,20)
                    self.assertTrue(worker.finalized.is_set());self.assertFalse(browser.is_connected())
                finally:
                    if not task.done():worker.halt('cleanup');await task
                    if previous is None:os.environ.pop('OPENAI_API_KEY',None)
                    else:os.environ['OPENAI_API_KEY']=previous

if __name__=='__main__':unittest.main()
