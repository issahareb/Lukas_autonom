import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSprachsitzung } from "./use-sprachsitzung";
class Track extends EventTarget { enabled = true; stop = vi.fn(); }
class Stream {
  track = new Track();
  getTracks() { return [this.track]; }
  getAudioTracks() { return [this.track]; }
}
class Channel extends EventTarget {
  readyState = "connecting"; send = vi.fn();
  close = vi.fn(() => { this.readyState = "closed"; this.dispatchEvent(new Event("close")); });
  emit(event: object) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) })); }
}
class Peer extends EventTarget {
  static all: Peer[] = [];
  channel = new Channel(); connectionState = "new"; iceGatheringState = "complete";
  localDescription: RTCSessionDescriptionInit | null = null;
  addTrack = vi.fn(); createDataChannel = vi.fn(() => this.channel);
  createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: "offer-sdp" }));
  setLocalDescription = vi.fn(async (offer: RTCSessionDescriptionInit) => { this.localDescription = offer; });
  setRemoteDescription = vi.fn(async (_answer: RTCSessionDescriptionInit) => {});
  close = vi.fn(() => { this.connectionState = "closed"; });
  constructor() { super(); Peer.all.push(this); }
  state(value: string) { this.connectionState = value; this.dispatchEvent(new Event("connectionstatechange")); }
  remote(stream: Stream) { this.dispatchEvent(Object.assign(new Event("track"), { streams: [stream], track: stream.track })); }
}
let level = 128;
class AudioMeter {
  state = "running"; close = vi.fn(async () => {}); resume = vi.fn(async () => {});
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createAnalyser() { return { fftSize: 512, getByteTimeDomainData: (data: Uint8Array) => data.fill(level) }; }
}
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
let mic: Stream, getUserMedia: ReturnType<typeof vi.fn>, request: ReturnType<typeof vi.fn>;
const answer = (id = "session-1") => ({
  ok: true, json: async () => ({ sdp: "answer-sdp", sessionId: id, closeToken: "close-" + id, model: "gpt-live-1", voice: "cedar" }),
});
const latest = () => Peer.all[Peer.all.length - 1];
function ready(peer = latest()) { act(() => { peer.channel.readyState = "open"; peer.channel.emit({ type: "session.started" }); }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve };
}
async function flush() { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); }
beforeEach(() => {
  vi.useFakeTimers(); Peer.all = []; level = 128; mic = new Stream(); localStorage.clear();
  getUserMedia = vi.fn().mockResolvedValue(mic);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  request = vi.fn().mockResolvedValue(answer());
  vi.stubGlobal("fetch", request); vi.stubGlobal("RTCPeerConnection", Peer);
  vi.stubGlobal("MediaStream", Stream); vi.stubGlobal("AudioContext", AudioMeter);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});
