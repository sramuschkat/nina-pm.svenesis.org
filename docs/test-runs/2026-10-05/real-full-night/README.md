# VM-Lauf `real-full-night` gegen den echten Server – 05.10.2026 (Stufe 2a)

Lauf `pnpm vm-bench run real-full-night`: typische Starfront-Nacht gestaucht gegen den echten Server (PGlite, Demo-Seed):

- **Ziele:** vier Projekte mit LRGB und SHO, Gain/Offset 125/50 je Zeile, Dither alle 3.
- **Nacht:** Nachtende 40 min nach dem Start.
- **Flats:** mit Flat-Panel (OmniSim) erst nach der nautischen Dämmerung (*Wait for Time → Nautical Dawn* in „Vor Flats“), danach Dark-Flats, Abschluss, Nachtbericht und Discord (lokale Nachbildung).

Zwei Läufe: mit Plugin 0.4.4 (Nachmittag) und mit Plugin 0.4.7 (Abend, nach #273/#274).

| Gerät | Simulator | Zustand |
|---|---|---|
| Kamera | Camera Sky Simulator for ALPACA | verbunden, −10 °C |
| Montierung | Mount Sky Simulator for ALPACA | verbunden |
| Filterrad | Filterwheel Sky Simulator for ALPACA | verbunden |
| Guider | PHD2 (Simulator) | verbunden |
| Safety-Monitor | OmniSim Safety Monitor | verbunden, sicher |
| Flat-Panel | OmniSim CoverCalibrator | verbunden |
| Rotator, Fokussierer, Kuppel | – | getrennt |

## Lauf 1 – Plugin 0.4.4 (17:29–19:14 MESZ)

- Erster Versuch: NINA-Absturz nach gut 20 min (17:51, `coreclr.dll`, siehe `../vm-crashes/`); der Absturz-Wächter wiederholte den Lauf um 17:52.
- Zweiter Versuch: 21 Lights in B, G, Ha, OIII, R, SII, Session abgeschlossen, Outbox leer, Abschluss- und Bericht-Job erledigt, Discord angekommen, Flats je Filter erledigt, Panel zu und an während der Flats, danach aus.
- **Rot nur durch die Dämmerungsprüfung:** erste Flat 85 s vor der nautischen Dämmerung der Engine. NINAs *Wait for Time* rechnet die Dämmerung selbst aus dem Profil und endete 100 s früher; das Plugin begann danach sofort. Prüfung auf 3 min Spielraum geändert (`DAWN_TOLERANCE_MS`, auch `rig-night:check`).
- **Befund Leerlauf 16:04–16:15Z (10 von 40 min):** Im Erstplan war „Bench RGB“ um 16:04 fertig, die Engine gab den Rest seines Laufs frei (`idle_gap`, allocation.md A-29), bot ihn im selben Plan aber nicht neu an (§8.6 Nr. 7). Die Neuplanung des Plugins vor dem nächsten Block begann laut Spec bei `max(jetzt, geplanter Blockstart)` = 16:15, die Lücke blieb leer. Kopflos nachgestellt mit mitgeschnittenen Plänen: bisher 36/36/23 Lights je Lauf (Projekt-IDs zufällig), mit Neuplanung ab jetzt 6 × 37. Behoben in **Plugin 0.4.7 (#274)**: `startAtUtc = now`, neuer Anlass `IdleAhead` bei > 5 min bis zum nächsten Block.
- Daten: `report-0.4.4.json`, `summary-0.4.4.json`.

## Lauf 2 – Plugin 0.4.7 (20:58–22:22 MESZ), nach Neustart von Windows in der VM

| Prüfung | Ergebnis |
|---|---|
| Session abgeschlossen, Outbox leer | ☑ |
| Aufnahmen gemeldet, Zähler = Lights | ☑ 27 Lights |
| Abschluss- und Bericht-Job, Discord | ☑ 3 Aufrufe |
| Mehrere Filter | ☑ L, R, G, B, Ha, OIII, SII |
| Je belichtetem Filter eine Flat-Kombination done | ☑ |
| Flats erst nach der nautischen Dämmerung | ☑ erste Flat 20:17:35Z, Dämmerung 20:17:17Z |
| Flat-Panel zu und an während der Flats, danach aus | ☑ |
| NINA-Log | 0 Fehler, 0 abgelehnt, Outbox am Ende 0 |

- Ablauf: zwei Blöcke (21:00–21:16 und 21:21–21:31 MESZ), vor Block 2 Ziele unverändert (304), keine Lücke > 5 min – `IdleAhead` griff nicht (nicht nötig).
- Warnungen (alle VM-bedingt): `flat_exposure_off` × 7 (trainierte Flat-Zeit 1 s), `mount_site_mismatch`, `pc_timezone_differs` (gestauchter Standort), `sequence_template_deviation` (Testsequenz ohne Warten/Autofokus am Anfang).
- Kein Absturz. `summary.txt` meldete „ROT“ – Fehlalarm des Abschluss-Skripts (erkennt die Zeitstempel vor `✓` bei Real-Läufen nicht).
- Daten: `report-0.4.7.json`, `summary-0.4.7.json`.

**Ergebnis: Go.**
