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
Links relativ zu `https://nina-pm.svenesis.org` auf die Pfade der Web-App (Stand AP-60).

| eventKey | Titel (de) | Felder | Link |
|---|---|---|---|
| `submission.new` | Neue Einreichung: {projekt} | Einreicher*, Rig, Aufwand (Kennzeichen, Nächte) | `/projekte/warteschlange` |
| `submission.withdrawn` | Einreichung zurückgezogen: {projekt} | Einreicher* | `/projekte/warteschlange` |
| `approval.approved` | Freigegeben: {projekt} | Rig, Priorität | `/projekte/{id}` |
| `approval.returned` | Zur Überarbeitung: {projekt} | Kommentar (gekürzt 200) | `/projekte/{id}` |
| `approval.rejected` | Abgelehnt: {projekt} | Kommentar | `/projekte/{id}` |
| `approval.expired` | Einreichung verfallen: {projekt} | Frist | `/projekte/{id}` |
| `deadline.near` | Frist in 24 h: {projekt} | Frist (Mandantenzeit) | `/projekte/warteschlange` |
| `change_request.new` / `.decided` | Änderungsantrag (entschieden): {projekt} | Entscheidung, Kommentar | `/projekte/{id}` |
| `session.started` | Session gestartet: {rig} | Nacht (Doppeldatum), Start (Standortzeit + `<t:…:t>`) | `/auswertung/naechte/{id}` |
| `session.completed` | Session beendet: {rig} | Beginn–Ende (Standortzeit + `<t:…:t>`), Dauer, Status, Lights, Integration | `/auswertung/naechte/{id}` |
| `session.stale` | Session ohne Abschluss: {rig} | Nacht, letzter Heartbeat (Standortzeit + `<t:…:t>` + `<t:…:R>`) | `/auswertung/naechte/{id}` |
| `transit.observed` / `transit.missed` | Transit {planet}: beobachtet / verpasst | Abdeckung % (Ist/Soll der Aufnahmen), Ein- bis Austritt | `/projekte/{id}` |
| `session.report` | Nachtbericht {nacht} – {rig} | Status, Nacht, Beginn–Ende, Wetterbewertung, belichtete Stunden und Effizienz, Lights (+ Bonus), fertig gewordene Projekte, Transitabdeckung, „vorläufig“ bei offenem Outbox; je Projekt (höchstens 10, Rest „+ n weitere“) Filter Soll/Ist mit Integrationszeit; Flats/Dark-Flats je Filter (Ist/Soll); Abweichungsgründe mit Anzahl und Dauer (u. a. Flips, Safety-Pausen) | `/auswertung/naechte/{id}` |
| `session.no_heartbeat` | Kein Heartbeat seit {min} min: {rig} | Session | `/auswertung/naechte/{id}` |
| `plugin.dead_letters` | Plugin: Meldungen nicht zustellbar | Rig, Instanz, Anzahl | `/nina/instanzen` |
| `rig.busy` | Rig belegt: zweite Instanz abgewiesen | Rig, Nacht, Instanz | `/nina/instanzen` |
| `nina.settings_mismatch` | NINA-Einstellungen weichen ab | Rig/Instanz und Gründe als Code-Liste aus `enums.json` `ninaSettingsMismatchCodes` (u. a. `filter_wheel_changed` NT-E1, `mount_site_mismatch` NT-22, `rotator_range_quarter`, `af_time_trigger_missing`) | `/ausruestung/rigs` |
| `discord.channel_failed` | Kanal {name} nicht erreichbar | HTTP-Status, Versuche | `/verwaltung/discord` |

\* nur mit `showNames`.

## Fehlerbehandlung
Vor jedem Senden: Kanal aktiv, URL vorhanden und gültig (`https`, Host `discord.com`/`discordapp.com`), sonst kein Aufruf; eine ungültige URL schaltet den Kanal ab. Weiterleitungen werden nicht verfolgt (`redirect: 'manual'`, `3xx` = Fehler ohne Wiederholung).
`429` → `retry_after` abwarten (bis 5 s im selben Lauf, sonst als nächster Versuch); `5xx`/Netz → bis 5 Versuche mit Backoff 30 s, 2 min, 10 min, 30 min (abgeholt von `tick-5min`, also frühestens zum nächsten Lauf); `401/403/404` → Kanal aus (`enabled = false`, `last_error`), Benachrichtigung `alert.discord_channel_failed` in der App an die aktiven Admins (FA-DIS-05) und Ereignis `discord.channel_failed` an die **anderen** Alarm-Kanäle; übrige `4xx` → Fehler ohne Wiederholung; nie Endlosschleife. `last_error` enthält nur feste Codes (`http_404`, `network`, `redirect`, `webhook_invalid` …), nie Discords Antworttext oder die URL.
