/*
 * Gemeinsame Einstellungen fuer alles, was Lukas SPRICHT.
 *
 * Es gibt inzwischen drei Wege zu seiner Stimme: der private Sprachkanal im
 * Dashboard, das oeffentliche Widget auf der Webseite und jetzt das Telefon.
 * Alle drei brauchen dieselbe Aussprache, dieselbe Stimme und dieselbe
 * Sprecherkennung — und genau solche Einstellungen driften auseinander, wenn
 * sie an drei Stellen stehen: man haertet eine und vergisst die anderen.
 */

/*
 * Die Realtime-Stimmen sind primaer auf Englisch trainiert und faerben
 * deutsche Woerter sonst mit englischer Aussprache ein. Gilt nur fuers
 * Sprechen — im Textchat gibt es keine Aussprache. Steht bewusst GANZ OBEN
 * im Prompt, damit das Modell es als wichtigste Verhaltensregel gewichtet.
 */
export const SPRACH_REGEL = `SPRACHAUSGABE (WICHTIGSTE REGEL): Du sprichst AUSSCHLIESSLICH mit nativer, akzentfreier
deutscher Aussprache — jedes Wort so, wie ein deutscher Muttersprachler es sagen würde,
auch Namen und Fremdwörter. Keine englische Betonung, keine englische Klangfärbung.
Ruhiger, männlicher, conversational-natürlicher Tonfall.`;

export function sprachModell(): string {
  return process.env.LUKAS_REALTIME_MODEL ?? "gpt-live-1";
}

export function sprachStimme(): string {
  return process.env.LUKAS_REALTIME_VOICE ?? "ash";
}

/**
 * Audio-Einstellungen der Sitzung.
 *
 * @param amTelefon Ein Telefon liefert schmalbandiges Audio ueber eine Leitung
 *   mit eigenem Rauschen. `far_field` wuerde hier echte Sprache mitfiltern,
 *   deshalb bleibt es auch am Telefon bei `near_field` — der Anrufer haelt das
 *   Geraet ohnehin ans Ohr.
 */
export function sprachAudio(amTelefon = false) {
  void amTelefon;
  return {
    output: { voice: sprachStimme() },
    input: {
      /*
       * near_field statt far_field. far_field ist fuer Konferenzmikrofone
       * quer durch den Raum gedacht; Widget und Dashboard laufen auf
       * Handy/Laptop dicht am Nutzer. Dort hat far_field echte Sprache
       * mit-weggefiltert und die Erkennung teils gar nicht ausgeloest
       * ("antwortet manchmal nicht"). Die Rueckkopplung, die far_field
       * abfangen sollte, erledigt echoCancellation im Widget selbst.
       */
      noise_reduction: { type: "near_field" as const },
      /*
       * Expliziter Sprach-Hinweis, damit das Gespraech durchgehend als
       * Deutsch erkannt wird. `model` ist in den TS-Typen als optional
       * markiert, die echte API verlangt es aber zwingend, sobald
       * `transcription` ueberhaupt gesetzt ist — sonst 400 "Missing
       * required parameter".
       */
      transcription: { model: "gpt-4o-mini-transcribe", language: "de" },
      /*
       * semantic_vad statt fixem Stille-Timer (server_vad): das Modell
       * beurteilt am Inhalt, ob jemand ausgeredet hat, statt starr nach
       * z.B. 500ms Stille abzubrechen — robuster gegen Sprechpausen, die
       * sonst als Gespraechsende gewertet werden und zu ausbleibenden
       * Antworten fuehren. Am Telefon zaehlt das doppelt: dort gibt es
       * keinen Bildschirm, an dem man sieht, dass der andere noch denkt.
       */
      turn_detection: { type: "semantic_vad" as const, eagerness: "auto" as const },
    },
  };
}
