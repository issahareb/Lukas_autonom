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
  private gain: GainNode;
  constructor(private context: AudioContext) {
    this.gain = context.createGain();
    this.gain.gain.value = 0.7;
    this.gain.connect(context.destination);
  }
  format(codec: "PCMU" | "PCMA", streamId: string) {
    if (streamId !== this.streamId) { this.clear(); this.streamId = streamId; this.base = null; this.seen.clear(); }
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
    if (this.base === null) this.base = now + 0.18 - frame.timestamp / 1000;
    let at = this.base + frame.timestamp / 1000;
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
  private clear() {
    for (const s of this.sources) { s.onended = null; try { s.stop(); } catch {} s.disconnect(); }
    this.sources.clear();
  }
  close() { this.clear(); this.gain.disconnect(); void this.context.close().catch(() => {}); }
}
