import { spawn } from "node:child_process";
import { Client } from "ssh2";
import { ausgefallen, merkeAusfall, merkeErfolg } from "./ausfall";
import { logger } from "./logger";

/*
 * Lukas' Ausführungsumgebung läuft auf Issas eigenem DigitalOcean-Droplet.
 * E2B ist bewusst raus — Issa hat das Droplet, ein Fremdanbieter mit eigenen
 * Kosten und eigenem Vertrauensbereich bringt hier nichts.
 *
 * Es gibt drei Wege, gesteuert über LUKAS_EXECUTION_BACKEND:
 *
 *   docker (Standard)  Docker-Container auf dem Droplet, erreicht per SSH.
 *                      Darin hat Lukas root, volles Internet und keinen
 *                      Befehlsfilter — aber der Container sieht weder das
 *                      Dateisystem des Hosts noch dessen Secrets noch den
 *                      Docker-Socket.
 *   ssh                Direkt auf dem Droplet-Host, ohne Container.
 *   host               Direkt auf dem Host, wenn Lukas SELBST als
 *                      privilegierter Container dort läuft (nsenter).
 *
 * Warum der Standard der Container ist:
 * Auf dem Droplet laufen die Trading-Bots, die Postgres-DB und die Wallet-/
 * API-Credentials. Lukas liest E-Mails und Webseiten — also Inhalte, die
 * Fremde schreiben. Bekäme er dort standardmäßig eine Shell, würde eine
 * präparierte Mail genügen, um an all das heranzukommen. Der Container gibt
 * ihm dieselben Fähigkeiten ohne dieses Risiko, und zwar ohne Rückfrage (R1).
 *
 * 'ssh' und 'host' bleiben möglich, sind aber Host-Ebene: sie werden von
 * lib/policy.ts automatisch als R3 eingestuft und brauchen dann Issas Freigabe
 * pro Befehl. Nicht um Lukas zu bremsen, sondern damit ein untergeschobener
 * Befehl nicht unbemerkt an den Trading-Credentials landet.
 *
 * Benötigte Variablen (docker/ssh):
 *   VPS_SSH_HOST         IP des Droplets
 *   VPS_SSH_USER         SSH-Benutzer (Standard: root)
 *   VPS_SSH_KEY          privater SSH-Schlüssel (kompletter PEM-Inhalt)
 *   VPS_SSH_PORT         optional, Standard 22
 *   LUKAS_SANDBOX_IMAGE  optional, Standard python:3.12-slim
 */

export type ExecutionBackend = "docker" | "ssh" | "host";

const IDLE_MS = 15 * 60 * 1000;
const MAX_OUTPUT = 12000;
const MAX_CAPTURE = 64000;
const DEFAULT_IMAGE = process.env.LUKAS_SANDBOX_IMAGE ?? "python:3.12-slim";
const SANDBOX_NETWORK = "lukas-sandbox";

/*
 * Wann wurde ein Container zuletzt BENUTZT.
 *
 * Vorher hat der Cleanup .State.StartedAt geprueft, also das Alter. Ein
 * Container, in dem Lukas seit 20 Minuten ununterbrochen arbeitet, galt damit
 * als "idle" und wurde mitten in der Arbeit geloescht. Gemeint war Inaktivitaet
 * — die steht jetzt hier.
 *
 * Im Speicher und nicht in der DB: nach einem Neustart des Servers ist die Map
 * leer, dann greift der Fallback auf StartedAt und raeumt hoechstens etwas
 * frueher auf. Das ist die harmlose Richtung des Fehlers.
 */
const lastUsed = new Map<string, number>();

export function executionBackend(): ExecutionBackend {
  const value = (process.env.LUKAS_EXECUTION_BACKEND ?? "docker").trim().toLowerCase();
  if (value === "" || value === "docker") return "docker";
  if (value === "ssh" || value === "host") return value;
  if (value === "e2b") {
    throw new Error(
      "LUKAS_EXECUTION_BACKEND=e2b wird nicht mehr unterstützt — Lukas führt jetzt auf " +
        "Issas DigitalOcean-Droplet aus. Setze 'docker' (empfohlen), 'ssh' oder 'host'.",
    );
  }
  throw new Error(`Unbekanntes LUKAS_EXECUTION_BACKEND: ${value}`);
}

/**
 * Läuft der Befehl isoliert vom Host? Die Policy-Schicht liest das, um
 * execute_command je nach Backend als R1 oder R3 einzustufen.
 */
