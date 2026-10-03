/*
 * GPT Live für Dashboard, öffentliches Widget und Telefon.
 * Realtime-Modellnamen und dessen VAD-/Transkriptionsparameter gehören
 * nicht in eine Live-Sitzung.
 */
export const SPRACH_REGEL = `Sprich natürliches Deutsch, ruhig und direkt.
Antworte in kurzen Sätzen ohne Markdown. Höre auch während eigener Antworten zu,
lasse dich unterbrechen und berücksichtige Korrekturen sofort.`;

export function sprachModell(): string {
  const model = process.env.LUKAS_LIVE_MODEL?.trim() || "gpt-live-1";
  if (!model.startsWith("gpt-live-")) {
    throw new Error("LUKAS_LIVE_MODEL muss ein GPT-Live-Modell sein.");
  }
  return model;
}

export function sprachStimme(): string {
  return process.env.LUKAS_LIVE_VOICE?.trim() || "cedar";
}

/** WebRTC und SIP handeln das Audioformat selbst aus. */
export function sprachAudio() {
  return { output: { voice: sprachStimme() } };
}
