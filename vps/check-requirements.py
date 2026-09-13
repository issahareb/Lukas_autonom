#!/usr/bin/env python3
"""Prueft, dass requirements.txt zu dem passt, was die Dienste WIRKLICH importieren.

WARUM ES DIESE PRUEFUNG GIBT — und warum die Datei allein nicht reicht.

requirements.txt ist aus einem AST-Durchlauf ueber alle Python-Dateien
entstanden. Am Tag ihrer Entstehung war sie richtig. Sie bleibt es nur, wenn
jemand sie nachzieht, und genau das passiert nicht: wer einen neuen Import
schreibt, denkt an seinen Code und nicht an eine Textdatei drei Ebenen weiter
oben. Beim naechsten Neuaufsetzen des Droplets faellt es auf — durch einen
Absturz, einen Import nach dem anderen, genau wie vorher.

Diese Pruefung nimmt denselben Weg wie die Datei entstanden ist und
vergleicht. Sie ist damit die Gegenprobe zur Datei.

DREI FAELLE, und sie sind nicht gleich schlimm:

  1. Hart importiert, aber nicht aufgefuehrt  -> HARTER FEHLER.
     Das ist der Fall, der beim Neuaufsetzen zum Absturz fuehrt.

  2. In try/except ImportError importiert  -> nur ein Hinweis.
     Der Code hat dann einen Rueckfall und laeuft ohne das Modul weiter —
     "graceful degradation", ausdruecklich so gebaut. Das hart zu verbieten
     wuerde eine bewusste Entscheidung zum Fehler erklaeren.

     Genau hier steckt allerdings ein echter Fund: `agent_intelligence` und
     `uma_watcher` werden so importiert, liegen aber in KEINEM Verzeichnis
     dieses Repositorys. Sie existieren nur auf dem Droplet. Wer den neu
     aufsetzt, bekommt still die Rueckfaelle — kein Absturz, aber auch nicht
     die Funktion. Deshalb werden sie benannt statt uebergangen.

  3. Aufgefuehrt, aber nicht importiert  -> gar nichts.
     Ein Paket kann ueber ein anderes gebraucht werden, per Plugin geladen
     oder erst zur Laufzeit importiert werden. Das hart zu verbieten wuerde
     erzwingen, dass jemand etwas Richtiges entfernt.

BRAUCHT NICHTS INSTALLIERTES. Reine Textanalyse ueber den Syntaxbaum —
deshalb kann sie in der Pruefkette laufen, ohne dass dort erst torch
heruntergeladen wird.
"""
import ast
import pathlib
import sys

HIER = pathlib.Path(__file__).resolve().parent

# ── Was NICHT als Fremdpaket zaehlt ──────────────────────────────────────
# Die Standardbibliothek kommt aus Python selbst, nicht von pip. Statt einer
# gepflegten Liste (die veraltet) wird gefragt, was diese Python-Version
# tatsaechlich mitbringt.
STDLIB = set(sys.stdlib_module_names)

# Importname -> Paketname auf PyPI. Sie stimmen oft nicht ueberein, und wer
# das nicht weiss, sucht lange: `import bs4` kommt aus `beautifulsoup4`.
IMPORT_ZU_PAKET = {
    "bs4": "beautifulsoup4",
    "dotenv": "python-dotenv",
    "psycopg2": "psycopg2-binary",
    "yaml": "pyyaml",
    "PIL": "pillow",
    "cv2": "opencv-python",
    "sklearn": "scikit-learn",
    "google": "google-genai",
    "eth_account": "eth-account",
    "eth_hash": "eth-hash",
    "eth_utils": "eth-utils",
    "py_clob_client": "py-clob-client",
}

# Die Schwergewichte fuer das Fine-Tuning stehen in requirements.txt bewusst
# auskommentiert: auf einem Droplet ohne GPU haben sie nichts verloren. Sie
# gelten hier trotzdem als "aufgefuehrt" — sonst schlaegt die Pruefung genau
# wegen der Entscheidung an, die absichtlich so getroffen wurde.
NUR_AUF_WUNSCH = {"torch", "transformers", "trl", "datasets", "unsloth"}


def lokale_module() -> set[str]:
    """Alles, was hier im Verzeichnisbaum selbst liegt — kein Fremdpaket."""
    namen = set()
    for pfad in HIER.rglob("*.py"):
        namen.add(pfad.stem)
        # Das Verzeichnis, in dem eine .py-Datei liegt, ist selbst ein
        # importierbarer Name — seit Python 3 auch OHNE __init__.py
        # (Namespace-Pakete). Nur auf __init__.py zu schauen war falsch und
        # hat `vps/dashboard/` faelschlich fuer ein PyPI-Paket gehalten.
        if pfad.parent != HIER:
            namen.add(pfad.parent.name)
    return namen


def faengt_importfehler(versuch: ast.Try) -> bool:
    """Faengt dieser try-Block einen ImportError ab?

    `except ImportError`, `except Exception` und ein nacktes `except` zaehlen
    alle: in allen drei Faellen laeuft der Code ohne das Modul weiter.
    """
    for handler in versuch.handlers:
        if handler.type is None:
            return True
        namen = (
            [handler.type]
            if not isinstance(handler.type, ast.Tuple)
            else list(handler.type.elts)
        )
        for n in namen:
            if isinstance(n, ast.Name) and n.id in {"ImportError", "ModuleNotFoundError", "Exception", "BaseException"}:
                return True
    return False


