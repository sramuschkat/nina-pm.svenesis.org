# Analyse: Astro-PM-NINA-Plugin (GitHub) im Abgleich mit Svenesis NINA-PM

Stand 17.09.2026 · Quelle: `github.com/Josh-Jones-76/AstroPM.NINA.Plugin`, Commit `5dd621d` (v1.6.0.0, 56 Commits vom 27.04. bis 16.09.2026), vollständig gelesen: `ScheduleEngine.cs` (2.411 Zeilen), `SessionScheduler.cs` (870), `TargetInstructionSet.cs` (2.431), `AstroPMChildItems.cs`, Trigger, Schleifenbedingungen, Services, `ExoTransit.cs`, `AstroCalculator.cs`, `docs/engine-flowchart.html`.
**Entscheidung 17.09.2026 (Sven):** Empfehlung angenommen – Ausführung im Plugin weitgehend übernehmen; Zuteilungsalgorithmus in die TypeScript-Engine übernehmen (mit genauer Astronomie, Overheads, Meridian-Flip); C#-Code als Vergleichsorakel für Tests; genaue Astronomie, Server-Plan, Rückmeldung der Aufnahmen und Flats nach mechanischem Winkel bleiben. Umsetzung: `specs/engine/allocation.md` (Abweichungen A-1…A-12), `specs/nina/execution.md`, FK 1.10, TK 1.7, Schema 1.7. E-2 (unsere Mondformel), E-3 (Überschuss/Bonus trennen) und E-5 (Plugin-Basis) übernommen; E-4 (Horizontlinie) und Remote Play/Pause entfallen, weil beides laut Fachkonzept (FA-STO-02, Kap. 2.3) ausdrücklich nicht gewünscht ist.

**Lizenz: MIT** (© 2026 Astro PM) – Code darf mit Copyright-Hinweis übernommen werden; Name/Marke „Astro PM“ nicht verwenden.

---

## 1. Kurzfazit

| Bereich | Taugt als Grundlage? | Begründung |
|---|---|---|
| **Ausführung in NINA** (Container, Trigger, Filter, Belichtung, Flats, Schleifen, Robustheit) | **Ja, sehr** | Praxiserprobt, löst genau die Fragen unseres Spikes AP-S2b (Trigger zwischen Belichtungen, Flip-Koordinaten, Autofokus-Zählung, Flat-Anweisungen). Viele datierte Fehlerbehebungen aus dem Feld. |
| **Zuteilungslogik** (Mond-Stufen, Durchläufe, Filterwahl) | **Ja, als fachliche Vorlage** | Deutlich ausgereifter als unsere `allocation.md` bei Mondstufen, Filterwahl und Randfällen – aber heuristisch, ohne Overheads und schwer exakt zu spezifizieren. |
| **Astronomie** | **Nein** | Mond nach mittlerer Bewegung ohne Störungsterme: im Mittel ~6° Fehler bei Mondhöhe und Mond-Ziel-Abstand (bis 14°), Sonne bis 1,7°, keine Refraktion/Präzession/Parallaxe. Unsere Engine (astropy-Referenz) bleibt. |
| **Datenfluss / Architektur** | **Nein** | Plugin plant lokal einmal pro Nacht, meldet **keine** Aufnahmen an die Cloud zurück, Planung ohne Overheads. Unser Server-Plan + Ingest-API ist für eine Web-App mit Mandanten nötig. |

**Empfehlung:** Plugin-Ausführung weitgehend nach diesem Code bauen (portieren/übernehmen), die Zuteilungsheuristik fachlich übernehmen und in unsere TypeScript-Engine mit genauer Astronomie und Overheads einbauen. Details und Entscheidungsbedarf in Abschnitt 7.

---

## 2. Architektur von Astro PM

```
Desktop-App (C#, Planung, Simulator)  ──push──►  Cloud (PHP: project_sync, imaging_systems_sync, nina_control)
                                                        │  POST {sync_token, action:list, status:"Active"}
                                                        ▼
NINA-Plugin (C#, net8.0-windows): holt Ziele + Rig-Einstellungen ─► rechnet Plan LOKAL (Kopie der Desktop-Engine)
                                    └─► führt Blöcke aus, zählt nur lokal (Offline-Modus), meldet Kamera-Auslesemodi
Handy: Remote Play/Pause über nina_control (Plugin pollt ~2 min, quittiert)
```

