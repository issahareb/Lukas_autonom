import { z } from "zod";
import { PhoneTranscript, type PhoneFragment } from "./telefon-memory";

const field = z.string().max(1500);
export const enquirySummarySchema = z.object({
  kategorie: z.enum(["anfrage", "sonstiges", "unklar"]),
  weitergabe: z.enum(["erlaubt", "abgelehnt", "offen"]),
  zusammenfassung: z.string().max(3000),
  name: field, unternehmen: field, leistungen: field, wuensche: field,
  website: field, zeitrahmen: field, budget: field, rueckruf: field, email: field,
  offeneFragen: field,
  ergebnis: field.default(""), naechsteSchritte: field.default(""),
}).superRefine((summary, context) => {
  if (summary.weitergabe !== "abgelehnt" && !summary.zusammenfassung.trim()) {
    context.addIssue({ code: "custom", path: ["zusammenfassung"], message: "Gesprächsnotiz fehlt" });
  }
});
export type EnquirySummary = z.infer<typeof enquirySummarySchema>;
export type EnquirySink = {
  summarize: (transcript: string) => Promise<EnquirySummary>;
  save: (summary: EnquirySummary, revision: number, complete: boolean) => Promise<void>;
  failed: (complete: boolean) => Promise<void>;
  finish: () => Promise<void>;
};
/** Isolated per call; only summaries are persisted. The transcript remains ephemeral.
 * A single write queue keeps late model replies from overwriting corrected notes.
 */
export class PhoneEnquiry {
  private transcript = new PhoneTranscript();
  private timer?: ReturnType<typeof setTimeout>;
  private queue: Promise<void> = Promise.resolve();
  private lastSaved = 0;
  private closed = false;
  private queued = false;
  private final?: Promise<void>;
  constructor(private sink: EnquirySink, private acknowledge: (message: string) => void = () => {}, private intervalMs = 20000) {}
  observe(part: PhoneFragment) {
    if (this.closed) return;
    this.transcript.append(part);
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = undefined; void this.flush(false); }, this.intervalMs);
      this.timer.unref();
    }
  }
  flush(complete: boolean): Promise<void> {
    if (!complete && this.queued) return this.queue;
    this.queued = true;
    this.queue = this.queue.catch(() => {}).then(async () => {
      const revision = this.transcript.revision;
      const transcript = this.transcript.snapshot();
      if (!complete && revision <= this.lastSaved) return;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const summary = enquirySummarySchema.parse(await this.sink.summarize(transcript));
          await this.sink.save(summary, revision, complete);
          this.lastSaved = revision;
          if (!this.closed && summary.weitergabe !== "abgelehnt") {
            try { this.acknowledge("Technische Bestätigung: Die bisherige interne Gesprächsnotiz ist im privaten Dashboard von Hareb Digital gespeichert. Das bestätigt weder eine E-Mail-Weiterleitung noch einen Rückruf oder Termin. Spätere Ergänzungen werden weiter erfasst."); } catch { /* Stored even if the caller disconnected. */ }
          }
          return;
        } catch { /* One bounded retry; no raw speech or credentials in errors. */ }
      }
      await this.sink.failed(complete).catch(() => {});
      if (!this.closed) this.acknowledge("Technischer Hinweis: Die Anfrage konnte noch nicht zuverlässig gespeichert werden. Behaupte keinen Erfolg; nenne kontakt@hareb.digital als Ersatz für die Anfrage.");
    }).finally(() => { this.queued = false; });
    return this.queue;
  }
  close(): Promise<void> {
    if (this.final) return this.final;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.final = this.flush(true).then(() => this.sink.finish());
    return this.final;
  }
}
