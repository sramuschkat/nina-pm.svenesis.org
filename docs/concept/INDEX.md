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
| 6. Datenbank (Aurora DSQL) | 489–655 |
| &nbsp;&nbsp;6.0 DSQL-Fakten (geprüft 17.09.2026, im Spike AP-S1 am 23.09.2026 nachgewiesen) | 495–510 |
| &nbsp;&nbsp;6.1 Leitlinien | 511–525 |
| &nbsp;&nbsp;6.2 Tabellengruppen | 526–549 |
| &nbsp;&nbsp;6.3 Wichtige Abfragen (Indizes darauf ausgelegt) | 550–560 |
| &nbsp;&nbsp;6.4 Abgeleitete Werte (nicht gespeichert) | 561–564 |
| &nbsp;&nbsp;6.5 Verbindung aus Lambda | 565–585 |
| &nbsp;&nbsp;6.6 Transaktionen, Konflikte, Idempotenz | 586–610 |
| &nbsp;&nbsp;6.7 Mandanten-Guard | 611–627 |
| &nbsp;&nbsp;6.8 Migrationen | 628–638 |
| &nbsp;&nbsp;6.9 Lokale Entwicklung | 639–644 |
| &nbsp;&nbsp;6.10 Datensicherung | 645–655 |
| 7. API | 656–2026 |
| &nbsp;&nbsp;7.1 Konventionen | 658–673 |
| &nbsp;&nbsp;7.2 Endpunkte Web (Auszug, vollständig in OpenAPI) | 674–711 |
| &nbsp;&nbsp;7.3 Endpunkte NINA (`/nina/v1`) | 712–731 |
| &nbsp;&nbsp;7.4 Lang laufende Berechnungen | 732–757 |
| &nbsp;&nbsp;7.5 Verträge | 758–761 |
| &nbsp;&nbsp;7.6 NINA-API: Datenstrukturen | 762–2006 |
| &nbsp;&nbsp;7.7 Discord-Kanäle je Mandant (ausgehend) | 2007–2026 |
| 8. Scheduler- und Astronomie-Engine | 2027–2175 |
| &nbsp;&nbsp;8.1 Grundsätze | 2029–2038 |
| &nbsp;&nbsp;8.2 Öffentliche Schnittstelle (Auszug) | 2039–2097 |
| &nbsp;&nbsp;8.3 Planungsalgorithmus (verbindlich) | 2098–2115 |
| &nbsp;&nbsp;8.4 Übernahme aus den Svenesis-Astro-Tools (Kopiervorlage) | 2116–2159 |
| &nbsp;&nbsp;8.5 Transitrechnung | 2160–2167 |
| &nbsp;&nbsp;8.6 Leistung | 2168–2175 |
| 9. Referenzwerte mit Python/astropy | 2176–2250 |
| &nbsp;&nbsp;9.1 Aufbau | 2180–2204 |
| &nbsp;&nbsp;9.2 Toleranzen (Tests in `packages/engine/test/reference.spec.ts`) | 2205–2250 |
| 10. NINA-Plugin | 2251–2429 |
| &nbsp;&nbsp;10.1 Rahmen | 2253–2264 |
| &nbsp;&nbsp;10.2 Struktur | 2265–2325 |
| &nbsp;&nbsp;10.3 Ablauf im Container | 2326–2348 |
| &nbsp;&nbsp;10.4 Offline | 2349–2355 |
| &nbsp;&nbsp;10.5 Referenz-Assemblies, Build und Entwicklung ohne Windows | 2356–2429 |
| 11. Frontend (React + TypeScript) | 2430–2543 |
| &nbsp;&nbsp;11.1 Technologie | 2432–2451 |
| &nbsp;&nbsp;11.2 Struktur | 2452–2481 |
| &nbsp;&nbsp;11.3 Gestaltung nach Vorbild www.svenesis.org | 2482–2533 |
| &nbsp;&nbsp;11.4 Auth und Rechte im Frontend | 2534–2543 |
| 12. Dateien und S3 | 2544–2565 |
| 13. Hintergrund-Jobs | 2566–2586 |
| 14. Externe Dienste | 2587–2605 |
| 15. Sicherheit | 2606–2650 |
| &nbsp;&nbsp;15.1 Bedrohung von außen → Maßnahme | 2614–2631 |
| &nbsp;&nbsp;15.2 Schutz gegen Versehen | 2632–2635 |
| &nbsp;&nbsp;15.3 Bewusst nicht vorgesehen | 2636–2650 |
| 16. Betrieb, Monitoring und Kosten | 2651–2696 |
| &nbsp;&nbsp;16.1 Logging und Tracing | 2653–2660 |
| &nbsp;&nbsp;16.2 Alarme (SNS → E-Mail) | 2661–2678 |
| &nbsp;&nbsp;16.3 Kostenschätzung (geringe Last, eu-central-1, grob) | 2679–2696 |
| 17. Teststrategie | 2697–2726 |
| 18. CI/CD und Deployment | 2727–2755 |
| 19. Umsetzungsplan für Claude Code | 2756–2878 |
| &nbsp;&nbsp;R1 – MVP Planung | 2765–2805 |
| &nbsp;&nbsp;R2 – Framing und Wetter | 2806–2816 |
| &nbsp;&nbsp;R3 – Auswertung und Folgeplanung | 2817–2827 |
| &nbsp;&nbsp;RP – NINA-Plugin „Eine Nacht automatisch“ (direkt vor R4) | 2828–2846 |
| &nbsp;&nbsp;R4 – Exoplaneten | 2847–2857 |
| &nbsp;&nbsp;R5 – Komfort | 2858–2867 |
| &nbsp;&nbsp;R6 – Optional | 2868–2878 |
| 20. CLAUDE.md | 2879–2907 |
| 21. Offene technische Punkte und Risiken | 2908–2948 |

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
| `rig` | 588–646 |
| `rig_lease` | 647–659 |
| `nina_instance` | 660–686 |
| `project` | 687–754 |
| `favorite` | 755–762 |
| `project_panel` | 763–776 |
| `exposure_line` | 777–814 |
| `project_note` | 815–825 |
| `approval_event` | 826–837 |
| `change_request` | 838–859 |
| `queue_vote` | 860–876 |
| `exo_project` | 877–892 |
| `ephemeris` | 893–917 |
| `transit_observation` | 918–950 |
| `transit_result` | 951–976 |
| `night_plan` | 977–999 |
| `session` | 1000–1033 |
| `session_event` | 1034–1049 |
| `capture` | 1050–1095 |
| `capture_night` | 1096–1116 |
| `correction` | 1117–1129 |
| `flat_combination` | 1130–1150 |
| `session_log` | 1151–1170 |
| `site_night_stat` | 1171–1180 |
| `command` | 1181–1190 |
| `discord_channel` | 1191–1210 |
| `discord_delivery` | 1211–1227 |
| `job` | 1228–1250 |
| `system_setting` | 1251–1302 |
