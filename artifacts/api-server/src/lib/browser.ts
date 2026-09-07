import { randomBytes } from "node:crypto";
import { sshExec, shQuote } from "./code-sandbox";
import { BROWSER_SCRIPT } from "./browser-script";
import { BROWSER_OPERATOR_SCRIPT } from "./browser-operator-script";
import { logger } from "./logger";

/*
 * Ein echter Browser fuer Lukas.
 *
 * fetch_url holt nur das rohe HTML. Bei Higgsfield — und bei so ziemlich jeder
 * modernen Seite — ist das eine leere Huelle: der Inhalt entsteht erst im
 * Browser. Lukas hat deshalb wahrheitsgemaess gemeldet, er sehe die Prompts und
 * Assets nicht. Er konnte sie nicht sehen.
 *
 * WO das laeuft: in einem eigenen Container auf Issas Droplet, nicht auf
 * Railway. Zwei Gruende. Erstens ist dort ohnehin schon die Ausfuehrungsumgebung
 * mit SSH-Zugang; ein Browser auf Railway waere ein zweiter Ort mit eigener
 * Installation. Zweitens ist ein Browser, der fremde Seiten oeffnet, genau die
 * Sorte Programm, die man nicht neben dem eigenen Server laufen laesst.
 *
 * Der Container ist langlebig und wird NICHT vom Idle-Cleanup erfasst (anderes
 * Label): die Erstinstallation dauert einige Minuten, die will man nicht alle
 * 15 Minuten erneut bezahlen.
 */

const CONTAINER = "lukas-browser";
const IMAGE = process.env.LUKAS_BROWSER_IMAGE ?? "node:22-bookworm-slim";
const NETWORK = "lukas-sandbox";

/*
 * In welchem Zustand ist der Container?
 *
 * Vorher wurde nur `docker ps` gefragt — das listet ausschliesslich LAUFENDE
 * Container. Ein gestoppter oder gerade angelegter Container war damit
 * "nicht da", also wurde ein neuer erzeugt, und Docker antwortete mit
 * "The container name /lukas-browser is already in use". Genau dieser Fehler
 * stand im Dashboard.
 */
async function zustand(): Promise<"laeuft" | "gestoppt" | "fehlt"> {
  const r = await sshExec(
    `docker ps -a --filter name=^/${CONTAINER}$ --format '{{.State}}'`,
    20000,
  );
  const s = r.stdout.trim().split("\n")[0]?.trim() ?? "";
  if (!s) return "fehlt";
  return s === "running" ? "laeuft" : "gestoppt";
}

/** Läuft der Browser darin auch wirklich? Ein Container allein genügt nicht. */
async function browserBereit(): Promise<boolean> {
  const r = await sshExec(
    `docker exec ${CONTAINER} sh -lc ${shQuote(
      "cd /browser && node -e \"require('playwright').chromium.executablePath()\" >/dev/null 2>&1 && echo ja",
    )}`,
    60000,
  );
  return r.stdout.includes("ja");
}

/*
 * Beim allerersten Mal wird installiert: playwright plus Chromium samt
 * Systempaketen. Das dauert und darf deshalb grosszuegig Zeit bekommen.
 *
 * Bewusst kein fertiges Playwright-Image: dessen Tag muss zur installierten
 * Playwright-Version passen, und eine falsch geratene Version scheitert erst
 * beim ersten Aufruf. `npx playwright install` holt genau den Browser, der zur
 * gerade installierten Bibliothek gehoert — da kann nichts auseinanderlaufen.
 */