describe("GPT Live Sprachsitzung", () => {
  it("tauscht SDP über die authentifizierte API und wartet auf session.started", async () => {
    localStorage.setItem("lukas_token", "owner-token");
    const { result } = renderHook(() => useSprachsitzung());
    await act(async () => { await result.current.starten(); });
    expect(request).toHaveBeenCalledWith("/api/lukas/live-session", expect.objectContaining({
      method: "POST", credentials: "same-origin", body: JSON.stringify({ sdp: "offer-sdp" }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer owner-token" },
    }));
    expect(latest().setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer-sdp" });
    expect(latest().createDataChannel).toHaveBeenCalledWith("oai-events");
    expect(result.current.status).toBe("verbindet");
    act(() => { latest().channel.readyState = "open"; latest().channel.dispatchEvent(new Event("open")); });
    expect(result.current.status).toBe("verbindet"); ready(); expect(result.current.status).toBe("hoert");
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  });
  it("misst Ausgabeaktivität und hält das Mikro beim Sprechen offen", async () => {
    const { result } = renderHook(() => useSprachsitzung());
    await act(async () => { await result.current.starten(); }); ready();
    await act(async () => { latest().remote(new Stream()); }); level = 140;
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.status).toBe("spricht"); expect(mic.track.enabled).toBe(true);
    level = 128; act(() => { vi.advanceTimersByTime(400); });
    expect(result.current.status).toBe("hoert"); expect(mic.track.enabled).toBe(true);
    expect(latest().channel.send).not.toHaveBeenCalled();
  });
  it("verarbeitet überlappende Fragmente ohne Duplikate", async () => {
    const { result } = renderHook(() => useSprachsitzung());
    await act(async () => { await result.current.starten(); }); ready();
    const delta = (role: "input" | "output", id: string, text: string, start: number, end: number) => ({
      type: "session." + role + "_transcript.delta", event_id: id, delta: text, start_ms: start, end_ms: end,
    });
    const duplicate = delta("input", "u2", " Lukas", 400, 600);
    act(() => {
      latest().channel.emit(delta("input", "u1", "Hallo", 0, 300));
      latest().channel.emit(delta("output", "a1", "Hi", 200, 400));
      latest().channel.emit(duplicate); latest().channel.emit(duplicate);
      latest().channel.emit(delta("output", "a2", " Issa", 450, 700));
      latest().channel.emit(delta("input", "u3", "Neue Frage", 3000, 3500));
    });
    expect(result.current.zeilen).toEqual([
      { role: "user", text: "Hallo Lukas" }, { role: "assistant", text: "Hi Issa" }, { role: "user", text: "Neue Frage" },
    ]);
  });
  it("beendet Audio und schließt über Datachannel und HTTP", async () => {
    const { result } = renderHook(() => useSprachsitzung());
    await act(async () => { await result.current.starten(); }); ready(); const peer = latest();
    act(() => { result.current.beenden(); result.current.beenden(); });
    expect(result.current.status).toBe("aus"); expect(mic.track.stop).toHaveBeenCalledTimes(1);
    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(peer.channel.send).toHaveBeenCalledWith(JSON.stringify({ type: "session.close" }));
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("/close"))).toHaveLength(1);
    expect(request).toHaveBeenCalledWith("/api/lukas/live-session/session-1/close", expect.objectContaining({
      keepalive: true, body: JSON.stringify({ closeToken: "close-session-1" }),
    }));
    expect(document.querySelector("audio")).toBeNull();
  });
  it("gibt das Mikro bei Serverfehler wieder frei", async () => {
    request.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: "Kein Live-Zugriff" }) });
    const { result } = renderHook(() => useSprachsitzung());
    await act(async () => { await result.current.starten(); });
    expect(result.current.status).toBe("fehler"); expect(result.current.fehler).toBe("Kein Live-Zugriff");
    expect(mic.track.stop).toHaveBeenCalledTimes(1); expect(latest().close).toHaveBeenCalledTimes(1);
    expect(document.querySelector("audio")).toBeNull();
  });
  it("aktiviert nach Abbruch keine verspätet genehmigte Mikrofonspur", async () => {
    const pending = deferred<Stream>(); getUserMedia.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useSprachsitzung()); let start!: Promise<void>;
    act(() => { start = result.current.starten(); result.current.beenden(); });
    await act(async () => { pending.resolve(mic); await start; });
    expect(mic.track.stop).toHaveBeenCalledTimes(1); expect(request).not.toHaveBeenCalled();
    expect(Peer.all).toHaveLength(0); expect(result.current.status).toBe("aus");
  });
  it("schließt späte Serversitzungen ohne den neuen Lauf anzufassen", async () => {
    const pending = deferred<ReturnType<typeof answer>>(); request.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useSprachsitzung()); let first!: Promise<void>;
    act(() => { first = result.current.starten(); }); await flush(); expect(request).toHaveBeenCalledTimes(1);
    const oldPeer = latest(); act(() => { result.current.beenden(); });
    const newMic = new Stream(); getUserMedia.mockResolvedValueOnce(newMic);
    request.mockResolvedValueOnce(answer("session-new"));
    await act(async () => { await result.current.starten(); }); ready(); const newPeer = latest();
    await act(async () => { pending.resolve(answer("session-old")); await first; });
    expect(oldPeer.setRemoteDescription).not.toHaveBeenCalled(); expect(newPeer.close).not.toHaveBeenCalled();
    expect(newMic.track.stop).not.toHaveBeenCalled(); expect(result.current.status).toBe("hoert");
    expect(request).toHaveBeenCalledWith("/api/lukas/live-session/session-old/close", expect.anything());
  });
  it("räumt beim Verlassen auf und ignoriert späte Ereignisse", async () => {
    const { result, unmount } = renderHook(() => useSprachsitzung());
    await act(async () => { await result.current.starten(); }); ready(); const peer = latest(); unmount();
    act(() => { peer.channel.emit({ type: "session.started" }); peer.remote(new Stream()); });
    expect(peer.close).toHaveBeenCalledTimes(1); expect(mic.track.stop).toHaveBeenCalledTimes(1);
    expect(document.querySelector("audio")).toBeNull();
  });
  it("übersteht kurze Netzaussetzer und beendet dauerhaften Verlust", async () => {
    const { result } = renderHook(() => useSprachsitzung());
    await act(async () => { await result.current.starten(); }); ready();
    act(() => { latest().state("disconnected"); vi.advanceTimersByTime(3000); latest().state("connected"); vi.advanceTimersByTime(3000); });
    expect(result.current.status).toBe("hoert");
    act(() => { latest().state("disconnected"); vi.advanceTimersByTime(5000); });
    expect(result.current.status).toBe("fehler"); expect(mic.track.stop).toHaveBeenCalledTimes(1);
  });
  it("begrenzt den Aufbau ohne Live-Startbestätigung", async () => {
    const { result } = renderHook(() => useSprachsitzung());
    await act(async () => { await result.current.starten(); });
    act(() => { vi.advanceTimersByTime(45_000); });
    expect(result.current.status).toBe("fehler"); expect(mic.track.stop).toHaveBeenCalledTimes(1);
    expect(latest().channel.send).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("/api/lukas/live-session/session-1/close", expect.anything());
  });
});
