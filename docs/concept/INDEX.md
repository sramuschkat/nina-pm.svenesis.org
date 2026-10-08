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
| 6. Fachliche Anforderungen | 242–866 |
| &nbsp;&nbsp;6.1 Ausrüstung und Standorte | 246–315 |
| &nbsp;&nbsp;6.2 Filter, Belichtungspläne und Mondprofile | 316–339 |
| &nbsp;&nbsp;6.3 Zielsuche und Framing | 340–359 |
| &nbsp;&nbsp;6.4 Projekte und Ziele | 360–396 |
| &nbsp;&nbsp;6.5 Sichtbarkeit und Diagramme | 397–405 |
| &nbsp;&nbsp;6.6 Astro-Wetter | 406–430 |
| &nbsp;&nbsp;6.7 Scheduler und Nacht-Simulator | 431–480 |
| &nbsp;&nbsp;6.8 Synchronisation Web ↔ NINA | 481–494 |
| &nbsp;&nbsp;6.9 NINA-Plugin | 495–559 |
| &nbsp;&nbsp;6.10 Exoplaneten-Transitplanung | 560–636 |
| &nbsp;&nbsp;6.11 Auswertung und Folgeplanung | 637–688 |
| &nbsp;&nbsp;6.12 Administration, Export und Einstellungen | 689–700 |
| &nbsp;&nbsp;6.13 Mandanten, Super User, Anmeldung und Benutzer | 701–787 |
| &nbsp;&nbsp;6.14 Rollen, Berechtigungen und Freigabe-Warteschlange | 788–866 |
| 7. Fachliches Datenmodell | 867–950 |
| &nbsp;&nbsp;7.1 Übersicht | 869–908 |
| &nbsp;&nbsp;7.2 Wesentliche Entitäten | 909–950 |
| 8. Fachliche Regeln und Berechnungen | 951–1088 |
| &nbsp;&nbsp;8.1 Grundlagen | 953–979 |
| &nbsp;&nbsp;8.2 Mondvermeidung | 980–1005 |
| &nbsp;&nbsp;8.3 Strategien | 1006–1014 |
| &nbsp;&nbsp;8.4 Zähler | 1015–1031 |
| &nbsp;&nbsp;8.5 Prognose und Kandidatennächte | 1032–1038 |
| &nbsp;&nbsp;8.6 Filterzuordnung in NINA | 1039–1042 |
| &nbsp;&nbsp;8.7 Transitvorhersage | 1043–1053 |
| &nbsp;&nbsp;8.8 Meridian-Flip und Rotation | 1054–1074 |
| &nbsp;&nbsp;8.9 Aufwand-Kennzeichen | 1075–1088 |
| 9. Wiederverwendung der Svenesis-Astro-Tools (Kopiervorlage) | 1089–1120 |
| &nbsp;&nbsp;9.1 Bestandsaufnahme | 1093–1106 |
| &nbsp;&nbsp;9.2 Nötige Anpassungen | 1107–1120 |
| 10. Nicht-funktionale Anforderungen | 1121–1148 |
| 11. Ausbaustufen (Release-Plan) | 1149–1164 |
| 12. Offene Punkte und Entscheidungen | 1165–1200 |
| 13. Glossar | 1201–1267 |
| 14. Bildschirmkonzept | 1268–1530 |
| &nbsp;&nbsp;14.1 Rahmen (Shell) | 1272–1296 |
| &nbsp;&nbsp;14.2 Navigationsstruktur | 1297–1312 |
| &nbsp;&nbsp;14.3 Bildschirme im Detail | 1313–1511 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-01 Anmeldung | 1317–1319 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-02 Heute Nacht *(Startseite ab R3; bis dahin „Meine Objekte“ bzw. Projektliste)* | 1320–1322 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-10 Rigs *(Imaging Systems)* | 1323–1333 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-11 Standorte | 1334–1336 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-12 Teleskope | 1337–1339 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-13 Kameras | 1340–1342 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-14 Filter & Belichtungsplan-Vorlagen | 1343–1345 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-15 Mondprofile | 1346–1348 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-20 Sternkarte *(SkyView)* | 1349–1355 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-21 Objektbrowser & Zielvorschläge *(neu)* | 1356–1358 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-22 Exoplaneten | 1359–1365 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-30 Projektliste *(je Status)* | 1366–1368 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-31 Projekt-Editor | 1369–1408 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-32 Meine Objekte *(entfällt)* · S-33 Warteschlange *(alle; Aktionen Admin)* · S-34 Entwürfe *(entfällt)* | 1409–1413 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-40 Nacht-Simulator | 1414–1459 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-41 An NINA ausgeliefert *(Cloud Targets)* | 1460–1462 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-42 NINA-Instanzen & Tokens *(Admin)* | 1463–1465 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-43 Rig-Zustand | 1466–1468 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-50 Wettervorhersage | 1469–1471 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-60 Nächte · S-61 Nacht | 1472–1502 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-62 Folgeplanung · S-63 Projekte · S-64 Standort-Statistik | 1503–1507 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-70 … S-73 Administration · S-80 … S-82 System | 1508–1511 |
| &nbsp;&nbsp;14.4 Wiederverwendbare Bausteine (UI-Komponenten) | 1512–1530 |
| 15. Anhang A – Abgleich mit Astro PM 1.6.0 | 1531–1576 |
| &nbsp;&nbsp;15.1 Erkenntnisse aus den Screenshots | 1533–1549 |
| &nbsp;&nbsp;15.2 Erkenntnisse aus `logbook.db.sql` | 1550–1569 |
| &nbsp;&nbsp;15.3 Migration (optional, OP-20) | 1570–1576 |

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
| 7. API | 657–2028 |
| &nbsp;&nbsp;7.1 Konventionen | 659–674 |
| &nbsp;&nbsp;7.2 Endpunkte Web (Auszug, vollständig in OpenAPI) | 675–712 |
| &nbsp;&nbsp;7.3 Endpunkte NINA (`/nina/v1`) | 713–733 |
| &nbsp;&nbsp;7.4 Lang laufende Berechnungen | 734–759 |
| &nbsp;&nbsp;7.5 Verträge | 760–763 |
| &nbsp;&nbsp;7.6 NINA-API: Datenstrukturen | 764–2008 |
| &nbsp;&nbsp;7.7 Discord-Kanäle je Mandant (ausgehend) | 2009–2028 |
| 8. Scheduler- und Astronomie-Engine | 2029–2177 |
| &nbsp;&nbsp;8.1 Grundsätze | 2031–2040 |
| &nbsp;&nbsp;8.2 Öffentliche Schnittstelle (Auszug) | 2041–2099 |
| &nbsp;&nbsp;8.3 Planungsalgorithmus (verbindlich) | 2100–2117 |
| &nbsp;&nbsp;8.4 Übernahme aus den Svenesis-Astro-Tools (Kopiervorlage) | 2118–2161 |
| &nbsp;&nbsp;8.5 Transitrechnung | 2162–2169 |
| &nbsp;&nbsp;8.6 Leistung | 2170–2177 |
| 9. Referenzwerte mit Python/astropy | 2178–2252 |
| &nbsp;&nbsp;9.1 Aufbau | 2182–2206 |
| &nbsp;&nbsp;9.2 Toleranzen (Tests in `packages/engine/test/reference.spec.ts`) | 2207–2252 |
| 10. NINA-Plugin | 2253–2444 |
| &nbsp;&nbsp;10.1 Rahmen | 2255–2266 |
| &nbsp;&nbsp;10.2 Struktur | 2267–2326 |
| &nbsp;&nbsp;10.3 Ablauf im Container | 2327–2349 |
| &nbsp;&nbsp;10.4 Offline | 2350–2357 |
| &nbsp;&nbsp;10.5 NINA-Assemblies, Build und Entwicklung ohne Windows | 2358–2444 |
| 11. Frontend (React + TypeScript) | 2445–2558 |
| &nbsp;&nbsp;11.1 Technologie | 2447–2466 |
| &nbsp;&nbsp;11.2 Struktur | 2467–2496 |
| &nbsp;&nbsp;11.3 Gestaltung nach Vorbild www.svenesis.org | 2497–2548 |
| &nbsp;&nbsp;11.4 Auth und Rechte im Frontend | 2549–2558 |
| 12. Dateien und S3 | 2559–2580 |
| 13. Hintergrund-Jobs | 2581–2601 |
| 14. Externe Dienste | 2602–2620 |
| 15. Sicherheit | 2621–2665 |
| &nbsp;&nbsp;15.1 Bedrohung von außen → Maßnahme | 2629–2646 |
| &nbsp;&nbsp;15.2 Schutz gegen Versehen | 2647–2650 |
| &nbsp;&nbsp;15.3 Bewusst nicht vorgesehen | 2651–2665 |
| 16. Betrieb, Monitoring und Kosten | 2666–2711 |
| &nbsp;&nbsp;16.1 Logging und Tracing | 2668–2675 |
| &nbsp;&nbsp;16.2 Alarme (SNS → E-Mail) | 2676–2693 |
| &nbsp;&nbsp;16.3 Kostenschätzung (geringe Last, eu-central-1, grob) | 2694–2711 |
| 17. Teststrategie | 2712–2741 |
| 18. CI/CD und Deployment | 2742–2770 |
| 19. Umsetzungsplan für Claude Code | 2771–2893 |
| &nbsp;&nbsp;R1 – MVP Planung | 2780–2820 |
| &nbsp;&nbsp;R2 – Framing und Wetter | 2821–2831 |
| &nbsp;&nbsp;R3 – Auswertung und Folgeplanung | 2832–2842 |
| &nbsp;&nbsp;RP – NINA-Plugin „Eine Nacht automatisch“ (direkt vor R4) | 2843–2861 |
| &nbsp;&nbsp;R4 – Exoplaneten | 2862–2872 |
| &nbsp;&nbsp;R5 – Komfort | 2873–2882 |
| &nbsp;&nbsp;R6 – Optional | 2883–2893 |
| 20. CLAUDE.md | 2894–2922 |
| 21. Offene technische Punkte und Risiken | 2923–2963 |

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
| `site_night_forecast` | 1200–1210 |
| `rig_telemetry_sample` | 1211–1220 |
| `rig_telemetry_hourly` | 1221–1231 |
| `command` | 1232–1241 |
| `discord_channel` | 1242–1261 |
| `discord_delivery` | 1262–1278 |
| `job` | 1279–1301 |
| `system_setting` | 1302–1353 |
