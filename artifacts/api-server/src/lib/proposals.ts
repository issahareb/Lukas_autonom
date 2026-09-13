import { db } from "@workspace/db";
import { codeProposals, type CodeProposal, type ProposalFile } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { githubRequest, resolveGithubOwner, selfBranch } from "./github";
import { logger } from "./logger";

/*
 * Lukas' Code-Vorschlaege.
 *
 * Der Weg ist absichtlich kurz: Lukas legt einen Vorschlag an, Issa liest ihn
 * im Dashboard in normaler Sprache und entscheidet dort. Kein Branch, kein
 * Pull Request, kein Wechsel zu GitHub.
 *
 * Erst beim "Annehmen" wird ueberhaupt etwas geschrieben — vorher liegt der
 * Vorschlag nur in unserer eigenen Datenbank. Deshalb braucht das Anlegen auch
 * keine separate Freigabe: der Vorschlag selbst kann nichts kaputt machen, und
 * die Entscheidung darueber IST die Freigabe.
 */

// Branch, auf den eine angenommene Aenderung geschrieben wird — derselbe, den
// Lukas auch beim Lesen seines eigenen Codes benutzt (lib/github.ts).
export const targetBranch = selfBranch;

/**
 * Die aktuelle Blob-SHA einer Datei auf dem Zielbranch. `null`, wenn es die
 * Datei dort (noch) nicht gibt.
 */
async function aktuelleSha(
  owner: string,
  repo: string,
  pfad: string,
  branch: string | null,
): Promise<string | null> {
  const apiPath = `/repos/${owner}/${repo}/contents/${pfad
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  try {
    const query = branch ? `?ref=${encodeURIComponent(branch)}` : "";
    const existing = (await githubRequest(`${apiPath}${query}`)) as { sha?: string };
    return existing?.sha ?? null;
  } catch {
    return null; // Datei gibt es noch nicht
  }
}

export async function createProposal(args: {
  conversationId?: number;
  repo: string;
  title: string;
  summary: string;
  reasoning: string;
  files: ProposalFile[];
}): Promise<CodeProposal> {
  /*
   * Festhalten, gegen WELCHEN Stand dieser Vorschlag geschrieben ist.
   *
   * Ohne das ueberschreibt ein spaeter angenommener Vorschlag stillschweigend
   * alles, was in der Zwischenzeit an derselben Datei passiert ist — der
   * Inhalt ist ja der vollstaendige alte Dateiinhalt plus Lukas' Aenderung.
   */
  const { owner, repo } = await resolveGithubOwner(args.repo);
  const branch = targetBranch();
  const files: ProposalFile[] = [];
  for (const file of args.files) {
    const pfad = file.path.replace(/^\/+/, "");
    files.push({
      ...file,
      path: pfad,
      baseSha: await aktuelleSha(owner, repo, pfad, branch),
    });
  }

  /*
   * Den Stand des ganzen Branches festhalten, nicht nur den je Datei.
   *
   * Die Blob-SHA sagt, ob EINE Datei sich geaendert hat. Der Basiscommit sagt,
   * gegen welchen Gesamtstand der Vorschlag geschrieben ist — und genau der
   * wird beim Annehmen der Elternteil des Commits. Laesst er sich nicht
   * ermitteln, wird der Vorschlag trotzdem angelegt: ein Vorschlag ohne Basis
   * ist besser als gar keiner, das Annehmen sagt dann Bescheid.
   */
  let baseCommit: string | null = null;
  try {
    baseCommit = await kopfCommit(owner, repo, branch);
  } catch (err) {
    logger.warn({ err }, "Basiscommit nicht ermittelbar — Vorschlag ohne Basis");
  }

  const [row] = await db
    .insert(codeProposals)
    .values({
      conversationId: args.conversationId ?? null,
      repo: args.repo,
      title: args.title,
      summary: args.summary,
      reasoning: args.reasoning,
      files,
      baseCommit,
      status: "pending",
    })
    .returning();
  logger.info({ proposalId: row.id, files: args.files.length }, "Code-Vorschlag angelegt");
  return row;
}

export async function listProposals(): Promise<CodeProposal[]> {
  return db.select().from(codeProposals).orderBy(desc(codeProposals.createdAt)).limit(100);
}

export async function getProposal(id: number): Promise<CodeProposal | null> {
  const [row] = await db.select().from(codeProposals).where(eq(codeProposals.id, id));
  return row ?? null;
}

/** Eine Datei, die sich seit dem Vorschlag geaendert hat. */
export type Konflikt = { pfad: string; grund: string };

/*
 * Ist der Vorschlag noch auf dem aktuellen Stand?
 *
 * Das ist die Pruefung, die gefehlt hat. Ein Vorschlag enthaelt den
 * VOLLSTAENDIGEN neuen Dateiinhalt — geschrieben gegen den Stand von damals.
 * Wird er spaeter angenommen und die Datei hat sich inzwischen geaendert, geht
 * die Zwischenzeit verloren, ohne dass jemand etwas merkt.
 *
 * Genau so hat Vorschlag #3 beim Annehmen eine Zeile entfernt, die kurz vorher
 * dazugekommen war.
 */
async function pruefeAktualitaet(proposal: CodeProposal): Promise<Konflikt[]> {
  const { owner, repo } = await resolveGithubOwner(proposal.repo);
  const branch = targetBranch();
  const konflikte: Konflikt[] = [];

  for (const file of proposal.files) {
    const pfad = file.path.replace(/^\/+/, "");
    const jetzt = await aktuelleSha(owner, repo, pfad, branch);

    // Alte Vorschlaege haben keine baseSha — dann ist keine Pruefung moeglich.
    if (file.baseSha === undefined) continue;

    if ((file.baseSha ?? null) === jetzt) continue;

    konflikte.push({
      pfad,
      grund:
        file.baseSha === null
          ? "Die Datei gab es beim Vorschlag noch nicht, inzwischen schon."
          : jetzt === null
            ? "Die Datei wurde inzwischen gelöscht."
            : "Die Datei wurde seit dem Vorschlag geändert.",
    });
  }

  return konflikte;
}

/** Der Commit, auf dem der Zielbranch gerade steht. */
async function kopfCommit(owner: string, repo: string, branch: string | null): Promise<string> {
  if (branch) {
    const ref = (await githubRequest(
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    )) as { object?: { sha?: string } };
    if (!ref?.object?.sha) throw new Error(`Branch ${branch} hat keinen Kopf-Commit.`);
    return ref.object.sha;
  }
  const info = (await githubRequest(`/repos/${owner}/${repo}`)) as { default_branch?: string };
  const ref = (await githubRequest(
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(info.default_branch ?? "main")}`,
  )) as { object?: { sha?: string } };
  if (!ref?.object?.sha) throw new Error("Default-Branch hat keinen Kopf-Commit.");
  return ref.object.sha;
}