def importierte_wurzeln() -> tuple[dict[str, set[str]], set[str]]:
    """Jeder importierte Wurzelname -> die Dateien; plus: welche optional sind.

    "Optional" heisst: der Import steht in einem try-Block, der den
    ImportError faengt. Der Code hat dann einen Rueckfall.
    """
    treffer: dict[str, set[str]] = {}
    optional: set[str] = set()
    hart: set[str] = set()

    for pfad in sorted(HIER.rglob("*.py")):
        if "__pycache__" in pfad.parts or pfad.name == "check-requirements.py":
            continue
        try:
            baum = ast.parse(pfad.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError as err:
            # Eine Datei, die sich nicht lesen laesst, wird gemeldet statt
            # stillschweigend uebergangen — sonst faellt ihr Import unter den
            # Tisch und die Pruefung meldet faelschlich "alles gut".
            print(f"  WARNUNG — {pfad.relative_to(HIER)} ist nicht lesbar: {err}")
            continue

        # Welche Knoten stehen in einem try, das ImportError faengt?
        geschuetzt: set[int] = set()
        for knoten in ast.walk(baum):
            if isinstance(knoten, ast.Try) and faengt_importfehler(knoten):
                for kind in ast.walk(knoten):
                    geschuetzt.add(id(kind))

        for knoten in ast.walk(baum):
            wurzeln: list[str] = []
            if isinstance(knoten, ast.Import):
                wurzeln = [n.name.split(".")[0] for n in knoten.names]
            elif isinstance(knoten, ast.ImportFrom):
                # `from . import x` ist lokal, level > 0 sagt das.
                if knoten.level == 0 and knoten.module:
                    wurzeln = [knoten.module.split(".")[0]]
            for wurzel in wurzeln:
                treffer.setdefault(wurzel, set()).add(str(pfad.relative_to(HIER)))
                (optional if id(knoten) in geschuetzt else hart).add(wurzel)

    # Wird ein Modul IRGENDWO hart importiert, zaehlt es als hart: dort
    # stuerzt es ab, auch wenn eine andere Datei einen Rueckfall hat.
    return treffer, optional - hart


def aufgefuehrte_pakete() -> set[str]:
    """Was in requirements.txt steht — auskommentierte Zeilen eingeschlossen.

    Die auskommentierten Schwergewichte zaehlen mit: sie SIND aufgefuehrt,
    nur bewusst nicht installiert.
    """
    datei = HIER / "requirements.txt"
    pakete = set()
    for zeile in datei.read_text(encoding="utf-8").splitlines():
        roh = zeile.strip()
        if not roh:
            continue
        if roh.startswith("#"):
            roh = roh.lstrip("# ").strip()
            # Nur einzelne Paketnamen, kein Fliesstext aus den Kommentarbloecken.
            if not roh or " " in roh or roh.endswith(("—", ":", ".")):
                continue
        # Version und Kommentar abschneiden: "requests==2.31.0  # warum"
        name = roh.split("#")[0].strip()
        for trenner in ("==", ">=", "<=", "~=", ">", "<", "["):
            name = name.split(trenner)[0]
        name = name.strip()
        if name:
            pakete.add(name.lower().replace("_", "-"))
    return pakete


def main() -> int:
    lokal = lokale_module()
    aufgefuehrt = aufgefuehrte_pakete()
    treffer, optional = importierte_wurzeln()
    fehlend: dict[str, set[str]] = {}
    nur_auf_dem_droplet: dict[str, set[str]] = {}

    for wurzel, dateien in sorted(treffer.items()):
        if wurzel in STDLIB or wurzel in lokal:
            continue
        paket = IMPORT_ZU_PAKET.get(wurzel, wurzel).lower().replace("_", "-")
        if paket in aufgefuehrt or wurzel in NUR_AUF_WUNSCH:
            continue
        if wurzel in optional:
            nur_auf_dem_droplet[wurzel] = dateien
            continue
        fehlend[f"{wurzel} (Paket: {paket})"] = dateien

    if nur_auf_dem_droplet:
        print("Hinweis — importiert mit Rückfall, aber nirgends in diesem Repository:\n")
        for was, dateien in nur_auf_dem_droplet.items():
            print(f"  {was}  ({', '.join(sorted(dateien)[:3])})")
        print(
            "\nDer Code fängt den ImportError ab und läuft weiter — es stürzt also\n"
            "nichts ab. Aber wer das Droplet neu aufsetzt, bekommt still die\n"
            "Rückfälle statt der Funktion. Diese Dateien liegen nur auf dem Server.\n"
        )

    if fehlend:
        print("FEHLER — importiert, aber nicht in requirements.txt:\n")
        for was, dateien in fehlend.items():
            beispiele = ", ".join(sorted(dateien)[:3])
            mehr = f" und {len(dateien) - 3} weitere" if len(dateien) > 3 else ""
            print(f"  {was}")
            print(f"      importiert in: {beispiele}{mehr}")
        print(
            "\nBeim Neuaufsetzen des Droplets stuerzt das ab — einen Import nach dem\n"
            "anderen. Trag die Pakete in vps/requirements.txt nach.\n"
            "Heisst das Paket auf PyPI anders als der Importname, gehoert es\n"
            "zusaetzlich in IMPORT_ZU_PAKET hier oben."
        )
        return 1

    print(
        f"OK — Python-Abhängigkeiten: alles Importierte steht in requirements.txt "
        f"({len(aufgefuehrt)} Pakete aufgeführt)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
