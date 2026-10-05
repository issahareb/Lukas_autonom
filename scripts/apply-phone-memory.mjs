import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const edits = new Map();
function load(path, expected) {
  const value = readFileSync(path, 'utf8');
  const bytes = Buffer.from(value);
  const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (hash !== expected) throw new Error(`Unexpected base for ${path}: ${hash}`);
  edits.set(path, value); return path;
}
function replace(path, before, after) {
  const value = edits.get(path);
  if (value.split(before).length !== 2) throw new Error(`Non-unique patch anchor in ${path}: ${before.slice(0, 75)}`);
  edits.set(path, value.replace(before, after));
}
const livePath = 'artifacts/api-server/src/lib/ai/live-session.ts';
if (readFileSync(livePath, 'utf8').includes('phoneMemoryWrites')) {
  console.log('Telephone memory integration already applied.'); process.exit(0);
}
const live = load(livePath, '2ce12b43bdc56d36c86336120b40bfe8552f3cb0');
const phone = load('artifacts/api-server/src/lib/telefon.ts', 'f1e3ca9bd93671f94fa69711f74c0db6c07a97be');
const schema = load('lib/db/src/schema/telefon.ts', 'b79d2312481d055646fa33c1e87f171ddd52339f');
const pkg = load('artifacts/api-server/package.json', 'd76bd815649f5225c5f2595b5ab5f2cfa2a4cbc0');
replace(live, 'import { TelefonGespraech } from "./telefon-gespraech";', 'import { TelefonGespraech } from "./telefon-gespraech";\nimport type { PhoneMemory, PhonePeer } from "./telefon-memory";');
replace(live, '  telefonKontextId?: string;', '  telefonKontextId?: string;\n  telefonPeer?: PhonePeer;');
replace(live, '  phone?: TelefonGespraech;', '  phone?: TelefonGespraech;\n  phoneMemory?: PhoneMemory;');
replace(live, 'const setups = new Set<Promise<unknown>>();', 'const setups = new Set<Promise<unknown>>();\nconst phoneMemoryWrites = new Set<Promise<void>>();');
replace(live, '  "Begrüßung und einfaches allgemeines Gespräch führst du selbst.",', '  "Begrüßung und einfaches allgemeines Gespräch führst du selbst.",\n  "Fragt jemand nach einem früheren Telefonat, Inserat oder einer Absprache, nutze das Kontaktarchiv. Fehlt der Bezug im Sprachkontext, delegiere zuerst an das Backend und frage nach der Kontakthistorie; behaupte nicht ungeprüft, dich nicht zu erinnern. Ein alter Auftrag ist keine aktuelle Kaufzusage.",');
replace(live, 'function sessionConfig(config: { model: string; voice: string }, browser: boolean) {', 'function sessionConfig(config: { model: string; voice: string }, browser: boolean, input: Json[] = []) {');
replace(live, '    model: config.model, audio: { output: { voice: config.voice } },', '    model: config.model, audio: { output: { voice: config.voice } },\n    ...(!browser && input.length ? { input } : {}),');
replace(live, 'function retainHistory(messages: Message[]): Message[] {', 'function thinking(state: ManagedSession, text: string) {\n  for (const content of textChunks(text.slice(0, 12000))) {\n    if (!send(state, { type: "session.thinking.append", delegation_id: null, content })) {\n      throw new LiveSessionError("Die Sprachverbindung wurde unterbrochen.");\n    }\n  }\n}\nfunction retainHistory(messages: Message[]): Message[] {');
replace(live, '        const answer = await runLukasTurn({', '        const erinnerung = await state.phoneMemory?.recall(work.userText).catch(() => "\\nDas Kontaktgedächtnis ist gerade nicht verfügbar; erfinde keine früheren Absprachen.") ?? "";\n        const answer = await runLukasTurn({');
replace(live, '          systemPromptOverride: state.options.instructions + (state.options.allowTools ? "" :', '          systemPromptOverride: state.options.instructions + erinnerung + (state.options.allowTools ? "" :');
replace(live, '    state.phone?.observe(role, event.delta);', '    state.phone?.observe(role, event.delta);\n    state.phoneMemory?.observe({ role, text: event.delta, startMs: event.start_ms, endMs: event.end_ms });');
replace(live, '  state.queue = []; state.transcript = []; state.history = [];', '  if (state.phoneMemory) {\n    const write = state.phoneMemory.close(reason !== "provider_expiry_after_unconfirmed_close" && !reason.includes("failed"));\n    phoneMemoryWrites.add(write);\n    void write.catch(() => logger.error({ phase: "final_write_failed" }, "Telefon-Gedächtnis konnte nicht abschließend gespeichert werden"))\n      .finally(() => phoneMemoryWrites.delete(write));\n  }\n  state.queue = []; state.transcript = []; state.history = [];');
replace(live, '    let state: ManagedSession | undefined, accepted = false;', '    let state: ManagedSession | undefined, accepted = false;\n    let phoneMemory: PhoneMemory | undefined;');
replace(live, '      await apiRequest(connection, "/live/sessions/" + encodeURIComponent(options.sessionId) + "/accept", {\n        session: sessionConfig(config, false),\n      });', '      if (options.telefonPeer) {\n        try {\n          const { preparePhoneMemory } = await import("./telefon-memory");\n          phoneMemory = await preparePhoneMemory(options.sessionId, options.telefonPeer, options.visibility);\n        } catch { logger.warn({ phase: "lookup_failed" }, "Telefon-Gedächtnis konnte nicht geladen werden"); }\n      }\n      const initialInput: Json[] = [...(phoneMemory?.input ?? [])];\n      if (options.initialCommentary?.trim()) initialInput.push({ type: "message", role: "developer", content: [{\n        type: "input_text", text: "Aktueller Gesprächsauftrag. Interne Vorgaben nicht vorlesen:\\n" + textChunks(options.initialCommentary.trim().slice(0, 2000)).slice(0, 4).join(""),\n      }] });\n      await apiRequest(connection, "/live/sessions/" + encodeURIComponent(options.sessionId) + "/accept", {\n        session: sessionConfig(config, false, initialInput),\n      });');
replace(live, '      state = startManaged(options.sessionId, { ...options, allowTools: false }, connection, config, "sip");', '      state = startManaged(options.sessionId, { ...options, allowTools: false }, connection, config, "sip");\n      state.phoneMemory = phoneMemory;');
replace(live, '      if (options.initialCommentary?.trim()) commentary(state, null, options.initialCommentary.trim().slice(0, 2000));', '      // SIP is already running after accept; attach is its server-owned sideband.\n      // The full brief is startup input, not a burst of separate speakable chunks.\n      if (options.initialCommentary?.trim() && !state.transcript.some(row => row.role === "assistant")) {\n        if (!send(state, { type: "session.instructions.append", event_id: "phone_greeting_" + randomBytes(8).toString("hex"), delegation_id: null,\n          content: "Begrüße den Gesprächspartner jetzt einmal kurz auf Deutsch gemäß dem aktuellen Gesprächsauftrag. Berücksichtige den vorgegebenen Gesprächsnamen. Falls du bereits begrüßt hast, wiederhole die Begrüßung nicht. Pausiere danach und höre zu." })) {\n          throw new LiveSessionError("Die Sprachverbindung wurde unterbrochen.");\n        }\n      }');
replace(live, '      if (state) await terminateSession(state, "sip_setup_failed").catch(() => {});', '      if (state) await terminateSession(state, "sip_setup_failed").catch(() => {});\n      else await phoneMemory?.close(false).catch(() => {});');
replace(live, '  commentary(state, null, "Vertraulicher Hinweis deines Auftraggebers nur für dich.', '  thinking(state, "Vertraulicher Hinweis deines Auftraggebers nur für dich.');
replace(live, '  await Promise.allSettled([...setups, ...[...sessions.values()].map((state) => terminateSession(state, "server_shutdown"))]);', '  await Promise.allSettled([...setups, ...[...sessions.values()].map((state) => terminateSession(state, "server_shutdown"))]);\n  await Promise.allSettled([...phoneMemoryWrites]);');
replace(phone, '    telefonKontextId: kontext?.id,', '    telefonKontextId: kontext?.id,\n    telefonPeer: { nummer: normalisiere(vonNummer), richtung: ausgehend ? "ausgehend" : "eingehend" },');
edits.set(schema, edits.get(schema) + '\n/** Durable, consent-scoped speech history; removing the contact removes its history. */\nexport const telefonGedaechtnis = pgTable("lukas_telefon_gedaechtnis", {\n  sessionId: text("session_id").primaryKey(),\n  kontaktId: integer("kontakt_id").notNull().references(() => telefonNummern.id, { onDelete: "cascade" }),\n  nummer: text("nummer").notNull(),\n  sichtbarkeit: text("sichtbarkeit").notNull(),\n  richtung: text("richtung").notNull(),\n  transkript: text("transkript").notNull().default(""),\n  revision: integer("revision").notNull().default(0),\n  vollstaendig: boolean("vollstaendig").notNull().default(false),\n  zustimmungAm: timestamp("zustimmung_am", { withTimezone: true }).notNull(),\n  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),\n  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),\n}, (t) => [index("lukas_telefon_gedaechtnis_kontakt_idx").on(t.kontaktId, t.updatedAt)]);\n');
replace(pkg, 'node scripts/check-telefon-hinweis.mjs &&', 'node scripts/check-telefon-hinweis.mjs && node scripts/check-telefon-memory.mjs &&');
for (const [path, value] of edits) writeFileSync(path, value);
console.log('Applied scoped telephone memory, startup history and quiet hint delivery.');
