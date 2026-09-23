# Spezifikation: `canonicalInputJson` und Hashes

Verbindlich für AP-08a und das Plugin (Jint-Parität). Bezug: TK 8.1, NFA Determinismus.

## Regeln
1. Objekte: Schlüssel **sortiert nach UTF-16-Codeeinheiten** (wie `Array.prototype.sort()` ohne Vergleichsfunktion), rekursiv.
2. Keine Leerzeichen/Zeilenumbrüche außerhalb von Strings.
3. Arrays behalten ihre Reihenfolge. Fachlich ungeordnete Mengen (z. B. Projekte, Zeilen) werden **vor** der Serialisierung nach ID sortiert – Aufgabe des Aufrufers (`buildPlanInput`).
4. `undefined` und Funktionen werden weggelassen (auch in Arrays verboten → Fehler). `null` bleibt.
5. Zahlen: `NaN`, `Infinity`, `-Infinity` → Fehler `canonical.non_finite`. `-0` → `0`. Wert mit `q(x, 1e9)` runden (§Rundung, **nicht** `Math.round`; bei |x| ≥ 1e6 unverändert), dann kürzeste ECMAScript-Darstellung (`String(x)`); Exponentenschreibweise wie ECMAScript.
6. Strings: JSON-Escaping wie `JSON.stringify` (keine Unicode-Normalisierung).
7. Boolesche Werte `true`/`false`.
8. Datumswerte nur als ISO-8601-Strings mit `Z`, ganze Sekunden.

## Rundung (verbindlich)
Alle Quantisierungen in der Engine laufen über **eine** Funktion, und zwar mit dem **ganzzahligen Kehrwert** (nicht mit dem Schritt):
```
roundHalfAwayFromZero(x) = (x >= 0) ? floor(x + 0.5) : -floor(-x + 0.5)   # 0,5 → 1 ; −0,5 → −1
q(x, inv)                = roundHalfAwayFromZero(x * inv) / inv           # inv = 1/Schritt, ganzzahlig
```
Erlaubte `inv`-Werte: `1e6` (Winkel, Schritt 1e-6°), `1e9` (Zahlen im kanonischen JSON), **`1e3` (Wetter-Scores, Schritt 0,001 – `specs/engine/weather.md` §2, WS-08)**, `10` (Rotatorwinkel 0,1°), `1` (Sekunden). **Die Variante `roundHalfAwayFromZero(x/step)*step` ist verboten**: die Rückmultiplikation ist in IEEE 754 nicht exakt – nachgerechnet liefert sie `q(2,0000005; 1e-6) = 2.0000009999999997` (statt `2.000001`) und `q(0,1+0,2; 1e-9) = 0.30000000000000004` (statt `0.3`); mit `inv` stimmen beide Werte exakt.

`Math.round` ist **verboten** (rundet halbe Werte Richtung +∞, −0,5 → 0, und ist in Jint nicht garantiert identisch); die ESLint-Regel für das Engine-Paket verbietet es zusammen mit den Trigonometrie-Funktionen.

## Hashes
- `inputHash = sha256hex(canonicalInputJson(PlanInput))`, **Hash-Eingabe sind die UTF-8-Bytes** der kanonischen Zeichenkette (verbindlich, AST-D10). Zusätzlich werden **alle Codepunkte > U+007F als `\uXXXX` escaped**, damit die Zeichenkette ASCII-rein ist und die Kodierungsfrage nicht entsteht: ECMAScript- und .NET-Zeichenketten sind UTF-16, `SHA256.HashData` arbeitet auf Bytes – ohne Festlegung liefert derselbe Projektname mit Umlaut in Node und Jint **verschiedene** Hashes. Pflicht-Testvektor mit Nicht-ASCII plus ein Jint-Paritätsfall mit Umlaut im Projektnamen.
- `outputHash = sha256hex(canonicalInputJson(NightPlan ohne {inputHash, outputHash, computedAt}))`
- SHA-256 eigene reine Implementierung in `packages/engine/src/hash` (kein `crypto` – Jint-Kompatibilität).

## Testvektoren (Pflicht)
| Eingabe | Ausgabe |
|---|---|
| `{"b":1,"a":2}` | `{"a":2,"b":1}` |
| `{"a":-0}` | `{"a":0}` |
| `{"a":0.1+0.2}` | `{"a":0.3}` |
| `{"a":1e21}` | `{"a":1e+21}` |
| `{"a":[3,1,2]}` | `{"a":[3,1,2]}` |
| `{"Z":1,"a":2,"É":3}` | `{"Z":1,"a":2,"É":3}` |
| `{"a":undefined,"b":null}` | `{"b":null}` |
| `{"a":NaN}` | Fehler `canonical.non_finite` |
| `sha256hex("")` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `q(0.5, 1)` · `q(1.5, 1)` · `q(2.5, 1)` | `1` · `2` · `3` (nicht Bankers Rounding) |
| `q(-0.5, 1)` · `q(-1.5, 1)` | `-1` · `-2` (vom Nullpunkt weg) |
| `q(2.0000005, 1e6)` | `2.000001` **exakt** (mit `/step` wäre es `2.0000009999999997`) |
| `q(0.1+0.2, 1e9)` | `0.3` exakt |
| `q(-2.0000005, 1e6)` | `-2.000001` |

Paritätstest: ≥ 500 zufällige `PlanInput` → gleicher `inputHash`/`outputHash` in Node und Jint.