export function isIsolatedBackend(): boolean {
  try {
    return executionBackend() === "docker";
  } catch {
    // Fehlkonfiguration darf nie versehentlich die niedrigere Stufe ergeben.
    return false;
  }
}

function requireSshConfig(): { host: string; user: string; key: string; port: number } {
  const host = process.env.VPS_SSH_HOST;
  const key = process.env.VPS_SSH_KEY;
  if (!host || !key) {
    throw new Error(
      "VPS_SSH_HOST/VPS_SSH_KEY sind nicht gesetzt — ohne SSH-Zugang zum Droplet kann ich nichts ausführen.",
    );
  }
  return {
    host,
    user: process.env.VPS_SSH_USER ?? "root",
    key,
    port: Number(process.env.VPS_SSH_PORT ?? 22),
  };
}

/** Führt einen Befehl per SSH auf dem Droplet aus (Host-Ebene, nicht im Container). */
/**
 * Einen Befehl auf dem Droplet ausfuehren.
 *
 * `stdin` schiebt Text hinein, statt ihn in die Befehlszeile zu quetschen. Das
 * braucht der Browser: sein Skript ist mehrere Kilobyte gross und steckt voller
 * Anfuehrungszeichen — als Argument waere das ein Zitier-Minenfeld.
 */
/*
 * Aus einem SSH-Fehler eine Diagnose machen.
 *
 * ANLASS: im Dashboard stand "Fehler: Timed out while waiting for handshake".
 * Das ist die Meldung der ssh2-Bibliothek, unveraendert durchgereicht — und
 * sie sagt weder Lukas noch Issa irgendetwas. Lukas konnte daraus nicht
 * schliessen, ob der Droplet aus ist, der Schluessel nicht passt oder der
 * Browser kaputt ist. Er haette es mit demselben Werkzeug erneut versucht,
 * dann mit einem anderen, das ueber denselben Weg laeuft — und jedes Mal
 * dieselbe raetselhafte Zeile bekommen.
 *
 * DESHALB STEHT HIER AUCH, WAS SONST NOCH BETROFFEN IST. Alles, was auf dem
 * Droplet laeuft, faellt gemeinsam aus: die Sandbox, der Browser, das
 * Bedienen von Seiten. Ohne diesen Satz probiert er die Geschwister durch und
 * verbrennt drei Runden an derselben Ursache.
 *
 * Und es steht dabei, dass er es NICHT selbst reparieren kann. Ein Agent, der
 * glaubt, er koenne einen ausgeschalteten Server durch einen weiteren Versuch
 * anschalten, versucht es sonst bis zum Rundenlimit.
 */
/** Alles, was ueber SSH zum Droplet geht, faellt gemeinsam aus. */
const SSH_BEREICH = "droplet-ssh";

export function sshDiagnose(err: unknown): string {
  const roh = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string } | null)?.code ?? "";
  const wo = `${process.env.VPS_SSH_HOST ?? "?"}:${process.env.VPS_SSH_PORT ?? "22"}`;

  const nachsatz =
    ` Betroffen ist damit ALLES, was auf dem Droplet läuft — Sandbox, Browser, ` +
    `Seiten bedienen. Probier nicht die anderen Werkzeuge durch, die scheitern ` +
    `am selben Punkt. Das kannst du nicht selbst reparieren: sag es Issa über ` +
    `melde_dich_bei_issa.`;

  if (/waiting for handshake/i.test(roh)) {
    return (
      `Der Droplet (${wo}) antwortet nicht auf SSH — der Verbindungsaufbau lief in ` +
      `die Zeitüberschreitung. Meistens heißt das: der Server ist aus, oder eine ` +
      `Firewall lässt uns nicht mehr durch.` + nachsatz
    );
  }
  if (/authentication|All configured authentication methods failed/i.test(roh)) {
    return (
      `Der Droplet (${wo}) ist erreichbar, weist den Schlüssel aber ab. Der ` +
      `Zugang in VPS_SSH_KEY passt nicht (mehr) zum Server.` + nachsatz
    );
  }
  if (code === "ECONNREFUSED" || /ECONNREFUSED/.test(roh)) {
    return (
      `Der Droplet (${wo}) ist da, aber auf dem SSH-Port nimmt niemand ab — der ` +
      `SSH-Dienst läuft nicht oder hört auf einem anderen Port.` + nachsatz
    );
  }
  if (code === "ENOTFOUND" || /ENOTFOUND|EAI_AGAIN/.test(roh)) {
    return (
      `Der Name in VPS_SSH_HOST (${wo}) lässt sich nicht auflösen — die Adresse ` +
      `stimmt nicht oder der Droplet existiert nicht mehr.` + nachsatz
    );
  }
  if (code === "ETIMEDOUT" || /ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/.test(roh)) {
    return `Der Droplet (${wo}) ist über das Netz nicht erreichbar.` + nachsatz;
  }
  // Unbekannt: die Originalmeldung MIT Einordnung, nicht statt ihr.
  return `SSH zum Droplet (${wo}) fehlgeschlagen: ${roh}` + nachsatz;
}

