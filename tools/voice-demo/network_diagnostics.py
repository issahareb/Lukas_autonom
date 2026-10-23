"""Bounded, read-only network metadata; no bodies, cookies, tokens or WS frames."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

def safe_url(url):
    u=urlsplit(url);host=u.hostname or ''
    path=u.path
    if host=='challenges.cloudflare.com' and '/challenge-platform/' in path:
        path='/cdn-cgi/challenge-platform/[opaque-path-redacted]'
    else:
        path='/'.join('[redacted]' if len(p)>70 or '@' in p else p for p in path.split('/'))
    return f'{u.scheme}://{host}{path}'+('?REDACTED' if u.query else '')

class Diagnostics:
    def __init__(self,path):self.path=Path(path);self.rows=[]
    def record(self,kind,url='',**fields):
        if url and not any(x in (urlsplit(url).hostname or '') for x in ('corporatellm.de','cloudflare.com','elevenlabs.io')):return
        row={'utc':datetime.now(timezone.utc).isoformat(),'kind':kind,'url':safe_url(url) if url else '',**fields}
        self.rows.append(row);self.rows=self.rows[-600:]
        self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.path.write_text(json.dumps(self.rows,indent=2));self.path.chmod(0o600)
    async def response(self,r):
        if any(x in (urlsplit(r.url).hostname or '') for x in ('corporatellm.de','cloudflare.com','elevenlabs.io')):
            h=await r.all_headers()
            self.record('http',r.url,status=r.status,method=r.request.method,resource_type=r.request.resource_type,
                ray_id=h.get('cf-ray'),cf_mitigated=h.get('cf-mitigated'))
    async def attach(self,page):
        page.on('response',self.response)
        page.on('requestfailed',lambda r:self.record('request_failed',r.url,method=r.method,error=(r.failure or '')[:100]))
        # Console is filtered to a numerical Turnstile error code, never arbitrary page text.
        def console(msg):
            m=re.search(r'(?:Turnstile|turnstile).*?\b(\d{6})\b',msg.text)
            if m:self.record('turnstile_error',code=m.group(1))
        page.on('console',console)
        cdp=await page.context.new_cdp_session(page);await cdp.send('Network.enable')
        ws={}
        cdp.on('Network.webSocketCreated',lambda e:ws.update({e['requestId']:e['url']}))
        def handshake(e):
            r=e['response'];h={k.lower():str(v) for k,v in r.get('headers',{}).items()}
            self.record('websocket_handshake',ws.get(e['requestId'],''),status=r.get('status'),ray_id=h.get('cf-ray'))
        cdp.on('Network.webSocketHandshakeResponseReceived',handshake)
        cdp.on('Network.webSocketFrameError',lambda e:self.record('websocket_error',ws.get(e['requestId'],''),error='WebSocket frame error'))
