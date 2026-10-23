"""Private PulseAudio streams. No files, loopbacks or hardware devices."""
import asyncio
import os
import shutil

RATE = 24000
FRAME = 960  # 20 ms, mono signed PCM16 little-endian

def binary(name):
    return shutil.which(name) or str(os.environ.get('PULSE_BIN', '/usr/bin')) + '/' + name

class Audio:
    def __init__(self):
        self.capture = self.player = None
        self.generation = 0

    async def start(self):
        self.capture = await asyncio.create_subprocess_exec(
            binary('parec'), '--device=eva_out.monitor', '--raw', '--format=s16le',
            '--rate=24000', '--channels=1', '--latency-msec=20',
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        await self.new_player()

    async def new_player(self):
        self.player = await asyncio.create_subprocess_exec(
            binary('pacat'), '--playback', '--device=lukas_out', '--raw', '--format=s16le',
            '--rate=24000', '--channels=1', '--latency-msec=20',
            stdin=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)

    async def flush(self):
        self.generation += 1
        await self.kill(self.player)
        await self.new_player()

    async def write(self, data):
        self.player.stdin.write(data)
        await self.player.stdin.drain()

    @staticmethod
    async def kill(proc):
        if proc and proc.returncode is None:
            try: proc.kill()
            except ProcessLookupError: pass
            await proc.wait()

    async def close(self):
        await self.kill(self.capture)
        await self.kill(self.player)
