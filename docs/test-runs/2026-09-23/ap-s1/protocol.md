# DSQL-Spike AP-S1 – Protokoll

| | |
|---|---|
| Werkzeug | pnpm test:dsql --spike (tools/deploy/src/test-dsql.ts, spikes/dsql) |
| Beginn | 2026-09-23T18:31:05.462Z |
| Ende | 2026-09-23T18:36:34.770Z |
| Cluster | kjudhxhbqi6as4cmu2pw3saaf4 (eu-central-1), angelegt 603 ms, ACTIVE nach 5418 ms |
| Aufrufer | arn:aws:iam::509219055019:user/sramuschkat-portfolio-dev |
| node | v24.11.1 |
| region | eu-central-1 |
| optionen | vollständig |
| messort | lokal auf dem Rechner von Sven (nicht aus Lambda, CC-6) |

## Übersicht

| Nr. | Prüfpunkt | TK 6.0 | Ergebnis | Zusammenfassung |
|---|---|---|---|---|
| S1-01 | Fremdschlüssel, auch nachträglich mit NOT VALID | (1) | bestätigt | FK-Verletzung abgelehnt (23503); NOT VALID ok; ASYNC VALIDATE ok (Job 6zv2fbhcqvbq5d2kfo3y6dnpza) |
| S1-02 | jsonb als Spaltentyp, Grenze 1 MiB komprimiert | (2) | bestätigt | Spalte ok; Operatoren {"a":"1","d":"x","contains":true,"b":"array"}; 1,6 MiB zufällig abgelehnt (54000) |
| S1-03 | ALTER TABLE ADD COLUMN mit DEFAULT | ALTER TABLE | abweichend | ADD COLUMN DEFAULT Fehler, Bestandszeilen mit Default: ? von 3; NOT NULL DEFAULT Fehler 0A000 |
| S1-04 | SELECT … FOR UPDATE verhindert Schreib-Schiefe (OCC) | Nebenläufigkeit | bestätigt | ohne FOR UPDATE: zweiter Commit ok (Schreib-Schiefe möglich); mit FOR UPDATE: Konflikt 40001; gleiche Zeile: Konflikt 40001 |
| S1-05 | INSERT … ON CONFLICT | (3) | bestätigt | DO NOTHING: neu 1 / Duplikat 0 Zeile(n); DO UPDATE: n = 2 |
| S1-06 | CREATE INDEX ASYNC und Wartefunktion | (4) | abweichend | Job-ID 5nojsvs2fjbxrdt4poxgm5klym; sys.wait_for_job Fehler 42809; sys-Funktionen: base32_str_to_uuid, base_type_oid, cluster_size, cluster_size_limit, current_session_id, current_transaction_id, decode_job_ext_status, decode_job_statement, decode_job_status, dsql_major_version, fetch_seq_data_tuple, get_key_desc, iam_session_user, job_err_msg, supported_datatypes, uuid_to_base32_str, wait_for_job |
| S1-07 | Rollen, GRANT und AWS IAM GRANT | (5) | abweichend | AWS IAM GRANT ok; GRANT ok; als spike_app: SELECT ok, INSERT abgelehnt (42501) |
| S1-08 | Node-Connector, Rückfall ohne Connector und Latenz vom Rechner | 6.5 | bestätigt | Abfrage-Latenz p50 17 ms, p95 94 ms, max 101 ms; Verbindungsaufbau Connector 104 ms, pg+Signer 123 ms; PostgreSQL 16 |
| S1-09 | Grenzen je Transaktion: Zeilen, Datenvolumen, Laufzeit, DDL | (6) Grenzen | bestätigt | 3.000 Zeilen ok, 3.001 abgelehnt (54000); Volumen zuletzt ok 8 MiB, Grenze bei 16 MiB: 54000 transaction size limit 10mb exceeded; Laufzeit: pg_sleep ok, Commit nach 310 s abgelehnt (54000); zwei DDL abgelehnt, DDL+DML abgelehnt |
| S1-10 | Nicht unterstützte Funktionen (rules/dsql.md) | Nicht unterstützt | bestätigt | TRUNCATE abgelehnt; TEMP TABLE abgelehnt; PL/pgSQL abgelehnt; Trigger abgelehnt; Extension abgelehnt; Sequenz abgelehnt; ON DELETE CASCADE möglich |

