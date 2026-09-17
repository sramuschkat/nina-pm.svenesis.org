# Review Fachkonzept 1.5.1 · Technisches Konzept 1.2.1 · Schema 1.2.1

Stand 17.09.2026. Drei unabhängige Prüfdurchgänge (Fachlogik, Konsistenz der Dokumente, Machbarkeit/Betrieb), danach von mir gegengeprüft. Aussagen zu Aurora DSQL wurden gegen die aktuelle AWS-Dokumentation geprüft (siehe Quellen). **Status: eingearbeitet** in Fachkonzept 1.6, Technisches Konzept 1.3 und Schema 1.3 (17.09.2026). Fachliche Entscheidungen dabei: Exoplaneten-Projekte je Planet+Rig+Ersteller, Ersteller legt weitere Transits nach Freigabe selbst fest, online plant der Server (OP-22 bis OP-24).

Legende: **H** = hoch (blockiert Umsetzung oder erzeugt Fehlverhalten), **M** = mittel (Entwickler müsste raten / Nutzer stolpert), **N** = niedrig (Aufräumen).

---

## A. Korrektur zu DSQL-Befunden (entwarnt)

Zwei Prüfer hielten Fremdschlüssel, `jsonb`-Spalten und `ALTER TABLE ADD COLUMN … DEFAULT` für nicht unterstützt. Das ist **veraltet**:

- Fremdschlüssel werden seit 27.08.2026 unterstützt (inkl. ON DELETE-Aktionen). Nachträglich per `ALTER TABLE ADD CONSTRAINT` nur mit `NOT VALID` + asynchroner Validierung.
- `json`/`jsonb` sind Speichertypen; Grenze 1 MiB **komprimiert** je Wert, nicht indexierbar.
- `ADD COLUMN` mit DEFAULT, `DROP COLUMN`, `SET/DROP DEFAULT`, `DROP NOT NULL` werden unterstützt; kein `ALTER COLUMN TYPE`.
- `SELECT … FOR UPDATE` wird unterstützt (optimistisch: gelesene Zeilen gehen in die Konflikterkennung).
- AWS Backup unterstützt DSQL; **kein Point-in-Time-Restore**, Restore erzeugt immer einen **neuen Cluster**.

Folge: Schema bleibt grundsätzlich gültig. Anzupassen sind nur der veraltete Kommentar zu FKs, die Migrationsregel für nachträgliche Constraints und die Restore-Beschreibung (siehe B-7, C-9).

---

## B. Hoch

