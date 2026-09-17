# Index der Konzepte (Abschnitt → Zeilen)

Erzeugt per Skript aus den Dateien in diesem Ordner (Stand FK 1.15, TK 1.12, Schema 1.11). Zum gezielten Laden: `sed -n 'VON,BISp' <Datei>` bzw. Read mit offset/limit. Nach jeder Änderung an einem Konzept neu erzeugen.

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
| 6. Fachliche Anforderungen | 242–834 |
| &nbsp;&nbsp;6.1 Ausrüstung und Standorte | 246–310 |
| &nbsp;&nbsp;6.2 Filter, Belichtungspläne und Mondprofile | 311–333 |
| &nbsp;&nbsp;6.3 Zielsuche und Framing | 334–353 |
| &nbsp;&nbsp;6.4 Projekte und Ziele | 354–390 |
| &nbsp;&nbsp;6.5 Sichtbarkeit und Diagramme | 391–399 |
| &nbsp;&nbsp;6.6 Astro-Wetter | 400–417 |
| &nbsp;&nbsp;6.7 Scheduler und Nacht-Simulator | 418–466 |
| &nbsp;&nbsp;6.8 Synchronisation Web ↔ NINA | 467–480 |
| &nbsp;&nbsp;6.9 NINA-Plugin | 481–534 |
| &nbsp;&nbsp;6.10 Exoplaneten-Transitplanung | 535–609 |
| &nbsp;&nbsp;6.11 Auswertung und Folgeplanung | 610–657 |
| &nbsp;&nbsp;6.12 Administration, Export und Einstellungen | 658–669 |
| &nbsp;&nbsp;6.13 Mandanten, Super User, Anmeldung und Benutzer | 670–756 |
| &nbsp;&nbsp;6.14 Rollen, Berechtigungen und Freigabe-Warteschlange | 757–834 |
| 7. Fachliches Datenmodell | 835–919 |
| &nbsp;&nbsp;7.1 Übersicht | 837–876 |
| &nbsp;&nbsp;7.2 Wesentliche Entitäten | 877–919 |
| 8. Fachliche Regeln und Berechnungen | 920–1054 |
| &nbsp;&nbsp;8.1 Grundlagen | 922–946 |
| &nbsp;&nbsp;8.2 Mondvermeidung | 947–972 |
| &nbsp;&nbsp;8.3 Strategien | 973–981 |
| &nbsp;&nbsp;8.4 Zähler | 982–998 |
| &nbsp;&nbsp;8.5 Prognose und Kandidatennächte | 999–1005 |
| &nbsp;&nbsp;8.6 Filterzuordnung in NINA | 1006–1009 |
| &nbsp;&nbsp;8.7 Transitvorhersage | 1010–1020 |
| &nbsp;&nbsp;8.8 Meridian-Flip und Rotation | 1021–1040 |
| &nbsp;&nbsp;8.9 Aufwand-Kennzeichen | 1041–1054 |
| 9. Wiederverwendung der Svenesis-Astro-Tools (Kopiervorlage) | 1055–1084 |
| &nbsp;&nbsp;9.1 Bestandsaufnahme | 1059–1070 |
| &nbsp;&nbsp;9.2 Nötige Anpassungen | 1071–1084 |
| 10. Nicht-funktionale Anforderungen | 1085–1112 |
| 11. Ausbaustufen (Release-Plan) | 1113–1127 |
| 12. Offene Punkte und Entscheidungen | 1128–1162 |
| 13. Glossar | 1163–1224 |
| 14. Bildschirmkonzept | 1225–1471 |
| &nbsp;&nbsp;14.1 Rahmen (Shell) | 1229–1252 |
| &nbsp;&nbsp;14.2 Navigationsstruktur | 1253–1268 |
| &nbsp;&nbsp;14.3 Bildschirme im Detail | 1269–1453 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-01 Anmeldung | 1273–1275 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-02 Heute Nacht *(Startseite ab R3; bis dahin „Meine Objekte“ bzw. Projektliste)* | 1276–1278 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-10 Rigs *(Imaging Systems)* | 1279–1285 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-11 Standorte | 1286–1288 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-12 Teleskope | 1289–1291 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-13 Kameras | 1292–1294 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-14 Filter & Belichtungsplan-Vorlagen | 1295–1297 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-15 Mondprofile | 1298–1300 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-20 Sternkarte *(SkyView)* | 1301–1307 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-21 Objektbrowser & Zielvorschläge *(neu)* | 1308–1310 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-22 Exoplaneten | 1311–1317 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-30 Projektliste *(je Status)* | 1318–1320 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-31 Projekt-Editor | 1321–1360 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-32 Meine Objekte *(User)* · S-33 Warteschlange *(alle; Aktionen Admin)* · S-34 Entwürfe *(Admin)* | 1361–1365 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-40 Nacht-Simulator | 1366–1411 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-41 An NINA ausgeliefert *(Cloud Targets)* | 1412–1414 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-42 NINA-Instanzen & Tokens *(Admin)* | 1415–1417 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-50 Wettervorhersage | 1418–1420 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-60 Sessions · S-61 Session-Detail | 1421–1444 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-62 Folgeplanung · S-63 Projektbericht · S-64 Klarnacht-Statistik | 1445–1449 |
| &nbsp;&nbsp;&nbsp;&nbsp;S-70 … S-73 Administration · S-80 … S-82 System | 1450–1453 |
| &nbsp;&nbsp;14.4 Wiederverwendbare Bausteine (UI-Komponenten) | 1454–1471 |
| 15. Anhang A – Abgleich mit Astro PM 1.6.0 | 1472–1517 |
| &nbsp;&nbsp;15.1 Erkenntnisse aus den Screenshots | 1474–1490 |
| &nbsp;&nbsp;15.2 Erkenntnisse aus `logbook.db.sql` | 1491–1510 |
| &nbsp;&nbsp;15.3 Migration (optional, OP-20) | 1511–1517 |

