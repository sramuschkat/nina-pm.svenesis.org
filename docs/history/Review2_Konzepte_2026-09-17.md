# Review 2 – Fachkonzept 1.8 · Technisches Konzept 1.5 · Schema 1.5

Stand 17.09.2026. Drei Prüfdurchgänge (Fachlogik, Konsistenz der Dokumente, Umsetzbarkeit mit Claude Code), Kernbefunde von mir gegengeprüft. **Status: eingearbeitet (17.09.2026)** in Fachkonzept 1.9, Technisches Konzept 1.6, Schema 1.6 und das Umsetzungspaket `claude-code/` (A-1/A-2 → `specs/engine/allocation.md` + Soll-Pläne, A-3 → `sort-chain.md`, A-4 → `moon.md`, A-5 → Core/Adapter + AP-S2a/S2b + `plugin-test-protocol.md`, A-6 → `ops/human-tasks.md`, A-7 → neue AP-Briefs, A-8 → Paketstruktur). Das erste Review (`Review_Konzepte_2026-09-17.md`) ist vollständig erledigt und kann archiviert werden.

**Gesamturteil:** Fachlich weitgehend schlüssig; Backend, Auth, Datenbank, CDK und CRUD-Oberflächen sind für Claude Code **umsetzbar nach kurzer Vorbereitung**. **Nicht umsetzungsreif** sind der Planungsalgorithmus (nur Ziele, keine Rechenvorschrift) und das NINA-Plugin (braucht definierte Mensch-in-der-Schleife-Tests auf Windows). Die beiden Dokumente sind für einzelne Agent-Sitzungen zu groß und sollten aufgeteilt werden.

---

## A. Blocker für Claude Code

| # | Befund | Vorschlag |
|---|---|---|
| A-1 | **Zuteilungsalgorithmus nicht spezifiziert** (TK 8.3 Schritt 5–6, FK 8.3): „Gewicht = Restbedarf × Schutzfaktor“ ohne Formel; unklar ob Slot-greedy oder Anteilsrechnung; „knapp/untergehend“, Restposten-Schwelle (FA-SCH-14), Lückenfüller (FA-SCH-12), Reihenfolge Mindestzeit vs. Blockbildung, Filterreihenfolge im Block, Platzierung des Autofokus-Overheads, „Stapel“ bei der Filterwechsel-Toleranz, Maß der Mond-Restriktivität für Stufen – alles offen. | `specs/engine/allocation.md` als Pseudocode mit Zahlenwerten; Eigenschaftstests für FA-SCH-11…16. |
| A-2 | **Keine Soll-Pläne** („Plan für Testdaten stabil“ ist kein Abnahmekriterium). | ~10 „Golden Plans“ (Transit-Reservierung, Flip im Block, Mondstufen, Bonus, Restposten, Mosaik, ohne Rotator) mit von dir abgenommenem Ergebnis. |
| A-3 | **Sortierkette uneinheitlich**: FK 8 Kriterien (deutsch), Schema-Standard 5 Schlüssel, TK-Beispiel 4 inkl. `due_soonest`; keine Definition je Kriterium (Metrik, Richtung, Tie-Break). | Enum `sort-chain-keys.json` mit Definition; überall verwenden. |
| A-4 | **Mondformel mit Lücken**: „Tage seit/bis Vollmond“ (nächster Vollmond? Modell?), `Breite_eff → 0` bei Min-Höhe → Division durch 0, Horizont geometrisch 0° / −0,833° / topozentrisch?, Einheit Relax. **Refraktion**: FK sagt mit, TK-Tests geometrisch – was gilt für die Mindesthöhe? | Präzisieren + Tabelle mit Grenzfällen. |
| A-5 | **NINA-Plugin ohne Laufzeitumgebung nicht prüfbar**: Kind-Container, Trigger dazwischen, Flip-Profilwerte, Metadaten bis `ImageSaved`, Belichtungsabbruch, WPF, Framing-Übernahme. `net8.0-windows` läuft nicht auf Linux-Runnern. AP-S2 nennt die Fragen, aber keine Durchführung. | Plugin-Kern ohne NINA-Abhängigkeit (`net8.0`, voll testbar) + dünner NINA-Adapter; AP-S2 aufteilen in S2a (Agent: Jint) und S2b (Mensch + Agent: Probe-Plugin mit Trigger-, Metadaten- und Abbruch-Test, Rückgabe von Logs/Screenshots, Go/No-Go); AP-16 in ~6 Pakete mit Prüfskript; Windows-Runner festlegen; Lizenz Target Scheduler (MPL-2.0) prüfen. |
| A-6 | **Menschliche Aufgaben verstreut, teils fehlend**: Discord-App anlegen, `cdk bootstrap` in zwei Regionen, **GitHub-OIDC-Rolle** (kein Stack legt sie an → Henne-Ei für alle Workflows), GitHub-Environment `prod`, SNS-Bestätigung, 2FA des Super Users, Zugriff auf Website-Quellen für `legacy/`, Katalogbilder-Sync, Python-Fixtures, Test-Mandant/-Token, Windows-/NINA-Rechner, Rechtsprüfung, W-1. | `ops/human-tasks.md` mit Reihenfolge und blockiertem AP. |
| A-7 | **AP-Reihenfolge/-Größe**: AP-04 braucht `can()`/Fehlercodes aus AP-05; AP-12 braucht Aufwand/Einfügeposition aus AP-13; AP-02 Health mit DB-Ping vor Migrationsrunner (AP-03). AP-04, 07, 08, 11, 12 zu groß (XL), AP-13 und AP-16 XXL. Viele Abnahmen manuell. | AP-05 vor AP-04; Stubs bzw. Verschieben; Aufteilen; je AP „automatisierte Abnahme“ + getrennte „menschliche Freigabe“. |
| A-8 | **Dokumentgröße**: ~3.800 Zeilen Deutsch + Schema → 60–90 k Token Kontext je Sitzung. | Aufteilen in `docs/requirements/*`, `architecture`, `adr/`, `rules/`, `specs/engine/`, `contracts/`, `ui/screens/`, `ops/`, `work-packages/AP-xx.md` (Kurzbrief je AP mit exakten Leseabschnitten); CLAUDE.md verweist nur darauf. |

