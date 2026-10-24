"""Post-test ASR estimate of content onset, never a verbatim/human-audit claim."""
import io
import json
import os
import re
import wave
import aiohttp
from transcribe_recording import private_json

async def measure_content(root,worker,recording):
    events=[json.loads(x) for x in (root/'transcript-draft.jsonl').read_text().splitlines()]
    offset=next(x['elapsed'] for x in events if x['kind']=='audio_start' and x['speaker']=='LUKAS')
    with wave.open(str(root/'LUKAS.wav')) as w:
        pcm=w.readframes(w.getnframes());rate=w.getframerate()
    base=os.getenv('OPENAI_BASE_URL','https://api.openai.com/v1').strip().strip('\"\'').rstrip('/')
    headers={'Authorization':'Bearer '+os.environ['OPENAI_API_KEY']}
    if os.getenv('OPENAI_PROJECT_ID'):headers['OpenAI-Project']=os.environ['OPENAI_PROJECT_ID'].strip()
    rows=[]
    async with aiohttp.ClientSession(headers=headers,timeout=aiohttp.ClientTimeout(total=60),trust_env=True) as client:
        for i,m in enumerate(worker.question_metrics):
            start=max(0,m['question_end_monotonic']-recording.started-offset)
            end=min(len(pcm)/(rate*2),start+25)
            if i+1<len(worker.question_metrics):
                following=worker.question_metrics[i+1]
                next_start=following['question_end_monotonic']-(following['browser_question_end_ms']-following['browser_question_start_ms'])/1000
                end=min(end,next_start-recording.started-offset)
            if end<=start:continue
            buf=io.BytesIO()
            with wave.open(buf,'wb') as w:
                w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(pcm[int(start*rate)*2:int(end*rate)*2])
            data=aiohttp.FormData()
            for k,v in [('model','whisper-1'),('language','de'),('response_format','verbose_json'),('timestamp_granularities[]','word')]:data.add_field(k,v)
            data.add_field('file',buf.getvalue(),filename='test.wav',content_type='audio/wav')
            async with client.post(base+'/audio/transcriptions',data=data,allow_redirects=False) as response:
                if response.status!=200:
                    rows.append({'question':m['question'],'state':'unavailable','http_status':response.status});continue
                result=await response.json()
            words=result.get('words',[])
            normalized=[re.sub(r'[^a-zäöüß]','',x.get('word','').lower()) for x in words]
            skip=0
            fillers=[['einen','moment'],['moment'],['gern'],['gerne'],['ja','gerne'],['ich','prüfe','das','kurz'],['ich','schaue','kurz','nach']]
            while True:
                matched=next((f for f in fillers if normalized[skip:skip+len(f)]==f),None)
                if not matched:break
                skip+=len(matched)
            row={'question':m['question'],'state':'estimated_needs_listening','words':words,'skipped_filler_words':skip}
            if skip<len(words):
                # Relative to recorded question end; monitor and word alignment are estimates.
                row['question_end_to_content_ms']=round(float(words[skip]['start'])*1000,1)
                m['question_end_to_content_asr_estimate_ms']=row['question_end_to_content_ms']
            rows.append(row)
    private_json(root/'content-timing.json',{'method':'whisper-1 word timestamps on actual LUKAS PCM, known filler prefixes excluded; approximate monitor alignment; NOT manually listened or exact word-onset proof','human_reviewed':False,'questions':rows})
