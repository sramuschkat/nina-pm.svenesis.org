# Runbook: NINA-Token widerrufen (TK 5.6, SV-08)

**Wann:** Token geleakt oder verloren, Beobachtungsrechner ausgemustert oder neu aufgesetzt.

Tokens laufen nicht ab; ein Widerruf wirkt **ab der nächsten Anfrage** des Plugins (`401 nina.token_invalid`).

## Ablauf (Admin oder Owner des Mandanten)

1. *NINA* → *NINA-Instanzen* (S-42) → Instanz in der Tabelle wählen.
2. *Widerrufen* → Bestätigungsdialog → *Widerrufen*.
3. Prüfen: In der Diagnose der Instanz erscheint die nächste Plugin-Anfrage als Fehler `401 nina.token_invalid`.
4. Ersatz: *Neue Instanz* anlegen, das neue Token **einmalig** kopieren, im Plugin eintragen und im Passwortmanager ablegen. Das Token nie in Chat, Tickets oder Dateien.
5. Lief auf dem Rig noch eine Session, gibt *Session übernehmen* die Lease sofort frei.

Versehentlich angelegte Instanzen ohne Sessions lassen sich stattdessen **löschen** (S-42 → *Löschen*).

## Notfall ohne erreichbaren Admin

- Super User im System-Kontext: Mandant in S-80 **sperren** – danach lehnt die NINA-API alle Anfragen des Mandanten mit `403 tenant.locked` ab; das Plugin beendet die Nacht geordnet. Nach dem Widerruf durch einen Admin wieder entsperren.
- Kein Super User erreichbar → [superuser-emergency.md](superuser-emergency.md).

## Test-Rig (H-24)

Wird das Token der Test-Instanz widerrufen, die lokale Umgebungsvariable `TEST_RIG_TOKEN` durch das neue Token ersetzen – sonst bricht `pnpm deploy:prod` ab.
