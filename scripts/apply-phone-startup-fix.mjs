import { readFileSync, writeFileSync } from 'node:fs';
const changes = new Map();
function replace(path, before, after) {
  const content = changes.get(path) ?? readFileSync(path, 'utf8');
  if (content.split(before).length !== 2) throw new Error(`Patch anchor is not unique: ${path}: ${before.slice(0, 100)}`);
  changes.set(path, content.replace(before, after));
}
const live = 'artifacts/api-server/src/lib/ai/live-session.ts';
const tests = 'artifacts/api-server/scripts/check-live-session.mjs';
const player = 'artifacts/lukas-ui/src/components/telefon-mithoeren.tsx';
if (readFileSync(live, 'utf8').includes('phoneGreetingTimer')) { console.log('Already applied.'); process.exit(0); }
replace(live, 'import { TelefonGespraech } from "./telefon-gespraech";', 'import { TelefonGespraech } from "./telefon-gespraech";\nimport { TELEFON_SPRACHREGELN, telefonStartInput } from "./telefon-sprachprofil";');
replace(live, '  phone?: TelefonGespraech;', '  phone?: TelefonGespraech;\n  phoneSpeechObserved?: boolean;\n  phoneGreetingTimer?: ReturnType<typeof setTimeout>;');
replace(live, 'function sessionConfig(config: { model: string; voice: string }, browser: boolean) {', 'function sessionConfig(config: { model: string; voice: string }, browser: boolean, input: Json[] = []) {');
replace(live, '    model: config.model, audio: { output: { voice: config.voice } },', '    model: config.model, audio: { output: { voice: config.voice } },\n    ...(!browser && input.length ? { input } : {}),');
replace(live, '    instructions: FRONTEND_INSTRUCTIONS + (!browser ?', '    instructions: (browser ? FRONTEND_INSTRUCTIONS : TELEFON_SPRACHREGELN) + (!browser ?');
replace(live, '    state.phone?.observe(role, event.delta);', '    if (state.transport === "sip" && event.delta.trim()) {\n      state.phoneSpeechObserved = true;\n      if (state.phoneGreetingTimer) { clearTimeout(state.phoneGreetingTimer); state.phoneGreetingTimer = undefined; }\n    }\n    state.phone?.observe(role, event.delta);');
replace(live, '  clearTimeout(state.lifetime);', '  clearTimeout(state.lifetime);\n  if (state.phoneGreetingTimer) { clearTimeout(state.phoneGreetingTimer); state.phoneGreetingTimer = undefined; }');
replace(live, '        session: sessionConfig(config, false),', '        // Startup context is available before the first generated phoneme.\n        // Runtime thinking appends arrive gradually and must not carry the initial brief.\n        session: sessionConfig(config, false, telefonStartInput(options.initialCommentary)),');
replace(live, `      if (options.initialCommentary?.trim()) {
        // One trusted instruction triggers one greeting. Previously the full brief
        // was split into multiple speakable commentary events, which could make
        // the model restart/paraphrase itself and sound like stuttering.
        thinking(state, "Aktueller Gesprächsauftrag, still berücksichtigen und nicht vorlesen: " + options.initialCommentary.trim().slice(0, 1600));
        if (!send(state, { type: "session.instructions.append", event_id: "phone_greeting_" + randomBytes(8).toString("hex"), delegation_id: null,
          content: "Begrüße den Gesprächspartner jetzt genau einmal kurz und natürlich. Nutze den aktuellen Gesprächsauftrag. Danach höre zu. Wiederhole oder starte die Begrüßung nicht neu." })) {
          throw new LiveSessionError("Die Sprachverbindung wurde unterbrochen.");
        }
      }`, `      if (options.initialCommentary?.trim() && !state.phoneSpeechObserved) {
        // Sideband attachment replays recent events. Let that replay arrive before
        // asking for a greeting, otherwise an already speaking model is interrupted.
        const phoneState = state;
        phoneState.phoneGreetingTimer = setTimeout(() => {
          phoneState.phoneGreetingTimer = undefined;
          if (phoneState.ended || phoneState.closing || phoneState.phoneSpeechObserved) return;
          const delivered = send(phoneState, { type: "session.instructions.append",
            event_id: "phone_greeting_" + randomBytes(8).toString("hex"), delegation_id: null,
            content: "Begrüße den Gesprächspartner jetzt genau einmal in einem kurzen Satz gemäß dem aktuellen Gesprächsauftrag. Danach höre zu." });
          logger.info({ sessionId: phoneState.id, phase: "phone_greeting", delivered }, "Telefon-Sprachstart");
        }, 250);
        phoneState.phoneGreetingTimer.unref();
      }
      logger.info({ sessionId: state.id, phase: "phone_ready", startupContext: Boolean(options.initialCommentary?.trim()),
        speechAlreadyObserved: Boolean(state.phoneSpeechObserved) }, "Telefon-Sprachstart");`);