export function sshExec(
  command: string,
  timeoutMs: number,
  stdin?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cfg = requireSshConfig();

  /*
   * Ist der Droplet gerade als tot bekannt, wird gar nicht erst verbunden.
   *
   * Sonst laeuft jeder Aufruf zwanzig Sekunden in die Zeitueberschreitung —
   * und jeder gescheiterte Aufruf kommt als Werkzeugergebnis zurueck, geht in
   * den naechsten Modellaufruf ein und wird dort bezahlt. Vierzig Fehlschlaege
   * in einem Zug sind vierzig Runden Kontext, und der autonome Lauf startet
   * immer wieder neu.
   */
  const bekannt = ausgefallen(SSH_BEREICH);
  if (bekannt) return Promise.reject(new Error(bekannt));

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch { /* Verbindung ggf. schon zu */ }
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error(`Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)}s`))),
      timeoutMs + 5000,
    );

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) return finish(() => { clearTimeout(timer); reject(err); });
          let stdout = "";
          let stderr = "";
          if (stdin !== undefined) {
            stream.write(stdin);
            stream.end();
          }
          stream
            .on("close", (code: number) => {
              clearTimeout(timer);
              // Es ging durch: der Weg steht wieder.
              merkeErfolg(SSH_BEREICH);
              finish(() => resolve({ stdout, stderr, code: code ?? 0 }));
            })
            .on("data", (d: Buffer) => { stdout += d.toString(); })
            .stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        });
      })
      .on("error", (err) => {
        clearTimeout(timer);
        const diagnose = sshDiagnose(err);
        merkeAusfall(SSH_BEREICH, diagnose);
        finish(() => reject(new Error(diagnose)));
      })
      .connect({
        host: cfg.host,
        port: cfg.port,
        username: cfg.user,
        privateKey: cfg.key,
        /*
         * Der Verbindungsaufbau bekam bisher IMMER ssh2s Voreinstellung von
         * 20 Sekunden — auch dann, wenn der Aufrufer 180 Sekunden mitgab. Ein
         * grosszuegiges Zeitlimit half also genau bei dem Teil nicht, der am
         * ehesten haengt.
         *
         * Nach oben gedeckelt: laenger als eine Minute auf einen Handshake zu
         * warten bringt nichts. Wer nach 60 Sekunden nicht antwortet,
         * antwortet auch nach 180 nicht — und solange blockiert der Zug.
         */
        readyTimeout: Math.min(Math.max(timeoutMs, 20000), 60000),
      });
  });
}

/** Ein Container pro Konversation, damit Dateien/Pakete im Gespräch erhalten bleiben. */
function containerName(conversationId: number): string {
  return `lukas-sandbox-${conversationId}`;
}

