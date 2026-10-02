# Beispielsequenzen bauen (FA-NIN-25, AP-16c)

Die Sequenzen entstehen **in NINA** nach dieser Liste und werden als JSON exportiert – handgeschriebenes NINA-JSON ist
fehleranfällig. Grundlage ist die verbindliche Sequenzvorlage (`docs/specs/nina/execution.md` §1, NT-44). Die Dateien
landen in `apps/nina-plugin/NinaPm.Nina/Samples/` und gehen mit `pnpm deploy:prod` nach
`downloads/nina-sequences/<Plugin-Version>/` (TK 12).

Voraussetzung: NINA-PM-Plugin aus dem CI (Artefakt `nina-pm-plugin`) installiert, in *Options → Plugins → NINA-PM*
verbunden. NINA-Namen auf Englisch (Kategorie in Klammern).

## 1. „Eine Nacht mit Safety“ – `one-night-safety.json`

*Sequencer* → *Advanced Sequencer*, leere Sequenz.

**Sequence Start Area**, in dieser Reihenfolge (erst warten, dann entparken, H3):
1. *Wait if Sun Altitude* (Utility): warten, solange die Sonne **höher als −6°** steht.
2. *Unpark Scope* (Telescope).
3. *Cool Camera* (Camera): Temperatur des Rigs eintragen (Vorgabe −10 °C), Dauer 10 min.
4. *Run Autofocus* (Focuser) – einmal je Nacht vor dem ersten Ziel (NT-24).

**Sequence Target Area:**
1. *Sequential Instruction Set* (Container), Name „NINA-PM Nacht“ – Bedingung *NINA-PM Night Loop* (NINA-PM).
2. Darin ein *Sequential Instruction Set*, Name „Ziel“:
   - Bedingungen: *NINA-PM Night Loop* **und** *Loop While Safe* (Safety Monitor).
   - Trigger: *Meridian Flip* (Telescope), *Autofocus After Time* (Focuser) mit `Amount` = AF-Intervall des Rigs in
     Minuten (M7), *Restore Guiding* (Guider). Optional *Autofocus After HFR Increase*, *Center After Drift*.
     **Kein** *Dither after Exposures* (das Dithern steuert der Plan, NT-23). In den NINA-Optionen beim Meridian-Flip
     *Recenter* **aus** (NT-22).
   - Anweisung: *NINA-PM Instructions* (NINA-PM).
3. Darunter, ebenfalls in „NINA-PM Nacht“, ein *Sequential Instruction Set*, Name „Sicherung“:
   - Bedingungen: *Loop While Unsafe* (Safety Monitor) **und** *NINA-PM Night Loop*.
   - Anweisungen: *Stop Guiding* → *Park Scope* → *NINA-PM Wait until Safe or Night End* → *Unpark Scope*.
     Nicht NINAs *Wait until Safe* (wartet ohne Frist, H2).

**Sequence End Area:** *Stop Guiding* → *Park Scope* → *Warm Camera*.

Speichern: *Save Sequence As* → `one-night-safety.json`.

## 2. „Eine Nacht ohne Safety“ – `one-night.json`

Wie 1, aber im Container „Ziel“ **ohne** *Loop While Safe* und **ohne** den Container „Sicherung“ (H2). Speichern als
`one-night.json`.

## 3. Vor dem Einchecken

- Keine Gerätewerte, die nur zu einem Rig passen (Filter, Pfade, Profilnamen); Temperatur −10 °C und AF-Intervall
  60 min als neutrale Vorgaben.
- Die Dateien werden unverändert eingecheckt (keine Handbearbeitung); `SequenceInspector` (AP-16h) prüft sie später
  gegen die Vorlage.

## 4. Testkopie für Läufe tagsüber (Test-Server)

Für Läufe gegen `pnpm nina-test-server` eine Kopie der Sequenz verwenden und darin *Wait if Sun Altitude* deaktivieren
(Rechtsklick → *Disable*), sonst wartet NINA bis zur Dämmerung; *Run Autofocus* darf für Kurztests ebenfalls deaktiviert
werden. Die eingecheckten Beispielsequenzen bleiben vollständig.
