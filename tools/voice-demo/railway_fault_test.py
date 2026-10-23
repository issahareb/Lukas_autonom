"""Bounded real-provider transport-loss test, no interview and no recordings."""
import argparse
import asyncio
import json
import os
from pathlib import Path
from worker import Worker, GREETING

async def main():
    private=Path('/tmp/lukas-fault-test');private.mkdir(mode=0o700,exist_ok=True)
    context=private/'context.json'
    context.write_text(os.environ.pop('DEMO_CONTEXT_JSON'));context.chmod(0o600)
    args=argparse.Namespace(context=str(context),private_dir=str(private),
        port=8765,max_seconds=30)
    worker=Worker(args)
    task=asyncio.create_task(worker.run())
    try:
        for _ in range(400):
            if worker.status['state']=='ready' or task.done():break
            await asyncio.sleep(.05)
        if worker.status['state']!='ready':raise RuntimeError('Provider did not become ready')
        await worker.send({'type':'session.commentary.append','delegation_id':None,'content':GREETING})
        await asyncio.sleep(4)
        # Close the actual network transport, without fabricating server events.
        worker.ws.transport.abort()
        await asyncio.wait_for(task,25)
        checks={'real_provider_connected':worker.started.is_set(),
            'transport_loss_injected':True,'browser_closed':not worker.browser.is_connected(),
            'capture_stopped':worker.audio.capture.returncode is not None,
            'playback_stopped':worker.audio.player.returncode is not None,
            'provider_finalization_confirmed':worker.finalized.is_set(),
            'interview':'nicht gestartet','status':worker.status}
        print('REAL_FAULT_TEST '+json.dumps(checks),flush=True)
        if not all(checks[k] for k in ('real_provider_connected','browser_closed','capture_stopped','playback_stopped')):
            raise SystemExit(2)
    finally:
        if not task.done():worker.halt('test_cleanup');await task

if __name__=='__main__':asyncio.run(main())
