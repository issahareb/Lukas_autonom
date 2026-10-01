import type { Gehirn, Kante, Knoten } from "./gehirn";

type PdfZeile = {
  text: string;
  fett?: boolean;
  groesse?: number;
  abstand?: number;
};

const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86,
  "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
  "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95,
  "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b,
  "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

function cp1252Byte(ch: string): number {
  const code = ch.codePointAt(0) ?? 63;
  if (code <= 0xff && !(code >= 0x80 && code <= 0x9f)) return code;
  return CP1252[ch] ?? 63;
}

function pdfString(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const byte = cp1252Byte(ch);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      out += "\\" + String.fromCharCode(byte);
    } else if (byte < 0x20 || byte > 0x7e) {
      out += "\\" + byte.toString(8).padStart(3, "0");
    } else {
      out += String.fromCharCode(byte);
    }
  }
  return out;
}

function asciiBuffer(s: string): Buffer {
  return Buffer.from(s, "latin1");
}

function saubereZeichen(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/→/g, "->")
    .replace(/←/g, "<-");
}

function umbrechen(text: string, groesse = 10, maxBreite = 495): string[] {
  const zeichenProZeile = Math.max(28, Math.floor(maxBreite / (groesse * 0.52)));
  const result: string[] = [];
  for (const absatz of saubereZeichen(text).split("\n")) {
    if (!absatz.trim()) {
      result.push("");
      continue;
    }
    let rest = absatz.trim();
    while (rest.length > zeichenProZeile) {
      let schnitt = rest.lastIndexOf(" ", zeichenProZeile);
      if (schnitt < Math.floor(zeichenProZeile * 0.55)) schnitt = zeichenProZeile;
      result.push(rest.slice(0, schnitt).trimEnd());
      rest = rest.slice(schnitt).trimStart();
    }
    result.push(rest);
  }
  return result;
}

function textZeilen(text: string, optionen: Omit<PdfZeile, "text"> = {}): PdfZeile[] {
  return umbrechen(text, optionen.groesse ?? 10).map((z) => ({ text: z, ...optionen }));
}

function typName(art: string): string {
  const namen: Record<string, string> = {
    identitaet: "Identitaet",
    gefuehl: "Gefuehl",
    ziel: "Ziel",
    erinnerung: "Erinnerung",
    kategorie: "Kategorie",
    thema: "Thema",
    agent: "Agent",
    subjekt: "Subjekt",
    aussage: "Aussage",
    episode: "Episode",
    episodenart: "Episodenart",
    strategie: "Strategie",
    mitarbeiter: "Team",
    tagebuch: "Tagebuch",
    meldung: "Meldung",
  };
  return namen[art] ?? art;
}

function incident(g: Gehirn, id: string): Kante[] {
  return g.kanten.filter((e) => e.von === id || e.nach === id);
}

/**
 * Ein Themenexport soll nicht ueber generische Hubs das komplette Gehirn
 * einsammeln. Wir nehmen das Thema, alle direkten Nachbarn und eine zweite
 * Ebene von inhaltlichen Knoten. Identitaet/Kategorie/Episodenart/Subjekt
 * werden zwar dokumentiert, aber nicht weiter aufgefaltet.
 */
export function themaTeilgraph(g: Gehirn, themaId: string): {
  thema: Knoten;
  knoten: Knoten[];
  kanten: Kante[];
} {
  const index = new Map(g.knoten.map((k) => [k.id, k]));
  const thema = index.get(themaId);
  if (!thema || thema.art !== "thema") throw new Error("Thema nicht gefunden");

  const ids = new Set<string>([thema.id]);
  const direkt = incident(g, thema.id);
  for (const e of direkt) ids.add(e.von === thema.id ? e.nach : e.von);

  const nichtErweitern = new Set(["identitaet", "kategorie", "episodenart", "subjekt", "thema"]);
  const ersteEbene = [...ids].filter((id) => id !== thema.id);
  for (const id of ersteEbene) {
    const k = index.get(id);
    if (!k || nichtErweitern.has(k.art)) continue;
    for (const e of incident(g, id)) {
      const other = e.von === id ? e.nach : e.von;
      if (ids.size < 300) ids.add(other);
    }
  }

  const knoten = [...ids]
    .map((id) => index.get(id))
    .filter((k): k is Knoten => Boolean(k))
    .sort((a, b) => {
      if (a.id === thema.id) return -1;
      if (b.id === thema.id) return 1;
      const ad = direkt.some((e) => e.von === a.id || e.nach === a.id) ? 0 : 1;
      const bd = direkt.some((e) => e.von === b.id || e.nach === b.id) ? 0 : 1;
      return ad - bd || b.gewicht - a.gewicht || a.titel.localeCompare(b.titel, "de");
    });
  const kanten = g.kanten.filter((e) => ids.has(e.von) && ids.has(e.nach));
  return { thema, knoten, kanten };
}

