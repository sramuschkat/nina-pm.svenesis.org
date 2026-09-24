# AP-07d – Speicherbedarf je Mandant

**Release:** R1 · **Größe:** S · **Abhängigkeiten:** AP-07a · **Menschliche Aufgaben:** –

## Ziel
Die Mandantenliste S-80 zeigt den Speicherbedarf je Mandant (FA-SU-03). Diese Spalte fehlt nach AP-07a, weil es dafür noch keine Datenquelle gab (Entscheidung Sven, 24.09.2026: eigenes Paket).

## Anforderungen
FA-SU-03, S-80, TK 13 (`daily`)

## Lesen (nur diese Abschnitte)
- FK 6.13 (FA-SU-03)
- TK 12 (Dateien und S3), TK 13 (Hintergrund-Jobs, `daily`)
- rules/dsql.md (ADD COLUMN ohne DEFAULT, Stapel)
- specs/infra/iam.md §3 (`worker`)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Migration (additiv): `tenant.storage_bytes bigint` und `tenant.storage_measured_at timestamptz`, beide nullable, ohne DEFAULT; `UPDATE` nur auf diese beiden Spalten für `app_job` (Spaltenrecht, `grants.ts`)
- Aufgabe im Zeitplan `daily`: je Mandant die Objekte unter `tenant/<id>/` im Daten-Bucket auflisten, Größen summieren und die beiden Spalten schreiben; idempotent, ein Mandant je Transaktion
- `TenantAdminView` um `storageBytes` und `storageMeasuredAt` erweitern; S-80 zeigt „Dateien: 12,4 MB (Stand …)“ bzw. „noch nicht gemessen“
- Keine neuen IAM-Rechte, falls `dataBucket.grantReadWrite(worker, 'tenant/*')` das Auflisten schon abdeckt (`iam.md` §1: `s3:List*` auf den Bucket); sonst die Tabelle in `iam.md` im selben PR ergänzen

## Nicht im Umfang
- Datenbankgröße je Mandant (DSQL liefert keine Tabellengrößen je Mandant)
- Kontingente oder Warnschwellen

## Automatisierte Abnahme
- [ ] Test: Summe über mehrere Objekte und Seiten der Auflistung; Mandant ohne Dateien → 0; fremde Präfixe zählen nicht
- [ ] Test: Liste in S-80 zeigt Wert und Stand in Betreiberzeit mit Kürzel
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
