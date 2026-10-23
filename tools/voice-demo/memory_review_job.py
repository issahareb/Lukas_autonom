"""One-shot read-only audit. Run in a separate service with no voice model."""
import json
import os
from urllib.parse import urlencode
from urllib.request import Request,urlopen

def main():
    key=os.environ.get('LUKAS_API_TOKEN')
    if not key: raise SystemExit('Missing LUKAS_API_TOKEN in audit service Variables')
    rows={};truncated=[]
    for term in ('CorporateLLM','EVERLAST','Bewerbung','Eva','issa-corporatellm-eva-demo-v1'):
        request=Request('https://lukas.issahareb.me/api/lukas/memories?'+urlencode({'search':term,'limit':200}),
                        headers={'Authorization':'Bearer '+key})
        try:
            with urlopen(request,timeout=20) as response: matches=json.load(response)
        except Exception as exc:
            print(json.dumps({'audit':'failed','error_type':type(exc).__name__,'writes':0}));return
        if not isinstance(matches,list): raise SystemExit('Unexpected memory response')
        if len(matches)==200:truncated.append(term)
        for item in matches: rows[str(item['id'])]=item
    report=[]
    for ident,item in rows.items():
        content=str(item.get('content',''));text=content.casefold()
        if not any(s in text for s in ('corporatellm','everlast','bewerbung')):continue
        report.append({'id':ident,'characters':len(content),'created_at':item.get('createdAt'),
            'mentions_eva':'eva' in text,
            'has_disclosure':any(s in text for s in ('ki-agent','nicht issa','ki agent')),
            'project_mentions':[s for s in ('lukas','taxibb','guardiangrid','portfolio','hareb digital') if s in text],
            'has_commit_evidence':'/blob/' in text,
            'canonical_demo_id':'issa-corporatellm-eva-demo-v1' in text})
    print('MEMORY_AUDIT '+json.dumps({'candidate_summaries':report,'possibly_truncated':truncated,'writes':0}))

if __name__=='__main__':main()