## B. Hoch (Logik/Konsistenz)

| # | Befund | Vorschlag |
|---|---|---|
| B-1 | **Flats/Dark-Flats scheitern am Schema**: `capture.filter_requested` NOT NULL, Flat-Beispiele haben nur `filterActual`; `flat_combination` nach `filter_short_name`, Flats melden „Ha 3nm“; RETURNING ohne `frame_type`/`project_ids`; `projectIds` ohne Prüfung gegen Mandant/Rig. | Kurzname für alle Typen Pflicht; CHECK `frame_type='light' OR project_ids IS NOT NULL`; Ingest prüft IDs. |
| B-2 | **Flats fehlen im fachlichen Datenmodell und in den Zählern** (FK 7.2 Aufnahme ohne Typ, 8.4 „Aufgenommen“ filtert nicht nach Typ, FlatKombination ohne Attribute, SchedulerEinstellungen/S-40 ohne Anzahlen und Dark-Flats). **Kombinationsschlüssel** widersprüchlich (mit Ziel vs. geteilt) und ohne Auslesemodus. | Schlüssel = Filter + mech. Winkel + Gain + Offset + Binning + Auslesemodus, Ziele als Liste; Zähler nur Lights; Attribute ergänzen. |
| B-3 | **Aktualisierung mitten im Block** unklar: 15-min-Abruf – bricht er den laufenden (stundenlangen) Block ab, wenn das Projekt pausiert/fertig ist? Frist-Rechnung nutzt 30 min, FA-SYN-03 15 min. | Wegfall von Ziel/Zeile → Belichtung beenden, Block beenden, neu planen; neuer Transit → Unterbrechung; Priorität/Einstellungen erst ab nächstem Block; ein Wert (15 min). |
| B-4 | **Flip „so früh/spät wie möglich legen“ (FA-NIN-21)** und „Einstellungen des Triggers“ (FK) – nicht umsetzbar: NINA-Trigger löst den Flip aus, Werte stehen im Profil. | Engine legt Blockgrenzen so, dass der Meridian außerhalb des Transitfensters liegt, sonst Warnung; Abgleich gegen Profil + Trigger vorhanden. |
| B-5 | **Plugin-Release/Priorität**: FA-NIN-26 (M, R1) enthält Tagesschleife und Trigger-Sets (R5); FA-NIN-13 (R1) enthält Simulations- und Flat-Bereich (R5); FA-NIN-04 (M) verweist auf lokale Änderung aus FA-NIN-18 (R5); FA-NIN-02/22 ohne Release; R5 nennt Dark-Flats/geteilte Kombinationen nicht. | Nach Stufen aufteilen. |
| B-6 | **Transit-Epoche doppelt**: zwei Ersteller, gleicher Planet, gleiches Rig, gleiche Epoche – Konfliktregel (ExoClock-Priorität) greift nicht, einer geht leer aus. | Gleiches Ereignis am Rig nur einmal aufnehmen und allen Beobachtungen zuordnen, oder zweite Festlegung mit Hinweis sperren. |
| B-7 | **Transit neu festlegen scheitert am Schema**: `UNIQUE (project_id, epoch)` verhindert Neufestlegung nach `cancelled`; Standardstatus `locked` statt `requested`. | UNIQUE entfernen (Guard „eine offene je Projekt“), Standard `requested`. |
| B-8 | **Betriebsalarme nur über Discord (R6)**: fehlender Heartbeat, Plugin-Fehler, zweite Instanz – in R1–R5 erfährt der Admin nichts. | Dieselben Ereignisse ab R1 als In-App-Benachrichtigung. |

## C. Mittel

