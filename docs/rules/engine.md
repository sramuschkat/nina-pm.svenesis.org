# Regeln: Engine (`packages/engine`)

Quelle: TK 8, Specs `docs/specs/engine/*`.

1. **Reine Funktionen**, keine Abhängigkeiten, kein I/O, kein `Date`, `Intl`, `Math.random`, `crypto`, `setTimeout`.
2. Trigonometrie/Exp/Log nur aus `src/math` (fdlibm-Port). Erlaubte `Math.*`: `abs, floor, ceil, trunc, min, max, sign, sqrt, PI` (**ohne `round`** – nur `q()`/`roundHalfUp`, Regel 9). ESLint-Regel erzwingt das.
3. Keine Iteration über `Map`/`Set`/Objektschlüssel ohne vorherige Sortierung; jede Auswahl mit vollständigem Tie-Break (zuletzt ID).
4. Ergebnisse in ganzen Sekunden (UTC) und Winkel mit 6 Nachkommastellen.
5. `inputHash`/`outputHash` nur über `canonicalInputJson` (`specs/engine/canonical-json.md`).
6. Soll-Pläne (`contracts/golden-plans`) müssen exakt bestehen; Referenztests gegen astropy innerhalb der Toleranzen (TK 9.2).
7. Bundle `engine.iife.js` muss in **Jint** laufen: ES2020 ohne `BigInt`, ohne Regex-Lookbehind, ohne `Intl`; Paritätstest ≥ 500 Zufallseingaben.
8. `ENGINE_VERSION` (SemVer) bei jeder Verhaltensänderung erhöhen; Major = inkompatibler `PlanInput`/`NightPlan`.
9. Runden nur über `q(x, inv)`/`roundHalfAwayFromZero` mit ganzzahligem Kehrwert (`specs/engine/canonical-json.md`); `Math.round` und `roundHalfAwayFromZero(x/step)*step` sind im Engine-Paket verboten (ESLint bzw. Review-Regel). Winkel vor Vergleichen auf `[0,360)` normalisieren; Zeichenketten ordinal vergleichen.
10. Performance: `planNight` ≤ 300 ms für 30 Projekte × 3 Panels × 5 Zeilen (Node, Lambda); Benchmark nightly.
11. Planungsalgorithmus = Port des Astro-PM-Plugins (`specs/engine/allocation.md`): Kompatibilitätsmodus muss mit `tools/astropm-oracle` übereinstimmen; Abweichungen nur laut §10 der Spezifikation.
12. Specs sind verbindlich: bei Unklarheit **nicht raten**, sondern Frage im PR/Chat und Spec ergänzen.
