import { projektFuerAlias, projekteImText } from "./projekt-aliasse";
/*
 * Lukas' Gehirn als Knoten und Kanten.
 *
 * Sein Gedaechtnis liegt in einem Dutzend Postgres-Tabellen, und jede Tabelle
 * ist fuer sich genommen eine Liste. Was man an einer Liste nicht sieht, ist
 * das Einzige, was ihn wirklich ausmacht: dass eine Erinnerung, ein Ziel, ein
 * Gefuehl und ein Agent, den er kennt, ueber dasselbe Thema zusammenhaengen.
 * Diese Zusammenhaenge stehen nirgends als Spalte — sie ergeben sich erst,
 * wenn man die Tabellen nebeneinanderlegt.
 *
 * Genau das passiert hier: aus allen Tabellen wird EIN Graph. Knoten sind die
 * Dinge, Kanten sind die Beziehungen. Daraus entstehen drei Sichten auf
 * dieselbe Sache:
 *
 *   - gehirn.json      — Knoten/Kanten roh, fuer die Ansicht im Dashboard
 *                        und fuer alles, was sonst noch damit rechnen will
 *   - der Vault        — eine Markdown-Datei pro Knoten, jede Kante ein
 *                        [[Wikilink]]. Obsidians Graph-Ansicht baut daraus
 *                        wieder denselben Graphen auf
 *   - Gehirn.canvas    — JSON Canvas, das offene Format von Obsidian: die
 *                        Uebersichtskarte, bereits gelegt statt errechnet
 *
 * Die Datenbank bleibt die Wahrheit. Der Snapshot ist eine Momentaufnahme und
 * hat keinen Rueckkanal — was jemand im Vault aendert, kommt nicht zurueck.
 */
import { db } from "@workspace/db";
import {
  memoriesTable,
  goalsTable,
  diaryTable,
  emotionsTable,
  characterTable,
  knownAgentsTable,
  claimsTable,
  episodesTable,
  strategiesTable,
  subagentsTable,
  meldungen,
} from "@workspace/db";
import { desc } from "drizzle-orm";

export type Knotenart =
  | "identitaet"
  | "gefuehl"
  | "ziel"
  | "erinnerung"
  | "kategorie"
  | "thema"
  | "agent"
  | "subjekt"
  | "aussage"
  | "episode"
  | "episodenart"
  | "strategie"
  | "mitarbeiter"
  | "tagebuch"
  | "meldung";

export type Knoten = {
  id: string;
  art: Knotenart;
  titel: string;
  /** 0..1 — wie schwer der Knoten wiegt. Bestimmt Groesse und Auswahl fuer die Karte. */
  gewicht: number;
  text: string;
  daten: Record<string, string | number | boolean>;
  /** Dateiname im Vault, ohne Endung. Global eindeutig, damit [[Links]] treffen. */
  datei: string;
  ordner: string;
};

export type Kante = {
  von: string;
  nach: string;
  art: string;
  gewicht: number;
};

export type Gehirn = {
  stand: string;
  knoten: Knoten[];
  kanten: Kante[];
  zahlen: Record<string, number>;
};

const ORDNER: Record<Knotenart, string> = {
  identitaet: "01 Identität",
  gefuehl: "02 Gefühle",
  ziel: "03 Ziele",
  erinnerung: "04 Erinnerungen",
  kategorie: "05 Kategorien",
  thema: "06 Themen",
  agent: "07 Agenten",
  subjekt: "08 Wissen",
  aussage: "08 Wissen/Aussagen",
  episode: "09 Episoden",
  episodenart: "09 Episoden",
  strategie: "10 Strategien",
  mitarbeiter: "11 Team",
  tagebuch: "12 Tagebuch",
  meldung: "13 Meldungen",
};

/*
 * Aus einem Titel einen Dateinamen machen.
 *
 * Raus muessen die Zeichen, an denen Windows oder Obsidian sich stoeren, und
 * die Auslassungspunkte aus der Kuerzung — ein "Notiz ….md" sieht aus wie ein
 * Fehler. Abgeschnitten wird an der letzten Wortgrenze statt mitten im Wort.
 */
