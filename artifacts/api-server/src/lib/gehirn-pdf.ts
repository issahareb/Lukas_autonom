import type { Gehirn, Kante, Knoten } from "./gehirn";

type ExportKnoten = { knoten: Knoten; tiefe: number };

const MAX_KNOTEN = 120;
const MAX_TIEFE = 2;
const SEITEN_BREITE = 595;
const SEITEN_HOEHE = 842;
const RAND_X = 48;
const START_Y = 794;
const ZEILENHOEHE = 13;
const ZEILEN_PRO_SEITE = 54;

function asciiDateiname(s: string): string {
  const sauber = s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9äöüÄÖÜß _.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72);
  return (sauber || "thema").replace(/\s+/g, "-");
}

function pdfText(s: string): string {
  return String(s ?? "")
    .replace(/\r/g, "")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "?");
}

function umbruch(text: string, breite = 88): string[] {
  const raus: string[] = [];
  for (const roh of pdfText(text).split("\n")) {
    const zeile = roh.trimEnd();
    if (!zeile) {
      raus.push("");
      continue;
    }
    let rest = zeile;
    while (rest.length > breite) {
      let pos = rest.lastIndexOf(" ", breite);
      if (pos < Math.floor(breite * 0.55)) pos = breite;
      raus.push(rest.slice(0, pos).trimEnd());
      rest = rest.slice(pos).trimStart();
    }
    raus.push(rest);
  }
  return raus;
}

function escapePdfLiteralBytes(s: string): Buffer {
  const src = Buffer.from(pdfText(s), "latin1");
  const out: number[] = [];
  for (const b of src) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c, b);
    else if (b === 0x0a || b === 0x0d) out.push(0x20);
    else out.push(b);
  }
  return Buffer.from(out);
}

function contentStream(lines: string[]): Buffer {
  const parts: Buffer[] = [
    Buffer.from(`BT\n/F1 10 Tf\n${RAND_X} ${START_Y} Td\n${ZEILENHOEHE} TL\n`, "ascii"),
  ];
  for (const line of lines) {
    parts.push(Buffer.from("(", "ascii"));
    parts.push(escapePdfLiteralBytes(line));
    parts.push(Buffer.from(") Tj\nT*\n", "ascii"));
  }
  parts.push(Buffer.from("ET\n", "ascii"));
  return Buffer.concat(parts);
}

function objekt(id: number, body: Buffer | string): Buffer {
  const inhalt = typeof body === "string" ? Buffer.from(body, "ascii") : body;
  return Buffer.concat([
    Buffer.from(`${id} 0 obj\n`, "ascii"),
    inhalt,
    Buffer.from("\nendobj\n", "ascii"),
  ]);
}

function pdfAusSeiten(seiten: string[][]): Buffer {
  const pageIds = seiten.map((_, i) => 4 + i * 2);
  const objs: Buffer[] = [];
  objs.push(objekt(1, "<< /Type /Catalog /Pages 2 0 R >>"));
  objs.push(
    objekt(
      2,
      `<< /Type /Pages /Count ${seiten.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
    ),
  );
  objs.push(objekt(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));

  seiten.forEach((lines, i) => {
    const pageId = 4 + i * 2;
    const streamId = pageId + 1;
    const stream = contentStream(lines);
    objs.push(
      objekt(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${SEITEN_BREITE} ${SEITEN_HOEHE}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`,
      ),
    );
    objs.push(
      objekt(
        streamId,
        Buffer.concat([
          Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"),
          stream,
          Buffer.from("endstream", "ascii"),
        ]),
      ),
    );
  });

  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1");
  const offsets: number[] = [0];
  let pos = header.length;
  for (const o of objs) {
    offsets.push(pos);
    pos += o.length;
  }
  const xrefPos = pos;
  const xref = [
    `xref\n0 ${objs.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((off) => `${String(off).padStart(10, "0")} 00000 n \n`),
  ].join("");
  const trailer = `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.concat([header, ...objs, Buffer.from(xref + trailer, "ascii")]);
}

