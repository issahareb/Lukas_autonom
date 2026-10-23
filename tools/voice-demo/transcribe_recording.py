"""Transcribe actual isolated audio, align utterances to PCM, never invent missing words."""
import asyncio
import hashlib
import io
import json
import os
from pathlib import Path
import re
import wave
from urllib.parse import urlsplit
import aiohttp
import numpy as np

RATE=24000

def regions(pcm):
    x=np.frombuffer(pcm,dtype='<i2').astype(float)
    width=480
    rms=[float(np.sqrt(np.mean(x[i:i+width]**2))) for i in range(0,len(x),width)]
    spans=[];start=None;last=None
    for i,v in enumerate(rms):
        if v>60:
            if start is None:start=max(0,i*.02-.12)
            last=min(len(x)/RATE,(i+1)*.02+.12)
        if start is not None and (i*.02-last>.65 or i*.02-start>=25):
            spans.append((start,last));start=last=None
    if start is not None:spans.append((start,last))
    return spans

def clock(t):
    return f'{int(t//60):02d}:{t%60:06.3f}'

def private_json(path,data):
    temp=path.with_suffix(path.suffix+'.tmp')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:json.dump(data,f,ensure_ascii=False,indent=2);f.flush();os.fsync(f.fileno())
    temp.replace(path)

async def transcribe(root):
    root=Path(root)
    private_json(root/'transcription-status.json',{'state':'running'})
    base=os.getenv('OPENAI_BASE_URL','https://api.openai.com/v1').strip().strip('\"\'').rstrip('/')
    u=urlsplit(base)
    if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment:raise ValueError('Provider URL invalid')
    headers={'Authorization':'Bearer '+os.environ['OPENAI_API_KEY']}
    if os.getenv('OPENAI_PROJECT_ID'):headers['OpenAI-Project']=os.environ['OPENAI_PROJECT_ID'].strip()
    events=[json.loads(x) for x in (root/'transcript-draft.jsonl').read_text().splitlines()]
    offsets={e['speaker']:e['elapsed'] for e in events if e['kind']=='audio_start'}
    interruptions=[e['elapsed'] for e in events if e['kind']=='interruption']
    rows=[];hashes={};calls=0
    async with aiohttp.ClientSession(headers=headers,timeout=aiohttp.ClientTimeout(total=90),trust_env=True) as client:
        for speaker in ('Eva','LUKAS'):
            source=root/(speaker+'.wav');hashes[speaker]=hashlib.sha256(source.read_bytes()).hexdigest()
            with wave.open(str(source)) as w:
                if (w.getframerate(),w.getnchannels(),w.getsampwidth())!=(RATE,1,2):raise ValueError('Recording format')
                pcm=w.readframes(w.getnframes())
            spans=regions(pcm)
            for start,end in spans:
                calls+=1
                if calls>160:raise ValueError('Transcription request budget exceeded')
                buf=io.BytesIO()
                with wave.open(buf,'wb') as w:
                    w.setnchannels(1);w.setsampwidth(2);w.setframerate(RATE)
                    w.writeframes(pcm[int(start*RATE)*2:int(end*RATE)*2])
                data=aiohttp.FormData();data.add_field('model','gpt-transcribe');data.add_field('language','de')
                data.add_field('file',buf.getvalue(),filename='audio.wav',content_type='audio/wav')
                async with client.post(base+'/audio/transcriptions',data=data,allow_redirects=False) as response:
                    if response.status!=200:raise RuntimeError('Transcription HTTP '+str(response.status))
                    result=await response.json()
                text=str(result.get('text','')).strip()
                rows.append({'speaker':speaker,'start':round(start+offsets[speaker],3),'end':round(end+offsets[speaker],3),
                    'text':text or '[unverständlich]','flags':[],'audio_source':speaker+'.wav'})
    rows.sort(key=lambda r:(r['start'],r['speaker']))
    for row in rows:
        if any(other['speaker']!=row['speaker'] and max(other['start'],row['start'])<min(other['end'],row['end']) for other in rows):row['flags'].append('Überlappung; Zeitfenster anhand Tonspur')
        if row['speaker']=='LUKAS' and any(row['start']<=t<=row['end']+.4 for t in interruptions):row['flags'].append('Unterbrechung erkannt; Wortende prüfen')
        if row['end']-row['start']>=24:row['flags'].append('Technische Segmentgrenze; Fortsetzung möglich')
    metadata={'state':'audio_aligned_draft','model':'gpt-transcribe','audio_sha256':hashes,'requests':calls,
        'human_reviewed':False,'timestamp_precision':'PCM-Sprachfenster, keine Wortzeitstempel; Monitorstart ist näherungsweise synchron',
        'note':'Automatisch aus beiden Tonspuren erkannt. Unsichere Wörter und abgebrochene Wortenden müssen durch Anhören geprüft werden. Kein Vollständigkeitsnachweis.'}
    private_json(root/'transcript.json',{'metadata':metadata,'utterances':rows})
    lines=['EVA / LUKAS – CHRONOLOGISCHES TRANSKRIPT','Automatischer Audioabgleich; noch nicht manuell geprüft. Zeitangaben beziehen sich auf Aufnahmebeginn.','']
    for row in rows:lines.append(f"[{clock(row['start'])}–{clock(row['end'])}] {row['speaker']}: {row['text']}"+(' ['+'; '.join(row['flags'])+']' if row['flags'] else ''))
    path=root/'transcript.txt';path.write_text('\n'.join(lines)+'\n');path.chmod(0o600)
    private_json(root/'transcription-status.json',metadata)
    return rows

async def safe_transcribe(root):
    try:return await asyncio.wait_for(transcribe(root),900)
    except Exception as e:
        private_json(Path(root)/'transcription-status.json',{'state':'failed','error_type':type(e).__name__})
        return None
