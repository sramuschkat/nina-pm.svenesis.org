# Index der Konzepte (Abschnitt → Zeilen)

Erzeugt per Skript aus den Dateien in diesem Ordner (Stand FK 1.21, TK 1.21, Schema 1.18). Zum gezielten Laden: `sed -n 'VON,BISp' <Datei>` bzw. Read mit offset/limit. Nach jeder Änderung an einem Konzept neu erzeugen.

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
| 6. Fachliche Anforderungen | 242–854 |
| &nbsp;&nbsp;6.1 Ausrüstung und Standorte | 246–310 |
| &nbsp;&nbsp;6.2 Filter, Belichtungspläne und Mondprofile | 311–334 |
| &nbsp;&nbsp;6.3 Zielsuche und Framing | 335–354 |
| &nbsp;&nbsp;6.4 Projekte und Ziele | 355–391 |
| &nbsp;&nbsp;6.5 Sichtbarkeit und Diagramme | 392–400 |
| &nbsp;&nbsp;6.6 Astro-Wetter | 401–425 |
| &nbsp;&nbsp;6.7 Scheduler und Nacht-Simulator | 426–474 |
| &nbsp;&nbsp;6.8 Synchronisation Web ↔ NINA | 475–488 |
| &nbsp;&nbsp;6.9 NINA-Plugin | 489–552 |
| &nbsp;&nbsp;6.10 Exoplaneten-Transitplanung | 553–628 |
| &nbsp;&nbsp;6.11 Auswertung und Folgeplanung | 629–676 |
| &nbsp;&nbsp;6.12 Administration, Export und Einstellungen | 677–688 |
| &nbsp;&nbsp;6.13 Mandanten, Super User, Anmeldung und Benutzer | 689–775 |
| &nbsp;&nbsp;6.14 Rollen, Berechtigungen und Freigabe-Warteschlange | 776–854 |
| 7. Fachliches Datenmodell | 855–938 |
| &nbsp;&nbsp;7.1 Übersicht | 857–896 |
| &nbsp;&nbsp;7.2 Wesentliche Entitäten | 897–938 |
| 8. Fachliche Regeln und Berechnungen | 939–1076 |
| &nbsp;&nbsp;8.1 Grundlagen | 941–967 |
| &nbsp;&nbsp;8.2 Mondvermeidung | 968–993 |
| &nbsp;&nbsp;8.3 Strategien | 994–1002 |
| &nbsp;&nbsp;8.4 Zähler | 1003–1019 |
| &nbsp;&nbsp;8.5 Prognose und Kandidatennächte | 1020–1026 |
| &nbsp;&nbsp;8.6 Filterzuordnung in NINA | 1027–1030 |
| &nbsp;&nbsp;8.7 Transitvorhersage | 1031–1041 |
| &nbsp;&nbsp;8.8 Meridian-Flip und Rotation | 1042–1062 |
| &nbsp;&nbsp;8.9 Aufwand-Kennzeichen | 1063–1076 |
| 9. Wiederverwendung der Svenesis-Astro-Tools (Kopiervorlage) | 1077–1108 |
| &nbsp;&nbsp;9.1 Bestandsaufnahme | 1081–1094 |
| &nbsp;&nbsp;9.2 Nötige Anpassungen | 1095–1108 |
| 10. Nicht-funktionale Anforderungen | 1109–1136 |
| 11. Ausbaustufen (Release-Plan) | 1137–1152 |
| 12. Offene Punkte und Entscheidungen | 1153–1188 |
| 13. Glossar | 1189–1254 |
| 14. Bildschirmkonzept | 1255–1505 |
| &nbsp;&nbsp;14.1 Rahmen (Shell) | 1259–1283 |
| &nbsp;&nbsp;14.2 Navigationsstruktur | 1284–1299 |
| &nbsp;&nbsp;14.3 Bildschirme im Detail | 1300–1486 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-01 Anmeldung | 1304–1306 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-02 Heute Nacht *(Startseite ab R3; bis dahin „Meine Objekte“ bzw. Projektliste)* | 1307–1309 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-10 Rigs *(Imaging Systems)* | 1310–1318 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-11 Standorte | 1319–1321 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-12 Teleskope | 1322–1324 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-13 Kameras | 1325–1327 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-14 Filter & Belichtungsplan-Vorlagen | 1328–1330 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-15 Mondprofile | 1331–1333 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-20 Sternkarte *(SkyView)* | 1334–1340 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-21 Objektbrowser & Zielvorschläge *(neu)* | 1341–1343 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-22 Exoplaneten | 1344–1350 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-30 Projektliste *(je Status)* | 1351–1353 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-31 Projekt-Editor | 1354–1393 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-32 Meine Objekte *(User)* · S-33 Warteschlange *(alle; Aktionen Admin)* · S-34 Entwürfe *(Admin)* | 1394–1398 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-40 Nacht-Simulator | 1399–1444 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-41 An NINA ausgeliefert *(Cloud Targets)* | 1445–1447 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-42 NINA-Instanzen & Tokens *(Admin)* | 1448–1450 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-50 Wettervorhersage | 1451–1453 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-60 Sessions · S-61 Session-Detail | 1454–1477 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-62 Folgeplanung · S-63 Projektbericht · S-64 Klarnacht-Statistik | 1478–1482 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-70 … S-73 Administration · S-80 … S-82 System | 1483–1486 |
| &nbsp;&nbsp;14.4 Wiederverwendbare Bausteine (UI-Komponenten) | 1487–1505 |
| 15. Anhang A – Abgleich mit Astro PM 1.6.0 | 1506–1551 |
| &nbsp;&nbsp;15.1 Erkenntnisse aus den Screenshots | 1508–1524 |
| &nbsp;&nbsp;15.2 Erkenntnisse aus `logbook.db.sql` | 1525–1544 |
| &nbsp;&nbsp;15.3 Migration (optional, OP-20) | 1545–1551 |

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
| 3. Monorepo und Projektstruktur | 158–243 |
| &nbsp;&nbsp;3.1 Verzeichnisbaum | 160–226 |
| &nbsp;&nbsp;3.2 Werkzeuge und Konventionen | 227–243 |
| 4. AWS-Infrastruktur mit CDK | 244–339 |
| &nbsp;&nbsp;4.1 Stacks | 246–260 |
| &nbsp;&nbsp;4.2 Wesentliche Ressourcen und Einstellungen | 261–278 |
| &nbsp;&nbsp;4.3 Domain und CloudFront | 279–314 |
| &nbsp;&nbsp;4.4 Umgebung und Konfiguration | 315–325 |
| &nbsp;&nbsp;4.5 Einbindung in die Website www.svenesis.org | 326–339 |
| 5. Authentifizierung und Autorisierung (Discord) | 340–488 |
| &nbsp;&nbsp;5.1 Discord-Anwendung | 342–348 |
| &nbsp;&nbsp;5.2 Anmeldeablauf | 349–391 |
| &nbsp;&nbsp;5.3 Sitzungen und Cookies | 392–421 |
| &nbsp;&nbsp;5.4 Super User und Notfallzugang | 422–428 |
| &nbsp;&nbsp;5.5 Autorisierung | 429–471 |
| &nbsp;&nbsp;5.6 NINA-Instanzen | 472–488 |
| 6. Datenbank (Aurora DSQL) | 489–654 |
| &nbsp;&nbsp;6.0 DSQL-Fakten (geprüft 17.09.2026) | 495–510 |
| &nbsp;&nbsp;6.1 Leitlinien | 511–525 |
| &nbsp;&nbsp;6.2 Tabellengruppen | 526–549 |
| &nbsp;&nbsp;6.3 Wichtige Abfragen (Indizes darauf ausgelegt) | 550–560 |
| &nbsp;&nbsp;6.4 Abgeleitete Werte (nicht gespeichert) | 561–564 |
| &nbsp;&nbsp;6.5 Verbindung aus Lambda | 565–585 |
| &nbsp;&nbsp;6.6 Transaktionen, Konflikte, Idempotenz | 586–610 |
| &nbsp;&nbsp;6.7 Mandanten-Guard | 611–627 |
| &nbsp;&nbsp;6.8 Migrationen | 628–637 |
| &nbsp;&nbsp;6.9 Lokale Entwicklung | 638–643 |
| &nbsp;&nbsp;6.10 Datensicherung | 644–654 |
| 7. API | 655–2023 |
| &nbsp;&nbsp;7.1 Konventionen | 657–672 |
| &nbsp;&nbsp;7.2 Endpunkte Web (Auszug, vollständig in OpenAPI) | 673–710 |
| &nbsp;&nbsp;7.3 Endpunkte NINA (`/nina/v1`) | 711–730 |
| &nbsp;&nbsp;7.4 Lang laufende Berechnungen | 731–754 |
| &nbsp;&nbsp;7.5 Verträge | 755–758 |
| &nbsp;&nbsp;7.6 NINA-API: Datenstrukturen | 759–2003 |
| &nbsp;&nbsp;7.7 Discord-Kanäle je Mandant (ausgehend) | 2004–2023 |
| 8. Scheduler- und Astronomie-Engine | 2024–2172 |
| &nbsp;&nbsp;8.1 Grundsätze | 2026–2035 |
| &nbsp;&nbsp;8.2 Öffentliche Schnittstelle (Auszug) | 2036–2094 |
| &nbsp;&nbsp;8.3 Planungsalgorithmus (verbindlich) | 2095–2112 |
| &nbsp;&nbsp;8.4 Übernahme aus den Svenesis-Astro-Tools (Kopiervorlage) | 2113–2156 |
| &nbsp;&nbsp;8.5 Transitrechnung | 2157–2164 |
| &nbsp;&nbsp;8.6 Leistung | 2165–2172 |
| 9. Referenzwerte mit Python/astropy | 2173–2247 |
| &nbsp;&nbsp;9.1 Aufbau | 2177–2201 |
| &nbsp;&nbsp;9.2 Toleranzen (Tests in `packages/engine/test/reference.spec.ts`) | 2202–2247 |
| 10. NINA-Plugin | 2248–2426 |
| &nbsp;&nbsp;10.1 Rahmen | 2250–2261 |
| &nbsp;&nbsp;10.2 Struktur | 2262–2322 |
| &nbsp;&nbsp;10.3 Ablauf im Container | 2323–2345 |
| &nbsp;&nbsp;10.4 Offline | 2346–2352 |
| &nbsp;&nbsp;10.5 Referenz-Assemblies, Build und Entwicklung ohne Windows | 2353–2426 |
| 11. Frontend (React + TypeScript) | 2427–2540 |
| &nbsp;&nbsp;11.1 Technologie | 2429–2448 |
| &nbsp;&nbsp;11.2 Struktur | 2449–2478 |
| &nbsp;&nbsp;11.3 Gestaltung nach Vorbild www.svenesis.org | 2479–2530 |
| &nbsp;&nbsp;11.4 Auth und Rechte im Frontend | 2531–2540 |
| 12. Dateien und S3 | 2541–2562 |
| 13. Hintergrund-Jobs | 2563–2583 |
| 14. Externe Dienste | 2584–2602 |
| 15. Sicherheit | 2603–2647 |
| &nbsp;&nbsp;15.1 Bedrohung von außen → Maßnahme | 2611–2628 |
| &nbsp;&nbsp;15.2 Schutz gegen Versehen | 2629–2632 |
| &nbsp;&nbsp;15.3 Bewusst nicht vorgesehen | 2633–2647 |
| 16. Betrieb, Monitoring und Kosten | 2648–2693 |
| &nbsp;&nbsp;16.1 Logging und Tracing | 2650–2657 |
| &nbsp;&nbsp;16.2 Alarme (SNS → E-Mail) | 2658–2675 |
| &nbsp;&nbsp;16.3 Kostenschätzung (geringe Last, eu-central-1, grob) | 2676–2693 |
| 17. Teststrategie | 2694–2723 |
| 18. CI/CD und Deployment | 2724–2752 |
| 19. Umsetzungsplan für Claude Code | 2753–2875 |
| &nbsp;&nbsp;R1 – MVP Planung | 2762–2802 |
| &nbsp;&nbsp;R2 – Framing und Wetter | 2803–2813 |
| &nbsp;&nbsp;R3 – Auswertung und Folgeplanung | 2814–2824 |
| &nbsp;&nbsp;RP – NINA-Plugin „Eine Nacht automatisch“ (direkt vor R4) | 2825–2843 |
| &nbsp;&nbsp;R4 – Exoplaneten | 2844–2854 |
| &nbsp;&nbsp;R5 – Komfort | 2855–2864 |
| &nbsp;&nbsp;R6 – Optional | 2865–2875 |
| 20. CLAUDE.md | 2876–2904 |
| 21. Offene technische Punkte und Risiken | 2905–2945 |