## S1-01 Fremdschlüssel, auch nachträglich mit NOT VALID – bestätigt

FK-Verletzung abgelehnt (23503); NOT VALID ok; ASYNC VALIDATE ok (Job 6zv2fbhcqvbq5d2kfo3y6dnpza)

| # | Verb. | Befehl | erwartet | Ergebnis | ms | passt |
|---|---|---|---|---|---|---|
| 1 | admin | `CREATE TABLE spike_parent (id uuid PRIMARY KEY, name text NOT NULL)` | ok | ok | 188 | ✔ |
| 2 | admin | `CREATE TABLE spike_child (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid NOT NULL REFERENCES spike_parent(id))` | ok | ok | 272 | ✔ |
| 3 | admin | `INSERT INTO spike_parent (id, name) VALUES ($1, $2) -- Parameter: ["00000000-0000-4000-8000-000000000001","p1"]` | ok | ok · 1 Zeile(n) | 55 | ✔ |
| 4 | admin | `INSERT INTO spike_child (parent_id) VALUES ($1) -- Parameter: ["00000000-0000-4000-8000-000000000001"]` | ok | ok · 1 Zeile(n) | 52 | ✔ |
| 5 | admin | `INSERT INTO spike_child (parent_id) VALUES ($1) -- Parameter: ["00000000-0000-4000-8000-00000000dead"]` | Fehler 23503 | Fehler 23503: insert or update on table "spike_child" violates foreign key constraint "spike_child_parent_id_fkey" (FK-Verletzung muss abgelehnt werden) | 19 | ✔ |
| 6 | admin | `CREATE TABLE spike_child2 (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid)` | ok | ok | 83 | ✔ |
| 7 | admin | `INSERT INTO spike_child2 (parent_id) VALUES ($1) -- Parameter: ["00000000-0000-4000-8000-000000000001"]` | ok | ok · 1 Zeile(n) | 47 | ✔ |
| 8 | admin | `ALTER TABLE spike_child2 ADD CONSTRAINT fk_child2_parent_direct FOREIGN KEY (parent_id) REFERENCES spike_parent(id)` | Fehler | Fehler 0A000: unsupported ALTER TABLE ADD CONSTRAINT statement (laut TK 6.0 nachträglich nur mit NOT VALID) | 17 | ✔ |
| 9 | admin | `ALTER TABLE spike_child2 ADD CONSTRAINT fk_child2_parent FOREIGN KEY (parent_id) REFERENCES spike_parent(id) NOT VALID` | ok | ok | 60 | ✔ |
| 10 | admin | `ALTER TABLE ASYNC spike_child2 VALIDATE CONSTRAINT fk_child2_parent` | ok | ok · [{"job_id":"6zv2fbhcqvbq5d2kfo3y6dnpza"}] (asynchrone Validierung laut TK 6.0) | 65 | ✔ |
| 11 | admin | `SELECT sys.wait_for_job($1) -- Parameter: ["6zv2fbhcqvbq5d2kfo3y6dnpza"]` | – | Fehler 42809: sys.wait_for_job(unknown) is a procedure | 23 | ✔ |
| 12 | admin | `INSERT INTO spike_child2 (parent_id) VALUES ($1) -- Parameter: ["00000000-0000-4000-8000-00000000dead"]` | Fehler 23503 | Fehler 23503: insert or update on table "spike_child2" violates foreign key constraint "fk_child2_parent" (nach NOT VALID gilt der FK für neue Zeilen) | 102 | ✔ |

## S1-02 jsonb als Spaltentyp, Grenze 1 MiB komprimiert – bestätigt

Spalte ok; Operatoren {"a":"1","d":"x","contains":true,"b":"array"}; 1,6 MiB zufällig abgelehnt (54000)

