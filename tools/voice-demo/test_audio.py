"""Actual Chromium/PulseAudio integration test; no remote API or interview."""
import asyncio
import json
import os
from pathlib import Path
import time
import numpy as np
from playwright.async_api import async_playwright
from audio import Audio, FRAME
from worker import browser_env

async def main():
    async def serve(reader,writer):
        await reader.read(8192)
        body=Path(__file__).with_name('fixture.html').read_bytes()
        writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n'+body)
        await writer.drain();writer.close()
    server=await asyncio.start_server(serve,'127.0.0.1',8876)
    audio=Audio(); frames=[]; received=[]
    async def collect():
        while True:
            b=await audio.capture.stdout.readexactly(FRAME)
            frames.append(b); received.append(time.monotonic())
    async def tone(hz,seconds):
        data=(np.sin(2*np.pi*hz*np.arange(int(24000*seconds))/24000)*6000).astype('<i2').tobytes()
        for i in range(0,len(data),FRAME):
            await audio.write(data[i:i+FRAME]);await asyncio.sleep(.02)
    def amplitude(pcm,hz):
        x=np.frombuffer(pcm,dtype='<i2').astype(float)
        return float(abs(np.sum(x*np.exp(-2j*np.pi*hz*np.arange(len(x))/24000)))/len(x)*2)
    report={}
    try:
        await audio.start();collector=asyncio.create_task(collect())
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
                env=browser_env(),ignore_default_args=['--mute-audio'],
                args=['--autoplay-policy=no-user-gesture-required','--disable-dev-shm-usage'])
            ctx=await browser.new_context(permissions=['microphone'])
            page=await ctx.new_page();await page.goto('http://127.0.0.1:8876')
            await page.evaluate('start()');await asyncio.sleep(.6)
            # No browser fake-audio flags: actual Pulse devices are used.
            print('devices',await page.evaluate('async()=> (await navigator.mediaDevices.enumerateDevices()).map(x=>({kind:x.kind,label:x.label}))'))
            start_idx=len(frames);t=time.monotonic()
            await page.evaluate('tone(440,1200)');await asyncio.sleep(1.5)
            signal=[i for i,b in enumerate(frames[start_idx:],start_idx)
                    if np.max(np.abs(np.frombuffer(b,dtype='<i2').astype(float)))>500]
            assert signal,'Browser output not reaching Eva monitor'
            latency=(received[signal[0]]-t)*1000
            report['eva_to_lukas_first_signal_ms']=round(latency,1)
            amp=amplitude(b''.join(frames[signal[0]+3:signal[0]+25]),440)
            assert amp>1000,amp
            report['eva_440hz_amplitude']=round(amp,1)
            # Simultaneous different tones prove channel separation.
            begin=len(frames)
            await page.evaluate('tone(440,1600)')
            player=asyncio.create_task(tone(880,1.6))
            t=time.monotonic();mic_detected=None
            for _ in range(60):
                spec=await page.evaluate('spectrum()')
                if abs(spec['hz']-880)<30 and spec['db']>-40:
                    mic_detected=time.monotonic();break
                await asyncio.sleep(.02)
            assert mic_detected,'LUKAS playback did not reach browser microphone'
            report['lukas_to_browser_first_signal_ms']=round((mic_detected-t)*1000,1)
            await player;await asyncio.sleep(.3)
            pcm=b''.join(frames[begin+20:begin+55])
            wanted=amplitude(pcm,440);leak=amplitude(pcm,880)
            report['self_audio_leakage_db']=round(20*np.log10(max(leak,1e-9)/wanted),1)
            assert leak/wanted<.01,(leak,wanted)
            report['browser_mic_peak_hz']=spec['hz']
            # Interrupt a deliberately buffered output and measure residual mic audio.
            await audio.write((np.sin(2*np.pi*880*np.arange(12000)/24000)*6000).astype('<i2').tobytes())
            await asyncio.sleep(.12)
            t=time.monotonic();await audio.flush()
            for _ in range(70):
                spec=await page.evaluate('spectrum()')
                if spec['db'] is None or spec['db'] < -65: break
                await asyncio.sleep(.02)
            report['flush_to_mic_silence_ms']=round((time.monotonic()-t)*1000,1)
            assert spec['db'] is None or spec['db'] < -65,spec
            await page.evaluate('stop()')
            assert await page.evaluate('mic.getTracks().every(t=>t.readyState==="ended")')
            await audio.close()
            assert audio.capture.returncode is not None and audio.player.returncode is not None
            await browser.close()
            report.update(audio_bidirectional=True,channel_separation=True,flush=True,stop=True,
                          real_voice_test=False,interview='nicht gestartet')
        collector.cancel();await asyncio.gather(collector,return_exceptions=True)
    finally:
        await audio.close();server.close();await server.wait_closed()
    destination=Path(os.environ.get('DEMO_REPORT','/workspace/demo-private/audio-test.json'))
    destination.write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

if __name__=='__main__': asyncio.run(main())
