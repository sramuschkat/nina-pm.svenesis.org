# Discord-Meldungen (ausgehend)

Bezug: FA-DIS-01…06, FA-AUS-21, TK 7.7. Texte über i18n (`discord.*`) in der Standardsprache des Mandanten. Farben aus ui-tokens.

## Allgemein
```json
{ "username": "Svenesis NINA-PM", "allowed_mentions": { "parse": [] }, "embeds": [ { "title": "…", "url": "https://nina-pm.svenesis.org/…", "color": 5793266, "fields": [], "footer": { "text": "Demo-Sternfreunde · NINA-PM" }, "timestamp": "2026-09-18T03:12:00Z" } ] }
```
- Keine Dateinamen, Tokens, Koordinaten, E-Mail-Adressen. Anzeigenamen nur, wenn `eventFilter.showNames = true`.
- Limits: ≤ 10 Embeds, Titel ≤ 256, Feldwert ≤ 1024, gesamt ≤ 6000 Zeichen → Nachtbericht aufteilen (`Teil 1/2`).
- Farben: approvals `#5865F2` (5793266), sessions `#2E7D32` (3046706), alerts `#C62828` (12976168).

## Zeitangaben (NT-03)
- Jede Uhrzeit steht **doppelt**: Discord-Zeitstempel `<t:UNIX:t>` (Discord zeigt ihn in der Zeitzone des Lesers) **plus** Standortzeit mit Kürzel aus `formatTzAbbr` (`rules/ui.md`), z. B. Transitbeginn 2026-09-18T02:08:00Z → `21:08 CDT (<t:1789697280:t>)`. Nachtereignisse (Session, Blöcke, Transits, Flips) immer so; die Nacht selbst als Doppeldatum „17./18.09.“ (Nacht-Schlüssel des Standorts), nie als Datum der Leserzone.
- Fristen ohne Standortbezug (`deadline.near`, `approval.expired`): Mandantenzeit mit Kürzel plus `<t:UNIX:f>` (Datum und Uhrzeit), z. B. `18.09. 18:00 MESZ (<t:…:f>)`.
- Zeitspannen (Beginn–Ende) mit einem Kürzel am Ende: `21:08–02:34 CDT (<t:1789697280:t>–<t:1789716840:t>)`.
- `embeds[].timestamp` bleibt ISO-UTC mit `Z` (Discord rendert den Fußzeilen-Zeitpunkt selbst). Keine Uhrzeiten aus `session_event.message` übernehmen – Zeiten nur aus den `…Utc`-Feldern formatieren.

## Ereignisse
| eventKey | Titel (de) | Felder | Link |
|---|---|---|---|
| `submission.new` | Neue Einreichung: {projekt} | Einreicher*, Rig, Aufwand, geschätzte Stunden | `/queue` |
| `submission.withdrawn` | Einreichung zurückgezogen: {projekt} | Einreicher* | `/queue` |
| `approval.approved` | Freigegeben: {projekt} | Rig, Priorität, Start | `/projects/{id}` |
| `approval.returned` | Zur Überarbeitung: {projekt} | Kommentar (gekürzt 200) | `/projects/{id}` |
| `approval.rejected` | Abgelehnt: {projekt} | Kommentar | `/projects/{id}` |
| `approval.expired` | Einreichung verfallen: {projekt} | Frist | `/projects/{id}` |
| `deadline.near` | Frist in 24 h: {projekt} | Frist (Mandantenzeit) | `/queue` |
| `change_request.new` / `.decided` | Änderungsantrag: {projekt} | Art, Entscheidung | `/projects/{id}` |
| `session.started` | Session gestartet: {rig} | Nacht (Doppeldatum), Start (Standortzeit + `<t:…:t>`), Blöcke, Ziele | `/sessions/{id}` |
| `session.completed` | Session beendet: {rig} | Beginn–Ende (Standortzeit + `<t:…:t>`), Dauer, Lights | `/sessions/{id}` |
| `session.stale` | Session ohne Abschluss: {rig} | letzter Heartbeat (Standortzeit + `<t:…:R>`) | `/sessions/{id}` |
| `transit.observed` / `transit.missed` | Transit {planet}: beobachtet / verpasst | Abdeckung % | `/transit-observations/{id}` |
| `session.report` | Nachtbericht {nacht} – {rig} | je Ziel: Filter Soll/Ist, Integrationszeit; Flats/Dark-Flats je Kombination; Flip-Dauer; Ausfälle; „vorläufig“ bei offenem Outbox | `/sessions/{id}` |
| `session.no_heartbeat` | Kein Heartbeat seit {min} min: {rig} | Session | `/sessions/{id}` |
| `plugin.dead_letters` | Plugin: {n} Meldungen nicht zustellbar | Instanz | `/admin/nina` |
| `rig.busy` | Rig belegt: zweite Instanz abgewiesen | Instanzen | `/admin/nina` |
| `nina.settings_mismatch` | NINA-Einstellungen weichen ab | Gründe als Code-Liste aus `enums.json` `ninaSettingsMismatchCodes` (u. a. `filter_wheel_changed` NT-E1, `mount_site_mismatch` NT-22, `rotator_range_quarter`, `af_time_trigger_missing`) mit Feld, Soll, Ist | `/equipment/rigs/{id}` |
| `discord.channel_failed` | Kanal {name} nicht erreichbar | HTTP-Status, Versuche | `/admin/settings/discord` |

\* nur mit `showNames`.

## Fehlerbehandlung
`429` → `retry_after` abwarten; `5xx`/Netz → bis 5 Versuche (30 s, 2 min, 10 min, 30 min, 2 h); `401/403/404` → Kanal `failing`, Ereignis `discord.channel_failed` an **andere** alerts-Kanäle und In-App an Owner; nie Endlosschleife.
