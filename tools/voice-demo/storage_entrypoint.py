"""Initialize only the private mount, then drop privileges before browser startup."""
import os
from pathlib import Path
root=Path('/data')
if not os.path.ismount(root) and os.getenv('DEMO_ALLOW_LOCAL_STORAGE')!='1':
    raise SystemExit('Persistent volume missing')
root.mkdir(mode=0o700,exist_ok=True)
if os.getuid()==0:
    os.chown(root,10001,10001);root.chmod(0o700)
    os.setgroups([]);os.setgid(10001);os.setuid(10001)
os.umask(0o077)
os.execv('/usr/bin/tini',['tini','--','/app/operator-entrypoint.sh'])
