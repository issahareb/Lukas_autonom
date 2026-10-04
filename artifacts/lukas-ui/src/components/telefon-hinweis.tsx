import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function TelefonHinweis({ id, onRecording }: { id: number; onRecording: (active: boolean) => void }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const active = useRef(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const release = () => {
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    onRecording(false);
  };
  useEffect(() => {
    active.current = true;
    const hidden = () => { if (document.hidden) { if (recorder.current) recorder.current.onstop = null; if (recorder.current?.state === "recording") recorder.current.stop(); recorder.current = null; release(); setRecording(false); setBusy(false); } };
    document.addEventListener("visibilitychange", hidden);
    return () => { active.current = false; document.removeEventListener("visibilitychange", hidden); if (recorder.current) recorder.current.onstop = null; if (recorder.current?.state === "recording") recorder.current.stop(); release(); };
  }, []);
  const send = async (body: BodyInit, spoken = false) => {
    setBusy(true); setStatus("Wird an Lukas übermittelt …");
    try {
      const token = localStorage.getItem("lukas_token");
      const response = await fetch(`${BASE}/api/lukas/telefon/anrufe/${id}/${spoken ? "einfluestern" : "hinweis"}`, {
        method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(!spoken ? { "Content-Type": "application/json" } : {}) }, body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Hinweis nicht übermittelt.");
      if (active.current) { setStatus(result.text ? `„${result.text}“ — ${result.message}` : result.message); setText(""); }
    } catch (err) { if (active.current) setStatus(err instanceof Error ? err.message : "Hinweis nicht übermittelt."); }
    finally { if (active.current) setBusy(false); }
  };
  const start = async () => {
    setBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("Bitte den Hinweis eintippen; dieser Browser unterstützt keine Sprachaufnahme.");
      const input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!active.current || document.hidden) { input.getTracks().forEach(t => t.stop()); setBusy(false); return; }
      stream.current = input;
      const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(input, type ? { mimeType: type } : undefined); recorder.current = r;
      const chunks: BlobPart[] = [];
      r.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      r.onerror = () => { r.onstop = null; release(); setRecording(false); setBusy(false); setStatus("Aufnahme fehlgeschlagen. Bitte erneut versuchen."); };
      r.onstop = () => {
        recorder.current = null; release(); setRecording(false);
        if (!active.current) return;
        const data = new FormData();
        data.append("audio", new Blob(chunks, { type: r.mimeType }), r.mimeType.includes("mp4") ? "hinweis.mp4" : "hinweis.webm");
        void send(data, true);
      };
      onRecording(true); r.start(); setRecording(true); setStatus("Sprich deinen Hinweis. Nur Lukas erhält ihn nach dem Senden.");
      timer.current = setTimeout(() => { if (r.state === "recording") r.stop(); }, 20000);
    } catch (err) { release(); setBusy(false); setStatus(err instanceof Error ? err.message : "Mikrofon konnte nicht geöffnet werden."); }
  };
  return <div className="w-full space-y-2 rounded-lg border p-3">
    <label htmlFor={`hinweis-${id}`} className="text-sm font-medium">Lukas etwas mitgeben</label>
    <textarea id={`hinweis-${id}`} value={text} onChange={e => setText(e.target.value)} maxLength={2000} rows={2} placeholder="Zum Beispiel: Frag auch nach dem Liefertermin." className="w-full rounded-md border bg-background p-2 text-base" disabled={busy} />
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy || !text.trim()} onClick={() => void send(JSON.stringify({ text }))}>Hinweis senden</Button>
      <Button size="sm" variant="outline" disabled={busy && !recording} onClick={() => recording ? recorder.current?.stop() : void start()}>{recording ? "Einflüstern senden" : "Hinweis einsprechen"}</Button>
    </div>
    {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
    <p className="text-xs text-muted-foreground">Deine Stimme wird nicht ins Telefonat übertragen. Beim Einsprechen ist das Mithören kurz stumm.</p>
  </div>;
}