replace(tests, '  const sipSocket = socketFor("live_phone_ok");', `  const sipSocket = socketFor("live_phone_ok");
  assert.ok(accepts[0].body.session.instructions.includes("Backchannel policy:"));
  assert.ok(accepts[0].body.session.instructions.includes("Interruption policy:"));
  assert.ok(!JSON.stringify(accepts[0].body.session).includes("PHONE_PRIVATE_BACKEND"), "private backend context remains private");
  assert.equal(accepts[0].body.session.input[0].role, "developer");
  assert.ok(accepts[0].body.session.input[0].content[0].text.includes(sipOptions.initialCommentary), "entire brief is present at accept");
  assert.equal(sipSocket.sent.length, 0, "no competing context or greeting during attachment replay");
  fire(250); await settle();`);
replace(tests, '  assert.equal(quietBrief.map((e) => e.content).join("").includes(sipOptions.initialCommentary), true);', '  assert.equal(quietBrief.length, 0, "startup context must not be streamed after speech can already begin");');
replace(tests, '  fixture.failSockets = 1;\n  await assert.rejects(api.acceptLiveSipSession({ ...sipOptions, sessionId: "live_phone_attach_failure" })', `  // A first word arriving during sideband replay must cancel the extra greeting.
  for (const role of ["user", "assistant"]) {
    const sessionId = "live_phone_already_" + role;
    await api.acceptLiveSipSession({ ...sipOptions, sessionId });
    const active = socketFor(sessionId);
    active.emit({ type: role === "user" ? "session.input_transcript.delta" : "session.output_transcript.delta",
      event_id: "first_" + role, delta: "Hallo", start_ms: 0, end_ms: 100 });
    assert.ok(![...timers.values()].some(timer => timer.milliseconds === 250), "speech cancels pending greeting");
    assert.equal(active.sent.some(event => event.type === "session.instructions.append"), false);
    active.emit({ type: "session.closed" });
  }
  const longBrief = "Auftrag Anfang " + "ä".repeat(1800) + " AUFTRAG_ENDE";
  await api.acceptLiveSipSession({ ...sipOptions, sessionId: "live_phone_long_brief", initialCommentary: longBrief });
  const longAccept = fixture.requests.find(r => r.url.endsWith("/live_phone_long_brief/accept"));
  assert.ok(longAccept.body.session.input[0].content[0].text.endsWith("AUFTRAG_ENDE"), "do not truncate startup to four streamed chunks");
  socketFor("live_phone_long_brief").emit({ type: "session.closed" });
  assert.ok(![...timers.values()].some(timer => timer.milliseconds === 250), "close cancels pending greeting");
  fixture.failSockets = 1;
  await assert.rejects(api.acceptLiveSipSession({ ...sipOptions, sessionId: "live_phone_attach_failure" })`);
replace(player, '        const cleanup = () => { window.clearTimeout(timeout); controller.signal.removeEventListener("abort", abort); };', `        // Waiting/heartbeat messages prove a connection, not arriving audio.
        // Only real playable frames renew the separate audio deadline.
        let audioDeadline = window.setTimeout(() => {
          cleanup(); socket.close(); reject(new Error("Verbunden, aber seit 15 Sekunden kein Gesprächsaudio empfangen. Bitte erneut verbinden. Das Telefonat läuft weiter."));
        }, 15000);
        const cleanup = () => { window.clearTimeout(timeout); window.clearTimeout(audioDeadline); controller.signal.removeEventListener("abort", abort); };`);
replace(player, '              if (player.play(data)) setStatus("Gesprächsaudio empfangen");', `              if (player.play(data)) {
                setStatus("Gesprächsaudio empfangen");
                window.clearTimeout(audioDeadline);
                audioDeadline = window.setTimeout(() => {
                  cleanup(); socket.close(); reject(new Error("Seit 15 Sekunden keine neuen Audiodaten. Bitte erneut verbinden. Das Telefonat läuft weiter."));
                }, 15000);
              }`);
for (const [path, content] of changes) writeFileSync(path, content);
console.log('Applied phone startup context, speech-aware greeting, telephone speech policy, regression tests and independent audio deadline.');