| # | Verb. | Befehl | erwartet | Ergebnis | ms | passt |
|---|---|---|---|---|---|---|
| 1 | admin | `CREATE TABLE spike_doc (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), doc jsonb NOT NULL)` | ok | ok | 82 | ✔ |
| 2 | admin | `INSERT INTO spike_doc (doc) VALUES ('{"a": 1, "b": [1, 2], "c": {"d": "x"}}'::jsonb)` | ok | ok · 1 Zeile(n) | 50 | ✔ |
| 3 | admin | `SELECT doc->>'a' AS a, doc->'c'->>'d' AS d, doc @> '{"a": 1}' AS contains, jsonb_typeof(doc->'b') AS b FROM spike_doc` | ok | ok · 1 Zeile(n) · [{"a":"1","d":"x","contains":true,"b":"array"}] | 26 | ✔ |
| 4 | admin | `INSERT INTO spike_doc (doc) VALUES (jsonb_build_object('blob', repeat('x', $1::int))) -- Parameter: 2 MiB gut komprimierbar` | ok | ok · 1 Zeile(n) (unkomprimiert > 1 MiB, komprimiert klein) | 64 | ✔ |
| 5 | admin | `INSERT INTO spike_doc (doc) VALUES (jsonb_build_object('blob', $1::text)) -- Parameter: 0,8 MiB zufällig` | ok | ok · 1 Zeile(n) | 152 | ✔ |
| 6 | admin | `INSERT INTO spike_doc (doc) VALUES (jsonb_build_object('blob', $1::text)) -- Parameter: 1,6 MiB zufällig` | Fehler | Fehler 54000: datatype limit greater than 1048576 bytes not supported for jsonb (über 1 MiB komprimiert) | 148 | ✔ |
| 7 | admin | `CREATE INDEX ASYNC ix_spike_doc_doc ON spike_doc (doc)` | Fehler | Fehler 0A000: datatype jsonb is not supported in a key (jsonb laut TK 6.0 nicht indexierbar) | 20 | ✔ |

## S1-03 ALTER TABLE ADD COLUMN mit DEFAULT – abweichend

ADD COLUMN DEFAULT Fehler, Bestandszeilen mit Default: ? von 3; NOT NULL DEFAULT Fehler 0A000

| # | Verb. | Befehl | erwartet | Ergebnis | ms | passt |
|---|---|---|---|---|---|---|
| 1 | admin | `CREATE TABLE spike_add (id int PRIMARY KEY)` | ok | ok | 75 | ✔ |
| 2 | admin | `INSERT INTO spike_add (id) VALUES (1), (2), (3)` | ok | ok · 3 Zeile(n) | 47 | ✔ |
| 3 | admin | `ALTER TABLE spike_add ADD COLUMN c text DEFAULT 'x'` | ok | Fehler 0A000: ALTER TABLE ADD COLUMN with constraint not supported | 17 | ✘ |
| 4 | admin | `SELECT count(*)::int AS n FROM spike_add WHERE c = 'x'` | ok | Fehler 42703: column "c" does not exist | 16 | ✘ |
| 5 | admin | `ALTER TABLE spike_add ADD COLUMN n int NOT NULL DEFAULT 0` | ok | Fehler 0A000: ALTER TABLE ADD COLUMN with constraint not supported | 16 | ✘ |
| 6 | admin | `ALTER TABLE spike_add ALTER COLUMN c TYPE varchar(10)` | Fehler | Fehler 0A000: unsupported ALTER TABLE ALTER COLUMN ... SET DATA TYPE statement (laut TK 6.0 nicht unterstützt) | 17 | ✔ |
| 7 | admin | `ALTER TABLE spike_add DROP COLUMN n` | – | Fehler 42703: column "n" of relation "spike_add" does not exist | 18 | ✔ |

## S1-04 SELECT … FOR UPDATE verhindert Schreib-Schiefe (OCC) – bestätigt

ohne FOR UPDATE: zweiter Commit ok (Schreib-Schiefe möglich); mit FOR UPDATE: Konflikt 40001; gleiche Zeile: Konflikt 40001

