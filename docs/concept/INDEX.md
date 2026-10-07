# Index der Konzepte (Abschnitt → Zeilen)

Erzeugt per Skript aus den Dateien in diesem Ordner (Stand FK 1.21, TK 1.22, Schema 1.19). Zum gezielten Laden: `sed -n 'VON,BISp' <Datei>` bzw. Read mit offset/limit. Nach jeder Änderung an einem Konzept neu erzeugen.

## Fachkonzept_Svenesis-NINA-PM.md

| Abschnitt | Zeilen |
|---|---|
| Inhalt | 16–51 |
| 1. Ausgangslage und Zielbild | 52–87 |
| &nbsp;&nbsp;1.1 Ausgangslage | 54–64 |
| &nbsp;&nbsp;1.2 Zielbild | 65–72 |
| &nbsp;&nbsp;1.3 Fachliche Ziele | 73–87 |
| 2. Abgrenzung (Scope) | 88–141 |
| &nbsp;&nbsp;2.1 Im Umfang (Leistungsumfang analog Astro PM) | 90–107 |
| &nbsp;&nbsp;2.2 Neu gegenüber Astro PM | 108–116 |
| &nbsp;&nbsp;2.3 Ausdrücklich nicht im Umfang | 117–133 |
| &nbsp;&nbsp;2.4 Optional / spätere Ausbaustufe (W/K) | 134–141 |
| 3. Systemüberblick | 142–178 |
| 4. Rollen und Nutzungskontext | 179–199 |
| 5. Fachlicher Gesamtablauf | 200–241 |
| &nbsp;&nbsp;5.1 Kern-Anwendungsfälle | 221–241 |
| 6. Fachliche Anforderungen | 242–856 |
| &nbsp;&nbsp;6.1 Ausrüstung und Standorte | 246–310 |
| &nbsp;&nbsp;6.2 Filter, Belichtungspläne und Mondprofile | 311–334 |
| &nbsp;&nbsp;6.3 Zielsuche und Framing | 335–354 |
| &nbsp;&nbsp;6.4 Projekte und Ziele | 355–391 |
| &nbsp;&nbsp;6.5 Sichtbarkeit und Diagramme | 392–400 |
| &nbsp;&nbsp;6.6 Astro-Wetter | 401–425 |
| &nbsp;&nbsp;6.7 Scheduler und Nacht-Simulator | 426–474 |
| &nbsp;&nbsp;6.8 Synchronisation Web ↔ NINA | 475–488 |
| &nbsp;&nbsp;6.9 NINA-Plugin | 489–553 |
| &nbsp;&nbsp;6.10 Exoplaneten-Transitplanung | 554–630 |
| &nbsp;&nbsp;6.11 Auswertung und Folgeplanung | 631–678 |
| &nbsp;&nbsp;6.12 Administration, Export und Einstellungen | 679–690 |
| &nbsp;&nbsp;6.13 Mandanten, Super User, Anmeldung und Benutzer | 691–777 |
| &nbsp;&nbsp;6.14 Rollen, Berechtigungen und Freigabe-Warteschlange | 778–856 |
| 7. Fachliches Datenmodell | 857–940 |
| &nbsp;&nbsp;7.1 Übersicht | 859–898 |
| &nbsp;&nbsp;7.2 Wesentliche Entitäten | 899–940 |
| 8. Fachliche Regeln und Berechnungen | 941–1078 |
| &nbsp;&nbsp;8.1 Grundlagen | 943–969 |
| &nbsp;&nbsp;8.2 Mondvermeidung | 970–995 |
| &nbsp;&nbsp;8.3 Strategien | 996–1004 |
| &nbsp;&nbsp;8.4 Zähler | 1005–1021 |
| &nbsp;&nbsp;8.5 Prognose und Kandidatennächte | 1022–1028 |
| &nbsp;&nbsp;8.6 Filterzuordnung in NINA | 1029–1032 |
| &nbsp;&nbsp;8.7 Transitvorhersage | 1033–1043 |
| &nbsp;&nbsp;8.8 Meridian-Flip und Rotation | 1044–1064 |
| &nbsp;&nbsp;8.9 Aufwand-Kennzeichen | 1065–1078 |
| 9. Wiederverwendung der Svenesis-Astro-Tools (Kopiervorlage) | 1079–1110 |
| &nbsp;&nbsp;9.1 Bestandsaufnahme | 1083–1096 |
| &nbsp;&nbsp;9.2 Nötige Anpassungen | 1097–1110 |
| 10. Nicht-funktionale Anforderungen | 1111–1138 |
| 11. Ausbaustufen (Release-Plan) | 1139–1154 |
| 12. Offene Punkte und Entscheidungen | 1155–1190 |
| 13. Glossar | 1191–1256 |
| 14. Bildschirmkonzept | 1257–1507 |
| &nbsp;&nbsp;14.1 Rahmen (Shell) | 1261–1285 |
| &nbsp;&nbsp;14.2 Navigationsstruktur | 1286–1301 |
| &nbsp;&nbsp;14.3 Bildschirme im Detail | 1302–1488 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-01 Anmeldung | 1306–1308 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-02 Heute Nacht *(Startseite ab R3; bis dahin „Meine Objekte“ bzw. Projektliste)* | 1309–1311 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-10 Rigs *(Imaging Systems)* | 1312–1320 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-11 Standorte | 1321–1323 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-12 Teleskope | 1324–1326 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-13 Kameras | 1327–1329 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-14 Filter & Belichtungsplan-Vorlagen | 1330–1332 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-15 Mondprofile | 1333–1335 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-20 Sternkarte *(SkyView)* | 1336–1342 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-21 Objektbrowser & Zielvorschläge *(neu)* | 1343–1345 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-22 Exoplaneten | 1346–1352 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-30 Projektliste *(je Status)* | 1353–1355 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-31 Projekt-Editor | 1356–1395 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-32 Meine Objekte *(entfällt)* · S-33 Warteschlange *(alle; Aktionen Admin)* · S-34 Entwürfe *(entfällt)* | 1396–1400 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-40 Nacht-Simulator | 1401–1446 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-41 An NINA ausgeliefert *(Cloud Targets)* | 1447–1449 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-42 NINA-Instanzen & Tokens *(Admin)* | 1450–1452 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-50 Wettervorhersage | 1453–1455 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-60 Sessions · S-61 Session-Detail | 1456–1479 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-62 Folgeplanung · S-63 Projektbericht · S-64 Klarnacht-Statistik | 1480–1484 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-70 … S-73 Administration · S-80 … S-82 System | 1485–1488 |
| &nbsp;&nbsp;14.4 Wiederverwendbare Bausteine (UI-Komponenten) | 1489–1507 |
| 15. Anhang A – Abgleich mit Astro PM 1.6.0 | 1508–1553 |
| &nbsp;&nbsp;15.1 Erkenntnisse aus den Screenshots | 1510–1526 |
| &nbsp;&nbsp;15.2 Erkenntnisse aus `logbook.db.sql` | 1527–1546 |
| &nbsp;&nbsp;15.3 Migration (optional, OP-20) | 1547–1553 |

