"""Initialize only the private mount, then drop privileges before browser startup."""
import os
from pathlib import Path
from storage_paths import archive_mounted
root=Path('/data')
if not archive_mounted() and os.getenv('DEMO_ALLOW_LOCAL_STORAGE')!='1':
    raise SystemExit('Persistent volume missing')
root.mkdir(mode=0o700,exist_ok=True)
if os.getuid()==0:
    os.chown(root,10001,10001);root.chmod(0o700)
    os.setgroups([]);os.setgid(10001);os.setuid(10001)
# Restore the actual account environment after dropping Railway's root UID.
import pwd
account=pwd.getpwuid(os.getuid())
os.environ.update(HOME=account.pw_dir,USER=account.pw_name,LOGNAME=account.pw_name)
runtime=Path('/tmp/lukas-demo-user-runtime');runtime.mkdir(mode=0o700,exist_ok=True);runtime.chmod(0o700)
os.environ['XDG_RUNTIME_DIR']=str(runtime)
os.umask(0o077)
print('STORAGE_READY: private mount initialized; privileges dropped',flush=True)
os.execv('/usr/bin/tini',['tini','--','/app/operator-entrypoint.sh'])
