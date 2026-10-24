"""Consent-gated private evidence. Transcript deltas are drafts, never verbatim proof."""
import asyncio
import json
import os
from pathlib import Path
import time
import wave
from audio import Audio, binary

class ConversationRecording:
    def __init__(self, directory, consent):
        if consent.get('recording_allowed') is not True:
            raise ValueError('Recording consent required')
        self.root = Path(directory)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.root.chmod(0o700)
        self.started = time.monotonic()
        self.processes = []
        self.tasks = []
        self.closed = False
        self.events = None
        self.reason = 'running'

    def private_file(self, name):
        fd = os.open(self.root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        return os.fdopen(fd, 'wb')

    async def start(self):
        self.events = self.private_file('transcript-draft.jsonl')
        self.event('notice', text='Automatische Rohtranskription. LUKAS-Text kann ungesprochene, unterbrochene Ausgabe enthalten. Audio ist die Prüfgrundlage.')
        try:
            for speaker, device in [('Eva', 'eva_out.monitor'), ('LUKAS', 'lukas_out.monitor')]:
                proc = await asyncio.create_subprocess_exec(binary('parec'), '--device='+device,
                    '--raw', '--format=s16le', '--rate=24000', '--channels=1', '--latency-msec=20',
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
                self.processes.append(proc)
                output = self.private_file(speaker+'.wav')
                wav = wave.open(output, 'wb')
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
                self.tasks.append(asyncio.create_task(self.pump(proc, wav, output, speaker)))
        except BaseException:
            await self.close('recording_start_failed')
            raise

    async def pump(self, proc, wav, output, speaker):
        first=True
        remaining = 24000 * 2 * 660
        try:
            while remaining:
                pcm = await proc.stdout.read(min(9600, remaining))
                if not pcm:
                    if not self.closed: raise RuntimeError('Recording stream ended')
                    return
                if first:
                    self.event('audio_start',speaker=speaker,elapsed=round(max(0,time.monotonic()-self.started-len(pcm)/48000),3),alignment='first PCM arrival minus block duration; approximate')
                    first=False
                wav.writeframesraw(pcm); remaining -= len(pcm)
            if not self.closed: raise RuntimeError('Recording limit reached')
        finally:
            wav.close(); output.close()

    def event(self, kind, **data):
        if self.events and not self.events.closed:
            row={'elapsed':round(time.monotonic()-self.started,3),'kind':kind,**data}
            self.events.write((json.dumps(row, ensure_ascii=False)+'\n').encode())
            self.events.flush()

    async def close(self, reason):
        if self.closed: return
        self.closed = True; self.reason = reason
        for proc in self.processes: await Audio.kill(proc)
        results = await asyncio.gather(*self.tasks, return_exceptions=True)
        failed = any(isinstance(x, BaseException) for x in results)
        self.event('end', reason=reason, audio_error=failed)
        if self.events: self.events.close()
        with self.private_file('README.txt') as f:
            f.write(('Private Gesprächsaufnahme\nEva.wav: Browserausgabe; LUKAS.wav: tatsächlich am virtuellen Ausgang ausgegebenes Audio.\n'
                'Startzeiten stehen in transcript-draft.jsonl. Beide Spuren können überlappen.\n'
                'Die Textdatei enthält vorläufige Erkennungsfragmente, kein geprüftes Wort-für-Wort-Transkript.\n'
                'Nicht übertragene oder nicht erkannte Wörter dürfen nicht ergänzt werden. Bei Abbrüchen kann die Aufnahme unvollständig sein.\n'
                'Aufnahmefehler: '+str(failed)+'\n').encode())