- **Zuordnung Rig:** Plugin wählt ein „Imaging System“; Ziele werden über **Namen** von Standort/Teleskop/Kamera gefiltert.
- **Einstellungen je Rig** (`sim_settings`): Strategy, Playback, SortChain, BonusEnabled, OvershootPercent, MosaicPanelPreference, Dither (Every), FilterSwitch (Count, Tolerance), FlatsEnabled, FlatsFullSet, SiteLat/Lon (Warnung > 10 km Abweichung zum NINA-Profil).
- **Zieldaten:** Projekt → Panels (RA/Dec/Rotation) → Exposure Sets (Filter, Belichtung, Planned/Acquired/Accepted, Gain, Offset, Binning, Readout-Mode, `avoid_lunar`, `enabled`, Mondprofil) + Constraints (Dämmerung, Mindesthöhe, Mindestzeit, Projekt-Mondwerte, Priorität, Exoplanet-JSON).
- **Fortschritt:** `Remaining = Planned − Accepted` kommt aus der Desktop-App. Das Plugin sendet keine Aufnahmen; nur im Offline-Modus zählt es lokal im Cache hoch.
- **Plan:** einmal je Nacht beim Start von „Astro PM Instructions“ (Nacht = Mittag bis Mittag). Neuberechnung nur nach *Reset* oder neuer Nacht; nicht vor jedem Block.
- **Cache:** `target_cache.json`; online höchstens 7 Tage alt verwendbar, Offline-/Urlaubsmodus unbegrenzt; abgelehntes Token (401/403) → Cache wird **nicht** genutzt.

---

## 3. Planungsalgorithmus Schritt für Schritt

Pipeline: `BuildTimeSlots → BuildTargetProfiles → BuildMatrix → ComputeOverlap → OrganizeMoonBlocks → PaintSlots | PaintSlotsGreedy → WalkToLog (PickExposureSet) → ParseBlocks → Validate`

### 3.1 Zeitraster
- Suche ab 16:00 lokal in 5-min-Schritten (18 h) nach bürgerlicher Dämmerung (−6°). Fenster = Abenddämmerung −1 h … Morgendämmerung +1 h (Fallback 18:00 + 12 h), auf 5 min gerundet.
- Je Slot: Sonnenhöhe, Mondhöhe, Mondbeleuchtung (Werte zum Slotbeginn).

### 3.2 Zielprofile und Mond-Stufen („Tiers“)
- Je Slot: Zielhöhe, Mond-Ziel-Abstand; **nutzbar** = Sonne < Dämmerungsgrenze **und** Höhe ≥ Mindesthöhe **und** (falls NINA-`.hrz` geladen) Höhe ≥ Horizontlinie beim Azimut.
- **Aussortiert**, wenn der längste zusammenhängende nutzbare Lauf < Mindestzeit ist; Exoplaneten ohne Transit in der Nacht ebenfalls.
- **Mondsicherheit einer Belichtungszeile** (`IsExposureSetMoonSafe`):
  1. keine Mondvermeidung → sicher
  2. Mondhöhe ≤ 0° → sicher
  3. Mondhöhe ≤ **Max-Höhe** des Profils (Standard 5°) → sicher
  4. Beleuchtung ≤ max. Beleuchtung → sicher
  5. sonst Abstand ≥ `A / (1 + (d/W)²)` mit d = |Tage seit Neumond − P/2| (mittlere Phase).
  *Hinweis:* Die Relax-Formel (Relax-Faktor, Min-Höhe) steht in `RequiredMoonSeparation`, wird aber wegen Stufe 3 **nie erreicht** – Relax und Min-Höhe haben im Plugin keine Wirkung.
