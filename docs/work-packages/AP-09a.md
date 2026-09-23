# AP-09a – Ausrüstung: API

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-05, AP-04b, AP-08b · **Menschliche Aufgaben:** –

## Ziel
Standorte, Teleskope, Kameras, Filter, Vorlagen, Mondprofile und Rigs samt Scheduler-Einstellungen sind per API verwaltbar, mit Löschsperren und Berechnungen.

## Anforderungen
FA-STO, FA-TEL, FA-KAM, FA-FIL, FA-BPL, FA-MON, FA-RIG-01…09

## Lesen (nur diese Abschnitte)
- specs/engine/geometry.md §1 (Abbildungsmaßstab, Bildfeld)
- FK 6.1, 6.2
- TK 7.2 (Ausrüstung)
- schema_aurora_dsql.sql (site … rig)
- contracts/enums.json
- contracts/errors.json
- specs/engine/sort-chain.md, flip-rotation.md (Rig-Felder)
- specs/engine/night.md §1, §1.1 (Nacht-Tabelle, `currentNight`)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- CRUD Standorte, Standort-Links, Teleskope, Kameras (Gain-/Auslesemodi), Filter, Belichtungsvorlagen, Mondprofile (Built-ins schreibgeschützt; **Validierung nach `moon.md` §1: `minAlt < maxAlt`, `W ≥ 0`, `A ≥ 0`, `relax ≥ 0`, `0 ≤ maxIllum ≤ 100` → sonst `422 validation.failed`**, AST-M8 – und Achtung: `moon_max_alt_deg` hat gegenüber Astro PM **invertierte** Semantik, es ist die Höhe **ab der** der volle Abstand gilt, kein oberes Limit; `relax_scale` ist **kein Multiplikator**, sondern Grad je Grad, AST-M2), Rigs inkl. Scheduler-Settings (`PUT /rigs/{id}/scheduler-settings`, `settings_version`), Anzeige-/Auslieferungsschalter
- Berechnete Werte (Abbildungsmaßstab, Bildfeld) in `packages/shared`
- Löschsperren `409 resource.in_use` mit Liste
- Validierung Sortierkette/Flip
- Kamera-Stamm mit `cooling_setpoint_c` (nullable) und `cooling_tolerance_c` (Standard 1, NT-E2); Gain/Offset überall nullable (`null` = NINA-Standard, NT-38); Filter mit `photometric_band` (`photometricBands`, NT-41); Rig mit `flats_source` (`flatsSources`: `panel` | `sky`, NT-40)
- **Filterradbelegung (NT-E1, FA-RIG-14):** `GET /web/v1/rigs/{id}/filter-wheel` liefert je Platz den Web-Filter, den bestätigten `ninaFilterName` mit `ninaConfirmedAt`/`ninaConfirmedBy` (`rig.filter_wheel`), das zuletzt im Heartbeat gemeldete NINA-Filterrad `[{position, name, focusOffset}]` und einen Vorschlag; `PUT /web/v1/rigs/{id}/filter-wheel {slots:[{position, filterId, ninaFilterName}]}` bestätigt (nur Admin/Owner, setzt `nina_confirmed_at`, erhöht `settings_version`). **Vorschlagsheuristik** in `packages/shared`: exakt nach Normalisierung (Kleinbuchstaben, ohne Leer-/Sonderzeichen), sonst Präfix **nur in einer Richtung** – der NINA-Name beginnt mit dem Web-Kurznamen und das nächste Zeichen ist kein Buchstabe
- **Nacht-Tabelle (NT-02):** `GET /web/v1/sites/{id}/nights?from=&count=` (`count` ≤ 400, Aktion `project.read`) liefert `{currentNight, tzdataVersion, timeZoneTransitions[{atUtc, utcOffsetMinutes}], nights[{night, noonStartUtc, noonEndUtc, nightWindowEndUtc}]}` in der Struktur des Bootstraps (Tabelle ab `from`, ohne `from` ab der Mittagsnacht, H1); `currentNight` aus `packages/shared` (AP-05), `nightWindowEndUtc` je Zeile aus der Engine (AP-08b, `night.md` §3)

## Nicht im Umfang
- UI (AP-09b, AP-09c)

## Automatisierte Abnahme
- [ ] CRUD + Rechte-Tests (Admin schreibt, User liest)
- [ ] Maßstab/Bildfeld gegen Handrechnung
- [ ] Löschen in Verwendung → 409 mit Verwendern
- [ ] Vorschlagsheuristik als Tabellentest: „Ha“ → „Ha 3nm“; nie „LPro“ → „L“, „HaOIII“ → „Ha“, „Rc“ → „R“; „O III“ ↔ „OIII“ exakt nach Normalisierung
- [ ] `PUT …/filter-wheel` als User → 403; Bestätigung erhöht `settings_version`
- [ ] `GET /web/v1/sites/{id}/nights` für Starfront ab `2026-09-17`: `nights[0]` = `2026-09-17T17:00:00Z → 2026-09-18T17:00:00Z` mit `nightWindowEndUtc = 2026-09-18T13:00:00Z` (`2026-09-19` → `13:05:00Z` am 20.09.), bei `serverNow = 2026-09-18T14:00:00Z` ohne `from` beginnt die Tabelle mit `2026-09-17` und `currentNight = 2026-09-18` (H1), erster Eintrag von `timeZoneTransitions` = letzter Übergang vor Tabellenbeginn; `count` = 401 → `422 validation.failed`
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