| # | Verb. | Befehl | erwartet | Ergebnis | ms | passt |
|---|---|---|---|---|---|---|
| 1 | admin | `CREATE TABLE spike_guard (id int PRIMARY KEY, v int NOT NULL)` | ok | ok | 75 | ✔ |
| 2 | admin | `CREATE TABLE spike_ws (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), who text NOT NULL)` | ok | ok | 89 | ✔ |
| 3 | admin | `INSERT INTO spike_guard (id, v) VALUES (1, 0)` | ok | ok · 1 Zeile(n) | 128 | ✔ |
| 4 | admin | `SHOW transaction_isolation` | ok | ok · [{"transaction_isolation":"repeatable read"}] (erwartet repeatable read) | 17 | ✔ |
| 5 | A | `BEGIN` | ok | ok (ohne FOR UPDATE) | 14 | ✔ |
| 6 | A | `SELECT v FROM spike_guard WHERE id = 1` | ok | ok · 1 Zeile(n) · [{"v":0}] | 119 | ✔ |
| 7 | B | `BEGIN` | ok | ok | 107 | ✔ |
| 8 | B | `SELECT v FROM spike_guard WHERE id = 1` | ok | ok · 1 Zeile(n) · [{"v":0}] | 118 | ✔ |
| 9 | A | `INSERT INTO spike_ws (who) VALUES ($1) -- Parameter: ["ohne FOR UPDATE-A"]` | ok | ok · 1 Zeile(n) | 34 | ✔ |
| 10 | A | `COMMIT` | ok | ok | 131 | ✔ |
| 11 | B | `INSERT INTO spike_ws (who) VALUES ($1) -- Parameter: ["ohne FOR UPDATE-B"]` | ok | ok · 1 Zeile(n) | 33 | ✔ |
| 12 | B | `COMMIT` | ok | ok | 31 | ✔ |
| 13 | A | `BEGIN` | ok | ok (mit FOR UPDATE) | 17 | ✔ |
| 14 | A | `SELECT v FROM spike_guard WHERE id = 1 FOR UPDATE` | ok | ok · 1 Zeile(n) · [{"v":0}] | 17 | ✔ |
| 15 | B | `BEGIN` | ok | ok | 14 | ✔ |
| 16 | B | `SELECT v FROM spike_guard WHERE id = 1 FOR UPDATE` | ok | ok · 1 Zeile(n) · [{"v":0}] | 16 | ✔ |
| 17 | A | `INSERT INTO spike_ws (who) VALUES ($1) -- Parameter: ["mit FOR UPDATE-A"]` | ok | ok · 1 Zeile(n) | 15 | ✔ |
| 18 | A | `COMMIT` | ok | ok | 24 | ✔ |
| 19 | B | `INSERT INTO spike_ws (who) VALUES ($1) -- Parameter: ["mit FOR UPDATE-B"]` | ok | ok · 1 Zeile(n) | 16 | ✔ |
| 20 | B | `COMMIT` | Fehler 40001/OC000/OC001 | Fehler 40001: change conflicts with another transaction (OC000) | 19 | ✔ |
| 21 | B | `ROLLBACK` | – | ok | 16 | ✔ |
| 22 | A | `BEGIN` | ok | ok (gleiche Zeile schreiben) | 15 | ✔ |
| 23 | A | `UPDATE spike_guard SET v = v + 1 WHERE id = 1` | ok | ok · 1 Zeile(n) | 21 | ✔ |
| 24 | B | `BEGIN` | ok | ok | 15 | ✔ |
| 25 | B | `UPDATE spike_guard SET v = v + 1 WHERE id = 1` | ok | ok · 1 Zeile(n) | 20 | ✔ |
| 26 | A | `COMMIT` | ok | ok | 24 | ✔ |
| 27 | B | `COMMIT` | Fehler 40001/OC000/OC001 | Fehler 40001: change conflicts with another transaction (OC000) | 19 | ✔ |
| 28 | B | `ROLLBACK` | – | ok | 18 | ✔ |

## S1-05 INSERT … ON CONFLICT – bestätigt

DO NOTHING: neu 1 / Duplikat 0 Zeile(n); DO UPDATE: n = 2