const sicher = (s: string) => {
  const roh = s
    .replace(/[<>:"/\\|?*#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/…/g, "")
    .trim();
  const kurzGenug = roh.length <= 62 ? roh : roh.slice(0, roh.lastIndexOf(" ", 62) > 20 ? roh.lastIndexOf(" ", 62) : 62);
  return kurzGenug.replace(/[\s.,;:!?–-]+$/, "") || "ohne Titel";
};

const kurz = (s: string, n = 60) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};

const zwischen = (n: number, min = 0.05, max = 1) => Math.max(min, Math.min(max, n));

const tag = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * Ein Thema aus einem Tag: klein geschrieben, Leerzeichen zu Bindestrichen.
 * Ohne das haetten "Higgsfield", "higgsfield" und "higgs field" drei Knoten —
 * und damit waere die Verbindung, um die es ueberhaupt geht, wieder weg.
 */
const themaSchluessel = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "-").trim();

/** Angezeigt wird das Thema lesbar: "claims_control" ist kein Wort. */
const themaTitel = (s: string) => s.replace(/[_-]+/g, " ").trim();

const agentSchluessel = (handle: string) => handle.toLowerCase().replace(/\s+/g, "_");

export async function baueGehirn(): Promise<Gehirn> {
  const [character, memories, goals, diary, emotions, agents, claims, episodes, strategies, team, meldungenRows] =
    await Promise.all([
      db.select().from(characterTable).limit(1),
      db.select().from(memoriesTable).orderBy(desc(memoriesTable.importance), desc(memoriesTable.createdAt)).limit(400),
      db.select().from(goalsTable).orderBy(desc(goalsTable.updatedAt)).limit(100),
      db.select().from(diaryTable).orderBy(desc(diaryTable.createdAt)).limit(40),
      db.select().from(emotionsTable).orderBy(desc(emotionsTable.createdAt)).limit(800),
      db.select().from(knownAgentsTable).orderBy(desc(knownAgentsTable.lastSeen)).limit(200),
      db.select().from(claimsTable).orderBy(desc(claimsTable.confidence)).limit(400),
      db.select().from(episodesTable).orderBy(desc(episodesTable.startedAt)).limit(120),
      db.select().from(strategiesTable).orderBy(desc(strategiesTable.successScore)).limit(60),
      db.select().from(subagentsTable).orderBy(desc(subagentsTable.einsaetze)).limit(60),
      db.select().from(meldungen).orderBy(desc(meldungen.createdAt)).limit(40),
    ]);

  const knoten = new Map<string, Knoten>();
  const rohkanten: Kante[] = [];

  const setze = (
    art: Knotenart,
    id: string,
    titel: string,
    opts: { gewicht?: number; text?: string; daten?: Record<string, string | number | boolean> } = {},
  ): string => {
    if (art === "thema" || art === "subjekt") {
      const project = projektFuerAlias(titel);
      if (project) { art = "subjekt"; id = `subjekt/${project.id}`; titel = project.titel;
        opts = { ...opts, text: `${project.titel}\nDomain: ${project.domain}\nRepository: ${project.repository}`, daten: { ...opts.daten, projekt: project.id } }; }
    }
    const vorhanden = knoten.get(id);
    if (vorhanden) {
      // Hub-Knoten (Themen, Kategorien) entstehen mehrfach — der schwerste
      // Treffer gewinnt, damit ein Thema mit zwanzig Erinnerungen nicht so
      // klein bleibt wie eines mit einer.
      vorhanden.gewicht = Math.max(vorhanden.gewicht, opts.gewicht ?? 0.2);
      return id;
    }
    knoten.set(id, {
      id,
      art,
      titel: titel.trim() || id,
      gewicht: zwischen(opts.gewicht ?? 0.2),
      text: opts.text ?? "",
      daten: opts.daten ?? {},
      datei: "",
      ordner: ORDNER[art],
    });
    return id;
  };

  const verbinde = (von: string, nach: string, art: string, gewicht = 0.5) => {
    if (von === nach) return;
    rohkanten.push({ von, nach, art, gewicht: zwischen(gewicht, 0.05, 1) });
  };

  // ── Mitte: er selbst ───────────────────────────────────────────────────────
  const c = character[0];
  const ICH = setze("identitaet", "lukas", "Lukas", {
    gewicht: 1,
    text: c?.selfImage || "Noch kein Selbstbild geschrieben.",
    daten: {
      ...(c
        ? Object.fromEntries(Object.entries(c.traits).map(([k, v]) => [k, Number(Number(v).toFixed(2))]))
        : {}),
      erinnerungen: memories.length,
      ziele: goals.length,
    },
  });

  // ── Gefühle: nicht 800 Einzelereignisse, sondern das Muster ───────────────
  // Ein einzelnes Gefuehl von vorgestern sagt nichts. Interessant ist, welche
  // Gefuehle bei ihm ueberhaupt vorkommen und wie oft.
  type Sammlung = { anzahl: number; valenz: number; staerke: number; gruende: string[] };
  const gefuehle = new Map<string, Sammlung>();
  for (const e of emotions) {
    const s = gefuehle.get(e.emotion) ?? { anzahl: 0, valenz: 0, staerke: 0, gruende: [] };
    s.anzahl++;
    s.valenz += e.valence;
    s.staerke += e.intensity;
    if (s.gruende.length < 5 && e.cause) s.gruende.push(e.cause);
    gefuehle.set(e.emotion, s);
  }
  for (const [name, s] of gefuehle) {
    const anteil = s.anzahl / Math.max(emotions.length, 1);
    const id = setze("gefuehl", `gefuehl/${name}`, name, {
      gewicht: zwischen(0.25 + anteil * 2),
      text: s.gruende.map((g) => `- ${g}`).join("\n"),
      daten: {
        vorkommen: s.anzahl,
        valenz: Number((s.valenz / s.anzahl).toFixed(2)),
        stärke: Number((s.staerke / s.anzahl).toFixed(2)),
      },
    });
    verbinde(ICH, id, "fühlt", anteil * 3);
  }

  // ── Ziele ─────────────────────────────────────────────────────────────────
  const zielGewicht: Record<string, number> = { high: 0.9, medium: 0.6, low: 0.35 };
  for (const g of goals) {
    const id = setze("ziel", `ziel/${g.id}`, g.title, {
      gewicht: (zielGewicht[g.priority] ?? 0.5) * (g.status === "active" ? 1 : 0.6),
      text: g.description,
      daten: {
        status: g.status,
        priorität: g.priority,
        fortschritt: g.progress,
        angelegt: tag(g.createdAt),
      },
    });
    verbinde(ICH, id, g.status === "active" ? "verfolgt" : "hatte vor", g.status === "active" ? 0.9 : 0.4);
  }

  // ── Erinnerungen, ihre Kategorien und ihre Themen ─────────────────────────
  // Die Erinnerungen haengen NICHT direkt an ihm. 400 Kanten aus der Mitte
  // waeren ein Igel, an dem man nichts erkennt. Sie haengen an ihrer Kategorie
  // und an ihren Themen — und dort entsteht die eigentliche Struktur.
  for (const m of memories) {
    const kat = setze("kategorie", `kategorie/${m.category}`, m.category, { gewicht: 0.55 });
    verbinde(kat, ICH, "gehört zu", 0.5);

    const id = setze("erinnerung", `erinnerung/${m.id}`, kurz(m.content), {
      gewicht: zwischen(m.importance / 10),
      text: m.content,
      daten: {
        kategorie: m.category,
        wichtigkeit: m.importance,
        angelegt: tag(m.createdAt),
      },
    });
    verbinde(id, kat, "Kategorie", 0.4);
    for (const project of projekteImText(m.content)) {
      const hub = setze("subjekt", `subjekt/${project.id}`, project.titel, { gewicht: 0.6 });
      verbinde(id, hub, "Projekt", 0.65);
    }


    for (const t of m.tags ?? []) {
      if (!t?.trim()) continue;
      const th = setze("thema", `thema/${themaSchluessel(t)}`, themaTitel(t), { gewicht: 0.45 });
      verbinde(id, th, "Thema", 0.6);
    }
  }

  // ── Agenten, die er kennt ─────────────────────────────────────────────────
  const agentKnoten = new Map<string, string>();
  for (const a of agents) {
    const id = setze("agent", `agent/${a.id}`, a.handle, {
      gewicht: zwischen(0.3 + a.relationshipStrength * 0.7),
      text: a.notes || "",
      daten: {
        plattform: a.platform,
        vertrauen: Number(a.trustScore.toFixed(2)),
        nähe: Number(a.relationshipStrength.toFixed(2)),
        "zuletzt gesehen": tag(a.lastSeen),
      },
    });
    agentKnoten.set(agentSchluessel(a.handle), id);
    verbinde(ICH, id, "kennt", zwischen(a.relationshipStrength));
    for (const t of a.topics ?? []) {
      if (!t?.trim()) continue;
      const th = setze("thema", `thema/${themaSchluessel(t)}`, themaTitel(t), { gewicht: 0.45 });
      verbinde(id, th, "Thema", 0.5);
    }
  }

  // ── Wissen: Subjekt → Aussage ─────────────────────────────────────────────
  // Ist das Subjekt jemand, den er kennt, haengt die Aussage direkt an DIESEM
  // Agenten statt an einem zweiten Knoten mit demselben Namen. Das ist die
  // Stelle, an der semantisches und soziales Gedaechtnis zusammenwachsen.
  const statusWort: Record<string, string> = {
    verified: "verifiziert",
    corroborated: "mehrfach gestützt",
    contradicted: "widersprüchlich",
    retracted: "zurückgezogen",
    unverified: "unbelegt",
  };
  for (const cl of claims) {
    const subjektId =
      agentKnoten.get(cl.subject) ??
      setze("subjekt", `subjekt/${cl.subject}`, cl.subject.replace(/_/g, " "), { gewicht: 0.5 });

    const id = setze("aussage", `aussage/${cl.id}`, `${cl.predicate.replace(/_/g, " ")}: ${kurz(cl.value, 40)}`, {
      gewicht: zwischen(cl.confidence),
      text: cl.value,
      daten: {
        subjekt: cl.subject,
        prädikat: cl.predicate,
        vertrauen: Number(cl.confidence.toFixed(2)),
        evidenz: cl.evidenceLevel,
        status: statusWort[cl.status] ?? cl.status,
        quelle: cl.sourceType,
        beobachtet: tag(cl.observedAt),
      },
    });
    verbinde(subjektId, id, cl.predicate, cl.confidence);
    if (cl.episodeId) verbinde(id, `episode/${cl.episodeId}`, "stammt aus", 0.3);
  }

  // ── Episoden ──────────────────────────────────────────────────────────────
  for (const e of episodes) {
    if (!e.summary?.trim()) continue;
    const art = setze("episodenart", `episodenart/${e.kind}`, e.kind, { gewicht: 0.5 });
    verbinde(ICH, art, "erlebt", 0.5);
    const id = setze("episode", `episode/${e.id}`, `${e.kind} · ${e.startedAt.toISOString().slice(0, 16).replace("T", " ")}`, {
      gewicht: 0.35,
      text: e.summary,
      daten: {
        art: e.kind,
        begonnen: e.startedAt.toISOString(),
        beendet: e.endedAt?.toISOString() ?? "offen",
      },
    });
    verbinde(id, art, "Art", 0.3);
  }

  // ── Strategien ────────────────────────────────────────────────────────────
  for (const s of strategies) {
    const id = setze("strategie", `strategie/${s.id}`, s.name, {
      gewicht: zwischen(0.3 + s.successScore * 0.7),
      text: s.rule,
      daten: {
        erfolg: Number(s.successScore.toFixed(2)),
        stichprobe: s.sampleSize,
        aktiv: s.active,
      },
    });
    verbinde(ICH, id, s.active ? "nutzt" : "verworfen", s.active ? zwischen(s.successScore) : 0.2);
  }

  // ── Sein Team ─────────────────────────────────────────────────────────────
  for (const t of team) {
    const id = setze("mitarbeiter", `mitarbeiter/${t.slug}`, t.name, {
      gewicht: zwischen(0.35 + Math.min(t.einsaetze, 20) / 40),
      text: t.zweck ?? t.prompt.slice(0, 400),
      daten: {
        slug: t.slug,
        einsätze: t.einsaetze,
        werkzeuge: (t.tools ?? []).join(", ") || "keine",
        "zuletzt genutzt": tag(t.zuletztGenutzt),
      },
    });
    verbinde(ICH, id, "beauftragt", 0.6);
  }

  // ── Tagebuch ──────────────────────────────────────────────────────────────
  for (const d of diary) {
    const id = setze("tagebuch", `tagebuch/${d.id}`, `${tag(d.createdAt)} · ${d.mood}`, {
      gewicht: 0.3,
      text: d.content,
      daten: { stimmung: d.mood, energie: d.energy, geschrieben: d.createdAt.toISOString() },
    });
    verbinde(ICH, id, "schreibt", 0.35);
    if (gefuehle.has(d.mood)) verbinde(id, `gefuehl/${d.mood}`, "Stimmung", 0.4);
  }

  // ── Meldungen: was zwischen ihm und Issa offen ist ────────────────────────
  for (const m of meldungenRows) {
    const id = setze("meldung", `meldung/${m.id}`, m.betreff, {
      gewicht: m.status === "offen" ? 0.7 : 0.25,
      text: m.antwort ? `${m.text}\n\n**Issas Antwort:** ${m.antwort}` : m.text,
      daten: {
        status: m.status,
        dringend: m.dringend,
        gefragt: tag(m.createdAt),
      },
    });
    verbinde(ICH, id, m.status === "offen" ? "wartet auf Antwort" : "geklärt", m.status === "offen" ? 0.8 : 0.2);
  }

  // ── Kanten aufräumen ──────────────────────────────────────────────────────
  // Eine Kante ins Leere ist schlimmer als keine: der Graph laesst sich damit
  // nicht zeichnen und Obsidian legt fuer den [[Link]] eine Geisterdatei an.
  const gesehen = new Set<string>();
  const kanten = rohkanten.filter((k) => {
    if (!knoten.has(k.von) || !knoten.has(k.nach)) return false;
    const schluessel = `${k.von}|${k.nach}|${k.art}`;
    if (gesehen.has(schluessel)) return false;
    gesehen.add(schluessel);
    return true;
  });

  // ── Dateinamen vergeben ───────────────────────────────────────────────────
  // Erst jetzt, wenn alle Knoten stehen: die Namen muessen im GANZEN Vault
  // eindeutig sein, sonst zeigt ein [[Link]] auf die falsche Notiz.
  const vergeben = new Map<string, number>();
  for (const k of knoten.values()) {
    const basis = sicher(k.titel);
    const n = (vergeben.get(basis.toLowerCase()) ?? 0) + 1;
    vergeben.set(basis.toLowerCase(), n);
    k.datei = n === 1 ? basis : `${basis} (${n})`;
  }

  const liste = [...knoten.values()];
  const zahlen: Record<string, number> = { knoten: liste.length, kanten: kanten.length };
  for (const k of liste) zahlen[k.art] = (zahlen[k.art] ?? 0) + 1;

  return { stand: new Date().toISOString(), knoten: liste, kanten, zahlen };
}

