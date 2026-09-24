# Regeln: Engine (`packages/engine`)

Quelle: TK 8, Specs `docs/specs/engine/*`.

1. **Reine Funktionen**, keine Abhängigkeiten, kein I/O, kein `Date`, `Intl`, `Math.random`, `crypto`, `setTimeout`.
2. Trigonometrie/Exp/Log nur aus `src/math` (fdlibm-Port: `sin, cos, tan, asin, acos, atan, atan2, exp, log, **log10**, pow, fmod`). ESLint arbeitet als **Allowlist**, nicht als Verbotsliste (AST-D8): erlaubt sind ausschließlich `Math.abs, floor, ceil, trunc, min, max, sign, sqrt, PI`; **jedes andere `Math`-Member** und **jeder `**`-Operator** sind im Engine-Paket abgelehnt. Begründung: eine Aufzählung ließ `Math.log10` (gebraucht in `transit.md` §1 für `Δm`), `log2, log1p, expm1, hypot, cbrt, sinh…atanh, fround` offen, und `a ** b` ist laut Spezifikation gleichwertig zu `Math.pow` – es umging das Verbot vollständig. `sqrt` braucht keinen Port, weil IEEE 754 es exakt festlegt; der Jint-Paritätstest führt es trotzdem mit. Ebenso `fmod`: der ECMAScript-Operator `%` ist exakt festgelegt (ECMA-262 §6.1.6.1.6, entspricht C `fmod` und .NET `%`), `math.fmod` ist deshalb `x % y` (AP-08a).
3. Keine Iteration über `Map`/`Set`/Objektschlüssel ohne vorherige Sortierung; jede Auswahl mit vollständigem Tie-Break (zuletzt ID).
4. Ergebnisse in ganzen Sekunden (UTC) und Winkel mit 6 Nachkommastellen – **alle** Ausgabe-Rundungen über `q(x, inv)` mit den in `canonical-json.md` tabellierten `inv`-Werten je Feld (Maßstab 1e3, Bildfeld 1e4, Winkel 1e6). `toFixed`, `toPrecision` und `Number.prototype.toString(radix)` sind im Engine-Paket verboten: sie liefern Zeichenketten, und ein zurückgeparster `toFixed`-Wert kann von `q()` abweichen (AST-D31). Formatierung ist Sache der Oberfläche.
5. `inputHash`/`outputHash` nur über `canonicalInputJson` (`specs/engine/canonical-json.md`).
6. Soll-Pläne (`contracts/golden-plans`) müssen exakt bestehen; Referenztests gegen astropy innerhalb der Toleranzen (TK 9.2).
7. Bundle `engine.iife.js` muss in **Jint** laufen: ES2020 ohne `BigInt`, ohne Regex-Lookbehind, ohne `Intl`; Paritätstest ≥ 500 Zufallseingaben.
8. `ENGINE_VERSION` (SemVer) bei jeder Verhaltensänderung erhöhen; Major = inkompatibler `PlanInput`/`NightPlan`.
9. Runden nur über `q(x, inv)`/`roundHalfAwayFromZero` mit ganzzahligem Kehrwert (`specs/engine/canonical-json.md`); `Math.round` und `roundHalfAwayFromZero(x/step)*step` sind im Engine-Paket verboten (ESLint bzw. Review-Regel). Winkel vor Vergleichen auf `[0,360)` normalisieren; Zeichenketten ordinal vergleichen.
10. Performance: `planNight` ≤ 300 ms für 30 Projekte × 3 Panels × 5 Zeilen (Node, Lambda); Benchmark nightly.
11. Planungsalgorithmus = Port des Astro-PM-Plugins (`specs/engine/allocation.md`): Kompatibilitätsmodus muss mit `tools/astropm-oracle` übereinstimmen; Abweichungen nur laut §10 der Spezifikation.
12. Specs sind verbindlich: bei Unklarheit **nicht raten**, sondern Frage im PR/Chat und Spec ergänzen.