| # | Verb. | Befehl | erwartet | Ergebnis | ms | passt |
|---|---|---|---|---|---|---|
| 1 | admin | `CREATE TABLE spike_upsert (id uuid PRIMARY KEY, n int NOT NULL)` | ok | ok | 142 | ✔ |
| 2 | admin | `INSERT INTO spike_upsert (id, n) VALUES ($1, 1) ON CONFLICT (id) DO NOTHING RETURNING id -- Parameter: ["00000000-0000-4000-8000-0000000000aa"]` | ok | ok · 1 Zeile(n) · [{"id":"00000000-0000-4000-8000-0000000000aa"}] | 46 | ✔ |
| 3 | admin | `INSERT INTO spike_upsert (id, n) VALUES ($1, 1) ON CONFLICT (id) DO NOTHING RETURNING id -- Parameter: ["00000000-0000-4000-8000-0000000000aa"]` | ok | ok · 0 Zeile(n) (Duplikat: keine Zeile zurück) | 17 | ✔ |
| 4 | admin | `INSERT INTO spike_upsert (id, n) VALUES ($1, 1) ON CONFLICT (id) DO UPDATE SET n = spike_upsert.n + EXCLUDED.n RETURNING n -- Parameter: ["00000000-0000-4000-8000-0000000000aa"]` | ok | ok · 1 Zeile(n) · [{"n":2}] | 29 | ✔ |
| 5 | admin | `INSERT INTO spike_upsert (id, n) VALUES ($1, 5) ON CONFLICT DO NOTHING -- Parameter: ["00000000-0000-4000-8000-0000000000aa"]` | – | ok · 0 Zeile(n) (ohne Konfliktziel) | 17 | ✔ |

## S1-06 CREATE INDEX ASYNC und Wartefunktion – abweichend

Job-ID 5nojsvs2fjbxrdt4poxgm5klym; sys.wait_for_job Fehler 42809; sys-Funktionen: base32_str_to_uuid, base_type_oid, cluster_size, cluster_size_limit, current_session_id, current_transaction_id, decode_job_ext_status, decode_job_statement, decode_job_status, dsql_major_version, fetch_seq_data_tuple, get_key_desc, iam_session_user, job_err_msg, supported_datatypes, uuid_to_base32_str, wait_for_job

| # | Verb. | Befehl | erwartet | Ergebnis | ms | passt |
|---|---|---|---|---|---|---|
| 1 | admin | `SELECT p.proname AS name, pg_get_function_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'sys' ORDER BY 1` | – | ok · 17 Zeile(n) · [{"name":"base32_str_to_uuid","args":"text"},{"name":"base_type_oid","args":"oid"},{"name":"cluster_size","args":""}] (Funktionen im Schema sys) | 79 | ✔ |
| 2 | admin | `CREATE TABLE spike_idx (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, k text)` | ok | ok | 84 | ✔ |
| 3 | admin | `INSERT INTO spike_idx (tenant_id, k) VALUES (gen_random_uuid(), $1), (gen_random_uuid(), $2) -- Parameter: ["a","b"]` | ok | ok · 2 Zeile(n) | 48 | ✔ |
| 4 | admin | `CREATE INDEX ASYNC ix_spike_idx_tenant_k ON spike_idx (tenant_id, k)` | ok | ok · [{"job_id":"5nojsvs2fjbxrdt4poxgm5klym"}] | 72 | ✔ |
| 5 | admin | `SELECT sys.wait_for_job($1) AS done -- Parameter: ["5nojsvs2fjbxrdt4poxgm5klym"]` | ok | Fehler 42809: sys.wait_for_job(unknown) is a procedure (Kandidat laut Doku) | 16 | ✘ |
| 6 | admin | `SELECT * FROM sys.jobs WHERE job_id = $1 -- Parameter: ["5nojsvs2fjbxrdt4poxgm5klym"]` | – | ok · 1 Zeile(n) · [{"job_id":"5nojsvs2fjbxrdt4poxgm5klym","status":"submitted","details":null,"job_type":"INDEX_BUILD","class_id":1259,"object_id":26444,"object_name":"public.ix_spike_idx_tenant_k","start_time":"2026-09-23T18:31:15.000Z","update_time":null}] | 116 | ✔ |
| 7 | admin | `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'spike_idx' ORDER BY 1` | – | ok · 2 Zeile(n) · [{"indexname":"ix_spike_idx_tenant_k","indexdef":"CREATE INDEX ix_spike_idx_tenant_k ON public.spike_idx USING btree_index (tenant…(87)"},{"indexname":"spike_idx_pkey","indexdef":"CREATE UNIQUE INDEX spike_idx_pkey ON public.spike_idx USING btree_index (id) IN…(100)"}] | 57 | ✔ |
| 8 | admin | `CREATE INDEX ix_spike_idx_k ON spike_idx (k)` | Fehler | Fehler 0A000: unsupported mode. please use CREATE INDEX ASYNC. (ohne ASYNC laut rules/dsql.md verboten) | 18 | ✔ |

