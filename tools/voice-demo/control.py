"""Read status or stop without exposing the local control token in arguments."""
import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen
p=argparse.ArgumentParser()
p.add_argument('action',choices=['status','stop'])
p.add_argument('--private-dir',required=True)
p.add_argument('--port',type=int,default=8765)
a=p.parse_args()
token=Path(a.private_dir,'control.token').read_text()
r=Request(f'http://127.0.0.1:{a.port}/{a.action}',method='POST' if a.action=='stop' else 'GET',
          headers={'Authorization':'Bearer '+token})
with urlopen(r,timeout=3) as response: print(response.read().decode())