- **Rechte/Routen**: `…/nights/{night}/unused` schreibt unter `session.read`; Priorität/Status unter `project.*` statt `project.status`; Entwürfe-Liste unter `project.submit` statt Admin-Aktion; Notizen doppelt.
- **Block-Bezug** fehlt: `capture`/`session_event` ohne `block_id`, `night_plan.blocks` ohne `id`; Session hat nur **einen** Nachtplan, obwohl vor jedem Block neu geplant wird → Session 1:n Plan mit Revision/Anlass.
- **API-Namen uneinheitlich**: `POST /plan` in 7.3 `{state}` vs. 7.6 `{pendingCaptures, reason, targetsEtag}`; `center_rotate` vs. `slew_center_rotate`; `block.flip{waitStart,start}` vs. `meridianFlip{waitStartUtc,flipUtc}`.
- **Discord-Zustellung widersprüchlich**: Dedupe-Schlüssel mit/ohne Objekt-ID; 3 vs. 5 Versuche; Nachtbericht über zwei Wege; veraltete `notification.delivery_status`.
- **Job-Arten unvollständig**: Katalog-Refresh (13.600 Zeilen) ohne `job.kind`; Prognose/Abgleich/Kataloge fehlen in 7.4.
- **Lease zu lang**: Rig nach Absturz bis 60 min blockiert; keine Admin-Aktion „Session übernehmen“; zwei Offline-Instanzen können beide aufnehmen.
- **Offline-Modus-Rückkehr**: lokale Einstellungsänderungen verwerfen/hochladen? Meldungen im bewussten Offline-Modus?
- **Admin-Bestätigung von Transits** ohne Frist, ohne Warteschlangen-Eintrag, ohne Matrixzeile. **Nur ein offener Transit je Projekt** bei kurzen Perioden unpraktisch → mehrere künftige Festlegungen oder „automatisch bis Datum X“.
- **Tagesschleife** endet bei „keine Restarbeit“, obwohl Transit in 3 Tagen oder Projektstart nächste Woche; läuft endlos bei saisonal unsichtbaren Zielen.
- **Filterrad** am Rig nicht verlässlich (Filter ↔ Teleskop optional), trotzdem Grundlage der Konfliktprüfung FA-RIG-12 → Belegung am Rig pflegen oder von NINA melden lassen.
- **FA-BEN-02 vs. FA-BEN-11** (Eingereicht beim Entfernen: bleibt vs. zurückgezogen → Entwurf → gelöscht).
- **Session-Status**: Rückkehr aus *abgebrochen*/*verwaist* nach Neustart fehlt; Nachtbericht evtl. zu früh.
- **Konfiguration**: Filterwechsel-Toleranz 0,5 (Schema) vs. 50 % (TK), Standard alle 10 vs. 40; SSM-Pfade uneinheitlich (`/jwt/signing-keys`), Bootstrap-Super-User in SSM **und** `config.ts`; Routen-Drosselung für `/api/nina/v1` braucht eigene Route; Uhrzeit-Warnung FK 2 s vs. TK 5 s.
- **Schema vs. eigene Regeln**: keine GRANTs im Schema (Lint würde es ablehnen); lokale Emulation von `AWS IAM GRANT`/ASYNC nicht beschrieben; Job-Indizes für mandantenübergreifende Abfragen fehlen (`transit_observation (status, window_end_utc)`, `auth_session/invitation (expires_at)`).
- **Fehlend für die Umsetzung**: Fehlercode-Katalog, i18n-Konventionen (Built-in-Mondprofile DE vs. EN), Seed-/Demodaten, Byte-genaue Definition `canonicalInputJson` und erlaubte `Math`-Funktionen, Rotationskonvention (Positionswinkel vs. NINA-Rotatorwinkel), Transit-Standardwerte (Puffer 1σ/3σ, Baseline) und Quelle der Erdbahnterme, Go-live-Checkliste, Discord-Embed-Vorlagen, Bildschirm-Briefs (Felder, Validierung, Leer-/Fehlerzustände) für R1-Screens.

## D. Niedrig

- Glossar „Projekt je Planet und Rig“ ohne Ersteller; Änderungsanträge (R3) in R1-Anforderungen ohne „ab R3“; S-40 ohne Entwürfe; S-31 ohne Zieltermin/Einreichen-Dialog/Änderungsantrag/Transit festlegen; FA-NIN-02 Filter nach Status (ausgeliefert wird nur *Aktiv*); Nachtbericht „vollständig“ vs. Status *abgeschlossen*; Tageswechsel-Zeit im Plugin vs. „Nacht = Mittag–Mittag“; OP-01 nicht als entschieden markiert; OT-19 nennt alte Versionen; FK 7.2 Rig/Mandant ohne neue Schalter; SSM `/nina-pm/system/alarm-webhook` fehlt in `NinaPm-Config`; Beispielzeiten in 7.6 sind nur illustrativ (nicht als Test-Orakel verwenden).