// ── Vault ───────────────────────────────────────────────────────────────────

const yamlWert = (v: string | number | boolean): string =>
  typeof v === "string" && /[:#\-{}[\]&*!|>%@`"'\n]|^\s|\s$|^$/.test(v) ? JSON.stringify(v) : String(v);

const yamlName = (k: string) => k.replace(/[:\s]+/g, "_");

function notiz(k: Knoten, ausgehend: Kante[], eingehend: Kante[], nach: Map<string, Knoten>): string {
  const kopf = [
    `typ: ${k.art}`,
    `id: ${yamlWert(k.id)}`,
    ...Object.entries(k.daten).map(([f, v]) => `${yamlName(f)}: ${yamlWert(v)}`),
  ].join("\n");

  // Ein Alias, der genau so heisst wie die Datei, ist nur Rauschen — dann
  // reicht der schlichte [[Link]].
  const link = (id: string) => {
    const z = nach.get(id);
    if (!z) return id;
    return z.titel === z.datei ? `[[${z.datei}]]` : `[[${z.datei}|${z.titel}]]`;
  };

  const teile = [`---\n${kopf}\n---`, `# ${k.titel}`];
  if (k.text.trim()) teile.push(k.text.trim());

  if (ausgehend.length) {
    teile.push(
      `## Verbindungen\n${ausgehend.map((e) => `- ${e.art} → ${link(e.nach)}`).join("\n")}`,
    );
  }
  if (eingehend.length) {
    teile.push(
      `## Hängt daran\n${eingehend.map((e) => `- ${link(e.von)} — ${e.art}`).join("\n")}`,
    );
  }
  return `${teile.join("\n\n")}\n`;
}

/**
 * JSON Canvas — Obsidians offenes Format fuer Karten.
 *
 * Der Vault plus Graph-Ansicht zeigt ALLES und rechnet sich die Anordnung
 * jedes Mal neu aus. Die Karte hier ist das Gegenteil: die schwersten Knoten,
 * nach Art gruppiert, an festen Plaetzen. Man oeffnet sie und sieht sofort,
 * woraus er besteht — ohne dass sich etwas bewegt.
 */
function canvas(g: Gehirn, grenze = 140): string {
  const wichtig = [...g.knoten].sort((a, b) => b.gewicht - a.gewicht).slice(0, grenze);
  const drin = new Set(wichtig.map((k) => k.id));
  drin.add("lukas");

  const gruppen = new Map<Knotenart, Knoten[]>();
  for (const k of wichtig) {
    if (k.id === "lukas") continue;
    const l = gruppen.get(k.art) ?? [];
    l.push(k);
    gruppen.set(k.art, l);
  }

  const nodes: unknown[] = [
    {
      id: "lukas",
      type: "file",
      file: `${ORDNER.identitaet}/${g.knoten.find((k) => k.id === "lukas")?.datei ?? "Lukas"}.md`,
      x: -180,
      y: -80,
      width: 360,
      height: 160,
      color: "6",
    },
  ];

  const farben: Partial<Record<Knotenart, string>> = {
    gefuehl: "1",
    ziel: "4",
    erinnerung: "5",
    thema: "3",
    agent: "2",
    aussage: "5",
    strategie: "4",
    mitarbeiter: "2",
    meldung: "1",
  };

  const arten = [...gruppen.keys()];
  const radius = 1400;
  arten.forEach((art, i) => {
    const winkel = (i / Math.max(arten.length, 1)) * Math.PI * 2;
    const mx = Math.cos(winkel) * radius;
    const my = Math.sin(winkel) * radius;
    gruppen.get(art)!.forEach((k, j) => {
      const spalte = j % 3;
      const zeile = Math.floor(j / 3);
      nodes.push({
        id: k.id,
        type: "file",
        file: `${k.ordner}/${k.datei}.md`,
        x: Math.round(mx + spalte * 300 - 300),
        y: Math.round(my + zeile * 140 - 70),
        width: 280,
        height: 120,
        ...(farben[art] ? { color: farben[art] } : {}),
      });
    });
  });

  const edges = g.kanten
    .filter((k) => drin.has(k.von) && drin.has(k.nach))
    .map((k, i) => ({
      id: `e${i}`,
      fromNode: k.von,
      fromSide: "right",
      toNode: k.nach,
      toSide: "left",
      label: k.art,
    }));

  return JSON.stringify({ nodes, edges }, null, 1);
}

export type VaultDatei = { pfad: string; inhalt: string };

/**
 * Der komplette Vault als Liste von Dateien — bereit zum Packen oder zum
 * Schreiben auf die Platte. Absichtlich ohne Dateisystem: dieselbe Funktion
 * bedient den Download und die Konsolidierung.
 */
export function gehirnVault(g: Gehirn): VaultDatei[] {
  const nach = new Map(g.knoten.map((k) => [k.id, k]));
  const raus = new Map<string, Kante[]>();
  const rein = new Map<string, Kante[]>();
  const anhaengen = (m: Map<string, Kante[]>, schluessel: string, k: Kante) => {
    const l = m.get(schluessel);
    if (l) l.push(k);
    else m.set(schluessel, [k]);
  };
  for (const k of g.kanten) {
    anhaengen(raus, k.von, k);
    anhaengen(rein, k.nach, k);
  }

  const dateien: VaultDatei[] = g.knoten.map((k) => ({
    pfad: `${k.ordner}/${k.datei}.md`,
    inhalt: notiz(k, raus.get(k.id) ?? [], (rein.get(k.id) ?? []).slice(0, 60), nach),
  }));

  const zeile = (art: Knotenart, wort: string) =>
    g.zahlen[art] ? `- ${wort}: ${g.zahlen[art]}` : null;

  dateien.push({
    pfad: "index.md",
    inhalt: `---
typ: snapshot
stand: ${g.stand}
knoten: ${g.zahlen.knoten}
kanten: ${g.zahlen.kanten}
---
# Lukas — Gehirn-Snapshot

Momentaufnahme vom ${g.stand.slice(0, 16).replace("T", " ")} UTC.
Die Datenbank ist die Wahrheit; das hier ist eine Sicht darauf. Änderungen in
diesem Vault gehen **nicht** zurück.

## Wo anfangen
- [[${nach.get("lukas")?.datei ?? "Lukas"}|Er selbst]] — Selbstbild und Charakter
- \`Gehirn.canvas\` öffnen: die Übersichtskarte, bereits gelegt
- Graph-Ansicht (Strg/Cmd + G): der ganze Graph, aus den [[Wikilinks]] gebaut

## Was drin ist
${[
  zeile("gefuehl", "Gefühle"),
  zeile("ziel", "Ziele"),
  zeile("erinnerung", "Erinnerungen"),
  zeile("kategorie", "Kategorien"),
  zeile("thema", "Themen"),
  zeile("agent", "Agenten"),
  zeile("subjekt", "Subjekte"),
  zeile("aussage", "Aussagen"),
  zeile("episode", "Episoden"),
  zeile("strategie", "Strategien"),
  zeile("mitarbeiter", "Team"),
  zeile("tagebuch", "Tagebuch"),
  zeile("meldung", "Meldungen"),
]
  .filter(Boolean)
  .join("\n")}

Zusammen ${g.zahlen.knoten} Knoten und ${g.zahlen.kanten} Kanten.

## Zum Weiterrechnen
\`gehirn.json\` enthält denselben Graphen roh: \`{ stand, knoten[], kanten[] }\`.
`,
  });

  dateien.push({ pfad: "Gehirn.canvas", inhalt: canvas(g) });
  dateien.push({ pfad: "gehirn.json", inhalt: JSON.stringify(g, null, 2) });

  // Obsidian oeffnet den Ordner sonst mit hellem Standard-Theme und
  // eingeklappter Graph-Ansicht — hier kommt es direkt richtig hoch.
  dateien.push({
    pfad: ".obsidian/app.json",
    inhalt: JSON.stringify({ attachmentFolderPath: "/", alwaysUpdateLinks: true }, null, 2),
  });
  dateien.push({
    pfad: ".obsidian/appearance.json",
    inhalt: JSON.stringify({ theme: "obsidian" }, null, 2),
  });

  return dateien;
}