| # | Befund | Vorschlag |
|---|---|---|
| B-1 | **Nachtänderungen erreichen NINA nicht definiert.** NINA holt Daten „beim Planaufbau“; bei Fortsetzung wird nicht neu geplant. Pausieren, Zeile abschalten, Korrektur, Transit-Freigabe am Abend kommen evtl. erst in der nächsten Nacht an. Exoplaneten-Frist „Fenster-Beginn“ ist dadurch praktisch zu spät. | Refresh-Regel: vor jedem Block `GET /targets` (ETag); bei geändertem Input-Hash Rest der Nacht neu planen. Frist = Fenster-Beginn − Vorlauf − Refresh-Intervall. |
| B-2 | **Bonus und Auslieferung widersprechen sich.** `isDeliverable` verlangt Restbedarf > 0, Bonus braucht fertige Zeilen; fertige Projekte wechseln auf *Bereit zur Bearbeitung* und werden nicht mehr ausgeliefert – später verworfene Frames kommen dann nicht zurück in den Plan (Widerspruch zu FK 8.4). | Auslieferung: freigegeben ∧ aktiv ∧ (Restbedarf > 0 ∨ Bonus möglich). Steigt *Verbleibend* bei *Bereit zur Bearbeitung* wieder über 0 → Hinweis/automatisch *Aktiv*. |
| B-3 | **Exoplaneten-Zähler je Transit-Beobachtung nicht abbildbar.** `capture` hat keine `transit_observation_id`; Zähler in `exposure_line` summieren alle Beobachtungen → nach dem ersten Transit ist Verbleibend 0. | `capture.transit_observation_id` + Geplant/Aufgenommen je `transit_observation`. |
| B-4 | **Ein Exoplaneten-Projekt je Planet+Rig blockiert andere User** (fremdes Projekt nicht bearbeitbar, fremder Entwurf unsichtbar). | Eindeutigkeit je Planet+Rig+Ersteller oder „weitere Beobachtung beantragen“ am bestehenden Projekt. |
| B-5 | **Jeder weitere Transit braucht einen Admin** (nach Beobachtung kein Ereignis mehr festgelegt, User darf freigegebenes Objekt nicht ändern; Änderungsantrag erst R3). | Ersteller darf den nächsten Transit eines freigegebenen Exoplaneten-Projekts selbst festlegen (optional Admin-Bestätigung) bzw. Serien-Freigabe „alle Transits bis Datum X“. |
| B-6 | **Benachrichtigungen erst R3, aber R1-Muss-Anforderungen brauchen sie** (Befristung 24 h vorher, Owner-Meldungen, Einreicher bei Admin-Änderung, Owner-Neuzuweisung). | Glocke + `GET/POST /notifications` nach R1 (ohne Discord). |
| B-7 | **Refresh-Token-Rotation mit Wiederverwendungserkennung sperrt Nutzer aus**: parallele Anfragen/mehrere Tabs refreshen gleichzeitig → zweiter Aufruf gilt als Wiederverwendung → alle Sitzungen widerrufen. | Single-flight-Refresh im Client (tabübergreifend via `navigator.locks`), serverseitig Karenz 60 s (vorheriges Token liefert denselben Nachfolger). |
| B-8 | **NINA-Trigger greifen nicht, wenn das Plugin Belichtungen innerhalb einer Anweisung abarbeitet.** NINA wertet Trigger (Meridian-Flip, Autofokus) zwischen Sequenz-Elementen aus; Flip-Einstellungen stehen im NINA-Profil, nicht am Trigger. Gefahr: kein Flip → Montierung läuft an. | Blöcke zur Laufzeit als Kind-Elemente (Filter/Belichtung/Dither) in einem Container ausführen (Muster wie Target-Scheduler-Plugin); Flip-Werte aus dem Profil lesen; NINA-Spike vor AP-13. |
| B-9 | **Engine-Determinismus Node ↔ Jint fragil**: `Math.sin/cos/atan2` können sich im letzten Bit unterscheiden → Schwellen (Höhe ≥ Min, Mond) kippen; `inputHash` aus C#-JSON ≠ JS-JSON. Jint deutlich langsamer (Benchmark erst AP-15). | Online plant der **Server** (`POST /nina/v1/plan`, gleiche Engine), Jint nur offline; eigene Mathefunktionen im Engine-Paket, Werte vor Vergleichen quantisieren, kanonisches JSON in der Engine erzeugen; Jint-Spike in AP-08. |
| B-10 | **Lange/große Arbeit synchron in API-Lambdas** (HTTP API max. 30 s, Body 1 MB): `estimateEffort` über 180 Nächte beim Speichern/Einreichen und nach Ingest in `nina-api`, PDF-Bericht, Mandanten-Import, Plan-Dokument in `POST /sessions`. | Aufwand asynchron (`effort_stale` + Worker), Browser berechnet live; Berichte per Druck-CSS oder Job; Import über S3 + Job; Planprotokoll nach S3. |
| B-11 | **Sicherheitseinstellungen kann jeder Admin ändern**: `tenant.security` ist definiert, aber keiner Route zugeordnet; `PATCH /tenant/settings` enthält 2FA-Pflicht und Sitzungsdauer. | Eigene Route `PUT /web/v1/tenant/security` (`tenant.security`). |
| B-12 | **AP-Reihenfolge nicht umsetzbar**: AP-04 braucht Test-Mandant (entsteht erst AP-07); AP-07 braucht `jobs-deadlines` (erst AP-12); AP-12/AP-15-Abnahmen hängen an AP-14/AP-16. | Mandant anlegen (`ops-cli create-tenant`) nach AP-04; Rollen-Teil von `jobs-deadlines` in AP-07; Ingest nach AP-14 oder Abnahmen verschieben. |
| B-13 | **R1-Warteschlange nutzt Späteres**: Fristen (Exoplaneten R4), Aufwand-Kennzeichen (keinem Release zugeordnet), Sichtbarkeit Wochen (R2). Beispielsequenzen b/c brauchen Tagesschleife/Flats (R5). | R1-Spalten explizit reduzieren; FA-PRJ-23 R1 zuordnen; R1 nur Sequenz „Eine Nacht“. |

