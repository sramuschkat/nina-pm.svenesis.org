# AP-53b – Andockbare Fenster im Imaging-Reiter

**Release:** R5 · **Größe:** M · **Abhängigkeiten:** AP-53 · **Menschliche Aufgaben:** H-15

## Ziel
Nachts zeigt NINA-PM im Imaging-Reiter, was gerade läuft und was die Nacht noch bringt, ohne dass man in der Sequenz den Container aufklappen muss. Vorbild sind die beiden andockbaren Fenster des Astro-PM-Plugins (`ViewModels/AstroPMImagingPanelVM.cs`, `AstroPMLogPanelVM.cs`, Commit `5dd621d`). Die Daten kommen aus dem Plan, den das Plugin gerade abarbeitet, nicht aus einer eigenen Rechnung.

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
  - Darunter die **Plangrafik** des Plugin-Simulators (`PlanChart`) mit Jetzt-Linie. Dämmerung, Höhenkurven, Mond und Mindesthöhe kommen aus `GET /simulation` für die laufende Nacht und werden je Nacht gecacht. **Blöcke und Filterleiste kommen aus dem gespeicherten Plan der Nacht**, damit die Grafik genau das zeigt, was das Plugin ausführt. Erledigtes ist kräftig gezeichnet, Geplantes blass mit gestricheltem Rand.
  - Fußzeile: Plan-ID (kurz), Grund und Zeit der letzten Neuplanung, letzter Abruf der Ziele, Hinweis auf Standortzeit.
  - Ab etwa 500 px Breite (schmal angedockt) stapelt sich die Statuszeile zu einer Schlüssel-Wert-Liste, die Grafik wird kleiner, und darunter steht die Blockliste „Heutige Ziele“ aus dem Container.
- **Fenster „NINA-PM Protokoll“**
  - Tabelle der Planeinträge des gespeicherten Plans mit den Spalten des Simulator-Protokolls (`PlanLog`: Zeit, Befehl, Ziel, Panel, Nr., Filter, Belichtung, Gain, Offset, Binning, Auslesemodus, Rotation, RA, Dec, Höhe).
  - Neu ist die Spalte **Ist**: gespeichert ✓, übersprungen ↷ mit Grund (Verzug, Filter fehlt, Blockende), fehlgeschlagen ✕, läuft ▶ mit Fortschritt, geplant ○. Die Werte kommen aus dem lokalen Protokoll (`CAPTURE`, `SKIPPED_TIMEAWARE`, `BLOCK_END`/`BLOCK_SKIPPED`).
  - Die laufende Zeile ist hervorgehoben. „Mitlaufen“ (Standard an) scrollt sie in den Blick, „Nur Belichtungen“ blendet Slew, Filter, Dither und Hinweise aus, und *Protokoll kopieren* liefert TSV wie im Simulator.
  - Kopfzeile mit den Zählern der Nacht: gespeichert, übersprungen, fehlgeschlagen.
- **Aktualisierung**: über Ereignisse des `NightRunner` (Planwechsel, Blockstart/-ende, Belichtung gestartet/gespeichert) und einen 2-s-Takt nur für Restzeit und Jetzt-Linie. Kein zusätzlicher Serveraufruf außer `GET /simulation`, höchstens einmal je Nacht und dann nur bei einem Planwechsel mit neuem Ziel. Ohne Verbindung zeigt die Grafik die Blöcke ohne Höhenkurven.
- **Texte DE/EN** über `Texts.cs`. Farben über NINAs Theme-Ressourcen (`PrimaryBrush`, `BackgroundBrush` …). Nur die Plangrafik bleibt dunkel wie im Simulator.
- Portierte Teile aus Astro PM mit Herkunft im Kommentar, Hinweis in `THIRD_PARTY_NOTICES.md`.
- Spec-Ergänzung `execution.md` §10 (Fenster, Datenquellen, Aktualisierung), Changelog-Fragment.

## Nicht im Umfang
- Eingriffe aus den Fenstern (Block überspringen, Zurücksetzen): Die bleiben im Container.
- Eigene Astronomie im Plugin (CLAUDE.md Regel 14); Höhen kommen nur vom Server.
- Bildvorschau, HFR-Verlauf und Guiding-Grafik (zeigt NINA selbst).

## Offene Entscheidungen (vor Beginn mit Sven)
1. Datenquelle der Grafik wie oben (Blöcke aus dem gespeicherten Plan, Hintergrund aus `/simulation`) oder alles aus `/simulation` wie im Simulator. Letzteres ist einfacher, kann aber vom ausgeführten Plan abweichen.
2. Zwei Fenster wie Astro PM oder ein Fenster mit Reitern „Status“ / „Protokoll“.
3. Spalte **Ist** und Zähler im Protokoll: ja oder nur der reine Plan wie bei Astro PM.

## Automatisierte Abnahme
- [ ] Kern-Tests: Statusmodell aus `LiveStatus` und laufender Belichtung (Restzeit, Block x/y, „Danach“), Zuordnung **Ist** je Planeintrag aus einem Beispiel-Protokoll (gespeichert, übersprungen mit Grund, fehlgeschlagen, läuft), Zähler, Filter „Nur Belichtungen“, TSV-Kopie
- [ ] Grafik-Test: Blöcke und Filterleiste aus dem gespeicherten Plan, Höhenkurven aus der Simulation, Grenze erledigt/geplant an der Jetzt-Linie; ohne Simulation keine Kurven, kein Fehler
- [ ] Build `NinaPm.Nina` / `.Ui` / `.Tests` Release, `tools/nina-build-check.sh` grün, Adapter-Tests auf `windows-latest` grün
- [ ] CI grün, Changelog-Fragment, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Abnahme der Skizze vor Beginn. Danach Sichtprüfung in NINA (H-15): beide Fenster im Imaging-Reiter breit und schmal angedockt, im hellen und dunklen NINA-Theme, während einer VM-Nacht mit Planwechsel, übersprungener Belichtung und Flats.