async function starteContainer(): Promise<void> {
  await sshExec(`docker network create ${NETWORK} 2>/dev/null || true`, 30000);

  // Erst versuchen, einen vorhandenen wieder zu starten. Wegwerfen und neu
  // bauen hiesse, die Browser-Installation noch einmal zu bezahlen.
  if ((await zustand()) === "gestoppt") {
    const an = await sshExec(`docker start ${CONTAINER}`, 60000);
    if (an.code === 0 && (await browserBereit())) return;
  }

  // Erst jetzt wegwerfen — und mit `|| true`, damit ein Rest den Neuaufbau
  // nicht blockiert.
  await sshExec(`docker rm -f ${CONTAINER} 2>/dev/null || true`, 60000);

  const start = await sshExec(
    [
      "docker run -d",
      `--name ${CONTAINER}`,
      "--label lukas-browser=1",
      `--network ${NETWORK}`,
      // Chromium braucht mehr als die Sandbox: eigene Prozesse pro Tab,
      // und /dev/shm ist im Standard viel zu klein fuer eine Renderengine.
      "--shm-size 1g",
      "--memory 3g --memory-swap 3g --cpus 2 --pids-limit 2048",
      "--security-opt no-new-privileges:true",
      "--workdir /browser",
      /*
       * Ein benanntes Volume fuer die Browser-Profile.
       *
       * Ohne das ist jede Anmeldung beim naechsten Containerstart weg — und
       * genau die soll halten: Issa meldet sich einmal an (bzw. Lukas mit
       * hinterlegten Zugangsdaten), danach bleibt die Sitzung bestehen wie in
       * einem echten Browser.
       */
      "-v lukas-browser-profile:/browser/profile",
      IMAGE,
      "sleep infinity",
    ].join(" "),
    120000,
  );
  if (start.code !== 0) {
    throw new Error(`Browser-Container startet nicht: ${start.stderr.slice(0, 300)}`);
  }

  logger.info("Browser wird im Container eingerichtet — das dauert beim ersten Mal einige Minuten");

  /*
   * chromium UND chromium-headless-shell.
   *
   * Ab Playwright 1.49 ist die Headless-Variante ein eigenes Paket. `install
   * chromium` allein holt sie NICHT, und im Headless-Betrieb startet Playwright
   * genau sie. Das Ergebnis stand im Dashboard: "Executable doesn't exist at
   * …/chromium_headless_shell-1148/…". Die Installation meldete Erfolg, der
   * Browser fehlte trotzdem.
   */
  const setup = await sshExec(
    `docker exec ${CONTAINER} sh -lc ${shQuote(
      "mkdir -p /browser && cd /browser && npm init -y >/dev/null 2>&1 && " +
        "npm i playwright@1.49.1 >/dev/null 2>&1 && " +
        "npx playwright install --with-deps chromium chromium-headless-shell",
    )}`,
    900000,
  );
  if (setup.code !== 0) {
    await sshExec(`docker rm -f ${CONTAINER} 2>/dev/null || true`, 30000);
    throw new Error(`Browser-Installation fehlgeschlagen: ${setup.stderr.slice(0, 500)}`);
  }

  /*
   * Nachsehen, ob wirklich ein Browser da ist.
   *
   * Die Installation hat schon einmal Erfolg gemeldet, ohne dass danach ein
   * Browser existierte. Eine Erfolgsmeldung ist keine Pruefung — der Startversuch
   * ist eine.
   */
  const probe = await sshExec(
    `docker exec ${CONTAINER} sh -lc ${shQuote(
      "cd /browser && node -e \"require('playwright').chromium.launch().then(b=>b.close()).then(()=>console.log('bereit'))\"",
    )}`,
    180000,
  );
  if (!probe.stdout.includes("bereit")) {
    throw new Error(
      `Der Browser lässt sich nach der Installation nicht starten:\n` +
        `${(probe.stderr || probe.stdout).slice(0, 600)}`,
    );
  }
  logger.info("Browser-Container ist bereit");
}

/*
 * Nur EINE Einrichtung gleichzeitig.
 *
 * Zwei parallele Aufrufe haben beide "kein Container" gesehen und beide einen
 * angelegt — der zweite lief in "name is already in use". Solange eine
 * Einrichtung laeuft, warten alle anderen auf dasselbe Versprechen.
 */
