# Fachkonzept – Svenesis NINA-PM

**Webbasierte Planung von Astrofotografie-Projekten mit automatischer Ausführung in N.I.N.A.**

| | |
|---|---|
| Dokument | Fachkonzept (fachliche Anforderungen) |
| Version | 1.21 – Release-Reihenfolge 23.09.2026: das NINA-Plugin ist eine eigene Stufe **RP** direkt vor R4; R1 geht ohne Plugin live, Sync-API und Fake-Plugin bleiben in R1 (Kap. 11) · **1.20** – Übernahme des aktualisierten Website-Codes 23.09.2026 (WS-01…WS-31, WS-E1…E4): **Astro-Wetter auf den Stand des neuen Website-Codes** – die Gesamtbewertung trägt die **Gesamtbedeckung**, die Schichten tief/mittel/hoch sind nur noch Anzeige (FA-WET-01/03) · **Seeing aus dem Höhenwind** (Jetstream, Scherung zwischen Höhen- und Bodenschicht, Bodenwind) statt aus Bodenwind und Taupunktabstand · **Transparenz aus dem Aerosol**, gedämpft durch hohe Bodenfeuchte und viel Wasserdampf · **ab Tag 5 keine Transparenz** mit dem Kennzeichen „ohne Aerosol – Bewertung optimistisch“ in Stunde, Nachtdetail und Mehrnacht-Prognose (WS-E2) · **Niederschlag geht in keine Bewertung ein**; eine Regennacht wird allein über die Bewölkung bewertet – als bekannte Einschränkung bei FA-WET-09 und FA-FOL-03 festgehalten, Regenmenge und Regenwahrscheinlichkeit bleiben Anzeige (WS-E1) · Klassengrenzen **85/65/45/25 %** mit den Namen aus FA-WET-03 · **zwei Vergleichsmodelle** statt einem (ECMWF IFS und ein feines Modell je Region) · Modellkette mit **HARMONIE AROME**, **GEM** und **NBM**, feines Nest (ICON-D2 bzw. HRRR) in Nordamerika höchstens **30 h** · Nachtbewertung als gewichtetes Mittel über die astronomische Dunkelheit mit Abdeckung und **bestem zusammenhängenden Fenster** (WS-10) · Staub, Regenwahrscheinlichkeit und Wettersymbol als Anzeige · Bildschirm S-50 mit neuer Zeilenliste, Modellkürzel je Stunde und bestem Fenster · **Objektkatalog aus OpenNGC** (WS-E4): `NGC.csv` liefert Koordinaten, Typcodes, Größen, Positionswinkel, Helligkeiten in **V und B** und die **Flächenhelligkeit**, der Website-Auszug nur noch Namen/Aliase, Vorschaubilder und Wikipedia-Titel; Objektzahl überall **13.957** aus der verwendeten OpenNGC-Version (WS-27), Typen und Anzeigegruppen über `dsoObjectTypes`/`dsoObjectTypeGroups` (WS-26), Feldabbildung und Importtests in der neuen Spezifikation `docs/specs/catalog/dso-import.md` (WS-25). **Nachtrag nach Gegenprüfung:** die Katalogzahl ist eindeutig geschrieben – **13.957 sind die Zeilen von `NGC.csv`**, die Zeilen der verwendeten `addendum.csv` kommen hinzu (`13.957 + n_addendum`, beim Import gezählt); betroffen sind FA-FRM-01, die Quellentabelle in Kap. 9 und die Release-Übersicht in Kap. 11. Vorversionen: 1.19 – Nachtablauf-Prüfung 21.09.2026 (NT-01…NT-48, NT-E1…E4): **Filterradbelegung mit bestätigter NINA-Zuordnung** je Platz statt Laufzeit-Heuristik (FA-RIG-14, FA-FIL-04, FA-NIN-27, Kap. 8.6, S-10) · Kühlung nur warnen, Kennzeichen *Temperaturabweichung* (FA-KAM-01, FA-NIN-09) · Zeilen mit Aufnahmen gesperrt, *Zeile duplizieren*, Kennzeichen *Einstellungen abweichend* (FA-PRJ-05/07) · Rotation modulo 180°, kein Nachrotieren nach dem Flip, keine zweite Flat-Kombination (Kap. 8.8, FA-NIN-23) · „Heute Nacht“-Regel, Datumsfelder als Nacht-Schlüssel, Standortzeit mit Kürzel, Skizzen in CDT, Nachtfenster 00:00–13:00 UTC (Kap. 8.1, S-40) · PC-Zeitzone nur Hinweis, „Warten auf Zeit“ in Standortzeit (FA-NIN-03/07/26) · `darknessEndUtc` = späteste genutzte Dämmerungsgrenze, Nachtschleife endet am Ende der Dunkelheit, Nachtbericht/Verwaist am Sessionende der letzten Planrevision (FA-NIN-06, FA-SCH-15, FA-AUS-01/21) · Weiterarbeiten bei Netzausfall (FA-NIN-15) · Safety über *Loop While Safe* (FA-NIN-14) · NINA-Profil-Vorgaben (FA-NIN-24) · Flip im Transitfenster unvermeidlich (FA-NIN-21) · Himmelsflats −8°…−2° (FA-SCH-08) · Transit-Filter über das photometrische Band (FA-EXO-08/15) · OIII = Moderat (8.2) · verbindliche Sequenzvorlage und automatischer Start (6.9) · Korrekturen setzen das Aufwand-Kennzeichen zurück (FA-AUS-06). Nachtrag nach Gegenprüfung: Sequenzvorlage erst warten, dann entparken, Trigger *Autofokus nach Zeit* und Sicherungs-Container mit *NINA-PM Warten bis sicher oder Nachtende* samt Nachtabschluss ohne Wiederaufnahme und Vorlage ohne Safety (6.9, FA-NIN-14/25/26), Nachtende-Kulanz auch bis zur eigenen Dämmerungsgrenze (FA-SCH-15), Rotator-Bereich *Viertel* unzulässig (FA-NIN-23/24, 8.8), Flip nach NINAs frühester Flipzeit, Zentrieren nach jedem Flip und Flip im Transit-Vorlauf (FA-NIN-21), Nacht-Tabelle ab der Mittagsnacht mit Nachtfenster-Ende (8.1), Folge abweichender PC-Zeitzone und Zeitumstellung bei *Warten auf Zeit* (FA-NIN-03/26), Skizzen S-40/S-61 mit 305 Transitaufnahmen und Blockende 04:20 CDT. Vorversionen: 1.18 – Sicherheits-Vereinfachung 21.09.2026 (E1–E4, SV-01 … SV-19): Rollen Owner/Admin/User **ohne befristete Admins** (FA-BEN-07 entfällt) · **Owner-Übertragung sofort** an einen aktiven Admin mit Bestätigungsdialog, ohne Annahmefrist (FA-BEN-09) · Anmeldesitzung fest **14 Tage Inaktivität / 30 Tage höchstens**, keine Sicherheitseinstellungen je Mandant (FA-LOG-06, FA-MAN-05, S-71) · Discord-2FA als **feste Regel** für Owner- und Admin-Rechte (FA-LOG-07) · Anmeldeprotokoll entfällt (FA-LOG-11, S-72, NFA-07) · Sonderregeln gegen den Super User entfallen, Notfallzugang per `ops-cli` mit AWS-Admin-Profil, einfaches System-Audit (FA-SU-05/06/09) · Projekte werden **immer weich gelöscht**, Ansicht „Gelöscht“ mit *Wiederherstellen*, kein automatisches Endlöschen; Panels/Zeilen mit Aufnahmen weich, sonst endgültig (FA-PRJ-06/07/11/15) · Sync-Tokens **ohne Ablaufdatum**, Widerruf wirkt sofort (FA-SYN-01, FA-ADM-02) · neuer Baustein **Bestätigungsdialog** `ConfirmDialog` (14.1, 14.4) · NFA-06 nach der Sicherheitsleitlinie (Schutz von außen; Deployment nicht Teil der Sicherheitsarchitektur; innen Schutz gegen Versehen), NFA-17/NFA-20 angepasst · OP-29. Nachtrag nach Gegenprüfung: Mandanten-Export ohne Zugangsdaten, Import mit deaktivierten Discord-Kanälen (FA-ADM-04) · Webhook-URL in der Datenbank statt „verschlüsselt“, Prüfung vor jedem Senden (FA-DIS-02) · Grund beim Admin-Ernennen optional, im Änderungsprotokoll (FA-BEN-06, S-70) · keine Benachrichtigung bei verfallener Owner-Einladung, Owner-Einladung bei vorhandenem Owner abgelehnt (FA-BEN-03) · Neuzuweisung benachrichtigt alle Admins einschließlich des bisherigen Owners (FA-SU-05) · weich gelöschte Panels/Zeilen nicht einzeln wiederherstellbar (FA-PRJ-06/07). Vorversionen: 1.17 – Astronomie-Durchgang 18.09.2026 (95 Befunde, numerisch verankert an Meeus-Rechenbeispielen und USNO): Mondabstand und Mondhöhe **topozentrisch** (neue FA-MON-00 – Parallaxe bis 1,03°, geozentrisch kippen 23 h/Jahr die Abstandsprüfung und 95 h/Jahr das Tor „Mond unten") · Δm in **mmag** mit Tiefe als Bruch (Faktor 1000 fehlte) · Baseline **dauerabhängig** T14/2 statt fester 60 min · O−C nur bei `|O−C| > 3σ` und mit eigenem Fehler im Puffer · neue FA-EXO-16a **Ephemeridenalter** · Himmelsflats mit Sonnenhöhenbezug statt am Ende der Dunkelheit · Eigenbewegung ausdrücklich nicht gerechnet, Auslieferung an NINA in **J2000** · Relax als Grad/Grad statt „Faktor" und Reichweite der Relaxierung benannt · ExoClock ≈ 620 statt „ca. 750". Vorversionen: 1.16 – Logik-Durchgang 18.09.2026 (14 Befunde): überlappende Transit-Festlegungen werden **abgelehnt** statt priorisiert (FA-EXO-33) und nach der Frist nicht mehr angenommen (FA-EXO-18) · Obergrenze offener Festlegungen einheitlich *n* (FA-EXO-39) · Kulanz am **Ende der Dunkelheit**, nicht am Nachtende (FA-SCH-15) · Katalogaktualisierung nur in S-82 (S-22) · `tenantTimezone` als Einstellungsschlüssel, Mandanten-Logo entfällt (FA-MAN-05) · eigene Version für Änderungsanträge (FA-FRG-08) · ruhende Stimmen zählen nicht (FA-BEN-11) · Widerruf und Nachprüfung bei der Owner-Übertragung (FA-BEN-09) · Invariante letzter Super User mit Fehlercode (FA-SU-06) · Skizzen S-31/S-40/S-61 auf die definierten Begriffe und konsistente Zahlen. Vorversionen: 1.15 – Entscheidungen vom 17.09.2026: Arbeitsseiten nutzen **immer die volle Fensterbreite** (keine Obergrenze mehr), der Layout-Umschalter wird ein **Dichte-Schalter** (kompakt/normal/weit), **kein Rotlicht-Modus** (nur hell und dunkel). Vorversionen: 1.14 Sicherheits-Review; 1.13 Review 5; 1.12 Review 4; 1.11 Review 3.
| Stand | 23.09.2026 |
| Autor | Sven Ramuschkat (mit Claude) |
| Folgedokument | `Technisches_Konzept_Svenesis-NINA-PM.md` v1.20 (Architektur, AWS/CDK, API, Datenbankschema `schema_aurora_dsql.sql` v1.18) → Input für Claude Code |
| Referenz | Astro PM (astro-pm.com, Doku-Stand Juli–Sept. 2026); Astro PM 1.6.0: 15 Screenshots und Datenbank-Export `logbook.db.sql` (Stand 16.09.2026); Quellcode Astro-PM-NINA-Plugin v1.6.0.0 (MIT, github.com/Josh-Jones-76/AstroPM.NINA.Plugin, Analyse `Analyse_AstroPM_NINA_Plugin_2026-09-17.md`) |

---

## Inhalt

1. [Ausgangslage und Zielbild](#1-ausgangslage-und-zielbild)
2. [Abgrenzung (Scope)](#2-abgrenzung-scope)
3. [Systemüberblick](#3-systemüberblick)
4. [Rollen und Nutzungskontext](#4-rollen-und-nutzungskontext)
5. [Fachlicher Gesamtablauf](#5-fachlicher-gesamtablauf)
6. [Fachliche Anforderungen](#6-fachliche-anforderungen)
   - 6.1 Ausrüstung und Standorte
   - 6.2 Filter, Belichtungspläne und Mondprofile
   - 6.3 Zielsuche und Framing
   - 6.4 Projekte und Ziele
   - 6.5 Sichtbarkeit und Diagramme
   - 6.6 Astro-Wetter
   - 6.7 Scheduler und Nacht-Simulator
   - 6.8 Synchronisation Web ↔ NINA
   - 6.9 NINA-Plugin
   - 6.10 Exoplaneten-Transitplanung
   - 6.11 Auswertung und Folgeplanung
   - 6.12 Administration, Export und Einstellungen
   - 6.13 Mandanten, Super User, Anmeldung und Benutzer
   - 6.14 Rollen, Berechtigungen und Freigabe-Warteschlange
7. [Fachliches Datenmodell](#7-fachliches-datenmodell)
8. [Fachliche Regeln und Berechnungen](#8-fachliche-regeln-und-berechnungen)
9. [Wiederverwendung der Svenesis-Astro-Tools](#9-wiederverwendung-der-svenesis-astro-tools)
10. [Nicht-funktionale Anforderungen](#10-nicht-funktionale-anforderungen)
11. [Ausbaustufen (Release-Plan)](#11-ausbaustufen-release-plan)
12. [Offene Punkte und Entscheidungen](#12-offene-punkte-und-entscheidungen)
13. [Glossar](#13-glossar)
14. [Bildschirmkonzept](#14-bildschirmkonzept)
15. [Anhang A – Abgleich mit Astro PM 1.6.0](#15-anhang-a--abgleich-mit-astro-pm-160)

Priorisierung der Anforderungen nach MoSCoW: **M** = Muss, **S** = Soll, **K** = Kann, **W** = später/nicht jetzt.

---

## 1. Ausgangslage und Zielbild

### 1.1 Ausgangslage

Die Nachtplanung in N.I.N.A. (Nighttime Imaging 'N' Astronomy) erfolgt klassisch über manuell gepflegte Sequenzen: pro Ziel ein Container, Filter und Belichtungen fest eingetragen, Prioritäten durch Umsortieren. Mehrere Projekte über Wochen parallel zu führen, Mondphasen je Filter zu berücksichtigen und nach einer Nacht nachzuhalten, was noch fehlt, ist aufwendig und fehleranfällig – besonders bei einer Remote-Sternwarte (z. B. Starfront, Texas).

Astro PM löst das mit einer Windows-Desktop-App, einem Cloud-Sync und einem NINA-Plugin. Astro PM bringt aber viel mit, was hier nicht gebraucht wird (Sub-Bewertung, Bildanalyse, Dateisync, Galerie) und ist an Windows gebunden.

Für Standortwetter und Nachtplanung gibt es bereits eigene, im Browser laufende Werkzeuge auf svenesis.org:

- **Astro-Wetter** – 7-Tage-Vorhersage mit Gesamtbedeckung und Wolken in drei Höhen, geschätztem Seeing aus dem Höhenwind und geschätzter Transparenz aus dem Aerosol, Gesamtbewertung je Stunde und Nacht und bestem zusammenhängenden Fenster je Nacht.
- **Beobachtungsplaner** – Mond, Dämmerung, Planeten, Sternkarte, Rangliste der besten Deep-Sky-Objekte für ein Rig, Ereignisse der Nacht.

### 1.2 Zielbild

Eine **eigenständige Webanwendung** (*Svenesis-NINA-PM*) unter **`https://nina-pm.svenesis.org`**, die in die Website www.svenesis.org nur über einen Menüeintrag eingebunden ist, in der Astrofotografie-Projekte vollständig geplant werden – Ziel, Framing, Mosaik, Belichtungsplan mit Filtern, Gain/Offset/Binning, Mondregeln, Prioritäten. Ein **NINA-Plugin** holt sich die aktiven Ziele und die Rig-Einstellungen, baut daraus den Plan der Nacht und führt ihn im Rahmen einer NINA-Sequenz selbstständig aus. Jede aufgenommene Belichtung wird zurückgemeldet.

Die Anwendung ist **mandantenfähig und mehrbenutzerfähig**: Jeder Mandant (z. B. eine Sternwarte, ein Verein, eine Imaging-Gruppe) hat eigene Ausrüstung, Projekte, Sessions und Benutzer, vollständig getrennt von anderen Mandanten. Innerhalb eines Mandanten gibt es **Admins**, die alles steuern, und **User**, die Objekte (Deep-Sky und Exoplaneten) planen und in eine **Warteschlange** stellen. Erst die Freigabe durch einen Admin bringt ein User-Objekt in den realen Ablauf auf der Sternwarte.

Am Morgen zeigt die Webanwendung, **was tatsächlich aufgenommen wurde** (Frames je Filter, Integrationszeit, Abweichungen vom Plan und deren Gründe) und **was noch fehlt**. Daraus leitet sie ab, wie viele Nächte das Projekt noch braucht und welche der kommenden Nächte laut Wetter, Mond und Sichtbarkeit dafür in Frage kommen.

### 1.3 Fachliche Ziele

| Nr. | Ziel | Messbar an |
|---|---|---|
| Z1 | Planung ohne Sequenz-Bearbeitung | Nach der Einrichtung wird die NINA-Sequenz nicht mehr angefasst; Planänderungen erfolgen nur in der Web-App. |
| Z2 | Mehrere Projekte parallel und fair | Scheduler verteilt die Nacht über alle aktiven Projekte eines Rigs unter Beachtung von Sichtbarkeit, Mindesthöhe und Mond je Filter; Exoplaneten-Transits haben Vorrang. |
| Z3 | Vorhersagbarkeit | Der Simulator in der Web-App zeigt denselben Plan, den NINA ausführt (gleiche Engine, gleiche Eingaben). |
| Z4 | Lückenlose Fortschrittsführung | Jede Belichtung ist einem Projekt, Panel und einer Belichtungszeile zugeordnet; Soll/Ist je Nacht nachvollziehbar. |
| Z5 | Entscheidung „nächste Nacht" | Nach jeder Session: Restbedarf, Prognose der benötigten Nächte, bewertete Kandidatennächte. |
| Z6 | Wiederverwendung | Astronomische Berechnungen und Wetterbewertung aus den bestehenden Svenesis-Skripten werden übernommen statt neu gebaut. |
| Z7 | Gemeinsame Nutzung einer Sternwarte | Mehrere Personen planen Objekte; der Admin behält die Kontrolle über den realen Ablauf (Freigabe), alle sehen Planung, Fortschritt und Ergebnisse. |
| Z8 | Mandantentrennung | Kein Mandant sieht Daten eines anderen; eine Person (Discord-Konto) kann Mitglied mehrerer Mandanten sein – mit je eigener Rolle, ohne dass Daten zwischen den Mandanten sichtbar werden. |

---

## 2. Abgrenzung (Scope)

### 2.1 Im Umfang (Leistungsumfang analog Astro PM)

| Bereich | Astro-PM-Pendant | Umfang hier |
|---|---|---|
| Ausrüstung | Sites, Telescopes, Cameras, Filters, Imaging Systems | vollständig |
| Belichtungsplan-Vorlagen | Exposure Plan Builder | vollständig |
| Mondvermeidung | Moon Avoidance Profiles | vollständig |
| Framing | Sky View (FOV, Rotation, Mosaik, Surveys, Overlays, Zeitleiste) | vollständig, auf Basis Svenesis-Sternkarte |
| Projekte | Project Editor, Project Management, Status, Priorität | vollständig |
| Mosaike | Mosaic Planning | vollständig |
| Sichtbarkeit | Target Visibility & Charts (Nacht, Saison) | vollständig |
| Wetter | Weather Forecasting | auf Basis einer Kopie des Svenesis-Astro-Wetters (Kap. 9) |
| Scheduler | Nightly Simulator, Scheduling Strategies | vollständig |
| Cloud-Sync | Sync Token, Cloud Targets | als Server-API der Web-App |
| NINA-Plugin | Instructions, Nightly/Daily Loop, Trigger Sets, Flats, Offline, Playback Modes, Simulator-Panel | vollständig |
| Exoplaneten | Exoplanet Targets & Transit Planning, zeitkritische Unterbrechung im Scheduler | vollständig |
| Fortschritt | Exposure Plans & Progress | auf Basis gemeldeter Aufnahmen, ohne Dateiscan |

### 2.2 Neu gegenüber Astro PM

- **Session-Auswertung** (Soll/Ist je Nacht, Abweichungsgründe, Effizienz) – bei Astro PM nur indirekt über die Zähler.
- **Folgeplanung**: Prognose der Restnächte und Bewertung kommender Nächte aus Wetter + Sichtbarkeit + Mond.
- **Sitzungsprotokoll** mit Beobachtungsbedingungen (Seeing, Transparenz, SQM, Temperatur, Feuchte, Notizen) – über die Zeit eine eigene Wetter- und Klarnacht-Datenbank je Standort.
- **Zielvorschläge** mit der Bewertungslogik des Svenesis-Beobachtungsplaners (Kopie, Kap. 9; beste Objekte für das Rig) mit Übernahme als Projekt.
- **Plattformunabhängig**: Browser statt Windows-Desktop; eigenständig unter `nina-pm.svenesis.org`, verlinkt aus www.svenesis.org.
- **Mandanten und Rollen**: Anmeldung über **Discord**, Zugang zu Mandanten per Einladung; Rollen Owner/Admin/User je Mandant; Freigabe-Warteschlange mit Stimmen für von Mitgliedern geplante Objekte.

### 2.3 Ausdrücklich nicht im Umfang

| Nicht im Umfang | Begründung / Ersatz |
|---|---|
| Sub Inspector (Bewertung, Thresholds, /rejected-Ordner, Blink) | Bewertung erfolgt außerhalb (z. B. PixInsight). Ersatz: manuelle Korrektur der akzeptierten Anzahl (FA-AUS-06). |
| Bildanalyse (Tilt, Kollimation, Vignettierung, Staub, PSF) | nicht gewünscht |
| Image Annotator, Plate-Solving von Einzelbildern | nicht gewünscht |
| Einbinden/Verwalten von Bilddateien: lokale/Remote-Ordner, Dateiscan, Sync der Subs, Löschen remote | nicht gewünscht; Fortschritt kommt aus NINA-Meldungen |
| Kalibrierbild-Bibliothek, Calibration-Frames-Abdeckung | gehört zur Bildverwaltung |
| Projektbilder (Referenz-/Endbild), Galerie, Community, Image of the Week | nicht gewünscht |
| Focal-Length-Calculator (Plate-Solve eines Subs) | benötigt Bilddateien |
| Okulare (visuell) | nicht Teil der Aufnahmeplanung |
| Lizenzverwaltung, App Hub | Eigenbetrieb, Web statt Desktop |
| Mehrere Rigs auf einer Montierung (Dual-/Tandem-Setup) | nicht unterstützt; jedes Rig hat eine eigene Montierung und einen eigenen Scheduler. Dual-Setups werden als ein Rig mit einer Kamera geplant. |
| Custom Horizon (.hrz-Horizontprofil) | nicht gewünscht; Sichtbarkeit nur über Mindesthöhe des Projekts |
| Mobile Überwachung / Phone App (Live-Status, Pause/Fortsetzen, Push, Handy-Wetter) | nicht gewünscht; keine mobile App, keine PWA, keine Fernsteuerung. Auswertung erfolgt nach der Session in der Web-App. Der optionale **Nachtbericht nach Sessionende** per Discord (FA-AUS-21) ist keine Live-Überwachung. |

### 2.4 Optional / spätere Ausbaustufe (W/K)

- Belichtungsrechner (SNR-Effizienz) und Sampling-Rechner – rein rechnerisch, keine Bilder nötig (K). Der Modus *Exoplanet-Stern* (Belichtung gegen Sättigung) ergänzt die Transitplanung (K).
- Teilen von Ausrüstung/Projekten als Datei (K, ab R6).
- Stellarium-Anbindung (W).

---

## 3. Systemüberblick

```
┌───────────────────────────────┐          ┌──────────────────────────────┐
│  Web-App: nina-pm.svenesis.org│          │  Externe Datenquellen        │
│  • Ausrüstung, Projekte       │          │  • Open-Meteo (ICON/GFS/     │
│  • Framing / Sternkarte       │          │    HRRR/ECMWF, CAMS)         │
│  • Simulator (Scheduler)      │          │  • CDS HiPS (DSS2, NSNS …)   │
│  • Wetter, Sichtbarkeit       │          │  • SIMBAD (Namensauflösung)  │
│  • Exoplaneten, Auswertung    │          │  • ExoClock, NASA Exoplanet  │
│                               │          │    Archive, TESS TOI         │
│                               │          └──────────────▲───────────────┘
└──────────────┬────────────────┘                         │
               │ HTTPS (Login über Discord)               │ (serverseitig
┌──────────────▼────────────────┐                         │  gecacht)
│  Backend / API                ├─────────────────────────┘
│  • Stammdaten, Projekte       │
│  • Scheduler-Engine           │
│  • Aufnahme-Ledger, Sessions  │
│  • Exoplaneten-Kataloge       │
└──────────────▲────────────────┘
               │ HTTPS (Sync-Token je NINA-Instanz)
┌──────────────┴────────────────┐
│  NINA 3.x + Plugin            │
│  • holt Ziele + Rig-Settings  │
│  • baut / lädt Nachtplan      │
│  • führt aus, meldet Frames   │
│  • lokaler Cache (offline)    │
└───────────────────────────────┘
```

**Mandantentrennung:** Alle fachlichen Daten (Ausrüstung, Rigs, Projekte, Pläne, Sessions, Aufnahmen, NINA-Instanzen) gehören genau einem Mandanten. Mandantenübergreifend und gemeinsam genutzt werden nur Referenzdaten ohne Personenbezug: Objektkatalog, Exoplaneten-Kataloge, Sternkatalog, Wetter-Cache je Koordinate.

**Leitprinzip:** Die Web-App ist die einzige Quelle der Wahrheit für *Planung und Einstellungen*. NINA ist die Quelle der Wahrheit für *das, was tatsächlich aufgenommen wurde*. Das Backend führt beides im Aufnahme-Ledger zusammen.

---

## 4. Rollen und Nutzungskontext

| Rolle | Ebene | Beschreibung | Zugriff |
|---|---|---|---|
| **Super User** | System (mandantenübergreifend) | verwaltet alle Mandanten: anlegen, bearbeiten, sperren, löschen; lädt den **Owner** eines Mandanten per Einladungslink ein und kann im Notfall den Owner neu zuweisen (FA-SU-05); verwaltet sonst keine Mitglieder; sieht Mandantenliste mit Kennzahlen, aber keine fachlichen Inhalte (Projekte, Sessions, Aufnahmen) | Super-User-Verwaltung (→ FA-SU-01 ff.) |
| **Owner** | je Mandant (genau einer) | Eigentümer des Mandanten, z. B. Leiter der Sternwarte oder Gruppe: alle Admin-Rechte und exklusiv die Verwaltung der Admins (ernennen, entziehen) und die Owner-Übertragung (sofort an einen aktiven Admin); kann von niemandem im Mandanten herabgestuft oder ausgesperrt werden (FA-BEN-06 ff.) | Web-App, voll |
| **Admin** | je Mandant | darf im Mandanten alles außer der Verwaltung von Admins und des Owners: Ausrüstung, Rigs, User einladen und verwalten, Scheduler, NINA-Anbindung, Projekte aller Benutzer, Freigaben, Auswertung | Web-App, voll |
| **User** | je Mandant | plant eigene Objekte (Deep-Sky und Exoplaneten), stellt sie in die Warteschlange und ordnet sie nach eigener Wichtigkeit; stimmt für eingereichte Objekte anderer ab; sieht alles andere im Mandanten nur lesend | Web-App, eingeschränkt (→ 6.14) |
| **NINA-Instanz** | je Mandant | technischer Akteur je Rig/Rechner | API mit Sync-Token, nur freigegebene Ziele der zugeordneten Rigs |

Eine Person meldet sich mit ihrem **Discord-Konto** an und hat je Mandant, in dem sie Mitglied ist, genau eine Rolle. Super User sind keinem Mandanten zugeordnet und haben dort keine fachliche Rolle. Owner- und Admin-Rechte wirken nur, wenn im Discord-Konto die Zwei-Faktor-Authentifizierung (2FA) aktiv ist; sonst gelten User-Rechte mit Hinweis (FA-LOG-07, SV-03). Befristete Admin-Rechte gibt es nicht (E2).

Nutzungskontexte:

- **Tagsüber am Schreibtisch** – User: Objekte planen, einreichen, eigene Einreichungen ordnen, für Objekte anderer abstimmen. Admin: Warteschlange nach Stimmen, Rang und Fristen sichten, freigeben, simulieren, Wetter prüfen.
- **Nachmittags** – Transits der Nacht suchen und als Projekt anlegen.
- **Morgens** – Session auswerten, Frames ggf. korrigieren, nächste Nacht entscheiden.
- **Sternwarte (lokal oder remote)** – NINA läuft unbeaufsichtigt, ggf. mit instabiler Internetverbindung.

---

## 5. Fachlicher Gesamtablauf

```
 Einmalig            Je Projekt                 Je Nacht                      Danach
 ─────────           ──────────                 ────────                      ──────
 Standort       →    Ziel suchen /         →    Wetter prüfen           →     Session-
 Teleskop            Vorschlag übernehmen       Simulator ansehen             auswertung
 Kamera              Framing, Rotation,         (optional anpassen)           (Soll/Ist)
 Filter              Mosaik / Transit                │                            │
 Rig anlegen         Belichtungsplan                 ▼                            ▼
 Plan-Vorlagen       Mondprofile               NINA: Plan bauen,              Frames
 NINA verbinden      Priorität, Status          Ziele ausführen,              korrigieren
                     = Aktiv → Sync            Frames melden,                 (optional)
                                                Flats am Ende                      │
                                                                                   ▼
                                                                              Restbedarf,
                                                                              Prognose,
                                                                              Kandidaten-
                                                                              nächte → ↺
```

### 5.1 Kern-Anwendungsfälle

| ID | Anwendungsfall | Kurzbeschreibung |
|---|---|---|
| AF-01 | Rig einrichten | Standort, Teleskop, Kamera, Filter anlegen, zu einem Imaging-System verbinden, NINA-Instanz koppeln. |
| AF-02 | Projekt planen | Ziel wählen, framen, Belichtungsplan aus Vorlage übernehmen und anpassen; Admin aktiviert direkt, User reicht ein. |
| AF-03 | Nacht simulieren | Für Rig + Datum den Plan berechnen und visuell prüfen; Einstellungen des Rigs anpassen. |
| AF-04 | Nacht ausführen | NINA holt Ziele, baut Plan, nimmt auf, meldet Frames, macht Flats. |
| AF-05 | Transit planen | Beobachtbare Transits einer Nacht finden, bewerten, als Exoplaneten-Projekt (je Planet) anlegen, Transit-Datum festlegen; NINA unterbricht die laufende Aufnahme zum Transitfenster. |
| AF-06 | Session auswerten | Soll/Ist je Block und Filter, Gründe für Abweichungen, Frames korrigieren. |
| AF-07 | Folgenacht planen | Restbedarf, Prognose, Kandidatennächte; Priorität/Plan anpassen. |
| AF-08 | Projekt abschließen | Status „Abgeschlossen", Ziel verschwindet aus NINA; Übersicht bleibt erhalten. |
| AF-09 | Transit-Ergebnis erfassen | HOPS-/EXOTIC-Ergebnis importieren, Qualitätswerte prüfen, mit Katalog und früheren Beobachtungen vergleichen. |
| AF-10 | Bedingungen protokollieren | Sitzungsprotokoll (Seeing, SQM, Wetter, Notizen) prüfen und ergänzen. |
| AF-11 | Objekt einreichen (User) | Deep-Sky- oder Exoplaneten-Objekt planen, Wunsch-Rig und -Zeitraum angeben, in die Warteschlange stellen, in die eigene Rangfolge einordnen, Status und Stimmen verfolgen. |
| AF-14 | Abstimmen (alle Mitglieder) | Warteschlange ansehen, für eingereichte Objekte anderer eine Stimme abgeben oder zurücknehmen. |
| AF-12 | Warteschlange bearbeiten (Admin) | Eingereichte Objekte mit Stimmen, Rang beim Einreicher und Frist prüfen, Auswirkung simulieren, freigeben (Rig, Priorität, Status), zurückgeben oder ablehnen. |
| AF-13 | Mandant und Benutzer verwalten | Super User legt Mandant an und lädt den Owner per Discord-Einladungslink ein; Owner lädt User und Admins ein und vergibt/entzieht Admin-Rechte; Admins laden User ein und verwalten sie (Ablauf → 6.13). |

---

## 6. Fachliche Anforderungen

Notation: **FA-‹Bereich›-‹Nr›** · Priorität M/S/K/W

### 6.1 Ausrüstung und Standorte

#### Standort

| ID | Anforderung | Prio |
|---|---|---|
| FA-STO-01 | Standort anlegen mit Name, optional Pier-Name, Sternwartentyp (offen, Kuppel, Rolldach, fest, mobil, remote/gehostet), Breite/Länge (dezimal oder °′″ mit N/S, O/W – beide synchron), Höhe (m/ft), Bortle-Klasse, Zeitzone (IANA), Notizen. | M |
| FA-STO-02 | Kein eigenes Horizontprofil: Sichtbarkeit wird ausschließlich über die Mindesthöhe des Projekts bestimmt. Hindernisse sind über eine entsprechend gewählte Mindesthöhe abzubilden. | M |
| FA-STO-03 | Standort zeigt Karte mit Marker und die Astro-Wetter-Vorhersage (→ 6.6). | S |
| FA-STO-04 | Löschen ist gesperrt, solange ein Rig den Standort nutzt (Löschsperren aller Stammdaten → FA-RIG-13). | M |
| FA-STO-05 | Optional: Remote-Verbindungsprofile (Dienst, Name, Remote-ID/URL, Notiz, Standard-Markierung) als reine Linkliste – **ohne Speicherung von Passwörtern** (Astro PM speichert diese im Klartext, das wird nicht übernommen). | K |
| FA-STO-06 | Link zur Wetter-/Safety-Seite der Sternwarte (z. B. Allsky-Kamera, Safety-Monitor-Status des Hosters), aufrufbar aus Standort, Wetter und „Heute Nacht“. | S |

#### Teleskop

| ID | Anforderung | Prio |
|---|---|---|
| FA-TEL-01 | Teleskop mit Name, Hersteller, Modell, Bauart (Refraktor achromatisch/apochromatisch, Newton, RC, SCT, Maksutov, CDK, Cassegrain, RASA), Öffnung (mm), Brennweite (mm), Reducer-/Barlow-Faktor, Obstruktion (%). | M |
| FA-TEL-02 | Optionale Felder: Bildkreis, Backfokus, Gewicht, Notizen. | K |
| FA-TEL-03 | Abgeleitete Werte live: Öffnungsverhältnis (nativ/effektiv), effektive Brennweite, Dawes- und Rayleigh-Grenze, Airy-Scheibchen. | S |
| FA-TEL-04 | Auswahl aus einer Modellbibliothek zur Vorbelegung (editierbar). | K |

#### Kamera

| ID | Anforderung | Prio |
|---|---|---|
| FA-KAM-01 | Kamera mit Name, Hersteller, Modell, Sensorbezeichnung, Auflösung (px B×H), Pixelgröße (µm), Bittiefe, gekühlt ja/nein, Farbe (OSC) ja/nein. Bei gekühlten Kameras zusätzlich **Kühl-Solltemperatur** (°C, optional) und **Toleranz** (Standard 1 °C) – Grundlage der Temperaturprüfung im Plugin (FA-NIN-09, NT-E2). | M |
| FA-KAM-02 | Standard-Betriebspunkt: Gain, Offset, Binning, Auslesemodus – Vorbelegung neuer Belichtungszeilen. | M |
| FA-KAM-03 | Rauschmodell am Standard-Gain: e⁻/ADU, Ausleserauschen, Full Well; zusätzlich QE und Dunkelstrom (für späteren Belichtungsrechner). | S |
| FA-KAM-04 | Liste weiterer Gain-Modi (mit eigenem Rauschmodell) und Liste der Auslesemodi. Namen der Auslesemodi exakt wie im Treiber, da das Plugin sie per Name auflöst. | M |
| FA-KAM-05 | Abgeleitete Werte: Sensorgröße (mm), Diagonale, Megapixel, Dynamikumfang (Blenden), max. ADU. | S |
| FA-KAM-06 | Unterstützte Binning-Stufen (1×1, 2×2, 3×3, 4×4) je Kamera; nur diese sind in Belichtungszeilen wählbar. Abgeleitete Werte je Binning (Auflösung, effektive Pixelgröße, Megapixel). | S |
| FA-KAM-07 | **Auslesemodus-Abgleich mit NINA**: Das Plugin meldet die tatsächlich vom Treiber angebotenen Auslesemodi und Gain-Grenzen; Abweichungen zu den gepflegten Werten werden an der Kamera als Hinweis angezeigt (quittierbar). | S |
| FA-KAM-08 | Sensorgrößen-Vergleich (maßstäblich gegen gängige Formate und andere Kameras des Mandanten). | K |

#### Filter

| ID | Anforderung | Prio |
|---|---|---|
| FA-FIL-01 | Filter mit Langname, **Kurzname** (Anzeige- und Planungsschlüssel, z. B. L, R, G, B, HA, OIII, SII; die Verbindung zu NINA stellt die bestätigte Filterradbelegung her, FA-RIG-14), Hersteller, Typ (Breitband, Schmalband, Luminanz, UV/IR-Cut, Lichtverschmutzung, Photometrisch), Bandbreite (nm), Zentralwellenlänge (nm), Transmission (%), Dicke (mm), Größe, Form, Fassung, Anzeigefarbe (Hex), **photometrisches Band** (U, B, V, Rc, Ic, g, r, i, z, clear, lum, none – Grundlage der Transit-Filterwahl, FA-EXO-08, NT-41), Notizen. | M |
| FA-FIL-02 | Zuordnung eines Filters zu einem Teleskop (optional, nur für Übersichten – **nicht** die Filterradbelegung, NT-43). Maßgeblich für Planung und Konfliktprüfung ist die **Filterradbelegung des Rigs** (FA-RIG-14). | S |
| FA-FIL-03 | „Standard bei neuem Projekt" und Standard-Belichtungszeit je Filter. | S |
| FA-FIL-04 | **Kein Namensabgleich zur Laufzeit** (NT-E1): Welcher NINA-Filter zu einem Filter gehört, legt allein die **bestätigte Filterradbelegung** des Rigs fest (FA-RIG-14, Kap. 8.6). Zeilen, deren Filter auf dem Rig keinem bestätigten NINA-Filternamen zugeordnet ist, plant die Engine nicht ein (Diagnose *Filter nicht zugeordnet*); das Plugin belichtet sie nie. | M |
| FA-FIL-05 | Standard-Mondprofil je Filter (Vorbelegung neuer Zeilen), z. B. Breitband = Streng, 6–7-nm-Schmalband und OIII (auch 3 nm) = Moderat, 3-nm-Hα/SII = Entspannt (NT-42). | S |
| FA-FIL-06 | Filtersammlung als Tabelle (Farbe, Kurz-/Langname, Hersteller, Typ, Bandbreite, Größe, Teleskop, Standard ja/nein, Standard-Belichtung), filterbar nach Teleskop, mit Summen nach Typ; Ansicht **Spektrum** mit Durchlasskurven (aus Zentralwellenlänge/Bandbreite) zum Vergleich ausgewählter Filter. | S |

#### Imaging-System (Rig)

| ID | Anforderung | Prio |
|---|---|---|
| FA-RIG-01 | Rig = benannte Kombination aus genau einem Standort, einem Teleskop, einer Kamera (z. B. „Starfront – GT81 – Ares-M Pro"). | M |
| FA-RIG-02 | Abgeleitete Kennzahlen: Bildfeld (°, ′, Diagonale), Abbildungsmaßstab (″/px), Sampling bei typischem Seeing. | M |
| FA-RIG-03 | Standard-Belichtungsplan je Rig; neue Projekte des Rigs starten damit. | S |
| FA-RIG-04 | Scheduler-Einstellungen werden **je Rig** gespeichert (→ 6.7). | M |
| FA-RIG-04b | **Gemessene Overheads** (AP-65, Entscheidung Sven 07.10.2026): Der Server misst je Rig aus dem Ist der letzten 30 Nächte (Plugin ≥ 0.4.13), was das Rig zwischen den Belichtungen kostet – Anfahren + Zentrieren und Autofokus (beides vom Plugin ab 0.4.19 gemeldet), Meridian-Flip (ohne Autofokus im Flip), Download, Dither und Filterwechsel (Abstände aufeinanderfolgender Lights im Block); Ausreißer werden verworfen (Anfahren > 30 min, Abstände > 10 min oder mit Ereignis dazwischen). Je Wert Median, Anzahl und p25–p75 der letzten 40 Messungen, neu gerechnet nach jedem Sessionabschluss. Ab **10 Messungen** plant die Engine automatisch mit dem Median (ganze Sekunden), vorher und mit dem Schalter **„fest“** je Wert mit dem getippten Wert (FA-SCH-10, FA-SCH-17). Eine geänderte Messung ist keine Einstellungsänderung (keine neue Einstellungsversion an NINA) und wirkt ab dem nächsten Plan. Anzeige in S-10. | S |
| FA-RIG-05 | Zwei Rig-Schalter: **„In Framing und Simulator anzeigen“** (Auswahllisten) und **„An NINA ausliefern“** (Rig in Betrieb; aus = keine Projekte dieses Rigs an NINA, z. B. bei Umbau). | S |
| FA-RIG-06 | Einem Rig können eine oder mehrere NINA-Instanzen zugeordnet sein (Anzeige: zuletzt gesehen, Plugin-Version, Standortabgleich). **Je Rig läuft höchstens eine Session gleichzeitig**: Die laufende Instanz hält eine Reservierung, die jeder Heartbeat verlängert und die nach **3 Minuten** ohne Heartbeat verfällt (Zeitschwellen Kap. 8.1); eine zweite Instanz erhält einen Hinweis, zeigt den Plan nur als Simulation und nimmt nichts auf. Schaltet die Instanz den **Offline-Modus** ein (FA-NIN-04), bleibt die Reservierung bis zur Rückkehr (höchstens 14 Tage) bestehen und es gibt keine Alarme. Admins können die Reservierung in S-42 **freigeben** („Session übernehmen“), z. B. nach Absturz des Rechners; die bisherige Instanz beendet dann die laufende Belichtung und nimmt nichts mehr auf. Melden zwei Instanzen (z. B. beide offline) Aufnahmen derselben Nacht, werden beide übernommen und ein Betriebsalarm ausgelöst. | M |
| FA-RIG-07 | Änderungen an Standort/Teleskop/Kamera wirken sofort auf alle Rigs und Projekte, die sie nutzen. | M |
| FA-RIG-08 | **Standard-Rotation** je Rig (optional), in der Sternkarte per „Anheften“ aus der aktuellen Rotation übernehmbar; Vorbelegung neuer Projekte. | S |
| FA-RIG-10 | **Rotator vorhanden** ja/nein je Rig. *Mit Rotator* fährt das Plugin die Rotation (Positionswinkel) jedes Projekts an. *Ohne Rotator* gilt die Standard-Rotation des Rigs als fest eingestellter **Kamerawinkel**: Das Plugin dreht nicht, sondern prüft nur (→ Kap. 8.8). Projekte und Mosaik-Panels, deren Rotation um mehr als die Toleranz vom Kamerawinkel abweicht, erhalten im Projekt, im Framing und im Simulator eine Warnung. | M |
| FA-RIG-11 | Rotationstoleranz (Standard 5°) und Option **„Block bei Rotationsabweichung überspringen“** (Standard aus: nur Warnung). Ohne Rotator kann der zuletzt von NINA gemessene Winkel per Klick als Kamerawinkel übernommen werden. | S |
| FA-RIG-12 | **Rig-Wechsel und Ausrüstungsänderungen**: Wird einem Projekt ein anderes Rig zugewiesen (auch bei der Freigabe) oder ändern sich Kamera/Filter eines Rigs, prüft das System die Belichtungszeilen und zeigt Konflikte vor dem Speichern: Filter nicht in der Filterradbelegung des Rigs (FA-RIG-14), Gain/Auslesemodus/Binning von der Kamera nicht unterstützt, Bildfeld bzw. Mosaik passt nicht mehr (Hinweis), Aufwand-Kennzeichen ändert sich. **Hat das Projekt schon Aufnahmen** und ändern sich dadurch Brennweite, Pixelgröße oder Sensor, warnt das System („bisheriger Fortschritt stammt von anderer Optik“) und bietet *Projekt duplizieren* (FA-PRJ-08) mit Zählern ab 0 an. Konflikte müssen aufgelöst oder bewusst übernommen werden; der Ersteller wird benachrichtigt. | M |
| FA-RIG-13 | **Löschsperren**: Standort, Teleskop, Kamera, Filter, Mondprofil, Vorlage und Rig können nicht gelöscht werden, solange sie verwendet werden; die Meldung listet die Verwender. **Ergänzung (freigegeben 03.10.2026):** Beim Rig zählen Projekte (auch Wunsch-Rig und Papierkorb), NINA-Instanzen, Sessions, Nachtpläne einer Session und eine aktive Lease; Nachtpläne **ohne** Session (Web-Simulation, Prognose, Server-Plan ohne angelegte Session) sind abgeleitete Daten und werden mit dem Rig gelöscht. | M |
| FA-RIG-14 | **Filterradbelegung je Rig mit bestätigter NINA-Zuordnung** (NT-E1): geordnete Liste der Plätze im Filterrad mit Position, Filter (Web), **NINA-Filtername** und *bestätigt am/von*. Das Plugin meldet mit jedem Heartbeat NINAs Filterrad (Position, Name, Fokus-Offset). Auf der Rig-Seite (S-10, Bereich *Filterradbelegung*) ordnet ein **Admin oder Owner** je Platz den Web-Filter einem der gemeldeten NINA-Filternamen zu und **bestätigt** die Zuordnung. Das System schlägt vor: exakte Übereinstimmung (normalisiert: Kleinbuchstaben, ohne Leer- und Sonderzeichen), sonst Präfix **nur in einer Richtung** – der NINA-Name beginnt mit dem Web-Kurznamen und das nächste Zeichen ist kein Buchstabe („Ha“ → „Ha 3nm“; nie „LPro“ → „L“, „HaOIII“ → „Ha“, „Rc“ → „R“). Ein Vorschlag wirkt erst nach der Bestätigung. An NINA geht je Belichtungszeile der bestätigte NINA-Filtername (leer = nicht zugeordnet); die Engine plant nicht zugeordnete Zeilen nicht ein (Diagnose *Filter nicht zugeordnet*), das Plugin belichtet nur über diesen Namen (exakter Vergleich mit dem NINA-Profil) und überspringt die Aufnahme, wenn er dort fehlt (FA-NIN-27). Meldet NINA an einem Platz einen anderen Namen als bestätigt (Filterrad umgesteckt oder umbenannt), gilt die Zuordnung dieses Platzes als **unbestätigt** und es gibt den Betriebsalarm *NINA-Einstellungen weichen ab* (Grund *Filterrad geändert*). Rigs ohne Filterrad (OSC): keine Zuordnung, kein Filterwechsel. Die Konfliktprüfung (FA-RIG-12) meldet fehlende oder unbestätigte Zuordnungen als Konflikt der betroffenen Zeilen; ohne gepflegte Belegung gibt sie nur Hinweise. | M |
| FA-RIG-09 | Rig-Übersicht in drei Spalten Standort / Teleskop / Kamera mit Kennwerten (Brennweite effektiv, Öffnungsverhältnis, Maßstab, Bildfeld, Sensorgröße), Standard-Belichtungsplan, Standard-Rotation und **Filterradbelegung des Rigs** (FA-RIG-14). | M |

### 6.2 Filter, Belichtungspläne und Mondprofile

#### Belichtungsplan-Vorlagen

| ID | Anforderung | Prio |
|---|---|---|
| FA-BPL-01 | Benannte Vorlagen je Teleskop-Kamera-Kombination, z. B. „LRGB 180 s", „SHO 300 s". | M |
| FA-BPL-02 | Eine Vorlage besteht aus Zeilen mit: Filter, Belichtungszeit (s), Anzahl, Gain, Offset (Kamera-Standard, überschrieben oder leer = NINA-Standard der Kamera, NT-38), Binning (1×1–4×4), Auslesemodus, Mondprofil, aktiv ja/nein. | M |
| FA-BPL-03 | Anzahl und Stunden sind gegenseitig ableitbar (Eingabe des einen berechnet das andere). | S |
| FA-BPL-04 | Vorlagen sind Kopiervorlagen: Anwenden auf ein Projekt kopiert die Zeilen, spätere Änderungen an der Vorlage ändern bestehende Projekte nicht. | M |
| FA-BPL-05 | Eine Vorlage kann auf ein Projekt nur angewendet werden, **solange noch keine Aufnahmen existieren** (danach Hinweis „nicht verfügbar, Projekt begonnen“); später werden Zeilen einzeln ergänzt. | M |
| FA-BPL-06 | Der Vorlagen-Editor liegt auf der Filterseite unter der Filtersammlung (Teleskop + Kamera wählen → Vorlage wählen/neu → Zeilen). | S |

#### Mondprofile

| ID | Anforderung | Prio |
|---|---|---|
| FA-MON-00 | Mondabstand und Mondhöhe werden **topozentrisch** gerechnet (Horizontalparallaxe bis 1,03°): geozentrisch gerechnet kippen an der VSW Hannover 23 h je Jahr die Abstandsprüfung und 95 h je Jahr das Tor „Mond unter dem Horizont" (AST-M4) | M |
| FA-MON-01 | Benannte Mondprofile mit den Parametern: max. Abstand bei Vollmond (°), Breite (Tage bis 50 %), Relax (Grad je Grad Mondhöhe, **kein** Multiplikator – AST-M2), Min-Höhe Mond (°), Max-Höhe Mond (°), max. Beleuchtung (%). Regeln → Kap. 8.2. | M |
| FA-MON-02 | Mitgelieferte Profile *Kein Mond*, *Streng*, *Moderat*, *Entspannt* (Werte → Kap. 8.2): nicht löschbar und nicht änderbar, aber klonbar; eigene Profile sind frei anpassbar. | M |
| FA-MON-03 | Je Belichtungszeile Auswahl: benanntes Profil, *Projektstandard* (am Projekt gepflegte Werte) oder *Keine Mondvermeidung*. | M |
| FA-MON-04 | Interaktives Diagramm: geforderter Abstand über den Mondzyklus (mit und ohne Höhen-Relaxierung), Beleuchtung, Mondphasen, „heute"-Linie; optional tatsächlicher Abstand zu einem Ziel (grün = frei, rot = blockiert). | S |
| FA-MON-05 | Änderungen an einem benannten Profil wirken auf alle Zeilen, die es nutzen. | M |

### 6.3 Zielsuche und Framing

| ID | Anforderung | Prio |
|---|---|---|
| FA-FRM-01 | Suche nach Objektnamen und Katalognummern mit Autovervollständigung über einen **Objektkatalog aus OpenNGC** (CC BY-SA 4.0; Version und Abrufdatum nach `docs/specs/catalog/dso-import.md`): **`NGC.csv` mit 13.969 Zeilen**, dazu die **64 Zeilen** der verwendeten **`addendum.csv`** (u. a. eigene Sharpless-Regionen) – zusammen `13.969 + 64` Quellzeilen in OpenNGC v20260501 (abgerufen 25.09.2026), beides beim Import gezählt; daraus 13.632 Katalogzeilen. OpenNGC ist die **einzige Quelle** für Koordinaten, Typcodes, Sternbild, Größen, Positionswinkel, Helligkeiten in **V und B** und die **Flächenhelligkeit**; der Auszug des Svenesis-Beobachtungsplaners (`ngc.json`, `dso-catalog.js` mit 168 kuratierten Objekten) liefert nur zusätzliche Namen und Aliase, Vorschaubilder und Wikipedia-Titel – seine Helligkeiten sind gerundete Richtwerte ohne Bandangabe und werden nicht übernommen. Messier-, NGC-, IC-, Caldwell- und Sharpless-Nummern sind vollständig auffindbar; Auflösung unbekannter Namen über SIMBAD. LBN/LDN/Barnard als spätere Ergänzung. | M |
| FA-FRM-15 | **Objektbrowser**: Katalogliste filterbar nach Katalog, **Objekttyp** (Anzeigegruppen wie Galaxie, Offener Sternhaufen, Kugelsternhaufen, Planetarischer Nebel, Emissionsnebel, Reflexionsnebel, Dunkelnebel, Supernova-Überrest, Mehrfachstern, Sonstiges – aus den OpenNGC-Typcodes abgebildet), Sternbild, Helligkeit (V oder B, das benutzte Band wird angezeigt), **Flächenhelligkeit** (bei Flächenobjekten), Winkelgröße, maximaler Höhe bzw. nutzbaren Stunden in der gewählten Nacht und „passt ins Bildfeld des Rigs“; Klick zeigt das Objekt im Framing mit Bildfeld. | M |
| FA-FRM-02 | Direkte Eingabe von RA (h m s) und Dec (° ′ ″) bzw. dezimal, J2000. | M |
| FA-FRM-03 | Sternkarte mit Himmelsfotos (HiPS: DSS2 Farbe/Rot/Blau, Pan-STARRS, 2MASS; zusätzlich NSNS Hα/OIII/SII für Schmalband) und Stellarkarte als Offline-Fallback. | M |
| FA-FRM-04 | Einblendung des Bildfelds des gewählten Rigs als Rechteck; per Maus verschiebbar, Koordinaten folgen. | M |
| FA-FRM-05 | Rotation 0–360° (Positionswinkel am Himmel), wird am Projekt gespeichert und in NINA angefahren, sofern das Rig einen Rotator hat; ohne Rotator zeigt das Framing den Kamerawinkel des Rigs und warnt bei Abweichung (FA-RIG-10). | M |
| FA-FRM-06 | Mosaik: Panels horizontal/vertikal (1–16), Überlappung (%); Panelzentren und -rotation werden berechnet und beim Anlegen des Projekts übernommen. | M |
| FA-FRM-07 | Vergleichs-Rig: zweites Bildfeld (gestrichelt) zur Wahl des passenden Rigs. | K |
| FA-FRM-08 | Overlays: äquatoriales und Alt/Az-Gitter, Ekliptik, galaktische Ebene, Horizontlinie (0°) und Mindesthöhe, Meridian, Zenit, Mond/Sonne/Planeten, Sichtbarkeits-Heatmap (Höhen-Schwelle). | S |
| FA-FRM-09 | Katalog-Overlays mit Dichteregler und Winkelgrößen-Kreisen. | S |
| FA-FRM-10 | Projekt-Overlay: Bildfelder aller Projekte, farbig nach Status, anklickbar. | S |
| FA-FRM-11 | Zeitsteuerung: Datum/Uhrzeit, Sprünge (±10 min, ±1 h, ±1 d), „Jetzt", **Zeitraffer** mit wählbarer Geschwindigkeit (Echtzeit, 1 min/s, **10 min/s** Standard, 1 h/s; hält am Ende des Nachtfensters – Spec-Ergänzung 30.09.2026, bisher nur Echtzeitlauf); 24-h-Zeitleiste mit Dämmerungsbändern, Zielhöhe, Mindesthöhe, Mondhöhe und Mond-Ziel-Abstand. | M |
| FA-FRM-12 | Aktion „Projekt anlegen" übernimmt Koordinaten, Rotation, Mosaik und Rig. | M |
| FA-FRM-13 | **Zielvorschläge** (Bewertungslogik aus dem Svenesis-Beobachtungsplaner, Kopie): Rangliste der lohnendsten Objekte einer Nacht für ein Rig, bewertet nach Zeit in großer Höhe während der Dunkelheit, Mond, Helligkeit und Füllung des Bildfelds; für die Helligkeit dürfen V- und B-Wert und bei Flächenobjekten die **Flächenhelligkeit** aus OpenNGC genutzt werden (auch für die Filterempfehlung und die Einschätzung der Sichtbarkeit; eine Regel des Schedulers ist das nicht); Filter nach Anzeigegruppe (Galaxien, Nebel, Sternhaufen); Übernahme in Framing oder direkt als Projekt. | S |
| FA-FRM-14 | Recherche-Links je Objekt (SIMBAD, Wikipedia, AstroBin). | K |

### 6.4 Projekte und Ziele

Ein **Projekt** ist ein Ziel auf genau einem Rig. Ein Projekt hat ein oder mehrere **Panels** (1 bei Einzelfeld). Jedes Panel hat einen **Belichtungsplan** aus Zeilen.

#### Projekt anlegen und bearbeiten

| ID | Anforderung | Prio |
|---|---|---|
| FA-PRJ-01 | Pflichtangaben **ab Einreichung bzw. Aktivierung**: Name, Rig, Koordinaten (J2000); Entwürfe dürfen unvollständig gespeichert werden. Weitere: Objekttyp, Katalogbezeichnungen, Beschreibung, Rotation, **Startdatum** (vorher plant der Scheduler das Projekt nicht; Nacht-Schlüssel, Kap. 8.1), **Zieltermin** (Nacht-Schlüssel; Sortierkriterium „Zieltermin am nächsten“ und Warnung in der Folgeplanung, wenn er voraussichtlich nicht erreicht wird). Bei der Freigabe wird der Wunschzeitraum als Start-/Zieltermin vorgeschlagen. | M |
| FA-PRJ-02 | Übernahme aus Framing; Vorschaubild des Bildfelds wird automatisch aus Himmelsfotos erzeugt (kein Upload eigener Bilder). | S |
| FA-PRJ-03 | Aufnahmebedingungen je Projekt: Mindesthöhe (Standard 30°), Mindestzeit am Ziel (Standard 1,0 h), Dämmerungsgrenze (astronomisch −18°, nautisch −12°, bürgerlich −6°), Mondvermeidung (Projektstandard-Werte). | M |
| FA-PRJ-04 | „Als Standard setzen": aktuelle Bedingungen werden Vorbelegung für neue Projekte. | S |
| FA-PRJ-05 | Belichtungsplan je Panel: Zeilen wie Vorlage (FA-BPL-02) plus Live-Zähler (→ FA-PRJ-10); „Auf alle Panels kopieren“. **Zeilen mit Aufnahmen sind gesperrt** (NT-E3): Filter, Belichtungszeit, Gain, Offset, Binning und Auslesemodus lassen sich nicht mehr ändern (Server lehnt mit `409 line.locked_by_captures` ab, die Oberfläche zeigt die Felder gesperrt mit Hinweis); änderbar bleiben Anzahl geplant, Mondprofil und aktiv. Für andere Einstellungen dient die Aktion ***Zeile duplizieren***: neue Zeile mit denselben Werten und Zählern ab 0, die bisherige Zeile kann dabei optional deaktiviert werden. | M |
| FA-PRJ-20 | Schnelleingabe einer Belichtungszeile: Filter wählen, Belichtungszeit, **Anzahl oder Stunden**, „Hinzufügen“. | M |
| FA-PRJ-21 | Summenzeile und Kopfzahlen je Panel und Projekt: **Geplant** (Frames, Stunden), **Aktuell** (akzeptierte Frames, Stunden), Gesamtfortschritt in %. | M |
| FA-PRJ-22 | Mondprofil-Auswahl je Zeile mit den Optionen *benanntes Profil*, *Projektstandard* und *Keine Mondvermeidung*. Die Projektwerte (mit Schalter „Mondvermeidung aktiv“) wirken nur auf Zeilen mit *Projektstandard*; benannte Profile bleiben davon unberührt. | M |
| FA-PRJ-23 | **Aufwand-Kennzeichen** je Objekt, automatisch berechnet (nicht manuell setzbar, → Kap. 8.9): **„1 Nacht“** (grün) – der Planungsbedarf passt in eine einzige Nacht; **„mehrere Nächte (ca. n)“** (blau) – geschätzte Anzahl klarer Nächte und frühestmögliches Fertigstellungsdatum; **„im Zeitraum nicht machbar (x %)“** (rot) – auch alle klaren Nächte im Wunschzeitraum bzw. bis Saisonende reichen nicht; x = erreichbarer Anteil; **„Transit“** (violett) bei Exoplaneten-Projekten mit Hinweis *vollständig* / *teilweise beobachtbar*. Tooltip: benötigte Stunden inkl. Overhead, beste Nacht mit nutzbaren Stunden je Filter-Stufe (Mond!), begrenzender Faktor (z. B. „Mond blockiert L/R/G/B bis 24.09.“, „nur 2,1 h über Mindesthöhe“). Es ist eine **Schätzung** unter Idealannahmen. Sichtbar im Projekt-Editor schon beim Planen (live), in der Warteschlange (Spalte und Filter), auf der Projektkarte und in der Projektliste (Filter). Neuberechnung bei Änderung von Plan, Bedingungen, Rig oder Zeitraum, nach jeder Session (Restbedarf sinkt) und spätestens alle 7 Tage. | S |
| FA-PRJ-06 | Mosaik-Editor: Panels hinzufügen, löschen, umsortieren, Koordinaten/Rotation ändern – bestehender Fortschritt bleibt dem Panel zugeordnet. Löschen mit Bestätigungsdialog: Panels **mit Aufnahmen** werden nur **weich gelöscht** (ausgeblendet, nicht mehr geplant; Aufnahmen, Zähler und Verlauf bleiben; **nicht einzeln wiederherstellbar** – das Panel bleibt nur erhalten, damit später eintreffende Aufnahmemeldungen zugeordnet werden; Wiederherstellen gibt es nur für ganze Projekte, FA-PRJ-15); Panels **ohne Aufnahmen** werden endgültig gelöscht – gegen Versehen schützt hier der Papierkorb auf Projektebene (FA-PRJ-15, E4). | M |
| FA-PRJ-07 | Zeile deaktivieren: Fortschritt bleibt, Zeile wird nicht mehr geplant. Löschen mit Bestätigungsdialog: Zeilen **mit Aufnahmen** werden nur **weich gelöscht** (wie Panels ausgeblendet und nicht einzeln wiederherstellbar, FA-PRJ-06); Zeilen **ohne Aufnahmen** endgültig (E4). Andere Einstellungen für eine Zeile mit Aufnahmen → *Zeile duplizieren* (FA-PRJ-05, NT-E3). | M |
| FA-PRJ-08 | Projekt duplizieren (z. B. gleiches Ziel auf anderem Rig). | S |
| FA-PRJ-09 | Export eines Projekts als JSON/CSV (Stammdaten, Plan, Fortschritt, Sitzungsprotokolle, Notizen, bei Exoplaneten Ephemeride und Ergebnisse) und Import in eine andere Installation. | K |

#### Status, Priorität, Übersicht

| ID | Anforderung | Prio |
|---|---|---|
| FA-PRJ-10 | Zähler je Zeile: **Geplant**, **Aufgenommen** (von NINA gemeldet), **Verworfen** (manuell), **Akzeptiert**, **Verbleibend**, **Planungsbedarf** (inkl. Überschuss), **Bonus**; Integrationszeit ((Akzeptiert + Bonus − Bonus verworfen) × Belichtung), % erledigt. Definitionen → Kap. 8.4. | M |
| FA-PRJ-18 | Jedes Projekt hat einen **Ersteller** und einen **Freigabestatus** (→ 6.14). Einen Projektstatus (FA-PRJ-11) erhält ein Projekt erst mit der Freigabe; nur freigegebene Projekte können an NINA gehen. Auch Admin-Projekte starten als **Entwurf** (unvollständig speicherbar); ist die Mandanteneinstellung „Admin-Objekte ohne Warteschlange“ (FA-FRG-10) aktiv, gibt der Admin sein Projekt mit *Freigeben & aktivieren* direkt frei – dabei gilt dieselbe Pflichtprüfung wie beim Einreichen (FA-PRJ-01). | M |
| FA-PRJ-11 | Projektstatus (nur für freigegebene Projekte): *Planung*, *Aktiv*, *Pausiert*, *Bereit zur Bearbeitung* (Aufnahme fertig, Stacking/Bearbeitung steht aus), *Abgeschlossen*, *Unfertig* (beendet oder Saison vorbei mit Restbedarf), *Archiviert* (ein Statuswechsel; Löschen ist davon getrennt, FA-PRJ-15). **Übergänge** (nur Admin, außer automatisch): Planung → Aktiv/Pausiert/Archiviert · Aktiv → Pausiert/Bereit zur Bearbeitung/Unfertig/Archiviert · Pausiert → Aktiv/Archiviert · Bereit zur Bearbeitung → Aktiv/Abgeschlossen/Archiviert · Unfertig → Aktiv/Archiviert · Abgeschlossen → Aktiv/Archiviert · Archiviert → Aktiv (Wiederherstellen); andere Wechsel → Fehler. Automatisch: Aktiv → Bereit zur Bearbeitung (FA-PRJ-12), Bereit zur Bearbeitung/Abgeschlossen → Aktiv bei Planungsbedarf > 0 (FA-PRJ-12). Vor der Freigabe gilt nur der Freigabestatus (*Entwurf*, *Eingereicht*, *Zurückgegeben*, *Abgelehnt*). Nur *Aktiv* wird an NINA ausgeliefert. Zusätzlich abgeleitetes Kennzeichen **„n Sessions ungeprüft“** (entspricht Astro PMs *Ready to Inspect*, → FA-AUS-07). | M |
| FA-PRJ-12 | Hinweis **„Soll erreicht“**, wenn alle aktiven Zeilen Verbleibend = 0; Hinweis **„fertig“**, wenn zusätzlich der **Planungsbedarf** aller aktiven Zeilen 0 ist (Überschuss aufgenommen, Kap. 8.4); gilt nicht für Exoplaneten-Projekte (→ FA-EXO-34). Statuswechsel auf *Bereit zur Bearbeitung* nach Bestätigung oder automatisch (Mandanteneinstellung, Standard aus) – automatisch nur, wenn „fertig“ **und** am Rig kein Bonus aktiv ist. Steigt der Planungsbedarf danach wieder über 0 (Frames verworfen), kehrt das Projekt automatisch nach *Aktiv* zurück (Mandanteneinstellung, Standard an; sonst Hinweis). Bonus-Aufnahmen laufen, solange das Projekt *Aktiv* ist. Endet die Saison eines aktiven Projekts mit Restbedarf, wird *Unfertig* vorgeschlagen (→ FA-FOL-04). **Auslösung der automatischen Wechsel (Ergänzung, freigegeben 28.09.2026):** beide Richtungen werden nur bei Änderungen der Zähler oder Belichtungszeilen geprüft (Aufnahme-Ingest, Korrektur, Verwerfen, Zähler-Abgleich, Zeilenänderung) – nicht beim manuellen Statuswechsel und nicht beim Umschalten der Mandanteneinstellung oder des Bonus; im Verlauf mit Vermerk „automatisch“. | S |
| FA-PRJ-16 | **Favoriten**: Projekte markieren, Filter „nur Favoriten“, Favoriten oben in Listen und Auswahlfeldern. | S |
| FA-PRJ-17 | **Kommentare** am Projekt (Ausbau der bisherigen *Notizen*, Entscheidung Sven 04.10.2026): Alle, die das Projekt sehen dürfen (Ersteller, andere User, Admins/Owner, Super User), diskutieren darüber – formatierter Text (Markdown ohne rohes HTML) mit **Emoji** (Auswahl im Eingabefeld). **Antworten** eine Ebene tief (eine Antwort auf eine Antwort hängt sich an denselben Strang). **Reaktionen** unter jedem Kommentar aus einer festen Auswahl (👍 ❤️ 🎉 😄 😮 🙏 🔭) mit Zähler; ein Klick setzt bzw. entfernt die eigene. **Bearbeiten** nur der Verfasser und höchstens **1 h** nach dem Anlegen (Kennzeichen „bearbeitet“); **Löschen** nur Admins/Owner/Super User – weich: der Kommentar zeigt „Kommentar gelöscht“, Antworten bleiben. **Benachrichtigung** in der App (Art `project.comment`) an den Ersteller des Projekts und alle, die dort schon kommentiert haben, außer dem Verfasser. **Kennzeichnung**: Anzahl der Kommentare (Sprechblase mit Zahl) überall, wo Projekte erscheinen – Projektliste (Liste, Karten, Detail), Freigabe-Warteschlange, *An NINA ausgeliefert*, Projektbericht. Die bisherigen Notizen werden zu Kommentaren; im Export enthalten. | S |
| FA-PRJ-13 | Priorität je Rig per Drag & Drop (oben = Priorität 1); wirkt bei Strategie „Manuelle Priorität" und als Sortierkriterium. | M |
| FA-PRJ-14 | Projektliste gruppiert nach Rig (Kopfzeile mit Rig, Standort, Teleskop, Kamera und Anzahl je Status), filterbar nach Status/Rig/Objekttyp/Favorit/Ersteller/Aufwand, Ansichten Liste/Karten/Detail. Projektkarte: Vorschaubild, Aktionen (Öffnen, Framing, Löschen), Reiter *Zielinfo* / *Höhenkurve*, Name mit Status- und Typ-Kennzeichen, RA/Dec/Rotation, Katalogname, Rig-Zeile, Aufwand-Kennzeichen (FA-PRJ-23), bei Exoplaneten die Transitzeile („Transit: Nacht 16./17.09. · Start 01:25 – Ende 05:33 CDT (±1 h Baseline)“), Gesamtfortschrittsbalken, rechts akzeptierte Frames je Filter als Farbchip mit Minibalken („14/15 × 600 s“) und „geschätzte Gesamtintegration geplant (aktuell)“; Kennzeichen ungeprüfter Sessions. | M |
| FA-PRJ-19 | Projektliste zusätzlich filterbar nach Ersteller und **Status**: Chips mit Anzahl je Status über die ganze Lebensdauer (vor der Freigabe Freigabestatus, danach Projektstatus; Mehrfachauswahl, in der Adresse) und Schalter *Alle / Meine* – ersetzt die Ansichten „Meine Objekte“ und „Entwürfe“ (Spec-Ergänzung 30.09.2026). | M |
| FA-PRJ-15 | **Löschen eines Projekts ist immer weich** (Papierkorb, E4): Nach dem Bestätigungsdialog erhält das Projekt einen Löschzeitpunkt, verschwindet aus allen Listen, aus Scheduler und NINA-Auslieferung und erscheint in der Ansicht **„Gelöscht“** (nur Admin/Owner) mit Löschzeitpunkt und *Wiederherstellen*; wiederhergestellt kehrt es mit unverändertem Freigabe- und Projektstatus zurück. Es gibt **kein automatisches endgültiges Löschen** – auch nicht für Projekte ohne Aufnahmen; Aufnahme-Historie, Zähler und Verlauf bleiben immer erhalten. Später eintreffende Meldungen zu gelöschten oder archivierten Objekten werden trotzdem übernommen. User löschen eigene Objekte nur im Freigabestatus *Entwurf* oder *Zurückgegeben* (Berechtigungsmatrix); wiederherstellen kann nur ein Admin. Endgültig entfernt werden Projektdaten nur mit dem ganzen Mandanten (FA-MAN-03). **Rang und Priorität (Ergänzung, freigegeben 28.09.2026):** Löschen zieht offene Änderungsanträge des Projekts zurück; der Rang beim Einreicher (eingereicht) bzw. der Platz in der Rig-Priorität (freigegeben) wird frei, die übrigen rücken auf. Wiederherstellen reiht ein eingereichtes Projekt am Ende der Rangfolge des Einreichers ein, ein freigegebenes an seiner früheren Position im Rig (höchstens am Ende). | M |

### 6.5 Sichtbarkeit und Diagramme

| ID | Anforderung | Prio |
|---|---|---|
| FA-SIC-01 | **Nachtdiagramm** mit Tagesauswahl („Tag 1 – 17.09. (1,2 h)“, Auswahl der nächsten Nächte mit nutzbaren Stunden) und live laufender Standortzeit; ein- und ausblendbare Reihen: Zielhöhe, empfohlene Belichtungsstunden, Zielstunden ohne Mond, Zielstunden mit Mond, Stunden über Mindesthöhe, dunkle Stunden; Dämmerungsbänder (C/N/A), Mondhöhe und -phase, Meridiandurchgang. Die empfohlenen Zeiten kommen je Filter-Stufe aus der Scheduler-Engine. | M |
| FA-SIC-02 | **Saisondiagramm** (1, 3, 6 Monate, Jahr): nutzbare Stunden je Nacht gesamt und je Filter-Stufe, mondfreie vs. mondbeeinflusste Stunden als Bänder, maximale Höhe, „heute“-Markierung, Beginn/Ende der Saison. | M |
| FA-SIC-03 | Die empfohlenen Zeiten werden mit derselben Engine wie der Scheduler berechnet (inkl. Mindesthöhe und Mondregeln), nicht als bloße Höhenschwelle. | M |
| FA-SIC-04 | Kennzahl „nutzbare Stunden bis Saisonende" je Projekt und Filter (Grundlage der Prognose → 6.11). | S |

### 6.6 Astro-Wetter

Grundlage ist eine Kopie des Svenesis-Astro-Wetters, neu umgesetzt (→ Kap. 9).

| ID | Anforderung | Prio |
|---|---|---|
| FA-WET-01 | Vorhersage je Standort über 7 Tage, stündlich: **Gesamtbedeckung** und Bewölkung tief/mittel/hoch, Wind und Böen in 10 m mit Richtung, Höhenwind in 250/500/700/850 hPa mit Richtung, Bodendruck, Temperatur, Taupunkt und Abstand, Feuchte, Sicht, Niederschlag und Regenwahrscheinlichkeit, Wettersymbol, Aerosol (AOD) und Staub, Wasserdampf der Luftsäule; daraus abgeleitet Jetstream-Wind und Windscherung. Dazu **zwei Vergleichsmodelle** (ECMWF IFS und ein feines Modell der Region) sowie **geschätztes** Seeing und **geschätzte** Transparenz – beide sind Ableitungen aus dem Wind- bzw. Aerosolfeld und werden in der Oberfläche als *geschätzt* gekennzeichnet. | M |
| FA-WET-02 | Automatische Modellwahl nach Standort: Europa ICON-D2 → ICON-EU → ICON global, Vergleich mit **HARMONIE AROME** (feines Modell) und **GEM**; sonst HRRR (Nordamerika) → GFS, Vergleich mit **GEM** und **NBM** (NBM liefert zusätzlich Sicht und Regenwahrscheinlichkeit). **ECMWF IFS** ist immer eine Vergleichszeile. Das feine Nest (ICON-D2 bzw. HRRR) gilt je Stunde nur, solange es die Werte des Hauptmodells deckt, in Nordamerika höchstens **30 h**; danach tragen Bewölkung und Sicht das feine Vergleichsmodell. Jede Stunde zeigt, welches Modell sie trägt. | M |
| FA-WET-03 | Gesamtbewertung je Stunde (0–100 %) aus Bedeckung, Seeing und Transparenz; die **Gesamtbedeckung trägt die Bewertung**, Seeing und Transparenz schattieren eine klare Stunde nur. Klassen mit den Grenzen **Ausgezeichnet ≥ 85 %, Gut ≥ 65 %, Mittel ≥ 45 %, Schlecht ≥ 25 %, Sehr schlecht < 25 %** (Grenze gehört zur besseren Klasse). Bewertung je Nacht (Mittag bis Mittag) = mit der Dauer gewichtetes Mittel der Stunden in der astronomischen Dunkelheit, zusammen mit der **Abdeckung** (Anteil der Dunkelheit mit Bewertung). | M |
| FA-WET-04 | Nachtübersicht je Standort: astronomisch dunkle Stunden, davon mondlos, Bewertung dieser Stunden mit Abdeckung, **bestes zusammenhängendes Fenster** (längster Lauf mit Bewertung ≥ 65 %, Rückfall auf ≥ 45 %, mindestens 30 min) samt mondfreiem Anteil, Mondbeleuchtung, Mondauf-/-untergang. | M |
| FA-WET-05 | Wetter-Reiter im Projekt und im Simulator (Überlagerung der Nachtbewertung auf den geplanten Blöcken). | S |
| FA-WET-06 | Taugefahr-Hinweis (Abstand Temperatur/Taupunkt < 4 °C / < 2 °C). | S |
| FA-WET-07 | Vorhersagen werden serverseitig abgerufen – je Lauf drei Abrufe (Hauptmodell, Luftqualität für Aerosol und Staub, Modellvergleich) – und je Standort zwischengespeichert (Abruf alle 15 min, seit 29.09.2026; vorher Richtwert 30–60 min); der Browser des Nutzers spricht Open-Meteo nicht direkt an. Fällt ein Abruf aus, fehlen nur seine Werte; die Stunde bleibt mit Kennzeichen bewertbar. | S |
| FA-WET-08 | Optional eingebettete Wetterkarte (meteoblue) nur nach Klick (Datenschutz). | K |
| FA-WET-09 | Übernahme der Nachtbewertungen in die Folgeplanung (→ FA-FOL-03). **Bekannte Einschränkung:** Niederschlag geht in **keine** Bewertung ein – auch nicht in die Mehrnacht-Prognose. Eine Regennacht wird allein über die Bewölkung bewertet und fällt dadurch eher zu gut aus; Regenmenge und Regenwahrscheinlichkeit werden angezeigt und mitgespeichert, damit man sie in der Kandidatennacht sieht. Gleiches gilt für Nächte ohne Aerosol-Vorhersage (ab Tag 5, Kennzeichen „ohne Aerosol – Bewertung optimistisch“). | M |

**Wie die Bewertung zustande kommt.** Die Bewertung ist eine **Kopie der Website-Logik**, damit Website und NINA-PM für denselben Standort dieselben Zahlen liefern. Formeln, Gewichte, Einheiten und Rundung stehen verbindlich in `docs/specs/engine/weather.md`.

- **Bedeckung** – aus der **Gesamtbedeckung** des Modells. Die Schichten tief/mittel/hoch werden nicht mehr gewichtet und sind nur Anzeige.
- **Seeing (geschätzt)** – aus dem **Höhenwind**: Jetstream (250 hPa gegen 500 hPa), Scherung zwischen der Jet-Fläche und einer nach Bodendruck gewählten unteren Fläche (850, 700 oder 500 hPa) und Bodenwind. Fehlt ein Anteil, wird über die vorhandenen Anteile gewichtet gemittelt und die Stunde als *Seeing unvollständig* gekennzeichnet (ein fehlender Wert gilt **nicht** als ruhige Luft).
- **Transparenz (geschätzt)** – aus dem **Aerosol** (AOD), gedämpft durch Bodenfeuchte über 80 % und durch viel Wasserdampf in der Luftsäule. **Ab Tag 5** endet die Aerosol-Vorhersage: dann gibt es **keine Transparenz**, die Gesamtbewertung verteilt das Gewicht auf die vorhandenen Anteile, und Stunde, Nachtdetail und Mehrnacht-Prognose tragen das Kennzeichen „ohne Aerosol – Bewertung optimistisch“. Eine ersatzweise Schätzung ohne Aerosol gibt es nicht.
- **Nur Anzeige, ohne Wirkung auf die Bewertung:** Bewölkung tief/mittel/hoch, Sicht, Staub, Niederschlag und Regenwahrscheinlichkeit, Wettersymbol, Wasserdampf, Böen, Taupunktabstand (Taugefahr, FA-WET-06) und die Vergleichsmodelle.

Das Wetter **steuert NINA nicht** (keine automatische Absage). Die Sicherheit bleibt beim Safety-Monitor in NINA.

### 6.7 Scheduler und Nacht-Simulator

Der Scheduler verteilt die nutzbare Nacht eines Rigs auf alle aktiven Projekte und erzeugt einen **Nachtplan** aus **Blöcken** (Ziel/Panel, Zeitfenster) mit **Einträgen** (Slew/Zentrieren, Filterwechsel, Belichtung, Dither, Meridian-Flip).

**Grundlage:** Das Verhalten entspricht dem Planungsalgorithmus des Astro-PM-NINA-Plugins (Mond-Stufen, mehrstufige faire Verteilung, Filterwahl nach Mondfenster), ergänzt um genaue Astronomie, Overheads und Meridian-Flip (Kap. 8.3).

#### Einstellungen je Rig

| ID | Anforderung | Prio |
|---|---|---|
| FA-SCH-01 | Strategie: **Proportionale Zeit** (Standard) oder **Manuelle Priorität** (→ Kap. 8.3). | M |
| FA-SCH-02 | Wiedergabemodus in NINA: **Zeitgeführt** (Standard) oder **Sequenziell** (→ FA-NIN-12). | M |
| FA-SCH-03 | Sortierkette (Reihenfolge der Ziele beim Verteilen und bei Zeitknappheit), per Drag & Drop: geringste Maximalhöhe, bald untergehend, meiste Restarbeit, knappes Zeitfenster, meiste Mondvermeidungs-Arbeit, Mosaik zusammenhalten, Priorität, Zieltermin am nächsten. Standard wie Astro PM: geringste Maximalhöhe → bald untergehend → meiste Restarbeit → knappes Zeitfenster. | M |
| FA-SCH-04 | **Überschuss (%)**: garantierte Zusatzframes je Zeile (⌈Geplant × X %⌉), die wie geplante Arbeit eingeplant werden (Reserve für später verworfene Aufnahmen). **Bonus** ein/aus: freie Zeit wird durch Verlängern benachbarter Blöcke gefüllt; fertige Zeilen werden dann weiter belichtet (ohne Obergrenze), Bonus-Frames werden gekennzeichnet und zählen nicht in *Aufgenommen*. | S |
| FA-SCH-05 | Mosaik: Option **„Mosaik-Panels getrennt planen“** (Standard an: jedes Panel ist eine eigene Einheit mit eigener Mindestzeit); aus: das Projekt ist eine Einheit, innerhalb des Blocks wird nach der Mindestzeit am Ziel zum nächsten Panel gewechselt, kurz vor Blockende nicht mehr. Bei *Proportionaler Zeit* erhält ein Mosaik insgesamt denselben fairen Anteil wie ein Einzelfeld mit gleichem Restbedarf; der Anteil wird auf die Panels verteilt. | S |
| FA-SCH-06 | Dither alle N Belichtungen. | M |
| FA-SCH-07 | Filterwechsel alle N Belichtungen (Rundlauf über die Filter statt nacheinander) mit Toleranz: zu einem Filter wird nur gewechselt, wenn noch mind. X % von N Belichtungen in die Restzeit des Blocks **und** sein mondsicheres Fenster passen; ein Filter, dessen Mondfenster früher schließt, gibt keine Zeit an entspanntere Filter ab (Rundlauf dann nur unter gleich dringenden Filtern). | M |
| FA-SCH-08 | Automatische Flats am Ende der Session ein/aus mit **Anzahl je Kombination** (Standard 20); Option **„Vollständiger Flat-Satz“** (Flats für alle Filter des Rigs statt nur für die in der Nacht genutzten Kombinationen); Option **„Dark-Flats aufnehmen“** (Standard an) mit Anzahl (Standard = Flat-Anzahl). **Flat-Quelle** je Rig (NT-40): *Panel* (Standard; Panel- oder Dom-Flats ab Ende der Dunkelheit, Montierung geparkt) oder *Himmel* (Himmelsflats in der Morgendämmerung zwischen Sonnenhöhe −8° und −2°, Reihenfolge Schmalband → Breitband → L, Montierung wird nicht geparkt; Kombinationen, die bis −2° nicht fertig sind, werden als übersprungen gemeldet). **Auto-Flats je Projekt** (AP-50b, Sven 04.10.2026): *aus* (Standard, Flats nach jeder Nacht) · *einmal je Projekt* (am Morgen nur Kombinationen, für die die Projekte der Kombination noch keine Flats auf diesem Rig haben) · *zeitbasiert* (zusätzlich neu, wenn die letzten mindestens N Tage alt sind, N = 1–30, Standard 7); Quelle der vorhandenen Flats ist der Server (gemeldete Flat-Aufnahmen); ausgefallene Kombinationen (Safety-Pause am Morgen, Nachtende) werden mit Auto-Flats am nächsten Morgen nachgeholt, höchstens 3 Nächte; der Belichtungsplan zeigt je Zeile, ob gültige Flats vorliegen. | S |
| FA-SCH-09 | Zeitauflösung der Planung (Richtwert 5-Minuten-Raster für Sichtbarkeit/Mond, Belichtungen exakt). | M |
| FA-SCH-10 | Pauschale Overhead-Annahmen für die Simulation: Slew+Zentrieren je Blockwechsel, Filterwechsel, Dither-Settle, Autofokus-Intervall/Dauer, Download-Zeit je Belichtung, **Meridian-Flip-Dauer** (Standard 4 min: Flip, Beruhigen, erneutes Zentrieren, Guiding-Start – nach dem Flip wird nicht nachrotiert, Kap. 8.8). | S |
| FA-SCH-18 | **Filterwahl im Block**: zuerst die Zeile, deren mondsicheres Fenster am frühesten schließt; bei Gleichstand – Mond unter Horizont oder steigend: strengeres Mondprofil zuerst, Mond sinkend: entspannteres zuerst; dann größter Restbedarf (Farbkanäle bleiben ausgeglichen). Zeilen mit Profil „Kein Mond“ haben bei Mond unter Horizont Vorrang. | M |
| FA-SCH-19 | **Blockbeginn ohne Arbeit**: Kann das eingeplante Ziel am Blockbeginn nichts belichten (z. B. Mond noch zu nah), übernimmt ein anderes Ziel mit Arbeit die ersten Slots; gibt es keines, bleibt die Zeit frei statt eines sinnlosen Slews. | S |
| FA-SCH-17 | **Meridian-Flip in der Planung** je Rig: Flip aktiv ja/nein (aus z. B. bei Gabel- oder Alt/Az-Montierung), Minuten nach Meridian (Standard 5), maximal Minuten nach Meridian (Standard 15), Pause vor Meridian (Standard 0) – gleiche Bedeutung wie die Meridian-Flip-Einstellungen im NINA-Profil. Überquert ein Ziel im Block den Meridian, plant die Engine Wartezeit und Flip-Dauer als Overhead ein (→ Kap. 8.8); Zielkarte, Plangrafik und Planprotokoll zeigen den Flip. | M |

#### Simulator

| ID | Anforderung | Prio |
|---|---|---|
| FA-SIM-01 | Simulation für Rig + Datum (Pfeile, „Heute Nacht“ = aktuelle Nacht nach Kap. 8.1); Kopfzeile mit Standortzeit, dunklen Stunden, Anzahl Ziele, geplanten Frames und Mondbeleuchtung. Ergebnis in drei Schritten auf einer Seite: **1. Einstellungen** des Rigs (→ FA-SCH-01 ff., mit Hinweis „an NINA übertragen“), **2. Zielkarten** je Projekt, **3. Plan** als Grafik und Protokoll. | M |
| FA-SIM-02 | Zeitschieber: „Was macht das Rig um 02:14 CDT?“ (Standortzeit mit Kürzel, NT-03). | S |
| FA-SIM-03 | Hinweise: Projekte ohne Zuteilung mit Grund (nicht sichtbar, Mond blockiert alle Filter, Filter nicht zugeordnet (FA-RIG-14), unter Mindestzeit, erreichbare Arbeit unter Mindestzeit, von höherer Priorität verdrängt). **Plausibilitätswarnungen** des Plans: Leerlauf ≥ 10 min trotz möglichem Ziel, Mondvermeidungs-Filter unsicher belichtet (darf nie auftreten), Ziel unter Mindestzeit, Ziel mit Arbeit und Zeit ohne Belichtung, Mondvermeidungs-Arbeit ohne Nutzung der mondfreien Zeit, > 30 gleiche Belichtungen in Folge (nicht bei Transits und Projekten mit nur einer Zeile). | M |
| FA-SIM-06 | **Zielkarte** je Projekt: zugeteilte Stunden, Zeitfenster, Höhenbereich, Mondabstand, verbleibende Frames je Filter mit Farbchip, Kennzeichen „LA“ (Mondvermeidung) und Schalter An/Aus (übernimmt „aktiv“ der Zeile, nur Admin); Prüfliste mit ✓/✗ für Höhe (Max ≥ Min), Zeit (≥ Mindestzeit), Mond (sicher, Abstand), Dunkelheit (Sonnenhöhe ≤ Grenze), Rotation (✓ wird angefahren bzw. passt zum Kamerawinkel, ⚠ Abweichung ohne Rotator); Kennzeichen **„Flip 01:23 CDT (4 min)“**, wenn der Block einen Meridian-Flip enthält. Bei Exoplaneten zusätzlich Transitfenster und Kasten „Transit-Lauf: Dither aus, Filterwechsel aus, Vorrang“. | M |
| FA-SIM-07 | **Plangrafik**: Dämmerungsverlauf, Höhenkurven je Ziel, belegte Blöcke farbig je Ziel, darüber Filterbalken in Filterfarben, Jetzt-Linie, Zeitschieber. | M |
| FA-SIM-08 | **Planprotokoll** als Tabelle: Befehl (Start, Info, Slew/Zentrieren/Rotieren, Filter, Belichtung, Dither, Meridian-Flip, Flats, Ende), Zeit, Ziel, Panel, Nr., Filter, Belichtung, Gain, Offset, Binning, Auslesemodus, Rotation, RA, Dec, Ränge der Sortierkette, Höhe, Mondabstand, Mond ok, geforderter Abstand, dunkel, LA, LA sicher, Mondprofil; kopierbar und als CSV exportierbar. | M |
| FA-SIM-04 | Mehrnacht-Simulation (z. B. 7 oder 14 Nächte) mit fortgeschriebenem Restbedarf, optional gewichtet mit Wetterbewertung. | S |
| FA-SIM-09 | **Übernahmestatus in NINA** (entspricht Astro PMs „Cloud updated“): Einstellungen sind ohne eigenen Sync-Knopf sofort gültig (FA-SYN-03). Simulator und Rig zeigen je NINA-Instanz, welche Einstellungsversion zuletzt abgerufen wurde und wann („NINA hat v12 am 17.09. 13:02 CDT übernommen“), bzw. „Änderung noch nicht abgerufen“, wenn die aktuelle Version neuer ist. | S |
| FA-SIM-05 | Die Simulation verwendet exakt dieselbe Engine und dieselben Eingaben wie der Planaufbau in NINA. Abweichende Eingaben (Plugin-Version, NINA-Profilstandort) werden angezeigt. | M |
| FA-SIM-10 | **Ist + Plan der laufenden und vergangenen Nacht** (R5, AP-53c): Web-Simulator, „Heute Nacht“ (Zeitleiste) und Simulator im Plugin zeigen **Erledigtes blass** aus den Session-Ereignissen und Aufnahmen aller Sessions der Nacht (Blöcke, Filterabschnitte, Lücken mit Grund: Leerlauf, Safety-Pause, Flip, leere Blöcke in Folge, übersprungene Blöcke) und **das Kommende kräftig** aus der letzten gespeicherten Planrevision – das, was das Plugin ausführt; bei Was-wäre-wenn aus der Rechnung ab jetzt. Wahlweise der Ursprungsplan (Revision 1) als Umriss. Planprotokoll mit Spalte **Ist** und Zählern. Die Engine-Eingabe des Web-Simulators kommt vom Server (dieselbe Funktion wie der Planaufbau für NINA); ein Hinweis zeigt „gleiche Eingabe wie der Server“, „Was-wäre-wenn“ bzw. „Rig plant noch mit Rev. n“, wenn sich Ziele oder Einstellungen seit dem gespeicherten Plan geändert haben (auch auf „Heute Nacht“). | M |

#### Garantien der Engine

| ID | Regel | Prio |
|---|---|---|
| FA-SCH-11 | Keine Blöcke unter der Mindestzeit am Ziel: zu kurze Zuteilungen werden verlängert, bei Nachbarn mit Reserve geliehen oder sonst freigegeben; Ziele, deren erreichbare Arbeit heute unter der Mindestzeit liegt, nehmen nicht teil. | M |
| FA-SCH-12 | Lücken und Splitter: freie Restslots werden benachbarten Blöcken zugeschlagen, kurze Splitter neben einem vollwertigen Block entfernt, Muster A-B-A zu A-A-B zusammengelegt (weniger Slews). | S |
| FA-SCH-13 | Mondfreie Zeit (Mond unter Horizont) zuerst für Arbeit, die heute nur dann möglich ist (Profil „Kein Mond“ oder in keinem Mond-oben-Slot sicher), fair verteilt nach diesem Bedarf; danach für übrige Mondvermeidungs-Arbeit – zuerst für Ziele ohne nennenswerte Alternative bei Mond über dem Horizont. Früh untergehende Ziele reservieren ihren fairen Anteil innerhalb ihres Fensters. | M |
| FA-SCH-14 | Restposten fast fertiger Projekte werden auch unter der Mindestzeit eingeplant (kein „ewiger Rest"). | S |
| FA-SCH-15 | Blockende ist harte Grenze – eine Belichtung wird nur begonnen, wenn sie bis Blockende passt. Ausnahme (**Nachtende-Kulanz**, NT-13): die letzte Belichtung der Nacht darf über ihr Blockende hinauslaufen, wird aber nur begonnen, wenn sie samt Download bis zum **Ende der Dunkelheit** (`darknessEndUtc`, 8.1) **und** bis zur Morgendämmerung der **eigenen** Dämmerungsgrenze des Projekts fertig ist (der frühere der beiden Zeitpunkte; ein nautisches Projekt darf also nicht bis zum Ende einer astronomischen Nachbarzeile weiterlaufen und umgekehrt, M4); fehlen beide Zeitpunkte (keine Dunkelheit), gilt das Blockende. | M |
| FA-SCH-16 | Deterministisch: gleiche Eingaben → gleicher Plan. | M |

### 6.8 Synchronisation Web ↔ NINA

| ID | Anforderung | Prio |
|---|---|---|
| FA-SYN-01 | Je NINA-Instanz erzeugt ein Admin in der Web-App ein **Sync-Token** (**ohne Ablaufdatum**, jederzeit widerrufbar – der Widerruf wirkt sofort bei der nächsten Anfrage des Plugins, SV-08; mit Name, gebunden an **genau ein Rig** und damit an den Mandanten; das Plugin muss weder Mandant noch Rig zusätzlich angeben). Tipp: als Passwort behandeln. | M |
| FA-SYN-02 | Ausgeliefert werden je Rig (nur Daten des Mandanten der NINA-Instanz) **freigegebene, aktive, nicht gelöschte** Projekte eines Rigs mit „An NINA ausliefern“, deren Startdatum erreicht ist und die entweder **Planungsbedarf** haben (Kap. 8.4), Bonus-Aufnahmen erlauben (FA-SCH-04) oder (Exoplaneten) ein festgelegtes Transitereignis haben – jeweils mit Panels, Koordinaten, Rotation, Belichtungszeilen inkl. Fortschritt und Planungsbedarf, Priorität, Bedingungen, Mondprofilen, Scheduler-Einstellungen, Standort, Filter-Kurznamen mit dem je Zeile bestätigten NINA-Filternamen (FA-RIG-14; leer = nicht zugeordnet), Kühl-Soll und Toleranz der Kamera (NT-E2), Flat-Quelle (NT-40), Auslesemodi (Name und Index), bei Exoplaneten-Projekten gespeicherter Ephemeride und festgelegtem Transitereignis mit Aufnahmefenster (Baseline-Beginn, Ingress, Mitte, Egress, Baseline-Ende). | M |
| FA-SYN-03 | Änderungen in der Web-App sind sofort abrufbar. NINA holt den aktuellen Stand beim Planaufbau, **vor jedem Block** und **während eines Blocks alle 15 Minuten**. Wirkung: (a) aktuelles Ziel oder aktuelle Zeile entfällt (pausiert, abgeschaltet, gelöscht, durch Korrektur fertig, Rig nicht mehr ausgeliefert) → laufende Belichtung zu Ende belichten, Block beenden, Rest der Nacht neu planen; (b) neu festgelegter Transit, dessen Fenster in die laufende Planung fällt → Transit-Unterbrechung (FA-NIN-20) und Neuplanung; (c) alle übrigen Änderungen (Priorität, neue Projekte, Korrekturen anderer Ziele, Rig-Einstellungen) → wirken ab dem nächsten Block. Ist NINA online, plant der Server; offline plant das Plugin aus dem Cache (gleiche Engine). | M |
| FA-SYN-04 | NINA meldet jede Aufnahme einzeln (→ FA-NIN-09); Meldungen sind idempotent (eindeutige ID), damit Wiederholungen nach Verbindungsabbruch nicht doppelt zählen. | M |
| FA-SYN-05 | Meldungen, die offline entstanden sind, werden später nachgeliefert (Warteschlange im Plugin). | M |
| FA-SYN-06 | Session-Ereignisse (Start, Plan gebaut, Blockwechsel, Block übersprungen mit Grund, Transit-Unterbrechung Beginn/Ende, Safety-Pause und -Fortsetzung (FA-NIN-14), Meridian-Flip (Dauer), Rotationsabweichung, Flats, Ende, Warnungen/Fehler) werden gemeldet. | M |
| FA-SYN-07 | Heartbeat der NINA-Instanz (60 s) mit Plugin-Version, aktuellem Zustand (läuft, wartet, pausiert, Flats, offline) und Standort des NINA-Profils. Er dient der Diagnose (FA-ADM-06), **verlängert die Reservierung** (FA-RIG-06) und steuert Session-Status und Betriebsalarme nach den Zeitschwellen in Kap. 8.1; eine Live-Überwachung im Sinne einer Fernsteuerung gibt es nicht. | S |
| FA-SYN-08 | Konfliktregel: Planung/Einstellungen → Web-App gewinnt. Aufnahmen → NINA-Meldungen gewinnen, manuelle Korrekturen (Verworfen) liegen darüber. | M |
| FA-SYN-09 | **Nachmelden**: Das Plugin bewahrt gesendete Meldungen 14 Tage auf und kann sie auf Anforderung (z. B. nach einer Wiederherstellung des Servers) erneut senden; doppelte Meldungen werden erkannt. | S |

### 6.9 NINA-Plugin

Zielplattform: NINA 3.x, Installation über den Plugin-Manager (bzw. manuell im MVP).

#### Optionen

| ID | Anforderung | Prio |
|---|---|---|
| FA-NIN-01 | **Optionsseite** mit Abschnitten *Einführung* (Kurzbeschreibung, Link zur Web-App) und *Verbindung*: Anleitung in vier Schritten (Web-App öffnen, Rig anlegen, NINA-Instanz anlegen, Token kopieren), Felder Server-URL und Sync-Token, Knöpfe **Speichern & Verbinden** und **Aktualisieren**, Statuszeile („Verbunden – 2 Ziele gefunden“ bzw. Fehlertext), **Offline-/Urlaubsmodus** mit Erklärung (FA-NIN-04). Darunter *NINA-PM-Einstellungen*: dem Token zugeordnetes Rig mit Standort, Teleskop und Kamera (nur Anzeige – das Rig wird in der Web-App gewählt, FA-SYN-01). | M |
| FA-NIN-02 | **Zielbrowser** („An NINA ausgeliefert“ im Plugin): Tabelle Ziel, RA, Dec, Rotation, Panels, Brennweite, Sensor Breite/Höhe (px), Pixelgröße, Priorität, Typ, Fortschritt, nächster Transit; Filter nach Typ und Fortschritt; *Aktualisieren*; **In Framing-Assistent laden** übernimmt Koordinaten, Rotation, Sensor- und Brennweitenangaben sowie das Mosaik-Raster in NINAs Framing-Assistenten (für manuelle Sitzungen oder Kontrolle). | S |
| FA-NIN-22 | Web-Ansicht **„An NINA ausgeliefert“** je Rig (entspricht Astro PMs „Cloud Targets“): alle Ziele, die NINA beim nächsten Planaufbau erhält, mit Status, Einzelfeld/Mosaik, RA/Dec, Rotation, Rig, letzte Änderung, Fortschritt je Filter; filter- und sortierbar; Admin kann ein Ziel aus der Auslieferung nehmen (setzt Projektstatus *Pausiert*). | S |
| FA-NIN-03 | Standortprüfung: Weichen die Koordinaten des NINA-Profils mehr als ~10 km vom Rig-Standort ab, wird gewarnt. Ebenso bei Versionskonflikt Plugin ↔ Server. Die **Zeitzone des NINA-Rechners muss nicht** die Standortzeit sein (NT-06); weicht ihr Versatz ab, erscheint nur ein **Hinweis** (`pc_timezone_differs`), weil NINA die PC-Zeitzone für DATE-LOC im FITS-Kopf, für Datums-Platzhalter in Datei- und Ordnernamen und für seine eingebauten Zeit-Anweisungen verwendet. Der Hinweis nennt die Folge: NINAs Datumsordner (`$$DATEMINUS12$$`) wechselt nach der PC-Zone – bei Starfront und einem Rechner in deutscher Zeit schon um 05:00 CDT, sodass die Aufnahmen einer Nacht in zwei Datumsordnern landen; empfohlen ist die Standortzone als PC-Zeitzone (L3). Alle Zeitregeln des Plugins rechnen in UTC bzw. Standortzeit. | M |
| FA-NIN-04 | **Offline-Modus**-Schalter für die **laufende Nacht**: bewusst ohne Server weiterarbeiten (→ FA-NIN-15). Beim Einschalten meldet das Plugin einmalig „offline“ an den Server (Reservierung und Session-Überwachung werden bis zur Rückkehr, höchstens 14 Tage, eingefroren – keine *verwaist*-Markierung, keine Alarme); danach keine Server-Aufrufe mehr. Das Plugin arbeitet den gespeicherten Server-Plan dieser Nacht ab; Meldungen werden gepuffert und beim Ausschalten gesendet. Eine neue Nacht beginnt erst wieder mit Verbindung (kein Mehrnachtbetrieb offline, keine lokal geänderten Scheduler-Einstellungen). *(Geändert von Sven am 01.10.2026: das Plugin plant nie selbst, es arbeitet den gespeicherten Server-Plan ab.)* | M |

#### Sequenzbausteine

| ID | Anforderung | Prio |
|---|---|---|
| FA-NIN-05 | **NINA-PM-Anweisungen** (Container): holt Rig-Einstellungen und Ziele, lässt den Nachtplan erstellen (online vom Server, offline lokal), führt ihn Block für Block aus und aktualisiert vor jedem Block (FA-SYN-03). Vor und nach jeder Belichtung werden die Trigger aller umgebenden Container einschließlich der globalen Trigger ausgelöst (Autofokus, Meridian-Flip mit den Koordinaten des aktuellen Ziels, Zentrieren nach Drift) – Vorgehen wie im Astro-PM-Plugin. | M |
| FA-NIN-06 | **Nachtschleife** (Schleifenbedingung, NT-11): wahr, solange ein Block läuft, Blöcke übrig sind, die lokale Session veraltet ist (Neuaufbau) oder Flats ausstehen. Sie wird **falsch**, sobald das **Ende der Dunkelheit** (`darknessEndUtc`; ohne Dunkelheit das Nachtende `sessionEndUtc`) erreicht ist und keine Flats mehr ausstehen, spätestens beim Nachtende (`sessionEndUtc`). Danach folgt sofort der Ende-Bereich der Sequenz (Guiding stoppen, parken, aufwärmen) – nicht erst am Nachtende. Ein leerer Plan nach dem Ende der Dunkelheit ist **kein** Fehler (`plan_failed`). **Reihenfolge am Nachtende:** Blöcke → Flats → Schleifenende → `PATCH` der Session mit `status: completed`; eine abgeschlossene Session wird nicht wieder geöffnet (`specs/nina/execution.md` §2, TK 10.3 Nr. 12). | M |
| FA-NIN-07 | **Tagesschleife** (Schleifenbedingung, R5) für Mehrnacht-Betrieb: läuft, solange die Auslieferungsmenge des Rigs (FA-SYN-02) für mindestens eine der nächsten 3 Nächte nicht leer ist, höchstens bis zu einem Enddatum (letzter Nacht-Schlüssel einschließlich, Standortzeit – NT-06) bzw. einer Höchstzahl von Nächten (Standard 14); Nächte ohne Plan werden übersprungen (Warten auf die nächste Nacht). | S |
| FA-NIN-08 | **Ziele aktualisieren** (Anweisung): holt aktuellen Stand und füllt den Cache, z. B. am Sequenzbeginn. | S |
| FA-NIN-26 | **Anweisungskatalog** des Plugins (Kategorie *NINA-PM* im Sequenzer). **R1:** *NINA-PM-Anweisungen* (Container, FA-NIN-05), *NINA-PM Nachtschleife* (FA-NIN-06), *NINA-PM Ziele aktualisieren* (FA-NIN-08), *NINA-PM Warten bis sicher oder Nachtende* (wartet im Sicherungs-Container, bis der Safety-Monitor sicher meldet, höchstens bis zum Ende der Dunkelheit, H2), vier Trigger-Sets (FA-NIN-16). **R5:** *NINA-PM Tagesschleife* (FA-NIN-07), *NINA-PM Warten auf Zeit* (Quelle Uhrzeit oder Dämmerung astronomisch/nautisch/bürgerlich, Versatz, Tageswechsel-Zeit – Standard lokaler Mittag am Rig-Standort wie die Nacht-Definition in 8.1, Warnung bei Abweichung; alle Uhrzeiten gelten in **Standortzeit**, nicht in der Zeitzone des NINA-Rechners, NT-06; bei der Zeitumstellung gilt eine doppelt vorkommende Uhrzeit beim ersten Auftreten, eine ausgefallene wird um die Lücke nach vorn verschoben, also später, z. B. 02:30 → 03:30, L2). **Nicht** übernommen: Fernsteuerung *Remote Play/Pause* (Kap. 2.3). | M / S |

**Verbindliche Sequenzvorlage** (NT-44; nach Vorbild der Astro-PM-Beispielsequenz „Single Night with Safety“, geprüft vom Sequenz-Prüfpunkt des Plugins):

1. **Start**: *Warten auf Sonnenhöhe* −6° (R1; ab R5 *NINA-PM Warten auf Zeit*) → *Entparken* → *Kamera kühlen* → *Autofokus ausführen* – erst warten, dann entparken (H3), Autofokus **einmal je Nacht vor dem ersten Ziel** (NT-24).
2. **Äußere Schleife** mit der Bedingung *NINA-PM Nachtschleife*, darin nacheinander:
   - **Ziel-Container** mit den Bedingungen *NINA-PM Nachtschleife* und *Loop While Safe* (NINAs Safety-Bedingung, NT-16), darin zuerst die Wiederherstellung der Montierung (*Entparken* bzw. bei Home-Rigs *Nachführung an*, rig-abhängig Strom/Abdeckung) und danach ein Container „Blöcke“ mit *NINA-PM-Anweisungen* (ab R5 mit Flat-Handling, FA-NIN-17); Trigger am Container: *Meridian Flip*, *Autofokus nach Zeit* mit dem Autofokus-Intervall des Rigs (M7), Autofokus nach HFR bzw. Temperatur (optional), *Center after Drift* (optional), *Restore Guiding* – **kein** Dither-Trigger (das Dithern steuert allein der Plan; vorhandene Dither-Trigger unterdrückt das Plugin und meldet einen Hinweis).
   - **Sicherungs-Container** mit den Bedingungen *Loop While Unsafe* und *NINA-PM Nachtschleife*: *Guiding stoppen* → *Parken* bzw. *Home* mit *Nachführung aus* → *NINA-PM Warten bis sicher oder Nachtende* als letzter Schritt (NINA überspringt alles danach, sobald es sicher ist). NINAs *Warten bis sicher* wird nicht verwendet, weil es ohne Frist wartet (H2). Bleibt es bis zum Ende der Dunkelheit unsicher, schließt das Plugin die Nacht ab, ohne dass der Ziel-Container wieder anläuft: Flats nur, falls sicher, Session *abgeschlossen*, danach der Ende-Bereich.
3. **Ende**: *Guiding stoppen* → *Parken* (bzw. *Home* mit *Nachführung aus*) → *Kamera aufwärmen*.

Für Mehrnachtbetrieb (R5) liegt alles in einer *NINA-PM Tagesschleife* mit *NINA-PM Warten auf Zeit* (Dämmerung, Tageswechsel-Zeit) – auch hier erst warten, dann entparken (H3). **Ohne Safety-Monitor** gilt dieselbe Liste ohne *Loop While Safe* und ohne Sicherungs-Container (Vorlage *Eine Nacht ohne Safety*); enthält die Sequenz Safety-Bedingungen, ohne dass ein Safety-Monitor verbunden ist, warnt der Sequenz-Prüfpunkt (H2). Der Sequenz-Prüfpunkt prüft Inhalt **und** Reihenfolge. Die Beispielsequenzen (FA-NIN-25) folgen genau dieser Liste. Meldungen direkt aus NINA (z. B. „Warte auf Dämmerung“) übernimmt weiterhin NINAs eigenes Discord-Plugin; die Web-App meldet serverseitig in die Mandanten-Kanäle (FA-DIS) – beides kann in dieselben Kanäle schreiben.

**Automatischer Start** (NT-45): Die Sequenz kann über die **Windows-Aufgabenplanung** mit NINAs Kommandozeile (Profil, Sequenzdatei, Sequenz sofort starten – genaue Schalter im Spike AP-S2b) gestartet werden, und zwar zu jeder Tageszeit: Das Plugin bestimmt die aktuelle Nacht nach Kap. 8.1 und wartet auf deren ersten Block. Ein Start am Vormittag nach dem Ende des Nachtfensters gilt bereits der folgenden Nacht (Beispiel Starfront: 18.09. 16:00 MESZ = 09:00 CDT → Nacht 18./19.09.).

#### Ausführung

| ID | Anforderung | Prio |
|---|---|---|
| FA-NIN-09 | Je Block: Warten bis Blockbeginn → Prüfung der Durchführbarkeit (Höhe, Dunkelheit) → Slew, Plate-Solve-Zentrieren und Rotieren auf Panelkoordinaten/Rotation → Guiding starten → Belichtungsschleife mit Filterwechseln (Gain/Offset/Binning/Auslesemodus aus der Zeile) und Dithern gemäß Plan → jede gespeicherte Aufnahme melden. **Kühlung** (NT-E2): Vor Blockbeginn und je Belichtung prüft das Plugin bei gekühlten Kameras mit Soll-Temperatur, ob die Kühlung an ist und die Sensortemperatur höchstens um die Toleranz vom Soll abweicht; bei Abweichung wird **weiter belichtet** – nur Warnung *Kameratemperatur weicht ab* (höchstens einmal je Block) und die Aufnahme wird mit *Temperaturabweichung* gemeldet (Anzeige im Session-Detail). | M |
| FA-NIN-10 | Zentrieren mit gestaffelten Wiederholungen (15 s, 15 s, 30 s, 1, 2, 5, 5, 10, 10 min; keine Wiederholung, die nach Blockende läge); gelingt es nicht, wird der Block übersprungen (mit Grund), die Nacht läuft weiter. | M |
| FA-NIN-11 | Trigger des Eltern-Containers (Autofokus, Meridian-Flip usw.) werden zwischen Belichtungen ausgeführt. | M |
| FA-NIN-12 | Wiedergabemodus: *Zeitgeführt* – nach Verzögerung wird zum laut Uhr aktuellen Eintrag gesprungen (verpasste Belichtungen entfallen, Mondfenster bleiben gültig); *Sequenziell* – Einträge strikt nacheinander, Block endet trotzdem pünktlich. Einstellung wird je Block gelesen. | M |
| FA-NIN-13 | **Live-Status im Container** (Kopfzeile): Status (*Warten*, *Läuft*, *Flats*, *Beendet*), Ziel („Plan wird beim Sequenzstart erstellt …“ vor dem Start), Filter, Belichtung, Kameraeinstellungen, Koordinaten (RA/Dec), Rotation, Knopf *Zurücksetzen* (Plan verwerfen, beim nächsten Lauf neu bauen). Aufklappbare Bereiche: **Heutige Ziele** (Blockliste mit Zeitfenstern und Fortschritt), **Nachtsimulation** (Grafik wie FA-SIM-07, Planprotokoll), **Flat-Handling** (Status „Flats aktiv“, erfasste Kombinationen der Nacht bzw. „Noch keine Aufnahmen heute“, FA-NIN-17). Bedienknopf *Block überspringen*. In R1 ohne die Bereiche *Nachtsimulation* (R5, mit FA-NIN-18) und *Flat-Handling* (R5, mit FA-NIN-17). | M |
| FA-NIN-14 | Unterbrechungen: Nach Safety-Schließung oder Sequenz-Neustart wird die laufende Session fortgesetzt; der Rest der Nacht wird mit dem aktuellen Stand neu geplant (FA-SYN-03). Liegt die Session in der Vergangenheit (die aktuelle Nacht nach Kap. 8.1 ist eine andere), beginnt eine neue Session. **Safety-Unterbrechung** (NT-16): Meldet NINAs *Loop While Safe* „unsicher“, bricht NINA die laufende Aufnahme ab (gemeldet als *abgebrochen*); der Block endet mit Grund *unterbrochen*, Ereignis *Safety-Pause*, Zustand *pausiert*. Nach der Wiederaufnahme folgen Ereignis *Safety-Fortsetzung* und Neuplanung; Slew und Zentrieren entfallen nur, wenn seit dem letzten Zentrieren weder geparkt noch unterbrochen wurde. Die 5-Minuten-Wiederholsperre gilt nur nach einem Abbruch durch den Benutzer, nicht nach einer Safety-Unterbrechung. **Unsicher bis zum Nachtende** (H2): Das Warten auf „sicher“ hat eine Frist – das Ende der Dunkelheit; danach endet die Nacht ohne Wiederaufnahme (Flats nur, falls sicher; Session *abgeschlossen*; Parken und Aufwärmen). **Stopp durch den Benutzer** (NT-15): Session wird *abgebrochen*. | M |
| FA-NIN-15 | Offline: Jeder erfolgreiche Abruf füllt einen lokalen Cache, jeder Server-Plan wird mit seiner Nacht gespeichert. Ist der Server nicht erreichbar oder der Offline-Modus aktiv, arbeitet das Plugin den **gespeicherten Plan** der aktuellen Nacht weiter ab (Block nach Uhrzeit, keine eigene Planung); ohne gespeicherten Plan dieser Nacht laufen keine Blöcke. **Netzausfall während der Nacht** (NT-14): Bleiben drei Heartbeats ohne Antwort (Netzfehler oder Zeitüberschreitung, keine Serverantwort), gilt der Server als *nicht erreichbar* – das Plugin **arbeitet weiter**: laufende und geplante Blöcke werden ausgeführt, Aufnahmen tragen die ID des gespeicherten Plans und werden nach der Rückkehr nachgemeldet; danach plant der Server bei Bedarf neu. Die Reservierung gilt nur dann als verloren, wenn der Server das ausdrücklich meldet (z. B. nach *Session übernehmen*, FA-RIG-06). *(Geändert von Sven am 01.10.2026: das Plugin plant nie selbst, es arbeitet den gespeicherten Server-Plan ab.)* | M |
| FA-NIN-16 | **Trigger-Sets** (R1) als eigene Anweisungen des Plugins mit frei befüllbarem Inhalt: *NINA-PM vor jeder Belichtung*, *NINA-PM nach jeder Belichtung*, *NINA-PM vor Zielwechsel* (nach Slew/Zentrieren/Rotieren, vor Guiding), *NINA-PM nach Zielwechsel*. Anweisungen darin wie Zentrieren/Slew erhalten automatisch die Koordinaten des aktuellen Ziels. | S |
| FA-NIN-17 | **Flat-Handling im Container** (R5; läuft, wenn die Nacht endet; ein/aus und Anzahlen über FA-SCH-08). Drei Boxen: **Vor Flats** (einmal, z. B. Guiding stoppen, Montierung parken, Flatpanel schließen und Licht an; bei Flat-Quelle *Himmel* wird nicht geparkt und das Plugin wartet auf Sonnenhöhe −8°, FA-SCH-08, NT-40); **Je Kombination** (Schleife); **Nach Flats** (einmal, z. B. Licht aus, Flatpanel öffnen). **Kombination** = Filter (Kurzname) + mechanischer Rotatorwinkel (ohne Rotator 0) + Gain + Offset + Binning + Auslesemodus – **ohne Ziel**; jede Kombination führt die Liste der Ziele, deren Lights sie nutzen. Ein Meridian-Flip ändert den mechanischen Winkel nicht und erzeugt daher **keine** zusätzliche Kombination (Kap. 8.8, NT-E4). Vor jedem Schleifendurchlauf setzt das Plugin Filterrad, Rotator, Gain, Offset, Binning und Auslesemodus passend; Inhalt der Box z. B. NINAs *Trainierte Flat-Belichtung* und direkt danach *Trainierte Dark-Belichtung* (Dark-Flats, gleiche Belichtungszeit, abschaltbar), Fortschritt je Anweisung („20/20“). Jede Kombination wird **einmal** aufgenommen; die Dateien werden in den Ordner jedes Ziels der Liste kopiert. Mit **Vollständigem Flat-Satz** kommen je Rotatorwinkel alle Filter des Filterrads (FA-RIG-14) hinzu. Kombinationen werden neustartfest gemerkt; nach Neustart wird bei der nächsten offenen Kombination fortgesetzt. Jede Flat- und Dark-Flat-Aufnahme wird einmal gemeldet, mit der Zielliste (FA-NIN-09). | S |
| FA-NIN-18 | **Simulator im Plugin** (Optionsseite): gleiche Darstellung wie S-40 – Infobox mit *Beispielsequenzen herunterladen*, Schritt 1 Einstellungen (Strategie, Wiedergabe, Bonus/Überschuss, Mosaik-Panels, Dither, Filterwechsel, Flats, vollständiger Flat-Satz, Dark-Flats, Meridian-Flip, Sortierkette) **gesperrt mit Hinweis „Gesteuert von NINA-PM – Änderungen in der Web-App“**, Datum/*Heute Nacht*/*Simulieren*, „Ziele zuletzt abgerufen: …“, Schritt 2 Zielkarten, Schritt 3 Plangrafik und Planprotokoll mit *Protokoll kopieren*. Es rechnet immer der Server; ohne Verbindung ist der Simulator nicht verfügbar (das Plugin rechnet nicht selbst, Änderung von Sven am 01.10.2026). | S |
| FA-NIN-19 | Protokollierung aller Entscheidungen im NINA-Log mit eindeutigem Präfix (z. B. `NINA-PM |`). | M |
| FA-NIN-27 | **Filterzuordnung sicher** (NT-E1): Belichtet wird nur über den **bestätigten NINA-Filternamen** der Filterradbelegung (FA-RIG-14, Kap. 8.6), exakt verglichen mit dem aktiven NINA-Profil; eine Namensheuristik zur Laufzeit gibt es nicht. Fehlt der Name im Profil, werden die Belichtungen der Zeile übersprungen (`filter_not_found`) und einmal je 12 h gemeldet – nie wird durch den gerade eingelegten Filter belichtet. Leerer oder fehlgeschlagener Planaufbau wird frühestens nach 5 min wiederholt (Schutz vor Abrufschleifen); ein widerrufenes Token schaltet den Cache ab. | M |
| FA-NIN-20 | **Transit-Unterbrechung** in NINA: Rückt ein Transitfenster (inkl. Baseline) heran, beendet das Plugin die laufende Belichtung (zu Ende belichten, wenn sie vor Fenster-Beginn abzüglich Slew-Vorlauf endet, sonst abbrechen – OP-12) und den Block, fährt den Wirtsstern an, zentriert, startet Guiding und belichtet mit der Transit-Zeile durchgehend bis Baseline-Ende – ohne Dither und ohne Filterwechsel; Autofokus nur, wenn für Transits ausdrücklich erlaubt. Danach Rückkehr zu den regulären Zielen mit neu geplanter Restnacht. → Kap. 6.10 | M |
| FA-NIN-23 | **Rotation in NINA** (→ Kap. 8.8): *Mit Rotator* – zu Blockbeginn Zentrieren **und** Rotieren auf den Positionswinkel des Panels (NINA wählt bei Rotator-Bereich *voll* oder *halb* PA oder PA + 180°, Vergleich modulo 180°; der Bereich *Viertel* wird nicht unterstützt und erzeugt den Alarm *NINA-Einstellungen weichen ab*, M2); nach einem Meridian-Flip nur Zentrieren, **kein** Nachrotieren (NT-E4). *Ohne Rotator* – nur Zentrieren; der per Plate-Solve gemessene Winkel wird mit dem Soll verglichen (modulo 180°) und bei Abweichung über der Toleranz einmal je Block als Warnung gemeldet bzw. der Block übersprungen (FA-RIG-11). Jede Aufnahme meldet Pier-Seite und mechanischen Rotatorwinkel. | M |
| FA-NIN-24 | **Abgleich Meridian-Flip**: Das Plugin prüft beim Planaufbau, ob die Sequenz einen Meridian-Flip-Trigger enthält, und liest die Werte (Minuten nach Meridian, maximal, Pause vor Meridian) aus dem **aktiven NINA-Profil**; beides wird mit dem Heartbeat gemeldet. Weichen die Werte von den Rig-Einstellungen (FA-SCH-17) ab oder fehlt der Trigger bei aktivem Flip, erscheint eine Warnung in NINA und in der Web-App (NINA-Instanzen, Simulator, Betriebsalarm). Jeder tatsächliche Flip wird mit Dauer als Ereignis gemeldet. **Vorgaben an das NINA-Profil** (NT-22), mit dem Heartbeat gemeldet und geprüft: NINA-**Recenter nach dem Flip aus** (das Plugin zentriert selbst; ist es an und das Rig ohne Rotator, entfällt das eigene Zentrieren nach dem Flip, es bleibt die Winkelprüfung), **kein Dither-Trigger** in der Sequenz, Montierung in **J2000 oder JNow** (B1950/J2050 → Warnung), **Standort der Montierung = Standort des Rigs** (Länge Ost positiv; Sternzeit-Abweichung > 1 min → Warnung). Rotator-Bereich *voll* oder *halb* (nicht *Viertel*, M2); Trigger *Autofokus nach Zeit* mit dem Intervall des Rigs (fehlt er, plant der Server ohne zeitgesteuerten Autofokus, M7). Außerdem gemeldet und angezeigt: alle Meridian-Flip-Einstellungen (inkl. Autofokus nach Flip, Beruhigungszeit), Rotator-Bereich, Plate-Solve-Rotationstoleranz, vorhandene Autofokus-Trigger, Kühlung (NT-E2) und Filterrad (NT-E1). Abweichungen erzeugen den Betriebsalarm *NINA-Einstellungen weichen ab* mit der Liste der Gründe (in S-42 und am Rig); die Nacht läuft trotzdem. | S |
| FA-NIN-25 | **Beispielsequenzen** zum Download (Simulator-Infobox und NINA-Anleitung): (a) *Eine Nacht mit Safety* – Aufbau genau nach der **verbindlichen Sequenzvorlage** oben (NT-44) ohne Flat-Handling (**R1**), dazu *Eine Nacht ohne Safety* für Rigs ohne Safety-Monitor (ohne Safety-Bedingungen, **R1**, H2); (b) *Mehrere Nächte* – zusätzlich Tagesschleife mit „Warten auf Dämmerung“ und (c) *mit Flats* – Flat-Handling mit Vor Flats / Je Kombination (trainierte Flat- und Dark-Belichtung) / Nach Flats (beide **R5**, mit Tagesschleife und Flats). Die Vorlagen passen zur jeweiligen Plugin-Version und enthalten keine gerätespezifischen Werte. | S |
| FA-NIN-21 | **Meridian-Flip und Transitfenster** (NT-25): NINA flippt nie vor t_M + *Minuten nach Meridian*; ein Vorziehen des Flips gibt es daher nicht. Liegt dieser Zeitpunkt im Aufnahmefenster (inkl. Baseline), ist der Flip **unvermeidlich**: Die Planung weist die erwartete **Lücke** aus (Beginn, Dauer inkl. Zentrieren), der Transit erhält das rote Kennzeichen „Flip im Fenster“ (Suche, Zielkarte, Plan; die Diagnose nennt zusätzlich „Autofokus nach Flip aktiv“, wenn das NINA-Profil nach dem Flip fokussiert) und der Flip wird im Ereignisprotokoll vermerkt. Das Plugin löst den Flip zum geplanten Zeitpunkt über NINAs Meridian-Flip-Trigger aus (es wartet dafür, bis NINAs früheste Flipzeit erreicht ist) und zentriert nach **jedem** erkannten Flip, auch einem ungeplanten (M3). Liegt der früheste Flipzeitpunkt im Vorlauf vor dem Fenster, wird der Flip dorthin gelegt – vor die erste Aufnahme der Reihe – und im Plan ausgewiesen (L1). Unabhängig davon hält die Planung vor Fenster-Beginn den Vorlauf für Slew und Zentrieren (+ 60 s) frei (FA-EXO-23). | S |
| FA-NIN-28 | **Andockbare Fenster im Imaging-Reiter** (R5, AP-53b): *NINA-PM* – Statuszeile (Zustand, Ziel mit Block x/y, Filter, Belichtung n/m mit Fortschritt und Restzeit, Kamera, Danach, Outbox), Plangrafik der laufenden Nacht mit **Erledigtem blass** (aus dem lokalen Nachtjournal des Plugins) und **Geplantem kräftig** (aus dem gespeicherten Plan), Lücken mit Grund, Jetzt-Linie und Fußzeile mit Plan und Revision; schmal angedockt mit der Liste „Heutige Ziele“. *NINA-PM Protokoll* – Planprotokoll der Nacht mit Spalte **Ist** (✓ gespeichert, ↷ übersprungen mit Grund, ✕ fehlgeschlagen, ▶ läuft, ○ geplant), Zählern, *Mitlaufen*, *Nur Belichtungen* und *Protokoll kopieren*. Erledigtes bleibt auch nach einer Neuplanung und nach einem Neustart sichtbar; Höhenkurven kommen aus der Simulation des Servers, ohne Verbindung fehlen nur sie. | S |

#### Inhalt einer Aufnahmemeldung (FA-NIN-09)

Pflicht: eindeutige ID, Session-ID, Block (bei Lights), **Aufnahmetyp** (*Light*, *Flat*, *Dark-Flat*), Projekt, Panel, Belichtungszeile (bei Lights; bei Flats/Dark-Flats die Liste der Projekte, für die die Aufnahme gilt – bei geteilten Kombinationen mehrere), Transit-Beobachtung (bei Exoplaneten), Belichtungsbeginn und **Belichtungsmitte** (UTC; die Mitte ist Grundlage der BJD_TDB-Zeiten, FA-EXO-29), Filter-Kurzname (bei allen Typen) und tatsächlicher Filtername, Belichtungszeit, Gain, Offset, Binning, Auslesemodus, Rotation (Positionswinkel), Pier-Seite, mechanischer Rotatorwinkel (falls Rotator), Bonus ja/nein, Ergebnis (gespeichert/abgebrochen/fehlgeschlagen), Dateiname (nur als Text, keine Datei), Sensor- und Soll-Temperatur, sofern die Kamera sie liefert, und das Kennzeichen *Temperaturabweichung* (NT-E2). Bei Flats zusätzlich die mittlere Helligkeit (ADU). Flats und Dark-Flats zählen nie in Belichtungszeilen und erscheinen nie als „nicht zugeordnet“. Weicht ein Light in Filter, Belichtungszeit, Binning, Gain oder Offset von seiner Zeile ab, wird es trotzdem gespeichert und gezählt, aber als *Einstellungen abweichend* gekennzeichnet und im Session-Detail angezeigt (NT-E3). Die vollständige Datenstruktur der NINA-Schnittstelle steht im Technischen Konzept (Kap. 7.6).

Optional (**K**), sofern NINA die Werte ohnehin berechnet und bereitstellt: HFR, Sternanzahl, Mittelwert/Median ADU, Guiding-RMS, Höhe/Luftmasse, Fokusposition. Diese Werte werden **nur gespeichert und angezeigt** – es findet keine eigene Bildanalyse statt.

### 6.10 Exoplaneten-Transitplanung

Transits sind **Termine**, keine Warteschlangen-Einträge: Das Ereignis findet zu einer festen Zeit statt. Die Transitplanung sucht beobachtbare Transits für ein Rig und eine Nacht, legt je Planet ein **Exoplaneten-Projekt** mit gespeicherter Ephemeride an und legt es auf einen Transit fest; der Scheduler reserviert dafür das Fenster vor der regulären Astrofotografie. Die Ergebnisse der Photometrie werden später importiert und über Nächte und Saisons verglichen.

#### Suche und Kataloge

| ID | Anforderung | Prio |
|---|---|---|
| FA-EXO-01 | Auswahl **Rig** (liefert Standort, Zeitzone, Öffnung) und **Nacht** (Mittag–Mittag, Pfeile, „Heute Nacht“ = aktuelle Nacht nach Kap. 8.1, NT-01); Knopf *Transits suchen*. Alle Zeiten in Standortzeit mit Kürzel (NT-03). | M |
| FA-EXO-02 | Kataloge wählbar und kombinierbar: **ExoClock** (**≈ 780** kuratierte Planeten – 776 am 29.09.2026, Spec-Ergänzung AP-40; ExoClock IV (2025) nannte ≈ 620 –, gepflegte BJD_TDB-Ephemeriden, R-Band-Tiefen, Geometrie, Beobachtungspriorität alert/high/medium/low; Standard), **NASA Exoplanet Archive** (bestätigte transitierende Planeten, Tabelle *pscomppars* über TAP, zusätzlich Planetenradius, Gleichgewichtstemperatur, Entfernung), **TESS TOI** (Kandidaten PC, bestätigt CP, bekannt KP – Ephemeriden driften am stärksten). | M |
| FA-EXO-31 | **Amateur-Vorfilter** beim Katalogabruf: Aus dem NASA-Archiv (~4.700 Planeten) werden nur für Amateure erreichbare übernommen (Richtwert ~800, gemessen 29.09.2026: 4.739 → 702 mit den Vorgaben; Kriterien z. B. Wirtsstern ≤ 14 mag, Tiefe ≥ 3 mmag, Dec vom Standort erreichbar – konfigurierbar). | S |
| FA-EXO-03 | Dubletten über mehrere Kataloge werden zusammengeführt; Vorrang ExoClock → NASA → TOI. | M |
| FA-EXO-04 | Kataloge werden serverseitig zwischengespeichert (Richtwert ExoClock 1 Tag, NASA/TOI 7 Tage), manuelles Neuladen möglich; bei Ausfall wird der Cache verwendet. | M |
| FA-EXO-05 | Filter: ExoClock-Priorität (alle / nur Alert / High und höher / Medium und höher), max. Sternhelligkeit (Standard 14,0 mag; V, sonst R/Gaia G/TESS T), min. Transittiefe (Standard 3 mmag), min. Höhe (Standard 30°), **nur beobachtbare**, **Start/Ende innerhalb nautischer Dunkelheit**, **Start/Ende über Mindesthöhe**, **Meridian-Flip anzeigen**, **Transits mit Meridian-Flip ausblenden**; Anzahl gefundener Transits für die Nacht. Einstellungen bleiben je Benutzer gespeichert. Ein aus der Suche angelegtes Projekt übernimmt **Dämmerungsgrenze** (Standard nautisch) und **Mindesthöhe** aus diesem Filter (FA-EXO-15), damit gefundene Transits auch planbar bleiben. | M |

#### Ergebnisliste

| ID | Anforderung | Prio |
|---|---|---|
| FA-EXO-32 | Schalter **„Meine Beobachtungen“**: zeigt immer alle Planeten, zu denen es ein Exoplaneten-Projekt gibt, jeweils mit dem nächsten passenden Transit – auch wenn dieser Monate entfernt liegt. | S |
| FA-EXO-06 | Eine Zeile je Transit, sortierbar, Standard nach Transitmitte: Priorität (farbig: Alert rot, High orange, Medium gold), Planet, Katalog (bei TOI mit Disposition), Größenklasse (terrestrisch < 1,25 R⊕, Super-Erde < 2, Sub-Neptun < 4, neptunartig < 6, Gasriese), Entfernung (Lj), Periode, Spektralklasse des Sterns (aus Temperatur), empfohlener Filter, Helligkeit, Tiefe (mmag), Dauer (h), Ingress/Mitte/Egress, Höhe bei Mitte, Mondabstand, O−C (min), benötigte Öffnung. | M |
| FA-EXO-07 | **Benötigte Öffnung** aus dem ExoClock-Rauschmodell bzw. eigener Schätzung („est"), farbig gegen die Öffnung des Rigs: grün erfüllt, gelb ≥ 80 %, rot darunter. | S |
| FA-EXO-08 | **Filterempfehlung**: Standard photometrisch Rc; bei sehr roten Sternen Ic; bei lichtschwachen Sternen (> 13 mag) Luminanz/Clear. Kein Schmalband. **Abbildung auf das Rig** (NT-41) über das photometrische Band (FA-FIL-01) auf einen Filter der **bestätigten** Filterradbelegung (FA-RIG-14): gleiches Band → sonst Breitband-Rot (für Rc/Ic) bzw. Breitband-Grün (für V) mit Hinweis *Ersatzfilter* → sonst Luminanz/Clear (Band `lum`/`clear`); ohne Treffer ist das Projekt auf diesem Rig **nicht festlegbar** (Hinweis). | S |
| FA-EXO-09 | Recherche-Links: NASA-Exoplanet-Katalog bzw. ExoFOP (TOI), ExoClock, SIMBAD. | K |

#### Detail und Zeitleiste

| ID | Anforderung | Prio |
|---|---|---|
| FA-EXO-10 | **Transit-Zeitleiste** der Nacht: Dämmerungsbänder, Zielhöhe mit Mindesthöhe, Mondhöhe, Transitband Ingress–Egress mit Uhrzeiten, Baseline-Bereiche davor/danach, schematische Lichtkurve (Form aus Rp/R★, a/R★, Inklination; streifender Transit als V-Form; Tiefe beschriftet in %). | M |
| FA-EXO-11 | **Meridian-Markierung**: orange, wenn der Durchgang in der Nacht liegt; rot, wenn er in das Beobachtungsfenster (inkl. Baseline) fällt. | M |
| FA-EXO-12 | **Unsicherheit der Vorhersage** (1σ, wächst mit Anzahl Umläufe seit Epoche) und O−C-Drift werden angezeigt und standardmäßig als zusätzlicher Puffer beidseitig auf das Fenster aufgeschlagen. | M |
| FA-EXO-13 | Detailangaben: Koordinaten, Helligkeiten, Tiefe, Dauer, Periode, Kontaktzeiten mit Höhen, Unsicherheit, Mondabstand, benötigte Öffnung, Spektraltyp, Radienverhältnis – mit kurzer Erklärung je Größe. | S |
| FA-EXO-14 | Unterer Bereich: **Sternfeld** (ca. 0,5°, HiPS DSS2) mit Kreis um den Wirtsstern und „In Framing öffnen“; **Himmelslage** wie im Projekt-Editor (kleine Sternkarte mit Sternbildern, Milchstraße und Bildfeld des Rigs, verschieb- und zoombar); Reiter **Zieldetails** (empfohlene Filter mit Begründung, Recherche-Links, Ephemeridenquelle) und **Meine Beobachtungen**. Aktionen je Zeile: *Rechner* (K), *Framing*, *Projekt*. | S |
| FA-EXO-14a | **Belichtungsempfehlung** (Spec-Ergänzung 30.09.2026, Wunsch Sven, Annahmen freigegeben 30.09.2026; vorgezogener Teil des Modus *Exoplanet-Stern*, Kap. 2) als eigene kleine Karte der aufgeklappten Zeile: Belichtungszeit für Filter und Standard-Gain des Rigs gegen Sättigung (Spitzenpixel ≤ 50 %), höchstens 180 s und ≥ 4 Aufnahmen je Ingress; Aufnahmen im Fenster, Genauigkeit je Aufnahme (mmag), Transit-SNR mit Einstufung und Spitze in % der Sättigung. Sättigt der Stern im Fokus unter 30 s, wird auf 30 s mit Defokus-Hinweis (Ziel-FWHM) empfohlen und die kurze Belichtung im Fokus zusätzlich gezeigt. Ohne bestätigten Filterradplatz rechnet sie vorläufig mit dem Web-Filter eines unbestätigten Platzes und weist darauf hin. Fehlen Kamera-, Teleskop- oder Filterangaben, nennt die Karte sie. Modell in `docs/specs/engine/transit.md` §6. | K |

#### Exoplaneten-Projekt (je Planet)

Ein **Exoplaneten-Projekt** gehört zu genau einem Planeten und einem Rig. Es sammelt über beliebig viele Nächte und Saisons **Transit-Beobachtungen** (je beobachtetem Ereignis eine).

| ID | Anforderung | Prio |
|---|---|---|
| FA-EXO-15 | *Projekt anlegen* aus einer Ergebniszeile: Projekttyp **Exoplanet**, Name (Planet), Koordinaten des Wirtssterns, Rig, Katalogdaten (Periode, Tiefe, Dauer, Helligkeiten, Priorität, benötigte Öffnung, Rp/R★, a/R★, Inklination, Entfernung) und die **vollständige Ephemeride** (T₀ ± σ, P ± σ, Quelle, Stand); die Transit-Zeile wird mit dem nach FA-EXO-08 abgebildeten Filter der Filterradbelegung vorbelegt (Hinweis *Ersatzfilter* bleibt sichtbar, NT-41). Ein Exoplaneten-Projekt ist eindeutig **je Planet, Rig und Ersteller**: Existiert bereits ein eigenes Projekt, wird dieses geöffnet; Projekte anderer Mitglieder für denselben Planeten werden als Hinweis angezeigt (mit Link und deren Beobachtungen). | M |
| FA-EXO-16a | **Ephemeridenalter** (AST-T9): `k·σ ≤ 0,5·T14` **und** `k·σ ≤ 30 min` → planbar · `0,5·T14 < k·σ ≤ T14` → Warnung *Ephemeride unsicher*, Baseline auf `k·σ` erhöhen · `k·σ > T14` → **nicht festlegbar** (`409 transit.ephemeris_stale`), Katalogaktualisierung erzwingen. Zusätzlich Hinweis, wenn der Katalogstand älter als 365 Tage ist und ein neuerer vorliegt. Bei TESS-Kandidaten wächst σ schnell: nach 3 Jahren 54 min, nach 10 Jahren 177 min – mehr als jede Nacht hergibt | M |
| FA-EXO-16 | Die Ephemeride ist **am Projekt gespeichert**: alle Ansichten (Zeitleiste, Transit-Reiter, Projektkarte, Scheduler) berechnen kommende Transits daraus ohne erneuten Katalogabruf. Neuere Katalogstände werden als Aktualisierung angeboten (mit Anzeige der Änderung von T₀/P und der Auswirkung auf die nächste Transitmitte); frühere Ephemeriden bleiben als Historie erhalten. | M |
| FA-EXO-17 | Reiter **Exoplanet-Transit** im Projekt: gleiche Nacht-Zeitleiste wie in der Suche, Liste der kommenden beobachtbaren Transits (mit Höhe, Mond, Meridian, Wetterbewertung soweit vorhanden). Die Liste reicht **60 Nächte** ab der laufenden Nacht (Spec-Ergänzung 30.09.2026, AP-42, freigegeben 30.09.2026) und rechnet aus der gespeicherten Ephemeride mit Dämmerungsgrenze und Mindesthöhe des Projekts. | M |
| FA-EXO-18 | **Transit-Datum setzen**: wählt ein konkretes Ereignis und legt dafür eine **Transit-Beobachtung** an. Vor der Freigabe hat sie den Status *gewünscht*; mit der Freigabe wird sie *festgelegt*. **Nach der Freigabe** legt der **Ersteller** weitere Transits seines Projekts **selbst** fest (Admins jederzeit) – **mehrere künftige, nicht überlappende Ereignisse** sind erlaubt (höchstens *n* offen, Mandanteneinstellung, Standard 3). Mandanteneinstellung „Transit-Festlegung durch User bestätigen lassen“ (**Standard an**): die Beobachtung bleibt *gewünscht* und erscheint als **Transit-Bestätigung** in der Warteschlange mit Frist (FA-FRG-09) und dem Hinweis, welche regulären Blöcke der Nacht verdrängt würden. Ausgeliefert und geplant werden festgelegte Ereignisse der jeweiligen Nacht; Zeitleiste, Projektkarte und Scheduler folgen dem nächsten festgelegten Ereignis. Ohne festgelegtes Datum ist das Projekt nicht planbar (Hinweis). Festlegungen **nach der Frist werden abgelehnt** (`409 transit.deadline_passed`) – die Oberfläche zeigt die Frist und, sobald sie verstrichen ist, den Hinweis „Frist abgelaufen, bitte Admin ansprechen“; ein Admin kann jederzeit festlegen. | M |
| FA-EXO-19 | Aufnahmefenster des Ereignisses: Ingress, Mitte, Egress (Standortzeit + UTC); **Empfehlung Ingress − 1 h bis Egress + 1 h** (Baseline-Standard von ExoClock und ETD), Baseline vor/nach einstellbar, zusätzlicher Unsicherheitspuffer (→ Kap. 8.7). | M |
| FA-EXO-20 | Belichtungsplan: genau eine aktive Zeile (Filter, Belichtungszeit, Gain/Offset/Binning/Auslesemodus); *Geplant* = Fensterdauer ÷ (Belichtung + Download) als **Richtwert**. NINA belichtet **durchgehend bis Fensterende**, unabhängig davon, ob der Richtwert erreicht ist; zusätzliche Frames zählen zur Beobachtung (nicht als Bonus). Geplant/Verbleibend beziehen sich auf die festgelegte Transit-Beobachtung und werden bei jeder neuen Festlegung neu berechnet; die Aufnahmen früherer Beobachtungen bleiben ihrer Beobachtung zugeordnet. Kein Dither, keine Filterrotation, Mondprofil standardmäßig *Keine Mondvermeidung* (Mondabstand nur als Hinweis). Optionen: Defokus-Hinweis, Autofokus im Fenster erlaubt (Standard nein), Zentrieren nach Drift erlaubt. Im Fenster unterdrückt das Plugin nicht erlaubte Autofokus- und Zentrier-Trigger (Meridian-Flip bleibt immer aktiv). | M |
| FA-EXO-21 | Nach Ende des Fensters wird **diese** Transit-Beobachtung auf *beobachtet* (mit Session, Aufnahmen, Abdeckung) bzw. *verpasst* (ohne Aufnahmen) gesetzt; treffen später noch Aufnahmen ein (offline nachgemeldet), wird *verpasst* zu *beobachtet*. Weitere bereits festgelegte Beobachtungen des Projekts bleiben unberührt; nur wenn keine weitere mehr festgelegt ist, wird der nächste beobachtbare Transit vorgeschlagen (→ FA-EXO-30). Wird die Festlegung vorher aufgehoben, erhält die Beobachtung den Status *storniert*. | M |
| FA-EXO-33 | **Konflikte auf demselben Rig**: (a) **dasselbe Ereignis** (gleicher Planet, gleiche Epoche) von mehreren Mitgliedern festgelegt → wird **einmal aufgenommen**, wenn die Transit-Zeilen übereinstimmen (Filter, Belichtung, Gain, Offset, Binning, Auslesemodus). *Primär* ist die zuerst festgelegte Beobachtung: NINA belichtet deren Zeile, die Aufnahmen zählen nur an der primären Beobachtung und werden bei den übrigen (verknüpften) Beobachtungen angezeigt – Abdeckung und Ergebnis-Import sind für alle sichtbar, jede Beobachtung behält ihren Ersteller, nichts wird doppelt gezählt. Stimmen die Zeilen nicht überein, wird beim Festlegen gewarnt und nach (b) behandelt; (b) **verschiedene Ereignisse bzw. abweichende Zeilen mit überlappenden Fenstern** → die Festlegung wird **abgelehnt** (`409 transit.window_overlap`); die Oberfläche warnt bereits beim Auswählen und zeigt die belegende Beobachtung samt Ersteller. Es gilt allein die **frühere Festlegung** (`locked_at`) – es gibt keine Vorrangregel nach Priorität, weil ein nachträgliches Verdrängen einer bereits zugesagten Beobachtung dem Ersteller die Nacht ohne sein Zutun nehmen würde. Wer die Nacht trotzdem haben will, spricht mit dem Admin, der die belegende Beobachtung aufhebt. | S |
| FA-EXO-34 | Projektstatus eines Exoplaneten-Projekts bleibt *Aktiv*, solange weitere Beobachtungen gewünscht sind; *Abgeschlossen* beendet die Vorschläge. | S |

#### Scheduler-Regeln für Transits

| ID | Anforderung | Prio |
|---|---|---|
| FA-EXO-22 | Transitfenster sind **vorrangig vor allen Strategien**: Weder *Proportionale Zeit* noch *Manuelle Priorität* können ein Transitfenster verdrängen. | M |
| FA-EXO-23 | **Reservierung zuerst**: Vor jeder anderen Planungsentscheidung werden alle 5-Minuten-Slots im Aufnahmefenster, in denen das Ziel Mindesthöhe und Dunkelheitsgrenze erfüllt, für das Exoplaneten-Projekt beansprucht und gesperrt – sie werden nie verliehen, gekürzt oder neu vergeben. Die reguläre Astrofotografie wird um das Fenster herum geplant (inkl. Slew-/Zentrier-Vorlauf vor Fenster-Beginn); Mindestzeit-Regeln regulärer Projekte gelten für die verbleibenden Lücken. Im Fenster sind Filter-Batching und Dithering abgeschaltet (durchgehende Einfilter-Zeitreihe). | M |
| FA-EXO-24 | Liegt ein Teil des Fensters unter der Mindesthöhe oder in der Dämmerung, wird nur der gültige Teil geplant und im Simulator deutlich markiert (Ingress/Egress abgedeckt ja/nein). | M |
| FA-EXO-25 | Simulator und Nachtdiagramm zeigen Transitblöcke gesondert (eigene Farbe, Kontaktzeiten, Meridian-Warnung). | M |
| FA-EXO-26 | Bei Verzögerungen (Safety-Pause) gilt für Transitblöcke immer *zeitgeführt*: Nach Wiederaufnahme wird sofort am Transitziel weiterbelichtet, solange das Fenster läuft. | M |

#### Transit-Auswertung

| ID | Anforderung | Prio |
|---|---|---|
| FA-EXO-27 | Abdeckung des Fensters: Zeitstrahl mit belegten Belichtungen; Kennzahlen Baseline vorher (min), Ingress abgedeckt, Transit abgedeckt (%), Egress abgedeckt, Baseline nachher (min), Lücken > 2 × Belichtungstakt mit Ursache (aus Ereignissen). | M |
| FA-EXO-28 | Ampel „Lichtkurve verwertbar" nach Regel: beide Kontakte abgedeckt, Baseline je ≥ 30 min, keine Lücke im Transit > 5 % der Dauer (Schwellen konfigurierbar). | S |
| FA-EXO-29 | Aufnahmeliste des Transits als CSV (Zeitpunkte UTC, zusätzlich BJD_TDB der Belichtungsmitte) zur Übergabe an Photometrie-Software bzw. ExoClock-Einreichung. Die Photometrie selbst ist nicht Teil des Systems. | S |
| FA-EXO-35 | **Ergebnisimport** je Transit-Beobachtung: Ausgabedateien von **HOPS** und **EXOTIC** hochladen; das System liest aus: angepasstes Radienverhältnis Rp/R★ ± Fehler, Transittiefe, Transitmitte (BJD_TDB) ± Fehler in Minuten, Epoche, O−C gegenüber der Projekt-Ephemeride. Die Lichtkurven-Grafik (PNG) aus dem Ergebnisordner wird mit abgelegt und angezeigt. Die Photometrie selbst findet außerhalb statt. Berechtigt: Admins für alle, User für ihre eigenen, freigegebenen Exoplaneten-Objekte. | S |
| FA-EXO-36 | **Qualitätswerte** aus der Ergebnisdatei mit Haken/Warnung gegen die Kriterien von ExoClock: Residuenstreuung (ppt), reduziertes χ², Autokorrelationstest, Shapiro-Wilk-Test, Anzahl entfernter Ausreißer; Gesamtaussage „einreichungsfähig ja/nein“ (Schwellen konfigurierbar). | S |
| FA-EXO-37 | **Vergleichstabelle je Planet**: Zeilen = Kenngrößen (Tiefe, Rp/R★, Dauer, Transitmitte/O−C), erste Spalte Katalogwerte, danach eine datierte Spalte je eigener Beobachtung (neueste zuerst); zusätzlich O−C-Diagramm über alle eigenen Beobachtungen zur Erkennung von Streuung oder Drift. | S |
| FA-EXO-38 | Links zur Einreichung (ExoClock, NASA Exoplanet Watch, ExoFOP, SIMBAD) je Projekt; Export der Beobachtungsdaten (Metadaten, Ergebniswerte) als CSV/JSON. Eine direkte Übermittlung an diese Dienste ist nicht vorgesehen. | K |
| FA-EXO-39 | **Automatisch festlegen**: Option je Exoplaneten-Projekt „nächste beobachtbare Transits automatisch festlegen bis Datum X“ (nur vollständig beobachtbare, ohne Konflikt; es gilt dieselbe Obergrenze *n* wie in FA-EXO-18, Standard 3); jede automatische Festlegung erzeugt eine Benachrichtigung. | K |
| FA-EXO-30 | Vorschlag des nächsten beobachtbaren Transits desselben Planeten mit Wetterbewertung der Nacht (→ 6.6). | S |

### 6.11 Auswertung und Folgeplanung

Kern der Erweiterung gegenüber Astro PM. Grundlage sind ausschließlich Plan, Aufnahmemeldungen, Session-Ereignisse, manuelle Korrekturen sowie Wetter- und Sichtbarkeitsdaten – **keine Bilddateien**.

*Neuordnung 07.10.2026 (Entscheidungen Sven, Brief AP-64):* Die Auswertung ist nach drei Fragen geordnet – **Nächte** (Was ist passiert?), **Projekte** (Wie weit bin ich, wann bin ich fertig?) und **Standort-Statistik** (Wie oft ist es nutzbar, stimmt die Vorhersage?) – mit einem gemeinsamen Filter Rig + Zeitraum (in Nächten). Die vorausschauende Folgeplanung verlässt die Auswertung: Restbedarf und Prognose stehen unter „Projekte“, Kandidatennächte, Saisonwarnungen und Wiederaufnahme als Abschnitt „Nächste Nächte“ auf „Heute Nacht“ (S-02). Bei jedem Projektnamen steht der Ersteller mit Bild und Namen (Kurzform ab mehr als 10 Zeichen). Die Bildschirme stehen in 14.3 (S-60 … S-64).

#### Session-Auswertung (je Nacht und Rig)

| ID | Anforderung | Prio |
|---|---|---|
| FA-AUS-01 | Session-Übersicht (seit AP-64 Reiter **Nächte**, eine Karte je Nacht und Rig – mehrere Sessions einer Nacht zusammengefasst mit Hinweis „2 Sessions“, Entscheidung Sven 07.10.2026): Datum (Nacht Mittag–Mittag), Rig, Start/Ende, Status, Effizienz als Balken („8,2 von 9,6 h · 85 %“), Wetterbewertung der Nacht (Vorhersage zum Sessionbeginn) als Punkt, Projekt-Chips mit Ersteller und Frames je Filter (Transit als Serie); darüber Kennzahlen für Rig und Zeitraum (Nächte mit Session und davon nutzbar, Integration, Effizienz Ø gewichtet über die Dunkelzeit, Ungeprüft in Nächten – eine Nacht ist ungeprüft, solange eine ihrer Sessions ungeprüft ist). Nächte ohne Session erscheinen grau, wenn die Standort-Statistik sie als bewölkt führt. **Session-Status**: *läuft* → *abgeschlossen* (von NINA beendet) bzw. *abgebrochen* (Sequenz beendet ohne Planende) bzw. *verwaist* (kein Heartbeat seit 10 Minuten während *läuft* oder 2 Stunden nach dem Sessionende der letzten Planrevision – dem Nachtende – nicht beendet; die Session speichert dieses Sessionende, NT-09). Startet NINA in derselben Nacht neu, wird eine *abgebrochene* oder *verwaiste* Session wieder *läuft*; eine *abgeschlossene* Session wird nicht wieder geöffnet (NT-11). Späte Meldungen zu verwaisten oder abgeschlossenen Sessions werden übernommen und lösen eine Neuberechnung der Auswertung aus. | M |
| FA-AUS-02 | **Soll/Ist je Block**: geplantes vs. tatsächliches Zeitfenster, geplante vs. aufgenommene Frames je Filter, Status (vollständig/teilweise/übersprungen). | M |
| FA-AUS-03 | **Soll/Ist je Projekt und Filter** in der Nacht: Frames, Integrationszeit, Bonus-Frames. *Präzisierung 07.10.2026 (Entscheidung Sven):* im Session-Detail gilt Soll = erster Plan dieser Session ohne Bonus-Frames (Transit-Serie: Zeitfenster statt Anzahl), Ist = Aufnahmen dieser Session (nicht der ganzen Nacht); die Kennzahlen (FA-AUS-09) verwenden dieselben Begriffe. | M |
| FA-AUS-04 | Abweichungsgründe automatisch aus Ereignissen zugeordnet: Zentrieren fehlgeschlagen, Safety-Pause (Dauer), Transit-Unterbrechung (Dauer), Autofokus-/Flip-Zeit, Belichtung abgebrochen/fehlgeschlagen, Zeitverlust durch Zeitgeführt-Sprung, Verbindung/Gerätefehler. | S |
| FA-AUS-05 | Kennzahlen: Belichtungszeit / nutzbare Dunkelzeit (Effizienz), Overhead-Anteil (Slew, Zentrieren, AF, Flip, Dither, Download), Anzahl Blockwechsel, Anzahl Filterwechsel. | S |
| FA-AUS-06 | **Manuelle Korrektur**: Nach eigener Sichtung (außerhalb der App) kann je Zeile und Nacht eine Anzahl *verworfen* eingetragen werden (optional mit Grund: Wolken, Wind, Fokus, Satellit, Guiding, Sonstiges); sie gilt nur für Nicht-Bonus-Aufnahmen. Sind in derselben Zeile und Nacht auch einzelne Aufnahmen verworfen (FA-AUS-20), zählt **Verworfen = max(Korrektur, Anzahl einzeln verworfener)** – nichts wird doppelt abgezogen; die Eingabe zeigt die Anzahl einzeln verworfener Aufnahmen als Untergrenze. Verbleibend wird sofort neu berechnet und an NINA ausgeliefert; jede Korrektur und jedes Verwerfen markiert das Aufwand-Kennzeichen als veraltet (Neuberechnung, FA-PRJ-23). Aufnahmen gelten **ohne Bestätigung als akzeptiert** – es gibt nur das Verwerfen, keine Freigabe einzelner Nächte (NT-48). Berechtigt: Admins; User für ihre eigenen freigegebenen Objekte, wenn die Mandanteneinstellung „User dürfen eigene Aufnahmen verwerfen“ aktiv ist (Standard aus). | M |
| FA-AUS-20 | Einzelne Aufnahmen aus der Aufnahmeliste als verworfen markieren (mit Grund) bzw. zurücknehmen – auch Bonus-Aufnahmen (zählen in *Bonus verworfen*); Zähler und Aufnahmenächte werden nach der Regel in FA-AUS-06 angepasst. | S |
| FA-AUS-22 | **Nicht zugeordnete Aufnahmen**: Lights, die NINA keinem Projekt/Panel/Zeile zuordnen konnte, erscheinen im Session-Detail als eigene Liste und können von Admins manuell zugeordnet werden; erst dann zählen sie. | S |
| FA-AUS-14 | **Sitzungsprotokoll (Beobachtungsbedingungen)** je Session: Beginn/Ende, Seeing (″), Transparenz (%), SQM (mag/″²), Temperatur (°C), Luftfeuchte (%), Wind, Wetternotizen, Mondphase (automatisch), Freitext-Notizen. Zusätzlich projektbezogene Beobachtungsnotizen je Nacht (Astro PM führt das Protokoll je Projekt; wir führen es je Session und verknüpfen die in der Nacht bearbeiteten Projekte). | M |
| FA-AUS-15 | Vorbelegung des Protokolls aus drei Quellen, jeweils gekennzeichnet und überschreibbar: (a) **Vorhersage** zum Sessionbeginn (Astro-Wetter: Seeing, Transparenz, Wolken, Temperatur, Feuchte, Wind), (b) **NINA** – sofern ein Wetter-/ObservingConditions-Gerät oder SQM-Meter verbunden ist, Mittel/Min/Max über die Session, (c) **manuelle Eingabe**. | S |
| FA-AUS-16 | Auswertungen über das Protokoll: Vergleich Vorhersage vs. gemessen/beobachtet je Nacht (Treffsicherheit des Wettermodells je Standort), Verlauf SQM/Seeing über die Saison, Zusammenhang Bedingungen ↔ Verworfen-Quote. *AP-64:* im Reiter **Standort-Statistik** als Kachel „Vorhersage stimmte“ und SQM-/Seeing-Balken je Nacht; die Tabelle aller Nächte (mit Verworfen-Quote) auf Wunsch. | S |
| FA-AUS-17 | **Klarnacht-Statistik je Standort und Monat** aus den Protokollen (Anteil nutzbarer Nächte, mittlere nutzbare Stunden); Grundlage der Prognose jenseits des Vorhersagehorizonts (→ Kap. 8.5). Nächte ohne Session können mit einem Klick als „bewölkt/nicht genutzt“ erfasst werden, damit die Statistik nicht verzerrt. *AP-64:* Kalender der letzten drei Monate im Zeitraum (klar und belichtet, **klar, aber nicht genutzt** – Vorhersage gut oder besser, aber unter 1 h belichtet –, teilweise, bewölkt, keine Angabe), Klick öffnet die Nacht bzw. „bewölkt erfassen“; Kachel „Nutzbare Nächte“ (≥ 1 h belichtet) mit „davon klar, ungenutzt: n“. *Ergänzung 07.10.2026 (Entscheidung Sven, AP-64b):* Die Vorhersage einer Nacht wird je Standort gespeichert (letzte Vorhersage vor Beginn der astronomischen Dunkelheit, aus dem Astro-Wetter) – damit wird auch eine vergangene Nacht **ohne Session** „klar, aber nicht genutzt“, wenn die Vorhersage gut oder besser war, und darunter im Kalender automatisch „bewölkt“ (nur Anzeige, keine erfasste Nacht; ein manueller Eintrag überschreibt das); der Schnappschuss zum Sessionbeginn hat Vorrang. Die Treffsicherheit (FA-AUS-16) zählt weiter nur Nächte mit Session (ohne Session ist nichts beobachtet). | S |
| FA-AUS-18 | **Projektbericht** (seit AP-64 Reiter **Projekte** der Auswertung): Zeitraum und Rig aus dem gemeinsamen Filter, Filter nach Status und Objekttyp; eine Zeile je Projekt mit Ersteller, Art, belichteter Integration, Fortschritt je Filter und „Voraussichtlich fertig“ (FA-FOL-02/04); „Verlauf“ klappt Frames/Integration je Filter und Nacht, die Nächte mit Link, Kanalbalance und Bedingungen auf; druckbar (Druckansicht) und als CSV exportierbar. | S |
| FA-AUS-19 | **Nächte je Zeile** („Aufnahmenacht“): je Belichtungszeile und Nacht Anzahl aufgenommen/akzeptiert mit Quelle (NINA-Meldung, manuelle Korrektur, Import) als Grundlage für Verlauf und Bericht. | M |
| FA-AUS-21 | **Nachtbericht nach Discord** (optional): Nach Ende einer Session sendet das System einmalig eine Zusammenfassung in die Discord-Kanäle des Mandanten mit der Kategorie *Nachtbericht & Sessions* (FA-DIS-03), sofern am Rig der Schalter „Nachtbericht nach Discord“ aktiv ist (nur Admin). Inhalt: Rig, Nacht, Beginn–Ende, Status (abgeschlossen/abgebrochen/verwaist), Wetterbewertung, belichtete Stunden und Effizienz, Frames je Projekt und Filter als Soll/Ist (höchstens 10 Projekte, Rest als „+ n weitere“), Bonus-Frames, **Flats und Dark-Flats je Filter** (Ist/Soll), wichtigste Abweichungsgründe mit Dauer (Safety-Pausen, Flips, übersprungene Blöcke), Transitabdeckung mit Ampel (FA-EXO-28), fertig gewordene Projekte, Link zur Session (S-61). Versand frühestens, wenn die Session *abgeschlossen* ist, das **Ende der Dunkelheit** der letzten Planrevision (ohne Dunkelheit: deren Sessionende; Kap. 8.1) erreicht ist und das Plugin keine offenen Meldungen mehr hat, spätestens 2 h nach dem Sessionende der letzten Planrevision (dann mit Vermerk „vorläufig“; NT-09); verwaiste Sessions werden beim Schließen gemeldet. Während der Nacht keine Zwischenstände (nur die Ereignisse „Session gestartet/beendet“ und Alarme nach FA-DIS-03), keine Dateinamen. „Bericht erneut senden“ für Admins. | K |
| FA-AUS-07 | Session als „geprüft" markieren; ungeprüfte Sessions werden in der Übersicht hervorgehoben. *AP-64:* Solange eine Nacht ungeprüft ist, zeigt ihre Übersicht ein **Prüf-Banner** mit einer Prüfliste aus den Daten (Aufnahmen ohne Zuordnung → zuordnen, Zeilen mit Ist < Soll → Grund erfassen, Lücken über 10 min mit Grund → ansehen) und am Ende „Als geprüft markieren“; die Kennzahl „Ungeprüft“ der Nächte verlinkt die neueste ungeprüfte Nacht. | S |
| FA-AUS-08 | Optionale NINA-Metadaten (HFR, Sterne, Guiding-RMS) als Verlaufsgrafik über die Nacht zur Unterstützung der manuellen Korrektur. *AP-64:* HFR- und Sterne-Verlauf im Reiter *Aufnahmen* der Nacht, Punkte je Filter, Meridian-Flip als Marke, Lücken schraffiert (Guiding-RMS meldet NINA bisher nicht). | K |
| FA-AUS-09 | Plan-Treue-Vergleich: Wie viel des Simulator-Plans (Stand Sessionbeginn) wurde erreicht (% Frames, % Zeit). | S |

#### Projekt-Auswertung (über alle Nächte)

| ID | Anforderung | Prio |
|---|---|---|
| FA-AUS-10 | Fortschrittsverlauf je Filter über die Nächte (kumulierte akzeptierte Integrationszeit, Balken je Nacht) – *AP-64:* im aufgeklappten „Verlauf“ der Projekte. | M |
| FA-AUS-11 | Liste aller Sessions des Projekts mit Frames je Filter, Verworfen-Quote, Wetterbewertung – *AP-64:* als Liste der Nächte mit Link auf die Nacht. | M |
| FA-AUS-12 | Aufnahmeliste (alle Meldungen) filterbar nach Nacht/Panel/Filter/Ergebnis, exportierbar als CSV (z. B. für die Zuordnung in PixInsight). | S |
| FA-AUS-13 | Kanalbalance-Hinweis: z. B. „R und G bei 80 %, B bei 35 %" – Vorschlag, B höher zu gewichten oder Filterrotation zu nutzen. | K |

#### Folgeplanung

*Neuordnung 07.10.2026 (AP-64, Entscheidungen 3 und 5):* Restbedarf und Prognose (FA-FOL-01/02) zeigt die Auswertung unter „Projekte“ als „Voraussichtlich fertig“ bzw. Saisonwarnung; Kandidatennächte (FA-FOL-03), Saisonwarnungen mit Handlungsvorschlägen (FA-FOL-04/05) und Wiederaufnahme (FA-FOL-07) stehen als Abschnitt **„Nächste Nächte“** auf „Heute Nacht“ (S-02), wo auch „nur für die kommende Nacht“ (im Plan der Nacht) und die Nachtwahl liegen. Rechte und Aktionen (Admin) bleiben unverändert.

| ID | Anforderung | Prio |
|---|---|---|
| FA-FOL-01 | **Restbedarf** je Projekt und Filter: verbleibende Frames und Stunden (inkl. Overhead-Aufschlag). | M |
| FA-FOL-02 | **Prognose der Nächte**: benötigte Nächte = Restbedarf je Filter-Stufe ÷ typisch nutzbare Stunden je Nacht (aus Saisondiagramm, Anteil am Rig durch Konkurrenz aus der Mehrnacht-Simulation, Klarnacht-Statistik aus den Sitzungsprotokollen, FA-AUS-17). Ausgabe als Spanne (optimistisch/realistisch) und voraussichtliches Fertigstellungsdatum. | M |
| FA-FOL-03 | **Kandidatennächte** der nächsten **7** Nächte je Projekt (so weit reicht die Vorhersage, WS-13; darüber hinaus nur die Klarnacht-Quote): Tabelle aus Wetterbewertung der dunklen Stunden, nutzbarer Zeit für das Ziel je Filter-Stufe (Mond!), erwarteten Frames laut Simulation; Ampel und Sortierung nach „Nutzen". **Bekannte Einschränkung (→ FA-WET-09):** Die Wetterbewertung kennt keinen Niederschlag – eine Regennacht wird allein über die Bewölkung bewertet. Die Zeile zeigt deshalb Regenwahrscheinlichkeit und Regenmenge neben der Bewertung, ebenso das Kennzeichen „ohne Aerosol – Bewertung optimistisch“ ab Tag 5. | M |
| FA-FOL-04 | **Saisonwarnung**: Rest passt nicht mehr in die verbleibende Saison → Hinweis mit Optionen (Frames reduzieren, Priorität erhöhen, anderes Rig, Fortsetzung nächstes Jahr). | S |
| FA-FOL-05 | **Handlungsvorschläge** mit Ein-Klick-Umsetzung: Priorität anheben, Filterzeile an-/abschalten – auch **nur für die kommende Nacht** (z. B. „heute nur Schmalband – Mond 90 %“; schaltet sich am nächsten lokalen Mittag des Standorts automatisch wieder ein), Anzahl anpassen, Projekt pausieren. Jede Umsetzung erzeugt einen neuen Simulationslauf zur Kontrolle. | S |
| FA-FOL-06 | **Rig-Nachtübersicht** („Heute Nacht"): für jedes Rig Wetterbewertung, geplante Projekte, erwartete Frames – Grundlage für die Entscheidung, die Sternwarte laufen zu lassen. | M |
| FA-FOL-07 | Projekt-Wiederaufnahme im Folgejahr: Projekte mit Status *Unfertig* bzw. *Pausiert* und Restbedarf werden zu Saisonbeginn vorgeschlagen. | S |

### 6.12 Administration, Export und Einstellungen

| ID | Anforderung | Prio |
|---|---|---|
| FA-ADM-01 | Anmeldung ausschließlich über Discord (→ 6.13); die Passwortprüfung (`checkPassword`) aus der Kopie von `astro-core.js` wird nicht übernommen. | M |
| FA-ADM-02 | Verwaltung (nur Admin) der Sync-Tokens und NINA-Instanzen (anlegen – das Token wird einmal angezeigt –, benennen, Rig zuordnen, widerrufen mit Bestätigungsdialog, zuletzt gesehen); Tokens laufen nicht ab (FA-SYN-01). **Löschen** (Bestätigungsdialog) nur für Instanzen ohne Sessions und Kommandos, etwa versehentlich angelegte; alle anderen werden widerrufen und behalten ihren Verlauf. Widerrufene Instanzen sind in der Liste standardmäßig ausgeblendet (Entscheidung 25.09.2026). | M |
| FA-ADM-03 | Persönliche Einstellungen je Benutzer: Sprache (DE/EN), Einheiten (°C/°F, m/ft), Zeitanzeige (Standortzeit + eigene Zeitzone), Hell-/Dunkelmodus. | S |
| FA-ADM-04 | Vollständiger Export/Import aller fachlichen Daten **eines Mandanten** (JSON) als Backup und Umzug (nur Admin). **Nicht exportiert** werden Zugangsdaten: Discord-Webhook-URLs, Sync-Token- und Einladungs-Hashes, Anmeldesitzungen und Einladungen. Beim Import kommen Discord-Kanäle ohne Webhook-URL und deaktiviert an (die URL trägt ein Admin neu ein); Sync-Tokens, NINA-Instanzen, Sitzungen und Einladungen werden nie importiert. | S |
| FA-ADM-05 | Import von Ausrüstung/Projekten aus einer Astro-PM-Exportdatei (CSV/JSON), soweit Format bekannt. | W |
| FA-ADM-06 | Diagnoseansicht: letzte API-Aufrufe der NINA-Instanzen, Fehler, Versionsstände. | S |
| FA-ADM-07 | Quellenangaben/Lizenzen (Open-Meteo CC BY 4.0, CDS, SIMBAD, OpenNGC CC BY-SA 4.0, DSS, Pan-STARRS, 2MASS, d3-celestial usw.) sichtbar. | M |

### 6.13 Mandanten, Super User, Anmeldung und Benutzer

#### Einbindung in svenesis.org

| ID | Anforderung | Prio |
|---|---|---|
| FA-WEB-01 | Die Anwendung läuft **eigenständig** unter `https://nina-pm.svenesis.org` mit eigener Auslieferung und ohne Laufzeit-Abhängigkeit von www.svenesis.org. Gestaltung (Farben, Schrift, Karten, Kopf- und Fußzeile) folgt der Website. | M |
| FA-WEB-02 | Öffentlich (ohne Login) sind nur die Einstiegsseite mit Kurzbeschreibung und Knopf **„Mit Discord anmelden“**, die Datenschutzerklärung, die Quellen-/Lizenzseite und die Vorschau eines Einladungslinks; alle anderen Seiten und APIs erfordern eine Anmeldung. | M |
| FA-WEB-03 | **Einbindung in die Website** ausschließlich über einen Menüeintrag „Svenesis-NINA-PM“ im Dropdown *Astronomie* (Link auf `nina-pm.svenesis.org`). Die öffentlichen Astro-Tools (Astro-Wetter, Beobachtungsplaner) bleiben **exakt unverändert**; sie dienen nur als Kopiervorlage für den neuen Quellcode (Kap. 9). | M |
| FA-WEB-04 | Eigene **Datenschutzerklärung** und **Quellen-/Lizenzseite** der Anwendung (DE/EN): Anmeldung über Discord (Drittland USA), AWS, serverseitige Abrufe, CDS-Bildkacheln, Anmelde-Cookies; Impressum verweist auf die Website. Rechtliche Durchsicht vor Go-live. | M |

#### Mandanten

| ID | Anforderung | Prio |
|---|---|---|
| FA-MAN-01 | Der Super User legt Mandanten an: **Mandanten-ID** (eindeutiger Kurzname, 3–32 Zeichen, Buchstaben/Ziffern/Bindestrich, klein geschrieben; dient für Links, Einladungen und die Mandantenauswahl), Anzeigename, Kontakt, Status (aktiv/gesperrt), Anlagedatum; dabei erzeugt er einen **Einladungslink für den Owner** (FA-SU-05). | M |
| FA-MAN-02 | Super User: Mandanten sperren/entsperren; Mitglieder eines gesperrten Mandanten können ihn nach dem Login nicht auswählen, seine NINA-Instanzen erhalten keine Daten mehr (laufende Nächte laufen aus dem Cache weiter). | M |
| FA-MAN-03 | Super User: Mandanten löschen nur nach Bestätigung durch Eingabe der Mandanten-ID im Bestätigungsdialog (die einzige Aktion mit Namenseingabe, E4); ab R5 zusätzlich Export-Angebot (FA-ADM-04); alle Daten des Mandanten werden entfernt. | S |
| FA-MAN-04 | **Vollständige Datentrennung**: Jede fachliche Entität trägt die Mandanten-Zugehörigkeit; jede Abfrage, jeder Export, jede API-Antwort und jede Berechnung (Simulation, Prognose, Statistik) ist auf den Mandanten des angemeldeten Benutzers bzw. der NINA-Instanz beschränkt. | M |
| FA-MAN-05 | Mandanteneinstellungen (nur Admin): Anzeigename, Standardsprache, **Zeitzone des Mandanten** (Einstellungsschlüssel `tenantTimezone`, IANA-Name; Grundlage der Fristanzeige in 8.1), Freigabe-Regeln (→ FA-FRG-10), Discord-Server und -Kanäle (→ FA-DIS). **Sicherheitseinstellungen je Mandant gibt es nicht**: Sitzungsdauer und Discord-2FA-Regel sind systemweit fest (FA-LOG-06/07, SV-01/SV-03). Ein Mandanten-Logo ist **nicht** vorgesehen (es gäbe keinen Upload-Weg und keinen Bildschirm, der es zeigt). | S |
| FA-MAN-06 | **Keine gemeinsame Nutzung** von Standorten, Rigs, NINA-Instanzen oder Projekten zwischen Mandanten. Eine Sternwarte, die mehrere Gruppen bedient, bildet diese als User in *einem* Mandanten ab. | M |

#### Super User

| ID | Anforderung | Prio |
|---|---|---|
| FA-SU-01 | Rolle **Super User** auf Systemebene zur Verwaltung aller Mandanten; es kann mehrere Super User geben. Der erste Super User wird beim Deployment über seine **Discord-User-ID** eingerichtet (Konfigurationsparameter; er wird beim Login ausgewertet und darf danach unverändert stehen bleiben, SV-17). | M |
| FA-SU-02 | Anmeldung über Discord wie alle anderen; ist die Identität als Super User hinterlegt, steht nach dem Login der Kontext **„System“** zur Auswahl. Voraussetzung: im Discord-Konto ist die **Zwei-Faktor-Authentifizierung aktiv** (von Discord gemeldet); sonst wird der System-Kontext verweigert. | M |
| FA-SU-03 | Super-User-Verwaltung: Mandantenliste mit Mandanten-ID, Name, Status, Anzahl Admins/User, Anzahl Rigs, NINA-Instanzen (zuletzt gesehen), Speicherbedarf, letzte Anmeldung im Mandanten. | M |
| FA-SU-04 | Mandanten anlegen, bearbeiten, sperren/entsperren, löschen (→ FA-MAN-01 bis 03); Mandanten-Einstellungen vorbelegen. | M |
| FA-SU-05 | **Owner einladen** (Einladungslink mit Rolle *Owner*, 7 Tage, 1 Nutzung, optional gebunden an eine Discord-User-ID). **Owner neu zuweisen** nur im Notfall (Owner hat sein Discord-Konto verloren, ist dauerhaft nicht erreichbar oder verlässt die Gruppe ohne Übertragung): an ein aktives Mitglied des Mandanten (der Super User sieht dafür nur Anzeigenamen, Rollen und Status der Mitglieder) oder per neuer Owner-Einladung, mit Pflichtbegründung und Bestätigungsdialog; benachrichtigt werden alle Admins des Mandanten einschließlich des bisherigen Owners (und der neue Owner), der Vorgang steht im System-Audit (FA-SU-09), das die Admins des Mandanten einsehen. Der bisherige Owner wird standardmäßig **deaktiviert** (Schutz bei gestohlenem Konto); wahlweise bleibt er Admin. Darüber hinaus verwaltet der Super User keine Mitglieder; User und Admins verwaltet der Mandant selbst. Weitere Sonderregeln gegen den Super User (Pflichtbindung der Owner-Einladung an eine fremde Discord-ID, Verbot des Selbsteinlösens, Sammelmeldung an alle Admins) gibt es nicht; dass er keine fachlichen Aktionen im Mandanten ausführt, sichert FA-SU-07 (E3). | M |
| FA-SU-06 | Super User verwalten (Discord-Identität hinzufügen, deaktivieren); der letzte aktive Super User kann nicht entfernt oder deaktiviert werden (Invariante mit eigenem Fehlercode `super_user.last_protected`, serverseitig geprüft wie die Owner-Invarianten). Notfallzugang ohne Discord über das Betriebswerkzeug `ops-cli`, das der Betreiber lokal mit seinem AWS-Admin-Profil aufruft (keine Route im Web, keine eigene MFA-Rolle; Befehle u. a. Super User einrichten, Identität sperren, Anmeldesitzungen beenden, Mandant anlegen; SV-13/SV-17, → Technisches Konzept). Jeder Aufruf steht im System-Audit mit Akteur `ops-cli`. | M |
| FA-SU-07 | Super User haben **keinen Zugriff auf fachliche Inhalte** der Mandanten (Ausrüstungsdetails, Projekte, Pläne, Sessions, Aufnahmen, Ergebnisse) und können sich nicht als Benutzer eines Mandanten ausgeben. | M |
| FA-SU-08 | Systemweite Einstellungen: globale Kataloge aktualisieren (Objektkatalog ab R2, Exoplaneten-Kataloge ab R4), Wetter-Cache, Abruf-Limits, Wartungshinweis-Banner für alle Mandanten, Anzeige der Plugin-/Engine-Versionen. | S |
| FA-SU-09 | Alle Aktionen von Super Usern und des Betriebswerkzeugs `ops-cli` werden in einem **einfachen System-Audit** festgehalten (Akteur, Aktion, Ziel, Zeitpunkt; zur Nachvollziehbarkeit, nicht manipulationssicher, SV-11); Mandanten-Admins sehen Super-User-Aktionen, die ihren Mandanten betreffen. | M |

#### Discord-Anbindung je Mandant (ausgehend)

| ID | Anforderung | Prio |
|---|---|---|
| FA-DIS-01 | Je Mandant kann ein **Discord-Server** hinterlegt werden (Name, optional Server-ID und Einladungslink zur Anzeige in der App). Die Anmeldung über Discord (FA-LOG) ist davon unabhängig. | K |
| FA-DIS-02 | Zum Server legt der Admin **mehrere Kanäle** an: Name (z. B. `#freigaben`), **Webhook-URL** des Kanals (in Discord unter *Kanal bearbeiten › Integrationen › Webhooks* erzeugt), aktiv ja/nein. Die Webhook-URL wird geprüft (Format `https://discord.com/api/webhooks/…`), in der Datenbank abgelegt, nie angezeigt oder exportiert; sichtbar ist nur die Endung (nur „gesetzt“ und die letzten Zeichen). Vor jedem Senden wird die Adresse erneut geprüft; Weiterleitungen werden nicht verfolgt. | K |
| FA-DIS-03 | Jedem Kanal werden eine oder mehrere **Kategorien** zugeordnet; jede Kategorie kann in mehrere Kanäle gehen: **Freigaben & Warteschlange** (neue Einreichung, Freigabe, Rückgabe, Ablehnung, Verfall/Frist < 24 h, Änderungsantrag gestellt/entschieden); **Nachtbericht & Sessions** (Session gestartet, Session beendet/verwaist, Nachtbericht FA-AUS-21, Transit beobachtet/verpasst); **Alarme & Betrieb** (laufende Session ohne Heartbeat > 10 min, Kap. 8.1, Plugin-Fehler bzw. nicht zustellbare Meldungen, zweite NINA-Instanz am belegten Rig, Standort- oder Flip-Einstellungen weichen ab, Kanal nicht erreichbar). | K |
| FA-DIS-04 | Je Kategorie einstellbar, welche Ereignisse gesendet werden (Standard: alle) und ob Anzeigenamen von Mitgliedern genannt werden (Standard an; der Discord-Server gehört dem Mandanten). Meldungen enthalten einen Link in die App; es werden keine Dateinamen, Tokens oder Koordinaten von Standorten gesendet, und keine Erwähnungen (@everyone/@here) ausgelöst. | K |
| FA-DIS-05 | *Testnachricht senden* je Kanal; Anzeige von letzter Zustellung und letztem Fehler. Antwortet Discord dauerhaft mit „Webhook unbekannt“ (gelöscht) oder „nicht berechtigt“, wird der Kanal deaktiviert und die Admins erhalten eine Benachrichtigung in der App. Zustellungen laufen im Hintergrund mit Wiederholung; Meldungen gehen nicht verloren, wenn Discord kurz nicht erreichbar ist. | K |
| FA-DIS-06 | **Eingehende Daten aus Discord** (Meldungen anderer Werkzeuge, Befehle, Notizen) sind **nicht** Teil des Umfangs – dafür wäre ein Discord-Bot nötig (OP-25). | – |

#### Anmeldung (ausschließlich Discord)

| ID | Anforderung | Prio |
|---|---|---|
| FA-LOG-01 | Anmeldung **nur über Discord** (OAuth 2.0). Die Anwendung speichert keine Passwörter. Übernommen werden Discord-User-ID, Benutzername, Anzeigename, Avatar und die Angabe, ob 2FA aktiv ist; die E-Mail-Adresse nur, falls ausdrücklich konfiguriert. | M |
| FA-LOG-02 | **Mandantenauswahl nach dem Login**: Ist die Person Mitglied genau eines Mandanten, geht es direkt dorthin; bei mehreren erscheint eine Auswahl (zuletzt genutzter Mandant vorausgewählt); Super User sehen zusätzlich „System“. Ein Link mit Mandanten-ID (z. B. `https://nina-pm.svenesis.org/?mandant=sternwarte-xy`) wählt den Mandanten vor. Wechsel des Mandanten jederzeit über das Benutzermenü. | M |
| FA-LOG-03 | Eine Person = ein Discord-Konto = eine Identität. Mitgliedschaften (mit Rolle und Anzeigenamen) bestehen **je Mandant**; derselbe Mensch kann in Mandant A Admin und in Mandant B User sein. | M |
| FA-LOG-04 | Ohne Mitgliedschaft und ohne gültige Einladung erscheint eine neutrale Seite „Kein Zugang“ mit dem angemeldeten Discord-Namen und dem Hinweis, einen Admin um eine Einladung zu bitten. | M |
| FA-LOG-05 | Schutz vor Missbrauch: Prüfung des OAuth-`state` und PKCE (SV-02), Rate-Limit auf die Anmelde-Endpunkte, Sperren einer Identität systemweit (Super User) bzw. einer Mitgliedschaft (Admin). | M |
| FA-LOG-06 | Abmelden (beendet die Anmeldesitzung der Anwendung sofort, nicht die Discord-Sitzung); automatische Abmeldung nach **14 Tagen ohne Aktivität**, spätestens **30 Tage** nach der Anmeldung – feste Werte, nicht je Mandant einstellbar (SV-01). Danach ist eine neue Anmeldung über Discord nötig. | M |
| FA-LOG-07 | **Discord-2FA für Owner und Admins** (feste Regel ohne Mandantenschalter, SV-03): Owner- und Admin-Rechte wirken nur, wenn Discord bei der Anmeldung meldet, dass im Konto 2FA aktiv ist. Ohne 2FA erhält die Person im Mandanten nur User-Rechte (auch Owner-exklusive Aktionen ruhen) und sieht den Hinweis „Admin-Rechte ruhen, bis Discord-2FA aktiv ist – danach neu anmelden“; die Rolle selbst bleibt unverändert. Grund: Discord ist der einzige Identitätsanbieter – ohne 2FA genügt die Übernahme eines Discord-Kontos für Schreibzugriff auf alle Projekte des Mandanten. Für Super User gilt dieselbe Pflicht (FA-SU-02). | S |
| FA-LOG-08 | Übersicht **„Meine Anmeldesitzungen“** (Gerät/Browser, angemeldet seit, zuletzt aktiv) mit *Beenden* je Sitzung und „überall abmelden“ (jeweils Bestätigungsdialog); beides wirkt sofort (SV-01). | S |
| FA-LOG-09 | Ist Discord nicht erreichbar, können sich nur Personen mit noch gültiger Anmeldesitzung weiter anmelden bzw. arbeiten; NINA-Instanzen sind nicht betroffen (eigene Sync-Tokens). | M |
| FA-LOG-10 | Persönliche Anzeige im Kopf: Discord-Avatar, Anzeigename im Mandanten, Rolle, aktueller Mandant. | S |
| FA-LOG-11 | *entfällt (SV-11, 21.09.2026)* – kein eigenes Anmeldeprotokoll; die letzte Anmeldung steht in der Mitgliederliste (FA-BEN-04), laufende Anmeldesitzungen zeigt „Meine Anmeldesitzungen“ (FA-LOG-08). | – |

#### Einrichtungsablauf

1. **Erster Super User (einmalig beim Deployment):** Seine Discord-User-ID steht in der Konfiguration (SSM-Parameter `/nina-pm/bootstrap-super-users`, SV-17; der Eintrag bleibt danach einfach stehen). Er öffnet `nina-pm.svenesis.org`, klickt *Mit Discord anmelden* (Discord-2FA muss aktiv sein) und wird beim ersten Login als Super User angelegt. Weitere Super User fügt er in S-81 hinzu (FA-SU-06).
2. **Mandant anlegen:** Nach dem Login wählt der Super User den Kontext *System* → S-80 *Neuer Mandant* (Mandanten-ID, Anzeigename, Kontakt, Voreinstellungen) → *Owner-Einladung erzeugen* (optional an Discord-User-ID gebunden) → Link kopieren und z. B. per Discord-DM schicken.
3. **Owner nimmt an:** Die Person öffnet den Link, sieht die Vorschau (Mandant, Rolle *Owner*, eingeladen vom System), meldet sich mit Discord an und ist Owner des Mandanten. Ab jetzt hat der Super User keinen Einblick in fachliche Inhalte.
4. **Owner baut den Mandanten auf:** Ausrüstung, Rigs, NINA-Instanzen; lädt **User** und bei Bedarf **Admins** ein (S-70).
5. **Laufender Betrieb:** Admins laden weitere **User** ein und verwalten sie; der Owner ernennt oder entzieht Admin-Rechte und kann die Owner-Rolle an einen aktiven Admin übertragen (sofort, FA-BEN-09). Ist der Owner nicht mehr erreichbar, weist der Super User in S-80 einen neuen Owner zu (FA-SU-05); ist auch die Discord-Anmeldung nicht nutzbar, hilft der Betreiber mit `ops-cli` (FA-SU-06).

#### Benutzerverwaltung (Owner und Admin)

| ID | Anforderung | Prio |
|---|---|---|
| FA-BEN-01 | Benutzer **einladen**: Admins erzeugen Einladungslinks mit Rolle **User**; Einladungen mit Rolle **Admin** erzeugt nur der Owner. Einladungslink mit Rolle, Gültigkeit (Standard 7 Tage), Anzahl Nutzungen (Standard 1) und optional gebunden an eine bestimmte Discord-User-ID. Der Link wird über beliebige Kanäle (z. B. Discord-DM) geteilt; beim Öffnen meldet sich die Person mit Discord an und wird Mitglied. Einladungen sind einsehbar und widerrufbar. | M |
| FA-BEN-02 | Mitglieder bearbeiten (Anzeigename im Mandanten), deaktivieren (Zugang gesperrt, Daten bleiben), reaktivieren, entfernen – Admins nur Mitglieder mit Rolle User, der Owner alle außer sich selbst. Folgen für Objekte, Rang und Stimmen → FA-BEN-11. | M |
| FA-BEN-03 | Je Mandant gibt es **genau einen Owner**, der zugleich aktiver Admin ist; damit besteht stets mindestens ein handlungsfähiger Admin. Ausnahme: Solange die Owner-Einladung des Super Users offen ist (FA-SU-05), hat der Mandant noch keinen Owner (Anzeige „Owner ausstehend“ in S-80, kein eigener Zustand am Mandanten); in dieser Zeit kann niemand im Mandanten Rollen vergeben. Verfällt die Einladung, kann der Super User eine neue senden. Hat der Mandant bereits einen Owner, wird eine Owner-Einladung beim Einlösen abgelehnt; einen Owner ersetzt nur die Neuzuweisung durch den Super User (FA-SU-05). | M |
| FA-BEN-04 | Mitgliederliste mit Discord-Avatar und -Name, Anzeigename, Rolle (Kennzeichen **Owner**; bei Owner/Admin ohne 2FA Hinweis „Rechte ruhen – 2FA fehlt“, FA-LOG-07), Status, 2FA aktiv ja/nein, letzter Anmeldung, Anzahl eigener Objekte (Entwurf/eingereicht/freigegeben); Liste offener Einladungen. | S |
| FA-BEN-05 | Optional: Rig-Beschränkung je User (User darf nur für bestimmte Rigs einreichen). | K |
| FA-BEN-06 | **Owner**: Jeder Mandant hat genau einen Owner (die Person, die die Owner-Einladung des Super Users angenommen hat). Er hat alle Admin-Rechte und **exklusiv**: Admin-Rechte vergeben und entziehen, Admin-Einladungen erzeugen, Admins deaktivieren/entfernen, Owner übertragen (FA-BEN-09), Löschung des Mandanten beim Super User beantragen. Admin-Rechte vergibt der Owner **unbefristet**, wahlweise mit Grund (optional; gespeichert im Änderungsprotokoll zusammen mit dem Mitglied, das die Rolle vergeben hat); Vergabe und Entzug (Entzug mit Bestätigungsdialog) wirken sofort, auch in laufenden Anmeldesitzungen (SV-01); offene Freigabe-Entscheidungen und angefangene Bearbeitungen eines ehemaligen Admins bleiben als Verlauf erhalten. Sicherheitseinstellungen je Mandant gibt es nicht (FA-MAN-05). Owner-Rechte wirken nur mit Discord-2FA (FA-LOG-07). | M |
| FA-BEN-07 | *entfällt (E2, 21.09.2026)* – befristete Admin-Rechte (mit Ablauf, Vorwarnung und Verlängerung) gibt es nicht mehr; Admin-Rechte vergibt und entzieht der Owner unbefristet (FA-BEN-06). | – |
| FA-BEN-08 | **Schutz des Owners und der Admin-Verwaltung**: Kein Admin kann den Owner herabstufen, deaktivieren, entfernen, dessen Anmeldesitzungen beenden oder dessen Anzeigenamen ändern; kein Admin kann Admin-Rechte vergeben oder entziehen – auch nicht sich selbst oder anderen Admins –, keine Admin-Einladungen erzeugen und keine Einladungen des Owners widerrufen. Niemand ändert seine eigene Rolle (`member.cannot_change_self`); der Owner kann nicht herabgestuft, deaktiviert oder entfernt werden (`member.owner_protected`) und den Mandanten nicht verlassen, solange er Owner ist (`member.owner_cannot_leave`) – vorher überträgt er (FA-BEN-09). Alle Rollen- und Statusänderungen stehen im Änderungsprotokoll (S-72) und werden dem Owner gemeldet. Die Regeln gelten serverseitig (FA-BER-01). | M |
| FA-BEN-09 | **Owner übertragen** (E2): nur an ein **aktives Mitglied mit Admin-Rolle**; der Owner wählt es in S-70 aus und bestätigt im Bestätigungsdialog („Owner-Rolle an … übertragen? Du bleibst Admin.“). Die Übertragung wirkt **sofort**: der Empfänger ist Owner, der bisherige Owner Admin. Es gibt keine Annahme durch den Empfänger, keine Frist und keinen Widerruf; rückgängig macht sie nur eine erneute Übertragung durch den neuen Owner. Ist das Ziel kein aktiver Admin (mehr), wird die Übertragung mit `owner_transfer.target_invalid` abgelehnt. Beide erhalten eine Benachrichtigung; der Vorgang steht im Änderungsprotokoll. Hat der Empfänger keine Discord-2FA, weist der Dialog darauf hin, dass seine Owner-Rechte erst mit 2FA wirken (FA-LOG-07). Notfall ohne erreichbaren Owner → Super User (FA-SU-05). | M |
| FA-BEN-10 | **Mandant verlassen**: Jedes Mitglied außer dem Owner kann seine Mitgliedschaft selbst beenden (Wirkung wie „entfernen“, FA-BEN-02). | S |
| FA-BEN-11 | **Folgen für Objekte beim Deaktivieren/Entfernen/Verlassen**: *Entwurf* und *Zurückgegeben* – bei Deaktivierung unverändert (nur Admins sehen sie), beim Entfernen gelöscht (weich, wiederherstellbar in „Gelöscht“, FA-PRJ-15); *Eingereicht* – bleibt bei Deaktivierung und Entfernen mit Vermerk „ehemaliges Mitglied“ in der Warteschlange, bis ein Admin es übernimmt (einem Mitglied zuordnet), freigibt oder ablehnt; offene *Änderungsanträge* – beim Entfernen zurückgezogen; *Freigegeben* – bleibt mit Vermerk „ehemaliges Mitglied“; Rangfolge entfällt; **Stimmen** deaktivierter Mitglieder ruhen – sie bleiben gespeichert, **zählen aber nicht** in Anzahl und Sortierung der Warteschlange und werden erst mit der Reaktivierung wieder wirksam; Stimmen entfernter Mitglieder werden gelöscht. Admins können Objekte ehemaliger Mitglieder einem anderen Mitglied zuordnen. | M |

### 6.14 Rollen, Berechtigungen und Freigabe-Warteschlange

#### Berechtigungsmatrix

Legende: **✔** = voll, **E** = nur eigene Objekte, **L** = lesen, **–** = kein Zugriff. Der **Super User** hat auf alle fachlichen Funktionen dieser Tabelle keinen Zugriff (→ FA-SU-07). Owner- und Admin-Rechte wirken nur mit Discord-2FA; ohne 2FA gilt die Spalte *User* (FA-LOG-07).

| Bereich / Funktion | Admin (Owner = Admin + „Nur Owner“-Zeile) | User |
|---|---|---|
| Standorte, Teleskope, Kameras, Filter, Rigs | ✔ | L |
| Belichtungsplan-Vorlagen, Mondprofile | ✔ | L (anwenden auf eigene Objekte ✔) |
| Framing, Sternkarte, Objektbrowser, Zielvorschläge, Sichtbarkeit, Wetter | ✔ | ✔ (reine Ansicht/Recherche) |
| Projekt (Deep-Sky) anlegen, bearbeiten, löschen | ✔ alle | E (nur im Freigabestatus *Entwurf* oder *Zurückgegeben*) |
| Gelöschte Projekte ansehen und wiederherstellen (Ansicht „Gelöscht“, FA-PRJ-15) | ✔ | – |
| Exoplaneten suchen, Exoplaneten-Projekt anlegen, Transit-Datum wählen | ✔ alle | E (vor Freigabe als Wunsch; nach Freigabe weitere Transits des eigenen Projekts selbst festlegen, FA-EXO-18) |
| Objekt in Warteschlange einreichen / zurückziehen | ✔ | E |
| Rangfolge der eigenen eingereichten Objekte festlegen | ✔ (eigene) | E |
| Warteschlange ansehen (alle eingereichten Objekte und offenen Änderungsanträge, Stimmen mit Namen, Rang) | ✔ | L |
| Abstimmen (eine Stimme je Objekt, nicht für eigene) | ✔ | ✔ |
| Warteschlange bearbeiten: freigeben, zurückgeben, ablehnen | ✔ (nicht eigene Objekte, FA-FRG-10) | – |
| Projektstatus (Aktiv, Pausiert, Abgeschlossen …), Priorität, Rig-Zuordnung freigegebener Projekte | ✔ | L |
| Scheduler-Einstellungen je Rig | ✔ | L |
| Nacht-Simulator ausführen | ✔ | ✔ (ohne Speichern von Einstellungen; inkl. Vorschau mit eigenen Entwürfen und eingereichten Objekten) |
| NINA-Instanzen, Sync-Tokens, Diagnose | ✔ | – (Status der Instanzen L) |
| Sessions, Aufnahmen, Auswertung, Prognose, Kandidatennächte | ✔ | L |
| Manuelle Korrektur (verworfen), Session „geprüft“ | ✔ | L (Korrektur an eigenen Objekten, wenn Mandanteneinstellung aktiv, FA-AUS-06) |
| Sitzungsprotokoll bearbeiten | ✔ | L |
| Transit-Ergebnisse (HOPS/EXOTIC) importieren | ✔ | E (für Transit-Beobachtungen eigener, freigegebener Exoplaneten-Objekte) |
| Notizen an Projekten | ✔ | E (an eigenen Objekten) |
| Favoriten, persönliche Einstellungen, eigene Anmeldesitzungen | ✔ | ✔ (persönlich) |
| User einladen, Mitglieder mit Rolle User bearbeiten/deaktivieren/entfernen, Mandanteneinstellungen, Änderungsprotokoll | ✔ | – |
| **Nur Owner:** Admin-Rechte vergeben und entziehen, Admin-Einladungen, Admins deaktivieren/entfernen, Owner übertragen (FA-BEN-06 ff.) | ✔ nur Owner | – |
| Mandant verlassen | ✔ (nicht Owner) | ✔ |
| Mandanten anlegen/sperren/löschen; Owner einladen bzw. im Notfall neu zuweisen | – (nur Super User) | – |
| Export/Import des Mandanten | ✔ | – (CSV-Exporte von Listen L ✔) |

| ID | Anforderung | Prio |
|---|---|---|
| FA-BER-01 | Die Berechtigungen gelten serverseitig für jede Aktion und jede API; die Oberfläche blendet nicht erlaubte Aktionen aus bzw. zeigt sie deaktiviert mit Hinweis. | M |
| FA-BER-02 | User sehen alle Objekte des Mandanten (auch die anderer User und der Admins) lesend, einschließlich Freigabestatus, Warteschlange, Stimmen und Rang beim Einreicher; **Entwürfe anderer User sind für User nicht sichtbar**. **Admins sehen alle Entwürfe** aller User (Liste „Entwürfe“, getrennt von der Warteschlange) und dürfen sie bearbeiten; Änderungen des Admins an einem Entwurf werden dem User im Verlauf angezeigt. | M |
| FA-BER-03 | Jede Änderung wird mit Benutzer und Zeitpunkt protokolliert (Änderungsverlauf je Projekt). | M |

#### Freigabestatus eines Objekts

```
                 einreichen                     freigeben (Admin)
 ┌─────────┐ ─────────────────▶ ┌─────────────┐ ─────────────────▶ ┌─────────────┐
 │ Entwurf │                    │ Eingereicht │                    │ Freigegeben │──▶ Projektstatus
 └─────────┘ ◀───────────────── └─────────────┘                    └─────────────┘    Planung/Aktiv/…
      ▲        zurückziehen        │        │                             │
      │        (User)              │        │ ablehnen (Admin)            │ Änderungsantrag (User)
      │                            │        ▼                             ▼
      │  überarbeiten,  zurückgeben│   ┌───────────┐              in Warteschlange; freigegebene
      │  erneut einr.   (Admin) /  │   │ Abgelehnt │              Fassung bleibt aktiv
 ┌───────────────┐  Frist verpasst │   └───────────┘
 │ Zurückgegeben │ ◀───────────────┘
 └───────────────┘
```

*Zurückgegeben* verhält sich wie *Entwurf*: der User überarbeitet und reicht direkt erneut ein (→ *Eingereicht*).

| ID | Anforderung | Prio |
|---|---|---|
| FA-FRG-01 | Objekte starten im Freigabestatus **Entwurf** (User und Admins, FA-PRJ-18) und sind für Scheduler und NINA unsichtbar; Entwürfe von Usern sind sichtbar nur für den Ersteller und die Admins (→ FA-BER-02). Ein freigegebenes Objekt kehrt nie in den Entwurf zurück; es kann pausiert, archiviert oder über einen Änderungsantrag geändert werden. | M |
| FA-FRG-02 | **Einreichen**: Pflichtprüfung (Koordinaten, Belichtungsplan mit mind. einer aktiven Zeile, Rig-Wunsch; bei Exoplaneten gewünschtes Transit-Datum); Angaben zum Wunsch: Rig, gewünschter Zeitraum/Nächte, Begründung/Kommentar; das Objekt wird am Ende der persönlichen Rangfolge eingeordnet (FA-FRG-15). Status → **Eingereicht**, Objekt ist für den User nicht mehr bearbeitbar. | M |
| FA-FRG-03 | **Zurückziehen**: Solange *Eingereicht*, kann der User die Einreichung zurückziehen → *Entwurf*. | M |
| FA-FRG-04 | **Warteschlange** – sichtbar für **alle Mitglieder** des Mandanten, Aktionen nur für Admins: alle eingereichten Objekte und offenen Änderungsanträge (ab R3) sowie Transit-Bestätigungen (ab R4) mit Einreicher, Einreichungszeit, Objekttyp, Rig-Wunsch, Zeitraum, **Stimmen** (Anzahl und Namen), **Rang beim Einreicher** („2 von 3“), **Plan** als Filter-Chips in Filterfarbe je aktiver Zeile („Ha 40 × 300 s“, bei Mosaik mit Panelanzahl, bei Exoplaneten Transit-Zeile mit Fenster), geschätztem Zeitbedarf (Stunden), **Aufwand-Kennzeichen** (FA-PRJ-23), Sichtbarkeit in den nächsten Wochen (ab R2), bei Exoplaneten Transitzeit und **Frist** (ab R4, → FA-FRG-09); abgelaufener Wunschzeitraum wird markiert. Sortierung Standard: Fristen < 24 h zuerst, dann Stimmen absteigend, dann Rang beim Einreicher, dann Einreichungszeit; jede Spalte ist umsortierbar. | M |
| FA-FRG-05 | **Auswirkungsvorschau** vor der Freigabe: Mehrnacht-Simulation des Rigs mit und ohne das Objekt; Anzeige, welchen Anteil es erhält und wie sich Prognosen/Fertigstellungsdaten anderer Projekte verschieben; bei Exoplaneten, welche regulären Blöcke verdrängt werden. | S |
| FA-FRG-06 | **Freigeben** (Admin): Rig bestätigen oder ändern, Priorität/Position festlegen, Belichtungsplan und Bedingungen bei Bedarf anpassen (Änderungen werden dem User angezeigt), Projektstatus festlegen (*Planung* oder *Aktiv*), optional Kommentar. Status → **Freigegeben**; aktive Objekte gehen beim nächsten Planaufbau an NINA. | M |
| FA-FRG-07 | **Zurückgeben** (Admin) mit Pflichtkommentar → *Zurückgegeben*; der User kann überarbeiten und erneut einreichen. **Ablehnen** (Admin) mit Pflichtkommentar im Bestätigungsdialog → *Abgelehnt* (endgültig, User kann das Objekt duplizieren). | M |
| FA-FRG-08 | **Änderungen nach Freigabe**: Freigegebene Objekte bearbeitet nur der Admin (Ausnahme: Ersteller legt Transits fest, FA-EXO-18). Ein User kann für sein freigegebenes Objekt einen **Änderungsantrag** stellen (z. B. mehr Frames, weiterer Filter); die freigegebene Fassung bleibt bis zur Entscheidung aktiv, der Antrag erscheint in der Warteschlange mit Gegenüberstellung alt/neu. **Zustände**: *offen* → *angenommen* / *abgelehnt* (Admin, Kommentar) bzw. *zurückgezogen* (Antragsteller). Solange offen, kann der Antragsteller ihn bearbeiten, der Admin ebenfalls (FA-FRG-14). **Gleichzeitige Änderungen**: Der Änderungsantrag führt eine eigene Version; wer mit veralteter Version speichert, erhält einen Konflikthinweis und sieht die Änderung des anderen, bevor er erneut speichert (wie bei Projekten, 8.10). Wurde das Objekt seit Antragstellung geändert, zeigt die Entscheidung den Unterschied zur **aktuellen** Fassung; angenommen werden nur die im Antrag geänderten Felder. | S |
| FA-FRG-09 | **Exoplaneten-Fristen** (ab R4): Frist = Fenster-Beginn − Vorlauf (Slew/Zentrieren, Rig-Overhead) − 15 Minuten (Aktualisierungsintervall, FA-SYN-03). Eingereichte Exoplaneten-Objekte und zu bestätigende Transit-Festlegungen (FA-EXO-18), die bis dahin nicht freigegeben bzw. bestätigt sind, verfallen automatisch (Objekt *Zurückgegeben* mit Vermerk „Frist verpasst“, Beobachtung *storniert*, Benachrichtigung) und schlagen den nächsten beobachtbaren Transit vor. Warteschlange hebt Fristen < 24 h hervor. | M |
| FA-FRG-10 | Mandanteneinstellung „Admin-Objekte ohne Warteschlange“ (Standard an). Ist sie aus, durchlaufen auch Admin-Objekte die Warteschlange; **eigene Objekte darf ein Admin nicht selbst freigeben** – das tut ein anderer Admin oder der Owner; gibt es nur einen Admin (den Owner), gibt er seine Objekte ohne Warteschlange frei. Optional: Höchstzahl gleichzeitig eingereichter bzw. aktiver Objekte je User. | S / K |
| FA-FRG-11 | **Benachrichtigungen in der Anwendung** (Glocke mit Zähler, **ab R1**): Admins bei neuer Einreichung/Änderungsantrag/Transit-Bestätigung/nahender Frist; User bei Freigabe, Rückgabe, Ablehnung, Verfall, Fertigstellung, Admin-Änderung des eigenen Objekts; Owner und Betroffene bei Rollen- und Owner-Ereignissen (FA-BEN-06/08/09, FA-SU-05; Ablauf- und Vorwarnmeldungen zu Rollen gibt es nicht, E2). **Betriebsalarme** an Admins **ab R1**: laufende Session ohne Heartbeat > 10 min, nicht zustellbare Plugin-Meldungen, zweite NINA-Instanz am belegten Rig (Art `alert.rig_busy`), Flip-/Standortabweichung, verwaiste Session. Zusätzlich optional in die Discord-Kanäle des Mandanten (FA-DIS-01 ff., R6). | M / K |
| FA-FRG-12 | Freigabe-Verlauf je Objekt (wer hat wann eingereicht, geändert, freigegeben, zurückgegeben, mit Kommentaren). | M |
| FA-FRG-13 | Eigene Objekte für User: Projektliste mit Schalter *Meine* und Status-Chips (Anzahl je Status), Kommentar der Freigabe bei zurückgegebenen/abgelehnten Objekten, *Einreichen* im Zeilenmenü; Rangfolge und Stimmen der eingereichten Objekte in der Warteschlange unter *Meine Rangfolge* (bis 30.09.2026 eigene Ansicht „Meine Objekte“). | M |
| FA-FRG-14 | **Abstimmen**: Jedes Mitglied (User und Admin) hat für jedes Objekt im Status *Eingereicht* und jeden offenen Änderungsantrag **eine Stimme** („Daumen hoch“), jederzeit zurücknehmbar; für eigene Objekte ist keine Stimme möglich. Alle Mitglieder sehen Anzahl und Namen (Anzeigename im Mandanten) der Abstimmenden. Wird ein Objekt zurückgezogen oder zurückgegeben, ruhen die Stimmen und zählen bei erneuter Einreichung wieder; die Abstimmenden erhalten dann den Hinweis „überarbeitet“. Ändert ein Admin ein eingereichtes Objekt oder einen offenen Änderungsantrag inhaltlich (Plan, Bedingungen, Koordinaten/Panels, Rig-Wunsch, Zeitraum, Transit-Datum), ohne zu entscheiden, wird der **Einreicher benachrichtigt** (mit Gegenüberstellung alt/neu im Verlauf) und alle, die vorher abgestimmt haben, sehen bei ihrer Stimme **„geändert seit deiner Stimme“** mit Link auf die Änderung; ihre Stimme bleibt bestehen und kann zurückgenommen werden. Der Hinweis verschwindet, sobald die Person das Objekt erneut geöffnet oder erneut bestätigt hat. Mit Freigabe oder Ablehnung wird die Abstimmung geschlossen; der Endstand (Anzahl, Namen) steht im Freigabe-Verlauf. Beim Verfall (FA-FRG-09) ruhen die Stimmen wie beim Zurückgeben. Für Stimmen deaktivierter und entfernter Mitglieder gilt FA-BEN-11. Die Warteschlange zeigt Stimmen als Anzahl und Namen; der Hinweis „überarbeitet“ erscheint auch nach erneuter Einreichung durch den Ersteller. | M |
| FA-FRG-15 | **Rangfolge des Einreichers**: Jeder User ordnet seine eingereichten Objekte (und offenen Änderungsanträge) per Ziehen in der Warteschlange (*Meine Rangfolge*) nach Wichtigkeit (1 = am wichtigsten). Neue Einreichungen kommen ans Ende; beim Zurückziehen, Freigeben, Zurückgeben oder Ablehnen rücken die übrigen nach. Der Rang ist eine Wunschangabe; eine Stufe „niedrig/normal/hoch“ gibt es nicht. | M |
| FA-FRG-16 | **Entscheidung bleibt beim Admin**: Stimmen und Rang ordnen die Warteschlange, planen aber nichts automatisch. Bei der Freigabe schlägt das System für die Rig-Priorität (FA-PRJ-13) eine Einfügeposition vor, die sich nach den Stimmen richtet; der Admin übernimmt oder ändert sie. Stimmen spielen nach der Freigabe keine Rolle mehr. | S |

## 7. Fachliches Datenmodell

### 7.1 Übersicht

```
Identität (Discord-Konto) ──0:1── SuperUser ──verwaltet── Mandant
Identität ──1:n── Mitgliedschaft (= Benutzer im Mandanten, Rolle Admin/User) ──n:1── Mandant
Mandant ──1:n── Einladung
   │
   ├──1:n── Standort ──1:n── KlarnachtStatistik (abgeleitet)
   ├──1:n── Teleskop ──1:n── Filter (optional zugeordnet)
   ├──1:n── Kamera ──1:n── GainModus, Auslesemodus
   ├──1:n── Mondprofil
   ├──1:n── BelichtungsplanVorlage ──1:n── VorlagenZeile
   │
   └──1:n── Rig (Standort + Teleskop + Kamera)
              ├──1:1── SchedulerEinstellungen
              ├──1:n── NinaInstanz (Sync-Token, je Instanz genau ein Rig)
              ├──1:n── Projekt ──1:n── Panel ──1:n── Belichtungszeile
              │                                           │
              ├──1:n── Nachtplan ──1:n── Block ──1:n── PlanEintrag
              │
              └──1:n── Session ──1:1── Sitzungsprotokoll
                          ├──1:n── Aufnahme ─────n:1──┘ (Belichtungszeile)
                          ├──1:n── SessionEreignis
                          ├──1:n── FlatKombination (Filter, Rotatorwinkel, Gain, Offset, Binning, Auslesemodus, Belichtungszeit, Flats/Dark-Flats Soll/Ist, Zielliste)
                          └──1:n── Korrektur (verworfen)

ExoKatalogEintrag (global) ──0:n── Projekt (Typ Exoplanet) ──1:n── Ephemeride (Historie)
                              └──1:n── TransitBeobachtung ──0:1── TransitErgebnis
Projekt ──1:n── Freigabeereignis / Änderungsantrag (Benutzer, Kommentar), Projektnotiz, Änderungsverlauf
Standort ──1:n── Remote-Verbindung (Link, ohne Passwort)
Belichtungszeile ──1:n── Aufnahmenacht (Zähler je Nacht und Quelle)
Identität ──1:n── Anmeldesitzung · SystemAudit (Super-User-/Betriebsaktionen)
Benutzer ──1:n── Projekt (Ersteller), Benachrichtigung

Global (mandantenübergreifend): Objektkatalog, ExoKatalogEintrag, Sternkatalog, WetterCache (je Koordinate)
Alle übrigen Entitäten tragen die Mandanten-ID.
```

> Das physische Datenbankschema für Aurora DSQL steht im **Technischen Konzept (Kapitel „Datenbank“)** und als Datei `schema_aurora_dsql.sql`. Die folgende Übersicht bleibt die fachliche Sicht.

### 7.2 Wesentliche Entitäten

| Entität | Wichtige Attribute |
|---|---|
| **Identität** | Discord-User-ID (eindeutig), Discord-Benutzername, Anzeigename, Avatar, 2FA aktiv, Status, letzte Anmeldung |
| **SuperUser** | Identität, Status, angelegt von |
| **Discord-Kanal** | Mandant, Name, Webhook (in der Datenbank abgelegt, nie angezeigt oder exportiert, nur die Endung sichtbar; nach Import leer und Kanal deaktiviert), Kategorien, Ereignisfilter, aktiv, letzte Zustellung, letzter Fehler |
| **Einladung** | Mandant, Token-Hash, Rolle (Owner/Admin/User), optional Discord-User-ID, max. Nutzungen, genutzt, gültig bis, widerrufen |
| **Anmeldesitzung** | Identität, Mandant/Kontext, Sitzungskennung (nur als Hash gespeichert), Gerät, angemeldet seit, zuletzt aktiv; läuft nach 14 Tagen ohne Aktivität bzw. spätestens nach 30 Tagen ab; Abmelden/Beenden löscht sie (SV-01) |
| **SystemAudit** | Zeitpunkt, Akteur (Super User oder `ops-cli`), Aktion, betroffener Mandant/Benutzer, Details |
| **Mandant** | Mandanten-ID (eindeutiger Kurzname), Anzeigename, Kontakt, Status, Owner (leer, solange die Owner-Einladung offen ist), Discord-Server (Name, Server-ID, Einladungslink), Einstellungen (Sprache, Zeitzone, Freigabe-Regeln, automatische Rückkehr nach *Aktiv*, User dürfen eigene Aufnahmen verwerfen, Transit-Festlegung bestätigen lassen, max. offene Transit-Festlegungen, automatischer Wechsel auf *Bereit zur Bearbeitung*) |
| **Benutzer (Mitgliedschaft)** | Mandant, Identität, Anzeigename im Mandanten, Rolle (Admin/User; Owner über Mandant), Rolle vergeben von und Grund (aus dem Änderungsprotokoll; Grund optional), Status (aktiv/deaktiviert/entfernt), eingeladen von, letzte Anmeldung, persönliche Einstellungen, Favoriten |
| **Freigabeereignis** | Projekt, Aktion (eingereicht/zurückgezogen/freigegeben/zurückgegeben/abgelehnt/verfallen/vom Admin geändert), Benutzer, Zeitpunkt, Kommentar, Wunschangaben (Rig, Zeitraum), Rang, Endstand der Stimmen, Änderungen (alt/neu) |
| **Änderungsantrag** | Projekt, Antragsteller, vorgeschlagene Fassung (Plan/Bedingungen), Rang beim Einreicher, Status, Entscheidung, Kommentar, Endstand der Stimmen |
| **Stimme** | Gegenstand (eingereichtes Projekt oder Änderungsantrag), Mitglied, Zeitpunkt, zuletzt gesehener Stand; höchstens eine je Mitglied und Gegenstand |
| **Benachrichtigung** | Mandant, Empfänger, Typ, Objekt, gelesen |
| **Standort** | Name, Pier, Typ, Breite, Länge, Höhe, Bortle, Zeitzone |
| **Teleskop** | Name, Hersteller, Modell, Bauart, Öffnung, Brennweite, Reducer-Faktor, Obstruktion |
| **Kamera** | Name, Sensor, px B/H, Pixelgröße, Bittiefe, gekühlt, Kühl-Soll und Toleranz (NT-E2), OSC, Std-Gain/Offset/Binning/Auslesemodus, e⁻/ADU, RN, FW, QE, Dunkelstrom, unterstützte Binning-Stufen, von NINA gemeldete Auslesemodi |
| **Filter** | Langname, Kurzname (Anzeige-/Planungsschlüssel), Typ, photometrisches Band (NT-41), Bandbreite, CWL, Farbe, Std-Belichtung, Std-Mondprofil, Teleskop (nur Übersicht, NT-43) |
| **Mondprofil** | Name, eingebaut, Abstand, Breite, Relax, MinAlt, MaxAlt, MaxBeleuchtung, Mond muss unter dem Horizont sein |
| **Rig** | Name, Standort, Teleskop, Kamera, in Framing/Simulator anzeigen, Standard-Vorlage, Standard-Rotation (ohne Rotator: Kamerawinkel), Rotator vorhanden, Rotationstoleranz, bei Abweichung überspringen, Filterradbelegung (je Platz Filter, NINA-Filtername, bestätigt am/von – NT-E1), Flat-Quelle (Panel/Himmel), An NINA ausliefern, Nachtbericht nach Discord, Session-Reservierung, Notizen |
| **SchedulerEinstellungen** | Strategie (proportional/manuelle Priorität), Wiedergabemodus (zeitgeführt/sequenziell), Sortierkette, Bonus an + Überschuss %, Mosaik-Panels getrennt planen, Dither an + alle N, Filterwechsel an + alle N + Toleranz, Flats an + Anzahl je Kombination, Dark-Flats an + Anzahl, vollständiger Flat-Satz, Meridian-Flip (aktiv, Minuten nach Meridian, maximal, Pause vor Meridian, Dauer – wie im NINA-Profil), Overhead-Annahmen |
| **Projekt** | Name, Ersteller, Freigabestatus, Projektstatus (erst nach Freigabe), Wunsch-Rig, Wunschzeitraum, Rang beim Einreicher, Rig, Projekttyp (Deep-Sky/Exoplanet), Objekttyp, Katalognamen, Beschreibung, Favorit, Notizen (Verlauf), Priorität, MinHöhe, MinZeit, Dämmerung, Projekt-Mondwerte, Startdatum, Zieltermin, Vorschaubild, Aufwand-Kennzeichen (berechnet), bei Exoplaneten Puffer k, Autofokus im Fenster erlaubt, Zentrieren nach Drift erlaubt; gelöscht am (weiches Löschen, Ansicht „Gelöscht“, FA-PRJ-15) |
| **Panel** | Nr./Reihenfolge, RA, Dec, Rotation, gelöscht am (nur Panels mit Aufnahmen, FA-PRJ-06) |
| **Belichtungszeile** | Filter, Belichtung s, Geplant, Gain, Offset, Binning, Auslesemodus, Mondprofil-Referenz, aktiv, nur heute aus (Nacht), gelöscht am (nur Zeilen mit Aufnahmen, FA-PRJ-07); *abgeleitet*: Aufgenommen, Verworfen, Akzeptiert, Verbleibend, Planungsbedarf, Bonus |
| **Nachtplan** | Rig, Nacht, Session (optional), Revision und Anlass (Start/Aktualisierung/Wiederaufnahme/Zurücksetzen), Engine-Version, Eingabe-Hash, erzeugt von (Server/Plugin offline/Simulator/Prognose), Zeitstempel |
| **Block** | Projekt, Panel, Start, Ende, geplante Frames je Zeile, Meridian-Info |
| **PlanEintrag** | Zeit, Typ (Slew/Center/Filter/Belichtung/Dither), Zeile, Bonus |
| **Session** | Rig, NinaInstanz, Nacht, Nachtpläne (1:n, Revisionen), Start, Ende, Sessionende laut letzter Planrevision (NT-09), Status (läuft/abgeschlossen/abgebrochen/verwaist), letzter Heartbeat, Bedingungen aus NINA, geprüft |
| **Sitzungsprotokoll** | Session, Seeing, Transparenz, SQM, Temperatur, Feuchte, Wind, Wolken/Unterbrechungen, Mondphase, Notizen; je Wert Quelle (Vorhersage/NINA/manuell) |
| **Aufnahme** | ID (idempotent), Session, Block, Aufnahmetyp (Light/Flat/Dark-Flat), Zeile bzw. „nicht zugeordnet“ (Lights), Zielliste (Flats/Dark-Flats), Transit-Beobachtung, Filter-Kurzname und tatsächlicher Filter, Zeit (Belichtungsbeginn und -mitte), Filter, Belichtung, Einstellungen, Temperaturabweichung, Einstellungen abweichend, Rotation, Pier-Seite, Rotatorwinkel, Ergebnis, Bonus, verworfen (+Grund), Dateiname, optionale NINA-Metriken |
| **SessionEreignis** | Zeit, Typ, Block, Dauer, Text |
| **Korrektur** | Zeile, Nacht, Anzahl verworfen, Grund, Zeitpunkt |
| **NinaInstanz** | Mandant, Name, Token-Hash, Rig, zuletzt gesehen, Plugin-Version, Profil-Standort, Zustand |
| **ExoKatalogEintrag** | Planet, Stern, Katalog, Disposition, RA/Dec, Helligkeiten (V/R/G/T), Teff, T₀ (BJD_TDB) ± σ, Periode ± σ, Tiefe, Dauer, Rp/R★, a/R★, Inklination, ExoClock-Priorität, O−C, Abrufdatum |
| **Ephemeride** | Projekt, T₀ (BJD_TDB) ± σ, P ± σ, Dauer, Quelle/Katalog, Stand, aktiv |
| **TransitBeobachtung** | Projekt, Epoche n, Ingress/Mitte/Egress (UTC), Fenster-Beginn/-Ende, Baseline vor/nach, Puffer, Session, festgelegt von, Status (gewünscht/festgelegt/beobachtet/verpasst/storniert), Zähler (geplant/aufgenommen/verworfen), Abdeckungskennzahlen |
| **TransitErgebnis** | Beobachtung, Format (HOPS/EXOTIC), Datei, Grafik, Rp/R★ ± σ, Tiefe, Tc ± σ, Epoche, O−C, Streuung ppt, red. χ², Autokorrelation, Shapiro, Ausreißer, einreichungsfähig |

---

## 8. Fachliche Regeln und Berechnungen

### 8.1 Grundlagen

- **Nacht** = lokaler Mittag bis nächster lokaler Mittag in der Standortzeitzone; Anzeige immer als Doppeldatum „16./17.09.“ (Schlüssel = Datum des Abends).
- **Aktuelle Nacht („Heute Nacht“)** (NT-01): die Nacht, deren Mittag-bis-Mittag-Intervall den jetzigen Zeitpunkt enthält; ist ihr Nachtfenster bereits zu Ende, gilt die **folgende** Nacht. Beispiel Starfront (Planung in Deutschland) am 18.09.: 09:00 MESZ (02:00 CDT) → Nacht 17./18.09.; 16:00 MESZ (09:00 CDT, Nachtfenster der 17./18.09. endete 08:00 CDT) → Nacht 18./19.09. – ein jetzt startendes Plugin wartet auf deren ersten Block; 20:00 MESZ (13:00 CDT) → Nacht 18./19.09. Die Regel gilt überall gleich (Knöpfe „Heute Nacht“, S-02, Plugin-Start, Hintergrundaufgaben); Pläne und Sessions nimmt der Server nur für die aktuelle oder die folgende Nacht an.
- **Datumswerte** (NT-04): Datumsfelder mit Standortbezug – Startdatum, Zieltermin, Wunschzeitraum, Zeitraum von Projektbericht und Logbuch – sind **Nacht-Schlüssel** (Datum des Abends in Standortzeit: „Startdatum 18.09.“ = ab der Nacht 18./19.09.). Datumsangaben ohne Standortbezug gelten in der Zeitzone des Mandanten.
- **Nachtfenster** eines Rigs = bürgerliche Abenddämmerung − 1 h bis bürgerliche Morgendämmerung + 1 h (Planungsraster, TK 8.3); Beginn auf 5 min **ab**-, Ende auf 5 min **auf**gerundet (NT-07; Beispiel Starfront, Nacht 17./18.09.2026: 19:00–08:00 CDT = 00:00–13:00 UTC). **Nachtende** = Ende des Nachtfensters; alle Regeln „nach Nachtende“ (verwaiste Session, Nachtbericht, Stale im Plugin) beziehen sich darauf.
- **Zeiten** (NT-03): gespeichert in UTC. Nachtereignisse (Blöcke, Transits, Flips, Dämmerung, Sessions) werden **immer in Standortzeit mit Kürzel** angezeigt (z. B. „21:08 CDT“); das Kürzel ist das deutsche des Browsers, ist das nur „GMT±x“, das englische (→ „CDT“), sonst „UTC±h“. Fristen und Zeitpunkte ohne Standortbezug (Einreichungsfristen, Gültigkeit von Einladungen) stehen in der Zeitzone des Mandanten mit Kürzel (z. B. „18:00 MESZ“), die Standortzeit im Tooltip. **Doppeldatum-Regel:** Eine Nacht heißt immer „17./18.09.“; Uhrzeiten innerhalb einer genannten Nacht stehen ohne eigenes Datum (02:34 CDT nach Mitternacht gehört zur Nacht 17./18.09.); steht eine Uhrzeit ohne Nachtbezug, trägt sie ihr Kalenderdatum in derselben Zeitzone wie die Uhrzeit.
- **Zeitzonen und Nacht-Schlüssel** kommen immer vom Server (Tabelle mit tzdata-Version, 60 Nächte im Voraus, `specs/engine/night.md`); das Plugin und der Browser rechnen sie nicht selbst (der Browser nutzt die eigene Zeitzonenrechnung nur zur Anzeige, NT-02). Die Tabelle beginnt mit der Nacht, deren Mittag-bis-Mittag-Intervall die Serverzeit enthält, und nennt je Nacht auch das Ende des Nachtfensters; daraus allein bestimmen Plugin und Browser die aktuelle Nacht. Gibt es in einer Nacht keine Dunkelheit für die gewählte Dämmerungsgrenze (z. B. Mitte Juni in Norddeutschland bei astronomischer Dämmerung), wird die Nacht geplant, enthält aber keine Blöcke; der Hinweis nennt den Grund.
- **Saisonende** eines Ziels für ein Rig = die **erste** Nacht ab heute, nach der das Ziel für mindestens 30 Nächte in Folge weniger nutzbare Zeit als die Mindestzeit am Ziel hat (Suche über 365 Nächte). Ist das Ziel **heute außerhalb der Saison**, gilt: *Saisonbeginn* = erste Nacht mit ausreichender Zeit, Saisonende = erste Pause danach. Zirkumpolare bzw. nie pausierende Ziele haben kein Saisonende.
- **Zeitschwellen (verbindlich, überall gleich):**

| Schwelle | Wert | Wirkung |
|---|---|---|
| Heartbeat-Intervall | 60 s | Diagnose, Reservierung |
| Reservierung (Lease) | 3 min ohne Heartbeat | verfällt, zweite Instanz darf starten |
| Session *verwaist* | 10 min ohne Heartbeat während *läuft* (Prüfung alle 5 min) bzw. nicht beendet 2 h nach dem Sessionende der letzten Planrevision (= Nachtende, NT-09) | Status, Betriebsalarm, Discord-Alarm |
| Offline-Modus | bis Rückkehr, max. 14 Tage | keine Reservierungsfreigabe, keine Alarme |
| Aktualisierung im Block | 15 min | FA-SYN-03 |
| Nachtbericht | frühestens bei Sessionende und Ende der Dunkelheit (ohne Dunkelheit: Sessionende laut Plan), spätestens 2 h nach dem Sessionende laut Plan (NT-09) | FA-AUS-21 |
| Uhrabweichung Plugin ↔ Server | > 5 s Warnung, > 60 s keine Ausführung | NFA-15 |

- **Drei Zeitpunkte je Nacht** (im Plan mitgeliefert, TK 7.6; NT-12): *Ende der Dunkelheit* (`darknessEndUtc`) = die **späteste** Morgendämmerung unter den Dämmerungsgrenzen, die die aktiven Projekte dieser Nacht nutzen (nutzen alle „nautisch“, ist es die nautische Morgendämmerung; je Block gilt ohnehin die Grenze des eigenen Projekts). Die frühere Festlegung auf die tiefste Grenze schnitt nautische Projekte ab. Erreicht die Sonne keine dieser Grenzen, fehlt der Wert: dann gilt als Kulanzgrenze das Blockende (FA-SCH-15) und als frühester Flat-Start Nachtfenster-Ende − 1 h. Mit dem Ende der Dunkelheit endet die Nachtschleife, sobald keine Flats ausstehen (FA-NIN-06, NT-11); danach wird nicht mehr belichtet. *Frühester Flat-Start* – Flat-Quelle *Panel* (Panel- und Dom-Flats): Ende der Dunkelheit; Flat-Quelle *Himmel* (NT-40, AST-N17): Sonnenhöhe −8° am Morgen, mit zusätzlichem *spätestem Flat-Ende* bei Sonnenhöhe −2° (dazwischen liegt das brauchbare Fenster; `darknessEndUtc` wäre 48–76 min zu früh). Es gilt Ende der Dunkelheit ≤ frühester Flat-Start ≤ Nachtende, soweit die Werte existieren. *Nachtende* (`sessionEndUtc`, Ende des Nachtfensters) – spätestes Ende der Nachtschleife; daran hängen verwaiste Session (+ 2 h) und die Frist des Nachtberichts.
- **Nutzbares Zeitfenster** eines Ziels je 5-min-Slot: Sonne unter der Dämmerungsgrenze des Projekts **und** Zielhöhe ≥ Mindesthöhe des Projekts (kein Horizontprofil).
- Koordinaten: Speicherung **J2000/ICRS**; Präzession und Nutation auf das Datum – aber **nur engine-intern** für Stundenwinkel und Höhen; an NINA und in die Aufnahmemeldungen gehen **J2000**-Werte (TK 7.3, AST-G12). **Eigenbewegung wird nicht gerechnet** (bewusst): bei den schnellsten Exoplaneten-Wirtsternen sind es seit J2000 bis ≈ 32″ (GJ 436: 1210 mas/a) – unkritisch für die Plate-Solve-Zentrierung (0,009°, weit innerhalb jedes Bildfelds), relevant nur für eine feste Photometrie-Apertur (AST-G11). Deep-Sky-Objekte haben keine messbare Eigenbewegung.
- **Höhen**: Zielhöhe und Mondhöhe sind **scheinbare Höhen** (topozentrisch). Die Refraktion wird aus der **geometrischen** Höhe berechnet (Formel nach Saemundsson für Standardbedingungen 10 °C/1010 hPa, unter −1° konstant gehalten; Details `specs/engine/moon.md`); die Mindesthöhe und der Mondhorizont werden damit geprüft. **Mondauf-/-untergang und „Mond unten“** meinen einheitlich die scheinbare Höhe des **Mondmittelpunkts** = 0° (nicht den Oberrand). **Dämmerung** nutzt die **geometrische** Höhe des Sonnenmittelpunkts (−6°/−12°/−18°), Sonnenauf-/-untergang −0,833°. Referenztests prüfen beides getrennt.
- **Abbildungsmaßstab** = 206,265 × Pixelgröße (µm) / effektive Brennweite (mm) [″/px]; **Bildfeld** = Abbildungsmaßstab (ungebinnt) × Pixelanzahl (nativ); gebinnter Maßstab = Maßstab × Binning (das Bildfeld ändert sich durch Binning nicht).

### 8.2 Mondvermeidung

Für jeden Slot und jede Belichtungszeile gilt der Slot als *mondsicher*, sobald die erste der folgenden Stufen zutrifft:

1. Mond unter dem Horizont.
2. Mondhöhe ≤ **Min-Höhe** des Profils (Vermeidung entfällt).
3. Beleuchtung ≤ max. Beleuchtung des Profils.
4. Abstand Mond–Ziel ≥ geforderter Abstand:

   `geforderter Abstand = Abstand_eff / (1 + (d / Breite_eff)²)` mit `d = |180° − ((λ_Mond − λ_Sonne) mod 360°)| / 12,1907°` = Tage bis/seit dem nächstgelegenen Vollmond, berechnet aus den **ekliptikalen Längen** von Mond und Sonne im Slot (0 bei Vollmond, ≈ 14,8 bei Neumond; kein Lunationsmodell nötig). Die Elongation wäre ungenauer, weil die Mondbreite von bis zu 5,15° sie bei Vollmond auf ~175° begrenzt (`specs/engine/moon.md`).

   **Höhen-Relaxierung** (gleitend, festgelegt in OP-11): Mondhöhe ≥ Max-Höhe → `Abstand_eff = Abstand`, `Breite_eff = Breite`. Zwischen Max-Höhe und Min-Höhe sinkt `Abstand_eff = max(0, Abstand − Relax × (Max-Höhe − Mondhöhe))` und `Breite_eff` linear mit `f = (Mondhöhe − Min-Höhe)/(Max-Höhe − Min-Höhe)`. **Reichweite (AST-M6):** Stufe 1 schneidet bei Mondhöhe ≤ 0° ab, die mitgelieferten Profile haben Min-Höhe −15° und Max-Höhe 5° – der Zweig läuft daher nur für 0° < Mondhöhe < 5°, also `f ∈ (0,75; 1,00]`, und `Breite_eff` sinkt **nie unter 0,75 · Breite**. Für *Streng* am Vollmond (Relax 0) ist die Relaxierung sogar wirkungslos. Wer sie wirksam haben will, hebt die Max-Höhe auf 20–30° und setzt Relax > 0. *Relax* in Grad je Grad Mondhöhe; *Relax = 0* bedeutet: keine Verringerung des Abstands, nur die Breite sinkt. Ist `Breite_eff = 0`, ist der geforderte Abstand 0 (sicher). Grenzen: „≥“ und „≤“ gelten inklusive; Werte werden vor dem Vergleich auf 1e-6° gerundet.

Sonst ist der Slot für diese Zeile blockiert. Hat ein Profil die Option **„Mond muss unter dem Horizont sein“**, gilt nur Stufe 1. Die Werte der übrigen Built-ins entsprechen Astro PM 1.6.0; Min-Höhen unter 0° bewirken, dass die Höhen-Relaxierung schon knapp über dem Horizont greift.

Mitgelieferte Profile (nicht änderbar, klonbar; FA-MON-02):

| Profil | Abstand | Breite | Relax | Min/Max-Höhe | max. Beleuchtung | Einsatz |
|---|---|---|---|---|---|---|
| Kein Mond | 180° | 14 d | 0 | −90° / −2° | 0 % | **harte Regel: Mond unter dem Horizont** (Profiloption „Mond muss unter dem Horizont sein“, Stufen 2–4 entfallen) |
| Streng | 90° | 8 d | 0 | −15° / 5° | 30 % | L, R, G, B |
| Moderat | 60° | 5 d | 2 | −15° / 5° | 60 % | 6–7-nm-Schmalband; **OIII auch bei 3 nm** (der Mondhimmel ist bei 501 nm deutlich heller als bei Hα/SII, NT-42) |
| Entspannt | 25° | 3 d | 3 | −15° / 5° | 80 % | 3-nm-Hα/SII (nicht OIII) |

**Nutzung im Scheduler (Mond-Stufen, wie Astro PM):** Die Zeilen eines Projekts werden nach Mondprofil gruppiert. Stufe 0 = Zeilen ohne Mondvermeidung; übrige Gruppen aufsteigend nach **Restriktivität** R = Abstand × (1 + 100 / (max. Beleuchtung + 1)); „Kein Mond“ = unendlich (Streng 380, Moderat 158, Entspannt 56). Mondfreie Zeit geht zuerst an die strengsten Stufen, bei Mond über dem Horizont wird die Stufe verwendet, die im Slot sicher ist; die Filterwahl im Block folgt FA-SCH-18. Folge: Hα bei hohem Mond, OIII beim Absinken, Breitband erst in echter Dunkelheit. *Abweichung vom Astro-PM-Plugin:* Dort gilt „Mondhöhe ≤ Max-Höhe → sicher“ und die Relaxierung wirkt nicht; hier gilt die Relaxierung wie oben (OP-11).

### 8.3 Strategien

- **Proportionale Zeit:** Die Nacht wird in mehreren Durchgängen fair verteilt: Transitfenster sperren → Slots, die nur ein Ziel nutzen kann, direkt zuteilen → mondfreie Zeit zuerst an Arbeit, die nur mondfrei geht, dann an übrige Mondvermeidungs-Arbeit → restliche mondfreie Zeit → früh untergehende Ziele reservieren ihren Anteil im eigenen Fenster → Zeit mit Mond über dem Horizont. In jedem Durchgang: reicht die Zeit, bekommt jedes Ziel seinen Bedarf; reicht sie für alle Mindestzeiten, bekommt jedes seine Mindestzeit und der Rest wird nach Restbedarf verteilt; sonst erhalten Ziele in Sortierreihenfolge ihre Mindestzeit, solange sie passt. Danach Mindestzeit erzwingen, Splitter entfernen, Bonus-Füllung, Zusammenlegen.
- **Manuelle Priorität:** Priorität 1 erhält alles, was es heute nutzen kann (mondfreie Zeit zuerst für nur-mondfreie Arbeit, sonst chronologisch), dann Priorität 2 usw.; danach dieselben Nacharbeiten.
- **Sortierkette** (FA-SCH-03): *geringste Maximalhöhe* = niedrigste Höchsthöhe heute; *bald untergehend* = frühester letzter nutzbarer Slot; *meiste Restarbeit* = größter verbleibender Bedarf in Sekunden; *knappes Zeitfenster* = nutzbare Zeit unter der doppelten Mindestzeit; *meiste Mondvermeidungs-Arbeit* = größter Bedarf in Zeilen mit Mondprofil; *Mosaik zusammenhalten* = Panels eines Projekts nebeneinander; *Priorität* = kleinere Prioritätszahl zuerst; *Zieltermin* = frühester Zieltermin (ohne Termin zuletzt).
- **Neuplanung in der Nacht:** Plant NINA vor einem Block neu (nur bei Änderungen, FA-SYN-03), zählt bereits heute belichtete Zeit in den fairen Anteil – ein Ziel verliert seinen Anteil nicht, weil es früh dran war.
- **Planung mit Overheads:** Der Bedarf einer Zeile enthält Download, anteilige Dither-Beruhigung, anteiligen Filterwechsel und anteiligen Autofokus; je erwartetem Block kommen Slew/Zentrieren und ein erwarteter Meridian-Flip hinzu. Im Ablauf werden alle Zeiten auf der Uhr berücksichtigt (Abweichung vom Astro-PM-Plugin, das nur Belichtungszeit plant).
- **Rechenvorschrift** (verbindlich, mit Soll-Plänen): Technisches Konzept 8.3 und `claude-code/docs/specs/engine/allocation.md`.

### 8.4 Zähler

| Zähler | Definition |
|---|---|
| Geplant | Eingabe am Projekt |
| Aufgenommen | Anzahl **Light**-Meldungen mit Ergebnis *gespeichert*, ohne Bonus (Flats/Dark-Flats zählen nie in Belichtungszeilen, sondern je Flat-Kombination, FA-NIN-17) |
| Bonus | gespeicherte Aufnahmen mit Bonus-Kennzeichen |
| Verworfen | je Nacht max(Korrektur, einzeln verworfene Nicht-Bonus-Aufnahmen), über alle Nächte summiert (FA-AUS-06) |
| **Akzeptiert** | Aufgenommen − Verworfen (min. 0) |
| **Verbleibend** | max(0, Geplant − Akzeptiert) → Anzeige und Fortschritt |
| **Planungsbedarf** | max(0, Geplant + ⌈Geplant × Überschuss %⌉ − Akzeptiert) → Grundlage des Schedulers (FA-SCH-04); ganzzahlig gerechnet (`⌈Geplant × Überschuss‰/1000⌉`, keine Gleitkomma-Multiplikation). Bei der Planung während der Nacht zusätzlich abzüglich der vom Plugin gemeldeten, noch nicht bestätigten Aufnahmen (`pendingCaptures`) |
| Bonus verworfen | einzeln verworfene Bonus-Aufnahmen |
| Integrationszeit | Summe der **gemeldeten** Belichtungszeiten der akzeptierten Aufnahmen und der nicht verworfenen Bonus-Aufnahmen (nicht Anzahl × Zeilen-Belichtung, NT-E3); verworfene Anzahlen aus Korrekturen ohne Einzelauswahl werden mit der Belichtungszeit der Zeile abgezogen |
| % erledigt | Akzeptiert / Geplant (ohne Bonus, max. 100 %) |

Weil *Verbleibend* und *Planungsbedarf* auf *Akzeptiert* basieren, landen verworfene Frames automatisch wieder im Plan der nächsten Nacht. **Transit-Zeilen:** Zähler je Beobachtung; Frames über *Geplant* hinaus zählen zur Beobachtung, nicht als Bonus (FA-EXO-20).

### 8.5 Prognose und Kandidatennächte

- **Erwartete nutzbare Stunden** je Nacht und Filter-Stufe = Ergebnis der Mehrnacht-Simulation (berücksichtigt Konkurrenz anderer Projekte).
- **Wettergewichtung** (optional): erwartete Stunden × Klar-Wahrscheinlichkeit aus der Nachtbewertung (z. B. Bewertung ≥ 65 % → 1,0; 45–65 % → 0,5; < 45 % → 0,1 – Schwellen konfigurierbar; die Vorgabewerte sind die Klassengrenzen *Gut* und *Mittel* aus FA-WET-03). Die Bewertung enthält **keinen Niederschlag** (FA-WET-09), die Prognose ist bei Regennächten also optimistisch; dasselbe gilt für Nächte ohne Aerosol-Vorhersage. Jenseits des Vorhersagehorizonts: Klarnacht-Statistik des Standorts aus den Sitzungsprotokollen (FA-AUS-17); solange zu wenig Daten vorliegen, eine manuell gepflegte Startquote.
- **Benötigte Nächte** = kleinste Anzahl künftiger Nächte, deren kumulierte erwartete Stunden je Stufe den Restbedarf decken. Ausgabe: optimistisch (ohne Wetter), realistisch (mit Wetter/Quote).
- **Nutzen einer Kandidatennacht** = erwartete akzeptierte Frames (Simulation) × Wetterfaktor; Ampel grün/gelb/rot.

### 8.6 Filterzuordnung in NINA

**Bestätigte Zuordnung statt Laufzeit-Heuristik** (NT-E1, FA-RIG-14): Die Verbindung Web-Filter ↔ NINA-Filter wird je Rig und Filterradplatz **einmal** von einem Admin/Owner bestätigt und gespeichert (NINA-Filtername, bestätigt am). Die Heuristik dient nur dem **Vorschlag** in der Oberfläche: exakt (normalisiert: Kleinbuchstaben, ohne Leer- und Sonderzeichen) → sonst Präfix **nur in einer Richtung**: Der NINA-Name beginnt mit dem Web-Kurznamen, und das nächste Zeichen ist kein Buchstabe („Ha“ → „Ha 3nm“; nie „LPro“ → „L“, „HaOIII“ → „Ha“, „Rc“ → „R“). Zur Laufzeit vergleicht das Plugin nur noch den bestätigten Namen exakt mit dem NINA-Profil; fehlt er, werden die Belichtungen der Zeile übersprungen und gemeldet (`filter_not_found`, FA-NIN-27). Nicht zugeordnete Zeilen plant die Engine gar nicht erst ein. Meldet NINA an einem Platz einen anderen Namen als bestätigt, ist dieser Platz wieder unbestätigt (Alarm, FA-RIG-14). Die frühere Präfix-Heuristik beidseitig zur Laufzeit entfällt.

### 8.7 Transitvorhersage

- **Ephemeride:** T_n = T₀ + n · P, Angaben in BJD_TDB. Katalog-Epochen werden beim Import auf BJD_TDB normalisiert (Zeitsystem und Offset je Quelle, Schaltsekunden zur Epoche – Rechenvorschrift `specs/engine/transit.md` §1). Umrechnung in UTC/Standortzeit inkl. baryzentrischer Lichtlaufzeit-Korrektur (Rømer, max. 8,46 min) und TDB–UTC-Differenz.
- **Ingress/Egress** = Mitte ∓ Dauer/2 (Dauer T₁₄ aus dem Katalog).
- **Unsicherheit** σ(T_n) ≈ |n| · σ_P + σ_T₀ (Tage). Die letzte **O−C verschiebt die Transitmitte** (mit Vorzeichen, in Minuten) – aber nur, wenn `|O−C| > 3·σ(O−C)`; ihr **eigener Fehler** `σ(O−C)` geht in σ ein, und der **Puffer** ist symmetrisch `max(k·σ, σ(O−C), 5 min)` je Seite. Ohne das wäre der Puffer bei gut vermessenen Zielen kleiner als die reale Abweichung (HAT-P-17 b: Puffer 0,29 min gegen O−C 1,0 ± 0,94 min), und bei TTV-Systemen wie TrES-3 b um den Faktor 40 zu klein (AST-T4) mit k = 1 (Standard, am Projekt 1–3 wählbar); Baseline vor/nach **fest 60 min** je Seite wie FA-EXO-19 (Spec-Ergänzung 30.09.2026, Entscheidung Sven nach Abgleich mit Astro PM; ersetzt die dauerabhängige Vorgabe AST-T13), am Projekt einstellbar. Alle Summanden werden vor der Rechnung in Tage umgerechnet.
- **Fenster** = [Ingress − Puffer − Baseline_vor ; Egress + Puffer + Baseline_nach] (Minutenangaben /1440).
- **Tiefe**: bevorzugt aus dem Katalog (Einheit je Quelle, `specs/engine/transit.md` §1: NASA in **%**, TESS TOI in **ppm**, ExoClock in **mmag**). Umrechnung in Millimagnituden: **Δm[mmag] = −2500 · log₁₀(1 − d)** mit `d` als **Bruch** (1 % ⇒ d = 0,01 ⇒ 10,912 mmag) – die frühere Schreibweise „Δm = −2,5·log₁₀(1 − Tiefe)" lieferte Magnituden statt Millimagnituden und wäre mit „Tiefe" als Prozentwert undefiniert (AST-D2). `(Rp/R★)²` ist nur Ersatzwert und ohne Randverdunklung **rund 20 % zu flach** (HAT-P-17 b: 16,63 gegen 20,37 mmag = 18,4 %; Kennzeichen *geschätzt*).
- **Beobachtbar** = Transitmitte bei Sonne unter der Dämmerungsgrenze (Suche: Standard nautisch −12°, Projekt: Dämmerungsgrenze des Projekts) und Höhe ≥ Mindesthöhe; *vollständig beobachtbar* = gesamtes Fenster erfüllt dies.
- **Priorität im Scheduler:** Transitfenster > Mindestzeit-/Strategieregeln aller regulären Projekte (FA-EXO-22).
- **O−C einer eigenen Beobachtung** = gemessene Transitmitte − (T₀ + n · P) der Projekt-Ephemeride, in Minuten; Fehler aus dem Fit.

### 8.8 Meridian-Flip und Rotation

**Meridian-Flip (Planung, FA-SCH-17):**

- Maßgeblich für die Planung sind die Flip-Einstellungen des Rigs; sie müssen den Meridian-Flip-Einstellungen im NINA-Profil entsprechen (Abgleich FA-NIN-24). t_M = Meridiandurchgang (obere Kulmination) des Panels, gerechnet mit der scheinbaren Rektaszension des Datums und der Sternzeit (`specs/engine/flip-rotation.md` §1.1). Der Flip wird an der ersten Belichtungsgrenze ≥ t_M + *Minuten nach Meridian* ausgeführt.
- Eine Belichtung wird nicht begonnen, wenn sie nach t_M + *maximal Minuten nach Meridian* enden würde bzw. – bei *Pause vor Meridian* > 0 – nach t_M − Pause. Bis t_M + *Minuten nach Meridian* wird gewartet (Wartezeit = Overhead).
- Danach folgt der Flip mit der *Flip-Dauer* (Overhead), anschließend Zentrieren (ohne Nachrotieren, s. u.) und die weiteren Belichtungen des Blocks. Blockende bleibt harte Grenze (FA-SCH-15): passt der Flip nicht mehr in den Block, endet der Block vor dem Flip.
- Ohne Meridiandurchgang im Block oder bei *Flip aus* entsteht kein Flip-Overhead.
- Liegt t_M in einem Transitfenster, gilt FA-NIN-21; die Transit-Reservierung (FA-EXO-23) bleibt unverändert, der Flip wird im Simulator rot markiert.
- Nachbetrachtung: geplante und tatsächliche Flip-Dauer erscheinen in der Session-Auswertung (FA-AUS-04/05).

**Rotation (FA-RIG-10, FA-NIN-23):**

- Die Rotation eines Projekts/Panels ist der **Positionswinkel am Himmel** (Nord über Ost, 0–360°) und hängt nicht von der Pier-Seite ab.
- **Konvention:** Positionswinkel = Winkel der Bild-Oberkante (Sensor-Y-Achse) von Himmelsnord über Ost, 0–360°, wie NINAs Framing-Assistent und *Center and Rotate* ihn verwenden (im Spike AP-S2b zu bestätigen).
- **Vergleich immer modulo 180°** (NT-E4): r = |Ist − Soll| mod 180, Abweichung Δ = min(r, 180 − r); in Ordnung, wenn Δ ≤ Toleranz. PA und PA + 180° ergeben denselben Bildausschnitt (um 180° gedreht).
- *Mit Rotator:* Soll = Positionswinkel. Das Plugin übergibt ihn an NINAs *Center and Rotate*; NINA stellt je nach Rotator-Bereichseinstellung PA oder PA + 180° ein – das gilt für die Bereiche *voll* und *halb*; beim Bereich *Viertel* kann NINA PA + 90° anfahren, er ist deshalb nicht zulässig (Alarm, M2). Nach einem Meridian-Flip dreht NINA **nicht**: Der mechanische Rotatorwinkel bleibt, der Positionswinkel am Himmel ändert sich um 180° – modulo 180° dieselbe Rotation, daher **kein Nachrotieren** (nur Zentrieren). Flats werden nach mechanischem Winkel gruppiert (FA-NIN-17); weil der Flip ihn nicht ändert, entsteht durch den Flip **keine** zweite Flat-Kombination.
- *Ohne Rotator:* Die Kamera steht fest (Kamerawinkel = Standard-Rotation des Rigs). Nach einem Flip ist das Bild um 180° gedreht, der Bildausschnitt aber gleich; Vergleiche erfolgen deshalb **modulo 180°** (Formel oben). Jeder Block erhält als Rotation den Kamerawinkel (NT-30). Liegt sie über der Toleranz, gilt FA-RIG-11. Flats bleiben für beide Pier-Seiten gleich.
- **Mosaik ohne Rotator:** Soll bleibt der **Kamerawinkel** – es wird nichts gedreht. Die Mosaik-Geometrie rechnet mit dem Kamerawinkel als Mosaik-Winkel (pa₀ = Standard-Rotation des Rigs), und das Framing sperrt die Mosaik-Rotation auf diesen Wert – ein anderer Mosaik-Winkel ließe Lücken zwischen den Panels (Beispiel 0,086°, NT-30). Der aus der Mosaik-Geometrie berechnete Panel-Positionswinkel (`specs/engine/geometry.md` §2.2) wird nur **geprüft**: Panels, deren Wert um mehr als die Toleranz abweicht, erhalten die Warnung *Panel-Rotation weicht ab* im Projekt, im Framing und im Simulator. Bei hoher Deklination ist das normal (bei δ = 70° und 4,5° Panelabstand bis 25°), deshalb ist es eine Warnung und kein Fehler.
- **Mosaik mit Rotator:** Soll je Panel ist der berechnete Panel-Positionswinkel (Feldrotation, `geometry.md` §2.2), nicht der Wert des Projektzentrums.

### 8.9 Aufwand-Kennzeichen

- **Schätzung, keine Garantie.** **Idealannahme:** jede Nacht klar, das Rig steht dem Objekt allein zur Verfügung (keine Konkurrenz), gleiche Engine und Regeln wie der Scheduler (Mindesthöhe, Mindestzeit, Dämmerung, Mondprofil je Zeile, Filterwechsel, Overhead inkl. Meridian-Flip). Das Kennzeichen ist damit eine **Schätzung unter Idealbedingungen** (keine mathematische Untergrenze, weil nur Stichprobennächte gerechnet werden); die realistische Prognose mit Wetter und Konkurrenz liefert die Folgeplanung (8.5, FA-FOL-02).
- **Zeitraum:** Wunschzeitraum der Einreichung, sonst ab heute bis Saisonende des Ziels, höchstens 180 Nächte.
- **Restbedarf:** Planungsbedarf aller aktiven Zeilen und Panels (vor der ersten Aufnahme = Geplant + Überschuss).
- **Berechnung:** Für Stichprobennächte (Server jede 3., Editor jede 5. Nacht; dazwischen gilt die vorige Stichprobe) wird der Nachtplan nur mit diesem Objekt erzeugt. *Beste Nacht* = Stichprobe mit den meisten zugeteilten Frames.
  - Deckt die beste Nacht den gesamten Restbedarf → **„1 Nacht“**.
  - Sonst **ca. n** = Anzahl der Nächte mit Zuteilung in der chronologischen Rechnung mit fortgeschriebenem Restbedarf bis zur Deckung; das Datum der letzten dieser Nächte ist das **frühestmögliche Fertigstellungsdatum** → **„mehrere Nächte (ca. n)“**.
  - Ist der Restbedarf am Ende des Zeitraums nicht gedeckt → **„im Zeitraum nicht machbar (x %)“** mit x = erreichbare Belichtungszeit ÷ benötigte Belichtungszeit (in Sekunden, damit Zeilen mit unterschiedlicher Belichtungsdauer vergleichbar sind).
  - Ist der Planungsbedarf bereits 0 → kein Kennzeichen („fertig“, FA-PRJ-12).
- **Begrenzender Faktor** (Tooltip): Zeile mit dem höchsten Anteil am ungedeckten Bedarf und Ursache aus der Diagnose **dieser Zeile** (nicht sichtbar, unter Mindestzeit, Mond blockiert, Filter fehlt).
- **Berechnung im Hintergrund:** Das Kennzeichen wird serverseitig als Hintergrundaufgabe berechnet und gespeichert; im Projekt-Editor rechnet der Browser live. Ein veraltetes Kennzeichen wird bis zur Neuberechnung mit „wird aktualisiert“ markiert.
- **Exoplaneten:** immer **„Transit“**; *vollständig beobachtbar*, wenn das gesamte Aufnahmefenster Höhe und Dunkelheit erfüllt (8.7), sonst *teilweise* mit abgedecktem Anteil.

## 9. Wiederverwendung der Svenesis-Astro-Tools (Kopiervorlage)

Astro-Wetter (`astro-tools/astro-weather_de.html`) und Beobachtungsplaner (`astro-tools/observing-planner_de.html`) bleiben auf www.svenesis.org **exakt so bestehen, wie sie sind**. Für NINA-PM werden ihr Quellcode, ihre Daten und Bilder **kopiert** und daraus neuer Quellcode (TypeScript) erstellt; zur Laufzeit gibt es keine Verbindung zwischen beiden. Beide Werkzeuge sind Vanilla-JavaScript, rechnen im Browser und nutzen die gemeinsame Bibliothek `window.SvAstro` – eine gute Vorlage für Web-App **und** Scheduler-Engine.

### 9.1 Bestandsaufnahme

| Datei | Inhalt (laut Quelle) | Verwendung im neuen System |
|---|---|---|
| `astro-core.js` (~30 kB) | Sonne nach Meeus, Mond (inkl. topozentrisch), Planeten, Kometen, Präzession J2000, Refraktion, Höhe/Azimut, Sternzeit, Auf-/Untergänge (`crossings`), Dämmerungsklassen, Dunkelheitsintervalle, Mondbeleuchtung, Zeitzonen, Nacht-Schlüssel, Mondsymbol | **Astronomie-Kern** für Sichtbarkeit, Dämmerung, Mondposition/-phase, Nacht-Definition – in Web-App, Scheduler-Engine und (→ OP-01, Technisches Konzept „NINA-Plugin“) im Plugin. `checkPassword` entfällt (ersetzt durch die Discord-Anmeldung, FA-LOG-01). |
| `weather-core.js` (~8 kB) | Die gesamte Bewertung: `cloudScore`, `windShear`, `seeingScore`, `transparencyScore`, `overallScore`, Klassengrenzen, Farben und Zellenanstrich | **Kopiervorlage der Bewertung** – Formeln 1:1 in die rendering-freie Engine (Server + Client + Plugin), Farben in die Anzeige. |
| `astro-weather.js` (~83 kB) | Open-Meteo-Abfrage in drei Aufrufen (ICON/GFS/HRRR, HARMONIE AROME/GEM/NBM, ECMWF, CAMS), Modellkette und Nest-Erkennung, Nachtstatistik, Canvas-Grafik, meteoblue-Einbettung | **Wetter-Modul**: Abruf, Modellwahl und Nest-Erkennung nachbauen, Grafik als Komponente weiterverwenden. |
| `observing-planner.js` (~170 kB) | Nacht-Streifen, Mondkalender, Planeten, Rangliste bester Objekte für ein Rig (Höhe während Dunkelheit, Mond, Helligkeit, Bildfeld-Füllung), Galerie/Liste | **Zielvorschläge** (FA-FRM-13), Nachtdiagramm-Bausteine, Mondkalender. Bewertungslogik parametrisieren (Rig aus Datenbank statt fester Werte). |
| OpenNGC `NGC.csv` (**13.969 Zeilen**) + `addendum.csv` (**64 Zeilen**; Version v20260501) | Quellkatalog: Koordinaten (J2000), Typcodes, Sternbild, Groß-/Kleinachse, Positionswinkel, B- und V-Helligkeit, Flächenhelligkeit, weitere Bezeichnungen (CC BY-SA 4.0) | **Objektkatalog** (`13.969 + 64` Quellzeilen, beim Import gezählt) für Suche, Objektbrowser, Framing (Winkelgrößen-Ellipsen) und Vorschläge – Feldabbildung, Dublettenregel und Importtests in `docs/specs/catalog/dso-import.md`; LBN/LDN/Barnard als spätere Ergänzung |
| `dso-catalog.js` (~30 kB) + `data/ngc.json` | Auszug der Website: 168 kuratierte Objekte mit Trivialnamen, Aliase je Zeile, Vorschaubilder und Wikipedia-Titel | **Ergänzung** zum OpenNGC-Import: zusätzliche Namen und Aliase, Vorschaubilder, Wikipedia-Titel. **Keine** Quelle für Helligkeiten (gerundete Richtwerte ohne Bandangabe), Größen oder Typcodes |
| `star-catalog.js` + `stars-8.bin` | Sterne bis ~8 mag | Offline-Sternfeld der Sternkarte. |
| `sky-map.js` | Sternkarte (d3-celestial-basiert) mit Sternbildern, Gitter, HiPS-Himmelsfotos (DSS2, Pan-STARRS, 2MASS) vom CDS | **Basis der Framing-Ansicht**: erweitern um Bildfeld-Rechteck, Rotation, Mosaik-Gitter, Mindesthöhe, Projekt-Overlays, NSNS-Schmalband-HiPS. |
| `sky-events.js` (~47 kB) | Satellitenüberflüge (SGP4), Meteorströme, Konjunktionen, Kometen, Galaktisches Zentrum, Finsternisse | **Informativ** in der Nachtübersicht (K); optional Hinweis „ISS-Überflug durch Bildfeld" (W), besonders relevant während eines Transitfensters. |

### 9.2 Nötige Anpassungen

1. **Neuer Code statt Änderung:** Die Originale werden nicht verändert. In der Kopie werden die `window.SvAstro`-Globals zu TypeScript-Modulen mit klaren, DOM-freien Rechenfunktionen (lauffähig in Browser, Node und eingebettet im Plugin).
2. **Standorte:** Die fest hinterlegten Standorte (Starfront, Volkssternwarte Hannover, Sankt Andreasberg, Finca Olivar) werden durch Standorte aus der Datenbank ersetzt; URL-Parameter (`lat`, `lon`, `date`) bleiben als Deep-Link erhalten.
3. **Rig-Parameter:** Die im Planer fest eingestellten Rig-Werte (z. B. GT81 mit Ares-M Pro, 1,69° Bildfeld) kommen aus dem Rig.
4. **Transits:** Baryzentrische Zeitkorrektur und Ephemeriden-Rechnung als neue Funktionen auf Basis der vorhandenen Sonnen-/Zeitfunktionen ergänzen.
5. **Wetterabruf:** Abruf serverseitig mit Cache statt direkt aus dem Browser (Datenschutz, Rate-Limits, Nutzung im Folgeplaner ohne geöffnete Seite).
6. **Mondvermeidung:** neue Funktion auf Basis von `moonCoords`/`moonIllumination` (Kap. 8.2).
7. **Tests:** Referenzwerte (Dämmerung, Mondauf-/-untergang, Höhen) für mehrere Standorte als automatisierte Tests, da Web-Simulator und NINA identisch rechnen müssen.
8. **Lizenzhinweise** der kopierten Kataloge (OpenNGC einschließlich Addendum – CC BY-SA 4.0, mit Version und Abrufdatum; Sharpless, Caldwell; d3-celestial, Hipparcos) und der Dienste übernehmen (FA-ADM-07, FA-WEB-04).
9. **Eigene Daten:** Katalog (OpenNGC `NGC.csv` als Quelle, `ngc.json` und `dso-catalog.js` nur für Namen, Aliase und Vorschaubilder), Sterndaten und Vorschaubilder werden in die Anwendung kopiert; die Generatoren der Website werden mitportiert, damit NINA-PM seine Daten unabhängig aktualisieren kann.

---

## 10. Nicht-funktionale Anforderungen

| ID | Anforderung |
|---|---|
| NFA-01 | **Plattform:** aktuelle Browser (Chrome, Edge, Firefox, Safari) auf Desktop, Laptop und Tablet; keine mobile App, keine PWA. **Die Arbeitsseiten nutzen immer die volle Fensterbreite** (kein `max-width`, kein zentrierter Container); nur Textseiten sind auf Lesebreite begrenzt. Statt eines Layout-Umschalters gibt es einen **Dichte-Schalter** *kompakt | normal | weit*, der Zeilenhöhe, Schriftgröße und Abstände steuert (Astro PM nennt das Tablet/Laptop/Desktop). **Verbindliche Mindestbreite:** Arbeitsseiten **768 px**, Textseiten sowie Kopf- und Fußzeile **600 px** – jeweils ohne horizontales Scrollen. Kleinere Breiten (Telefon) werden ausdrücklich **nicht** unterstützt; das ist auch das Abnahmekriterium je Bildschirm (TK 11.3). |
| NFA-02 | **NINA:** Plugin für NINA 3.x unter Windows; keine Änderung an NINA-Kernfunktionen. |
| NFA-03 | **Determinismus:** Simulation und Planaufbau in NINA liefern bei gleichen Eingaben identische Pläne; Engine-Version wird in jedem Plan gespeichert. |
| NFA-04 | **Robustheit Sternwarte:** Das Plugin führt eine begonnene Nacht auch ohne Internet vollständig aus; keine Meldung geht verloren (persistente Warteschlange). |
| NFA-05 | **Performance:** Simulation einer Nacht mit 20 aktiven Projekten < 3 s im Browser; Saisondiagramm (12 Monate) < 10 s. Planaufbau in NINA < 30 s. |
| NFA-06 | **Sicherheit** (Leitlinie, SV-01 … SV-19): (1) **Schutz von außen** – Angreifer über Web, API oder Plugin-Schnittstelle erhalten keinen Zugriff auf die Anwendung, ihre Daten oder die AWS-Ressourcen: HTTPS; keine Passwörter im System (Discord-OAuth mit `state`-Prüfung und PKCE); Anmeldesitzung als zufällige Kennung in einem HttpOnly-/Secure-Cookie, serverseitig nur als Hash gespeichert, Abmelden und Beenden wirken sofort; serverseitige Rechteprüfung je Aktion (FA-BER-01) und Mandantentrennung (NFA-16); Eingabeprüfung; CSRF-Schutz; Schutz gegen XSS und Clickjacking (u. a. formatierter Text ohne rohes HTML); Sync-Tokens nur gehasht gespeichert und auf Mandant und genau ein Rig beschränkt; Drosselung der API und der Anmeldung; jede Serverfunktion nur mit den AWS-Rechten, die sie braucht (begrenzt den Schaden, falls eine öffentlich erreichbare Funktion kompromittiert wird). (2) **Das Deployment ist nicht Teil der Sicherheitsarchitektur**: Der Betreiber deployt lokal mit seinem AWS-Admin-Profil; Schutz gegen Insider mit AWS-Zugang, gehärtete Deploy-Wege und manipulationssichere Audit-Spuren sind nicht gefordert. (3) **Innerhalb der Anwendung Schutz gegen Versehen**, nicht gegen böswillige Mitglieder: Rechte je Rolle, eigene Objekte, Bestätigungsdialoge, Papierkorb für Projekte (FA-PRJ-15), Konflikthinweis bei gleichzeitiger Bearbeitung, einfaches Änderungsprotokoll. |
| NFA-07 | **Datenschutz (DSGVO):** Hosting bevorzugt in der EU; externe Dienste (Open-Meteo, CDS, meteoblue, ExoClock, NASA Exoplanet Archive) serverseitig oder erst nach Zustimmung; eigene Datenschutzerklärung der Anwendung (FA-WEB-04) mit die Anmeldung über Discord (Discord Inc., USA) und die Verarbeitung von Discord-ID, -Name, Avatar, letzter Anmeldung und Anmeldesitzungen (ein Anmeldeprotokoll wird nicht geführt, SV-11); Löschkonzept für Benutzer und Mandanten. |
| NFA-08 | **Zeit:** Speicherung UTC; Anzeige nach Kap. 8.1 (NT-03/NT-04): Nachtereignisse in Standortzeit mit Kürzel, Fristen ohne Standortbezug in der Zeitzone des Mandanten (Standortzeit im Tooltip); Datumsfelder mit Standortbezug sind Nacht-Schlüssel. Planung und Anzeige funktionieren unabhängig von der Zeitzone des Browsers und des NINA-Rechners (Testfall: Browser Europe/Berlin, Standort America/Chicago). |
| NFA-09 | **Sprache:** Deutsch und Englisch; fachliche Begriffe konsistent (Glossar). |
| NFA-10 | **Gestaltung und Nachtmodus:** Erscheinungsbild nach Vorbild der Website (heller Hintergrund, dunkelblaue Kopf-/Fußzeile, blaue Akzente, Systemschrift, weiße Karten) als eigene Kopie der Gestaltungswerte; zusätzlich umschaltbarer **Dunkelmodus** für die Nutzung am Teleskop. **Beide Darstellungen** (`light`, `dark`) sind gleichrangig und Abnahmekriterium **jedes** Bildschirms (Farbwerte und Prüfung in TK 11.3). Die Wahl gilt geräteübergreifend je Person. **Ein Rotlicht-Modus ist ausdrücklich nicht vorgesehen** (Entscheidung 17.09.2026). |
| NFA-11 | **Verfügbarkeit:** Ausfall des Servers darf laufende Nächte nicht stoppen (NFA-04); Ziel-Verfügbarkeit Server 99 %. |
| NFA-12 | **Nachvollziehbarkeit:** Jede Planänderung an aktiven Projekten wird mit Zeitstempel protokolliert, damit Abweichungen in der Auswertung erklärbar sind. |
| NFA-13 | **Versionierung:** Plugin und Server prüfen Kompatibilität der Engine-Version; Warnung bei Abweichung. |
| NFA-14 | **Wartbarkeit:** Rechenkern als eigenständige, getestete Bibliothek; Testabdeckung Rechenkern ≥ 90 %. |
| NFA-15 | **Zeitgenauigkeit Transits:** Vorhergesagte Transitmitten weichen um weniger als 1 min von ExoClock-Vorhersagen ab (Referenztests); die Uhr des NINA-Rechners muss synchronisiert sein (Warnung bei Abweichung > 5 s, soweit prüfbar). |
| NFA-16 | **Mandantentrennung technisch abgesichert** (auch gegenüber Super Usern für fachliche Inhalte): verpflichtender, nicht umgehbarer Mandantenkontext in der Datenzugriffsschicht (Umsetzung → Technisches Konzept); automatisierte Tests, dass kein Mandant Daten eines anderen lesen oder ändern kann. |
| NFA-17 | **Berechtigungstests:** Für jede Aktion der Berechtigungsmatrix existiert ein automatisierter Test für Owner, Admin, Admin ohne Discord-2FA (wirkt als User, FA-LOG-07), User, fremden Mandanten und nicht angemeldet sowie für die System-Rolle Super User. |
| NFA-18 | **Gestaltung wie svenesis.org:** gleiche Anmutung und Barrierefreiheit wie die Website in eigener Umsetzung; nur technisch notwendige Cookies, daher kein Einwilligungsbanner; externe Bildkacheln (CDS) erst beim Zoomen mit Hinweis und Abschalter; keine Skripte oder Stylesheets der Website. |
| NFA-19 | **Mengengerüst (Richtwerte):** bis 50 Mandanten, je Mandant bis 50 Benutzer, 20 Rigs, 1.000 Projekte, 100.000 Aufnahmen/Jahr. |
| NFA-20 | **Abhängigkeit Discord:** Ausfall oder Sperre bei Discord darf laufende Nächte nicht beeinflussen; bestehende Anmeldesitzungen bleiben nutzbar; Notfallzugang für den Betreiber über das Betriebswerkzeug `ops-cli`, lokal aufgerufen mit seinem AWS-Admin-Profil (FA-SU-06, SV-17). |
| NFA-21 | **Unabhängigkeit von der Website:** Die Anwendung verändert keine Dateien, Seiten, Skripte oder Infrastruktur der Website (einzige Ausnahme: der Menüeintrag, umgesetzt im Website-Projekt) und lädt zur Laufzeit nichts von www.svenesis.org. |

---

## 11. Ausbaustufen (Release-Plan)

| Stufe | Inhalt | Ergebnis |
|---|---|---|
| **R1 – MVP Planung** | Eigenständige Anwendung `nina-pm.svenesis.org` mit Einstiegsseite, Datenschutz- und Quellenseite (FA-WEB, FA-ADM-07); Discord-Anmeldung und Mandantenauswahl; Super User mit Mandantenverwaltung, Super-User-Verwaltung und System-Audit (Discord-2FA Pflicht); Mandanten, Einladungen und Mitgliederverwaltung, Rollen Owner/Admin/User mit Berechtigungsmatrix und Änderungsverlauf; **Benachrichtigungen in der Anwendung**; Freigabe-Warteschlange für alle sichtbar (einreichen, zurückziehen, Rangfolge, Stimmen, Plan-Chips, Aufwand-Kennzeichen, freigeben, zurückgeben, ablehnen) mit Freigabe-Verlauf, „Meine Objekte“ (Startseite bis R3) und Entwürfe-Liste; Ausrüstung, Rig; Filter, Vorlagen, Mondprofile; Projekte mit Einzelfeld, Projektliste und Ansicht „Gelöscht“ (Papierkorb); Nachtdiagramm; Scheduler (beide Strategien, Dither, Filterwechsel, Meridian-Flip-Overhead); Simulator (Zielkarten, Grafik, Protokoll, Übernahmestatus in NINA); Sync-API (erprobt mit dem Fake-Plugin); „An NINA ausgeliefert“ (FA-NIN-22); Betriebsalarme in der App; Zähler und Aufnahmenächte; einfache Session-Übersicht (Soll/Ist je Filter, Session-Status, nicht zugeordnete Aufnahmen); manuelle Korrektur (Anzahl je Zeile/Nacht) | Projekte werden gemeinsam geplant, freigegeben und simuliert; die Sync-API ist mit dem Fake-Plugin erprobt. |
| **R2 – Framing und Wetter** | Objektkatalog aus OpenNGC (13.969 Zeilen aus `NGC.csv` plus 64 aus `addendum.csv`, Version v20260501) und Objektbrowser; Sternkarte mit Bildfeld, Rotation, Mosaik-Planung (Mosaik-Projekte im Editor anlegen; die Engine unterstützt Panels schon ab R1); Overlays; Zeitleiste; Zielvorschläge; Astro-Wetter je Standort und im Projekt; Saisondiagramm und Warteschlangen-Spalte „Sichtbarkeit Wochen“ | Planung komplett in der Web-App. |
| **R3 – Auswertung und Folgeplanung** | Auswirkungsvorschau und Änderungsanträge in der Warteschlange; einzelne Aufnahmen verwerfen; Session-Auswertung mit Abweichungsgründen und Kennzahlen; Sitzungsprotokoll und Klarnacht-Statistik; Projektverlauf; Restbedarf, Prognose, Kandidatennächte, Saisonwarnung, Handlungsvorschläge; Mehrnacht-Simulation; „Heute Nacht"-Übersicht als Startseite; Projektbericht als Druckansicht/CSV | Entscheidung „nächste Nacht" datenbasiert. |
| **RP – NINA-Plugin „Eine Nacht automatisch"** (direkt vor R4) | Plugin mit Beispielsequenz „Eine Nacht“, Optionsseite mit Zielbrowser (FA-NIN-01/02), Container, Nachtschleife, Ziele aktualisieren, Aktualisierung vor jedem Block, Ausführung (inkl. Rotator-Regeln und Flip-Abgleich), Trigger-Sets vor/nach Belichtung und Zielwechsel, eine Session je Rig, Nachmelden, Live-Status, Standortprüfung, Log, Meldungen, Cache/Offline, Zeitgeführt/Sequenziell. Das ist der Plugin-Umfang, den FA-NIN-* und `specs/nina/execution.md` mit „R1“ kennzeichnen | NINA nimmt geplante Projekte eigenständig auf; Fortschritt stimmt. |
| **R4 – Exoplaneten** | Katalogabruf, Transitsuche, Zeitleiste, Exoplaneten-Projekt je Planet, Rig und Ersteller mit Ephemeride, gewünschtem/festgelegtem Transit-Datum (Ersteller legt nach Freigabe selbst fest), Zählern je Beobachtung und Fristen, Ergebnisimport HOPS/EXOTIC, Vergleichstabelle, zeitkritische Unterbrechung im Scheduler und Plugin, Transit-Auswertung | Transits werden neben der Astrofotografie automatisch aufgenommen. |
| **R5 – Komfort** | Flat-Handling mit Flats und Dark-Flats je Kombination, geteilte Kombinationen, vollständiger Flat-Satz; Tagesschleife und *Warten auf Zeit*; Beispielsequenzen „Mehrere Nächte“ und „mit Flats“; Simulator im Plugin mit lokaler Änderung im Offline-Modus; Mandanten-Export/-Import; optional Import der Astro-PM-Datenbank (OP-20) | Unbeaufsichtigter Mehrnachtbetrieb. |
| **R6 – Optional** | Belichtungs-/Sampling-Rechner (inkl. Exoplanet-Stern-Modus); optionale NINA-Metriken; Teilen von Ausrüstung/Projekten; Discord-Server mit Kanälen je Mandant (FA-DIS) und Nachtbericht nach Sessionende (FA-AUS-21) | – |

Nicht einzeln genannte Muss-Anforderungen gehören zur Stufe ihres fachlichen Bereichs (z. B. 6.1/6.2/6.13/6.14 und die Server-Seite von 6.8 (Sync-API) zu R1, 6.9 und die Plugin-Seite von 6.8 ohne Transit zu RP, 6.10 zu R4). Wo FA-NIN-* oder `specs/nina/execution.md` „R1“ nennen, ist der Plugin-Umfang von RP gemeint.

---

## 12. Offene Punkte und Entscheidungen

| Nr. | Thema | Optionen | Empfehlung (für das technische Konzept) |
|---|---|---|---|
| OP-01 | **Wo läuft die Scheduler-Engine?** Plan muss in Web und NINA identisch sein, NINA muss offline planen können. | a) Engine nur serverseitig, NINA lädt fertigen Plan (offline nur für bereits geladene Nächte). b) Zwei Implementierungen (TypeScript + C#) – Drift-Risiko. c) **Eine Engine in TypeScript/JavaScript**, im Browser, auf dem Server und im Plugin eingebettet (JS-Engine in .NET, z. B. Jint oder ClearScript). | **Entschieden (geändert durch OP-24):** eine Engine in TypeScript; online plant der Server, offline das Plugin (Jint). |
| OP-02 | Hosting und Technologie | – | **Entschieden:** eigenständig unter `nina-pm.svenesis.org` auf AWS, alles per CDK (eigene CloudFront-Distribution, API Gateway + Lambda in TypeScript, Aurora DSQL, S3); Frontend React + TypeScript nach Gestaltung von svenesis.org; Anmeldung nur über Discord. Details im Technischen Konzept. |
| OP-03 | Einzel- oder Mehrbenutzer | – | **Entschieden:** mandantenfähig und mehrbenutzerfähig mit Rollen Owner/Admin/User (Kap. 6.13/6.14). |
| OP-04 | Kommunikation Plugin → Server | Polling / WebSocket | Einfaches HTTPS-Polling und Meldungs-Upload; kein Echtzeitkanal nötig, da keine Live-Überwachung. |
| OP-05 | Welche NINA-Metadaten sind je Aufnahme verfügbar und gewünscht? | nur Pflichtfelder / plus HFR, Sterne, RMS | Pflichtfelder in R1; Metriken ab R6 prüfen. |
| OP-06 | Verworfen-Erfassung | nur Anzahl je Zeile/Nacht / einzelne Aufnahmen / Import einer Dateiliste | **Entschieden:** Anzahl je Zeile/Nacht (R1, FA-AUS-06), einzelne Aufnahmen (R3), Dateilisten-Import (K). |
| OP-07 | Klarnacht-Statistik je Standort für Prognosen jenseits der Vorhersage | manuell / aus Sitzungsprotokollen / aus Klimadaten | **Entschieden:** aus Sitzungsprotokollen (FA-AUS-17) mit manueller Startquote. |
| OP-08 | Umgang mit Rotator-losen Rigs | Rotation nur als Hinweis / Framing-Warnung | **Entschieden:** Merkmal „Rotator vorhanden“ am Rig; ohne Rotator nur Prüfung gegen den Kamerawinkel (modulo 180°) mit Warnung oder optionalem Überspringen (FA-RIG-10/11, FA-NIN-23, Kap. 8.8). |
| OP-09 | Namen des Produkts und des Plugins im NINA-Plugin-Manager | – | offen |
| OP-10 | Veröffentlichung des Plugins (NINA-Plugin-Manifest-Repository) oder nur private Installation | – | zunächst privat |
| OP-11 | Semantik Max-Höhe/Min-Höhe im Mondprofil | – | **Entschieden:** gleitende Relaxierung zwischen Max- und Min-Höhe, unter Min-Höhe sicher (Kap. 8.2); mit Diagramm (FA-MON-04) und Referenztests validieren. |
| OP-12 | Transit-Unterbrechung: laufende Belichtung | – | **Entschieden:** zu Ende belichten, wenn sie vor Fenster-Beginn minus Slew-Vorlauf endet; sonst abbrechen (FA-NIN-20). |
| OP-22 | Exoplaneten-Projekte mehrerer Mitglieder für denselben Planeten | ein Projekt je Planet+Rig / je Ersteller | **Entschieden:** je Planet, Rig und Ersteller (FA-EXO-15). |
| OP-23 | Wer legt weitere Transits eines freigegebenen Exoplaneten-Projekts fest? | nur Admin / Ersteller | **Entschieden:** Ersteller selbst, optional mit Admin-Bestätigung (FA-EXO-18). |
| OP-24 | Wo wird der Nachtplan berechnet? | im Plugin / auf dem Server | **Entschieden:** online auf dem Server, offline im Plugin mit derselben Engine (FA-SYN-03). |
| OP-25 | Eingehende Daten aus Discord (Meldungen anderer Werkzeuge wie Allsky/Wetterstation, Befehle, Notizen) | Discord-Bot / keine | **Offen:** zunächst nur ausgehende Webhooks (FA-DIS-06); Bedarf und Bot-Anbindung später klären. |
| OP-28 | Review 3 (17.09.2026) | – | **Entschieden:** Überschuss über Planungsbedarf; Transit bis Fensterende; geteilte Transits nur bei gleichen Zeilen; Transit-Festlegung durch User standardmäßig bestätigen (max. 3 offen); Offline-Modus friert Reservierung ein; zentrale Zeitschwellen; Mosaik-Fairness; Aufwand als Schätzung; Dual-Rig-Setups nicht unterstützt. |
| OP-29 | Sicherheits-Vereinfachung (21.09.2026) | – | **Entschieden (E1–E4, SV-01 … SV-19):** Schutz von außen statt gegen Insider; das Deployment läuft lokal und ist nicht Teil der Sicherheitsarchitektur; Rollen Owner/Admin/User ohne Befristung, Owner-Übertragung sofort; Super-User-Oberfläche bleibt ohne Sonderregeln; Projekte immer weich gelöscht mit Ansicht „Gelöscht“; feste Sitzungsdauer und 2FA-Regel; kein Anmeldeprotokoll; Sync-Tokens ohne Ablauf (NFA-06, Kap. 6.13/6.14). |
| OP-27 | Eigener Planungsalgorithmus oder Übernahme aus dem Astro-PM-NINA-Plugin? | eigene Spezifikation / Übernahme | **Entschieden (17.09.2026):** Zuteilung und Plugin-Ausführung werden aus dem Astro-PM-Plugin (MIT) übernommen und nach TypeScript bzw. in den Plugin-Adapter portiert; das C#-Original dient als Vergleich in Tests. Beibehalten: genaue Astronomie, Overheads und Meridian-Flip im Plan, Server-Plan mit Neuplanung vor jedem Block, Aufnahme-Meldungen, Flat-Kombination nach mechanischem Rotatorwinkel, Mondformel nach Kap. 8.2. Horizontprofil und Remote Play/Pause bleiben ausgeschlossen (Kap. 2.3). |
| OP-26 | Welche Kalibrierbilder meldet NINA? | nur Flats / Flats + Dark-Flats / zusätzlich Darks und Bias | **Entschieden:** Flats und Dark-Flats, jede Aufnahme einzeln mit Typ (FA-NIN-17). Darks/Bias nicht. |
| OP-13 | Nutzungsbedingungen/Rate-Limits der Exoplaneten-Kataloge (ExoClock, NASA TAP, ExoFOP) | – | Im technischen Konzept prüfen; serverseitiger Cache. |
| OP-14 | Ausgabeformate von HOPS und EXOTIC (Dateinamen, Felder, Versionen) | – | Beispieldateien beschaffen und Parser gegen mehrere Versionen testen; unbekannte Formate mit manueller Werteingabe abfangen. |
| OP-15 | Welche Geräte liefern in NINA Bedingungen (ObservingConditions, SQM) am jeweiligen Rig? | – | Je Rig prüfen; ohne Gerät nur Vorhersage + manuell. |
| OP-16 | Wer legt Mandanten an, über welche Oberfläche? | – | **Entschieden:** Rolle **Super User** mit eigener Verwaltungsoberfläche, verwaltet alle Mandanten (Kap. 6.13, FA-SU-01 ff.). |
| OP-17 | Dürfen User für eigene Exoplaneten-Objekte Ergebnisse (HOPS/EXOTIC) importieren? | – | **Entschieden:** Ja, für eigene Objekte (FA-EXO-35, Berechtigungsmatrix). |
| OP-18 | Sieht der Admin Entwürfe von Usern? | – | **Entschieden:** Ja, Admins sehen und bearbeiten alle Entwürfe (FA-BER-02). |
| OP-19 | Gemeinsame Nutzung von Rigs/Standorten durch mehrere Mandanten? | – | **Entschieden:** Nein (FA-MAN-06). |
| OP-20 | Soll es einen Import der bestehenden Astro-PM-Datenbank (logbook.db) in einen Mandanten geben? | ja / nein | Empfehlung: einmaliges Import-Skript (Kap. 15.3), da aktuelle Projekte (NGC 281, IC 1805, NGC 6946 …) sonst neu erfasst werden müssten. |
| OP-21 | Anmeldung | – | **Entschieden:** ausschließlich Discord-OAuth, keine Passwörter, kein Cognito; Zugang per Einladungslink, Mandantenauswahl nach Login (Kap. 6.13). |

---

## 13. Glossar

| Begriff | Bedeutung |
|---|---|
| **Mandant** | Abgeschlossener Bereich (z. B. Sternwarte, Verein) mit eigenen Daten, Benutzern und NINA-Instanzen. |
| **Super User** | Systemrolle, die Mandanten anlegt und deren Owner einlädt bzw. im Notfall neu zuweist, ohne Zugriff auf fachliche Inhalte. |
| **Owner** | Eigentümer eines Mandanten (genau einer); Admin mit exklusivem Recht, Admins zu verwalten; im Mandanten nicht absetzbar; überträgt die Rolle sofort an einen aktiven Admin. |
| **Mandanten-ID** | Eindeutiger Kurzname des Mandanten (z. B. `sternwarte-xy`) für Links, Einladungen und die Auswahl nach dem Login. |
| **Discord-Anmeldung** | Login über das Discord-Konto (OAuth 2.0); die Anwendung speichert keine Passwörter. |
| **Einladungslink** | Zeitlich begrenzter Link, mit dem eine Person nach der Discord-Anmeldung Mitglied eines Mandanten mit festgelegter Rolle wird. |
| **Owner / Admin / User** | Rollen je Mandant: Owner = Admin mit Verwaltung der Admins; Admin darf alles Fachliche und verwaltet User; User plant eigene Objekte, reicht sie ein, stimmt ab und sieht alles andere lesend. |
| **Warteschlange** | Liste der von Mitgliedern eingereichten Objekte und Änderungsanträge, die auf Freigabe durch einen Admin warten; für alle Mitglieder sichtbar. |
| **Stimme** | Zustimmung eines Mitglieds zu einem eingereichten Objekt eines anderen (eine je Person und Objekt). |
| **Aufwand-Kennzeichen** | Automatisch berechnete Angabe, ob der Restbedarf eines Objekts in eine Nacht passt, mehrere klare Nächte braucht oder im Zeitraum nicht machbar ist. |
| **Rang beim Einreicher** | Persönliche Reihenfolge der eigenen eingereichten Objekte eines Users (1 = am wichtigsten). |
| **Freigabe** | Entscheidung eines Admins, ein eingereichtes Objekt in den realen Ablauf (Scheduler/NINA) zu übernehmen. |
| **Objekt** | Von einem Benutzer (User oder Admin) geplantes Ziel – Deep-Sky- oder Exoplaneten-Projekt – mit Ersteller und Freigabestatus. |
| **Freigabestatus** | Zustand eines Objekts vor dem realen Ablauf: Entwurf, Eingereicht, Zurückgegeben, Abgelehnt, Freigegeben. |
| **Änderungsantrag** | Vorschlag eines Users zur Änderung seines bereits freigegebenen Objekts; die freigegebene Fassung bleibt bis zur Entscheidung aktiv. |
| **Anmeldesitzung** | Angemeldeter Zugang einer Person im Browser (nicht zu verwechseln mit einer Session = Aufnahmenacht in NINA); endet nach 14 Tagen ohne Aktivität, spätestens nach 30 Tagen, oder sofort beim Abmelden. |
| **Bestätigungsdialog** | Einheitliche Rückfrage vor folgenschweren Aktionen (Löschen, Rechte entziehen, Owner übertragen, Ablehnen, Token widerrufen, Sitzungen beenden); Namenseingabe nur beim Löschen eines Mandanten. |
| **Gelöscht (Papierkorb)** | Ansicht der weich gelöschten Projekte eines Mandanten für Admins mit *Wiederherstellen*; es gibt kein automatisches endgültiges Löschen. |
| **NINA** | Nighttime Imaging 'N' Astronomy – Open-Source-Aufnahmesoftware für Astrofotografie (Windows). |
| **Rig / Imaging-System** | Kombination aus Standort, Teleskop und Kamera; Einheit für Planung und NINA-Instanz. |
| **Projekt** | Ein Ziel auf einem Rig mit Belichtungsplan und Fortschritt. |
| **Panel** | Teilfeld eines Mosaiks; Einzelfeld = 1 Panel. |
| **Belichtungszeile** | Filter + Belichtungszeit + Anzahl + Kameraeinstellungen + Mondprofil. |
| **Sub / Frame** | Einzelbelichtung. |
| **Nachtplan** | Vom Scheduler berechnete Folge von Blöcken für eine Nacht und ein Rig. |
| **Block** | Zusammenhängendes Zeitfenster an einem Ziel/Panel. |
| **Meridian-Flip** | Umschlagen einer deutschen Montierung nach dem Meridiandurchgang; kostet Wartezeit und Flip-Dauer, dreht das Bild ohne Rotator um 180°. |
| **Positionswinkel / Kamerawinkel** | Rotation des Bildfelds am Himmel (Nord über Ost). Kamerawinkel = fest eingestellter Winkel eines Rigs ohne Rotator. |
| **Session** | Tatsächliche Ausführung eines Nachtplans durch NINA. |
| **Aufnahme-Ledger** | Gesamtheit aller Aufnahmemeldungen und Korrekturen; Grundlage aller Zähler. |
| **Mondprofil** | Parameter, wann ein Filter trotz Mond eingesetzt werden darf. |
| **Filter-Stufe (Mond-Stufe)** | Gruppe von Zeilen desselben Mondprofils; geordnet nach Restriktivität R = Abstand × (1 + 100/(max. Beleuchtung + 1)), „Kein Mond“ = strengste (Kap. 8.2). |
| **Exoplaneten-Projekt** | Projekt je Planet, Rig und Ersteller mit gespeicherter Ephemeride; sammelt Transit-Beobachtungen über mehrere Nächte. |
| **Transit-Beobachtung** | Ein Transitereignis eines Exoplaneten-Projekts mit festem Zeitfenster: *gewünscht* (vor Freigabe), *festgelegt* (Vorrang im Scheduler), danach *beobachtet*, *verpasst* oder *storniert*. |
| **Saisonende** | Erste Nacht ab heute, nach der ein Ziel für längere Zeit (≥ 30 Nächte) nicht mehr ausreichend beobachtbar ist (Kap. 8.1). |
| **Nachtende** | Ende des Nachtfensters (bürgerliche Morgendämmerung + 1 h, Kap. 8.1), `sessionEndUtc`; spätestes Ende der Nachtschleife. |
| **Ende der Dunkelheit** | `darknessEndUtc`: späteste Morgendämmerung unter den Dämmerungsgrenzen der aktiven Projekte der Nacht (Kap. 8.1, NT-12); danach keine neuen Belichtungen, die Nachtschleife endet, sobald keine Flats ausstehen. |
| **Aktuelle Nacht** | „Heute Nacht“: die Nacht, deren Mittag-bis-Mittag-Intervall jetzt enthält – nach Ende ihres Nachtfensters schon die folgende (Kap. 8.1, NT-01). |
| **Filterradbelegung** | Je Rig und Filterradplatz der Web-Filter und der von einem Admin/Owner bestätigte NINA-Filtername (FA-RIG-14, NT-E1). |
| **Planungsbedarf** | Geplant + Überschuss − Akzeptiert; Grundlage des Schedulers (Kap. 8.4). |
| **HOPS / EXOTIC** | Photometrie-Software (HOlomon Photometry Software / Exoplanet Transit Interpretation Code), deren Ergebnisse ExoClock bzw. NASA Exoplanet Watch annehmen. |
| **Sitzungsprotokoll** | Beobachtungsbedingungen und Notizen einer Session. |
| **SQM** | Sky Quality Meter – gemessene Himmelshelligkeit in mag/″². |
| **Zeitgeführt / Sequenziell** | Wiedergabemodus nach Verzögerungen: Uhr folgen / Reihenfolge einhalten. |
| **Dither** | Kleine Verschiebung zwischen Belichtungen zur Rauschminderung. |
| **Flats** | Kalibrieraufnahmen gegen Vignettierung/Staub, passend zu Filter, Rotation, Gain/Offset/Binning. |
| **Dark-Flats** | Dunkelaufnahmen mit Belichtungszeit, Gain, Offset und Binning der Flats; ziehen Dunkelstrom und Offset von den Flats ab. |
| **Sync-Token** | Geheimer Schlüssel, mit dem sich eine NINA-Instanz gegenüber der API ausweist; ohne Ablaufdatum, gültig bis zum Widerruf. |
| **Transit** | Vorbeizug eines Exoplaneten vor seinem Stern; messbar als kleiner Helligkeitsabfall. |
| **Ingress / Egress** | Beginn / Ende des Transits (1./4. Kontakt). |
| **Baseline** | Aufnahmezeit vor und nach dem Transit als Referenzhelligkeit. |
| **Ephemeride** | Bahnparameter T₀ und Periode P zur Vorhersage der Transitzeiten. |
| **BJD_TDB** | Baryzentrisches julianisches Datum in dynamischer Zeit – Zeitbasis der Ephemeriden. |
| **O−C** | Beobachtet minus berechnet: Drift echter Transitzeiten gegenüber der Ephemeride. |
| **ExoClock / TOI** | Kuratiertes Transit-Beobachtungsprojekt (ESA Ariel) / TESS Objects of Interest. |
| **Dämmerung** | bürgerlich −6°, nautisch −12°, astronomisch −18° Sonnenhöhe. |
| **Seeing / Transparenz** | Luftruhe / Luftklarheit – im Astro-Wetter aus Windprofil bzw. Aerosol geschätzt. |
| **HiPS** | Hierarchical Progressive Surveys – kachelbasierte Himmelsbilder (CDS). |
| **Bortle-Klasse** | Skala 1–9 der Himmelsdunkelheit. |

---

## 14. Bildschirmkonzept

Grundlage sind die Bildschirme von Astro PM 1.6.0 (Screenshots), angepasst an unseren Umfang: ohne Bildverwaltung, Analyse-Tools, Community, Okulare und Custom Horizon; dafür mit Mandanten, Rollen, Warteschlange, Auswertung und Folgeplanung. Die Anwendung läuft eigenständig unter `https://nina-pm.svenesis.org`; die Gestaltung folgt dem Vorbild von svenesis.org (NFA-10, NFA-18).

### 14.1 Rahmen (Shell)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Kopf im Svenesis-Stil: Logo Svenesis.org · NINA-PM · Links zur Website (Astronomie …) · DE/EN │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ NINA-PM · Mandant „Starfront“ ▾ · 🔔 3 · ☀/🌙 · (Avatar) Sven (Admin) ▾                 │
├───────────────────┬────────────────────────────────────────────────────────────────────┤
│ Navigation        │ Brotkrumen: Projekte > Aktiv                    [Kontext-Aktionen]  │
│ (einklappbar,     ├────────────────────────────────────────────────────────────────────┤
│  Zähler-Badges)   │                                                                    │
│                   │  Arbeitsbereich                                                    │
│                   │                                                                    │
├───────────────────┴────────────────────────────────────────────────────────────────────┤
│ Fußzeile: Dichte kompakt | normal | weit · Standortzeit · Version · Hilfe              │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Navigation links** wie in Astro PM gruppiert, einklappbar; Zähler-Badges an Status-Einträgen und an der Warteschlange.
- **Kopf- und Fußzeile im Stil der Website** (eigene Umsetzung: Logo „Svenesis.org“ mit Link zur Website, Anwendungsname „NINA-PM“, Links zu den Hauptbereichen der Website, DE/EN; Fuß mit Impressum-Link zur Website, eigener Datenschutz- und Quellenseite); darunter App-Leiste mit Mandantenname (Wechsel), Benachrichtigungen (FA-FRG-11), Benutzermenü mit Discord-Avatar (persönliche Einstellungen, meine Anmeldesitzungen, Mandant wechseln, Abmelden).
- **Kontext-Aktionen** rechts oben je Seite (z. B. *Speichern*, *Einreichen*, *Freigeben*, *Simulieren*).
- **Erscheinungsbild**: hell wie svenesis.org als Standard, Dunkelmodus umschaltbar (NFA-10); kein Rotlicht-Modus.
- **Rollen**: nicht erlaubte Aktionen deaktiviert mit Tooltip „Nur Admin“ (FA-BER-01); User sehen dieselben Seiten lesend.
- **Bestätigungsdialog** (`ConfirmDialog`, E4): Vor folgenschweren Aktionen – **Löschen** (Projekt, Panel, Zeile, Stammdaten, Mandant), **Rechte entziehen**, **Owner übertragen** bzw. neu zuweisen, **Ablehnen**, **Token widerrufen**, **Anmeldesitzungen beenden** – erscheint ein einheitlicher Dialog: Titel, die Folgen in einem Satz, ein Aktionsknopf mit Verb (z. B. *Projekt löschen*) und *Abbrechen*, das beim Öffnen den Fokus hat. Eine Eingabe des Namens verlangt nur das Löschen eines Mandanten (FA-MAN-03). Weitere Sicherheitsabfragen gibt es nicht.

### 14.2 Navigationsstruktur

| Bereich | Einträge (Astro-PM-Vorbild → NINA-PM) | Admin | User |
|---|---|---|---|
| **Heute Nacht** | *(neu)* Übersicht je Rig | ✔ | L |
| **Ausrüstung** | Rigs (*Imaging Systems*) · Komponenten: Standorte, Teleskope, Kameras, Filter & Vorlagen, Mondprofile | ✔ | L |
| **Planung** | Sternkarte (*SkyView*) · Objektbrowser & Vorschläge *(neu)* · Exoplaneten | ✔ | ✔ |
| **Projekte** | Neues Projekt · **Projekte** (Schalter *Alle / Meine*; Status-Chips mit Anzahl: Entwurf, Eingereicht, Zurückgegeben, Abgelehnt · Planung, Aktiv, Pausiert, Bereit zur Bearbeitung, Unfertig, Abgeschlossen, Archiv) · Gelöscht *(Admin)* · **Warteschlange** *(alle; Aktionen Admin; Reiter Meine Rangfolge)* – „Meine Objekte“ und „Entwürfe“ entfallen (30.09.2026) | ✔ | E/L |
| **NINA** | Nacht-Simulator · An NINA ausgeliefert (*Manage Cloud Targets*) · NINA-Instanzen & Tokens · Anleitung | ✔ | L (ohne Tokens) |
| **Wetter** | Wettervorhersage je Rig/Standort | ✔ | ✔ |
| **Auswertung** | Nächte · Projekte (*Projects Report*, mit Prognose) · Standort-Statistik (seit AP-64, 07.10.2026; Kandidatennächte unter „Heute Nacht“) | ✔ | L |
| **Administration** | Benutzer · Mandanteneinstellungen · Änderungsprotokoll | ✔ | – |
| **System** *(nur Super User)* | Mandanten · Super User · Kataloge & System | – | – |

Entfallen gegenüber Astro PM: *Community / Gallery*, *Analysis Tools* (SubInspector, Single Image Analysis, Image Annotator), *Eyepieces*, *Share Equipment*, *Shared Projects* (Teilen als Datei optional ab R6), Rechner (erst R6).

### 14.3 Bildschirme im Detail

Die Bildschirme sind feldgenau in Prosa beschrieben; für die **drei datenintensivsten** (S-31 Projekt-Editor, S-40 Nacht-Simulator, S-61 Session-Detail) steht zusätzlich eine Anordnungsskizze wie in 14.1, weil dort die Platzierung über die Bedienbarkeit entscheidet. Die Skizzen zeigen die Laptop-Stufe (1280 px); die Verdichtung auf Tablet (768 px) und die Aufweitung auf Desktop (1600 px) legt TK 11.3 fest. Verträge der wiederverwendbaren Bausteine: `claude-code/docs/specs/ui/components.md`.

#### S-01 Anmeldung
Einstiegsseite `https://nina-pm.svenesis.org/` im Svenesis-Layout mit Kurzbeschreibung und Knopf **„Mit Discord anmelden“** (Discord-Logo), Hinweis zum Datenschutz. Nach Rückkehr von Discord: **S-01b Mandantenauswahl** (Karten je Mitgliedschaft mit Mandantenname, Rolle, zuletzt genutzt; bei Super Usern zusätzlich „System“) bzw. direkte Weiterleitung; **S-01c Kein Zugang**; **S-01d Einladung annehmen** (Mandant, Rolle, einladende Person, „Mit Discord anmelden und beitreten“). (FA-LOG-01 ff., FA-BEN-01)

#### S-02 Heute Nacht *(Startseite ab R3; bis dahin „Meine Objekte“ bzw. Projektliste)*
Je Rig eine Karte für die **aktuelle Nacht** des Standorts (Kap. 8.1 – nach Ende des Nachtfensters schon die folgende, NT-01): Standortzeit mit Kürzel, dunkle Stunden, Mond (Phase, Auf-/Untergang), Wetterbewertung der Nacht (Farbband aus Astro-Wetter), geplante Projekte mit erwarteten Frames (Kurzfassung der Simulation), NINA-Instanz zuletzt gesehen, Link zur Safety-/Wetterseite der Sternwarte. Darunter: ungeprüfte Sessions, offene Warteschlange (Admin), nahende Exoplaneten-Fristen. *Seit AP-64 (07.10.2026)* am Ende der Abschnitt **„Nächste Nächte“** aus der Folgeplanung: Kandidatennächte-Matrix, Saisonwarnungen mit Handlungsvorschlägen *(Admin)*, Wiederaufnahme und *Prognose neu berechnen*; „nur für die kommende Nacht“ steht im Plan der Nacht. (FA-FOL-03…07)

#### S-10 Rigs *(Imaging Systems)*
Kopf: Rig-Auswahl, Name, Notizen, Schalter „In Framing und Simulator anzeigen“ und „An NINA ausliefern“, **Rotator vorhanden** (mit Toleranz, „bei Abweichung überspringen“ und ohne Rotator *Gemessenen Winkel übernehmen*), **Nachtbericht nach Discord**, *Neu*, *Speichern*, *Löschen*. Darunter **drei Spalten**:
- **Standort**: Auswahl + *Bearbeiten*, Breite, Länge, Höhe, Bortle, Zeitzone, Sternwartentyp, Karte.
- **Teleskop**: Auswahl + *Bearbeiten*, Öffnung, Brennweite, Öffnungsverhältnis, Reducer, effektive Brennweite/Öffnungsverhältnis, Bauart; **Standard-Belichtungsplan**; **Standard-Rotation**; **Filterradbelegung des Rigs** (Position, Kurzname, Farbe, Bandbreite, NINA-Filtername mit Status; FA-RIG-14) + *Filter & Vorlagen bearbeiten*.
- **Kamera**: Auswahl + *Bearbeiten*, Auflösung, Pixelgröße, Sensorgröße, Typ, Ausleserauschen, Full Well, Bittiefe; Sensorgrößen-Vergleich.
Zusätzlich: abgeleitete Kennzahlen (Maßstab ″/px, Bildfeld), zugeordnete NINA-Instanzen, **Flat-Quelle** *Panel*/*Himmel* (FA-SCH-08, NT-40). (FA-RIG-01 ff.)

**Bereich *Gemessene Overheads*** (FA-RIG-04b, AP-65, 07.10.2026; Reiter *Scheduler*): Tabelle je Wert (Anfahren + Zentrieren, Filterwechsel, Dither-Settle, Autofokus-Dauer, Download, Meridian-Flip) mit *getippt*, *gemessen* (Median, n, p25–p75), *wirkt* (gemessen/getippt) und Schalter **„fest“** (Admin/Owner, speichert sofort; alle anderen lesend); Hinweis „weicht stark ab“, wenn der gemessene Wert mehr als doppelt bzw. weniger als halb so groß ist wie der getippte; darüber Zahl der Nächte und Stand der Messung.

**Bereich *Filterradbelegung – Zuordnung zu NINA*** (NT-E1, FA-RIG-14; bearbeiten nur Admin/Owner, alle anderen lesend): Tabelle je Filterradplatz mit Position, Web-Filter (Farbchip, Kurzname, Auswahl), **von NINA gemeldeter Name** an diesem Platz (aus dem letzten Heartbeat, mit Zeitpunkt und Instanz), **NINA-Filtername** (Auswahl aus den gemeldeten Namen, vorbelegt mit dem Vorschlag der Heuristik, Kap. 8.6), Status *bestätigt* (mit Datum und Person) / *Vorschlag – nicht bestätigt* / *nicht zugeordnet* / *von NINA geändert*; Aktionen *Bestätigen* je Zeile und *Alle Vorschläge bestätigen* (Bestätigungsdialog). Warnbox, wenn NINA eine andere Belegung meldet als bestätigt („Filterrad geändert – Platz 3: bestätigt „Ha“, NINA meldet „SII 3nm““) und Liste der Belichtungszeilen, die deshalb nicht geplant werden. Hat noch keine NINA-Instanz das Filterrad gemeldet: Hinweis „Zuordnung möglich, sobald NINA sich gemeldet hat“. Bei OSC-Kameras ohne Filterrad entfällt der Bereich.

#### S-11 Standorte
Links Formular (Auswahl +/-, Name, Pier, Sternwartentyp, Breite/Länge dezimal **und** °′″ synchron, Höhe m/ft synchron, Bortle, Zeitzone, Link Wetter/Safety, Notizen), Mitte **Remote-Verbindungen** als Linkliste ohne Passwörter, rechts **Karte**; unten **7-Tage-Astro-Wetter** des Standorts. (FA-STO-01 ff.)

#### S-12 Teleskope
Links Formular (Auswahl +/-, Bibliothek, Name, Hersteller, Modell, Bauart, Öffnung, Brennweite, Reducer, Obstruktion; aufklappbar *optionale Daten*, Notizen); rechts **Berechnete Werte** (nativ, mit Reducer, Auflösung Dawes/Rayleigh, Lichtsammelvermögen). Okular-Abschnitte entfallen. (FA-TEL-01 ff.)

#### S-13 Kameras
Links Formular (Grunddaten, Sensor, Pixel, Bittiefe, gekühlt, Farbe; **Standard-Betriebspunkt** Gain/Offset/Binning/Auslesemodus mit e⁻/ADU, RN, FW; QE, Dunkelstrom; **Gain-Modi** als Liste mit Editor; **Auslesemodi**; unterstützte Binning-Stufen; **Kühlung**: Soll-Temperatur und Toleranz, NT-E2). Rechts Reiter **Kameravergleich** / **Sensorgröße** und **Berechnete Werte** (Größe, Diagonale, MP, Seitenverhältnis, Dynamik, max. ADU, je Binning). Hinweisbox „NINA meldet abweichende Auslesemodi“ (FA-KAM-07). Kalibrierbild-Bibliothek entfällt.

#### S-14 Filter & Belichtungsplan-Vorlagen
Links Filterformular (FA-FIL-01). Rechts oben Reiter **Meine Sammlung** (Tabelle, Filter nach Teleskop, Summen nach Typ) / **Spektrum** (Durchlasskurven). Rechts unten **Vorlagen-Editor**: Teleskop + Kamera wählen, Vorlage wählen / *Neu* / *Löschen*, Name, Zeilentabelle (Filter, Belichtung, Anzahl, Mondprofil, Gain, Offset, Auslesemodus, Binning, Löschen), *+ Filter*, *Vorlage speichern*. (FA-FIL, FA-BPL)

#### S-15 Mondprofile
Liste der Profile (Built-ins gesperrt, klonbar), Formular mit den sechs Parametern, **Avoidance-Diagramm** über den Mondzyklus mit Vorschau der Änderung und optional Abstandskurve eines gewählten Projekts. (FA-MON-01 ff.)

#### S-20 Sternkarte *(SkyView)*
- **Werkzeugleiste oben** in Abschnitten: *Suche & Position* (Suche, RA, Dec) · *Rig* (Auswahl, Standort) · *Ausrüstung* (Teleskop, Kamera, Rahmenfarbe; optional Vergleichs-Rig) · *Bildfeld* (FOV, Maßstab, Brennweite, Rotation mit Slider, Zurücksetzen, **Anheften als Rig-Standard**) · *Mosaik* (H-/V-Panels, Überlappung) · Aktionen *Neues Projekt*, *Vollbild*.
- **Himmelskarte** mittig (Svenesis-`sky-map.js`), Bildfeld-Rahmen verschiebbar.
- **Seitenleiste rechts** mit Reitern *Himmelsfotos* · *Kataloge* · *Overlays*: Projekt-Overlays (Eingereicht, Planung, Aktiv, Favoriten, Unfertig, Abgeschlossen), Koordinaten (äquatorial, Alt/Az, Ekliptik, galaktisch), Beobachter (Horizontlinie 0°, Mindesthöhe, Meridian, Zenit, Heatmap mit Höhen-Slider), Sonnensystem (Sonne, Taghimmel, Mond, Planeten). *Horizont-Panorama und Custom Horizon entfallen.*
- **Zeitsteuerung unten**: Datum, Uhrzeit, −1 d/−1 h/−10 min/Play/+10 min/+1 h/+1 d, *Jetzt*, Mondinfo („Mond −76° · 107° Abstand“), Zoom; 24-h-Zeitleiste mit Dämmerung, Zielhöhe, Scrubber.
(FA-FRM-01 ff.)

#### S-21 Objektbrowser & Zielvorschläge *(neu)*
Filterleiste (Katalog, Objekttyp als Anzeigegruppe, Sternbild, Helligkeit, Flächenhelligkeit, Größe, Nacht, min. nutzbare Stunden, „passt ins Bildfeld“ des gewählten Rigs), Umschalter *Liste / Galerie*, Reiter *Alle Objekte* / *Beste der Nacht* (Svenesis-Bewertung). Zeile: Objekt, Aliase, Typ (Anzeigegruppe, OpenNGC-Typcode im Tooltip), Sternbild, Größe, Helligkeit mit Band (V oder B), Flächenhelligkeit, beste Zeit/Höhe, Mond, nutzbare Stunden, Aktionen *Sternkarte*, *Projekt anlegen*. (FA-FRM-13, FA-FRM-15)

#### S-22 Exoplaneten
- **Filterleiste**: Rig, Nacht (◀ ▶, *Heute Nacht*), Kataloge, Priorität, max. Sternhelligkeit, min. Tiefe, min. Höhe, Kontrollkästchen (nur beobachtbare, Start/Ende nautisch dunkel, Start/Ende über Mindesthöhe, Meridian-Flip zeigen, Transits mit Flip ausblenden), Trefferzahl, *Transits suchen*. (Die Kataloge aktualisiert der Super User in S-82, FA-SU-08 – hier steht nur das Datum des letzten Abrufs.)
- **Ergebnistabelle** (sortierbar): Priorität, Planet, Katalog, Typ, Stern (Spektralklasse · Teff), empf. Filter, Entfernung (Lj), Mag, Tiefe, Datum, Ingress, Mitte, Egress, Dauer, Periode, Höhe @ Mitte, Mondabstand, O−C, Meine Beob., benötigte Öffnung (farbig), Recherche-Links, Aktionen *Framing*, *Projekt*.
- **Zeitleiste** der gewählten Nacht (Mittag–Mittag) mit Lichtkurve, Kontaktzeiten, Höhen, Mond, Mindesthöhe, Meridian-Flip, Jetzt-Linie.
- **Unten**: Sternfeld (DSS2) · Himmelslage · Reiter *Zieldetails* / *Meine Beobachtungen*.
(FA-EXO-01 ff.)

#### S-30 Projektliste *(je Status)*
Filterleiste (Suche, Schalter *Alle / Meine*, Rig, Objekttyp, Ersteller, Favoriten, Aufwand), darunter **Status-Chips mit Anzahl** (vor der Freigabe Freigabestatus, danach Projektstatus; Mehrfachauswahl; Status, *Meine* und Gruppierung in der Adresse), Gruppierung *je Rig / je Status / keine* (Priorität nur je Rig), Spalte *Zuletzt geändert*, Ansichtsumschalter Liste/Karten/Detail, Hinweis „Priorität per Ziehen am linken Rand (nur Admin)“. **Gruppen je Rig** mit Kopfzeile (Rig · Standort · Teleskop · Kamera, Zähler „2 Aktiv“). **Projektkarte** gemäß FA-PRJ-14 (links Vorschaubild und Aktionen; Mitte Reiter *Zielinfo* / *Höhenkurve*, Kennzeichen, Koordinaten, Rig, Transitzeile, Fortschritt; rechts akzeptierte Frames je Filter und geschätzte Gesamtintegration). Freigabestatus-Kennzeichen bei User-Objekten. *Löschen* auf der Karte mit Bestätigungsdialog. Liste **„Gelöscht“** *(Admin)*: weich gelöschte Projekte mit Löschzeitpunkt, Rig, Ersteller und *Wiederherstellen*; kein endgültiges Löschen aus dieser Liste (FA-PRJ-15).

#### S-31 Projekt-Editor

Anordnung (Laptop-Stufe, 1280 px; darunter werden die drei Spalten des oberen Bereichs untereinander gestapelt):

```
┌─ Brotkrumen: Projekte › Aktiv › NGC 281 ───────────── [Speichern] [Einreichen] [⋯ Erweitert] ─┐
│ ‹ Zurück   NGC 281 Pacman   [Status: Aktiv ▾] [Rig: Starfront ▾]   ca. 3 Nächte ⓘ            │
├────────────────────────────┬────────────────────────────┬──────────────────────────────────────┤
│ Zielinformationen          │ Bedingungen                │ Vorschaubild (Himmelsfoto)           │
│ Name · Typ · Startdatum    │ Mindesthöhe    30°         │ ┌──────────────────────────────────┐ │
│ RA  00h 52m 49s            │ Mindestzeit    1,0 h       │ │                                  │ │
│ Dec +56° 37′ 48″           │ Dämmerung      astronom. ▾ │ │                                  │ │
│ Rotation 90,0°             │ Mond  [Profil: Streng ▾]   │ └──────────────────────────────────┘ │
│ Bildfeld 1,7° × 1,1°       │   Abstand 90° · Breite 8 d │ Standort · Teleskop · Kamera         │
│ Katalognamen · Beschreibung│   Höhe −15…5° · Illum 30 % │ Maßstab 2,03″/px · FOV 1,7°×1,1°     │
│ [Aus Sternkarte laden]     │ [Als Standard setzen]      │ Recherche: SIMBAD · Astrobin · NED   │
│ [Mosaik bearbeiten]        │                            │                                      │
├────────────────────────────┴────────────────────────────┴──────────────────────────────────────┤
│ [Diagramme] [Wetter] [Exoplanet-Transit] [Kommentare] [Freigabe-Verlauf]                       │
│ ┌ Nachtdiagramm ‹ 17./18.09. ›  Mittag ──── Dämmerung ▓▓ Dunkelheit ▓▓ ──── Mittag ─────────┐ │
│ │  Höhenkurve, 30°-Linie gestrichelt, Mondband, Jetzt-Linie                                 │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Panel 1] [Panel 2] [Panels] [Sessions & Protokoll]  [Vorlage anwenden ▾] [Vorlagen…] [Export]│
│ Schnelleingabe: [Filter ▾] [300 s] [◉ Anzahl 40 ○ Stunden] [Hinzufügen]                       │
│ ┌─┬────┬──────┬─────┬──────┬───────┬─────┬─────┬──────────────┬────┬────┬───┬────┬─────┬────┐ │
│ │☑│ Ha │Streng│300 s│  60  │  22   │  2  │ 20  │ ▓▓▓▓▓░░░ 33 %│100 │ 20 │ 1 │High│5,0 h│ ⋯  │ │
│ │☑│OIII│Moder.│300 s│  60  │  10   │  0  │ 10  │ ▓▓░░░░░░ 17 %│100 │ 20 │ 1 │High│0,8 h│ ⋯  │ │
│ └─┴────┴──────┴─────┴──────┴───────┴─────┴─────┴──────────────┴────┴────┴───┴────┴─────┴────┘ │
│ Filter: 3 · GEPLANT 180 Frames / 15,0 h · AKTUELL 32 / 2,7 h · Gesamtfortschritt 18 %         │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Kopf**: neben Name und Status das **Aufwand-Kennzeichen** mit Tooltip; aktualisiert sich live beim Ändern von Plan und Bedingungen (FA-PRJ-23).
- **Kopf**: *Zurück*, Titel, Status-Auswahl *(Admin)*, Rig-Auswahl, *Speichern*, *Einreichen* (öffnet Dialog mit Wunsch-Rig, Zeitraum, Begründung; für User und – bei ausgeschaltetem FA-FRG-10 – Admins) bzw. *Freigeben/Zurückgeben/Ablehnen* *(Admin, bei eingereichten fremden Objekten)*, *Änderungsantrag stellen* (ab R3, freigegebene eigene Objekte), *Transit festlegen* (Exoplaneten, Ersteller/Admin), Start- und Zieltermin, *Duplizieren*, *Löschen* (Bestätigungsdialog, weich, FA-PRJ-15), Menü *Erweitert* (Export, Verlauf).
- **Oberer Bereich (3 Spalten)**: *Zielinformationen* (Name, Typ, Startdatum, RA/Dec in h m s / ° ′ ″, Rotation, Bildfeld read-only, Katalognamen, Beschreibung Markdown; *Aus Sternkarte laden*, *Mosaik bearbeiten*) · *Bedingungen* (Mindesthöhe, Mindestzeit, Dämmerung, Mondvermeidung mit Profil/Werten, *Als Standard setzen*) · *Vorschaubild* aus Himmelsfotos + Ausrüstungsspalte (Standort, Teleskop, Kamera, Maßstab, FOV) + Recherche-Links.
- **Mittlerer Bereich, Reiter**: *Diagramme* (Nachtdiagramm mit Tagesauswahl und Legende · Saisondiagramm 1/3/6 Monate/Jahr) · *Wetter* · *Exoplanet-Transit* *(nur Typ Exoplanet)* · *Kommentare* (FA-PRJ-17) · *Freigabe-Verlauf*.
- **Unterer Bereich, Belichtungsplan**: Reiter je Panel (*Panel 1 …*; bei nur einem Panel heißt der Reiter *Belichtungsplan*), *Panels* und *Sessions & Protokoll* (freigegebene Projekte; Geplantes und Aufgenommenes in einem Bereich, Sven 04.10.2026), Schnelleingabe (Filter, Belichtung, Anzahl **oder** Stunden, *Hinzufügen*), Auswahl *Vorlage anwenden* (gesperrt nach Projektbeginn), *Vorlagen bearbeiten*, *Export*. Tabelle: An/Aus, Filter-Chip, Mondprofil, Belichtung, Geplant, Aufgenommen, Verworfen, Akzeptiert, Bonus, Fortschrittsbalken, Gain, Offset, Binning, Auslesemodus, Gesamtzeit, % erledigt, Aktionen (*Korrektur*, *Nächte*, *Zeile duplizieren*, *Löschen*). Bei Zeilen mit Aufnahmen sind Filter, Belichtung, Gain, Offset, Binning und Auslesemodus gesperrt (Schloss-Symbol mit Tooltip „Zeile hat Aufnahmen – für andere Einstellungen *Zeile duplizieren*“, FA-PRJ-05). Zeilen, deren Filter auf dem Rig nicht bestätigt zugeordnet ist, tragen das Kennzeichen *Filter nicht zugeordnet* mit Link zur Rig-Seite (FA-RIG-14). Fußzeile: **Filter: n** · **GEPLANT** Frames/Stunden · **AKTUELL** Frames/Stunden · **Gesamtfortschritt %**.
- Entfallen gegenüber Astro PM: Remote/Local-Ordner, Status „Synced“, Inspected, SubInspector-Buttons, Reiter *Calibration Frames*, Bildslots Referenz/Final, *Share Project*, *Target to Cloud* (Auslieferung erfolgt automatisch bei Status *Aktiv* + freigegeben).

#### S-32 Meine Objekte *(entfällt)* · S-33 Warteschlange *(alle; Aktionen Admin)* · S-34 Entwürfe *(entfällt)*
- **Meine Objekte** *(seit 30.09.2026 in S-30 und S-33)*: eigene Objekte über den Schalter *Meine* und die Status-Chips der Projektliste; die ziehbare Rangliste (Griff, Rang, Objekt, Stimmen, Frist, *Zurückziehen*) ist der Reiter *Meine Rangfolge* der Warteschlange; alte Adresse leitet auf `/projekte?meine=1` weiter. (FA-FRG-13, FA-FRG-15)
- **Warteschlange**: Tabelle (Frist, Objekt, Typ, Einreicher, Rang beim Einreicher, **Aufwand** („1 Nacht“ / „ca. 4 Nächte“ / „nicht machbar 60 %“ / „Transit“), **Plan** (Filter-Chips „Ha 40 × 300 s“; Tooltip mit Gain/Offset/Binning/Auslesemodus, Mondprofil und Bedingungen), **Stimmen** mit Knopf 👍 und Namen im Tooltip, eingereicht am, Wunsch-Rig, Zeitraum, geschätzter Bedarf, Sichtbarkeit 4 Wochen als Mini-Balken); Filter „nur ohne meine Stimme“, „geändert seit meiner Stimme“ und nach Aufwand. User sehen Tabelle und Detail lesend (Objekt öffnet im Projekt-Editor, schreibgeschützt) und können abstimmen. Für Admins zusätzlich Detailbereich mit Objektzusammenfassung, **Auswirkungsvorschau** (Simulation mit/ohne) und Aktionsleiste *Freigeben* (Rig, Priorität mit vorgeschlagener Einfügeposition, Status, Kommentar) · *Zurückgeben* · *Ablehnen* (Bestätigungsdialog). Reiter *Änderungsanträge* mit Gegenüberstellung alt/neu. (FA-FRG-04 ff.)
- **Entwürfe** *(seit 30.09.2026 in S-30)*: Chips *Entwurf* und *Zurückgegeben* der Projektliste – Admins sehen dort die Entwürfe aller Mitglieder mit Ersteller und *Zuletzt geändert*; alte Adresse leitet auf `/projekte?status=draft,returned` weiter. (FA-BER-02)

#### S-40 Nacht-Simulator

Anordnung (Laptop-Stufe; die drei Schritte stehen untereinander und sind einklappbar):

```
┌─ Projekte › NINA › Nacht-Simulator ───────────────────────────── [Simulieren] [Mehrnacht] ────┐
│ Rig: [Starfront – GT81 – Ares-M ▾]   Standort Starfront   Teleskop GT81                       │
├────────────────────────────────────────────────────────┬───────────────────────────────────────┤
│ ▾ Schritt 1 – Strategie & Einstellungen  (Admin)       │ An NINA übertragen                    │
│ ⓘ So funktioniert es …                                 │ Starfront-PC  v12 übern. 13:02 CDT ✓  │
│ Strategie [proportional ▾]  Wiedergabe [zeitgeführt ▾] │ Ersatz-PC     Änderung nicht abgerufen│
│ Bonus ☐  Überschuss 0 %   Mosaik-Panels getrennt ☑     │ ⓘ Beispielsequenzen herunterladen     │
│ Dither alle [1]  Filterwechsel alle [40] ± [50 %]      │                                       │
│ Flats ☑ [20]  Dark-Flats ☑ [—]  vollst. Satz ☐         │                                       │
│ Meridian-Flip ☑ nach [5] max [15] Pause [0] Dauer [240]│                                       │
│ Sortierkette:  ⠿ geringste Maximalhöhe  ⠿ bald unterg. │                                       │
│                zuerst unter  ⠿ meiste Restzeit  ⠿ …    │                                       │
├────────────────────────────────────────────────────────┴───────────────────────────────────────┤
│ ‹ 17./18.09.2026 ›   [Heute Nacht]   Standortzeit 19:05 CDT · dunkel 9,0 h · Ziele 2 ·         │
│                      Frames 322 · Mond 12 %      ☐ Mit meinen Entwürfen simulieren             │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ▾ Schritt 2 – Zielkarten                                                                       │
│ ┌ HAT-P-17 b  Transit ────────┐ ┌ NGC 281  Ha ───────────┐ ┌ nicht zugeteilt ─────────────────┐│
│ │ 21:08–02:34 · 305 × 60 s    │ │ 02:35–04:20 · 17 × 300s│ │ M 31   Mond blockiert            ││
│ │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100 %      │ │ ▓▓▓▓▓░░░ 85 %          │ │ IC 1805  überstimmt              ││
│ └─────────────────────────────┘ └────────────────────────┘ └──────────────────────────────────┘│
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ▾ Schritt 3 – Plan (Standortzeit CDT)                     [Kopieren] [CSV]                     │
│ 19:00 ──┬─ Dämmerung ─┬─ 21:08 ▓▓▓▓ Transit HAT-P-17 b ▓▓▓▓ 02:34 ▓▓ NGC 281 ▓▓ 04:20 ── 08:00 │
│         │             │            ⚑ Flip 23:33 (im Fenster)      ⚑ Flip 02:48                 │
│ ┌ Protokoll ────────────────────────────────────────────────────────────────────────────────┐  │
│ │ 21:05:30  slew_center_rotate  HAT-P-17 b                                                  │  │
│ │ 21:08:00  expose_series  R 60 s bis 02:34:00  (305 Aufnahmen, Flip-Lücke ab 23:33)        │  │
│ └───────────────────────────────────────────────────────────────────────────────────────────┘  │
│ ⚠ no_alloc (warn): Arbeit und nutzbare Zeit, aber keine Belichtung – Transitfenster sperrt …   │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Kopf**: Rig-Auswahl, Standort, Teleskop.
- **Schritt 1 – Strategie & Einstellungen** *(Admin bearbeitbar)*: Infobox „So funktioniert es“, Strategie, Wiedergabe (mit Erklärtext), Bonus + Überschuss %, Mosaik-Panels getrennt planen, Dither alle N, Filterwechsel alle N + Toleranz, Flats + Anzahl, Dark-Flats + Anzahl, vollständiger Flat-Satz, Flat-Quelle (*Panel*/*Himmel*, NT-40), Meridian-Flip (aktiv, Minuten nach Meridian, maximal, Pause vor Meridian, Dauer; Warnung bei Abweichung zum NINA-Profil oder fehlendem Flip-Trigger), **Sortierkette** als ziehbare Chips, Kennzeichen „an NINA übertragen (Version n)“.
- **Übernahmestatus** rechts über Schritt 1: je NINA-Instanz „v12 übernommen 13:02 CDT“ (Standortzeit mit Kürzel, NT-03) bzw. „Änderung noch nicht abgerufen“ (FA-SIM-09); Infobox mit *Beispielsequenzen herunterladen* (FA-NIN-25).
- **Datumszeile**: ◀ Datum ▶, *Heute Nacht*, *Simulieren*, Kopfzahlen (Standortzeit · dunkle Stunden · Ziele · Frames · Mond %). Für User zusätzlich *Mit meinen Entwürfen und eingereichten Objekten simulieren*.
- **Schritt 2 – Zielkarten** (FA-SIM-06), nicht zugeteilte Projekte mit Grund (FA-SIM-03).
- **Schritt 3 – Plan**: Plangrafik (FA-SIM-07) und Planprotokoll (FA-SIM-08) mit *Kopieren* / *CSV*.
- *Mehrnacht-Simulation* (7/14 Nächte) als eigener Reiter. (FA-SIM-04)

#### S-41 An NINA ausgeliefert *(Cloud Targets)*
Infobox, was NINA erhält; Filter Standort/Teleskop/Kamera bzw. Rig, Gruppieren, Sortieren, *Aktualisieren*. Karte je Ziel: Name, Status, Einzelfeld/Mosaik, RA/Dec, Rotation, Rig, Stand, Fortschritt je Filter; Aktion *aus Auslieferung nehmen* *(Admin)*. (FA-NIN-22)

#### S-42 NINA-Instanzen & Tokens *(Admin)*
Tabelle (Name, Rig, Token-Präfix, Status, Plugin-/Engine-Version, Profil-Standort mit Abweichungswarnung, zuletzt gesehen, letzter Zustand), *Neue Instanz* (Token einmalig anzeigen; Tokens haben kein Ablaufdatum), *Widerrufen* (Bestätigungsdialog, wirkt sofort), *Löschen* nur ohne Sessions (Bestätigungsdialog), Schalter *Widerrufene anzeigen* (aus), Diagnose (letzte Aufrufe, Fehler). (FA-ADM-02, FA-ADM-06)

#### S-50 Wettervorhersage
Kopf: Rig/Standort-Auswahl, Koordinaten, Zeitzone, Standortzeit und eigene Ortszeit. Hauptbereich: **7-Tage-Astro-Wetter** (Svenesis-Grafik, Zeilen von oben nach unten: Sonne/Mond, **Gesamtbewertung** als Ampel, **Gesamtbedeckung**, Wolken hoch/mittel/tief, **ECMWF IFS** und **feines Vergleichsmodell** (HARMONIE AROME bzw. GEM/NBM), Seeing, Transparenz, Wind mit Böen, Höhenwind (Jet und Scherung), Temperatur/Taupunkt, Regen und Regenwahrscheinlichkeit, Staub, Sicht, Wettersymbol, **Modellkürzel je Stunde**; dazu Nachtfenster und Jetzt-Linie, Tooltip je Stunde mit allen Rohwerten und den Teilbewertungen). Gekennzeichnet werden Stunden „ohne Aerosol – Bewertung optimistisch“ (ab Tag 5, keine Transparenz) und *Seeing unvollständig*. Nachttabelle je Nacht mit Bewertung, Abdeckung, dunklen und mondlosen Stunden und dem **besten zusammenhängenden Fenster** (Beginn–Ende, Dauer, mondfreier Anteil), Klick ins Nachtdetail; optional meteoblue-Karte nach Klick. Niederschlag ist Anzeige und geht in keine Bewertung ein (Hinweis in der Legende). *(Astro PMs eigene Wolkenkarte/Satellitenfilm wird nicht nachgebaut.)* (FA-WET-01 ff.)

#### S-60 Nächte · S-61 Nacht

*Neu geordnet 07.10.2026 (Entscheidungen Sven, Brief AP-64):* Die Auswertung hat **ein** Navigationsmuster – Bereichsreiter **Nächte | Projekte | Standort-Statistik** als Segmentsteuerung im Seitenkopf – und einen gemeinsamen Filter **Rig + Zeitraum** (letzte 30/90/365 Nächte, dieses Jahr, von–bis) in der Adresse, der beim Reiterwechsel und beim Zurück erhalten bleibt. Das Menü „Auswertung“ führt auf Nächte; die alten Pfade (Sessions, Projektbericht, Klarnacht-Statistik, Folgeplanung) leiten um.

Anordnung S-61 (Laptop-Stufe, Skizze vom 07.10.2026):

```
← Nächte
Di 06./07.10. · SFRO-Rig                               21:09 CDT – 06:52 CDT · NINA-Instanz Rig-PC   [⋯]
[Übersicht] [Aufnahmen 729] [Verlauf & Notizen]
┌ Nacht prüfen · offen: 2 ───────────────────────────────────────────────────── [Als geprüft markieren] ┐
│ ✓ Alle 729 Lights einem Projekt zugeordnet                                                              │
│ ! IC 1795 · SII 1 von 6 geplant  Grund erfassen                                                         │
│ ! 20 min Leerlauf (03:22–03:43)  ansehen                                                                │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
[Dunkel 9,6 h] [Belichtet 8,2 h · 85 %] [Lights 579] [Flats · Dark-Flats 100 · 50] [Leerlauf 41 min] [Flip · AF 1 · 4]
┌ Nachtgrafik mit Ist (Himmel, Projektbalken, Filterleiste, Lücken schraffiert, AF-Marken) ─────────────────┐
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ Ergebnis je Projekt ────────────────── Soll = erster Plan dieser Session ohne Bonus · Ist = diese Session ┐
│ WASP-3b  (SvenR)   [RED Serie 20:11–00:54 · 558 ✓]                                  4,7 h  [Details] │
│ IC 1795  (SvenR)   [HA 10/10 ✓] [OIII 10/10 ✓] [SII 1/6 !]                          3,5 h  [Details] │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Nächte** (S-60): Kennzahlen für Rig und Zeitraum – Nächte mit Session (davon nutzbar, ≥ 1 h belichtet), Integration (Lights, Projekte), Effizienz Ø (belichtet von der Dunkelzeit), **Ungeprüft** (Nächte) als Link auf die neueste ungeprüfte Nacht. Darunter **eine Karte je Nacht und Rig** (mehrere Sessions zusammengefasst: Effizienz über die Nacht, Chips summiert, ungeprüft solange eine Session ungeprüft ist, Hinweis „2 Sessions“; Entscheidung Sven 07.10.2026): Datum mit Wochentag und Wetterpunkt mit Bewertung, Effizienzbalken („8,2 von 9,6 h · 85 %“), Projekt-Chips (Projekt, Ersteller, Frames je Filter bzw. „Transit · RED 558“), Plakette geprüft/ungeprüft, *Öffnen*. Nächte ohne Session erscheinen grau, wenn die Standort-Statistik sie als bewölkt führt. Schalter *Nur ungeprüfte* über der Liste; die Liste lädt seitenweise. (FA-AUS-01, FA-AUS-05, FA-AUS-07)
- **Nacht** (S-61, `/auswertung/naechte/{Rig}/{Nacht}`) bleibt im Bereich: Link „← Nächte“ statt Brotkrumen, drei Reiter. Hat die Nacht mehrere Sessions, wählt eine Segmentsteuerung „Ganze Nacht | Session 1 · 20:00–01:10 | Session 2 · …“ (Standard ganze Nacht für Grafik, Kennzahlen, Aufnahmen und Verlauf); Soll/Ist und Prüfen stehen je Session mit eigener Kopfzeile, seltene Aktionen (*Prüfung zurücknehmen*, *Nachtbericht erneut senden*) in deren ⋯-Menü. Alte Session-Links (Discord, Lesezeichen) führen auf die Nacht und wählen die Session vor.
  - *Übersicht*: Prüf-Banner, solange die Nacht ungeprüft ist (Prüfliste aus den Daten, am Ende *Als geprüft markieren* *(Admin)*); Kennzahlenleiste (Dunkel, Belichtet, Lights, Flats · Dark-Flats, Leerlauf, Flip · Autofokus); Nachtgrafik mit Ist (derselbe Baustein wie Simulator und „Heute Nacht“, vergangene Nacht ohne Plan-Rest); **Ergebnis je Projekt** mit Filter-Chips „HA 10/10 ✓“, „SII 1/6 !“, Transit als „Serie 20:11–00:54 · 558“, Integration und *Details* – darin Soll/Ist je Zeile mit *Korrektur* (FA-AUS-06; Verworfen- und Bonus-Spalten nur bei Werten > 0) sowie Abweichungsgründe, Overhead und Plan-Treue der Nacht. Soll = erster Plan der Session ohne Bonus, Ist = Aufnahmen dieser Session. (FA-AUS-02…06, FA-AUS-09)
  - *Aufnahmen*: Typ-Chips mit Anzahl (Alle, Lights, Flats mit Dark-Flats, Abweichung, Ohne Zuordnung, Verworfen), *CSV*; HFR- und Sterne-Verlauf über die Nacht (FA-AUS-08); Tabelle mit sieben Spalten (Zeit, Projekt + Ersteller, Filter, Belichtung, HFR, Sterne, Ergebnis), Kennzeichen *Temperaturabweichung* (NT-E2) und *Einstellungen abweichend* (NT-E3) als Symbol am Ergebnis; *Verwerfen* und *Zuordnen* über ⋯ je Zeile (FA-AUS-20, FA-AUS-22). Beim Chip *Flats* steht die Kombinationsübersicht (Flats und Dark-Flats Ist/Soll, Belichtung) als Kopfzeile.
  - *Verlauf & Notizen*: Ereignisse als Zeitachse (Standortzeit mit Kürzel) neben dem Sitzungsprotokoll mit Quellen-Kennzeichen (FA-AUS-14/15).
  - *Transits* (Abdeckung, Ergebnisimport) folgt mit AP-45; bis dahin steht die Transit-Abdeckung in der Projektzeile.

#### S-62 Folgeplanung · S-63 Projekte · S-64 Standort-Statistik
- **Folgeplanung** (S-62) ist seit AP-64 kein eigener Bildschirm mehr: Restbedarf und Prognose zeigt *Projekte* („Voraussichtlich fertig“), Kandidatennächte-Matrix (Nächte × Projekte, Ampel), Saisonwarnungen mit Handlungsvorschlägen *(Admin)* und Wiederaufnahme stehen als Abschnitt **„Nächste Nächte“** auf „Heute Nacht“ (S-02); „nur für die kommende Nacht“ steht dort im Plan der Nacht. (FA-FOL-01 ff.)
- **Projekte** (S-63, bisher Projektbericht): Filter Status und Objekttyp zusätzlich zu Rig und Zeitraum; eine Zeile je Projekt mit Ersteller, Art und belichteter Integration, Fortschrittsbalken je Filter („10/10“) und **„Voraussichtlich fertig“** aus der Prognose (realistisch, darunter optimistisch) bzw. der Saisonwarnung „Saison endet in n Nächten“ in Hinweisfarbe; *Verlauf* klappt gestapelte Balken je Nacht und Filter mit kumulierter Linie, die Nächte mit Link auf die Nacht, Kanalbalance und Bedingungen auf; *CSV*, *Drucken*. (FA-AUS-10/11/13/18, FA-FOL-01/02/04)
- **Standort-Statistik** (S-64, bisher Klarnacht-Statistik; der Name grenzt sie von der Wettervorhersage ab): Standort des gewählten Rigs (Auswahl *Standort*, vorbelegt); Kalender der letzten drei Monate im Zeitraum, ein Kästchen je Nacht (klar und belichtet, klar aber nicht genutzt – schraffiert –, teilweise, bewölkt, keine Angabe – gestrichelt) mit Tooltip (Stunden, Vorhersage, Seeing, SQM) – Klick öffnet die Nacht bzw. ohne Session *bewölkt erfassen* *(Admin)*; Kacheln *Nutzbare Nächte* (≥ 1 h belichtet, dazu „davon klar, ungenutzt“ – seit AP-64b, 07.10.2026, auch Nächte ohne Session mit gespeicherter guter Vorhersage; ohne Session und mit Vorhersage unter „gut“ erscheint die Nacht als „bewölkt“, nur Anzeige) und *Vorhersage stimmte* (nur Nächte mit Session); SQM- und Seeing-Verlauf als Balken; *Alle Nächte als Tabelle*. (FA-AUS-16/17)

#### S-70 … S-73 Administration · S-80 … S-82 System
**S-70** Mitglieder & Einladungen (Owner-Kennzeichen, Hinweis „Rechte ruhen – 2FA fehlt“; *Zu Admin machen* mit optionalem Grund (landet im Änderungsprotokoll) – ohne Befristung –, *Admin-Rechte entziehen* (Bestätigungsdialog), *Owner übertragen* (Auswahl eines aktiven Admins, Bestätigungsdialog, wirkt sofort) – nur für den Owner sichtbar; *Mandant verlassen* im Benutzermenü) · **S-71** Mandanteneinstellungen (inkl. Reiter *Discord*: Server, Kanal-Liste mit Kategorien, Ereignisfiltern, Testnachricht, letzter Zustellung/Fehler; **kein** Reiter *Sicherheit* – Sitzungsdauer und 2FA-Regel sind fest, SV-03) · **S-72** Änderungsprotokoll (ohne Anmeldeprotokoll, SV-11) · **S-73** Persönliche Einstellungen und Anmeldesitzungen (*Beenden* je Sitzung, *Überall abmelden*, jeweils mit Bestätigungsdialog) · **S-80** Mandanten (Owner-Spalte bzw. „Owner ausstehend“, *Owner-Einladung*, *Owner neu zuweisen* mit Begründung und Bestätigungsdialog, *Löschen* mit Eingabe der Mandanten-ID) · **S-81** Super User · **S-82** Kataloge, System-Audit (Super User und `ops-cli`) & Wartungshinweis.
Mitglieder und Einladungen (FA-BEN), Mandanteneinstellungen (FA-MAN-05), Änderungsprotokoll, persönliche Einstellungen; Super-User-Seiten Mandanten, Super User, Kataloge & System (FA-SU).

### 14.4 Wiederverwendbare Bausteine (UI-Komponenten)

Diese Liste nennt Zweck und Einsatzorte. **Der verbindliche Vertrag je Baustein** – Eigenschaften, Zustände (leer/laden/Fehler/deaktiviert), Mindest- und Höchstgrößen, Tastaturbedienung, Verhalten bei Überlauf, in beiden Themes und in den drei Dichtestufen – steht in `claude-code/docs/specs/ui/components.md`. Fünf Arbeitspakete liefern Bausteine (AP-06b, AP-10, AP-13e, AP-24, AP-25); ohne den gemeinsamen Vertrag würde der erste das Verhalten für alle festlegen.

| Komponente | Einsatz |
|---|---|
| Filter-Chip (Farbe, Kurzname) | Projektkarte, Editor, Simulator, Protokoll, Filterliste |
| Fortschrittsbalken + „x/y × t“ | Projektkarte, Editor, NINA-Auslieferung, Meine Rangfolge |
| Nacht-Zeitleiste (Mittag–Mittag, Dämmerung, Höhen, Mond, Jetzt) | Nachtdiagramm, Simulator, Exoplaneten, Sternkarte, Session-Soll/Ist |
| Saison-/Monatsdiagramm | Projekt-Editor, Objektbrowser |
| Astro-Wetter-Grafik | Wetter, Standort, Projekt, Heute Nacht |
| Koordinaten-Eingabe (dezimal ↔ h m s / ° ′ ″) | Standort, Projekt, Sternkarte |
| Rig-Auswahl mit Kurzinfo | Sternkarte, Simulator, Exoplaneten, Wetter, Listenfilter |
| Status-/Freigabe-Kennzeichen | alle Projektansichten |
| Prüfliste ✓/✗ | Zielkarten, Einreichen-Dialog |
| Bestätigungsdialog `ConfirmDialog` (Titel, Folgen in einem Satz, Aktionsknopf mit Verb, *Abbrechen* fokussiert; Namenseingabe nur beim Mandanten-Löschen) | Löschen (Projekt, Panel, Zeile, Stammdaten, Mandant), Admin-Rechte entziehen, Owner übertragen/neu zuweisen, Ablehnen, Token widerrufen, Anmeldesitzungen beenden |

---

## 15. Anhang A – Abgleich mit Astro PM 1.6.0

### 15.1 Erkenntnisse aus den Screenshots

| Bereich | Erkenntnis | Übernommen in |
|---|---|---|
| Navigation | Gruppen Equipment / Framing / Projects / Weather / NINA mit Status-Zählern; Umschalter für die Darstellungsdichte (bei Astro PM als Layout Tablet/Laptop/Desktop; bei uns als Dichte kompakt/normal/weit, weil die App immer die volle Fensterbreite nutzt) | 14.1, 14.2, NFA-01 |
| Imaging Systems | Drei-Spalten-Ansicht Site/Telescope/Camera; Standard-Plan; Standard-Rotation („Pin“ in SkyView); Filter des Teleskops; Schalter „Show in SkyView & Simulator“ | FA-RIG-05/08/09, S-10 |
| Site | Grad dezimal ↔ °′″, m ↔ ft; Remote Connections; Karte; Wetter eingebettet | FA-STO-05/06, S-11 |
| Kameras | Binning-Stufen, Gain-Modi-Editor, Vergleich/Sensorgröße, berechnete Werte je Binning | FA-KAM-06/08, S-13 |
| Filter | Sammlung mit Teleskop-Zuordnung, Spektrum-Ansicht, Vorlagen-Editor auf derselben Seite | FA-FIL-06, FA-BPL-06, S-14 |
| Projektliste | Gruppierung je Rig, Karten mit Filter-Chips „x/y × t“, geschätzte Integration, Transitzeile, Priorität per Ziehen | FA-PRJ-14, S-30 |
| Projekt-Editor | Vorlage „nicht verfügbar, Projekt begonnen“; Schnelleingabe Anzahl **oder** Stunden; GEPLANT/AKTUELL/Gesamtfortschritt; Nachtdiagramm mit Legende und Tagesauswahl; Saisondiagramm 1/3/6 Mo/Jahr | FA-BPL-05, FA-PRJ-20/21, FA-SIC-01/02, S-31 |
| Simulator | Schritte 1–3; Überschuss %, Mosaik-Panels getrennt planen, vollständiger Flat-Satz; Zielkarten mit Prüfliste; Protokollspalten inkl. Sortierketten-Ränge und Mondwerte; „Download NINA Sample Sequences“; „Cloud updated / Sync to Cloud“ | FA-SCH-04/05/08, FA-SIM-01/06/07/08/09, FA-NIN-25, S-40 |
| Exoplaneten | Zusätzliche Filter (nautisch dunkel, über Mindesthöhe, Flip ausblenden), Trefferzahl, Sternfeld + Himmelslage, Reiter Zieldetails / Meine Beobachtungen | FA-EXO-05/14, S-22 |
| NINA-Plugin (5 Screenshots) | Optionsseite mit Verbindung (Sync-Token, Speichern & Verbinden, Aktualisieren, Status, Offline-/Urlaubsmodus), Rig-Auswahl im Plugin, Zielbrowser mit *Load to Framing Assistant*, Simulator im Plugin (Einstellungen gesperrt „Controlled by Astro PM“, *Download NINA Sample Sequences*, *Cloud Targets Last Fetched*, Zielkarten, Plangrafik, Simulation Log mit *Copy Log*); Sequenzer: Container mit Status-Kopf, *Tonight's Scheduled Targets*, *Nightly Simulation Graph*, *Flat Handling* (Before Flats / Loop for each Target + Filter + Rotation mit *Trained Flat Exposure* und *Trained Dark Exposure* / After Flats, geteilte Kombinationen und Full Set), Anweisungen *Before/After Each Exposure*, *Before/After Target Change*, *Daily Loop*, *Nightly Loop*, *Refresh Cloud Targets*, *Wait for Time*, *Remote Play/Pause* | FA-NIN-01/02/04/13/16/17/18/26 (Rig-Auswahl im Plugin nicht übernommen: Token ist an das Rig gebunden; Remote Play/Pause nicht übernommen) |
| Cloud Targets | Liste mit Status, „Single frame“, Fortschritt, Filter/Gruppierung, Löschen | FA-NIN-22, S-41 |
| Wetter | Eigene Wolkenkarte (Open-Meteo RDPS/GFS/HRRR) mit Wolkenhöhenprofil, darunter 7-Tage-Grafik | nicht übernommen (Svenesis-Wetter), S-50 |

### 15.2 Erkenntnisse aus `logbook.db.sql`

Die Spalte „NINA-PM“ nennt die fachliche Entsprechung mit dem physischen Namen in Klammern; maßgeblich ist das Schema im Technischen Konzept.

| Astro-PM-Tabelle | Befund | NINA-PM |
|---|---|---|
| `ObservingSites` | `WeatherSafetyUrl`, `PierName`, Zeitzone im Windows-Format, Horizont als Text | `site` (IANA-Zeitzone, `weather_safety_url`, kein Horizont) |
| `RemoteConnections` | enthält **Passwörter im Klartext** | `site_link` ohne Passwort |
| `Telescopes`, `Cameras`, `Filters` | Felder wie in der Doku; Kamera mit `GainModesJson`, `ReadoutModesJson`, Binning-Flags, `DismissedReadoutReportHash`; Filter mit `TransmissionPct`, `ThicknessMm`, `ZeroPointJson` | `telescope`, `camera` (`gain_modes`, `readout_modes`, `supported_binning`, `nina_reported`), `filter` |
| `MoonAvoidanceProfiles` | vier Built-ins mit exakt den Werten aus Kap. 8.2 | `moon_profile` (Seed je Mandant) |
| `ExposurePlanTemplates/Items` | Vorlage an Teleskop+Kamera; `MoonProfileSel` (0 = keine Vermeidung, sonst Profil-ID) | `exposure_template(_line)` mit `moon_mode` + `moon_profile_id` |
| `ImagingSystems` | Scheduler-Einstellungen als `SimSettingsJson` (Strategy *SharedTime*, Playback, SortChain, Bonus, OvershootPercent, MosaicPanelPreference, Dither, FilterSwitch Count/Tolerance, Flats, FlatsFullSet); `DefaultRotationDeg` | `rig` mit expliziten Spalten |
| `Projects` | Redundante Verweise auf Teleskop/Kamera/Standort **und** Imaging System; Bilder als BLOB; Beschreibung/Notizen als RTF; Mondwerte am Projekt; `Status` als Zahl (Zuordnung aus Zählern erschlossen: 1 = Aktiv, 2 = Bereit zur Sichtung → Import als *Aktiv* mit Kennzeichen „Sessions ungeprüft“, 3 = Bereit zur Bearbeitung, 6 = Pausiert/On Hold; 0 = Planung); `ExoplanetJson` (Planet, Star, Catalog, PeriodDays, T0Bjd, DurationHours, DepthMmag, RpOverRs, LockedNightDate, HopsResults…, Results[]) | `project` nur mit `rig_id`, Bilder in S3, Markdown, Status als Text; Exoplanet normalisiert in `exo_project`, `ephemeris`, `transit_observation`, `transit_result` |
| `MosaicPanels` | Einzelfeld = ein Panel „Main“ | `project_panel` |
| `ExposureSets` | Zähler Planned/Acquired/Accepted/Rejected/Inspected/Remote/Unsynced, Ordnerpfade, `AvoidLunar` + Profil | `exposure_line` nur mit Planned/Acquired/Rejected/Bonus; keine Ordner |
| `CaptureNights` | Aggregat je ExposureSet und Nacht (Sub/Accepted, Quelle „filename“) | `capture_night` (Quelle nina/correction/import) + Einzelzeilen `capture` |
| `ObservationLogs` | Protokoll je **Projekt** (Seeing ″, Transparenz %, SQM, Temp, Feuchte, Notizen); im Export leer | `session_log` je Session + `project_note` je Projekt |
| `AppSettings` | ca. 200 Schlüssel für UI-Zustand, Filter, Exoplaneten-Filter, Berichtseinstellungen, Lizenz/Sync-Token | `user_preference` (UI), `tenant.settings`; Tokens nur gehasht in `nina_instance` |
| `Accessories`, `Eyepieces`, `CustomApps`, `CompletedImages`, `ImageSubmissions`, `SubFrameInspections` | Inventar, Okulare, App-Hub, Endbilder, Galerie-Einreichungen, Sichtungsliste (12.782 Einträge) | nicht übernommen |

### 15.3 Migration (optional, OP-20)

Ein Import der Astro-PM-Datenbank in einen Mandanten ist mit dieser Zuordnung möglich: Ausrüstung, Mondprofile, Vorlagen, Rigs, Projekte mit Panels und Belichtungszeilen (Planned, Accepted als `acquired_count`), `CaptureNights` als `capture_night` mit Quelle `import`, Exoplaneten-Projekte mit Ephemeride. Nicht übernommen werden Bilder, Ordnerpfade, Sichtungsdaten und Passwörter.

---

*Quellen: Dokumentation Astro PM (astro-pm.com/docs, u. a. Nightly Simulator, Scheduling Strategies, Moon Avoidance, Exposure Plans & Progress, Exoplanet Targets & Transit Planning, NINA Guide) sowie Produktseiten astro-pm.com/equipment, /project-management, /nina-sync, /sky-view, /exoplanet-bonus, /weather-forecast, /calculators (Stand 17.09.2026); Astro PM 1.6.0 Screenshots und Datenbank-Export logbook.db.sql; Svenesis Astro-Wetter und Beobachtungsplaner (svenesis.org/astro-tools) inkl. Quelltext-Kopfkommentaren der JavaScript-Module.*
