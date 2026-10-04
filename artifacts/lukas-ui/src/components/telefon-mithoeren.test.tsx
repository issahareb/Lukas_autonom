import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { LiveMithoeren } from "./telefon-mithoeren";
import { aktiviereTelefonWiedergabe, decodeTelefonAudio, TelefonAudio } from "@/lib/telefon-audio";

function audioFixture() {
  const order: string[] = [], sources: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  class Context {
    currentTime = 10; state = "suspended"; sampleRate = 48000; destination = {}; onstatechange = null;
    resume = vi.fn(async () => { order.push("resume"); this.state = "running"; });
    close = vi.fn(async () => { this.state = "closed"; });
    createGain = () => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() });
    createBuffer = (_channels: number, length: number, rate: number) => ({ length, sampleRate: rate, copyToChannel: vi.fn() });
    createBufferSource = () => {
      const source = { buffer: null, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), onended: null };
      sources.push(source); return source;
    };
  }
  vi.stubGlobal("AudioContext", Context);
  return { order, sources, Context };
}
it("decodes known G.711 samples and mixes both tracks on the same timeline without duplicates", async () => {
  expect(Array.from(decodeTelefonAudio(btoa(String.fromCharCode(255, 127, 0, 128)), "PCMU"))).toEqual([0, -0, -32124 / 32768, 32124 / 32768]);
  expect(Array.from(decodeTelefonAudio(btoa(String.fromCharCode(213, 85, 170, 42)), "PCMA"))).toEqual([8 / 32768, -8 / 32768, 32256 / 32768, -32256 / 32768]);
  const { Context, sources } = audioFixture(); const context = new Context(); await context.resume();
  const player = new TelefonAudio(context as unknown as AudioContext);
  player.format("PCMU", "stream");
  const frame = { streamId: "stream", track: "inbound", chunk: 1, timestamp: 200, payload: btoa("\xff".repeat(160)) };
  player.play(frame); player.play({ ...frame, track: "outbound" }); player.play(frame);
  expect(player.pegel()).toBe(0);
  expect(sources).toHaveLength(2);
  expect(sources[0].start.mock.calls[0][0]).toBeCloseTo(10.18);
  expect(sources[0].start.mock.calls).toEqual(sources[1].start.mock.calls);
  player.close(); expect(sources.every(s => s.stop.mock.calls.length === 1)).toBe(true); expect(context.close).toHaveBeenCalled();
});
it("unlocks iPhone audio on tap, uses bearer auth, receives audio and stops without hanging up the call", async () => {
  const { order, sources } = audioFixture();
  let sessionType = "auto";
  const audioSession = { get type() { return sessionType; }, set type(value) { sessionType = value; order.push(value); } };
  Object.defineProperty(navigator, "audioSession", { configurable: true, value: audioSession });
  localStorage.setItem("lukas_token", "test-owner");
  let socket: { onmessage?: (event: { data: string }) => void; onclose?: () => void; close: ReturnType<typeof vi.fn> };
  vi.stubGlobal("WebSocket", class {
    onmessage?: (event: { data: string }) => void; onclose?: () => void;
    close = vi.fn(() => this.onclose?.());
    constructor(public url: URL) { socket = this; }
  });
  const requests: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    order.push("fetch"); requests.push({ url, init });
    return Response.json({ ticket: "one-use-ticket" });
  });
  render(<LiveMithoeren id={9} aktiv zustimmung />);
  expect(requests).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Live mithören" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(order).toEqual(["playback", "resume", "fetch"]);
  expect(requests[0].url).toBe("/api/lukas/telefon/anrufe/9/live-ticket");
  expect(requests[0].init.headers).toEqual({ Authorization: "Bearer test-owner" });
  const emit = (data: unknown) => socket.onmessage?.({ data: JSON.stringify(data) });
  await act(async () => {
    emit({ type: "format", codec: "PCMU", streamId: "stream" });
    emit({ type: "audio", streamId: "stream", track: "inbound", chunk: 1, timestamp: 0, payload: btoa("\xaa".repeat(160)) });
  });
  expect(await screen.findByText(/Gesprächsaudio empfangen/)).toBeVisible();
  await waitFor(() => expect(Number(screen.getByRole("progressbar", { name: "Audiopegel" }).getAttribute("value"))).toBeGreaterThan(0));
  expect(sources).toHaveLength(2); // unlock + decoded media
  await userEvent.click(screen.getByRole("button", { name: "Mithören stoppen" }));
  expect(requests[0].init.signal?.aborted).toBe(true);
  expect(requests).toHaveLength(1); // no hangup request
  expect(screen.getByText(/Telefonat läuft weiter/)).toBeVisible();
  expect(sessionType).toBe("auto");
  Reflect.deleteProperty(navigator, "audioSession");
});
it("keeps media playback active until the last listener stops and preserves microphone sessions", () => {
  const audioSession = { type: "ambient" };
  Object.defineProperty(navigator, "audioSession", { configurable: true, value: audioSession });
  const first = aktiviereTelefonWiedergabe(), second = aktiviereTelefonWiedergabe();
  expect(audioSession.type).toBe("playback"); first(); first();
  expect(audioSession.type).toBe("playback"); second();
  expect(audioSession.type).toBe("ambient");
  audioSession.type = "play-and-record";
  const recording = aktiviereTelefonWiedergabe();
  expect(audioSession.type).toBe("play-and-record"); recording();
  expect(audioSession.type).toBe("play-and-record");
  Reflect.deleteProperty(navigator, "audioSession");
});
it("hides playback for missing prior consent and finished calls", () => {
  const { rerender } = render(<LiveMithoeren id={1} aktiv zustimmung={false} />);
  expect(screen.queryByRole("button", { name: "Live mithören" })).toBeNull();
  rerender(<LiveMithoeren id={1} aktiv={false} zustimmung />);
  expect(screen.queryByRole("button", { name: "Live mithören" })).toBeNull();
});
it("shows provider refusal without pretending that audio is playing", async () => {
  audioFixture();
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Zustimmung fehlt." }), { status: 409 }));
  render(<LiveMithoeren id={1} aktiv zustimmung />);
  await userEvent.click(screen.getByRole("button", { name: "Live mithören" }));
  expect(await screen.findByText("Zustimmung fehlt.")).toBeVisible();
  expect(screen.queryByText(/Gesprächsaudio empfangen/)).toBeNull();
});