function sammle(g: Gehirn, startId: string): ExportKnoten[] {
  const index = new Map(g.knoten.map((k) => [k.id, k]));
  if (!index.has(startId)) throw new Error("Eintrag nicht gefunden.");

  const adj = new Map<string, string[]>();
  for (const e of g.kanten) {
    const a = adj.get(e.von) ?? [];
    a.push(e.nach);
    adj.set(e.von, a);
    const b = adj.get(e.nach) ?? [];
    b.push(e.von);
    adj.set(e.nach, b);
  }

  const dist = new Map<string, number>([[startId, 0]]);
  const queue = [startId];
  for (let i = 0; i < queue.length && dist.size < MAX_KNOTEN; i++) {
    const id = queue[i];
    const tiefe = dist.get(id) ?? 0;
    if (tiefe >= MAX_TIEFE) continue;
    // "lukas" verbindet sehr viele Bereiche. Als Zwischenknoten würde er einen
    // einzelnen Themenexport praktisch zum Gesamtexport aufblasen.
    if (id === "lukas" && id !== startId) continue;
    for (const next of adj.get(id) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, tiefe + 1);
      queue.push(next);
      if (dist.size >= MAX_KNOTEN) break;
    }
  }

  return [...dist.entries()]
    .map(([id, tiefe]) => ({ knoten: index.get(id)!, tiefe }))
    .sort(
      (a, b) =>
        a.tiefe - b.tiefe ||
        b.knoten.gewicht - a.knoten.gewicht ||
        a.knoten.titel.localeCompare(b.knoten.titel, "de"),
    );
}

function kantenImAuszug(g: Gehirn, ids: Set<string>): Kante[] {
  return g.kanten.filter((e) => ids.has(e.von) && ids.has(e.nach));
}

function knotenBlock(k: Knoten, tiefe: number): string[] {
  const out = [
    `${tiefe === 0 ? "HAUPTEINTRAG" : `VERBUNDENER EINTRAG · EBENE ${tiefe}`}`,
    k.titel,
    `Typ: ${k.art}`,
  ];
  if (k.text.trim()) out.push("", ...umbruch(k.text));
  const meta = Object.entries(k.daten);
  if (meta.length) {
    out.push("", "Details:");
    for (const [key, value] of meta) out.push(...umbruch(`- ${key}: ${String(value)}`));
  }
  out.push("");
  return out;
}

export function themenPdf(g: Gehirn, startId: string): {
  pdf: Buffer;
  dateiname: string;
  knoten: number;
  kanten: number;
} {
  const auszug = sammle(g, startId);
  const root = auszug[0].knoten;
  const ids = new Set(auszug.map((x) => x.knoten.id));
  const kanten = kantenImAuszug(g, ids);
  const index = new Map(g.knoten.map((k) => [k.id, k]));

  const lines: string[] = [
    "LUKAS GEDAECHTNIS / THEMENEXPORT",
    root.titel,
    `Stand: ${g.stand}`,
    `Enthalten: ${auszug.length} Eintraege · ${kanten.length} Verbindungen`,
    `Umfeld: bis ${MAX_TIEFE} Ebenen, max. ${MAX_KNOTEN} Eintraege`,
    "",
    ...knotenBlock(root, 0),
    "VERBINDUNGEN IM AUSZUG",
  ];

  if (!kanten.length) lines.push("Keine gespeicherten Verbindungen.");
  for (const e of kanten) {
    const von = index.get(e.von)?.titel ?? e.von;
    const nach = index.get(e.nach)?.titel ?? e.nach;
    lines.push(...umbruch(`- ${von} --[${e.art}]--> ${nach}`));
  }
  lines.push("");

  for (const item of auszug.slice(1)) lines.push(...knotenBlock(item.knoten, item.tiefe));

  const seiten: string[][] = [];
  for (let i = 0; i < lines.length; i += ZEILEN_PRO_SEITE)
    seiten.push(lines.slice(i, i + ZEILEN_PRO_SEITE));
  if (!seiten.length) seiten.push(["LUKAS GEDAECHTNIS"]);

  return {
    pdf: pdfAusSeiten(seiten),
    dateiname: `lukas-${asciiDateiname(root.titel)}-${g.stand.slice(0, 10)}.pdf`,
    knoten: auszug.length,
    kanten: kanten.length,
  };
}
