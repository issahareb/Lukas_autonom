/**
 * Render the production UI against isolated example responses.
 * Checks responsive overflow, chat selection/search, draft handoff and keyboard
 * access. This deliberately does not claim to test a live backend or voice call.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../ui-preview/", import.meta.url));
const origin = "http://127.0.0.1:4173";
const preview = spawn("npm", ["run", "serve", "--", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], { cwd: root, stdio: "inherit" });
let browser;
const now = new Date().toISOString();
const status = { mood: "Fokussiert", energy: "hoch", obsession: "Aus deinen Ideen einen klaren Plan machen.", note: "Der nächste Schritt: die wichtigsten Aufgaben für diese Woche festlegen.", lastActive: now, activeGoalsCount: 3, memoriesCount: 128 };
const goals = [
  { id: 1, title: "Lukas weiterentwickeln", description: "Ein Assistent, der mitdenkt.", progress: "Dashboard und Gesprächserlebnis verfeinern.", priority: "high", status: "active", createdAt: now, updatedAt: now },
  { id: 2, title: "Die nächste Woche planen", description: "Raum für die wichtigen Dinge schaffen.", progress: "Drei Prioritäten stehen im Fokus.", priority: "medium", status: "active", createdAt: now, updatedAt: now },
  { id: 3, title: "Eine neue Idee ausarbeiten", description: "Vom ersten Gedanken zum konkreten Vorhaben.", progress: "", priority: "medium", status: "active", createdAt: now, updatedAt: now },
];
const dashboard = { status, activeGoals: goals, recentDiary: [{ id: 1, content: "Heute haben wir die nächsten Schritte geordnet. Weniger offene Enden, mehr Raum für das Wesentliche.", createdAt: now }], recentMemories: [{ id: 1, content: "Gute Entscheidungen brauchen einen klaren Überblick. Issa möchte direkt sehen, was als Nächstes ansteht.", createdAt: now }], mediaJobs: [], recentEmotions: [], character: null };
const conversations = [
  { id: 1, title: "Plan für diese Woche", createdAt: now, updatedAt: now },
  { id: 2, title: "Ideen für das Studio", createdAt: now, updatedAt: now },
];
const messages = [
  { id: 1, role: "user", content: "Lass uns meine wichtigsten Ziele für diese Woche sortieren.", createdAt: now },
  { id: 2, role: "assistant", content: "Lass uns mit dem anfangen, was dich wirklich weiterbringt.\n\nFür Lukas steht das neue Dashboard an. Danach schaffen wir Raum für deine nächste Idee.\n\nWelche Aufgabe möchtest du heute abschließen?", createdAt: now },
  { id: 3, role: "user", content: "Heute möchte ich das neue Dashboard fertig machen.", createdAt: now },
  { id: 4, role: "assistant", content: "Dann setzen wir dort den Fokus: eine klare Übersicht, gut lesbare Inhalte und ein Gesprächsbereich, der sich selbstverständlich bedienen lässt.", createdAt: now },
];
let sent = 0;
const unexpected = [];
const pageErrors = [];
await mkdir(output, { recursive: true });

async function screenshot(page, name) {
  const bytes = await page.screenshot({ path: output + name + ".jpg", type: "jpeg", quality: 78, animations: "disabled" });
  if (process.env.UI_INLINE_PREVIEW === "1") {
    console.log("UI_PREVIEW_START:" + name);
    const b64 = bytes.toString("base64");
    for (let i = 0; i < b64.length; i += 8000) console.log("UI_IMAGE:" + b64.slice(i, i + 8000));
    console.log("UI_PREVIEW_END:" + name);
  }
}

async function noOverflow(page, name) {
  const bad = await page.locator(".app-shell, .app-scroll, .home-page, .home-columns, .chat-page, .chat-workspace, .chat-scroll, .chat-conversation-list, .workspace-page, .workspace-content, .connection-grid, .approval-queue").evaluateAll((nodes) => nodes.filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1).map((el) => ({ element: el.className, client: el.clientWidth, scroll: el.scrollWidth })));
  assert.deepEqual(bad, [], name + ": horizontal overflow");
}

try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    if (i === 79) throw new Error("Vite preview did not start");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch();
  for (const [name, width, height] of [["desktop", 1440, 1000], ["laptop", 1024, 768], ["tablet", 768, 1024], ["mobil", 390, 844], ["schmal", 320, 740]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => pageErrors.push(error.message));
    let neuerKontakt;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      let body;
      if (path === "/api/lukas/status") body = status;
      else if (path === "/api/healthz") body = { status: "ok" };
      else if (path === "/api/lukas/dashboard") body = dashboard;
      else if (path === "/api/lukas/telefon" && method === "POST") { neuerKontakt = route.request().postDataJSON(); body = { id: 2, ...neuerKontakt }; }
      else if (path === "/api/lukas/telefon") body = { anbieter: "telnyx", bereit: { webhook: true, anrufen: true },
        nummern: [{ id: 1, nummer: "4915112345678", name: "Max Muster", stufe: "oeffentlich", darfAngerufenWerden: true, aufnahmeZustimmung: true, aufnahmeQuelle: "homepage", aufnahmeBestaetigtAm: now, mithoerenZustimmung: true, mithoerenQuelle: "email", mithoerenBestaetigtAm: now }],
        anrufe: [{ id: 1, nummer: "4915112345678", richtung: "ausgehend", ergebnis: "beendet", dauer: 34, aufnahmeStatus: "completed", aufnahmeDauer: 34, createdAt: now }, { id: 2, nummer: "4915112345678", richtung: "ausgehend", ergebnis: "verbunden", mithoerenZustimmung: true, createdAt: now }] };
      else if (path === "/api/lukas/telefon/telnyx") body = { bereit: true, konfiguriert: true, freigeschaltet: true, nummer: "+49201123456", status: "active", hinweis: "Rufnummer aktiv." };
      else if (path === "/api/lukas/mcp") body = { servers: [
        { id: 1, name: "Kalender", slug: "calendar", url: "https://example.com/mcp", status: "connected", tools: [{ name: "read_calendar", description: "Termine lesen" }], selectedTools: [], riskTier: "R2", enabled: true, authorized: true },
        { id: 2, name: "Projektablage", slug: "files", url: "https://example.com/files", status: "error", lastError: "Verbindung abgelaufen", tools: [], selectedTools: [], riskTier: "R2", enabled: true, authorized: false },
      ] };
      else if (path === "/api/lukas/approvals") body = [
        { id: 1, tool: "email_send", riskTier: "R3", argumentsPreview: 'an: kunde@example.com\nbetreff: Angebot zur neuen Website', status: "pending", createdAt: now, expiresAt: new Date(Date.now() + 3600000).toISOString(), expired: false },
        { id: 2, tool: "file_read", riskTier: "R1", argumentsPreview: "Projektplan lesen", status: "used", createdAt: now, decidedAt: now, expired: false },
      ];
      else if (path === "/api/lukas/sms") body = { bereit: false, sms: [] };
      else if (path === "/api/lukas/wartet") body = { freigaben: [], meldungen: [], gesamt: { freigaben: 0, meldungen: 0 } };
      else if (path === "/api/anthropic/conversations" && method === "GET") body = conversations;
      else if (path === "/api/anthropic/conversations" && method === "POST") body = { id: 3, title: "Neues Gespräch", createdAt: now, updatedAt: now };
      else if (/^\/api\/anthropic\/conversations\/\d+$/.test(path)) {
        const id = Number(path.split("/").at(-1));
        body = { id, title: id === 3 ? "Neues Gespräch" : conversations.find((c) => c.id === id)?.title, messages: id === 3 ? [] : messages, laeuft: false, createdAt: now, updatedAt: now };
      } else if (/^\/api\/attachments\/\d+$/.test(path)) body = [];
      else if (path.endsWith("/messages") && method === "POST") { sent++; body = {}; }
      else { unexpected.push(method + " " + path); body = {}; }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(origin);
    await page.getByText(status.obsession, { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await noOverflow(page, "Dashboard " + name);
    if (name === "desktop" || name === "mobil") await screenshot(page, "dashboard-" + name);
    const question = page.getByRole("textbox", { name: "Frage an Lukas" });
    await question.fill("Ein Gedanke vom Dashboard");
    await page.getByRole("button", { name: "Senden", exact: true }).click();
    await page.getByRole("searchbox", { name: "Gespräche suchen" }).waitFor();
    await page.getByRole("searchbox", { name: "Gespräche suchen" }).fill("STUDIO");
    assert.equal(await page.locator(".chat-conversation-select").count(), 1, "Search should narrow the conversation list");
    const select = page.locator(".chat-conversation-select").filter({ hasText: "Ideen für das Studio" });
    await select.focus();
    await page.keyboard.press("Enter");
    const input = page.getByRole("textbox", { name: "Nachricht an Lukas" });
    await input.waitFor();
    assert.equal(await input.inputValue(), "Ein Gedanke vom Dashboard", "Draft survives the route change");
    await page.getByText(messages[3].content, { exact: true }).waitFor();
    await noOverflow(page, "Chat " + name);
    const box = await input.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height < height, "Composer remains in the viewport");
    await input.fill("");
    if (name === "desktop" || name === "mobil") await screenshot(page, "chat-" + name);
    if (width < 768) await page.getByRole("button", { name: "Zurück zur Liste" }).click();
    await page.getByRole("button", { name: "Neuer Chat", exact: true }).click();
    await page.getByRole("heading", { name: "Was hast du vor?" }).waitFor();
    await page.getByRole("button", { name: "Was ist heute wichtig?", exact: false }).click();
    assert.equal(await page.getByRole("textbox", { name: "Nachricht an Lukas" }).inputValue(), "Was ist heute wichtig?");
    assert.equal(sent, 0, "A suggestion must only fill the draft");
    await page.goto(origin + "/telefon");
    await page.getByRole("heading", { name: "Deine Kontakte" }).waitFor();
    const firstContact = await page.getByRole("heading", { name: "Max Muster", exact: true }).boundingBox();
    assert.ok(firstContact && firstContact.y < height - 70, "Erster Kontakt ohne langes Scrollen sichtbar");
    await noOverflow(page, "Telefon Kontakte " + name);
    if (name === "desktop" || name === "mobil") await screenshot(page, "telefon-kontakte-" + name);
    await page.getByRole("tab", { name: /Aufnahmen/ }).click();
    await page.getByRole("button", { name: /Aufnahme anhören/ }).waitFor();
    await noOverflow(page, "Telefon Aufnahmen " + name);
    if (name === "desktop" || name === "mobil") await screenshot(page, "telefon-aufnahmen-" + name);
    await page.getByRole("tab", { name: /Anrufe/ }).click();
    await page.getByRole("button", { name: "Live mithören", exact: true }).waitFor();
    await noOverflow(page, "Telefon Live " + name);
    if (name === "mobil") await screenshot(page, "telefon-live-" + name);
    await page.getByRole("tab", { name: /Kontakte/ }).click();
    await page.getByRole("button", { name: "Kontakt hinzufügen", exact: true }).click();
    await page.getByLabel("Telefonnummer", { exact: true }).fill("+491522222222");
    const phoneBox = await page.getByLabel("Telefonnummer", { exact: true }).boundingBox();
    assert.ok(phoneBox && phoneBox.height >= 39, "Telefonnummer bleibt auch mobil gut antippbar");
    await page.getByLabel("Kontaktname", { exact: true }).fill("Maria Muster");
    await page.getByLabel("Lukas darf diesen Kontakt anrufen", { exact: true }).check();
    await page.getByRole("dialog").getByLabel("Zustimmung zur Gesprächsaufzeichnung", { exact: false }).selectOption("email");
    await page.getByRole("dialog").getByLabel("Schriftliche Zustimmung zum Live-Mithören", { exact: false }).selectOption("homepage");
    if (name === "mobil") await screenshot(page, "telefon-kontakt-neu-" + name);
    await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(neuerKontakt.name, "Maria Muster");
    assert.equal(neuerKontakt.aufnahmeZustimmung, true);
    assert.equal(neuerKontakt.aufnahmeQuelle, "email");
    assert.equal(neuerKontakt.darfAngerufenWerden, true);
    assert.equal(neuerKontakt.mithoerenZustimmung, true);
    assert.equal(neuerKontakt.mithoerenQuelle, "homepage");
    await page.goto(origin + "/mcp");
    await page.getByText("Kalender", { exact: true }).waitFor();
    await noOverflow(page, "Verbindungen " + name);
    if (name === "desktop" || name === "mobil") await screenshot(page, "verbindungen-" + name);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    assert.equal(await page.getByText("Kalender", { exact: true }).count(), 0);
    await page.getByText("Projektablage", { exact: true }).waitFor();
    await page.goto(origin + "/approvals");
    await page.getByText("email_send", { exact: true }).waitFor();
    await noOverflow(page, "Freigaben " + name);
    if (name === "desktop" || name === "mobil") await screenshot(page, "freigaben-" + name);
    await page.getByRole("button", { name: /^Verlauf/ }).click();
    await page.getByText("file_read", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Erlauben", exact: true }).count(), 0);
    if (width < 768) {
      await page.getByRole("button", { name: "Weitere Bereiche öffnen" }).click();
      await page.getByRole("searchbox", { name: "Bereiche suchen" }).fill("Verbindungen");
      await page.getByRole("dialog").getByRole("link", { name: "Verbindungen", exact: true }).click();
      await page.getByRole("heading", { name: "Verbindungen", exact: true }).waitFor();
      assert.equal(await page.getByRole("dialog").count(), 0);
    }
    console.log("OK — " + name + " (" + width + " px): layout, search, keyboard selection, draft handoff, suggestion.");
    await context.close();
  }
  assert.deepEqual(unexpected, [], "Unexpected API calls in the isolated UI check");
  assert.deepEqual(pageErrors, [], "Browser runtime errors");
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
}