- **Stufen:** Stufe 0 = Zeilen ohne Mondvermeidung. Übrige Zeilen werden nach Profilname (bzw. „Project Default“) gruppiert; **Restriktivität = Abstand × (1 + 100 / (maxBeleuchtung + 1))**; „No Moon“ (Name oder MaxAlt ≤ 0 und MaxIllum ≤ 0) = ∞ und *nur bei Mond unter Horizont*. Stufen aufsteigend nach Restriktivität nummeriert; je Stufe und Slot eine Sicherheitsmaske.
- Mosaik mit „Panel Preference“: je Panel ein eigenes Profil (Einheit), sonst ein Profil je Projekt.
- **Overshoot:** Restbedarf = Planned + ⌈Planned × Overshoot %⌉ − Accepted (garantierte Zusatzframes, vor Bonus).

### 3.3 Matrix
- `CanImage` (nur Höhe/Dunkelheit), `MoonDown` (Mond ≤ 0°), `UsableSlot` (irgendeine Stufe mit Restarbeit ist hier sicher), Restarbeit je Stufe in Sekunden.
- **MinChunk** = Mindestzeit; ist die gesamte Restarbeit kleiner, wird MinChunk auf die Restarbeit verkleinert (Projektende = unser „Restposten“).
- `IsConstrained` = nutzbare Slots × 300 s < 2 × MinChunk. `PeakAltitude`, `First/LastUsableSlot`.

### 3.4 Überlappung und „Moon Blocks“
- Je Slot Anzahl Kandidaten. `OrganizeMoonBlocks` schreibt eine Stufen-Empfehlung je Slot (Mond unten: restriktivste; Mond steigt: tolerante zuerst; Mond sinkt: restriktive zuerst) – **das Ergebnis wird im weiteren Code nicht gelesen** (die Richtungslogik wirkt nur in der Filterwahl 3.8).

### 3.5 Strategie „Shared Time“ (proportional) – `PaintSlots`
1. **Transit-Vorabbelegung:** Slots, deren Mitte im Fenster [Mitte − T14/2 − 1 h, Mitte + T14/2 + 1 h] liegt, werden gesperrt; übrige Arbeit des Exoplaneten = 0.
2. **Vorfilter:** erreichbare Arbeit (mondsicher bzw. Breitband in unsicheren Slots) < MinChunk → Ziel fällt heraus.
3. **Pass 0 – exklusive Slots:** Slot mit genau einem Kandidaten wird sofort zugeteilt. **Pass 0b:** zu kurze exklusive Läufe werden bis MinChunk nach hinten/vorne verlängert.
4. **Pass 1a – nur-mondlos-Arbeit:** Arbeit, die heute nur bei Mond unter Horizont geht (No-Moon-Stufen oder Stufen ohne sicheren Mond-oben-Slot), teilt sich die Mond-unten-Slots fair nach diesem Bedarf.
5. **Pass 1b – übrige Mondvermeidungs-Arbeit** auf restlichen Mond-unten-Slots: erst „exklusive“ Ziele (weniger als MinChunk sichere Mond-oben-Slots), dann „flexible“.
6. **Pass 2 – restliche Mond-unten-Slots** fair nach Gesamtbedarf.
7. **Pass 3a – früh untergehende Ziele** (letzter Slot > 30 min vor dem letzten Mond-oben-Slot der Nacht) reservieren ihren proportionalen Anteil innerhalb ihres eigenen Fensters.
8. **Pass 3 – Mond-oben-Slots** fair nach erreichbarer Arbeit.
9. `EnforceMinimumAllocations` → `PruneSlivers` → **Bonus** (nur Ein/Aus: freie Slots werden vom Nachbarblock vorwärts, dann rückwärts übernommen) → `DefragmentSlots` → `PruneSlivers` → freie Slots in Nachbarblöcke aufnehmen („absorb“, **auch ohne Bonus**).

**Fair-Share-Verteilung** (`PaintPassFairShare`), Angebot = Anzahl geeigneter Slots × 300 s:
- Bedarf ≤ Angebot → jeder bekommt seinen Bedarf.
- Summe der Mindestzeiten ≤ Angebot → jeder seine Mindestzeit, Rest proportional zum Bedarf über der Mindestzeit.
- sonst **knapp:** in Sortierreihenfolge erhält jedes Ziel seine Mindestzeit, solange sie noch passt; die anderen gehen leer aus.
- Die **Sortierkette** bestimmt hier nur die Reihenfolge beim Malen und im Knapp-Fall.
- `PaintChunks` malt das Budget in zusammenhängende Läufe: zuerst an eigene Slots angrenzend, dann längste Läufe; neue kurze Läufe (< MinChunk) nur, solange das Ziel seine Mindestzeit noch nicht hat; Budget wird bei Bedarf auf MinChunk aufgerundet.

