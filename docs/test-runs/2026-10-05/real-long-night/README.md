# VM-Lauf `real-long-night` gegen den echten Server – 05.10.2026 (Lücke E) – nicht abgeschlossen

Lauf `pnpm vm-bench run real-long-night`: 4½ h Dunkelheit gegen den echten Server (≈ 5½ h Laufzeit) mit diesem Inhalt:

- sechs Ziele LRGB/SHO à 120 s, Dither alle 3;
- ein Flip ohne Rotator nach ≈ 4 h;
- Flats mit Panel nach der nautischen Dämmerung.

Prüfziel ist der Dauerbetrieb.

| Versuch | Plugin | Verlauf |
|---|---|---|
| 19:59 MESZ | 0.4.4 | NINA-Absturz 27 s nach dem Anlegen der Session (`coreclr.dll`) |
| 20:03 MESZ | 0.4.4 | Wiederholung: Absturz 31 s nach dem Anlegen der Session |
| 20:25 MESZ | 0.4.7 | Start abgebrochen (Lauf für die lange Laufzeit neu im Hintergrund gestartet); Agent hing kurz |
| 20:28 MESZ | 0.4.7 | 17 min sauber (Aufnahmen gemeldet, alle Antworten 200), dann **Hänger**: NINA antwortete nicht mehr, im Windows-Protokoll **kein** .NET-Absturz; die Wiederholung brach ab, weil **ASCOM OmniSim** nicht mehr antwortete (Port 32323). Im Protokoll nur ein nachgereichter Bluescreen-Bericht von Windows (Minidump vom 07.09.) |
| 20:52 MESZ | 0.4.7 | nach Neustart von Windows, OmniSim und PHD2 sauber gestartet; auf Wunsch nach 3 min gestoppt (Verkürzung auf 1 h gewünscht) |

**Verkürzung auf 1 h geprüft und verworfen:** Mit 45 min Dunkelheit plant die Engine die ganze Nacht für ein Ziel (`real-check long-night 45`: nur „Bench RGB“), kein Flip, kein Zielwechsel – der Zweck (Dauerbetrieb) entfiele. Stattdessen lief `real-full-night` mit 0.4.7 (grün).

**Offen:** eine lange Nacht in der VM grün; Dauerbetrieb mit Rig-Zeiten ist kopflos belegt (`../rig-times/`). Vor dem nächsten Versuch Windows in der VM neu starten und OmniSim/PHD2 prüfen.