/*
 * Angenommenen Vorschlag anwenden: EIN Commit, eigener Branch, Pull Request.
 *
 * WARUM NICHT MEHR DATEI FUER DATEI. Die Contents-API schreibt je Aufruf eine
 * Datei und damit einen Commit. Scheiterte die dritte, waren die ersten beiden
 * schon geschrieben — ein Zustand, den niemand beschlossen hat, und keiner, aus
 * dem man sauber zurueckkommt. Nachgestellt und bestaetigt.
 *
 * WARUM GEGEN DEN BASISCOMMIT. Vorher holte das Schreiben die AKTUELLE Blob-SHA
 * und schrieb dagegen. Wer zwischen Pruefung und Schreiben etwas aenderte, war
 * damit ueberschrieben — die Pruefung davor half nichts, weil zwischen ihr und
 * dem Schreiben ein Fenster lag. Jetzt ist der Elternteil des Commits fest:
 * `baseCommit`. Ist der Zielbranch weitergelaufen, kann der Pull Request nicht
 * ohne Weiteres mergen und sagt das.
 *
 * WARUM EIN PULL REQUEST STATT DIREKT AUF DEN ZIELBRANCH. Weil ein Konflikt
 * dort sichtbar wird, statt beim Schreiben entweder zu scheitern oder etwas zu
 * ueberfahren. Entschieden wird weiterhin im Dashboard; der Pull Request ist
 * der Beleg, nicht der Entscheidungsweg.
 *
 * Die vier Schritte der Git-Data-API bauen nacheinander aufeinander auf. Bricht
 * einer ab, ist nichts am Zielbranch passiert: Baum und Commit haengen an
 * keinem Branch, solange die Referenz nicht steht.
 */
