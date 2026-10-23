"""Read-only duplicate/partial briefing search. Never creates a memory."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

p=argparse.ArgumentParser()
p.add_argument('--private-dir',required=True)
a=p.parse_args()
private=Path(a.private_dir)
if private.stat().st_mode & 0o077: raise SystemExit('Private directory must have mode 700')
key=os.environ.get('LUKAS_API_TOKEN')
if not key: raise SystemExit('LUKAS_API_TOKEN fehlt; keine Suche oder Speicherung durchgeführt.')
rows={};truncated=[]
for term in ('CorporateLLM','EVERLAST','Bewerbung','Eva','issa-corporatellm-eva-demo-v1'):
    url='https://lukas.issahareb.me/api/lukas/memories?'+urlencode({'search':term,'limit':200})
    req=Request(url,headers={'Authorization':'Bearer '+key})
    try:
        with urlopen(req,timeout=20) as r: matches=json.load(r)
    except Exception:
        raise SystemExit('Gedächtnissuche fehlgeschlagen; kein Eintrag angelegt.')
    if not isinstance(matches,list): raise SystemExit('Unerwartete Antwort; kein Eintrag angelegt.')
    if len(matches)==200: truncated.append(term)
    for row in matches: rows[str(row['id'])]=row
out=private/'memory-candidates.json'
out.write_text(json.dumps({'candidates':list(rows.values()),'possibly_truncated_searches':truncated},ensure_ascii=False,indent=2))
out.chmod(0o600)
print(json.dumps({'candidate_count':len(rows),'possibly_truncated':bool(truncated),'written_to_lukas':False}))
