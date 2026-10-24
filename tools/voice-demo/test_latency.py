import argparse
import asyncio
import base64
import json
import unittest
from worker import Worker, GREETING, RULES
from test_worker import Provider

class TimingTests(unittest.IsolatedAsyncioTestCase):
    def test_disclosure_without_permission_question(self):
        self.assertIn('Ich bin nicht Issa selbst',GREETING)
        self.assertNotIn('?',GREETING)
        self.assertIn('ausdrücklicher Ablehnung',RULES)

    def test_targeted_facts(self):
        w=Worker(argparse.Namespace())
        w.context=json.dumps({'user_confirmed':{'salary':'private salary'},'projects':[
            {'name':'TaxiBB Essen','code_verified':{'architecture':'Contact forms'},'limits':'No measured revenue'},
            {'name':'GuardianGrid','code_verified':{'architecture':'Bungie API'},'limits':'No partnership'}]})
        w.latest_question='Technisches Beispiel Taxi BB Essen'
        result=' '.join(w.knowledge_parts())
        self.assertIn('Contact forms',result)
        self.assertIn('No measured revenue',result)
        self.assertNotIn('Bungie',result)
        self.assertNotIn('private salary',result)

    async def test_fast_answer_onset_retained_during_quiet_tail(self):
        w=Worker(argparse.Namespace());w.ws=Provider();w.speech_active=True
        pcm=b'\x34\x12'*480
        task=asyncio.create_task(w.receive())
        await w.ws.events.put({'type':'session.output_audio.delta','delta':base64.b64encode(pcm).decode()})
        await asyncio.sleep(.01)
        self.assertEqual(w.pending_audio,[pcm])
        self.assertTrue(w.output.empty())
        for held in w.pending_audio:w.enqueue_pcm(held)
        self.assertEqual((await w.output.get())[1],pcm)
        task.cancel();await asyncio.gather(task,return_exceptions=True)