### 3.6 Strategie „Manual Priority“ – `PaintSlotsGreedy`
Transit-Vorabbelegung → Vorfilter → je Ziel in Prioritätsreihenfolge: (A) nur-mondlos-Arbeit auf Mond-unten-Slots, (B) chronologisch alle freien Slots, in denen eine Stufe mit Arbeit sicher ist (restriktivste zuerst, sonst Stufe 0). Danach dieselben Nacharbeiten wie 3.5. Keine exklusive Vorabbelegung.

### 3.7 Gemeinsame Nacharbeiten
- **EnforceMinimum:** zu kurze Zuteilung erst in freie Nachbarslots verlängern, dann Randslots von Nachbarn „leihen“, die über ihrer Mindestzeit bleiben, sonst komplett freigeben.
- **PruneSlivers:** Kurzläufe neben einem vollwertigen Lauf werden dem Nachbarn überlassen; getrennte Kurzläufe bleiben, außer winzige Reste (≤ max(2, MinChunk/4)), die ein Nachbar komplett abdecken kann.
- **Defragment:** Muster A-B-A → A-A-B, wenn beide in den getauschten Slots arbeitsfähig sind (max. 20 Runden).
- **DecrementWork:** Mond-unten-Slots verbrauchen restriktivste Stufe zuerst, Mond-oben-Slots Stufe 0 zuerst, sonst proportional.

### 3.8 Ablauf je Block und Filterwahl – `WalkToLog` / `PickExposureSet`
- Uhr läuft **nur um die Belichtungszeit** weiter – kein Download, Slew, Filterwechsel, Dither, Autofokus oder Meridian-Flip im Plan.
- Neues Ziel ohne passende Arbeit am Blockanfang: führende Slots an ein anderes Ziel mit Arbeit abgeben; sonst Bonus-Probe; sonst Slots freigeben (Leerlauf statt sinnlosem Slew).
- **Kandidaten:** Zeilen mit Rest > 0 (bzw. alle bei Bonus), Belichtung > 0, `enabled`, mondsicher im aktuellen Slot.
- **Mosaik ohne Panel-Profile:** nach MinTimeOnTarget je Panel rotieren; bei Mond unten vom Panel ohne Mondvermeidungs-Arbeit wegwechseln; kurz vor Blockende Panel sperren.
- **Kandidatenpool:** Mond unten + Mondvermeidungs-Arbeit → nur diese Zeilen; Mond oben → Breitband bevorzugt; „No Moon“-Zeilen exklusiv bei Mond unten.
- **Dringlichkeits-Sortierung:** (1) *Headroom* = verbleibende zusammenhängende sichere Zeit der Zeile ab jetzt (kleiner zuerst); (2) Restriktivität – Mond unten/steigend: restriktivste zuerst, Mond oben & sinkend: tolerante zuerst; (3) größter **Restbedarf zu Nachtbeginn** (Farbkanäle bleiben ausgeglichen); (4) Definitionsreihenfolge.
- **Filterwechsel alle N:** Filter bleibt, bis N Belichtungen erreicht sind; dann Rundlauf zur nächsten Zeile in der sortierten Liste, die ihre **Laufbahn** erfüllt: passen `min(⌈N × Toleranz⌉, Rest)` Belichtungen in min(verbleibende Blockzeit, eigenen Headroom)? Passt keine → aktueller Filter bleibt. **Zeitkritischer Schutz:** schließt das Fenster des aktuellen Filters früher als das des nächsten und würde Ausleihen Arbeit kosten, bleibt er – rotiert aber innerhalb gleich dringender Filter.
- **Bonus-Belichtung:** keine Planarbeit → dieselbe Wahl über abgeschlossene Zeilen; letzte Rettung: vorige Zeile wiederholen, falls mondsicher. Unbegrenzt (keine Obergrenze).
- **Nachtende:** genau eine letzte Belichtung darf über das Ende hinauslaufen.
- **Dither** alle N Belichtungen (nicht bei Exoplaneten); Filterwechsel setzt Zähler zurück. Exoplaneten ohne Filterwechsel.
- **ParseBlocks:** Block = von Slew bis nächstem Slew/Wait; Mosaik-Panel aus den Einträgen abgeleitet.

