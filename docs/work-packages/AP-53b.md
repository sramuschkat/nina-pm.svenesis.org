# AP-53b – Andockbare Fenster im Imaging-Reiter

**Release:** R5 · **Größe:** M · **Abhängigkeiten:** AP-53 · **Menschliche Aufgaben:** H-15

## Ziel
Nachts zeigt NINA-PM im Imaging-Reiter, was gerade läuft und was die Nacht noch bringt, ohne dass man in der Sequenz den Container aufklappen muss. Vorbild sind die beiden andockbaren Fenster des Astro-PM-Plugins (`ViewModels/AstroPMImagingPanelVM.cs`, `AstroPMLogPanelVM.cs`, Commit `5dd621d`). Die Daten kommen aus dem Plan, den das Plugin gerade abarbeitet, und aus dem, was es in dieser Nacht schon getan hat, nicht aus einer eigenen Rechnung.

Skizze (Abnahme vor der Umsetzung): https://claude.ai/artifact/KM1B5Ag7JRBFtxaBFTCvWb

## Anforderungen
FA-NIN-13, FA-NIN-18. Neu vorgeschlagen ist **FA-NIN-28** „Andockbare Fenster im Imaging-Reiter“; die FK-Zeile kommt mit dem Umsetzungs-PR (FK 6.9).

## Lesen (nur diese Abschnitte)
- FK 6.9 (FA-NIN-13, FA-NIN-18)
- TK 10.2, 10.5 (Projektschnitt: XAML nur in `NinaPm.Nina.Ui`)
- specs/nina/execution.md §2, §3.1, §4.2, §10
- ops/plugin-test-protocol.md P-11
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- **Zwei andockbare Fenster** über NINAs `IDockableVM` (MEF-Export wie Astro PM, `IsTool = true`), auswählbar in der Werkzeugleiste des Imaging-Reiters. Die ViewModels liegen in `NinaPm.Nina`, die Vorlagen (`DataTemplate` mit Schlüssel `<VM-Typ>_Dockable`) in `NinaPm.Nina.Ui`, die Logik in `NinaPm.Core`. Symbol ohne „APM“ und kein Name „Astro PM“ (CLAUDE.md Regel 14).
- **Fenster „NINA-PM“**
  - Statuszeile aus `LiveStatus` (AP-16h): Zustand (Warten, Läuft, Pausiert, Gesperrt mit Grund, Flats, Beendet), Ziel mit Block x/y, Filter, Belichtung n/m mit Fortschrittsbalken und Restzeit, Kamera (Gain, Offset, Auslesemodus, Temperatur), was als Nächstes kommt (nächster Block bzw. Flats ab Nachtende) und den Outbox-Zähler.
  - Darunter die **Plangrafik** des Plugin-Simulators (`PlanChart`) mit Jetzt-Linie. Dämmerung, Höhenkurven, Mond und Mindesthöhe kommen aus `GET /simulation` für die laufende Nacht und werden je Nacht gecacht. **Blöcke und Filterleiste setzen sich aus zwei Quellen zusammen:**
    - **Ab jetzt** kommen sie aus dem gespeicherten Plan der Nacht, damit die Grafik genau das zeigt, was das Plugin ausführt.
    - **Bis jetzt** kommen sie aus den lokalen Daten des Plugins: beendete Blöcke aus `TonightLog.pastBlocks`, Filterabschnitte aus den `CAPTURE`-Einträgen des lokalen Protokolls. Das ist nötig, weil `PlanStore` nur den letzten Plan hält und eine Neuplanung mitten in der Nacht erst bei „jetzt“ beginnt. Ohne diese Quelle verschwände nach dem ersten Refresh alles Erledigte aus der Grafik.
    - Erledigtes ist blass gezeichnet, Geplantes kräftig (wie AP-53c, Sven 07.10.2026).
    - Lücken (Leerlauf, Safety-Pause, Meridian-Flip, wiederholte Leerblöcke) sind schraffiert. Der Grund steht im Tooltip.
  - Fußzeile: Plan-ID (kurz) mit Revision („Rev. n“), Grund und Zeit der letzten Neuplanung, letzter Abruf der Ziele, Hinweis auf Standortzeit.
  - Ab etwa 500 px Breite (schmal angedockt) stapelt sich die Statuszeile zu einer Schlüssel-Wert-Liste, die Grafik wird kleiner, und darunter steht die Blockliste „Heutige Ziele“ aus dem Container.
