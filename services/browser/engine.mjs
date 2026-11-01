import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { publicTarget } from './proxy.mjs';

export async function extractSearchResults(page, kind) {
  return page.evaluate(kind => {
    const nodes = kind === 'bing' ? [...document.querySelectorAll('li.b_algo')] : kind === 'google' ? [...document.querySelectorAll('a:has(h3)')] : [...document.querySelectorAll('.result')];
    return nodes.map(item => {
      const anchor = kind === 'bing' ? item.querySelector('h2 a') : kind === 'google' ? item : item.querySelector('a.result__a');
      if (!anchor) return null;
      let url = anchor.href;
      try { const parsed = new URL(url); url = parsed.searchParams.get('uddg') || (parsed.pathname === '/url' ? parsed.searchParams.get('q') || parsed.searchParams.get('url') : '') || url; } catch { return null; }
      const title = (kind === 'google' ? item.querySelector('h3') : anchor)?.textContent?.trim();
      const snippet = (kind === 'bing' ? item.querySelector('p') : kind === 'ddg' ? item.querySelector('.result__snippet') : null)?.textContent?.trim() || '';
      return title && /^https?:\/\//.test(url) ? {title, url, snippet} : null;
    }).filter(Boolean).slice(0,8);
  }, kind);
}

export function createEngine(proxyPort, dataDir, configureContext = async () => {}) {
  const sessions = new Map();
  let active = 0;
  const args = ['--disable-dev-shm-usage', '--disable-quic', '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];
  const launch = {
    headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined, args, proxy: { server: `http://127.0.0.1:${proxyPort}` },
    viewport: { width: 1440, height: 1000 }, locale: 'de-DE', acceptDownloads: false,
    serviceWorkers: 'block',
    // API authentication and Railway secrets must never enter Chromium's env.
    env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '/tmp', LANG: 'C.UTF-8' },
  };
  const clean = (text, state) => {
    let result = String(text || '');
    for (const secret of state.secrets) if (secret) result = result.split(secret).join('[geschützt]');
    return result;
  };
  async function close(key) {
    const state = sessions.get(key);
    if (!state) return;
    sessions.delete(key);
    await state.context.close().catch(() => {});
  }
  async function session(name) {
    const key = createHash('sha256').update(name).digest('hex');
    if (sessions.get(key)?.busy) throw new Error('Diese Browsersitzung arbeitet bereits. Nicht parallel wiederholen.');
    if (sessions.has(key)) return sessions.get(key);
    if (sessions.size >= 3) {
      const idle = [...sessions].filter(([,s]) => !s.busy).sort((a,b) => a[1].used - b[1].used)[0];
      if (!idle) throw new Error('Browser ausgelastet. Später erneut versuchen.');
      await close(idle[0]);
    }
    // Reserve before awaiting launch so simultaneous calls cannot open a profile twice.
    const state = { key, busy: true, used: Date.now(), secrets: new Set(), context: null, page: null };
    sessions.set(key, state);
    try {
      const dir = resolve(dataDir, 'profiles', key);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      state.context = await chromium.launchPersistentContext(dir, launch);
      state.context.setDefaultTimeout(10000);
      await state.context.route('**/*', async route => {
        if (!/^https?:/.test(route.request().url())) return route.abort();
        return route.continue(); // public IP enforcement is in the mandatory proxy
      });
      await configureContext(state.context);
      state.context.on('page', page => { page.on('dialog', dialog => dialog.dismiss().catch(() => {})); });
      state.page = state.context.pages()[0] || await state.context.newPage();
      state.page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
      state.lastFile = resolve(dataDir, 'profiles', key, 'last-url.json');
      try { state.lastUrl = JSON.parse(await readFile(state.lastFile, 'utf8')); } catch {}
      state.busy = false;
      return state;
    } catch (error) { sessions.delete(key); await state.context?.close().catch(() => {}); throw error; }
  }
  async function target(page, selector) {
    if (typeof selector !== 'string' || !selector.trim()) throw new Error('Elementauswahl fehlt.');
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) return locator;
    return page.getByText(selector, { exact: false }).first();
  }
  async function navigate(page, url) {
    await publicTarget(url);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
    return response?.status() ?? null;
  }
  async function snapshot(state, picture) {
    const page = state.page;
    const data = await page.evaluate(() => ({
      titel: document.title, text: (document.body?.innerText || '').slice(0, 20000),
      links: [...new Set([...document.querySelectorAll('a[href]')].map(a => `${(a.innerText || '').trim().slice(0,100)} -> ${a.href}`))].slice(0, 150),
      medien: [...new Set([...document.querySelectorAll('img,video,video source')].map(e => e.currentSrc || e.src).filter(Boolean))].slice(0,80),
      felder: [...document.querySelectorAll('input,textarea,select,button,a,[role=button]')].filter(e => e.getClientRects().length).slice(0,80).map(e => `${e.tagName.toLowerCase()}${e.type ? ':' + e.type : ''} ${e.id ? '#' + e.id : e.name || e.getAttribute('aria-label') || (e.innerText || '').trim().slice(0,80)}`),
    }));
    let bild = null;
    // A page can echo a filled secret anywhere, not only in password fields.
    // Suppress pictures for credential-bearing sessions; text is redacted below.
    if (picture && !state.secrets.size) bild = (await page.screenshot({ type: 'jpeg', quality: 50, timeout: 5000, mask: [page.locator('input[type=password]')] }).catch(() => null))?.toString('base64') || null;
    const url = page.url();
    if (/^https?:/.test(url)) await writeFile(state.lastFile, JSON.stringify(url), { mode: 0o600 });
    return JSON.parse(clean(JSON.stringify({ ...data, url, bild }), state));
  }
  async function run(operation, input) {
    if (active >= 2) throw new Error('Browser ausgelastet. Später erneut versuchen.');
    if (operation === 'operate' && (!Array.isArray(input.schritte) || input.schritte.length < 1 || input.schritte.length > 40)) throw new Error('1 bis 40 Schritte erforderlich.');
    const name = operation === 'operate' ? input.sitzung : `read-${crypto.randomUUID()}`;
    if (typeof name !== 'string' || name.length > 200) throw new Error('Ungültige Sitzung.');
    active++;
    let state, timer;
    try {
      state = await session(name); state.busy = true;
      timer = setTimeout(() => { void close(state.key); }, 150000);
      let page = state.page;
      let status = null;
      if (operation === 'search') {
        const query = encodeURIComponent(String(input.query || '').slice(0,1000));
        const providers = [
          {kind:'bing',url:'https://www.bing.com/search?q='+query,selector:'li.b_algo h2 a'},
          {kind:'google',url:'https://www.google.com/search?q='+query,selector:'a:has(h3)'},
          {kind:'ddg',url:'https://html.duckduckgo.com/html/?q='+query,selector:'a.result__a'},
        ];
        for (const provider of providers) {
          try {
            status = await navigate(page, provider.url);
            if (status && status >= 400) continue;
            await page.locator(provider.selector).first().waitFor({state:'visible',timeout:5000}).catch(()=>{});
            const results = await extractSearchResults(page, provider.kind);
            if (results.length) return {ok:true,results,provider:provider.kind};
          } catch { /* Try a different public search provider; never solve a challenge. */ }
        }
        return {ok:false,fehler:'Die Suchanbieter liefern keine lesbaren Treffer oder verlangen eine Browserprüfung. Keine Ergebnisse verifiziert.'};
      }
      if (operation === 'render') {
        status = await navigate(page, input.url);
        if (status && status >= 400) return { ok: false, status, fehler: `Website antwortet mit HTTP ${status}.` };
        const scrolls = Math.max(0, Math.min(20, Number(input.scrolls) || 0));
        let height = 0;
        for (let i=0; i<scrolls; i++) {
          const next = await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); return document.body.scrollHeight; });
          await page.waitForTimeout(400);
          if (next === height) break;
          height = next;
        }
        return { ok: true, status, ...await snapshot(state, false) };
      }
      const credentials = input.zugang || {};
      if (typeof credentials !== 'object' || Array.isArray(credentials)) throw new Error('Ungültige Zugangsdaten.');
      for (const value of Object.values(credentials)) if (typeof value === 'string' && value) state.secrets.add(value);
      const fill = value => String(value || '').replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_all, name) => {
        if (typeof credentials[name] !== 'string') throw new Error(`Zugang ${name} fehlt.`);
        return credentials[name];
      });
      // Validate every placeholder before taking any action.
      for (const step of input.schritte) for (const value of [step.url, step.text, step.wert]) if (value !== undefined) fill(value);
      if (page.url() === 'about:blank' && input.schritte[0].art !== 'oeffne' && state.lastUrl) await navigate(page, state.lastUrl);
      const steps = [];
      for (const [index, step] of input.schritte.entries()) {
        try {
          switch(step.art) {
            case 'oeffne': status = await navigate(page, fill(step.url)); if (status >= 400) throw new Error(`HTTP ${status}`); break;
            case 'klicke': { const popup = page.waitForEvent('popup', {timeout:1500}).catch(() => null); await (await target(page, step.wahl)).click(); const opened = await popup; if (opened) { state.page = opened; page = opened; await opened.waitForLoadState('domcontentloaded'); } break; }
            case 'tippe': await (await target(state.page, step.wahl)).fill(fill(step.text)); break;
            case 'taste': await state.page.keyboard.press(step.taste || 'Enter'); break;
            case 'waehle': await (await target(state.page, step.wahl)).selectOption(fill(step.wert)); break;
            case 'lade_hoch': {
              const root = await realpath(resolve(dataDir,'uploads'));
              const file = await realpath(resolve(root,String(step.datei || '')));
              if (!file.startsWith(root + sep)) throw new Error('Datei muss im Browser-Uploadordner liegen.');
              await (await target(state.page,step.wahl)).setInputFiles(file); break;
            }
            case 'scrolle': for(let i=0;i<Math.max(0,Math.min(20,Number(step.anzahl)||3));i++) { await state.page.evaluate(() => window.scrollBy(0,innerHeight*0.9)); await state.page.waitForTimeout(200); } break;
            case 'warte': if(step.wahl) await (await target(state.page,step.wahl)).waitFor({state:'visible',timeout:Math.min(20000,Number(step.timeout)||10000)}); else await state.page.waitForTimeout(Math.min(15000,Math.max(0,Number(step.ms)||1000))); break;
            default: throw new Error('Unbekannter Browserschritt.');
          }
          steps.push({ nummer:index+1, art:step.art, ok:true, info:'ausgeführt' });
        } catch { steps.push({ nummer:index+1, art:step.art, ok:false, info:'Schritt fehlgeschlagen; nicht automatisch wiederholt. Seitenzustand prüfen.' }); break; }
      }
      return { ok: steps.length === input.schritte.length && steps.every(s=>s.ok), schritte: steps, ...await snapshot(state,true) };
    } catch { return { ok:false, fehler:'Browserauftrag fehlgeschlagen. Erreichbarkeit, Seitenzugriff oder Sitzung prüfen; ausgeführte Aktionen nicht blind wiederholen.' }; }
    finally { clearTimeout(timer); active--; if(state) { state.busy=false; state.used=Date.now(); if(operation!=='operate') await close(state.key); } }
  }
  const cleanup = setInterval(() => { for(const [key,state] of sessions) if(!state.busy && Date.now()-state.used>600000) void close(key); },60000);
  cleanup.unref();
  return { run, async ready() { const b=await chromium.launch(launch); try { const p=await b.newPage(); await p.setContent('<body><script>document.body.dataset.ready="yes"</script></body>'); if(await p.locator('body').getAttribute('data-ready')!=='yes') throw new Error('Browser probe failed'); } finally { await b.close(); } }, async close() { clearInterval(cleanup); await Promise.all([...sessions.keys()].map(close)); } };
}