/** In einfache Anführungszeichen für die Shell verpacken. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function formatResult(
  result: { stdout: string; stderr: string; code: number },
  timeout: number,
): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(`STDOUT:\n${result.stdout}`);
  if (result.stderr) parts.push(`STDERR:\n${result.stderr}`);
  if (result.code === 124) parts.push(`(Abgebrochen: Zeitlimit von ${timeout}s erreicht)`);
  parts.push(`EXIT CODE: ${result.code}`);

  const out = parts.join("\n\n");
  return out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + "\n\n[... gekürzt]" : out;
}

async function ensureContainer(conversationId: number): Promise<string> {
  const name = containerName(conversationId);

  const running = await sshExec(
    `docker ps --filter name=^/${name}$ --format '{{.Names}}'`,
    20000,
  );
  if (running.stdout.trim() === name) return name;

  // Reste eines beendeten Containers gleichen Namens entfernen
  await sshExec(`docker rm -f ${name} 2>/dev/null || true`, 20000);

  /*
   * Die Isolationsentscheidungen, jede mit Grund:
   *  --network lukas-sandbox   eigenes Netz: Internet ja (Issas Wunsch), aber
   *                            NICHT die Default-Bridge. Auf der koennen alle
   *                            Container miteinander reden; Docker rät für
   *                            Produktion ausdrücklich zu einem eigenen Netz.
   *  --cap-drop ALL            weg mit allem, was man für Ausbrüche braucht
   *                            (SYS_ADMIN, SYS_PTRACE, NET_RAW, MKNOD …)
   *  --cap-add …               nur zurück, was pip/apt zum Anlegen und
   *                            Umschreiben von Dateien wirklich brauchen —
   *                            sonst wäre die Umgebung praktisch unbenutzbar
   *  no-new-privileges         kein Rechtezuwachs über setuid-Binaries
   *  --memory / --cpus         ein Amoklauf legt das Droplet nicht lahm
   *  --pids-limit              Fork-Bomben laufen ins Leere
   *  KEIN -v                   kein Host-Dateisystem, keine .env, kein Docker-Socket
   *  KEIN --env                keine Host-Variablen, also keine Secrets
   *  KEIN --privileged         versteht sich, steht hier als Erinnerung
   *  --label                   damit der Cleanup sie wiederfindet
   *  sleep infinity            Container bleibt für docker exec am Leben
   *
   * Root INNERHALB des Containers bleibt bewusst: Issa will eine Umgebung mit
   * vollen Rechten, und root im Container ist etwas anderes als root auf dem
   * Host, solange die Capabilities weg sind.
   */
  await sshExec(`docker network create ${SANDBOX_NETWORK} 2>/dev/null || true`, 30000);

  const create = await sshExec(
    [
      "docker run -d",
      `--name ${name}`,
      "--label lukas-sandbox=1",
      `--network ${SANDBOX_NETWORK}`,
      "--cap-drop ALL",
      "--cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add FSETID",
      "--cap-add SETGID --cap-add SETUID",
      "--security-opt no-new-privileges:true",
      "--memory 2g --memory-swap 2g --cpus 1.5 --pids-limit 512",
      "--workdir /work",
      DEFAULT_IMAGE,
      "sleep infinity",
    ].join(" "),
    90000,
  );
  if (create.code !== 0) {
    throw new Error(`Container konnte nicht gestartet werden: ${create.stderr.slice(0, 300)}`);
  }
  return name;
}

/*
 * nsenter-Variante: Lukas läuft selbst als privilegierter Container auf dem
 * Droplet und springt in die Namespaces von PID 1. Kein SSH nötig, dafür gibt
 * es keinerlei Trennung mehr zum Host — deshalb der zweite, ausdrückliche
 * Schalter LUKAS_HOST_EXECUTOR_ENABLED.
 */
function nsenterExec(
  command: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  if ((process.env.LUKAS_HOST_EXECUTOR_ENABLED ?? "").trim().toLowerCase() !== "true") {
    return Promise.reject(
      new Error("Host-Executor ist deaktiviert. LUKAS_HOST_EXECUTOR_ENABLED=true setzen."),
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      "nsenter",
      [
        "--target", "1",
        "--mount", "--uts", "--ipc", "--net", "--pid",
        "--root=/proc/1/root",
        "--wd=/root",
        "/bin/bash", "-lc", command,
      ],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;
    const append = (current: string, chunk: Buffer) =>
      current.length >= MAX_CAPTURE
        ? current
        : current + chunk.toString("utf8").slice(0, MAX_CAPTURE - current.length);

    child.stdout?.on("data", (c: Buffer) => { stdout = append(stdout, c); });
    child.stderr?.on("data", (c: Buffer) => { stderr = append(stderr, c); });

    const terminate = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* schon beendet */ } }
    };
    const timer = setTimeout(() => {
      terminate("SIGTERM");
      setTimeout(() => terminate("SIGKILL"), 2000).unref();
    }, timeoutMs);
    timer.unref();

    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

export async function executeCommand(
  conversationId: number,
  command: string,
  timeoutSeconds = 60,
): Promise<string> {
  if (!command.trim()) throw new Error("command darf nicht leer sein");
  const timeout = Math.min(Math.max(timeoutSeconds, 1), 280);
  const backend = executionBackend();

  if (backend === "host") {
    return formatResult(await nsenterExec(command, timeout * 1000), timeout);
  }
  if (backend === "ssh") {
    return formatResult(
      await sshExec(`timeout ${timeout} sh -lc ${shQuote(command)}`, timeout * 1000),
      timeout,
    );
  }

  const name = await ensureContainer(conversationId);
  lastUsed.set(name, Date.now());
  const result = await sshExec(
    `docker exec ${name} timeout ${timeout} sh -lc ${shQuote(command)}`,
    timeout * 1000,
  );
  // Auch nach dem Befehl: ein langer Lauf soll nicht als Untätigkeit zählen.
  lastUsed.set(name, Date.now());
  return formatResult(result, timeout);
}

