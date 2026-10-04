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
   - Anweisungen, in dieser Reihenfolge:
     1. **Wiederherstellen** – Park-Variante: *Unpark Scope* (Telescope); Home-Variante: *Set Tracking* (Telescope) →
        *Sidereal*. Rig-abhängig dazu z. B. Strom an (*Set Switch Value*), *Open Cover*, kurze Wartezeiten
        (*Wait for Time Span*). Läuft einmal zu Nachtbeginn und nach jeder Safety-Pause.
     2. Ein *Sequential Instruction Set*, Name „Blöcke“, Bedingung *NINA-PM Night Loop*, darin *NINA-PM Instructions*
        (NINA-PM). Es wiederholt nur den Block-Aufruf – stünde *NINA-PM Instructions* direkt in „Ziel“, liefe die
        Wiederherstellung vor jedem Block.
3. Darunter, ebenfalls in „NINA-PM Nacht“, ein *Sequential Instruction Set*, Name „Sicherung“:
   - Bedingungen: *Loop While Unsafe* (Safety Monitor) **und** *NINA-PM Night Loop*.
   - Anweisungen: *Stop Guiding* → **Sichern** – Park-Variante *Park Scope*; Home-Variante *Find Home* → *Set Tracking*
     → *Stopped*; rig-abhängig z. B. *Close Cover*, Strom aus → *NINA-PM Wait until Safe or Night End* als **letzte**
     Anweisung. Nicht NINAs *Wait until Safe* (wartet ohne Frist, H2).
   - **Nichts** hinter *NINA-PM Wait until Safe or Night End*: NINA prüft die Bedingungen nach jeder Anweisung und
     überspringt den Rest, sobald es sicher ist – ein *Unpark Scope* dort liefe nie (P-25-Lauf 02.10.2026).

**Sequence End Area:** *Stop Guiding* → *Park Scope* (Home-Variante: *Find Home* → *Set Tracking* → *Stopped*) →
*Warm Camera*.

Park oder Home: Home für Rigs, die nie geparkt werden (z. B. Remote-Standorte wie Starfront). Nach Home schaltet
NINAs Slew die Nachführung beim nächsten Ziel selbst wieder ein; *Set Tracking* → *Sidereal* in „Ziel“ macht es
ausdrücklich.

Speichern: *Save Sequence As* → `one-night-safety.json`.

## 2. „Eine Nacht ohne Safety“ – `one-night.json`

Wie 1, aber im Container „Ziel“ **ohne** *Loop While Safe* und **ohne** den Container „Sicherung“ (H2); die
Wiederherstellung am Anfang von „Ziel“ und der Container „Blöcke“ bleiben. Speichern als `one-night.json`.

## 3. „Mit Flats“ – `with-flats.json` (AP-50)

Wie 1 („Eine Nacht mit Safety“). Zusätzlich im Baustein *NINA-PM Instructions* (Container „Blöcke“) den Bereich
**„Flats am Nachtende“** aufklappen und die drei Boxen füllen (FA-NIN-17, `execution.md` §7):

1. **Vor Flats** (einmal): *Stop Guiding* (Guider) → Park-Variante *Park Scope* (Telescope), Home-Variante *Find Home* →
   *Set Tracking* → *Stopped*; mit Flat-Panel *Close Cover* und *Toggle Light* → *On* (Flat Panel). Für **Himmelsflats**
   (Rig: Flat-Quelle *Himmel*) nicht parken und das Panel weglassen.
2. **Je Kombination:** *Trained Flat Exposure* (Flat Panel), direkt danach *Trained Dark Flat Exposure* (Flat Panel), bei
   beiden *Keep Panel Closed* **an** (NT-39). Filter, Gain, Offset, Binning und Anzahl **nicht** eintragen – das Plugin
   schreibt sie je Kombination hinein (Anzahl aus den Rig-Einstellungen). Für Himmelsflats statt dessen *Sky Flat*.
3. **Nach Flats** (einmal): *Toggle Light* → *Off*, *Open Cover* nur, wenn das Panel tagsüber offen stehen soll.