async function applyProposal(proposal: CodeProposal): Promise<string> {
  const { owner, repo } = await resolveGithubOwner(proposal.repo);
  const branch = targetBranch();

  const basis = proposal.baseCommit ?? (await kopfCommit(owner, repo, branch));
  const ohneBasis = !proposal.baseCommit;

  // 1. Baum mit ALLEN Dateien auf einmal, auf dem Baum des Basiscommits.
  const basisCommit = (await githubRequest(`/repos/${owner}/${repo}/git/commits/${basis}`)) as {
    tree?: { sha?: string };
  };
  if (!basisCommit?.tree?.sha) {
    throw new Error(
      `Der Basiscommit ${basis.slice(0, 7)} ist nicht mehr auffindbar. ` +
        "Der Vorschlag muss neu erstellt werden.",
    );
  }

  const baum = (await githubRequest(`/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: {
      base_tree: basisCommit.tree.sha,
      tree: proposal.files.map((f) => ({
        path: f.path.replace(/^\/+/, ""),
        mode: "100644",
        type: "blob",
        content: f.content,
      })),
    },
  })) as { sha?: string };
  if (!baum?.sha) throw new Error("GitHub hat keinen Baum zurueckgegeben.");

  // 2. Ein Commit, Elternteil ist genau der Basiscommit.
  const commit = (await githubRequest(`/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: {
      message:
        `${proposal.title}\n\n${proposal.summary}\n\n` +
        `Vorschlag #${proposal.id} von Lukas, angenommen von Issa.`,
      tree: baum.sha,
      parents: [basis],
    },
  })) as { sha?: string; html_url?: string };
  if (!commit?.sha) throw new Error("GitHub hat keinen Commit zurueckgegeben.");

  // 3. Eigener Branch. Erst hier wird die Aenderung ueberhaupt sichtbar.
  const vorschlagsBranch = `lukas/vorschlag-${proposal.id}`;
  await githubRequest(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${vorschlagsBranch}`, sha: commit.sha },
  });

  // 4. Pull Request. Schlaegt das fehl (fehlende Rechte, Branch-Regel), bleibt
  //    der Branch trotzdem stehen — die Arbeit ist nicht verloren, sie braucht
  //    nur einen Handgriff. Deshalb ist das hier kein harter Abbruch.
  const ziel = branch ?? undefined;
  let prUrl: string | null = null;
  let prHinweis = "";
  try {
    const pr = (await githubRequest(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: {
        title: proposal.title,
        head: vorschlagsBranch,
        ...(ziel ? { base: ziel } : {}),
        body:
          `${proposal.summary}\n\n**Warum:** ${proposal.reasoning}\n\n` +
          `Vorschlag #${proposal.id}, im Dashboard angenommen.\n` +
          `Basis: \`${basis.slice(0, 7)}\``,
      },
    })) as { html_url?: string; mergeable?: boolean };
    prUrl = pr?.html_url ?? null;
  } catch (err) {
    prHinweis =
      `\n\nDer Pull Request liess sich nicht anlegen (${(err as Error).message}). ` +
      `Der Branch \`${vorschlagsBranch}\` steht aber — von dort aus ist alles erhalten.`;
  }

  await db
    .update(codeProposals)
    .set({ branchName: vorschlagsBranch, pullRequestUrl: prUrl })
    .where(eq(codeProposals.id, proposal.id));

  logger.info(
    { proposalId: proposal.id, commit: commit.sha, branch: vorschlagsBranch, pr: prUrl },
    "Vorschlag als ein Commit abgelegt",
  );

  const basisHinweis = ohneBasis
    ? "\n\nHinweis: Dieser Vorschlag stammt von vor der Einführung des Basiscommits — " +
      "er wurde gegen den aktuellen Stand gebaut. Bitte den Commit kurz ansehen."
    : "";

  const dateien = proposal.files.map((f) => f.path).join(", ");
  return (
    `Übernommen als **ein** Commit auf \`${vorschlagsBranch}\` (${proposal.files.length} Datei(en): ${dateien}).` +
    (prUrl ? `\n\nPull Request: ${prUrl}` : "") +
    basisHinweis +
    prHinweis
  );
}

export type Decision = "accept" | "reject" | "revision";

