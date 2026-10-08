/**
 * Content-free observation of reflected Live output. Arrival/timeline gaps are
 * not proof of audible pauses or PSTN packet loss. PCM is inspected transiently
 * for the startup guard, then discarded; only counters and timings are retained.
 */
export class LiveOutputAudio {
  private events = 0;
  private eventsWithSignal = 0;
  private invalidEvents = 0;
  private timedEvents = 0;
  private untimedEvents = 0;
  private invalidTimingEvents = 0;
  private outOfOrderEvents = 0;
  private observedDurationMs = 0;
  private timelineGaps = 0;
  private maxTimelineGapMs = 0;
  private maxArrivalGapMs = 0;
  private segments = 0;
  private lastEndMs?: number;
  private lastArrivalMs?: number;

  resetContinuity(): void {
    this.lastEndMs = undefined;
    this.lastArrivalMs = undefined;
    this.segments++;
  }

  observe(event: Record<string, unknown>, now = Date.now()): boolean {
    const encoded = event.delta;
    if (typeof encoded !== "string" || !encoded || encoded.length > 1_000_000 ||
      encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      this.invalidEvents++; return false;
    }
    const pcm = Buffer.from(encoded, "base64");
    if (!pcm.length || pcm.length % 2 !== 0 || pcm.toString("base64") !== encoded) {
      this.invalidEvents++; return false;
    }
    this.events++;
    // Any nonzero PCM sample is output activity. No invented VAD threshold.
    const signal = pcm.some(byte => byte !== 0);
    if (signal) this.eventsWithSignal++;
    if (this.lastArrivalMs !== undefined) this.maxArrivalGapMs = Math.max(this.maxArrivalGapMs, Math.max(0, now - this.lastArrivalMs));
    this.lastArrivalMs = now;
    const { start_ms: start, end_ms: end } = event;
    if (start === undefined && end === undefined) {
      this.untimedEvents++; return signal;
    }
    if (typeof start !== "number" || typeof end !== "number" ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 86_400_000) {
      this.invalidTimingEvents++; return signal;
    }
    this.timedEvents++;
    if (this.lastEndMs !== undefined && end <= this.lastEndMs) {
      this.outOfOrderEvents++; return signal;
    }
    if (this.lastEndMs !== undefined && start > this.lastEndMs) {
      this.timelineGaps++;
      this.maxTimelineGapMs = Math.max(this.maxTimelineGapMs, start - this.lastEndMs);
    }
    this.observedDurationMs += end - Math.max(start, this.lastEndMs ?? start);
    this.lastEndMs = end;
    return signal;
  }

  summary() {
    return {
      events: this.events, eventsWithSignal: this.eventsWithSignal,
      invalidEvents: this.invalidEvents, timedEvents: this.timedEvents,
      untimedEvents: this.untimedEvents, invalidTimingEvents: this.invalidTimingEvents,
      outOfOrderEvents: this.outOfOrderEvents, observedDurationMs: this.observedDurationMs,
      timelineGaps: this.timelineGaps, maxTimelineGapMs: this.maxTimelineGapMs,
      maxArrivalGapMs: this.maxArrivalGapMs, segments: this.segments,
    };
  }
}