## Technisches_Konzept_Svenesis-NINA-PM.md

| Abschnitt | Zeilen |
|---|---|
| Inhalt | 17–42 |
| 1. Leitplanken und Architekturentscheidungen | 43–81 |
| &nbsp;&nbsp;1.1 Leitplanken | 45–57 |
| &nbsp;&nbsp;1.2 Entscheidungen (ADR-Übersicht) | 58–81 |
| 2. Architekturüberblick | 82–154 |
| &nbsp;&nbsp;2.1 Komponenten | 84–119 |
| &nbsp;&nbsp;2.2 Wichtige Abläufe | 120–154 |
| 3. Monorepo und Projektstruktur | 155–236 |
| &nbsp;&nbsp;3.1 Verzeichnisbaum | 157–219 |
| &nbsp;&nbsp;3.2 Werkzeuge und Konventionen | 220–236 |
| 4. AWS-Infrastruktur mit CDK | 237–332 |
| &nbsp;&nbsp;4.1 Stacks | 239–253 |
| &nbsp;&nbsp;4.2 Wesentliche Ressourcen und Einstellungen | 254–271 |
| &nbsp;&nbsp;4.3 Domain und CloudFront | 272–307 |
| &nbsp;&nbsp;4.4 Umgebung und Konfiguration | 308–318 |
| &nbsp;&nbsp;4.5 Einbindung in die Website www.svenesis.org | 319–332 |
| 5. Authentifizierung und Autorisierung (Discord) | 333–463 |
| &nbsp;&nbsp;5.1 Discord-Anwendung | 335–341 |
| &nbsp;&nbsp;5.2 Anmeldeablauf | 342–378 |
| &nbsp;&nbsp;5.3 Tokens und Cookies | 379–403 |
| &nbsp;&nbsp;5.4 Super User und Notfallzugang | 404–409 |
| &nbsp;&nbsp;5.5 Autorisierung | 410–448 |
| &nbsp;&nbsp;5.6 NINA-Instanzen | 449–463 |
| 6. Datenbank (Aurora DSQL) | 464–628 |
| &nbsp;&nbsp;6.0 DSQL-Fakten (geprüft 17.09.2026) | 470–485 |
| &nbsp;&nbsp;6.1 Leitlinien | 486–500 |
| &nbsp;&nbsp;6.2 Tabellengruppen | 501–524 |
| &nbsp;&nbsp;6.3 Wichtige Abfragen (Indizes darauf ausgelegt) | 525–535 |
| &nbsp;&nbsp;6.4 Abgeleitete Werte (nicht gespeichert) | 536–539 |
| &nbsp;&nbsp;6.5 Verbindung aus Lambda | 540–560 |
| &nbsp;&nbsp;6.6 Transaktionen, Konflikte, Idempotenz | 561–584 |
| &nbsp;&nbsp;6.7 Mandanten-Guard | 585–601 |
| &nbsp;&nbsp;6.8 Migrationen | 602–611 |
| &nbsp;&nbsp;6.9 Lokale Entwicklung | 612–617 |
| &nbsp;&nbsp;6.10 Datensicherung | 618–628 |
| 7. API | 629–1896 |
| &nbsp;&nbsp;7.1 Konventionen | 631–646 |
| &nbsp;&nbsp;7.2 Endpunkte Web (Auszug, vollständig in OpenAPI) | 647–684 |
| &nbsp;&nbsp;7.3 Endpunkte NINA (`/nina/v1`) | 685–698 |
| &nbsp;&nbsp;7.4 Lang laufende Berechnungen | 699–722 |
| &nbsp;&nbsp;7.5 Verträge | 723–726 |
| &nbsp;&nbsp;7.6 NINA-API: Datenstrukturen | 727–1878 |
| &nbsp;&nbsp;7.7 Discord-Kanäle je Mandant (ausgehend) | 1879–1896 |
| 8. Scheduler- und Astronomie-Engine | 1897–1975 |
| &nbsp;&nbsp;8.1 Grundsätze | 1899–1908 |
| &nbsp;&nbsp;8.2 Öffentliche Schnittstelle (Auszug) | 1909–1926 |
| &nbsp;&nbsp;8.3 Planungsalgorithmus (verbindlich) | 1927–1944 |
| &nbsp;&nbsp;8.4 Übernahme aus den Svenesis-Astro-Tools (Kopiervorlage) | 1945–1960 |
| &nbsp;&nbsp;8.5 Transitrechnung | 1961–1967 |
| &nbsp;&nbsp;8.6 Leistung | 1968–1975 |
| 9. Referenzwerte mit Python/astropy | 1976–2018 |
| &nbsp;&nbsp;9.1 Aufbau | 1980–2001 |
| &nbsp;&nbsp;9.2 Toleranzen (Tests in `packages/engine/test/reference.spec.ts`) | 2002–2018 |
| 10. NINA-Plugin | 2019–2104 |
| &nbsp;&nbsp;10.1 Rahmen | 2021–2031 |
| &nbsp;&nbsp;10.2 Struktur | 2032–2076 |
| &nbsp;&nbsp;10.3 Ablauf im Container | 2077–2095 |
| &nbsp;&nbsp;10.4 Offline | 2096–2104 |
| 11. Frontend (React + TypeScript) | 2105–2212 |
| &nbsp;&nbsp;11.1 Technologie | 2107–2125 |
| &nbsp;&nbsp;11.2 Struktur | 2126–2150 |
| &nbsp;&nbsp;11.3 Gestaltung nach Vorbild www.svenesis.org | 2151–2202 |
| &nbsp;&nbsp;11.4 Auth und Rechte im Frontend | 2203–2212 |
| 12. Dateien und S3 | 2213–2232 |
| 13. Hintergrund-Jobs | 2233–2249 |
| 14. Externe Dienste | 2250–2266 |
| 15. Sicherheit | 2267–2291 |
| 16. Betrieb, Monitoring und Kosten | 2292–2341 |
| &nbsp;&nbsp;16.1 Logging und Tracing | 2294–2301 |
| &nbsp;&nbsp;16.2 Alarme (SNS → E-Mail) | 2302–2321 |
| &nbsp;&nbsp;16.3 Kostenschätzung (geringe Last, eu-central-1, grob) | 2322–2341 |
| 17. Teststrategie | 2342–2369 |
| 18. CI/CD und Deployment | 2370–2389 |
| 19. Umsetzungsplan für Claude Code | 2390–2504 |
| &nbsp;&nbsp;R1 – MVP „Eine Nacht automatisch“ | 2399–2450 |
| &nbsp;&nbsp;R2 – Framing und Wetter | 2451–2461 |
| &nbsp;&nbsp;R3 – Auswertung und Folgeplanung | 2462–2472 |
| &nbsp;&nbsp;R4 – Exoplaneten | 2473–2483 |
| &nbsp;&nbsp;R5 – Komfort | 2484–2493 |
| &nbsp;&nbsp;R6 – Optional | 2494–2504 |
| 20. CLAUDE.md | 2505–2533 |
| 21. Offene technische Punkte und Risiken | 2534–2571 |

