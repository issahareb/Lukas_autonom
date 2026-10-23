"""Synthetic two-speaker storage/transcription test. No requests to Eva."""
import asyncio
import io
import json
from pathlib import Path
import re
import wave
import numpy as np
from audio import binary
from conversation_recording import ConversationRecording
from transcribe_recording import safe_transcribe, private_json

async def spoken(text):
    p=await asyncio.create_subprocess_exec('espeak-ng','-v','de','-s','145','--stdout',text,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
    raw,_=await p.communicate()
    if p.returncode:raise RuntimeError('Synthetic speech failed')
    with wave.open(io.BytesIO(raw)) as w:
        rate=w.getframerate();x=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(float)
    return np.interp(np.arange(int(len(x)*24000/rate))*rate/24000,np.arange(len(x)),x).astype('<i2').tobytes()

async def play(device,pcm):
    p=await asyncio.create_subprocess_exec(binary('pacat'),'--playback','--device='+device,'--raw','--format=s16le','--rate=24000','--channels=1','--latency-msec=20',stdin=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
    try:
        for i in range(0,len(pcm),960):p.stdin.write(pcm[i:i+960]);await p.stdin.drain();await asyncio.sleep(.02)
        p.stdin.close();await p.wait()
        if p.returncode:raise RuntimeError('Playback failed')
    finally:
        if p.returncode is None:p.kill();await p.wait()

async def run_test(root,consent):
    root=Path(root);rec=ConversationRecording(root,consent)
    try:
        await rec.start();await asyncio.sleep(.3)
        texts=[('Eva','Hallo Lukas. Was ist deine Aufgabe?'),('LUKAS','Ich bin ein KI-Agent und spreche nicht als Issa selbst. Ich erkläre seine Projekte.')]
        for speaker,text in texts:
            await play('eva_out' if speaker=='Eva' else 'lukas_out',await spoken(text));await asyncio.sleep(.85)
        # Interleaved speech and an intentionally cut sentence, without filling missing words.
        pcm=await spoken('Ich erkläre jetzt eine technische Eigenschaft und spreche diesen Satz weiter.')
        async def cut_answer():
            await play('lukas_out',pcm[:int(2.3*48000)])
            rec.event('interruption',speaker='LUKAS')
        task=asyncio.create_task(cut_answer())
        await asyncio.sleep(1.2)
        await play('eva_out',await spoken('Stopp. Bitte kurz antworten.'))
        await task;await asyncio.sleep(.3)
        await rec.close('synthetic_test_stop')
        rows=await safe_transcribe(root)
        if rows is None:raise RuntimeError('Transcription failed')
        alltext=' '.join(x['text'] for x in rows).lower()
        report={'synthetic':True,'real_interview_started':False,'recording_closed':True,
            'speakers':sorted(set(x['speaker'] for x in rows)),
            'overlap_marked':any(any('Überlappung' in f for f in x['flags']) for x in rows),
            'asr_expected_terms':{word:word in alltext for word in ['aufgabe','projekte','stopp']},
            'human_audio_review':False,'missing_words_invented_by_test':False}
        private_json(root/'test-report.json',report)
    except Exception as e:
        await rec.close('test_failure')
        private_json(root/'test-report.json',{'synthetic':True,'state':'failed','error_type':type(e).__name__})