export async function decideProposal(
  id: number,
  decision: Decision,
  comment?: string,
): Promise<CodeProposal> {
  const proposal = await getProposal(id);
  if (!proposal) throw new Error(`Vorschlag ${id} existiert nicht.`);
  if (proposal.status === "accepted") {
    throw new Error(`Vorschlag ${id} wurde bereits übernommen.`);
  }

  if (decision !== "accept") {
    const [row] = await db
      .update(codeProposals)
      .set({
        status: decision === "reject" ? "rejected" : "revision",
        comment: comment ?? null,
        decidedAt: new Date(),
      })
      .where(eq(codeProposals.id, id))
      .returning();
    return row;
  }

  /*
   * Vor dem Schreiben: ist der Vorschlag ueberhaupt noch aktuell?
   *
   * Wenn nicht, wird NICHT geschrieben. Der Vorschlag geht stattdessen mit
   * einer Begruendung an Lukas zurueck, damit er ihn gegen den jetzigen Stand
   * neu schreibt. Das ist der Unterschied zwischen "Issa hat zugestimmt" und
   * "Issa hat zugestimmt, dass die Arbeit der letzten Stunde geloescht wird".
   */
  const konflikte = await pruefeAktualitaet(proposal);
  if (konflikte.length > 0) {
    const begruendung =
      `Nicht übernommen — der Vorschlag ist nicht mehr aktuell:\n` +
      konflikte.map((k) => `- ${k.pfad}: ${k.grund}`).join("\n") +
      `\n\nEr enthält den vollständigen Dateiinhalt von damals. Übernommen würde er ` +
      `alles überschreiben, was seitdem an diesen Dateien passiert ist. ` +
      `Lukas soll die betroffenen Dateien neu lesen und den Vorschlag gegen den ` +
      `jetzigen Stand noch einmal schreiben.`;

    logger.warn({ proposalId: id, konflikte }, "Vorschlag veraltet — nicht übernommen");

    const [row] = await db
      .update(codeProposals)
      .set({
        status: "revision",
        comment: [comment, begruendung].filter(Boolean).join("\n\n"),
        appliedResult: begruendung,
        decidedAt: new Date(),
      })
      .where(eq(codeProposals.id, id))
      .returning();
    return row;
  }

  // Erst schreiben, dann als angenommen markieren. Andersherum stuende der
  // Vorschlag auf "übernommen", obwohl GitHub den Commit abgelehnt hat.
  let appliedResult: string;
  try {
    appliedResult = await applyProposal(proposal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, proposalId: id }, "Vorschlag konnte nicht übernommen werden");
    const [row] = await db
      .update(codeProposals)
      .set({ appliedResult: `Fehlgeschlagen: ${message}` })
      .where(eq(codeProposals.id, id))
      .returning();
    return row;
  }

  const [row] = await db
    .update(codeProposals)
    .set({
      status: "accepted",
      comment: comment ?? null,
      appliedResult,
      decidedAt: new Date(),
    })
    .where(eq(codeProposals.id, id))
    .returning();
  return row;
}

/*
 * Was Lukas im Systemprompt ueber seine eigenen Vorschlaege erfaehrt.
 *
 * Ohne das wuerde er nie mitbekommen, dass Issa etwas zurueckgeschickt oder
 * abgelehnt hat — er wuerde denselben Vorschlag wieder und wieder machen.
 */
export async function getProposalContext(): Promise<string> {
  const rows = await db
    .select()
    .from(codeProposals)
    .where(inArray(codeProposals.status, ["pending", "revision"]))
    .orderBy(desc(codeProposals.createdAt))
    .limit(10);
  if (rows.length === 0) return "";

  const lines = rows.map((r) => {
    if (r.status === "revision") {
      return (
        `- #${r.id} "${r.title}" — Issa hat zurückgeschickt und kommentiert: ` +
        `"${(r.comment ?? "").slice(0, 400)}" ` +
        `Arbeite den Kommentar ein und schick den Vorschlag neu.`
      );
    }
    return `- #${r.id} "${r.title}" — liegt im Dashboard und wartet auf Issas Entscheidung. Schlag das nicht nochmal vor.`;
  });

  return ["## DEINE OFFENEN CODE-VORSCHLÄGE", ...lines].join("\n");
}
