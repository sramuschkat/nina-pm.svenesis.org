# NINA-API – Beispiele

Aus Technischem Konzept 7.6 extrahiert. **Nur Veranschaulichung** – Uhrzeiten/Koordinaten sind keine Test-Orakel.
**Vertragsquelle sind die zod-Schemas** in `packages/shared/src/contracts/nina/*.ts` (AP-14a); daraus werden OpenAPI (`docs/api/openapi.yaml`) und JSON-Schema generiert, der Plugin-Client (NSwag) liest `openapi.yaml`. Jedes Beispiel hier muss gegen das generierte Schema validieren (Test `contracts.spec.ts`). Aufzählungswerte ausschließlich aus `../enums.json`.

| Datei | Aufruf |
|---|---|
| `bootstrap.response.example.json` | `GET /api/nina/v1/bootstrap` |
| `targets.response.example.json` | `GET /api/nina/v1/targets` |
| `plan.request.example.json` / `plan.response.example.json` | `POST /api/nina/v1/plan` |
| `session.create.request.example.json` / `session.create.response.example.json` | `POST /api/nina/v1/sessions` |
| `session.patch.request.example.json` (`completed`, Outbox nicht leer) · `session.patch.running.example.json` (Wiederaufnahme) · `session.patch.offline.example.json` (Offline-Plan nachmelden) · `session.patch.response.example.json` | `PATCH /api/nina/v1/sessions/{id}` |
| `captures.request.example.json` | `POST /api/nina/v1/sessions/{id}/captures` (Light, Flat, Dark-Flat) |
| `events.request.example.json` | `POST /api/nina/v1/sessions/{id}/events` |
| `heartbeat.request.example.json` / `heartbeat.response.example.json` | `POST /api/nina/v1/heartbeat` |

Aufzählungen (`cmd`, `frameType`, Statuswerte, Ereignisarten): `../enums.json`. Fehlercodes: `../errors.json`.
Gekürzte IDs (`a91f…`) in den Beispielen werden in den Schema-Tests durch gültige UUIDs ersetzt.

**Die Beispielnacht** (Standort aus `bootstrap.response.example.json`: 31,5471° N / −99,3823° O, 450 m, `America/Chicago`), Nacht `2026-09-17`, alle Zeiten UTC:

| Marke | Wert | Herkunft |
|---|---|---|
| Sonnenuntergang | 00:40:30 | −0,833° (FK 8.1) |
| bürgerliche Dämmerung Ende | 01:04:49 | −6° |
| `nightWindow.startUtc` | 00:05:00 | bürgerliche Dämmerung − 1 h (FK 8.1) |
| `darkness.astronomicalStartUtc` | 02:01:58 | −18° |
| Transitfenster | 02:08:00 – 07:34:00 | `targets` → `windowStartUtc/EndUtc` |
| Meridian HAT-P-17 | 04:27:13 | LHA = 0 |
| Meridian NGC 281 | 07:41:22 | LHA = 0 |
| `darknessEndUtc` = `darkness.astronomicalEndUtc` | 11:01:56 | −18° |
| `sessionEndUtc` = `nightWindow.endUtc` | 12:59:00 | bürgerliche Dämmerung + 1 h |

Die Einträge sind mit den Overheads aus dem Bootstrap-Beispiel (Slew 90 s, Filter 10 s, Dither 15 s, Download 3 s, AF 120 s alle 60 min, Flip 240 s ab Meridian + 5 min) vollständig durchgerechnet: Transitserie 310 Aufnahmen à 63 s, Regelblock 17 Ha-Aufnahmen (Planungsbedarf 20 − 3 gemeldete, noch nicht bestätigte), Blockende 09:17:10. Die ungenutzte Zeit nach 09:17:10 erzeugt **kein** `idle_gap`, weil keine Einheit mit Restbedarf dann nutzbar ist (`allocation.md` §12).