## Technisches_Konzept_Svenesis-NINA-PM.md

| Abschnitt | Zeilen |
|---|---|
| Inhalt | 17–42 |
| 1. Leitplanken und Architekturentscheidungen | 43–82 |
| &nbsp;&nbsp;1.1 Leitplanken | 45–58 |
| &nbsp;&nbsp;1.2 Entscheidungen (ADR-Übersicht) | 59–82 |
| 2. Architekturüberblick | 83–157 |
| &nbsp;&nbsp;2.1 Komponenten | 85–120 |
| &nbsp;&nbsp;2.2 Wichtige Abläufe | 121–157 |
| 3. Monorepo und Projektstruktur | 158–244 |
| &nbsp;&nbsp;3.1 Verzeichnisbaum | 160–227 |
| &nbsp;&nbsp;3.2 Werkzeuge und Konventionen | 228–244 |
| 4. AWS-Infrastruktur mit CDK | 245–340 |
| &nbsp;&nbsp;4.1 Stacks | 247–261 |
| &nbsp;&nbsp;4.2 Wesentliche Ressourcen und Einstellungen | 262–279 |
| &nbsp;&nbsp;4.3 Domain und CloudFront | 280–315 |
| &nbsp;&nbsp;4.4 Umgebung und Konfiguration | 316–326 |
| &nbsp;&nbsp;4.5 Einbindung in die Website www.svenesis.org | 327–340 |
| 5. Authentifizierung und Autorisierung (Discord) | 341–489 |
| &nbsp;&nbsp;5.1 Discord-Anwendung | 343–349 |
| &nbsp;&nbsp;5.2 Anmeldeablauf | 350–392 |
| &nbsp;&nbsp;5.3 Sitzungen und Cookies | 393–422 |
| &nbsp;&nbsp;5.4 Super User und Notfallzugang | 423–429 |
| &nbsp;&nbsp;5.5 Autorisierung | 430–472 |
| &nbsp;&nbsp;5.6 NINA-Instanzen | 473–489 |
| 6. Datenbank (Aurora DSQL) | 490–656 |
| &nbsp;&nbsp;6.0 DSQL-Fakten (geprüft 17.09.2026, im Spike AP-S1 am 23.09.2026 nachgewiesen) | 496–511 |
| &nbsp;&nbsp;6.1 Leitlinien | 512–526 |
| &nbsp;&nbsp;6.2 Tabellengruppen | 527–550 |
| &nbsp;&nbsp;6.3 Wichtige Abfragen (Indizes darauf ausgelegt) | 551–561 |
| &nbsp;&nbsp;6.4 Abgeleitete Werte (nicht gespeichert) | 562–565 |
| &nbsp;&nbsp;6.5 Verbindung aus Lambda | 566–586 |
| &nbsp;&nbsp;6.6 Transaktionen, Konflikte, Idempotenz | 587–611 |
| &nbsp;&nbsp;6.7 Mandanten-Guard | 612–628 |
| &nbsp;&nbsp;6.8 Migrationen | 629–639 |
| &nbsp;&nbsp;6.9 Lokale Entwicklung | 640–645 |
| &nbsp;&nbsp;6.10 Datensicherung | 646–656 |
| 7. API | 657–2027 |
| &nbsp;&nbsp;7.1 Konventionen | 659–674 |
| &nbsp;&nbsp;7.2 Endpunkte Web (Auszug, vollständig in OpenAPI) | 675–712 |
| &nbsp;&nbsp;7.3 Endpunkte NINA (`/nina/v1`) | 713–732 |
| &nbsp;&nbsp;7.4 Lang laufende Berechnungen | 733–758 |
| &nbsp;&nbsp;7.5 Verträge | 759–762 |
| &nbsp;&nbsp;7.6 NINA-API: Datenstrukturen | 763–2007 |
| &nbsp;&nbsp;7.7 Discord-Kanäle je Mandant (ausgehend) | 2008–2027 |
| 8. Scheduler- und Astronomie-Engine | 2028–2176 |
| &nbsp;&nbsp;8.1 Grundsätze | 2030–2039 |
| &nbsp;&nbsp;8.2 Öffentliche Schnittstelle (Auszug) | 2040–2098 |
| &nbsp;&nbsp;8.3 Planungsalgorithmus (verbindlich) | 2099–2116 |
| &nbsp;&nbsp;8.4 Übernahme aus den Svenesis-Astro-Tools (Kopiervorlage) | 2117–2160 |
| &nbsp;&nbsp;8.5 Transitrechnung | 2161–2168 |
| &nbsp;&nbsp;8.6 Leistung | 2169–2176 |
| 9. Referenzwerte mit Python/astropy | 2177–2251 |
| &nbsp;&nbsp;9.1 Aufbau | 2181–2205 |
| &nbsp;&nbsp;9.2 Toleranzen (Tests in `packages/engine/test/reference.spec.ts`) | 2206–2251 |
| 10. NINA-Plugin | 2252–2443 |
| &nbsp;&nbsp;10.1 Rahmen | 2254–2265 |
| &nbsp;&nbsp;10.2 Struktur | 2266–2325 |
| &nbsp;&nbsp;10.3 Ablauf im Container | 2326–2348 |
| &nbsp;&nbsp;10.4 Offline | 2349–2356 |
| &nbsp;&nbsp;10.5 NINA-Assemblies, Build und Entwicklung ohne Windows | 2357–2443 |
| 11. Frontend (React + TypeScript) | 2444–2557 |
| &nbsp;&nbsp;11.1 Technologie | 2446–2465 |
| &nbsp;&nbsp;11.2 Struktur | 2466–2495 |
| &nbsp;&nbsp;11.3 Gestaltung nach Vorbild www.svenesis.org | 2496–2547 |
| &nbsp;&nbsp;11.4 Auth und Rechte im Frontend | 2548–2557 |
| 12. Dateien und S3 | 2558–2579 |
| 13. Hintergrund-Jobs | 2580–2600 |
| 14. Externe Dienste | 2601–2619 |
| 15. Sicherheit | 2620–2664 |
| &nbsp;&nbsp;15.1 Bedrohung von außen → Maßnahme | 2628–2645 |
| &nbsp;&nbsp;15.2 Schutz gegen Versehen | 2646–2649 |
| &nbsp;&nbsp;15.3 Bewusst nicht vorgesehen | 2650–2664 |
| 16. Betrieb, Monitoring und Kosten | 2665–2710 |
| &nbsp;&nbsp;16.1 Logging und Tracing | 2667–2674 |
| &nbsp;&nbsp;16.2 Alarme (SNS → E-Mail) | 2675–2692 |
| &nbsp;&nbsp;16.3 Kostenschätzung (geringe Last, eu-central-1, grob) | 2693–2710 |
| 17. Teststrategie | 2711–2740 |
| 18. CI/CD und Deployment | 2741–2769 |
| 19. Umsetzungsplan für Claude Code | 2770–2892 |
| &nbsp;&nbsp;R1 – MVP Planung | 2779–2819 |
| &nbsp;&nbsp;R2 – Framing und Wetter | 2820–2830 |
| &nbsp;&nbsp;R3 – Auswertung und Folgeplanung | 2831–2841 |
| &nbsp;&nbsp;RP – NINA-Plugin „Eine Nacht automatisch“ (direkt vor R4) | 2842–2860 |
| &nbsp;&nbsp;R4 – Exoplaneten | 2861–2871 |
| &nbsp;&nbsp;R5 – Komfort | 2872–2881 |
| &nbsp;&nbsp;R6 – Optional | 2882–2892 |
| 20. CLAUDE.md | 2893–2921 |
| 21. Offene technische Punkte und Risiken | 2922–2962 |

