/*
 * Das Skript, mit dem Lukas eine Seite BEDIENT — nicht nur liest.
 *
 * browse.cjs (siehe browser-script.ts) oeffnet eine Seite, scrollt und gibt
 * zurueck, was draufsteht. Fuer eine Galerie reicht das. Fuer alles, was hinter
 * einer Anmeldung liegt oder ein Formular verlangt, reicht es nicht: dort muss
 * jemand klicken, tippen und absenden.
 *
 * Zwei Entscheidungen, die den Unterschied machen:
 *
 *  1. DAUERHAFTES PROFIL. launchPersistentContext statt launch: Cookies,
 *     LocalStorage und angemeldete Sitzungen liegen unter /browser/profile/<name>
 *     und ueberleben den naechsten Aufruf — und, ueber das Docker-Volume, auch
 *     den naechsten Containerstart. Ohne das muesste sich Lukas bei jedem
 *     einzelnen Werkzeugaufruf neu anmelden, was bei Diensten mit
 *     Bestaetigungsmail schlicht nicht geht.
 *
 *  2. ZUGANGSDATEN KOMMEN NIE DURCH DAS MODELL. Im Schrittplan steht nur
 *     {{BENUTZER}} oder {{PASSWORT}}; der echte Wert wird HIER eingesetzt, aus
 *     einer Umgebungsvariablen des Containers. Damit steht das Passwort weder
 *     im Prompt noch im Gespraechsverlauf noch in einem Protokoll — und ein
 *     fremder Text, der Lukas zum Ausplaudern bringen will, hat nichts zu
 *     holen: er kennt es selbst nicht.
 *
 * Jeder Schritt wird einzeln berichtet. Ein fehlgeschlagener Klick ist kein
 * Abbruch mit leerem Ergebnis, sondern eine Zeile "Schritt 3: Knopf nicht
 * gefunden" — damit Lukas beim naechsten Versuch etwas anderes probieren kann,
 * statt zu raten.
 */
