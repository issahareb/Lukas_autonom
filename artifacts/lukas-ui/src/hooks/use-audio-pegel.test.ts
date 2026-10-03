import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAudioPegel } from "./use-audio-pegel";
class Context {
  static all: Context[] = [];
  state = "running"; destination = {};
  close = vi.fn(async () => {});
  createMediaElementSource = vi.fn(() => { throw new Error("Audioelement erneut umgeleitet"); });
  createMediaStreamSource = vi.fn((_stream: MediaStream) => ({ connect: vi.fn() }));
  createAnalyser = vi.fn(() => ({ fftSize: 512, frequencyBinCount: 256, smoothingTimeConstant: 0, getByteTimeDomainData: vi.fn() }));
  constructor() { Context.all.push(this); }
}
beforeEach(() => {
  Context.all = []; vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("misst Sprecherwechsel ohne die Audiowiedergabe umzuleiten", () => {
  const remote = { getAudioTracks: () => [] } as unknown as MediaStream;
  const mic = { getAudioTracks: () => [] } as unknown as MediaStream;
  const element = document.createElement("audio"); element.srcObject = remote;
  const { rerender, unmount } = renderHook(({ stream }: { stream: MediaStream | null }) =>
    useAudioPegel({ stream, element, aktiv: true }), { initialProps: { stream: null as MediaStream | null } });
  const first = Context.all[0];
  expect(first.createMediaStreamSource).toHaveBeenCalledWith(remote);
  expect(first.createMediaElementSource).not.toHaveBeenCalled();
  rerender({ stream: mic }); expect(first.close).toHaveBeenCalledTimes(1);
  const second = Context.all[1];
  expect(second.createMediaStreamSource).toHaveBeenCalledWith(mic);
  expect(second.createMediaStreamSource).toHaveBeenCalledWith(remote);
  expect(second.createMediaElementSource).not.toHaveBeenCalled();
  expect(element.srcObject).toBe(remote);
  unmount(); expect(second.close).toHaveBeenCalledTimes(1);
});
