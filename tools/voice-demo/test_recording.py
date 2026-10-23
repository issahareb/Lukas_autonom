import asyncio
import json
from pathlib import Path
import tempfile
import unittest
import wave
import numpy as np
from conversation_recording import ConversationRecording
from audio import binary

class RecordingTest(unittest.IsolatedAsyncioTestCase):
    async def test_consent_channels_stop_and_private_files(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):ConversationRecording(directory,{})
            rec=ConversationRecording(directory,{'recording_allowed':True})
            await rec.start();await asyncio.sleep(.3)
            async def play(device,hz):
                proc=await asyncio.create_subprocess_exec(binary('pacat'),'--playback','--device='+device,
                    '--raw','--format=s16le','--rate=24000','--channels=1',stdin=asyncio.subprocess.PIPE)
                data=(np.sin(2*np.pi*hz*np.arange(24000)/24000)*5000).astype('<i2').tobytes()
                await proc.communicate(data)
                self.assertEqual(proc.returncode,0)
            await asyncio.gather(play('eva_out',440),play('lukas_out',880))
            rec.event('transcript_delta',speaker='Eva',text='Testfrage',provisional=True)
            await asyncio.sleep(.2);await rec.close('test_stop');await rec.close('idempotent')
            self.assertTrue(all(p.returncode is not None for p in rec.processes))
            for speaker,frequency,other in [('Eva',440,880),('LUKAS',880,440)]:
                path=Path(directory)/(speaker+'.wav')
                self.assertEqual(path.stat().st_mode & 0o777,0o600)
                with wave.open(str(path)) as wav:
                    self.assertEqual((wav.getframerate(),wav.getnchannels(),wav.getsampwidth()),(24000,1,2))
                    x=np.frombuffer(wav.readframes(wav.getnframes()),dtype='<i2').astype(float)
                def amp(hz):return abs(np.sum(x*np.exp(-2j*np.pi*hz*np.arange(len(x))/24000)))
                self.assertGreater(amp(frequency),amp(other)*100)
            events=[json.loads(line) for line in (Path(directory)/'transcript-draft.jsonl').read_text().splitlines()]
            self.assertEqual(events[-1]['kind'],'end');self.assertFalse(events[-1]['audio_error'])
            self.assertEqual(events[-2]['text'],'Testfrage')

if __name__=='__main__':unittest.main()