### 3.9 Plausibilitätsprüfungen (Simulator)
`IDLE-GAP` ≥ 10 min Leerlauf trotz nutzbarem Ziel (Fehler) · `LA-UNSAFE` Mondvermeidungs-Filter unsicher belichtet (Fehler) · `TOTAL-MIN` unter Mindestzeit · `NO-ALLOC` Arbeit + Zeit, aber 0 Belichtungen · `LA-MISS` Mondvermeidungs-Arbeit, Mond-unten-Zeit vorhanden, aber nicht genutzt · `FILTER-STUCK` ≥ 30 gleiche Belichtungen in Folge.

---

## 4. Ausführung in NINA – `TargetInstructionSet`

| Thema | Umsetzung in Astro PM |
|---|---|
| Container | Eigener `SequenceContainer` + `IDeepSkyObjectContainer`; **überschreibt `Execute`** und führt **einen Block je Aufruf** aus; Platzhalter-Kind, damit NINA den Container nicht überspringt. Äußere Schleife: „Astro PM Nightly Loop“ (`HasBlocksRemaining`). |
| Trigger | **Keine Kind-Elemente:** vor und nach jeder Belichtung ruft das Plugin `RunTriggers`/`RunTriggersAfter` auf **allen Vorfahren-Containern** auf (inkl. globaler Trigger). |
| Meridian-Flip | NINAs eigener Flip-Trigger. Damit er Zielkoordinaten findet: `exposureItem.AttachNewParent(this)` und `Target` des Containers setzen. `GetEstimatedDuration()` = Belichtungszeit, sonst startet eine lange Belichtung kurz vor dem Flip-Limit. |
| Autofokus | Belichtung implementiert `IExposureItem` (ImageType LIGHT) und trägt sich in `ImageHistoryVM` ein → „AF nach n Belichtungen“ zählt. Filter wird **vor** den Triggern gewechselt → „AF nach Filterwechsel“ sieht den neuen Filter. |
| Center after drift / Benutzer-Anweisungen | Koordinaten werden in `CenterAfterDriftTrigger` und in die eigenen Trigger-Boxen injiziert (`CoordinatesInjector`). |
| Eigene Boxen | „Before/After Each Exposure“, „Before/After Target Change“ (Before Target nach Slew/Center/Rotate, vor Guiding). |
| Blockablauf | vergangene Blöcke überspringen → leere Blöcke überspringen → bis Blockstart warten (Skip möglich) → Machbarkeit (Höhe/Dunkelheit jetzt) → **Slew/Center (mit Rotator: Center & Rotate auf PA, ohne: nur Center)** mit Wiederholungsleiter 15 s … 10 min (10 Versuche, Abbruch vor Blockende) → Before-Target → Guiding → Belichtungsschleife bis Blockende → After-Target. |
| Playback | **Time-Aware:** springt zum Eintrag, der laut Plan „jetzt“ laufen sollte (überspringt Belichtungen nach Verzögerungen). **Sequential:** strikt der Reihe nach bis Blockende. Dither nur, wenn zwischen letztem und aktuellem Eintrag ein Dither lag. |
| Belichtung | Blockende-/Sessionende-Prüfung (Ausnahme letzte Belichtung der Nacht) → Filter auflösen: exakt, sonst **eindeutiges** Präfix in beide Richtungen; nicht gefunden → Belichtung überspringen + einmal je 12 h melden (nie durch falschen Filter belichten) → Auslesemodus als Index → `CaptureImage` → Historie → Metadaten (Zielname, Koordinaten, PA) → `ImageSaveMediator.Enqueue`. |
| Flats | Drei Boxen **Before Flats / Flats je Kombination / After Flats** am Sessionende. Kombination = Ziel + Filter + **Himmels-PA** + Gain + Offset + Binning; mechanischer Rotatorwinkel der ersten Aufnahme gespeichert. Persistiert in `flat_specs.json` (NINA-Neustart). Optional **voller Filtersatz**. Gleiche Kombinationen verschiedener Ziele nur einmal aufnehmen, Dateien per Pfad-Ersetzung des Zielnamens kopieren. Filter/Gain/Offset/Binning werden in Trained Flat/Dark Flat, Auto Exposure/Brightness Flat und Sky Flat geschrieben; fehlender Trained-Flat-Eintrag wird vorab gemeldet. Guiding wird gestoppt; Boxen laufen in einem **Container ohne Parent**, damit keine Sequenz-Trigger feuern; Schleifenzähler werden rekursiv zurückgesetzt. |
| Nachtwechsel | Nacht-Schlüssel Mittag–Mittag; Session gilt 2 h nach Ende **und** bei neuem Nacht-Schlüssel als veraltet → Neuaufbau. Leerer oder fehlgeschlagener Aufbau → 5 min Sperre (verhinderte Endlosschleifen mit 4 Cloud-Abrufen/s). |
| Schleifen | „Nightly Loop“ (Blöcke übrig oder Flats offen) · „Daily Loop“ (Cache hat Restarbeit) · „Astro PM Wait for Time“ (mit Remote-Pause) · „Refresh Cloud Targets“. |
| Remote Play/Pause | Globaler Trigger pollt Cloud ~2 min; bei Pause hält er an der nächsten Elementgrenze, quittiert „paused“ und prüft alle 30 s; Netzausfall behält letzten Zustand. |
| Bedienung | *Reset Schedule* (inkl. Flat-Tracking und NINA-Status), *Skip Block*, Blockliste mit Meridianzeit, Live-Status, „In Framing-Assistent laden“ (per Reflection). |

