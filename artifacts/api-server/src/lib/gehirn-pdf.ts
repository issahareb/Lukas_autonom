import type { Gehirn, Kante, Knoten } from "./gehirn";

type ExportKnoten = { knoten: Knoten; tiefe: number };

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
  const root = index.get(startId);
  if (!root) throw new Error("Eintrag nicht gefunden.");

  // Ein Themenexport ist bewusst KEIN Graph-Crawl. Ein allgemeines Wort wie
  // "workflow", "video" oder "project" verbindet sonst nach wenigen Sprüngen
  // fast das ganze Gedächtnis. Für "alles zu diesem Thema" ist die stabile
  // Grenze: der gewählte Knoten plus ALLE direkt daran gespeicherten Knoten.
  const direkt = new Set<string>();
  for (const e of g.kanten) {
    if (e.von === startId && e.nach !== "lukas") direkt.add(e.nach);
    if (e.nach === startId && e.von !== "lukas") direkt.add(e.von);
  }

  return [
    { knoten: root, tiefe: 0 },
    ...[...direkt]
      .map((id) => index.get(id))
      .filter((k): k is Knoten => Boolean(k))
      .sort(
        (a, b) =>
          b.gewicht - a.gewicht ||
          a.titel.localeCompare(b.titel, "de"),
      )
      .map((knoten) => ({ knoten, tiefe: 1 })),
  ];
}

function verbindungenVon(g: Gehirn, id: string): string[] {
  const index = new Map(g.knoten.map((k) => [k.id, k]));
  const raus: string[] = [];
  for (const e of g.kanten) {
    if (e.von === id) {
      const ziel = index.get(e.nach);
      if (ziel && ziel.id !== "lukas")
        raus.push(`${e.art} -> ${ziel.titel}`);
    } else if (e.nach === id) {
      const quelle = index.get(e.von);
      if (quelle && quelle.id !== "lukas")
        raus.push(`${quelle.titel} -> ${e.art}`);
    }
  }
  return raus;
}
function kantenImAuszug(g: Gehirn, ids: Set<string>): Kante[] {
  return g.kanten.filter((e) => ids.has(e.von) && ids.has(e.nach));
}

function knotenBlock(g: Gehirn, k: Knoten, tiefe: number): string[] {
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
  const bezuege = verbindungenVon(g, k.id);
  if (bezuege.length) {
    out.push("", "Direkte Verbindungen dieses Eintrags:");
    for (const bezug of bezuege) out.push(...umbruch(`- ${bezug}`));
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
    `Umfang: gewähltes Thema + alle direkt daran gespeicherten Einträge; deren eigene Verbindungen werden als Kontext aufgeführt`,
    "",
    ...knotenBlock(g, root, 0),
    "VERBINDUNGEN IM AUSZUG",
  ];

  if (!kanten.length) lines.push("Keine gespeicherten Verbindungen.");
  for (const e of kanten) {
    const von = index.get(e.von)?.titel ?? e.von;
    const nach = index.get(e.nach)?.titel ?? e.nach;
    lines.push(...umbruch(`- ${von} --[${e.art}]--> ${nach}`));
  }
  lines.push("");

  for (const item of auszug.slice(1)) lines.push(...knotenBlock(g, item.knoten, item.tiefe));

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