## schema_aurora_dsql.sql

| Tabelle | Zeilen |
|---|---|
| `identity` | 112–125 |
| `super_user` | 126–132 |
| `tenant` | 133–154 |
| `system_audit` | 155–167 |
| `dso_object` | 168–223 |
| `exo_catalog_entry` | 224–270 |
| `weather_cache` | 271–312 |
| `app_user` | 313–329 |
| `invitation` | 330–348 |
| `auth_session` | 349–363 |
| `user_preference` | 364–372 |
| `identity_preference` | 373–380 |
| `notification` | 381–395 |
| `change_log` | 396–412 |
| `site` | 413–437 |
| `site_link` | 438–450 |
| `telescope` | 451–470 |
| `camera` | 471–505 |
| `moon_profile` | 506–527 |
| `filter` | 528–555 |
| `exposure_template` | 556–566 |
| `exposure_template_line` | 567–584 |
| `rig` | 585–643 |
| `rig_lease` | 644–656 |
| `nina_instance` | 657–683 |
| `project` | 684–751 |
| `favorite` | 752–759 |
| `project_panel` | 760–773 |
| `exposure_line` | 774–811 |
| `project_note` | 812–822 |
| `approval_event` | 823–834 |
| `change_request` | 835–856 |
| `queue_vote` | 857–873 |
| `exo_project` | 874–889 |
| `ephemeris` | 890–914 |
| `transit_observation` | 915–947 |
| `transit_result` | 948–973 |
| `night_plan` | 974–996 |
| `session` | 997–1030 |
| `session_event` | 1031–1046 |
| `capture` | 1047–1092 |
| `capture_night` | 1093–1113 |
| `correction` | 1114–1126 |
| `flat_combination` | 1127–1147 |
| `session_log` | 1148–1167 |
| `site_night_stat` | 1168–1177 |
| `command` | 1178–1187 |
| `discord_channel` | 1188–1207 |
| `discord_delivery` | 1208–1224 |
| `job` | 1225–1247 |
| `system_setting` | 1248–1294 |