## C. Mittel

| # | Befund | Vorschlag |
|---|---|---|
| C-1 | Owner ohne Discord-2FA bei aktiver 2FA-Pflicht verliert Admin-Rechte und kann die Pflicht nicht abschalten. | Owner-Ausnahme definieren (Hinweis + nur Owner-Aktionen gesperrt) bzw. Pflicht erst aktivierbar, wenn Owner 2FA hat. |
| C-2 | Admin-Objekte bei ausgeschalteter „Admin-Objekte ohne Warteschlange“: darf ein Admin eigene Einreichung freigeben? | Freigabe durch anderen Admin/Owner; bei nur einem Admin automatisch. |
| C-3 | Verfall eingereichter Exoplaneten: Stimmen „geschlossen“ vs. *Zurückgegeben* „ruhen“; Beobachtung bleibt `locked` → später `missed` statt `cancelled`. | Stimmen ruhen; Beobachtung beim Verfall `cancelled`. |
| C-4 | Gewünschtes Transit-Datum hat keinen Status (*festgelegt* entsteht sofort). | Status *gewünscht* oder Wunsch-Epoche am Projekt; *festgelegt* erst mit Freigabe. |
| C-5 | Rig-Wechsel bei Freigabe / Ausrüstungsänderungen: Filter nicht im Filterrad, Gain-/Auslesemodi, Binning, Bildfeld/Mosaik; Löschsperren nur für Standorte. | Konfliktprüfung mit Liste + Benachrichtigung; Löschsperren für alle Stammdaten. |
| C-6 | Startdatum, Zieltermin, Wunschzeitraum wirken nirgends; Deep-Sky-Einreichungen verfallen nie. „Saisonende“ undefiniert. | Scheduler ignoriert Projekte vor Startdatum; Zieltermin als Sortierkriterium; Hinweis bei abgelaufenem Wunschzeitraum; Saisonende in 8.1 definieren. |
| C-7 | Mitglied deaktiviert/entfernt: Umgang mit *Zurückgegeben*, Eingereicht, Änderungsanträgen, Rang, Stimmen deaktivierter Mitglieder. | Regeltabelle je Freigabestatus. |
| C-8 | Änderungsantrag: Zustände, Zurückziehen, Bearbeiten (PATCH), Konflikt mit Admin-Änderung; eigene Berechtigungs-Aktionen fehlen. | Zustandsautomat + `PATCH`/`withdraw` + Aktionen `changeRequest.*`. |
| C-9 | Backup/Restore: kein PITR (RPO 24 h), Restore = neuer Cluster (Endpunkt außerhalb CDK); Aufnahmen seit Backup gehen verloren, weil die Outbox schon geleert ist. | Plugin behält gesendete Meldungen 14 Tage + „erneut hochladen ab Datum“; Restore-Runbook mit Endpunkt als SSM-Parameter. |
| C-10 | Gelöschte Zeilen/Panels mit Aufnahmen: kein `deleted_at`; späte Offline-Meldungen laufen ins Leere. | Soft-Delete für `project_panel`/`exposure_line`; Meldungen immer ins Ledger übernehmen. |
| C-11 | Mehrere NINA-Instanzen je Rig können gleichzeitig dieselbe Nacht ausführen. | Eine aktive Session je Rig und Nacht (Lease); zweite Instanz nur Simulation. |
| C-12 | Session-Statusautomat/Verwaist-Regel unscharf; *verpasst* trotz später Offline-Meldungen endgültig. | Zustände + Zeitgrenzen; *verpasst* → *beobachtet* bei späten Meldungen. |
| C-13 | `ImageSaved`-Zuordnung über „laufenden Eintrag“ ist rennanfällig (asynchrones Speichern, Blockwechsel, Flip). | Aufnahme-ID vor der Belichtung setzen und über Bild-Metadaten zuordnen; Unzuordenbares als `unassigned` melden. |
| C-14 | Outbox: nur 410 behandelt; 413/422/409/404 blockieren die Warteschlange. | Fehlerklassen, lokale Dead-Letter-Liste, Anzeige im Heartbeat; strikte Reihenfolge Session vor Aufnahmen. |
| C-15 | OCC-Schreib-Schiefe: Owner-Invariante, `max(rank)+1`, Abstimmen vs. Freigabe, Job vs. Rollenänderung. | Wächterzeilen mit `SELECT … FOR UPDATE` in `withTx` (in DSQL unterstützt). |
| C-16 | `mver = updated_at` markiert Tokens bei jeder Namensänderung als veraltet; „überall abmelden“ prüft `sid` nicht (Token 15 min gültig); System-Kontext lebt 30 Tage. | Eigene Ganzzahl-Spalte `member_version`; `auth_session.revoked_at` im Request-Check; System-Kontext max. 12 h. |
| C-17 | Jobs: EventBridge-Scheduler-DLQ fängt keine Funktionsfehler; asynchrone Wiederholungen → Job läuft bis 3×. | `EventInvokeConfig` (Retries 0–1, onFailure → SQS), Alarm auf Lambda-Errors, Jobs idempotent. |
| C-18 | IAM→DB-Rollen-Mapping nur in Migration 0000; neue Lambda-Rollen haben keinen Zugriff. Migration-Trigger läuft **nach** neuem Code (widerspricht Expand-first). | Eine gemeinsame DB-Zugriffsrolle bzw. idempotenter GRANT je Deploy; Migration vor dem Api-Stack. |
| C-19 | Flats ohne Rotator nicht speicherbar (`flat_combination.rotator_mech_deg` NOT NULL im PK). | Wert 0 für „ohne Rotator“ oder UUID-PK. |
| C-20 | Zählermodell: `bonus_rejected` fehlt im Schema; TK-Formel für Integrationszeit weicht von FK 8.4 ab. | Spalte ergänzen, Formeln angleichen. |
| C-21 | Fehlende Routen/Speicher: Identität systemweit sperren (FA-LOG-05), Sitzungen eines Mitglieds beenden, Wartungsbanner, Mandanten-Logo, Favoriten löschen; Routen ohne Aktion (Favoriten, Einstellungen, Benachrichtigungen, Import, Bericht erneut senden). | Routen + Aktionen + Tabelle `system_setting` ergänzen. |
| C-22 | Einladungs-Befristung widersprüchlich (fester Zeitpunkt vs. „jetzt + Dauer“). | Dauer in Stunden speichern, ab Annahme rechnen. |
| C-23 | Webhook in SSM verlangt Schreibrechte der `web-api` (TK sagt „nur Lesen“). | Rechte dokumentieren oder Webhook KMS-verschlüsselt in der DB. |
| C-24 | User-Friktion: kein Simulieren mit eigenen Entwürfen (nur eingereichte); keine Korrekturen an eigenen Objekten. | Simulation mit Entwurf erlauben; optional Korrekturrecht für eigene Objekte. |
| C-25 | Plugin-Umfang AP-15 deckt R1-Muss nicht ganz (Live-Status-Knöpfe, SiteCheck, gestaffeltes Zentrieren, Log-Präfix); Transit-Unterbrechung vs. laufender Autofokus/Flip unklar. | In AP-15 aufnehmen; Planer legt letzte Belichtung vor Fenster, Trigger im Transitblock unterdrückt. |
| C-26 | Deploy: `prune: true` löscht alte JS-Chunks (offene Tabs brechen) und `/downloads/`. | Assets ohne Prune + Lifecycle; `downloads/*` ausnehmen; bei ChunkLoadError einmal neu laden. |