function dokumentZeilen(g: Gehirn, themaId: string): PdfZeile[] {
  const teil = themaTeilgraph(g, themaId);
  const index = new Map(teil.knoten.map((k) => [k.id, k]));
  const z: PdfZeile[] = [];

  z.push(...textZeilen(teil.thema.titel, { fett: true, groesse: 20, abstand: 8 }));
  z.push(...textZeilen("LUKAS · Themenexport", { fett: true, groesse: 11, abstand: 3 }));
  z.push(...textZeilen(
    `Stand: ${g.stand.slice(0, 16).replace("T", " ")} UTC · ${teil.knoten.length} Eintraege · ${teil.kanten.length} Verbindungen`,
    { groesse: 9, abstand: 10 },
  ));
  z.push(...textZeilen(
    "Enthaelt den Themenknoten, alle direkten Verbindungen und die inhaltlich angeschlossene zweite Ebene. Vollstaendige gespeicherte Texte werden nicht gekuerzt.",
    { groesse: 9, abstand: 12 },
  ));

  for (const k of teil.knoten) {
    z.push(...textZeilen(`${typName(k.art)} · ${k.titel}`, { fett: true, groesse: 13, abstand: 5 }));

    if (k.text.trim()) {
      z.push(...textZeilen(k.text.trim(), { groesse: 10, abstand: 4 }));
    } else {
      z.push({ text: "Kein weiterer Text gespeichert.", groesse: 9, abstand: 4 });
    }

    const meta = Object.entries(k.daten);
    if (meta.length) {
      z.push({ text: "Details", fett: true, groesse: 9, abstand: 2 });
      for (const [key, value] of meta) {
        z.push(...textZeilen(`${key}: ${String(value)}`, { groesse: 9, abstand: 1 }));
      }
    }

    const edges = teil.kanten.filter((e) => e.von === k.id || e.nach === k.id);
    if (edges.length) {
      z.push({ text: "Verbindungen", fett: true, groesse: 9, abstand: 2 });
      for (const e of edges) {
        const raus = e.von === k.id;
        const other = index.get(raus ? e.nach : e.von);
        if (!other) continue;
        z.push(...textZeilen(
          `${raus ? "->" : "<-"} ${e.art}: ${other.titel} [${typName(other.art)}]`,
          { groesse: 9, abstand: 1 },
        ));
      }
    }
    z.push({ text: "", abstand: 8 });
  }
  return z;
}

function seitenAusZeilen(zeilen: PdfZeile[]): PdfZeile[][] {
  const seiten: PdfZeile[][] = [];
  let aktuell: PdfZeile[] = [];
  let y = 790;
  for (const z of zeilen) {
    const groesse = z.groesse ?? 10;
    const hoehe = groesse * 1.28 + (z.abstand ?? 0);
    if (y - hoehe < 48 && aktuell.length) {
      seiten.push(aktuell);
      aktuell = [];
      y = 790;
    }
    aktuell.push(z);
    y -= hoehe;
  }
  if (aktuell.length || !seiten.length) seiten.push(aktuell);
  return seiten;
}

function contentStream(zeilen: PdfZeile[], seite: number, gesamt: number): Buffer {
  const cmds: string[] = [];
  let y = 790;
  for (const z of zeilen) {
    const groesse = z.groesse ?? 10;
    if (z.text) {
      cmds.push(
        `BT /${z.fett ? "F2" : "F1"} ${groesse} Tf 50 ${y.toFixed(1)} Td (${pdfString(z.text)}) Tj ET`,
      );
    }
    y -= groesse * 1.28 + (z.abstand ?? 0);
  }
  cmds.push(`BT /F1 8 Tf 50 28 Td (LUKAS Themenexport) Tj ET`);
  cmds.push(`BT /F1 8 Tf 500 28 Td (Seite ${seite}/${gesamt}) Tj ET`);
  return asciiBuffer(cmds.join("\n") + "\n");
}

function bauePdf(seiten: PdfZeile[][]): Buffer {
  const objekte: Buffer[] = [];
  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];
  const pageCount = seiten.length;
  const catalogObj = 1;
  const pagesObj = 2;
  const fontNormalObj = 3;
  const fontBoldObj = 4;
  let next = 5;

  for (let i = 0; i < pageCount; i++) {
    pageObjNums.push(next++);
    contentObjNums.push(next++);
  }

  objekte[catalogObj] = asciiBuffer(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  objekte[pagesObj] = asciiBuffer(
    `<< /Type /Pages /Count ${pageCount} /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] >>`,
  );
  objekte[fontNormalObj] = asciiBuffer("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objekte[fontBoldObj] = asciiBuffer("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  seiten.forEach((zeilen, i) => {
    const content = contentStream(zeilen, i + 1, pageCount);
    objekte[pageObjNums[i]] = asciiBuffer(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontNormalObj} 0 R /F2 ${fontBoldObj} 0 R >> >> /Contents ${contentObjNums[i]} 0 R >>`,
    );
    objekte[contentObjNums[i]] = Buffer.concat([
      asciiBuffer(`<< /Length ${content.length} >>\nstream\n`),
      content,
      asciiBuffer("endstream"),
    ]);
  });

  const teile: Buffer[] = [asciiBuffer("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets = new Array(next).fill(0);
  let offset = teile[0].length;
  for (let n = 1; n < next; n++) {
    offsets[n] = offset;
    const body = objekte[n];
    const obj = Buffer.concat([
      asciiBuffer(`${n} 0 obj\n`),
      body,
      asciiBuffer("\nendobj\n"),
    ]);
    teile.push(obj);
    offset += obj.length;
  }
  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${next}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${next} /Root ${catalogObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  teile.push(asciiBuffer(xref));
  return Buffer.concat(teile);
}

export function gehirnThemaPdf(g: Gehirn, themaId: string): Buffer {
  return bauePdf(seitenAusZeilen(dokumentZeilen(g, themaId)));
}

export function sichererPdfName(titel: string): string {
  const basis = titel
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return basis || "thema";
}