## schema_aurora_dsql.sql

| Tabelle | Zeilen |
|---|---|
| `identity` | 57–70 |
| `super_user` | 71–77 |
| `tenant` | 78–103 |
| `system_audit` | 104–117 |
| `dso_object` | 118–135 |
| `exo_catalog_entry` | 136–167 |
| `weather_cache` | 168–183 |
| `app_user` | 184–206 |
| `invitation` | 207–225 |
| `auth_session` | 226–247 |
| `user_preference` | 248–256 |
| `identity_preference` | 257–264 |
| `login_audit` | 265–276 |
| `notification` | 277–291 |
| `change_log` | 292–308 |
| `site` | 309–328 |
| `site_link` | 329–341 |
| `telescope` | 342–360 |
| `camera` | 361–391 |
| `moon_profile` | 392–410 |
| `filter` | 411–433 |
| `exposure_template` | 434–444 |
| `exposure_template_line` | 445–462 |
| `rig` | 463–512 |
| `rig_lease` | 513–522 |
| `nina_instance` | 523–549 |
| `project` | 550–611 |
| `favorite` | 612–619 |
| `project_panel` | 620–633 |
| `exposure_line` | 634–667 |
| `project_note` | 668–678 |
| `approval_event` | 679–690 |
| `change_request` | 691–710 |
| `queue_vote` | 711–727 |
| `exo_project` | 728–743 |
| `ephemeris` | 744–761 |
| `transit_observation` | 762–794 |
| `transit_result` | 795–820 |
| `night_plan` | 821–840 |
| `session` | 841–869 |
| `session_event` | 870–885 |
| `capture` | 886–926 |
| `capture_night` | 927–945 |
| `correction` | 946–958 |
| `flat_combination` | 959–979 |
| `session_log` | 980–999 |
| `site_night_stat` | 1000–1009 |
| `command` | 1010–1019 |
| `discord_channel` | 1020–1037 |
| `discord_delivery` | 1038–1054 |
| `job` | 1055–1077 |
| `system_setting` | 1078–1118 |