**Schema-Hinweise (Review 4/5):**
- `targets`: Projekte als **Discriminated Union** über `type` (`deep_sky` | `exoplanet`); Pflichtfelder je Typ bleiben Pflicht (Deep-Sky-Zeilen mit `order`, `enabled`, `counts`; Exoplaneten mit `transit`). Beispiele decken beide Typen ab.
- `plan.response`: Zeitmarken `darknessEndUtc`, `flatsNotBeforeUtc`, `sessionEndUtc` (TK 7.6), ein Diagnose-Kanal `diagnostics[]` mit `{projectId, panelId?, lineId?, reason, message?}`, jeder Block endet mit `end`.
- **`meridianFlip` – eine Struktur (NIN5-5, ENG5-4…7):** `{waitStartUtc: string|null, plannedUtc: string, durationS: number, inTransitWindow: boolean, planned: boolean}`. `waitStartUtc` = Beginn der Wartezeit vor dem Flip (`null`, wenn nicht gewartet wird), `plannedUtc` = geplanter Flipzeitpunkt (`tM + afterMin`), `planned` = im Blockablauf als `meridian_flip`-Eintrag enthalten. Transitblöcke haben `planned: false` und `inTransitWindow: true`, wenn der Meridian im Fenster liegt (zusätzlich Diagnose `flip_in_transit`). Dieselbe Struktur nutzt `specs/engine/flip-rotation.md` §2.
- **Transitblock (NIN5-5):** `startUtc` ist der **Fensterbeginn**. Der Slew-/Zentrier-Vorlauf steht als erster Eintrag mit `atUtc = startUtc − slewCenterS − 60 s` **vor** `startUtc` – der einzige Fall, in dem ein Eintrag vor dem Blockbeginn liegt (`specs/engine/transit.md` §3).
- `warnings[]`: `{code, level, unitId?, atUtc?, durationS?, message?}` mit `level` aus `warningLevels` (`warn` | `error`) und `code` aus `simulatorWarnings`.
- `events`: Feld `code` (maschinenlesbarer Unterfall) neben `message`, optionales `data`-Objekt (freie Form, ≤ 2 KiB je Ereignis).
- `captures`: `fileName` nur bei `result = "saved"` Pflicht; `pierSide` darf `null` sein.
- **`rotatorMechDeg` je `frameType` (NIN5-8):** bei `light` der **gemessene** mechanische Rotatorwinkel der Aufnahme (ohne Rotator `0`); bei `flat` und `dark_flat` der **eingefrorene Repräsentant** der Flat-Kombination (Median in Zehntelgrad, `specs/nina/execution.md` §7). Nur so stimmen Plugin- und Serverschlüssel überein.
- **`flatsPlanned` / `darkFlatsPlanned` (NIN5-9):** nur bei `flat`/`dark_flat`; Sollzahlen dieser Kombination in dieser Nacht. Serverseitig gewinnt die erste Meldung je Kombination; fehlen die Felder, gilt die Rig-Einstellung (TK 6.6). `darkFlatsPlanned = 0`, wenn die Dark-Flat-Gruppe der Nacht schon erledigt ist; beide dürfen bei Auto-Exposure-/Sky-Flat-Boxen fehlen.
- **`nightPlanId` (NIN5-14):** in `captures` und `events` **Pflicht** – mit **einer** Ausnahme: eine offline angelegte Session darf `null` melden, solange ihr Offline-Plan noch nicht per `PATCH … {offline: true, offlinePlan}` nachgemeldet ist. Der Server ersetzt `null` beim Nachmelden durch die neue ID (TK 6.6).
- **`heartbeat.response.commands`:** Liste aus `ninaCommands` (`refresh_targets`, `reset_plan`), die der Server dem Plugin mitgibt; das Plugin führt jedes Kommando genau einmal aus und quittiert es mit dem nächsten Heartbeat (`ackedCommands[]`). Beschreibung in TK 7.3.
- **Grenzen in den zod-Schemas (verbindlich):** Zeichenketten ≤ 256 (Meldungen ≤ 2000), Arrays `captures`/`events` ≤ 200 Einträge je Aufruf, `blocks` ≤ 200, `entries` ≤ 2000 je Block, `projectIds` ≤ 50, `data` ≤ 2 KiB serialisiert; Zahlen endlich (`.finite()`), Winkel `-360 … 360`, Zeiten als `datetime({offset:false})` mit `Z`. Überschreitung → `422 validation.failed` mit `errors[]` (`execution.md` §8).
