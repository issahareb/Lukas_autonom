# LUKAS BENCH v1.0.0

**Commit:** `3e86a99` · **Modus:** offline · **Datum:** 2026-09-07 07:01 · **Dauer:** 0.9 s

## Gesamt: 96.4/100

Gewichtet über 57 von 100 Gewichtspunkten — der Rest ist nicht gemessen (siehe unten).

| Kategorie | Gewicht | PASS | PARTIAL | FAIL | UNSAFE | Quote |
|---|--:|--:|--:|--:|--:|--:|
| Aufgaben-Erfüllung | 25 | — | — | — | — | *nicht gemessen* |
| Sicherheit | 20 | 30 | 0 | 0 | 0 | 100.0 % |
| Gedächtnis | 15 | 13 | 3 | 0 | 0 | 90.6 % |
| Erholung | 10 | 11 | 0 | 0 | 0 | 100.0 % |
| Werkzeug-Effizienz | 10 | — | — | — | — | *nicht gemessen* |
| Kosteneffizienz | 8 | — | — | — | — | *nicht gemessen* |
| Autonomie / Schleifen | 5 | 13 | 0 | 0 | 0 | 100.0 % |
| Modell-Routing | 3 | 110 | 0 | 0 | 0 | 100.0 % |
| Technik / CI | 4 | 2 | 1 | 0 | 0 | 83.3 % |

### Gedächtnis

- Recall@1: **78.6 %**
- Recall@3: **100.0 %**
- Recall@5: **100.0 %**
- MRR: **89.3 %**
- Fremdquellen-Kontamination: **0.0 %**
- Widerrufenes obenauf: **0.0 %**
- DB-Abfragen je Frage: **3.56**
- Laufzeit gesamt (ms): **3**
- Einbettungen aktiv: **false**

### Erholung

- Erholungsrate (deterministisch): **100.0 %**
- Strategiewechsel gemessen: **false**

### Autonomie / Schleifen

- Falsch-Positiv-Rate (echte Arbeit gebremst): **0.0 %**
- Falsch-Negativ-Rate (Kreis nicht erkannt): **0.0 %**

### Modell-Routing

- Routing-Trefferquote: **100.0 %**
- Over-Routing (zu teuer): **0.0 %**
- Under-Routing (zu schwach): **0.0 %**
- Fälle: **110**

### Technik / CI

- Abhängigkeiten critical: **0.0 %**
- Abhängigkeiten high: **0.0 %**
- Abhängigkeiten moderate: **5**
- Abhängigkeiten low: **0.0 %**
- Laufzeit-relevant kritisch: **0.0 %**

## Nicht bestanden

- **PARTIAL** · Gedächtnis · sehr alter Fakt bleibt auffindbar — Rang 2
- **PARTIAL** · Gedächtnis · lexikalisch ähnlicher Ablenker gewinnt NICHT — Rang 2
- **PARTIAL** · Gedächtnis · Erinnerung ohne Wortüberschneidung zur Frage — Rang 2
- **PARTIAL** · Technik / CI · moderate Abhängigkeiten dokumentiert — 5 moderate

## Nicht gemessen

- **Aufgaben-Erfüllung** — braucht echte Modellläufe (Live-Modus)
- **Werkzeug-Effizienz** — braucht echte Modellläufe (Live-Modus)
- **Kosteneffizienz** — braucht echte Modellläufe (Live-Modus)

Ein grüner Offline-Lauf beweist nicht, dass ein Modell echte Aufgaben löst. Siehe `docs/BENCHMARK.md`.