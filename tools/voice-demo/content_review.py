"""Conservative content-onset review: discard unsupported ASR word timestamps."""
import json
import re
from transcribe_recording import private_json

def review_content(root,metrics):
    rows=json.loads((root/'transcript.json').read_text())['utterances']
    questions=[r for r in rows if r['speaker']=='Eva']
    reviewed=[]
    filler=re.compile(r'^(?:einen moment|moment|gern|gerne|ja gerne|da schaue ich mal(?: nach)?|ich schaue (?:kurz )?nach|ich prüfe (?:das )?kurz)[.!?, ]*$',re.I)
    for i,m in enumerate(metrics):
        m.pop('question_end_to_content_asr_estimate_ms',None)
        result={'question':m['question'],'state':'needs_listening','content_ms':None}
        if len(questions)!=len(metrics):
            result['reason']='Question segmentation differs; no automatic alignment'
        else:
            q=questions[i];upper=questions[i+1]['start'] if i+1<len(questions) else float('inf')
            candidates=[r for r in rows if r['speaker']=='LUKAS' and q['end']-.15<=r['start']<upper]
            selected=next((r for r in candidates if not filler.fullmatch(r['text'].strip())),None)
            if selected and len(selected['text'].strip())>=12 and not any('Unterbrechung' in f for f in selected['flags']):
                # Same PCM track: subtraction cancels approximate recorder clock offset.
                # Browser onset already includes transport/playout; do not add those twice.
                prefix=selected['text'].split('.')[0].strip()
                mixed=any(prefix.lower().startswith(t) for t in ['einen moment','da schaue','ich schaue','ich prüfe','moment'])
                if not mixed and m.get('question_end_to_browser_mic_ms') is not None:
                    result.update(state='estimated_from_speech_regions',content_ms=round(m['question_end_to_browser_mic_ms']+1000*(selected['start']-candidates[0]['start']),1),
                        evidence_text=selected['text'],skipped_filler_regions=candidates.index(selected))
                    m['question_end_to_content_region_estimate_ms']=result['content_ms']
                else:result['reason']='Filler and answer in same region; listen to mark exact transition'
            else:result['reason']='Interrupted, absent or too short to validate substantive content'
        reviewed.append(result)
    private_json(root/'content-review.json',{'method':'Audio-region onset relative to measured browser microphone onset; skip standalone filler utterances using audio-derived transcript. ASR wording and region boundary require listening; no exact word timing claim. Raw whisper timestamps are not validated and must not be treated as measurements.','human_reviewed':False,'questions':reviewed})
    return reviewed