---

## 5. Befunde und Schwächen

| # | Befund | Folge |
|---|---|---|
| S-1 | **Mondposition nach mittlerer Bewegung** (Sonnenlänge + Phasenwinkel, Breite als Sinus), Beleuchtung aus mittlerer Phase, geozentrisch, ohne Refraktion/Präzession. Nachgerechnet gegen Meeus (Hauptterme, 0,1° genau) für 2026, Standort 51° N: **Mondhöhe mittel 6,1°, 95 % 11,5°, max 13,7°; Mond-Ziel-Abstand mittel 6,1°, max 12,0°; Sonnenhöhe max 1,7°; Beleuchtung max 8,6 %-Punkte.** | Mondsicherheit und Dämmerungszeiten sind ungenau (Sonne 1,7° ≈ 8–10 min). Nicht übernehmen. |
| S-2 | Relax-Faktor und Min-Höhe des Mondprofils wirkungslos (Stufe „Mond ≤ Max-Höhe → sicher“ greift vorher). | Semantik weicht von unserem `moon.md` ab (siehe 7, E-2). |
| S-3 | „No Moon“ in der Zuteilung = nur Mond unten, in der Filterwahl dagegen normale Formel (bei schmaler Sichel mit Mond oben kann „sicher“ herauskommen). | Uneinheitlich. |
| S-4 | **Planung ohne Overheads** (Slot = 300 s Belichtung). | Plan überbucht; Time-Aware überspringt dann Belichtungen, Sequential nimmt weniger auf. Unser Overhead-Modell bleibt. |
| S-5 | Meridian-Flip nicht geplant (nur NINA-Trigger zur Laufzeit). | Kein Flip-Overhead im Plan; wir behalten FA-SCH-17. |
| S-6 | Kein Rückmelden von Aufnahmen; Plan einmal pro Nacht. | Für Web-App ungeeignet; unser Ingest + Neuplanung vor jedem Block bleibt. |
| S-7 | Flat-Kombination nach **Himmels-PA** statt mechanischem Winkel; mechanischer Winkel von der ersten Aufnahme. | Mit Rotator nach einem Flip bekommen die Lights der zweiten Nachthälfte Flats mit 180° falschem Rotatorwinkel. Unser FA-NIN-17 (mechanischer Winkel) ist richtig. |
| S-8 | `OrganizeMoonBlocks`/`ComputeOverlap` ohne Wirkung auf das Ergebnis. | Toter Code; nicht nachbauen. |
| S-9 | Bonus unbegrenzt; „absorb“ füllt freie Slots auch ohne Bonus mit Nachbarzielen. | Wir begrenzen Bonus (Overshoot) – bewusst anders. |
| S-10 | Transitfenster ohne Unsicherheitspuffer (nur ±1 h Baseline), TT−UTC als Konstante, Rømer ohne Jupiter/Saturn. | Unser `transit.md` ist genauer. |
| S-11 | Auslesemodus: Name in den Daten, Ausführung parst als Index (`int.TryParse`). | Vorsicht beim Übernehmen; wir liefern Index **und** Name. |
| S-12 | Pass 0 (exklusiv) prüft nur Höhe/Dunkelheit, nicht Mond. | Kann Slots an Ziele geben, die dort nichts belichten dürfen (wird später im Walk repariert). |