## schema_aurora_dsql.sql

| Tabelle | Zeilen |
|---|---|
| `identity` | 115–128 |
| `super_user` | 129–135 |
| `tenant` | 136–157 |
| `system_audit` | 158–170 |
| `dso_object` | 171–226 |
| `exo_catalog_entry` | 227–273 |
| `weather_cache` | 274–315 |
| `app_user` | 316–332 |
| `invitation` | 333–351 |
| `auth_session` | 352–366 |
| `user_preference` | 367–375 |
| `identity_preference` | 376–383 |
| `notification` | 384–398 |
| `change_log` | 399–415 |
| `site` | 416–440 |
| `site_link` | 441–453 |
| `telescope` | 454–473 |
| `camera` | 474–508 |
| `moon_profile` | 509–530 |
| `filter` | 531–558 |
| `exposure_template` | 559–569 |
| `exposure_template_line` | 570–587 |
| `rig` | 588–648 |
| `rig_lease` | 649–661 |
| `nina_instance` | 662–688 |
| `project` | 689–756 |
| `favorite` | 757–764 |
| `project_panel` | 765–778 |
| `exposure_line` | 779–816 |
| `project_note` | 817–833 |
| `project_note_reaction` | 834–843 |
| `approval_event` | 844–855 |
| `change_request` | 856–877 |
| `queue_vote` | 878–894 |
| `exo_project` | 895–910 |
| `ephemeris` | 911–935 |
| `transit_observation` | 936–968 |
| `transit_result` | 969–994 |
| `night_plan` | 995–1017 |
| `session` | 1018–1052 |
| `session_event` | 1053–1068 |
| `capture` | 1069–1114 |
| `capture_night` | 1115–1135 |
| `correction` | 1136–1148 |
| `flat_combination` | 1149–1169 |
| `session_log` | 1170–1189 |
| `site_night_stat` | 1190–1199 |
| `command` | 1200–1209 |
| `discord_channel` | 1210–1229 |
| `discord_delivery` | 1230–1246 |
| `job` | 1247–1269 |
| `system_setting` | 1270–1321 |
