import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TelefonHinweis } from "./telefon-hinweis";

it("sends a private text hint to the selected call and reports refusal without claiming delivery", async () => {
  localStorage.setItem("lukas_token", "owner");
  const fetch = vi.fn(async () => Response.json({ error: "Anruf beendet." }, { status: 409 }));
  vi.stubGlobal("fetch", fetch);
  render(<TelefonHinweis id={42} onRecording={() => {}} />);
  await userEvent.type(screen.getByRole("textbox"), "Frag nach Lieferung.");
  await userEvent.click(screen.getByRole("button", { name: "Hinweis senden" }));
  expect(fetch.mock.calls[0]).toEqual(["/api/lukas/telefon/anrufe/42/hinweis", expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ text: "Frag nach Lieferung." }) })]);
  expect(await screen.findByText("Anruf beendet.")).toBeVisible();
  expect(screen.getByRole("textbox")).toHaveValue("Frag nach Lieferung.");
});
it("records only on tap, mutes monitoring, sends privately after stopping and releases the microphone", async () => {
  const stop = vi.fn(), onRecording = vi.fn();
  const input = { getTracks: () => [{ stop }] };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => input) } });
  let current: Recorder;
  class Recorder {
    static isTypeSupported = (type: string) => type === "audio/mp4";
    mimeType = "audio/mp4"; state = "inactive";
    ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void;
    constructor() { current = this; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["test audio"], { type: this.mimeType }) }); this.onstop?.(); }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  const fetch = vi.fn(async () => Response.json({ text: "Frag nach Lieferung.", message: "Übermittelt." })); vi.stubGlobal("fetch", fetch);
  render(<TelefonHinweis id={42} onRecording={onRecording} />);
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Hinweis einsprechen" }));
  expect(current!.state).toBe("recording"); expect(onRecording).toHaveBeenCalledWith(true); expect(fetch).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Einflüstern senden" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(fetch.mock.calls[0]).toEqual(["/api/lukas/telefon/anrufe/42/einfluestern", expect.objectContaining({ body: expect.any(FormData) })]);
  expect(stop).toHaveBeenCalled(); expect(onRecording).toHaveBeenLastCalledWith(false);
  expect(await screen.findByText(/Frag nach Lieferung.*Übermittelt/)).toBeVisible();
});
