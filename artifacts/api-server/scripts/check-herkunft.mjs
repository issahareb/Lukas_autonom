/*
 * Prueft, dass der Verbrauch einer Aufgabe zurechenbar und gedeckelt ist.
 *
 * ANLASS: an einem Tag standen 4,2 Millionen Tokens auf der Uhr, nach Issas
 * eigener Aussage drei Fragen. Die Buchhaltung konnte nur sagen, WELCHES
 * Modell das Geld genommen hat — nicht, wer es geschickt hat. Chat, autonomer
 * Lauf, Selbstheilung und neun Mitarbeiter laufen alle durch denselben
 * model-client.
 *
 * Das eigentliche Loch war aber nicht die fehlende Spalte: ein Mitarbeiter
 * bekommt in runLukasTurn eine FRISCHE Arbeitsschleife mit eigenem vollem
 * Token-Budget. Was er ausgab, war fuer den aufrufenden Zug unsichtbar. Neun
 * Helfer waren neun Budgets, und keins sah das andere.
 *
 * Fuenf Eigenschaften, und die dritte ist die eigentliche Reparatur:
 *
 *  1. Ohne Zug faellt nichts um. Pruefskripte und das oeffentliche Widget
 *     oeffnen keinen — sie duerfen daran nicht scheitern.
 *  2. Die Herkunft wandert mit, auch durch await hindurch.
 *  3. Ein verschachtelter Zug ERBT den Zaehler (der Helfer laeuft auf die
 *     Rechnung des Aufrufers) und SETZT die Herkunft NEU (damit die
 *     Buchhaltung ihn trotzdem einzeln sieht). Genau diese Asymmetrie ist
 *     der Punkt; faellt eine der beiden Haelften weg, ist das Loch zurueck.
 *  4. Der Deckel gilt fuer die ganze Aufgabe, nicht je Ebene — und er wird
 *     vom Kind GEERBT, nicht ueberschrieben. Duerfte ein Helfer sich einen
 *     eigenen, groesseren setzen, waere der Deckel eine Empfehlung.
 *  5. Nebenlaeufige Aufgaben vermischen sich nicht. Zwei gleichzeitige Zuege
 *     duerfen sich nicht gegenseitig aufs Budget schlagen.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".herkunft-check-"));
const out = join(dir, "z.mjs");

await build({
  entryPoints: ["src/lib/zug.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  external: ["node:async_hooks"],
});

const { imZug, herkunft, zugVerbraucht, deckelErreicht, zugStand } = await import(out);

const fehler = [];
const pruefe = (bedingung, text) => {
  if (!bedingung) fehler.push(text);
};

/* 1. Ohne Zug: still, nicht laut. */
pruefe(herkunft() === "unbekannt", "Ohne Zug muss die Herkunft 'unbekannt' sein");
pruefe(deckelErreicht() === null, "Ohne Zug darf kein Deckel greifen");
pruefe(zugStand() === null, "Ohne Zug gibt es keinen Stand");
zugVerbraucht(999); // darf nicht werfen

/* 2. Die Herkunft ueberlebt ein await. */
await imZug({ herkunft: "chat", istIssa: true }, async () => {
  pruefe(herkunft() === "chat", "Herkunft im Zug falsch");
  await new Promise((r) => setTimeout(r, 1));
  pruefe(herkunft() === "chat", "Herkunft nach await verloren — das ist der ganze Sinn");
});
pruefe(herkunft() === "unbekannt", "Nach dem Zug muss die Herkunft wieder weg sein");

/* 3. Verschachtelt: Zaehler geerbt, Herkunft neu. */
await imZug({ herkunft: "autonom", istIssa: false, deckel: 1000 }, async () => {
  zugVerbraucht(100);
  pruefe(zugStand().tokens === 100, "Eigener Verbrauch nicht gezählt");

  await imZug({ herkunft: "mitarbeiter:rechercheur" }, async () => {
    pruefe(
      herkunft() === "mitarbeiter:rechercheur",
      "Der Helfer muss unter EIGENER Herkunft buchen — sonst ist er in der Rechnung unsichtbar",
    );
    pruefe(
      zugStand().tokens === 100,
      "Der Helfer muss den Zähler des Aufrufers ERBEN — sonst fängt er bei null an, und genau das war das Loch",
    );
    pruefe(zugStand().tiefe === 1, "Tiefe muss mitzählen");
    zugVerbraucht(300);
  });

  pruefe(
    zugStand().tokens === 400,
    "Was der Helfer ausgibt, muss der Aufrufer sehen (erwartet 400, bekommen " +
      zugStand().tokens + ")",
  );
  pruefe(herkunft() === "autonom", "Nach dem Helfer muss die eigene Herkunft zurück sein");
});

/* 4. Der Deckel gilt fuer die Aufgabe — und ein Kind kann ihn nicht anheben. */
await imZug({ herkunft: "autonom", istIssa: false, deckel: 1000 }, async () => {
  zugVerbraucht(900);
  pruefe(deckelErreicht() === null, "Unter dem Deckel darf nichts greifen");

  await imZug({ herkunft: "mitarbeiter:coder", deckel: 999_999 }, async () => {
    pruefe(
      zugStand().deckel === 1000,
      "Ein Helfer darf sich KEINEN größeren Deckel setzen — sonst ist der Deckel nur eine Empfehlung",
    );
    zugVerbraucht(200);
    pruefe(
      deckelErreicht() !== null,
      "Bei 1100 von 1000 muss der Deckel greifen, und zwar im Helfer",
    );
  });

  const grund = deckelErreicht();
  pruefe(grund !== null, "Der Deckel muss auch beim Aufrufer greifen");
  pruefe(
    grund && /1\.100/.test(grund) && /1\.000/.test(grund),
    "Der Grund muss beide Zahlen nennen — 'abgebrochen' ohne Zahl ist für Lukas nur ein neues Rätsel",
  );
  pruefe(
    grund && /Mitarbeiter/i.test(grund),
    "Der Grund muss sagen, dass Mitarbeiter mitgerechnet sind",
  );
});

/* 5. Zwei Aufgaben nebeneinander vermischen sich nicht. */
{
  const beide = await Promise.all([
    imZug({ herkunft: "a", deckel: 500 }, async () => {
      zugVerbraucht(10);
      await new Promise((r) => setTimeout(r, 5));
      zugVerbraucht(10);
      return zugStand().tokens;
    }),
    imZug({ herkunft: "b", deckel: 500 }, async () => {
      await new Promise((r) => setTimeout(r, 2));
      zugVerbraucht(70);
      return zugStand().tokens;
    }),
  ]);
  pruefe(
    beide[0] === 20 && beide[1] === 70,
    "Nebenläufige Züge dürfen sich nicht gegenseitig aufs Budget schlagen (bekommen " +
      JSON.stringify(beide) + ")",
  );
}

/* 6. Ohne Deckel laeuft alles wie bisher — der Chat soll nichts merken. */
await imZug({ herkunft: "chat", istIssa: true }, async () => {
  zugVerbraucht(50_000_000);
  pruefe(deckelErreicht() === null, "Ohne Deckel darf nie etwas greifen — das ist Issas Gespräch");
});

rmSync(dir, { recursive: true, force: true });

if (fehler.length) {
  console.error("FEHLER — Herkunft/Deckel:");
  for (const f of fehler) console.error("  - " + f);
  process.exit(1);
}
console.log(
  "OK — Herkunft: wandert durch await, Helfer buchen eigen aber zahlen gemeinsam, " +
    "der Deckel gilt der Aufgabe und lässt sich von unten nicht anheben.",
);