## S1-07 Rollen, GRANT und AWS IAM GRANT – abweichend

AWS IAM GRANT ok; GRANT ok; als spike_app: SELECT ok, INSERT abgelehnt (42501)

| # | Verb. | Befehl | erwartet | Ergebnis | ms | passt |
|---|---|---|---|---|---|---|
| 1 | admin | `CREATE ROLE spike_app WITH LOGIN` | ok | ok | 37 | ✔ |
| 2 | admin | `AWS IAM GRANT spike_app TO 'arn:aws:iam::509219055019:user/sramuschkat-portfolio-dev'` | ok | ok (Aufrufer als Principal; in prod Lambda-Rollen) | 39 | ✔ |
| 3 | admin | `SELECT * FROM sys.iam_pg_role_mappings` | – | ok · 1 Zeile(n) · [{"iam_oid":26447,"arn":"arn:aws:iam::509219055019:user/sramuschkat-portfolio-dev","pg_role_oid":26445,"pg_role_name":"spike_app","grantor_pg_role_oid":15579,"grantor_pg_role_name":"admin"}] | 64 | ✔ |
| 4 | admin | `CREATE TABLE spike_granted (id int PRIMARY KEY, v text NOT NULL)` | ok | ok | 77 | ✔ |
| 5 | admin | `INSERT INTO spike_granted (id, v) VALUES (1, 'a')` | ok | ok · 1 Zeile(n) | 47 | ✔ |
| 6 | admin | `GRANT USAGE ON SCHEMA public TO spike_app` | ok | Fehler 0A000: feature not supported on system entity | 18 | ✘ |
| 7 | admin | `GRANT SELECT ON spike_granted TO spike_app` | ok | ok | 28 | ✔ |
| 8 | spike_app | `Verbindung als spike_app (IAM-Token dsql:DbConnect)` | – | ok · ok | 321 | ✔ |
| 9 | spike_app | `SELECT v FROM spike_granted WHERE id = 1` | ok | ok · 1 Zeile(n) · [{"v":"a"}] | 120 | ✔ |
| 10 | spike_app | `INSERT INTO spike_granted (id, v) VALUES (2, 'b')` | Fehler 42501 | Fehler 42501: permission denied for table spike_granted (ohne INSERT-Recht) | 18 | ✔ |
| 11 | admin | `CREATE ROLE spike_app WITH LOGIN` | Fehler 42710 | Fehler 42710: role "spike_app" already exists (zweites Anlegen: Migration 0000 muss vorher prüfen) | 19 | ✔ |
| 12 | admin | `SELECT rolname FROM pg_roles WHERE rolname = $1 -- Parameter: ["spike_app"]` | ok | ok · 1 Zeile(n) · [{"rolname":"spike_app"}] | 24 | ✔ |
| 13 | admin | `AWS IAM REVOKE spike_app FROM 'arn:aws:iam::509219055019:user/sramuschkat-portfolio-dev'` | – | ok | 33 | ✔ |

## S1-08 Node-Connector, Rückfall ohne Connector und Latenz vom Rechner – bestätigt

Abfrage-Latenz p50 17 ms, p95 94 ms, max 101 ms; Verbindungsaufbau Connector 104 ms, pg+Signer 123 ms; PostgreSQL 16

| # | Verb. | Befehl | erwartet | Ergebnis | ms | passt |
|---|---|---|---|---|---|---|
| 1 | admin | `SELECT version() AS version` | ok | ok · 1 Zeile(n) · [{"version":"PostgreSQL 16"}] | 18 | ✔ |
| 2 | admin | `30 × SELECT 1 über bestehende Verbindung` | – | ok · p50 17 ms, p95 94 ms, max 101 ms | 0 | ✔ |
| 3 | neu | `Verbindungsaufbau AuroraDSQLClient (Token + TLS + Anmeldung)` | – | ok · ok | 104 | ✔ |
| 4 | pg+Signer | `SELECT 1 AS ok` | ok | ok · 1 Zeile(n) · [{"ok":1}] | 16 | ✔ |
| 5 | pg+Signer | `Verbindungsaufbau node-postgres + DsqlSigner` | – | ok · ok | 123 | ✔ |