Die Box *Je Kombination* entscheidet, ob Flats laufen: ist sie leer, nimmt das Plugin trotz eingeschalteter Flats keine
auf (Hinweis im Log). Speichern als `with-flats.json`. Entsteht beim VM-Termin für P-12 in NINA (das Flat-Panel liefert
der OmniSim-*Cover Calibrator*); bis dahin fehlt die Datei im Ordner `Samples/`.

## 3a. „Mehrere Nächte“ – `multi-night.json` (AP-52)

Wie 1, aber alles Nächtliche liegt in einem Container **„NINA-PM Tage“** im Ziel-Bereich mit der Bedingung
*NINA-PM Day Loop* (Enddatum leer, höchstens 14 Nächte; FA-NIN-07). Darin in dieser Reihenfolge:

1. *NINA-PM Wait for Time*: Quelle *Nautische Dämmerung*, Versatz 0, Tageswechsel 12:00. Die Zeit gilt in Standortzeit,
   nicht in der Zone des NINA-PCs (NT-06). Sie steht **vor** dem Entparken (H3).
2. *Unpark Scope* → *Cool Camera* → *Run Autofocus*: der Start-Bereich von 1, jetzt jede Nacht.
3. Die äußere Schleife „NINA-PM Nacht“ aus 1, unverändert („Ziel“, „Blöcke“, „Sicherung“).
4. *Stop Guiding* → *Park Scope* → *Warm Camera*: jeden Morgen (Home-Variante wie in 1).

Der Start-Bereich der Sequenz bleibt leer. Der Ende-Bereich bleibt wie in 1 (Parken nach der letzten Nacht).
Die Datei ist aus `one-night-safety.json` abgeleitet (gleiche Objekte, neue `$id`s für den Container und die
Morgen-Anweisungen). Ob NINA sie lädt, prüft der VM-Lauf zu P-23; danach wie in Abschnitt 4 aus NINA neu exportieren.

## 4. Vor dem Einchecken

- Keine Gerätewerte, die nur zu einem Rig passen (Filter, Pfade, Profilnamen); Temperatur −10 °C und AF-Intervall
  60 min als neutrale Vorgaben.
- Die Dateien werden unverändert eingecheckt (keine Handbearbeitung); `SequenceInspectorTests` (AP-16h) prüft sie in
  der CI gegen die Vorlage – beide ergeben keinen Hinweis.
- **Ausnahme AP-16h:** Die Fassungen aus AP-16c entstanden vor der Spec-Ergänzung „Blöcke“/„nichts hinter der
  Warte-Anweisung“ und wurden per Skript umgebaut (Container „Blöcke“ in „Ziel“ mit *Unpark Scope* davor, *Unpark
  Scope* hinter *NINA-PM Wait until Safe or Night End* entfernt). Beim nächsten VM-Termin in NINA laden, mit dieser
  Liste vergleichen und unverändert mit *Save Sequence As* wieder speichern; der NINA-Export ersetzt die Skriptfassung.

## 5. Testkopie für Läufe tagsüber (Test-Server)

Für Läufe gegen `pnpm nina-test-server` eine Kopie der Sequenz verwenden und darin *Wait if Sun Altitude* **löschen**,
sonst wartet NINA bis zur Dämmerung; *Run Autofocus* darf für Kurztests ebenfalls gelöscht werden. **Nicht nur
deaktivieren:** NINA 3.2 speichert den Zustand „deaktiviert“ nicht (`SequenceItem.Status` ist keine JSON-Eigenschaft) –
nach dem nächsten Laden wäre die Anweisung wieder aktiv (VM-Prüfstand 03.10.2026). Deaktivieren hilft nur, wenn die
Sequenz danach ohne erneutes Laden gestartet wird. Der VM-Prüfstand erzeugt seine Laufsequenz selbst
(`tools/vm-bench/src/sequence.ts`). Die eingecheckten Beispielsequenzen bleiben vollständig.
