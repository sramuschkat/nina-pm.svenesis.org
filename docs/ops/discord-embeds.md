# Discord-Meldungen (ausgehend)

Bezug: FA-DIS-01…06, FA-AUS-21, TK 7.7. Texte über i18n (`discord.*`) in der Standardsprache des Mandanten. Farben aus ui-tokens.

## Allgemein
```json
{ "username": "Svenesis NINA-PM", "allowed_mentions": { "parse": [] }, "embeds": [ { "title": "…", "url": "https://nina-pm.svenesis.org/…", "color": 5793266, "fields": [], "footer": { "text": "Demo-Sternfreunde · NINA-PM" }, "timestamp": "2026-09-18T03:12:00Z" } ] }
```
- Keine Dateinamen, Tokens, Koordinaten, E-Mail-Adressen. Anzeigenamen nur, wenn `eventFilter.showNames = true`.
- Limits: ≤ 10 Embeds, Titel ≤ 256, Feldwert ≤ 1024, gesamt ≤ 6000 Zeichen → Nachtbericht aufteilen (`Teil 1/2`).
- Farben: approvals `#5865F2` (5793266), sessions `#2E7D32` (3046706), alerts `#C62828` (12976168).

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
| `session.started` | Session gestartet: {rig} | Nacht, Blöcke, Ziele | `/sessions/{id}` |
| `session.completed` | Session beendet: {rig} | Dauer, Lights | `/sessions/{id}` |
| `session.stale` | Session ohne Abschluss: {rig} | letzter Heartbeat | `/sessions/{id}` |
| `transit.observed` / `transit.missed` | Transit {planet}: beobachtet / verpasst | Abdeckung % | `/transit-observations/{id}` |
| `session.report` | Nachtbericht {nacht} – {rig} | je Ziel: Filter Soll/Ist, Integrationszeit; Flats/Dark-Flats je Kombination; Flip-Dauer; Ausfälle; „vorläufig“ bei offenem Outbox | `/sessions/{id}` |
| `session.no_heartbeat` | Kein Heartbeat seit {min} min: {rig} | Session | `/sessions/{id}` |
| `plugin.dead_letters` | Plugin: {n} Meldungen nicht zustellbar | Instanz | `/admin/nina` |
| `rig.busy` | Rig belegt: zweite Instanz abgewiesen | Instanzen | `/admin/nina` |
| `nina.settings_mismatch` | NINA-Einstellungen weichen ab | Feld, Soll, Ist | `/equipment/rigs/{id}` |
| `discord.channel_failed` | Kanal {name} nicht erreichbar | HTTP-Status, Versuche | `/admin/settings/discord` |

\* nur mit `showNames`.

## Fehlerbehandlung
`429` → `retry_after` abwarten; `5xx`/Netz → bis 5 Versuche (30 s, 2 min, 10 min, 30 min, 2 h); `401/403/404` → Kanal `failing`, Ereignis `discord.channel_failed` an **andere** alerts-Kanäle und In-App an Owner; nie Endlosschleife.