export const BROWSER_OPERATOR_SCRIPT = String.raw`
const { chromium } = require('playwright');
const fs = require('fs');

const profil = process.argv[2] || 'standard';
const plan = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

/*
 * WO darf welcher Wert eingesetzt werden.
 *
 * DIE LUECKE, DIE DAS SCHLIESST: der Wert war an einen SITZUNGSNAMEN gebunden,
 * und den waehlt Lukas selbst. Ein Schrittplan durfte also erst irgendeine
 * Seite oeffnen und dann {{PASSWORT}} in ein Feld dort tippen — hier wurde der
 * echte Wert eingesetzt, ohne je zu pruefen, wo er landet.
 *
 * Dass Lukas den Wert nicht kennt, half GAR NICHTS: er musste ihn nicht
 * kennen, dieses Skript hat ihn eingesetzt. Eine praeparierte Seite ("melde
 * dich hier an, um fortzufahren") haette gereicht, um Issas Passwort an einen
 * Fremden zu tippen.
 *
 * Geprueft wird gegen die TATSAECHLICHE Adresse der offenen Seite, nicht gegen
 * das, was im Plan steht: eine Weiterleitung nach dem Oeffnen wuerde sonst
 * daran vorbeifuehren.
 */
const HOST_BINDUNG = Object.fromEntries(
  (process.env.LUKAS_WEB_HOSTS || '')
    .split(',')
    .filter(Boolean)
    .map((teil) => {
      const i = teil.indexOf('=');
      return [teil.slice(0, i), teil.slice(i + 1)];
    }),
);

function hostPasst(seiteUrl, erlaubt) {
  if (!erlaubt) return true; // Kein Host hinterlegt: alter Bestand, gilt ueberall.
  try {
    const wo = new URL(seiteUrl).hostname.toLowerCase().replace(/^www\./, '');
    const soll = String(erlaubt).toLowerCase().replace(/^www\./, '');
    // Unterdomaenen gelten mit — "app.higgsfield.ai" bei "higgsfield.ai".
    // Aber NICHT "higgsfield.ai.boese.example": deshalb der Punkt davor.
    return wo === soll || wo.endsWith('.' + soll);
  } catch {
    return false;
  }
}

/*
 * Platzhalter fuellen. Steht die Variable nicht im Container, bleibt der
 * Platzhalter stehen — dann scheitert der Schritt sichtbar, statt still einen
 * leeren Wert einzutippen.
 *
 * seiteUrl ist die Adresse, auf der gerade getippt wird. Fehlt sie (etwa
 * beim Oeffnen selbst), wird NICHT eingesetzt, was an einen Host gebunden ist:
 * im Zweifel lieber ein sichtbar gescheiterter Schritt als ein Passwort an der
 * falschen Stelle.
 */
function fuelle(text, seiteUrl) {
  if (typeof text !== 'string') return text;
  let verweigert = null;
  const gefuellt = text.replace(/\{\{([A-Z_]+)\}\}/g, (ganz, name) => {
    const wert = process.env['LUKAS_WEB_' + name];
    if (wert === undefined) return ganz;
    const erlaubt = HOST_BINDUNG[name];
    if (erlaubt && !hostPasst(seiteUrl, erlaubt)) {
      verweigert = { name, erlaubt, wo: seiteUrl };
      return ganz;
    }
    return wert;
  });
  if (verweigert) {
    throw new Error(
      'Der Wert {{' + verweigert.name + '}} ist an ' + verweigert.erlaubt +
      ' gebunden und wird auf ' + (verweigert.wo || 'einer unbekannten Adresse') +
      ' NICHT eingesetzt. Das ist Absicht: so kann ein Schrittplan ein Passwort ' +
      'nicht auf einer fremden Seite eintippen.',
    );
  }
  return gefuellt;
}

// Ein Ziel finden: erst als CSS-Auswahl, sonst ueber den sichtbaren Text.
async function ziel(page, wahl) {
  if (!wahl) return null;
  if (wahl.startsWith('text=') || wahl.startsWith('//')) return page.locator(wahl).first();
  const alsCss = page.locator(wahl).first();
  if (await alsCss.count().catch(() => 0)) return alsCss;
  return page.getByText(wahl, { exact: false }).first();
}

(async () => {
  const verzeichnis = '/browser/profile/' + profil.replace(/[^a-z0-9_-]/gi, '_');
  fs.mkdirSync(verzeichnis, { recursive: true });

  const ctx = await chromium.launchPersistentContext(verzeichnis, {
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    viewport: { width: 1440, height: 1000 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    locale: 'de-DE',
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  const bericht = [];
  let abgebrochen = false;

  for (let i = 0; i < plan.length && !abgebrochen; i++) {
    const s = plan[i];
    const nummer = i + 1;
    try {
      switch (s.art) {
        case 'oeffne': {
          const antwort = await page.goto(fuelle(s.url, null), { waitUntil: 'domcontentloaded', timeout: 45000 });
          try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch {}
          bericht.push({ nummer, art: s.art, ok: true, info: 'HTTP ' + (antwort ? antwort.status() : '?') + ' ' + page.url() });
          break;
        }
        case 'klicke': {
          const el = await ziel(page, s.wahl);
          await el.click({ timeout: s.timeout || 10000 });
          try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
          bericht.push({ nummer, art: s.art, ok: true, info: 'geklickt: ' + s.wahl });
          break;
        }
        case 'tippe': {
          const el = await ziel(page, s.wahl);
          await el.click({ timeout: 8000 }).catch(() => {});
          await el.fill(fuelle(s.text, page.url()), { timeout: s.timeout || 10000 });
          // Absichtlich ohne den Wert: hier stuende sonst das Passwort.
          bericht.push({ nummer, art: s.art, ok: true, info: 'ausgefüllt: ' + s.wahl });
          break;
        }
        case 'taste': {
          await page.keyboard.press(s.taste || 'Enter');
          try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
          bericht.push({ nummer, art: s.art, ok: true, info: 'Taste ' + (s.taste || 'Enter') });
          break;
        }
        case 'waehle': {
          const el = await ziel(page, s.wahl);
          await el.selectOption(fuelle(s.wert, page.url()), { timeout: 10000 });
          bericht.push({ nummer, art: s.art, ok: true, info: 'gewählt: ' + s.wert });
          break;
        }
        case 'lade_hoch': {
          const el = await ziel(page, s.wahl);
          await el.setInputFiles(s.datei, { timeout: 30000 });
          bericht.push({ nummer, art: s.art, ok: true, info: 'Datei gesetzt: ' + s.datei });
          break;
        }
        case 'scrolle': {
          const wie = Number(s.anzahl || 3);
          for (let k = 0; k < wie; k++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
            await page.waitForTimeout(350);
          }
          bericht.push({ nummer, art: s.art, ok: true, info: wie + '× gescrollt' });
          break;
        }
        case 'warte': {
          if (s.wahl) {
            await page.locator(s.wahl).first().waitFor({ state: 'visible', timeout: s.timeout || 20000 });
            bericht.push({ nummer, art: s.art, ok: true, info: 'sichtbar: ' + s.wahl });
          } else {
            await page.waitForTimeout(Math.min(Number(s.ms || 1000), 15000));
            bericht.push({ nummer, art: s.art, ok: true, info: 'gewartet' });
          }
          break;
        }
        default:
          bericht.push({ nummer, art: s.art, ok: false, info: 'unbekannter Schritt' });
      }
    } catch (err) {
      const grund = String((err && err.message) || err).split('\n')[0].slice(0, 200);
      bericht.push({ nummer, art: s.art, ok: false, info: grund });
      // Nach einem Fehlschlag weiterzuklicken ist gefaehrlich: die Seite ist
      // dann nicht die, die der Plan annimmt.
      abgebrochen = true;
    }
  }

  const daten = await page.evaluate(() => {
    for (const weg of document.querySelectorAll('script,style,noscript,svg')) weg.remove();
    const text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
    const felder = [...document.querySelectorAll('input,textarea,select,button,[role=button]')]
      .filter((e) => e.offsetParent !== null)
      .slice(0, 60)
      .map((e) => {
        const art = e.tagName.toLowerCase() + (e.type ? ':' + e.type : '');
        const name = e.name || e.id || e.getAttribute('aria-label') || (e.innerText || '').trim().slice(0, 40);
        return art + ' ' + (name || '(ohne Namen)');
      });
    return { titel: document.title, text, felder };
  });

  /*
   * Und ein Bild. Ohne das arbeitet Lukas blind: der Text einer Seite sagt
   * nichts darueber, ob der Knopf ueberhaupt sichtbar war, ob ein Overlay
   * davorliegt oder ob nach dem Absenden ein Fehler in Rot dasteht. JPEG mit
   * mittlerer Qualitaet, weil ein PNG dieser Groesse den Kontext sprengt.
   */
  let bild = null;
  let maskierung = null;
  if (plan.some((s) => s.art === 'oeffne' || s.art === 'klicke' || s.art === 'tippe') || plan.length === 0) {
    try {
      /*
       * Passwortfelder vor dem Foto leeren.
       *
       * Der Text der Seite wird sorgfaeltig ohne den Wert berichtet — und
       * dann ging er ueber das Bild doch hinaus. Browser maskieren
       * Passwortfelder zwar mit Punkten, aber ein "Passwort anzeigen"-Schalter
       * hebt das auf, und manche Seiten benutzen ein type=text-Feld mit einer
       * eigenen Maskierung, die auf einem Bildschirmfoto gar nichts verdeckt.
       *
       * Geleert wird nur fuer die Aufnahme, danach wieder eingesetzt: das
       * Formular soll ja abgeschickt werden koennen. Das ist der Grund, warum
       * hier nicht einfach ein CSS-Filter drueberliegt — der waere weg, sobald
       * die Seite neu zeichnet.
       */
      maskierung = await page.evaluate(() => {
        const felder = [...document.querySelectorAll('input')].filter(
          (e) =>
            e.type === 'password' ||
            /pass|pwd|kennwort|secret/i.test(e.name + ' ' + e.id + ' ' + (e.autocomplete || '')),
        );
        const gemerkt = felder.map((e) => e.value);
        for (const e of felder) e.value = '';
        window.__lukasGemerkt = gemerkt;
        /*
         * Zurueckgemeldet wird, was NACH dem Leeren tatsaechlich in den
         * Feldern steht. Das ist der einzige Wert, der eine Pruefung erlaubt:
         * eine blosse Anzahl waere auch dann noch da, wenn die Zeile zum
         * Leeren fehlt. So steht im Bericht, wie die Seite im Moment der
         * Aufnahme wirklich aussah.
         */
        return { gefunden: felder.length, restInhalt: felder.map((e) => e.value).join("") };
      });

      const puffer = await page.screenshot({ type: 'jpeg', quality: 55, fullPage: false });

      if (maskierung.gefunden > 0) {
        await page.evaluate(() => {
          const felder = [...document.querySelectorAll('input')].filter(
            (e) =>
              e.type === 'password' ||
              /pass|pwd|kennwort|secret/i.test(e.name + ' ' + e.id + ' ' + (e.autocomplete || '')),
          );
          const gemerkt = window.__lukasGemerkt || [];
          felder.forEach((e, i) => { e.value = gemerkt[i] ?? e.value; });
          delete window.__lukasGemerkt;
        });
      }
      bild = puffer.toString('base64');
    } catch (err) {
      bild = null;
    }
  }

  console.log(JSON.stringify({
    ok: !abgebrochen,
    bild,
    // Wie viele Passwortfelder es gab und was beim Ausloesen darin stand —
    // damit sich pruefen laesst, dass das Bild sie nicht zeigt.
    maskierung: typeof maskierung === "undefined" ? null : maskierung,
    url: page.url(),
    titel: daten.titel,
    schritte: bericht,
    felder: daten.felder,
    text: daten.text.slice(0, 12000),
  }));

  await ctx.close();
})().catch((err) => {
  console.log(JSON.stringify({ ok: false, fehler: String((err && err.message) || err) }));
  process.exit(0);
});
`;
