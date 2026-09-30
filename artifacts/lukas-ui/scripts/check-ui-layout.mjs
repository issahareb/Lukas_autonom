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
  const bad = await page.locator(".app-shell, .app-scroll, .home-page, .home-columns, .chat-page, .chat-workspace, .chat-scroll, .chat-conversation-list").evaluateAll((nodes) => nodes.filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1).map((el) => ({ element: el.className, client: el.clientWidth, scroll: el.scrollWidth })));
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
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      let body;
      if (path === "/api/lukas/status") body = status;
      else if (path === "/api/healthz") body = { status: "ok" };
      else if (path === "/api/lukas/dashboard") body = dashboard;
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
    const select = page.getByRole("button", { name: /Ideen für das Studio/ });
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
    console.log("OK — " + name + " (" + width + " px): layout, search, keyboard selection, draft handoff, suggestion.");
    await context.close();
  }
  assert.deepEqual(unexpected, [], "Unexpected API calls in the isolated UI check");
  assert.deepEqual(pageErrors, [], "Browser runtime errors");
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
}