## S1-09 Grenzen je Transaktion: Zeilen, Datenvolumen, Laufzeit, DDL – bestätigt

3.000 Zeilen ok, 3.001 abgelehnt (54000); Volumen zuletzt ok 8 MiB, Grenze bei 16 MiB: 54000 transaction size limit 10mb exceeded; Laufzeit: pg_sleep ok, Commit nach 310 s abgelehnt (54000); zwei DDL abgelehnt, DDL+DML abgelehnt

| # | Verb. | Befehl | erwartet | Ergebnis | ms | passt |
|---|---|---|---|---|---|---|
| 1 | admin | `CREATE TABLE spike_rows (id int PRIMARY KEY, pad text)` | ok | ok | 83 | ✔ |
| 2 | admin | `CREATE TABLE spike_vol (id int PRIMARY KEY, pad text NOT NULL)` | ok | ok | 116 | ✔ |
| 3 | C | `BEGIN` | ok | ok | 15 | ✔ |
| 4 | C | `INSERT INTO spike_rows (id, pad) SELECT g, 'x' FROM generate_series(1, 3000) g` | ok | ok · 3000 Zeile(n) | 60 | ✔ |
| 5 | C | `COMMIT` | ok | ok | 53 | ✔ |
| 6 | C | `BEGIN` | ok | ok | 16 | ✔ |
| 7 | C | `INSERT INTO spike_rows (id, pad) SELECT g, 'x' FROM generate_series(3001, 6001) g` | – | Fehler 54000: transaction row limit exceeded (3.001 Zeilen) | 36 | ✔ |
| 8 | C | `ROLLBACK` | – | ok | 14 | ✔ |
| 9 | C | `BEGIN` | ok | ok (1 MiB) | 16 | ✔ |
| 10 | C | `INSERT INTO spike_vol (id, pad) VALUES ($1, $2) -- Parameter: id, 256 KiB zufällig (1 MiB gesamt)` | – | ok · 1 Zeile(n) | 92 | ✔ |
| 11 | C | `INSERT INTO spike_vol (id, pad) VALUES ($1, $2) -- Parameter: id, 256 KiB zufällig (1 MiB gesamt)` | – | ok · 1 Zeile(n) | 122 | ✔ |
| 12 | C | `INSERT INTO spike_vol (id, pad) VALUES ($1, $2) -- Parameter: id, 256 KiB zufällig (1 MiB gesamt)` | – | ok · 1 Zeile(n) | 39 | ✔ |
| 13 | C | `COMMIT` | – | ok | 43 | ✔ |
| 14 | C | `BEGIN` | ok | ok (2 MiB) | 15 | ✔ |
| 15 | C | `COMMIT` | – | ok | 50 | ✔ |
| 16 | C | `BEGIN` | ok | ok (4 MiB) | 15 | ✔ |
| 17 | C | `COMMIT` | – | ok | 107 | ✔ |
| 18 | C | `BEGIN` | ok | ok (8 MiB) | 16 | ✔ |
| 19 | C | `COMMIT` | – | ok | 122 | ✔ |
| 20 | C | `BEGIN` | ok | ok (16 MiB) | 17 | ✔ |
| 21 | C | `INSERT INTO spike_vol (id, pad) VALUES ($1, $2) -- Parameter: id, 256 KiB zufällig (16 MiB gesamt)` | – | ok · 1 Zeile(n) | 30 | ✔ |
| 22 | C | `INSERT INTO spike_vol (id, pad) VALUES ($1, $2) -- Parameter: id, 256 KiB zufällig (16 MiB gesamt)` | – | ok · 1 Zeile(n) | 26 | ✔ |
| 23 | C | `INSERT INTO spike_vol (id, pad) VALUES ($1, $2) -- Parameter: id, 256 KiB zufällig (16 MiB gesamt)` | – | ok · 1 Zeile(n) | 27 | ✔ |
| 24 | C | `COMMIT` | – | Fehler 54000: transaction size limit 10mb exceeded | 33 | ✔ |
| 25 | C | `ROLLBACK` | – | ok | 14 | ✔ |
| 26 | C | `… 118 weitere Einfügeschritte zu 256 KiB (alle ohne Fehler, sofern unten nicht anders)` | – | ok · gekürzt | 0 | ✔ |
| 27 | C | `BEGIN` | ok | ok (zwei DDL) | 14 | ✔ |
| 28 | C | `CREATE TABLE spike_ddl1 (id int PRIMARY KEY)` | – | ok | 69 | ✔ |
| 29 | C | `CREATE TABLE spike_ddl2 (id int PRIMARY KEY)` | Fehler | Fehler 0A000: multiple ddl statements not supported in a transaction | 102 | ✔ |
| 30 | C | `ROLLBACK` | – | ok | 13 | ✔ |
| 31 | C | `BEGIN` | ok | ok (DDL + DML) | 15 | ✔ |
| 32 | C | `CREATE TABLE spike_ddl3 (id int PRIMARY KEY)` | – | ok | 62 | ✔ |
| 33 | C | `INSERT INTO spike_parent (id, name) VALUES (gen_random_uuid(), 'mix')` | Fehler | Fehler 0A000: ddl and dml are not supported in the same transaction | 16 | ✔ |
| 34 | C | `ROLLBACK` | – | ok | 15 | ✔ |
| 35 | C | `BEGIN` | ok | ok (Laufzeit) | 15 | ✔ |
| 36 | C | `INSERT INTO spike_rows (id, pad) VALUES (900001, $1) -- Parameter: ["lang"]` | ok | ok · 1 Zeile(n) | 27 | ✔ |
| 37 | C | `SELECT pg_sleep(310)` | – | ok · 1 Zeile(n) · [{"pg_sleep":""}] (310 s) | 310203 | ✔ |
| 38 | C | `COMMIT` | Fehler | Fehler 54000: transaction age limit of 300s exceeded (nach > 5 min) | 16 | ✔ |
| 39 | C | `ROLLBACK` | – | ok | 100 | ✔ |