let laufendeEinrichtung: Promise<void> | null = null;

export async function ensureBrowser(): Promise<void> {
  if ((await zustand()) === "laeuft" && (await browserBereit())) return;

  if (!laufendeEinrichtung) {
    laufendeEinrichtung = starteContainer().finally(() => {
      laufendeEinrichtung = null;
    });
  }
  await laufendeEinrichtung;
}

export type BrowseErgebnis = {
  ok: boolean;
  fehler?: string;
  status?: number | null;
  url?: string;
  titel?: string;
  text?: string;
  links?: string[];
  medien?: string[];
  mehrGeklickt?: number;
};

/**
 * Eine Seite wirklich oeffnen: warten bis sie gebaut ist, scrollen, "Mehr
 * laden" druecken, und dann Text, Links und Medien herausgeben.
 */
export async function renderPage(url: string, scrolls = 12): Promise<BrowseErgebnis> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Nur http/https URLs sind erlaubt");
  }
  await ensureBrowser();

  // Skript bei jedem Aufruf frisch hineinschreiben: so gilt immer die Fassung
  // aus diesem Repo, auch wenn der Container aus einem alten Deploy stammt.
  const schreiben = await sshExec(
    `docker exec -i ${CONTAINER} sh -lc ${shQuote("cat > /browser/browse.cjs")}`,
    60000,
    BROWSER_SCRIPT,
  );
  if (schreiben.code !== 0) {
    throw new Error(`Browser-Skript liess sich nicht ablegen: ${schreiben.stderr.slice(0, 300)}`);
  }

  const lauf = await sshExec(
    `docker exec ${CONTAINER} sh -lc ${shQuote(
      `cd /browser && node browse.cjs ${shQuote(url)} ${Number(scrolls) || 12}`,
    )}`,
    180000,
  );

  const zeile = lauf.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  try {
    return JSON.parse(zeile) as BrowseErgebnis;
  } catch {
    return {
      ok: false,
      fehler:
        `Der Browser hat nichts Lesbares zurueckgegeben (Exit ${lauf.code}).\n` +
        `${lauf.stderr.slice(0, 500)}`,
    };
  }
}

// ── BEDIENEN ────────────────────────────────────────────────────────────────

export type Schritt = {
  art: "oeffne" | "klicke" | "tippe" | "taste" | "waehle" | "lade_hoch" | "scrolle" | "warte";
  wahl?: string;
  url?: string;
  text?: string;
  wert?: string;
  taste?: string;
  datei?: string;
  anzahl?: number;
  ms?: number;
  timeout?: number;
};

export type BedienErgebnis = {
  ok: boolean;
  fehler?: string;
  url?: string;
  titel?: string;
  schritte?: Array<{ nummer: number; art: string; ok: boolean; info: string }>;
  felder?: string[];
  text?: string;
  /** Ein JPEG des sichtbaren Bereichs, base64 — damit Lukas die Seite SIEHT. */
  bild?: string | null;
};

/**
 * Eine Seite bedienen: klicken, tippen, absenden — in einer Sitzung, die
 * bestehen bleibt.
 *
 * `zugang` traegt die Zugangsdaten in die Umgebung DES CONTAINERS. Sie stehen
 * damit weder im Schrittplan noch im Gespraech; im Plan steht nur {{BENUTZER}}
 * bzw. {{PASSWORT}}.
 */
