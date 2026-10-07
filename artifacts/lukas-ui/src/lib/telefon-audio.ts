type BrowserAudioSession = { type: string };
let wiedergaben = 0;
let wiederherstellen: (() => void) | undefined;

/** iOS otherwise treats Web Audio as ambient sound and the silent switch mutes it.
 * Acquire before creating/resuming the context, in the original tap handler.
 * Multiple calls share the browser's one audio session; do not reset it early. */
export function aktiviereTelefonWiedergabe(): () => void {
  if (wiedergaben++ === 0) {
    try {
      const session = (navigator as Navigator & { audioSession?: BrowserAudioSession }).audioSession;
      if (session && session.type !== "play-and-record") {
        const vorher = session.type;
        session.type = "playback";
        wiederherstellen = () => { if (session.type === "playback") session.type = vorher; };
      }
    } catch { /* Other browsers still use their normal AudioContext output. */ }
  }
  let freigegeben = false;
  return () => {
    if (freigegeben) return;
    freigegeben = true;
    if (--wiedergaben === 0) {
      try { wiederherstellen?.(); } catch { /* The browser may have ended its session. */ }
      wiederherstellen = undefined;
    }
  };
}

/** G.711 from Telnyx, decoded locally; no microphone or recording API involved. */
export function decodeTelefonAudio(payload: string, codec: "PCMU" | "PCMA"): Float32Array<ArrayBuffer> {
  const bytes = atob(payload), samples = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    let value = bytes.charCodeAt(i), sample: number;
    if (codec === "PCMU") {
      value = ~value & 255;
      sample = (((value & 15) << 3) + 132) << ((value >> 4) & 7);
      sample -= 132;
      if (value & 128) sample = -sample;
    } else {
      value ^= 0x55;
      const exponent = (value & 0x70) >> 4;
      sample = (value & 15) << 4;
      sample += exponent === 0 ? 8 : 264;
      if (exponent > 1) sample <<= exponent - 1;
      if (!(value & 128)) sample = -sample;
    }
    samples[i] = sample / 32768;
  }
  return samples;
}

export class TelefonAudio {
  private sources = new Set<AudioBufferSourceNode>();
  private seen = new Set<string>();
  private codec: "PCMU" | "PCMA" = "PCMU";
  private streamId = "";
  private base: number | null = null;
  private peak = 0;
  private lastFrame = -Infinity;
  private latestTimestamp = -Infinity;
  private gain: GainNode;
  constructor(private context: AudioContext) {
    this.gain = context.createGain();
    this.gain.gain.value = 0.7;
    this.gain.connect(context.destination);
  }
  format(codec: "PCMU" | "PCMA", streamId: string) {
    if (streamId !== this.streamId) { this.clear(); this.streamId = streamId; this.base = null; this.seen.clear(); this.latestTimestamp = -Infinity; }
    this.codec = codec;
  }
  play(frame: { streamId: string; track: string; chunk: number; timestamp: number; payload: string }) {
    if (frame.streamId !== this.streamId || this.context.state !== "running") return false;
    const key = `${frame.track}:${frame.chunk}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
    const samples = decodeTelefonAudio(frame.payload, this.codec);
    if (!samples.length) return false;
    const now = this.context.currentTime;
    this.peak = samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
    this.lastFrame = now;
    if (this.base === null) this.base = now + 0.18 - frame.timestamp / 1000;
    let at = this.base + frame.timestamp / 1000;
    // Both tracks share one stream clock. A delayed older frame must never
    // reset it and stop fresh audio already queued on either track.
    // Older frames arriving before their playout time remain valid.
    if (frame.timestamp < this.latestTimestamp && at < now) return false;
    this.latestTimestamp = Math.max(this.latestTimestamp, frame.timestamp);
    // Bound latency after a paused tab, reconnect, timestamp reset or network backlog.
    if (at < now - 0.2 || at > now + 1 || this.sources.size > 100) {
      this.clear(); this.base = now + 0.18 - frame.timestamp / 1000; at = now + 0.18;
    }
    if (at + samples.length / 8000 < now) return false;
    const buffer = this.context.createBuffer(1, samples.length, 8000);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer; source.connect(this.gain);
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    source.start(Math.max(now, at));
    return true;
  }
  mute(active: boolean) { this.gain.gain.value = active ? 0 : 0.7; }
  pegel() { return this.context.currentTime - this.lastFrame < 0.5 ? this.peak : 0; }
  private clear() {
    for (const s of this.sources) { s.onended = null; try { s.stop(); } catch {} s.disconnect(); }
    this.sources.clear();
  }
  close() { this.clear(); this.gain.disconnect(); void this.context.close().catch(() => {}); }
}
