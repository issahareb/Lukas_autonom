import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSprachsitzung } from "./use-sprachsitzung";

const sdk = vi.hoisted(() => ({
  events: new Map<string, (event: { type: string }) => void>(),
  track: { enabled: true, stop: vi.fn() },
  connect: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  mute: vi.fn(),
  getUserMedia: vi.fn(),
}));

vi.mock("@openai/agents-realtime", () => ({
  RealtimeAgent: class {},
  OpenAIRealtimeWebRTC: class {},
  RealtimeSession: class {
    on(name: string, listener: (event: { type: string }) => void) {
      sdk.events.set(name, listener);
    }
    connect = sdk.connect;
    close = sdk.close;
    mute = sdk.mute;
  },
}));

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

beforeEach(() => {
  vi.clearAllMocks();
  sdk.events.clear();
  sdk.track.enabled = true;
  // Wie das SDK: mute(true) deaktiviert den ausgehenden Mikrofon-Track.
  sdk.mute.mockImplementation((muted: boolean) => { sdk.track.enabled = !muted; });
  sdk.getUserMedia.mockResolvedValue({ getTracks: () => [sdk.track] });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: sdk.getUserMedia },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ value: "test-session-token" }),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalMediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices");
  }
});

function emit(type: string) {
  const listener = sdk.events.get("transport_event");
  if (!listener) throw new Error("Sprachsitzung ist nicht verbunden");
  act(() => listener({ type }));
}

describe("Sprachsitzung: Antworten unterbrechen", () => {
  it("sendet weiter Mikrofon-Audio, während Lukas spricht, und behält den Echo-Schutz", async () => {
    const { result } = renderHook(() => useSprachsitzung());
    await act(async () => { await result.current.starten(); });
    expect(result.current.status).toBe("hoert");
    expect(sdk.getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    emit("output_audio_buffer.started");
    expect(result.current.status).toBe("spricht");
    // Ohne diesen Track erreicht eine Unterbrechung die Sprecherkennung nie.
    expect(sdk.track.enabled).toBe(true);

    emit("input_audio_buffer.speech_started");
    expect(result.current.status).toBe("hoert");
    expect(sdk.track.enabled).toBe(true);
  });

  it.each(["output_audio_buffer.cleared", "output_audio_buffer.stopped"])(
    "zeigt nach %s wieder Zuhören an",
    async (event) => {
      const { result } = renderHook(() => useSprachsitzung());
      await act(async () => { await result.current.starten(); });
      emit("output_audio_buffer.started");
      expect(result.current.status).toBe("spricht");
      emit(event);
      expect(result.current.status).toBe("hoert");
      expect(result.current.aktiv).toBe(true);
      expect(sdk.track.enabled).toBe(true);
    },
  );
});
