"""Authenticated PC audio transport. Never loads or operates the Eva website."""
import argparse
import asyncio
import base64
import json
import os
import struct
import time
import wave
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

from aiohttp import web, WSMsgType
from worker import Worker, session_config
from transcribe_recording import private_json

RATE = 24000
SAMPLES = 480
BYTES = SAMPLES * 2
PACKET_BYTES = 4 + BYTES * 2


class PcRecording:
    """Two PCM tracks sharing the browser AudioContext sample clock."""
    def __init__(self, root):
        self.root = Path(root)
        self.closed = False
        self.samples = 0
        self.files = []
        self.waves = []
        self.events = None
        try:
            for speaker in ('Eva', 'LUKAS'):
                stream = os.fdopen(os.open(self.root / (speaker + '.wav'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb')
                self.files.append(stream)
                wav = wave.open(stream, 'wb')
                wav.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
                self.waves.append(wav)
            self.events = os.fdopen(os.open(self.root / 'transcript-draft.jsonl', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w')
            for speaker in ('Eva', 'LUKAS'):
                self.event('audio_start', speaker=speaker, elapsed=0, alignment='shared PC AudioContext sample clock')
            self.event('notice', text='PC-Test: Eva bezeichnet den gewählten Eingang, im Test den simulierten Gesprächspartner. LUKAS.wav ist die Browser-Renderausgabe vor dem Windows-Ausgabegerät; Empfang bei Eva ist nicht bewiesen.')
        except BaseException:
            for wav in self.waves: wav.close()
            for stream in self.files: stream.close()
            if self.events: self.events.close()
            raise

    def append(self, index, incoming, rendered):
        if self.closed or index != self.samples or self.samples + SAMPLES > RATE * 660:
            raise ValueError('Recording sequence or duration invalid')
        if len(incoming) != BYTES or len(rendered) != BYTES:
            raise ValueError('Recording frame invalid')
        for wav, pcm in zip(self.waves, (incoming, rendered)):
            wav.writeframes(pcm)  # Keep headers recoverable after a process restart.
        self.samples += SAMPLES

    def event(self, kind, **data):
        if self.events and not self.events.closed:
            self.events.write(json.dumps({'elapsed':round(self.samples / RATE, 3), 'kind':kind, **data}, ensure_ascii=False) + '\n')
            self.events.flush()

    def close(self, reason):
        if self.closed: return
        self.closed = True
        self.event('end', reason=reason, audio_error=reason not in ('pc_stop', 'duration_limit', 'silence_timeout', 'provider_closed'))
        for wav in self.waves: wav.close()
        for stream in self.files: stream.flush(); os.fsync(stream.fileno()); stream.close()
        self.events.close()
        private_json(self.root / 'pc-report.json', {'sample_rate':RATE, 'channels':1,
            'samples_per_track':self.samples, 'seconds':self.samples/RATE, 'reason':reason,
            'capture_point':'selected input and rendered browser output before Windows audio device',
            'eva_reception_verified':False, 'windows_routing_verified':False})
        p = self.root / 'README.txt'
        p.write_text('Privater PC-Audiotest\nEva.wav: gewählter PC-Eingang. LUKAS.wav: AudioWorklet-Renderausgabe vor dem Ausgabegerät.\n'
            'Beide Spuren nutzen denselben 24-kHz-Sampletakt. Physische Wiedergabe und Empfang beim Interviewpartner sind nicht bestätigt.\n'
            'Bei Verbindungsabbruch können letzte Frames fehlen. Automatische Texte sind ungeprüfte Entwürfe.\n'
            'Endgrund: ' + reason + '\n')
        p.chmod(0o600)


class BrowserAudio:
    def __init__(self, socket):
        self.socket = socket
        self.reader = asyncio.StreamReader(limit=BYTES * 100)
        self.capture = SimpleNamespace(stdout=self.reader)
        self.generation = 0
        self.closed = False

    async def write(self, pcm):
        if not self.closed:
            await asyncio.wait_for(self.socket.send_json({'type':'audio', 'generation':self.generation,
                'pcm':base64.b64encode(pcm).decode()}), 3)

    async def flush(self):
        self.generation += 1
        await asyncio.wait_for(self.socket.send_json({'type':'clear', 'generation':self.generation}), 3)

    async def close(self):
        if self.closed: return
        self.closed = True
        self.reader.feed_eof()
        if not self.socket.closed:
            try: await self.socket.send_json({'type':'clear', 'generation':self.generation + 1})
            except (ConnectionError, RuntimeError): pass


class PcSession(Worker):
    def __init__(self, context_path, root, socket, connector=None):
        args = argparse.Namespace(max_seconds=660, context=str(context_path), private_dir=str(root))
        super().__init__(args, **({'connector':connector} if connector else {}))
        self.socket = socket
        self.audio = BrowserAudio(socket)
        self.recording = PcRecording(root)
        self.frames = 0
        self.client_started = None
        self.status['mode'] = 'pc_test'

    async def client_input(self):
        # Continuous paired PCM frames double as a liveness signal.
        while not self.stop.is_set():
            message = await self.socket.receive(timeout=5)
            if message.type == WSMsgType.BINARY:
                packet = message.data
                if len(packet) != PACKET_BYTES: raise ValueError('Invalid audio frame size')
                index = struct.unpack('<I', packet[:4])[0]
                now = time.monotonic()
                if self.client_started is None: self.client_started = now
                if index / RATE > now - self.client_started + 2: raise ValueError('Audio rate exceeded')
                if len(self.audio.reader._buffer) > BYTES * 100: raise ValueError('Input backlog exceeded')
                incoming, rendered = packet[4:4+BYTES], packet[4+BYTES:]
                self.recording.append(index, incoming, rendered)
                self.audio.reader.feed_data(incoming)
                self.frames += 1
            elif message.type == WSMsgType.TEXT:
                event = json.loads(message.data)
                if event == {'type':'stop'}: self.halt('pc_stop'); return
                raise ValueError('Unsupported client command')
            else:
                self.halt('pc_connection_lost'); return

    async def run_pc(self):
        tasks = []
        try:
            self.context = Path(self.args.context).read_text()
            if len(self.context) > 30000: raise ValueError('Context too large')
            json.loads(self.context)
            key = os.environ.get('OPENAI_API_KEY', '')
            if not key: raise ValueError('OPENAI_API_KEY missing')
            base = os.getenv('OPENAI_BASE_URL', 'https://api.openai.com/v1').strip().strip('"\'').rstrip('/')
            parsed = urlsplit(base)
            if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError('Provider configuration invalid')
            headers = {'Authorization':'Bearer ' + key}
            if os.getenv('OPENAI_PROJECT_ID'): headers['OpenAI-Project'] = os.environ['OPENAI_PROJECT_ID'].strip()
            async with self.connector('wss://' + parsed.netloc + parsed.path + '/live/sessions',
                additional_headers=headers, open_timeout=20, ping_interval=10, ping_timeout=10,
                max_size=1_000_000, max_queue=16) as self.ws:
                tasks.append(asyncio.create_task(self.guarded(self.receive())))
                config = session_config(self.context)
                config['instructions'] += '\nDies ist ein technischer Test mit einem simulierten Interviewpartner. Keine echte Bewerbung wird ausgeführt.'
                await self.send({'type':'session.start', 'session':config})
                await asyncio.wait_for(self.started.wait(), 20)
                self.status['state'] = 'ready'
                await self.socket.send_json({'type':'ready', 'rate':RATE, 'max_seconds':660, 'mode':'test'})
                tasks += [asyncio.create_task(self.guarded(c)) for c in
                    (self.client_input(), self.capture(), self.play(), self.watchdog(), self.heartbeat())]
                await self.stop.wait()
                await self.audio.close()
                if not self.finalized.is_set():
                    try:
                        await self.send({'type':'session.close'})
                        await asyncio.wait_for(self.finalized.wait(), 15)
                    except Exception: self.status['provider_finalized'] = False
        except Exception as exc:
            self.status['error_type'] = type(exc).__name__
            self.halt('pc_startup_or_transport_failure')
        finally:
            for task in tasks: task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await self.audio.close()
            self.status['state'] = 'stopped'
            reason = self.status.get('reason', 'unknown')
            self.recording.close(reason)
            private_json(self.recording.root / 'pc-status.json', self.status)
            if not self.socket.closed:
                try: await self.socket.send_json({'type':'stopped', 'status':self.status})
                except (ConnectionError, RuntimeError): pass
                finally: await self.socket.close()

    async def heartbeat(self):
        while not self.stop.is_set():
            await self.socket.send_json({'type':'status','elapsed_seconds':round(time.monotonic()-self.created,1)})
            await asyncio.sleep(1)


async def pc_socket(request, operator):
    # Validate before upgrading; a ticket is single-use and never appears in a URL.
    if not operator.pc_ticket_valid(request): raise web.HTTPForbidden()
    async with operator.lock:
        if operator.pc_task and not operator.pc_task.done(): raise web.HTTPConflict(text='PC-Sitzung läuft bereits.')
        if operator.worker or operator.closed or (operator.test_task and not operator.test_task.done()):
            raise web.HTTPConflict(text='Andere Sitzung aktiv.')
        operator.pc_ticket = None
        socket = web.WebSocketResponse(max_msg_size=4096, heartbeat=5)
        await socket.prepare(request)
        try:
            root = operator.new_archive('pc-test')
            session = operator.pc_session = PcSession(operator.context_path, root, socket, operator.pc_connector)
            async def run_and_archive():
                try: await session.run_pc()
                finally:
                    if session.recording.samples:
                        operator.transcription_task=asyncio.create_task(operator.pc_transcribe(root))
                    else: private_json(root / 'transcription-status.json', {'state':'no_audio'})
            task = operator.pc_task = asyncio.create_task(run_and_archive())
        except Exception:
            await socket.close(code=1011, message=b'PC setup failed')
            return socket
    try: await asyncio.shield(task)
    except asyncio.CancelledError:
        # A dropped HTTP handler must not cancel provider closure or WAV finalization.
        session.halt('pc_connection_lost')
        raise
    return socket