/*
 * Befehl DIREKT auf dem Droplet ausführen — nicht im Container.
 *
 * Damit kann Lukas Dinge tun, die den Host betreffen: Hermes installieren,
 * Dienste einrichten, Systempakete nachziehen. Das ist echte Host-Macht: von
 * hier aus sind die Trading-Credentials, die Datenbank und die laufenden Bots
 * erreichbar.
 *
 * Wie streng das gehandhabt wird, entscheidet NICHT diese Datei, sondern
 * lib/policy.ts. Stand dort früher fest auf R3 (Freigabe für jeden einzelnen
 * Befehl); heute ist es R1 — Issas Entscheidung: der Droplet gehört ihm, Lukas
 * hat dort ohnehin root, und ein Assistent, der für jedes `apt install` fragt,
 * ist keiner. Mit LUKAS_HOST_APPROVAL=true kommt die Freigabepflicht zurück.
 *
 * Diese Funktion führt in beiden Fällen nur aus, was die Policy vorher
 * durchgelassen hat. Der Satz hier ist bewusst keine zweite Wahrheit über die
 * Stufe — die steht in policy.ts, und was Lukas darüber erfährt, erzeugt
 * policyHinweis() daraus.
 */
export async function executeOnHost(command: string, timeoutSeconds = 120): Promise<string> {
  if (!command.trim()) throw new Error("command darf nicht leer sein");
  const timeout = Math.min(Math.max(timeoutSeconds, 1), 600);
  const runner =
    executionBackend() === "host"
      ? nsenterExec(command, timeout * 1000)
      : sshExec(`timeout ${timeout} sh -lc ${shQuote(command)}`, timeout * 1000);
  return formatResult(await runner, timeout);
}

export async function resetSandbox(conversationId: number): Promise<string> {
  if (executionBackend() !== "docker") {
    return (
      "Kein Container aktiv: LUKAS_EXECUTION_BACKEND läuft direkt auf dem Droplet-Host. " +
      "Der ist dauerhaft und wird nicht zurückgesetzt."
    );
  }
  const name = containerName(conversationId);
  await sshExec(`docker rm -f ${name} 2>/dev/null || true`, 30000);
  lastUsed.delete(name);
  return "Sandbox zurückgesetzt — der nächste Befehl startet eine frische Umgebung.";
}

/*
 * Verwaiste Container aufräumen. Ohne das sammeln sich Container auf dem
 * Droplet an, bis der Speicher voll ist — jede Konversation legt einen an.
 */
export async function cleanupIdleSandboxes(): Promise<void> {
  try {
    // Namen statt IDs: nur ueber den Namen finden wir den Container in
    // lastUsed wieder.
    const list = await sshExec(
      `docker ps --filter label=lukas-sandbox=1 --filter "status=running" --format '{{.Names}}'`,
      30000,
    );
    const names = list.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return;

    const cutoff = Date.now() - IDLE_MS;
    for (const name of names) {
      const used = lastUsed.get(name);

      let idleSince: number;
      if (used !== undefined) {
        idleSince = used;
      } else {
        // Unbekannt (Serverneustart) — dann zaehlt ersatzweise der Start.
        const started = await sshExec(`docker inspect -f '{{.State.StartedAt}}' ${name}`, 20000);
        const startedAt = Date.parse(started.stdout.trim());
        if (!Number.isFinite(startedAt)) continue;
        idleSince = startedAt;
      }

      if (idleSince < cutoff) {
        await sshExec(`docker rm -f ${name}`, 30000);
        lastUsed.delete(name);
        logger.info({ name }, "Ungenutzte Lukas-Sandbox entfernt");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Sandbox-Cleanup fehlgeschlagen");
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startSandboxCleanup(): void {
  if (!process.env.VPS_SSH_HOST || !process.env.VPS_SSH_KEY) return;
  if (!isIsolatedBackend()) return;
  cleanupTimer = setInterval(() => {
    cleanupIdleSandboxes().catch(() => {});
  }, 10 * 60 * 1000);
  logger.info("Sandbox-Cleanup gestartet (alle 10 Minuten)");
}

export function stopSandboxCleanup(): void {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
}
