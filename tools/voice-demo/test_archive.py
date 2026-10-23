import base64
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from aiohttp.test_utils import TestClient, TestServer
from operator_portal import Operator
from network_diagnostics import safe_url
from transcribe_recording import regions
import numpy as np

class ArchiveTest(unittest.IsolatedAsyncioTestCase):
    async def test_reopen_authenticated_download_and_traversal(self):
        with tempfile.TemporaryDirectory() as d, patch('operator_portal.ARCHIVE',Path(d)):
            op=Operator('test-password-long-enough-for-auth');op.consent={'recording_allowed':True}
            root=op.new_archive('test');(root/'README.txt').write_text('test');(root/'transcript.txt').write_text('Eva: Test')
            # New process state / new Operator must rediscover stored files.
            client=TestClient(TestServer(Operator(op.password).app()));await client.start_server()
            auth={'Authorization':'Basic '+base64.b64encode(('issa:'+op.password).encode()).decode()}
            try:
                self.assertEqual((await client.get('/archives')).status,401)
                self.assertEqual((await client.get('/conversation.zip')).status,401)
                response=await client.get('/archives',headers=auth);items=await response.json();self.assertEqual(items[0]['id'],root.name)
                response=await client.get('/conversation.zip?id='+root.name,headers=auth)
                self.assertEqual(response.status,200);data=await response.read()
                with zipfile.ZipFile(io.BytesIO(data)) as z:self.assertEqual(z.read('transcript.txt').decode(),'Eva: Test')
                self.assertEqual((await client.get('/conversation.zip?id=../secret',headers=auth)).status,400)
            finally:await client.close()
    def test_diagnostics_redacts_credentials_and_silence_not_transcribed(self):
        self.assertEqual(safe_url('wss://user:secret@api.elevenlabs.io/v1/ws?token=SECRET'),'wss://api.elevenlabs.io/v1/ws?REDACTED')
        self.assertNotIn('SECRET',safe_url('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/SECRET?x=SECRET'))
        self.assertEqual(regions(np.zeros(24000,dtype='<i2').tobytes()),[])

if __name__=='__main__':unittest.main()