## D. Niedrig / Aufräumen

- Versionsangaben in allen drei Kopfzeilen vereinheitlichen (TK-Kopf enthält Historie mit alten Ständen); Tabellenliste TK 6.2 ohne `queue_vote`; E2E nennt AF-01…13 statt …14.
- Reste alter Stände: Matrix-Zeile „Admins einladen … nur Super User“, „Rollen Admin/User“ ohne Owner (Kap. 2, Glossar „Admin darf alles“, NFA-17, Matrix ohne Owner-Spalte), „Wunschangaben (… Priorität)“ am Freigabeereignis, Schema-Kommentar zu FKs.
- Entwürfe: `ra_deg/dec_deg` NOT NULL, obwohl Pflicht erst beim Einreichen; `rig_id` nullable trotz Pflicht.
- `content_changed_at`-Kommentar „User-Überarbeitung im Status submitted“ widerspricht Sperre; beim erneuten Einreichen setzen.
- Indizes für Jobs ohne `tenant_id` als Ausnahme dokumentieren; fehlende Indizes `change_request (tenant_id, project_id)`, `notification (delivery_status)`.
- Heartbeat-Alarm (30 min) aus stündlichem Job kann nicht rechtzeitig auslösen → Metrik aus `nina-api`.
- FA-AUS-15(b) (Bedingungen aus NINA-Geräten) ohne Endpunkt/Feld.
- Mondprofil „Kein Mond“ lässt bei Neumond Mond über dem Horizont zu (Stufe 3/4) – Name irreführend; Built-ins „nicht löschbar, klonbar“ vs. „frei anpassbar“; Projekt-Schalter „Mondvermeidung aktiv“ wirkt unklar auf benannte Profile.
- Aufwand-Kennzeichen „mind. n Nächte“ zählt chronologisch – mit besten Nächten ginge es mit weniger → „mind.“ ist keine echte Untergrenze.
- FA-RIG-05 koppelt Anzeige und NINA-Auslieferung an einen Schalter.
- Zeitzone für Fristen/Befristungen nicht festgelegt (Anzeige in Mandanten-Zeitzone mit Kürzel).
- Uhrzeitprüfung per HTTP-Date (1 s Auflösung) mit 2 s Schwelle erzeugt Fehlalarme → 5 s.
- Vereinfachungspotenzial (spart Umsetzungszeit): eine `api`- und eine `worker`-Lambda statt vieler; wenige Zeitpläne; Job-Tabelle statt S3-Statusdateien; In-Memory-Rate-Limit streichen; Berichte per Browser-Druck.

## Quellen

- AWS What's New: Aurora DSQL supports foreign key constraints (27.08.2026) – https://aws.amazon.com/about-aws/whats-new/2026/08/aurora-dsql-foreign-key-constraints/
- Supported data types in Aurora DSQL – https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-data-types.html
- ALTER TABLE in Aurora DSQL – https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html
- Migrating from PostgreSQL (unsupported features) – https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-unsupported-features.html
- Concurrency control in Aurora DSQL – https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html
- Backup and restore for Aurora DSQL – https://docs.aws.amazon.com/aurora-dsql/latest/userguide/backup-aurora-dsql.html