---

## 6. Abgleich mit unserem Konzept

### 6.1 Übernehmen (fehlt oder ist bei uns schwächer)

| Punkt | Astro PM | Bei uns heute | Vorschlag |
|---|---|---|---|
| Mond-Stufen | Gruppen nach Profil, Restriktivität `A × (1 + 100/(maxIllum+1))`, No-Moon = ∞ | Zeile nach Anzahl mondsicherer Slots, Gleichstand Profil-Abstand | Stufenbildung übernehmen; Anzahl sicherer Slots als Laufzeit-Maß (Headroom) ergänzen |
| Mond-unten-Zeit zuerst an nur-mondlos-Arbeit (Pass 1a/1b) | ja | nein | übernehmen |
| Früh untergehende Ziele reservieren Anteil im eigenen Fenster (Pass 3a) | ja | nur Sortierkette | übernehmen |
| Fair Share mit Mindestzeit-Stufen (genug/Mindestzeiten/knapp) | ja | Water-Filling ohne Mindestzeit-Stufe | übernehmen (Knapp-Fall!) |
| Mindestzeit erzwingen: verlängern → leihen → freigeben | ja | nur Kandidatenbedingung | übernehmen |
| Splitter entfernen, A-B-A defragmentieren | ja | Lückenfüller | übernehmen |
| **Filterwahl** mit Headroom, Mond steigend/sinkend, Restbedarf zu Nachtbeginn, Laufbahn-Toleranz, zeitkritischer Schutz | ja | restriktivste Zeile / einfacher Rundlauf | **übernehmen** (größter fachlicher Gewinn) |
| Mosaik: Panel-Rotation nach Mindestzeit, Panel-Sperre kurz vor Blockende | ja | Panels als Einheiten | als Option „Panels gemeinsam“ übernehmen |
| Blockanfang ohne Arbeit → an anderes Ziel abgeben / freigeben | ja | nein | übernehmen |
| Letzte Belichtung der Nacht darf überziehen | ja | Blockende hart | übernehmen (nur Nachtende) |
| Overshoot als **garantierte** Zusatzframes | ja (vor Bonus) | Overshoot = Bonus-Obergrenze | Begriffe trennen (E-3) |
| Plausibilitätsprüfungen IDLE-GAP … FILTER-STUCK | ja | Diagnose je Projekt | als Simulator-Warnungen übernehmen |
| Horizontlinie (NINA `.hrz`) | ja | ausdrücklich nicht (FK 8.1) | optional aufnehmen: Horizont je Standort, Upload der `.hrz` (E-4) |
| Trigger-Ausführung per Vorfahren-Walk, `AttachNewParent`, `GetEstimatedDuration`, `IExposureItem`, Filter vor Triggern, Koordinaten-Injektion | ja | „Kind-Elemente“ (offen, AP-S2b) | **übernehmen** → AP-S2b wird kleiner |
| Eigene Trigger-Boxen Before/After Exposure/Target | ja | Trigger-Sets (R5) | nach R1 vorziehen |
| Flat-Boxen in Isolations-Container, rekursives Zurücksetzen, Trained-Flat-Vorprüfung, Werte in alle Flat-Anweisungen schreiben | ja | Konzept ähnlich (AP-50) | übernehmen, Schlüssel aber mechanischer Winkel |
| Slew-Wiederholungsleiter, eindeutiges Filter-Präfix, nie mit falschem Filter belichten, 5-min-Sperre gegen Abrufschleifen, Nacht-Schlüssel/Stale-Logik, Token abgelehnt → kein Cache, Cache max. 7 Tage | ja | teilweise | als Plugin-Regeln übernehmen |
| Remote Pause/Play | ja | Befehle reserviert | `pause`/`resume` in `nina_command` + Heartbeat-Quittung (R1 oder R3) |