## S1-10 Nicht unterstützte Funktionen (rules/dsql.md) – bestätigt

TRUNCATE abgelehnt; TEMP TABLE abgelehnt; PL/pgSQL abgelehnt; Trigger abgelehnt; Extension abgelehnt; Sequenz abgelehnt; ON DELETE CASCADE möglich

| # | Verb. | Befehl | erwartet | Ergebnis | ms | passt |
|---|---|---|---|---|---|---|
| 1 | admin | `TRUNCATE spike_rows` | Fehler | Fehler 0A000: unsupported statement: Truncate (TRUNCATE) | 20 | ✔ |
| 2 | admin | `CREATE TEMP TABLE spike_tmp (id int)` | Fehler | Fehler 0A000: TEMPORARY or TEMP table not supported for CREATE TABLE (TEMP TABLE) | 16 | ✔ |
| 3 | admin | `CREATE FUNCTION spike_fn() RETURNS int LANGUAGE plpgsql AS 'BEGIN RETURN 1; END'` | Fehler | Fehler 0A000: CREATE FUNCTION with language plpgsql not supported (PL/pgSQL) | 17 | ✔ |
| 4 | admin | `CREATE TRIGGER spike_trg BEFORE INSERT ON spike_rows FOR EACH ROW EXECUTE FUNCTION spike_fn()` | Fehler | Fehler 0A000: CREATE TRIGGER not supported (Trigger) | 15 | ✔ |
| 5 | admin | `CREATE EXTENSION IF NOT EXISTS pgcrypto` | Fehler | Fehler 0A000: unsupported statement: CreateExtension (Extension) | 23 | ✔ |
| 6 | admin | `CREATE SEQUENCE spike_seq` | – | Fehler 0A000: CREATE SEQUENCE is not supported without an explicit cache size. please define CACHE greater than or equal to 65536 or equal to 1 (Sequenz (bei uns ohnehin nicht genutzt)) | 27 | ✔ |
| 7 | admin | `CREATE TABLE spike_cascade (id uuid PRIMARY KEY, p uuid REFERENCES spike_parent(id) ON DELETE CASCADE)` | – | ok (ON DELETE: laut TK unterstützt, bei uns nicht genutzt) | 288 | ✔ |

## Hinweise

- Erste Verbindung als admin über den Connector: 328 ms