export async function bedienePage(
  sitzung: string,
  schritte: Schritt[],
  zugang?: Record<string, string>,
  /*
   * Feldname -> erlaubter Hostname. Wird als eigene Umgebungsvariable
   * uebergeben, NICHT im Plan: der Plan kommt vom Modell, diese Zuordnung
   * kommt aus der Datenbank. Stuende sie im Plan, koennte ein Schrittplan sie
   * mitliefern und damit selbst bestimmen, wo das Passwort eingesetzt wird —
   * genau die Luecke, gegen die das hier steht.
   */
  hosts?: Record<string, string>,
): Promise<BedienErgebnis> {
  if (!Array.isArray(schritte) || schritte.length === 0) {
    return { ok: false, fehler: "Kein Schritt angegeben." };
  }
  if (schritte.length > 40) {
    return { ok: false, fehler: "Mehr als 40 Schritte auf einmal — teil das in mehrere Aufrufe." };
  }
  await ensureBrowser();

  const ablegen = await sshExec(
    `docker exec -i ${CONTAINER} sh -lc ${shQuote("cat > /browser/bedienen.cjs")}`,
    60000,
    BROWSER_OPERATOR_SCRIPT,
  );
  if (ablegen.code !== 0) {
    return { ok: false, fehler: `Skript liess sich nicht ablegen: ${ablegen.stderr.slice(0, 300)}` };
  }

  /*
   * EIGENE PLANDATEI JE AUFRUF.
   *
   * Vorher schrieben ALLE Aufrufe nach /browser/plan.json. Zwei gleichzeitige
   * Auftraege — Issa im Chat und der autonome Lauf, oder zwei Werkzeuge in
   * derselben Runde — ueberschrieben sich gegenseitig: der eine fuehrte den
   * Plan des anderen aus. Auf einer Seite, auf der man eingeloggt ist, ist das
   * kein Schoenheitsfehler.
   *
   * Der Name ist zufaellig, nicht fortlaufend: bei einem Neustart faengt ein
   * Zaehler wieder bei eins an und trifft eine Datei, die noch laeuft.
   */
  const planName = `plan-${randomBytes(8).toString("hex")}.json`;
  const planAblegen = await sshExec(
    `docker exec -i ${CONTAINER} sh -lc ${shQuote(`cat > /browser/${planName}`)}`,
    30000,
    JSON.stringify(schritte),
  );
  if (planAblegen.code !== 0) {
    return { ok: false, fehler: `Plan liess sich nicht ablegen: ${planAblegen.stderr.slice(0, 300)}` };
  }

  /*
   * Die Zugangsdaten gehen als -e an docker exec. Sie stehen damit kurz in der
   * Kommandozeile auf dem Droplet — das ist Issas eigener Server, und der
   * Alternativweg (Datei schreiben) waere nicht besser. Was zaehlt: sie gehen
   * NICHT durch das Modell und stehen in keinem Protokoll.
   */
  const umgebung = Object.entries(zugang ?? {})
    .filter(([name]) => /^[A-Z_]+$/.test(name))
    .map(([name, wert]) => `-e LUKAS_WEB_${name}=${shQuote(wert)}`)
    .join(" ");

  /*
   * Und die Bindung dazu: welcher Wert auf welchem Host eingesetzt werden
   * darf. Getrennt vom Plan, weil der Plan vom Modell kommt und diese
   * Zuordnung aus der Datenbank.
   */
  const hostBindung = Object.entries(hosts ?? {})
    .filter(([name]) => /^[A-Z_]+$/.test(name))
    .map(([name, host]) => `${name}=${host}`)
    .join(",");
  const hostVar = hostBindung ? ` -e LUKAS_WEB_HOSTS=${shQuote(hostBindung)}` : "";

  const lauf = await sshExec(
    `docker exec ${umgebung}${hostVar} ${CONTAINER} sh -lc ${shQuote(
      `cd /browser && node bedienen.cjs ${shQuote(sitzung)} ${planName}; rm -f ${planName}`,
    )}`,
    240000,
  );

  const zeile = lauf.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  try {
    return JSON.parse(zeile) as BedienErgebnis;
  } catch {
    return {
      ok: false,
      fehler:
        `Der Browser hat nichts Lesbares zurueckgegeben (Exit ${lauf.code}).\n` +
        `${lauf.stderr.slice(0, 500)}`,
    };
  }
}