### 6.2 Bei uns besser – beibehalten
Genaue Astronomie mit Referenztests · Overheads inkl. Meridian-Flip im Plan · Server-Plan und Neuplanung vor jedem Block · Aufnahmen-Ingest, Zähler, Sessions, Nachtbericht · Flat-Kombination nach mechanischem Winkel · Transit mit Unsicherheitspuffer · Mandanten, Freigabe, Stimmen · deterministische Engine mit Soll-Plänen · Rig über ID statt über Namen von Standort/Teleskop/Kamera.

---

## 7. Empfehlung und Entscheidungen

**E-1 Zuteilungsalgorithmus.** Zwei Wege:
- **(a) Astro-PM-Heuristik portieren** (Abschnitt 3.5–3.8) in TypeScript, auf unserer genauen Astronomie, mit Overhead-bereinigter Slot-Kapazität, ohne toten Code (S-8) und mit korrigiertem S-3/S-12. `allocation.md` und Soll-Pläne werden danach neu geschrieben; zusätzlich **Differenztests** gegen den MIT-lizenzierten C#-Code (gleiche Slot-Masken → gleiche Blöcke, Abweichungen begründet). *Vorteil:* Verhalten wie gewohnt aus Astro PM, erprobte Randfälle. *Nachteil:* komplexer (AP-13a eher L+), Soll-Pläne neu.
- **(b) Unsere Spezifikation behalten** und nur die Filterwahl (3.8), Mond-Stufen, Mindestzeit-Nacharbeit und Pass 1a/3a gezielt einbauen. *Vorteil:* einfacher, Soll-Pläne bleiben weitgehend. *Nachteil:* Verhalten weicht von Astro PM ab.
- **Meine Empfehlung: (a)** – Sven kennt das Verhalten aus Astro PM, und die Heuristik steckt voller Praxisfälle, die wir sonst neu entdecken.

**E-2 Mondprofil-Semantik.** Astro PM: Mond ≤ Max-Höhe (5°) = sicher, Relax wirkungslos. Unser `moon.md`: Relaxierung zwischen Min- und Max-Höhe. Empfehlung: **unsere Formel behalten** (Profile wirken wie beschrieben), im Import aus Astro PM (OP-20) darauf hinweisen.

**E-3 Overshoot vs. Bonus.** Empfehlung: wie Astro PM trennen – *Overshoot %* = garantierte Zusatzframes (zählt als Planarbeit), *Bonus* = offene Füllung freier Zeit (Ein/Aus, optional Obergrenze).

**E-4 Horizontlinie.** Empfehlung: in R2 optional je Standort (`.hrz`-Upload), in Sichtbarkeit und Engine berücksichtigt.

**E-5 Plugin-Basis.** Empfehlung: `NinaPm.Nina`-Adapter auf Basis des Astro-PM-Plugins (MIT-Hinweis in `THIRD_PARTY_NOTICES.md`), Kern (`NinaPm.Core`) mit unserem API-Client, Outbox, Server-Plan und Ingest. AP-S2b wird zur Bestätigung dieser Muster (statt offener Recherche).

**Nächste Schritte nach Entscheidung:**
1. FK 6.7/6.9/8.2/8.3, TK 8.3/10 und Paket (`allocation.md`, `moon.md`, `flip-rotation.md`, Soll-Pläne, AP-13a/b, AP-S2b, AP-16a–f, AP-50) anpassen.
2. Neue Spezifikation `specs/nina/execution.md` mit den Mustern aus Abschnitt 4.
3. Bei E-1 (a): `tools/astropm-oracle` (C#-Engine ohne NINA-Abhängigkeit, .NET 8 auf Linux) für Differenztests.