- **Fenster „NINA-PM Protokoll“**
  - Tabelle der Planeinträge mit den Spalten des Simulator-Protokolls (`PlanLog`: Zeit, Befehl, Ziel, Panel, Nr., Filter, Belichtung, Gain, Offset, Binning, Auslesemodus, Rotation, RA, Dec, Höhe).
  - Neu ist die Spalte **Ist**: gespeichert ✓, übersprungen ↷ mit Grund (Verzug, Filter fehlt, Blockende), fehlgeschlagen ✕, läuft ▶ mit Fortschritt, geplant ○. Die Werte kommen aus dem lokalen Protokoll (`CAPTURE`, `SKIPPED_TIMEAWARE`, `BLOCK_END`/`BLOCK_SKIPPED`). **Vergangene Zeilen** kommen aus dem lokalen Protokoll, auch wenn sie im aktuellen Plan nicht mehr stehen; **künftige Zeilen** kommen aus dem gespeicherten Plan. Vergangene Zeilen sind blass, künftige kräftig.
  - Die laufende Zeile ist hervorgehoben. „Mitlaufen“ (Standard an) scrollt sie in den Blick, „Nur Belichtungen“ blendet Slew, Filter, Dither und Hinweise aus, und *Protokoll kopieren* liefert TSV wie im Simulator.
  - Kopfzeile mit den Zählern der Nacht: gespeichert, übersprungen, fehlgeschlagen.
- **Aktualisierung**: über Ereignisse des `NightRunner` (Planwechsel, Blockstart/-ende, Belichtung gestartet/gespeichert) und einen 2-s-Takt nur für Restzeit und Jetzt-Linie. Kein zusätzlicher Serveraufruf außer `GET /simulation`, höchstens einmal je Nacht und dann nur bei einem Planwechsel mit neuem Ziel. Ohne Verbindung zeigt die Grafik die Blöcke ohne Höhenkurven.
- **Texte DE/EN** über `Texts.cs`. Farben über NINAs Theme-Ressourcen (`PrimaryBrush`, `BackgroundBrush` …). Nur die Plangrafik bleibt dunkel wie im Simulator.
- Portierte Teile aus Astro PM mit Herkunft im Kommentar, Hinweis in `THIRD_PARTY_NOTICES.md`.
- Spec-Ergänzung `execution.md` §10 (Fenster, Datenquellen, Aktualisierung), Changelog-Fragment.

## Abgrenzung zu AP-53c
- AP-53b baut das Erledigte nur aus lokalen Daten. Das funktioniert offline, nach einem Neustart und ohne neue Server-Route.
- AP-53c ergänzt danach `executed` vom Server. Die Fenster ziehen es vor, sobald es vorhanden ist, und fallen ohne Verbindung auf die lokalen Daten zurück.
- Nicht in AP-53b gehören der Ursprungsplan als Umriss, der Hinweis „Rig plant noch mit Rev. n“ und vergangene Nächte.

## Nicht im Umfang
- Eingriffe aus den Fenstern (Block überspringen, Zurücksetzen): Die bleiben im Container.
- Eigene Astronomie im Plugin (CLAUDE.md Regel 14); Höhen kommen nur vom Server.
- Bildvorschau, HFR-Verlauf und Guiding-Grafik (zeigt NINA selbst).

## Entscheidungen (Sven, 06.10.2026)
1. **Datenquelle der Grafik:** Blöcke und Filterleiste aus dem gespeicherten Plan, Dämmerung, Höhenkurven und Mond aus `GET /simulation`, wie unter „Liefern“ beschrieben.
2. **Zwei Fenster** („NINA-PM“ und „NINA-PM Protokoll“) wie bei Astro PM, keine Reiter.
3. **Spalte „Ist“ und Zähler** im Protokoll gehören dazu.

## Automatisierte Abnahme
- [ ] Kern-Tests: Statusmodell aus `LiveStatus` und laufender Belichtung (Restzeit, Block x/y, „Danach“), Zuordnung **Ist** je Planeintrag aus einem Beispiel-Protokoll (gespeichert, übersprungen mit Grund, fehlgeschlagen, läuft), Zähler, Filter „Nur Belichtungen“, TSV-Kopie
- [ ] Grafik-Test: künftige Blöcke und Filter aus dem gespeicherten Plan, erledigte aus `TonightLog` und dem lokalen Protokoll, Höhenkurven aus der Simulation, Grenze blass/kräftig an der Jetzt-Linie, Lücken mit Grund; ohne Simulation keine Kurven, kein Fehler
- [ ] Regressionstest: Nach einer Neuplanung um 01:07 (Plan beginnt ab jetzt) bleiben der Transit-Block 20:11–00:54 und die 12-min-Lücke in Grafik und Protokoll sichtbar (Nacht 06./07.10.2026)
- [ ] Build `NinaPm.Nina` / `.Ui` / `.Tests` Release, `tools/nina-build-check.sh` grün, Adapter-Tests auf `windows-latest` grün
- [ ] CI grün, Changelog-Fragment, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Abnahme der Skizze vor Beginn. Danach Sichtprüfung in NINA (H-15): beide Fenster im Imaging-Reiter breit und schmal angedockt, im hellen und dunklen NINA-Theme, während einer VM-Nacht mit Planwechsel, übersprungener Belichtung und Flats.
