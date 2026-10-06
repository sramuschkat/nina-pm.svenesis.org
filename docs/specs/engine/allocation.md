# Spezifikation: Nachtplanung (`planNight`) – Zuteilung und Ablauf

Verbindlich für AP-13a (Orakel, Grid), AP-13b (Zuteilung `paint`, §2–7), AP-13c (Ablauf `walk`/`pick`, §8–9, `planNight`) und AP-13d (Flip, Transit, Diagnose, Ablauf-Soll-Pläne). Bezug: Fachkonzept 6.7 (FA-SCH-01…19), 8.1–8.3, 8.8; Technisches Konzept 8.3.
**Grundlage:** Planungs-Engine des Astro-PM-NINA-Plugins (MIT, Commit `5dd621d`, v1.6.0.0: `Models/ScheduleEngine.cs` = SE, `Models/SessionScheduler.cs` = SS), fachlich übernommen und nach TypeScript portiert, mit den Abweichungen aus §10. Analyse: `docs/history/Analyse_AstroPM_NINA_Plugin_2026-09-17.md`.
**Zwei Modi:** *Produktivmodus* (alle Abweichungen aktiv) und *Kompatibilitätsmodus* (§11.1: verhält sich wie das C#-Original, nur für Vergleichstests). Bei Unklarheit gilt im Kompatibilitätsmodus das Original; im Produktivmodus diese Spezifikation.

---

## 1. Schichten

```
planNight(PlanInput)
 ├─ buildNightContext()   Slots, Sonne, Mond (genaue Astronomie, AP-08b/10)
 ├─ buildProfiles()       §3  Nutzbarkeit, Mond-Stufen, Restarbeit je Einheit
 ├─ buildMatrix()         §4  inkl. Vorbelegung vergangener Slots bei Neuplanung (§5.3)
 ├─ paint()               §5 (proportional) bzw. §6 (manuelle Priorität), Nacharbeiten §7
 ├─ walk()                §8  Einträge mit Uhr inkl. Overheads, Filterwahl §9
 ├─ parseBlocks()         §8.4
 └─ validate()            §12 Warnungen + Diagnose je Projekt
```
`paint` arbeitet nur auf Masken und Zahlen; `walk` nutzt zusätzlich Belichtungszeiten, Overheads und Meridiandurchgänge.

## 2. Begriffe und Eingaben

| Begriff | Bedeutung |
|---|---|
| Slot | 300 s, Index `0 … S−1`. Kompatibilität: Masken **zum Slotbeginn** (Original). Produktiv: ein Slot ist nur nutzbar, wenn die Bedingung **zu Beginn und am Ende** gilt (`f(s·300) ∧ f((s+1)·300)`, A-26) – damit liegen Mindesthöhe, Dämmerung und Mondsicherheit über die ganze Belichtung vor. Transitfenster arbeiten mit der **Slotmitte** (§7.1), weil dort das Fenster und nicht die Sichtbarkeit zählt. |
| Nachtfenster | `start` = bürgerliche Abenddämmerung (Sonne geometrisch −6°) − 1 h, auf 5 min **abgerundet**; `end` = bürgerliche Morgendämmerung + 1 h, auf 5 min **aufgerundet**. Fehlt die Abenddämmerung: 18:00 Standortzeit; fehlt die Morgendämmerung: `start + 12 h` (SS 199–203) |
| `MoonDown[s]` | scheinbare Mondhöhe **≤ 0°** (derselbe Operator in `moon.md` Stufe 1 und `mustBeDown`) |
| Einheit („Row“) | Projekt, bzw. **je Panel**, wenn `rig.mosaic_panels_independent` (API `mosaicPanelsIndependent`, Standard an) |
| Belichtungszeile (ES) | Filter, Belichtung, Geplant, Akzeptiert, Gain/Offset/Binning/Auslesemodus, Mondprofil, aktiv |
| LA-Zeile | Zeile mit Mondvermeidung (Profil ≠ „kein“) |
| Planungsbedarf je Zeile | `effRemaining = max(0, Geplant + ⌈Geplant × overshootPct/100⌉ − Akzeptiert − pending_l)` (FK 8.4). **`pending_l` (verbindlich, NT-20):** Das Plugin sendet `pendingCaptures = [{exposureLineId, transitObservationId?, captureIds: [...]}]` – die IDs seiner noch **nicht mit 2xx quittierten** Light-Meldungen (Dead-Letter-Aufnahmen zählen nicht). Der Server zählt je Zeile nur die IDs, die **noch nicht** in `capture` stehen (`pending_l = |captureIds \ capture.id|`), und gibt der Engine die Zahl; so wird eine Aufnahme, deren Meldung schon angekommen ist, nicht doppelt abgezogen. Einträge mit `transitObservationId` betreffen nur die Transitzählung, nicht den Planungsbedarf (A-21) |
| Overhead je Belichtung | produktiv `ov = downloadS + ditherShare + filterShare + afShare` mit `ditherShare = (ditherEnabled ∧ ditherEvery > 0) ? ditherSettleS/ditherEvery : 0`, `filterShare = (filterSwitchEnabled ∧ filterSwitchEvery > 0) ? filterChangeS/filterSwitchEvery : 0`, `afShare = (afEveryMin > 0) ? afDurationS · (exposureS + downloadS)/(afEveryMin·60) : 0` (A-4). **Der Autofokus steckt ausschließlich hier** – `fix` enthält ihn nicht (sonst doppelt, ENG5-11). Kompatibilität: `ov = 0` |
| Arbeitssekunden je Zeile | Kompatibilität: `effRemaining × exposureS`; produktiv: `effRemaining × (exposureS + ov)` |
| Blockfixkosten `fix` | produktiv `fix = slewCenterS + (flipEnabled ∧ tM ≠ null ? flipDurationS : 0)` – Slew/Zentrieren je Block und ein erwarteter Meridian-Flip je Nacht; **ohne Autofokus** (der steckt in `ov`). Kompatibilität 0 (A-16). Die Flip-Annahme ist eine bewusste Überschätzung: ob der Flip wirklich in einen Block der Einheit fällt, steht erst nach dem Malen fest. Einen **Pierseitenwechsel beim Blockwechsel** (NT-27) rechnet erst der Walk (§8), nicht `fix` |
| Erwartete Pierseite | beim Slew auf Panel `p` zur Zeit `t`: `pierSide(p, t) = west`, wenn `LHA_p(t) < 0` (Ziel östlich des Meridians, Stundenwinkel wie `flip-rotation.md` §1.1), sonst `east`; nach einem `meridian_flip` im Block gilt `east` (NT-34; Zuordnung zu ASCOM `pierWest`/`pierEast` in `execution.md`). Pierseite am Blockende = Seite beim letzten Slew bzw. `east` nach dem Flip. Ohne `flipEnabled` wird keine Pierseite berechnet |
| Erwartete Blockzahl | `nBlocks_i = 1 + ((|{s : MoonDown ∧ UsableSlot}| > 0 ∧ moonUpUsableSlotCount(r) > 0) ? 1 : 0)` – aus den Matrixgrößen (§4), also **vor** dem Malen berechenbar; nur für den Bedarf (A-16) |
| MinChunk | Mindestzeit am Ziel in s; `MinChunkSlots = max(1, ⌈MinChunk/300⌉)`. **Validierung** (Anwendung, nicht Engine): `MinChunk ≥ max(exposureS aktiver Zeilen) + ov + fix`, sonst Warnung `min_time_too_small` beim Speichern (FA-PRJ-03); die Engine rechnet mit dem gespeicherten Wert weiter (ENG-15) |

Parameter mit Wert **0 bedeuten „aus“**: `ditherEvery = 0`, `afEveryMin = 0`, `filterSwitchEvery = 0`, `slewCenterS = 0` usw. **`afEveryMin` (M7):** `buildPlanInput` übernimmt den Rig-Wert nur, wenn der letzte Heartbeat einen Trigger *Autofokus nach Zeit* meldet (`sequenceTriggers.autofocusAfterTimeMin ≠ null`); fehlt er, setzt der Server `afEveryMin = 0` – der Plan enthält dann keine `autofocus_hint`-Einträge, weil NINA keinen zeitgesteuerten Autofokus auslöst (Alarmcode `af_time_trigger_missing`). Enthält der Vertrag zusätzlich ein `enabled`-Feld (Dither, Filterwechsel, Flip, Flats), gilt die Funktion nur bei `enabled ∧ every > 0` (ENG-20).

**Arbeitssekunden je Einheit (produktiv):** `work_i = Σ_Zeilen effRemaining · (exposureS + ov)`; **Bedarf** `d_i = work_i + nBlocks_i · fix` (A-16). `decrementWork` baut nur `work_i` ab; der `fix`-Anteil wird bewusst als Slotzeit **mitgemalt** und im Walk von Slew und Flip verbraucht – deshalb ist die Buchhaltung konsistent, obwohl `paintChunks` nur `work` kennt.

## 3. Profile je Einheit

1. **Nutzbar** `CanImage[s]` = Sonne (geometrisch) < Dämmerungsgrenze des Projekts **und** scheinbare Zielhöhe ≥ Mindesthöhe des Projekts **und** Nacht ≥ Startdatum. Kein Horizontprofil (FA-STO-02).
   - **Filterzuordnung (verbindlich, NT-E1):** Hat das Rig ein Filterrad, nimmt eine Zeile nur teil, wenn `targets` für sie einen bestätigten `ninaFilterName` liefert. Zeilen mit `ninaFilterName = null` (nicht zugeordnet oder nach `filter_wheel_changed` unbestätigt) zählen **nicht** zur Restarbeit (`TierWorkSec`, `work_i`) und werden nie gewählt; Diagnose `filter_not_found` **mit `lineId`** (§12). Hat ein Projekt dadurch keine Zeile mit Arbeit mehr, entfällt es wie ohne Restarbeit. Rigs ohne Filterrad (OSC) sind nicht betroffen.
   - **Koordinaten:** Kompatibilität – Projektzentrum für alle Panels (SS 262). Produktiv – Panel-Einheiten nutzen die Panel-Koordinaten; Projekt-Einheiten (Panels nicht getrennt) rechnen Höhe, Dämmerung und Mondabstand **je Panel** mit dessen Koordinaten (Entscheidung Sven 28.09.2026 nach der Astronomie-Prüfung – vorher Projektzentrum, Randpanels großer Mosaike lagen dadurch bis zu einige Grad unter der Mindesthöhe): `CanImage` der Einheit = ODER über die Panels, `pick` wählt nur Panels mit eigenem `CanImage` über **alle** Slots der Belichtung samt Download (nicht nur im Startslot; Slots außerhalb der Einheitenmaske regelt die Nachtende-Kulanz), die Zeilen-Masken gelten je Panel; `TierSafe` und `UsableSlot` zählen nur Zeilen, deren Panel im Slot selbst nutzbar ist (Nr. 4, §4); Slew und `tM` wie bisher je Panel (A-19, ENGINE_VERSION 0.8.0).
2. **Aussortieren:** längster zusammenhängender nutzbarer Lauf < `min(Mindestzeit, Restarbeit + fix)` (produktiv) bzw. < Mindestzeit (Kompatibilität) → Einheit nimmt heute nicht teil (Diagnose `below_min_time` bzw. `not_visible`, `start_date`) (A-16).
3. **Zeilen-Sicherheit** `ESsafe[l][s]` = `moonSafe(profil, slot)` aus `moon.md` (A-2); „Kein Mond“ ⇔ `MoonDown[s]` (A-3). Zeilen ohne Mondvermeidung: immer sicher.
4. **Mond-Stufen** je Projekt über alle aktiven Zeilen aller Panels:
   - Stufe 0 = Zeilen ohne Mondvermeidung (existiert immer).
   - Übrige Zeilen gruppiert nach Mondprofil-ID (Kompatibilität: Profilname; ohne Profil mit `avoidLunar` = „Project Default“). **Restriktivität** (A-31): produktiv `R = restrictiveness` aus `moon.md` (`A · W · arctan(14,77/W)`), Kompatibilität `R = A × (1 + 100 / (maxIllum + 1))` wie im Original; zweites Sortierkriterium produktiv `maxIllum` aufsteigend; `mustBeDown` → `R = ∞`, `requiresMoonDown = true` (Kompatibilität: Name „No Moon“ oder MaxAlt ≤ 0 ∧ MaxIllum ≤ 0, SE 55).
   - Gruppen aufsteigend nach `R`; Gleichstand: produktiv Profil-ID, Kompatibilität Reihenfolge des ersten Auftretens (Dictionary-Einfügeordnung, SE 121).
   - `TierSafe[t][s]`: Stufe 0 immer; `requiresMoonDown` → `MoonDown[s]`; sonst `MoonDown[s] ∨ ESsafe[rep][s]`. Kompatibilität: `rep` = erste Zeile der Stufe in Panel-, dann Zeilenreihenfolge (SS). **Produktiv (A-28):** `TierSafe[t][s] = MoonDown[s] ∨ ∃ Zeile der Stufe mit Arbeit und `ESsafe[l][s]`` – die Stufe ist sicher, sobald **eine** Zeile mit Restarbeit dort belichten darf; `pick` prüft die Zeile ohnehin einzeln (§9). Bei Panel-Einheiten mit Panel-Koordinaten (A-19) werden die Masken je Panel gerechnet, also gilt die Stufe je Panel-Einheit (ENG-16). **Mosaik ohne Panel-Einheiten mit Masken je Panel (A-19):** `TierSafe[t][s] = ∃ Zeile der Stufe mit Arbeit, deren Panel `CanImage[s]` hat, ∧ `ESsafe[l][s]`` – für **alle** Stufen einschließlich Stufe 0 und ohne eigenen `MoonDown`-Zweig (Mond unten steckt in `ESsafe`); Stellen, die sonst „Stufe 0 ∨ `MoonDown[s]` ∨ `TierSafe`“ prüfen (`UsableSlot`, Vorfilter und beide Phasen von §6), prüfen dann nur `TierSafe`. Sonst malte `paint` Slots, in denen kein Panel belichten kann.
5. **Restarbeit je Stufe** `TierWorkSec[t]` = Σ Arbeitssekunden der Zeilen der Stufe (bei Panel-Einheiten nur Zeilen des Panels). Einheit ohne Restarbeit entfällt.
6. **Transit-Einheit:** Fenster aus `transit.md` (nur `locked` für diese Nacht und dieses Rig); ohne Fenster heute → entfällt.

## 4. Matrix

Je Einheit `r`:
- `TierMoonUpSafeSlots[t]` = |{ s : CanImage ∧ ¬MoonDown ∧ TierSafe[t][s] }|
- `MinChunk` = Mindestzeit; ist `Σ TierWorkSec + fix < Mindestzeit` → `MinChunk = Σ TierWorkSec + fix` (Kompatibilität ohne `fix`; Projektende/Restposten).
- `UsableSlot[s]` = CanImage ∧ ∃t: TierWorkSec[t] > 0 ∧ (t = 0 ∨ MoonDown[s] ∨ TierSafe[t][s])
- `FirstUsableSlot`, `LastUsableSlot`, `TotalUsableSlots` (über CanImage), `MoonDownSlots`, `PeakAltitude` (max. Höhe in CanImage-Slots)
- `IsConstrained` = TotalUsableSlots × 300 < 2 × MinChunk
- `UserPriorityIndex` = Position in der Prioritätsreihenfolge: Priorität aufsteigend (0/ohne = zuletzt), dann produktiv Projekt-ID bzw. Kompatibilität Projektname (ohne Groß-/Kleinschreibung), dann Panel-Index, dann Eingabereihenfolge
- `RemainingLaSec` = Σ TierWorkSec[t≥1]; `TotalWorkSec` = Σ TierWorkSec (**live**, beim Malen verringert)
- **Einheitenreihenfolge** der Matrix: produktiv Projekt-ID, Panel-Index; Kompatibilität Eingabereihenfolge des Grids.

Nachtweit: `FirstUsableSlot`/`LastUsableSlot` = erster/letzter Slot, in dem **irgendeine** Einheit `CanImage` hat (auch Einheiten ohne Arbeit, SE 384). `SlotAssignment[s] = −1`, `LockedSlot[s] = false`, `SlotWorkHint[s] = Any`.

## 5. Strategie proportional (`paintProportional`)

```
preClaimTransits()                                   # §7.1
prefilter:  für jede Einheit
    safe = |{s: CanImage ∧ (MoonDown ∨ MoonSafe)}|, unsafe = |{s: CanImage}| − safe    # MoonSafe ≡ true (Stufe 0 immer sicher)
    laIn = min(RemainingLaSec, safe·300); nonLaIn = min(NonLa, max(0, safe·300 − laIn))
    accessible = laIn + nonLaIn + min(NonLa − nonLaIn, unsafe·300)
    accessible < MinChunk → TierWorkSec := 0, PreFiltered (Diagnose prefiltered)
pass0  (exklusiv): jeder freie Slot mit genau EINEM Kandidaten (¬PreFiltered, TotalWork>0, UsableSlot[s] ← A-6; Kompatibilität CanImage)
        → zuteilen; hint = MoonDown ? LaPreferred : (MoonSafe ? Any : NonLaPreferred); decrementWork(r, 300, hint)
pass0b (Anker verlängern): je Einheit, je eigenem Lauf < MinChunkSlots: erst nach hinten, dann nach vorne in freie Slots
        mit UsableSlot (A-6; Kompatibilität CanImage), Stopp am ersten ungeeigneten/belegten Slot;
        je Slot hint wie pass0 und decrementWork(r, 300, hint); insgesamt bis MinChunkSlots − Lauflänge
pass1a (nur-mondlos-Arbeit):
    demand_r = moonDownOnlyWorkSec(r) (§7.8), nur Einheiten ¬PreFiltered mit LA-Arbeit und MoonDownSlots > 0 und demand > 0
    fairShare(sort(moonDownChain), eligible = MoonDown ∧ CanImage ∧ frei, hint LaPreferred, demand_r)
pass1b (übrige LA-Arbeit auf Mond-unten-Slots):
    Kandidaten: ¬PreFiltered, LA-Arbeit, MoonDownSlots > 0, freie Mond-unten-CanImage-Slots; sortiert mit moonDownChain
    exclusive = moonUpUsableSlotCount < MinChunkSlots; flexible = Rest (Reihenfolge bleibt)
    fairShare(exclusive, …, LaPreferred, demand = RemainingLa + RemainingNonLa); danach fairShare(flexible, …)
pass2  (übrige Mond-unten-Slots): Kandidaten ¬PreFiltered mit Nicht-LA-Arbeit und freien Mond-unten-CanImage-Slots
    fairShare(sort(sortChain), eligible = MoonDown ∧ CanImage ∧ frei, hint Any, demand = TotalWorkSec)
pass3  (Mond-oben-Slots):
    Kandidaten: ¬PreFiltered ∧ (NonLa-Arbeit ∨ (LA-Arbeit ∧ ∃ Mond-oben-UsableSlot)) ∧ freie CanImage-Slots
    sorted = sort(sortChain)
    accessible_r = RemainingNonLa + min(RemainingLa, |{s: ¬MoonDown ∧ UsableSlot ∧ frei}|·300)
    pass3a (früh untergehend): nightLastMu = größter freier Mond-oben-Slot, in dem ein Kandidat UsableSlot hat
        settingSoon = Kandidaten mit LastUsableSlot < nightLastMu − 6, sortiert LastUsableSlot ↑, accessible ↓, dann sorted-Reihenfolge
        je r (accessible > 0): W = freie Mond-oben-UsableSlots_r in [First, Last]_r; W = 0 → weiter
              demandIn = Σ_{o ∈ sorted, Fenster überlappt} min(max(0, accessible_o), freie Mond-oben-UsableSlots_o in r's Fenster · 300)
              reserve = min(⌈accessible_r/300⌉, ⌊W · accessible_r / demandIn⌋, W); reserve ≤ 0 → weiter
              paintChunks(r, ¬MoonDown ∧ UsableSlot_r ∧ frei ∧ s ∈ [First_r, Last_r], NonLaPreferred, reserve·300)
    produktiv: accessible_r nach pass3a neu berechnen (A-14); Kompatibilität: unverändert (Snapshot vor 3a, SE 884–891)
    fairShare(sorted, eligible = ¬MoonDown ∧ UsableSlot ∧ frei, hint NonLaPreferred, demand = accessible_r)
enforceMinimum(); pruneSlivers()
wenn bonusEnabled: gapFill()                          # §7.5
defragment(); pruneSlivers(); absorb()                # absorb = gapFill, immer (Slots ohne Arbeit gibt walk frei, §8)
```
`sortChain` = `rig.sort_chain`; `moonDownChain` = `[most_moon_limited] + sortChain ohne most_moon_limited` (`sort-chain.md`).

### 5.1 `fairShare(sorted, eligible, hint, demand)`
```
supply = |⋃_r {s : eligible(r,s)}| · 300 ; wenn 0 → Ende
d_i = max(0, demand(r_i)); D = Σ d_i ; wenn 0 → Ende
existing_i = bereits zugeteilte Slots von r_i (inkl. vergangener Slots §5.3)
min_i = (existing_i ≥ MinChunkSlots_i) ? 0 : min(MinChunk_i, d_i)
wenn D ≤ supply:                       b_i = d_i
sonst wenn Σ min_i ≤ supply:           excess = supply − Σ min_i; X = Σ max(0, d_i − min_i)
                                       b_i = min(d_i, min_i + (X>0 ? excess·max(0,d_i−min_i)/X : 0))
sonst (knapp):                         rest = supply; sel = []
                                       für i in Reihenfolge: wenn rest ≥ min_i: sel += i; rest −= min_i
                                       wenn sel leer: sel = [0]; rest = max(0, supply − min_0)
                                       X = Σ_{i∈sel} max(0, d_i − min_i)
                                       b_i = min(d_i, min_i + max(0, (X>0 ∧ rest>0) ? rest·max(0,d_i−min_i)/X : 0)) für i∈sel, sonst 0
produktiv: Gruppen (A-15), Nachtfairness (A-10) und Quantisierung (A-27) siehe §5.2
für i in Reihenfolge mit b_i > 0: paintChunks(r_i, eligible, hint, b_i)
```

### 5.2 Produktive Ergänzungen zu `fairShare`
Reihenfolge der Ergänzungen: **erst A-15 (Gruppen bilden), dann A-10 (Vergangenheit abziehen), dann Quantisierung (A-27).**

**A-15 Mosaik-Deckel (Gruppe je Projekt).** Sind Panel-Einheiten aktiv (`mosaicPanelsIndependent`), treten alle Panel-Einheiten eines Projekts in `fairShare` als **eine Gruppe `P`** auf:
- `d_P = Σ_panel d_panel` (Bedarf inkl. `fix` je Panel), `existing_P = Σ existing_panel`, `past_P = Σ past_panel` (A-10). `MinChunk_P = min` über die Panels **mit Arbeit** – nicht `max`: §4 verkleinert MinChunk je Einheit auf `Restarbeit + fix`, fast fertige Panels haben also kleinere Werte, und ein `max` würde die Restposten-Regel A-16 wieder aufheben (ENG5-9).
- Sortierschlüssel der Gruppe (alle acht Schlüssel aus `sort-chain.md`): `lowest_peak_altitude` = Minimum der Panels, `setting_soonest` = kleinster `LastUsableSlot`, `most_remaining` = Summe, `most_moon_limited` = Summe der `RemainingLaSec`, `due_soonest` = frühestes `dueDate`, `constrained` = wahr, wenn ein Panel `constrained` ist, `mosaic_grouping` = Projekt-ID (Gruppe ist die Mosaik-Gruppe), `card_order` = `UserPriorityIndex` des Projekts; letzter Tie-Break Projekt-ID.
- `eligible_P(s) = ∃ Panel mit eligible(panel, s)`; `supply` zählt jeden Slot höchstens einmal.
- **Budget-Aufteilung:** `b_P` wird nach `d_panel` verteilt (größter Rest zuerst, Gleichstand Panel-Index). Panels, deren Anteil `< MinChunk_panel` wäre, werden in dieser Runde mit 0 bedacht; ihr Anteil geht an die übrigen Panels (wieder größter Rest zuerst). Bleibt danach kein Panel übrig (`b_P < MinChunk_P`), erhält **ein** Panel (kleinster Panel-Index mit `eligible`) `min(b_P, d_panel)` – so entstehen keine Sub-Mindestzeit-Läufe.
- **Gemalt wird je Panel:** `paintChunks(panel, eligible(panel, ·), hint, b_panel)` mit der Maske des Panels (nicht `eligible_P`), und `decrementWork` läuft je Panel. Ein Anteil, den das Panel in seinen eigenen Slots nicht unterbringen kann, verfällt (er wandert nicht zurück in die Gruppe).
- Der Deckel gilt zusätzlich in **Pass 3a**: die Reserve wird je Projekt berechnet (`accessible_P`) und wie oben auf die Panels verteilt.
- **Bewusste Ausnahme:** `enforceMinimum`, `gapFill`/`absorb` und `defragment` arbeiten weiter je Panel-Einheit; sie können den Deckel um höchstens eine Mindestzeit je Panel überschreiten. Begründung: Mindestzeit und lückenlose Nacht haben Vorrang vor der Fairness. Eigenschaftstest: Summe der zugeteilten Slots eines Mosaikprojekts ≤ `b_P/300 + Anzahl Panels · MinChunkSlots`.

**A-10 Nachtfairness bei Neuplanung.** `past_i` ist **eindeutig** die Belegung aus `tonight.pastBlocks`: jeder Slot, dessen **Mitte** in `[fromUtc, toUtc)` eines Blocks der Einheit `i` liegt, zählt mit 300 s. `exposedSecByUnit` dient nur der Anzeige und der Plausibilitätsprüfung (Abweichung > 2 Slots → Warnung `past_mismatch`), nicht der Rechnung.
- Die Aufteilung auf Mond-Bereiche kommt aus dem **aktuellen** Nachtkontext: ein vergangener Slot zählt zum Durchgang „Mond unten“, wenn `MoonDown[s]`, sonst zu „Mond oben“. In Pässen mit eingeschränktem Bedarf (1a: nur-mondlose Arbeit) zählt nur der Teil von `past_i`, der im selben Bereich liegt.
- Rechnung: `supply' = supply + Σ past_i`, `d'_i = d_i + past_i`, `fairShare` wie §5.1 → `b'_i`, danach `b_i = max(0, b'_i − past_i)`.
- **Restangebot-Runde:** `Σ b_i` kann nach der Deckelung kleiner als `supply` sein (Einheiten, die schon mehr als ihren Anteil haben). Das Restangebot `rest = supply − Σ b_i` wird in einer zweiten Runde proportional zu `max(0, d_i − b_i)` auf die Einheiten mit `b_i > 0 ∨ past_i = 0` verteilt, und zwar mit **Deckel und Mindestzeit** (ENG5-10): `b_i ← min(d_i, b_i + Anteil)`; ein Anteil wird **nicht** vergeben, wenn danach `existing_i + b_i < MinChunk_i` bliebe (er geht an die nächste Einheit der Sortierreihenfolge). Bleibt Restangebot übrig, verfällt es (die Slots füllt später `gapFill`/`absorb`).
- Ohne Neuplanung (`past = 0`) ist das Ergebnis identisch zum Original.

**A-27 Normierung und Quantisierung der Budgets.**
1. **Normieren (ENG5-1):** Nach dem Abzug von `past_i` kann `Σ b_i > supply` werden (die `max(0, …)`-Kappung zerstört die Summe; Gegenbeispiel: `supply = 600`, Einheit 1 mit `past = 3000` → `b₂ = 2677`). Deshalb gilt verbindlich: `wenn Σ b_i > supply: b_i ← b_i · supply / Σ b_i` (proportional, vor der Restangebot-Runde).
2. **Restangebot-Runde** (unten, A-10) verteilt danach `supply − Σ b_i`.
3. **Quantisieren:** `n_i = ⌊b_i/300⌋`; anschließend werden genau `min(⌊supply/300⌋ − Σ n_i, Σ_i (⌈min(d_i, b_i·1,0)/300⌉ − n_i))` weitere Slots nach größtem Rest (`b_i/300 − n_i`, Gleichstand in Sortierreihenfolge) an Einheiten mit `n_i < ⌈d_i/300⌉` vergeben. Die Anzahl ist **nie negativ**; nach Schritt 1 gilt `Σ n_i · 300 ≤ supply`. `paintChunks` bekommt `budgetSec = n_i · 300`.
Damit hängt das Ergebnis nicht an IEEE-Details (NFA-03).
### 5.3 Neuplanung während der Nacht (A-11)
`PlanInput.tonight` (bei `startAtUtc`; bei `reason: initial` ohne `startAtUtc` darf es **nur** `lastAutofocusUtc` tragen – der Autofokus im Start-Bereich der Sequenz, NT-24, M7): `pastBlocks [{unitId, fromUtc, toUtc}]`, `exposedSecByUnit`, `lastAutofocusUtc`, `filterCycle {unitId, lineId, subsOnLine}`, `flipDoneByPanel`, `currentUnitId`.
**Einheiten-ID (`unitId`, verbindlich, ENG5-14):** `"<projectId>"` bei Einzelfeldern, `"<projectId>/p<index>"` bei Panel-Einheiten – `index` ist `panel.index` (0-basiert), **nicht** die Panel-UUID. Dieselbe Schreibweise gilt in `tonight.pastBlocks`, `exposedSecByUnit`, `filterCycle`, `flipDoneByPanel`, `currentUnitId`, in `warnings[].unitId` und im Soll-Plan-Format (`contracts/golden-plans/README.md`). Im `NightPlan` stehen dagegen `projectId` und `panelId` (UUID) getrennt.
- Slots mit Beginn < `startAtUtc` sind nicht mehr nutzbar; die in `pastBlocks` belegten werden der jeweiligen Einheit als `existing` zugerechnet (nicht neu gemalt, `LockedSlot`), freie vergangene Slots bleiben leer.
- Der Slot, in dem `startAtUtc` liegt, gilt als voll nutzbar; die Uhr im Walk beginnt bei `startAtUtc`.
- Planungsbedarf enthält `pendingCaptures` (§2). Werden diese später verworfen, korrigiert die nächste Planung.
- Fehlt `tonight.lastAutofocusUtc`, gilt der Autofokus als **fällig** (`letzterAF = −∞`, §8).
- **Determinismus:** gleiche Eingabe (inkl. `tonight`) → gleicher Restplan. Wann das Plugin neu plant, regelt `specs/nina/execution.md` §3.

### 5.4 Auslegungen (AP-13b, Vorschlag – mit den Soll-Plänen abzunehmen, H-13)
Stellen, an denen der Text oben zwei Lesarten zulässt oder sich selbst widerspricht; so ist es in `packages/engine/src/plan` umgesetzt:
1. **Vorfilter mit `fix` (A-16):** Produktiv enthält MinChunk die Blockfixkosten. Damit ein Restposten (`MinChunk = work + fix`) nicht am eigenen `fix` scheitert, zählt `fix` im Vorfilter (§5 und §6) zur erreichbaren Zeit, sobald Arbeit erreichbar ist: `accessible + fix < MinChunk → PreFiltered`.
2. **Bedarf mit `fix` je offenem Block (A-16):** In `fairShare` ist `d_i = Pass-Bedarf + fix · max(0, nBlocks_i − Läufe_i)`, wobei `Läufe_i` die bereits gemalten Läufe der Einheit zählt. So wird `fix` je erwartetem Block einmal eingeplant und nicht in jedem Pass erneut.
3. **Mindestzeit bei Nachtfairness (A-10):** `min_i` in §5.1 prüft `existing_i` **ohne** vergangene Slots. Vergangenes steckt bereits in `supply'` und `d'_i`; zählte es zusätzlich in `existing_i`, entfiele die Mindestzeit nur für die Einheit mit Vergangenheit. Zwei gleiche Ziele kämen dann nach der Neuplanung nicht mehr auf gleiche Anteile (21 : 27 statt 24 : 24, Eigenschaft §11.3). Die Restangebot-Runde prüft `existing_i + b_i` weiter **mit** vergangenen Slots.
4. **Vergangene Slots (§5.3):** Slots vor `startAtS` sind für alle Einheiten nicht mehr `CanImage`; die in `pastBlocks` belegten stehen gesperrt bei ihrer Einheit, sofern sie heute noch teilnimmt.
5. **Einheiten ohne Arbeit (§3.5, A-25):** Produktiv entfällt jede Einheit ohne Restarbeit (Diagnose `no_need`), außer Transit-Einheiten mit Fenster, die bis Fensterende belichten (A-21).
6. **Mosaik-Gruppen (A-15):** Die Gruppe steht in der Reihenfolge ihrer Gruppenschlüssel (Minimum/Summe wie in §5.2, letzter Tie-Break Projekt-ID). Pass 3a mit Gruppen: Fenster der Gruppe = [kleinster erster, größter letzter nutzbarer Slot der Panels], `accessible_P` = Summe; die Reserve wird wie in `fairShare` auf die Panels verteilt.
7. **Transitkonflikt (A-20):** Ein späterer Transit gilt als überlappend, sobald ein Slot seines Fensters oder Vorlaufs schon für einen anderen Transit gesperrt ist. Bei Neuplanung zählen vergangene Slots (vor `startAtS`) nicht: weder die eigenen der laufenden Transit-Einheit (Vorlauf, begonnene Serie) noch die eines schon vergangenen Transits (0.8.0 – vorher brach eine Neuplanung mitten im Transit dessen Rest als `transit_conflict` ab).

## 6. Strategie manuelle Priorität (`paintGreedy`)
```
preClaimTransits()
prefilter (stufenbewusst): accessible = Σ_t min(TierWorkSec[t], |{s: CanImage ∧ (t=0 ∨ MoonDown ∨ TierSafe[t][s])}|·300) < MinChunk → PreFiltered
für r in UserPriorityIndex-Reihenfolge, ¬PreFiltered, TotalWork > 0:
    Phase A: für t = N … 1 mit TierWorkSec[t] > 0 und TierMoonUpSafeSlots[t] = 0:
             budget = TierWorkSec[t]; chronologisch freie MoonDown ∧ CanImage-Slots, solange budget > 0:
             zuteilen (hint LaPreferred), TierWorkSec[t] = max(0, TierWorkSec[t] − 300), budget −= 300
    Phase B: chronologisch jeder freie CanImage-Slot, solange TotalWork > 0:
             t* = höchste Stufe ≥ 1 mit Arbeit und (MoonDown ∨ TierSafe[t][s]); sonst 0, falls Stufe 0 Arbeit hat; sonst Slot überspringen
             zuteilen; hint = t*>0 ? (MoonDown ? LaPreferred : NonLaPreferred) : Any; TierWorkSec[t*] = max(0, TierWorkSec[t*] − 300)
enforceMinimum(); pruneSlivers(); wenn bonusEnabled: gapFill(); defragment(); pruneSlivers(); absorb()
```
Keine exklusive Vorabbelegung (wie im Original). A-10/A-15 gelten hier nicht (Priorität ist gewollt unfair).

## 7. Gemeinsame Routinen

**7.1 `preClaimTransits`** – Reihenfolge produktiv `locked_at` ↑ (A-20), Kompatibilität Matrix-Reihenfolge (SE 508). Je Transit-Einheit jeder Slot mit Slotmitte ∈ [Fensterstart, Fensterende), CanImage und frei → zuteilen, `LockedSlot = true`. **Vorlauf (verbindlich, NT-25):** Produktiv sperrt die Transit-Einheit zusätzlich jeden freien Slot, der das Intervall `[Fensterstart − slewCenterS − 60 s, Fensterstart)` **schneidet** (unabhängig von der Slotmitte und von CanImage) – dort läuft der Slew-/Zentrier-Vorlauf (`transit.md` §3); sonst könnte ein regulärer Block bis in den Vorlauf reichen. Beispielnacht: Fenster ab 02:08:00Z, Vorlauf ab 02:05:30Z → Slot 02:05–02:10Z wird gesperrt, obwohl seine Mitte (02:07:30Z) vor dem Fenster liegt. Der **geplante Blockstart** eines Transitblocks (Maßstab für „Block > 10 min hinter Plan“, `execution.md` §3.2) ist `min(atUtc)` seiner Einträge, also der Vorlauf. Danach `TierWorkSec := 0`, `PreFiltered`; `HasLockedWindow`, wenn ≥ 1 Slot. Gesperrte Slots werden nie verlängert, geliehen, entfernt, defragmentiert oder abgegeben. Überlappung mit einem bereits gesperrten Transit → der **spätere** (nach `locked_at`) sperrt **nichts**, behält `TierWorkSec = 0`, bleibt `PreFiltered` und erhält die Diagnose `transit_conflict`; ein angeschnittenes Fenster wäre fachlich wertlos (keine Baseline, FA-EXO). Die Anwendung verhindert überlappende Festlegungen bereits beim Anlegen (`409 transit.window_overlap`), der Fall bleibt nur für nachträglich verschobene Ephemeriden (ENG-14).

**7.2 `paintChunks(r, filter, hint, budgetSec)`** – Läufe zusammenhängender Slots mit `filter` sortieren: an eigene Slots angrenzend zuerst, dann länger zuerst, dann früherer Start (A-9; Kompatibilität: Orakel-Patch mit gleichem Tie-Break). Je Lauf, solange Budget > 0:
- nicht angrenzend ∧ Lauf < MinChunkSlots ∧ Einheit hat bereits ≥ MinChunkSlots → überspringen;
- `n = min(Länge, Budget/300)` (Budget ist nach A-27 ein ganzzahliges Vielfaches von 300 s);
- erste `n` Slots zuteilen (hint), `Budget −= n·300`, `decrementWork(r, n·300, hint)`.

**7.3 `enforceMinimum`** – je Einheit (Matrix-Reihenfolge) ohne `HasLockedWindow` mit 0 < zugeteilt < MinChunkSlots:
1. ab letztem zugeteilten Slot nach hinten, dann ab erstem nach vorne in freie Slots verlängern (produktiv UsableSlot, Kompatibilität CanImage); Stopp am ersten belegten/ungeeigneten Slot; hint Any.
2. noch zu kurz: eigene Läufe **längste zuerst** (Gleichstand früherer Start), je Lauf erst hinter dem Ende, dann vor dem Anfang Slot für Slot nehmen. Genommen werden darf ein Slot nur, wenn die **leihende** Einheit dort belichten kann (produktiv `UsableSlot`, Kompatibilität `CanImage`, ENG-13) **und** er frei ist oder einem Nachbarn gehört, der danach noch einen **zusammenhängenden** Lauf ≥ seine MinChunkSlots behält (Kompatibilität: Gesamtzahl statt Lauflänge, SE 1235); nie gesperrte Slots; Stopp an der ersten Stelle, die nicht genommen werden kann.
3. noch zu kurz: alle nicht gesperrten Slots der Einheit freigeben.

**7.4 `pruneSlivers`** – je Einheit mit ≥ 2 Läufen und mindestens einem Lauf ≥ MinChunkSlots, für jeden kürzeren, nicht gesperrten Lauf:
- *angrenzend* an einen guten Lauf = zwischen ihnen kein Slot einer anderen Einheit;
- nicht angrenzend → behalten, außer Länge ≤ max(2, ⌊MinChunkSlots/4⌋) **und** die direkte Vorgänger- oder Nachfolger-Einheit kann alle Slots des Laufs (CanImage);
- entfernen nur, wenn Vorgänger (am ersten Slot) oder Nachfolger (am letzten Slot) eine andere Einheit mit CanImage ist → Slots frei.

**7.5 `gapFill` / `absorb`** – in **einer** Vorwärtsschleife: freier Slot `s` nach einem nicht gesperrten zugeteilten Slot `s−1`, dessen Einheit in `s` CanImage (produktiv UsableSlot) hat → übernehmen (Hint übernehmen); das kaskadiert, eine Einheit kann eine ganze Lücke füllen. Danach eine Rückwärtsschleife analog.

**7.6 `defragment`** – Blöcke bilden (freie Slots unterbrechen); erstes Muster A-B-A mit lückenlos aneinanderliegenden Blöcken, ohne gesperrte Slots in B∪A₂, bei dem A in allen B-Slots und B in allen A₂-Slots `UsableSlot` hat → Region zu A…A B…B umschreiben; wiederholen, max. 20 Runden.

**7.7 `decrementWork(r, sec, hint)`** – `LaPreferred`: Stufen N…0 nacheinander; `NonLaPreferred`: Stufen 0…N; `Any`: alle Stufen proportional (`w_t −= w_t · min(1, sec/Σw)`).

**7.8 `moonDownOnlyWorkSec(r)`** – `hasMoonUp` = ∃ s: ¬MoonDown ∧ CanImage. Σ TierWorkSec[t≥1] über Stufen mit `requiresMoonDown` oder (`hasMoonUp` ∧ TierMoonUpSafeSlots[t] = 0). `moonUpUsableSlotCount(r)` = |{s: ¬MoonDown ∧ UsableSlot}|.

## 8. Ablauf (`walk`)

Uhr `t` in Sekunden ab Nachtfensterbeginn (bei Neuplanung ab `startAtUtc`). `nightEnd = (LastUsableSlot + 1)·300` (Ende des letzten nutzbaren Slots). Zustand: ausgegebene Belichtungen je Zeile, Filterzyklus je Einheit, Zeit je Panel, Dither-Zähler, letzte AF-Zeit (`tonight.lastAutofocusUtc`, sonst fällig), Flip erledigt je Panel.

```
für s = FirstUsableSlot … LastUsableSlot:
    r = SlotAssignment[s]; t = max(t, s·300)
    r < 0 → Leerlauf merken; weiter
    Leerlauf ≥ 5 min seit letztem Block → wait-Eintrag
    neuerBesuch = (r ≠ aktuelle Einheit) ∨ (vorher Leerlauf)                          ← A-18 (Kompatibilität: nur r ≠ aktuelle)
    wenn r ≠ aktuelle Einheit:
        runEnd = Ende des Laufs von r ab s (exklusiv, Slotindex)
        probe = pick(r, s, targetRemainingSec = runEnd·300 − (s·300 + slewCenterS), dryRun)   # §9, ENG-6
        probe leer ∧ ¬LockedSlot[s]:
            firstViable = erster Slot in (s, runEnd] mit pick ≠ leer
            reassignEnd = firstViable ≥ 0 ? firstViable : runEnd+1
            fallback = erste andere Einheit (Matrix-Reihenfolge) mit pick(·, s) ≠ leer,
                       produktiv zusätzlich: ¬Transit, ¬PreFiltered, CanImage in allen Slots s … reassignEnd−1   ← A-17
            fallback → Slots s … reassignEnd−1 (bis zum ersten gesperrten) an fallback; r = fallback
            sonst: releaseEnd = reassignEnd; mit Bonus: erster Slot in [s, reassignEnd) mit Bonus-pick ≠ leer
                   Slots s … releaseEnd−1 (bis gesperrt) freigeben → Leerlauf; weiter mit releaseEnd
        Filterzyklus von r zurücksetzen
    wenn neuerBesuch:
        Blockbeginn: slew_center_rotate bzw. slew_center (flip-rotation.md §3), t += slewCenterS
        Pierseitenwechsel (NT-27): pierSide(neues Panel, t) ≠ Pierseite am Ende des vorigen Blocks (nur wenn ein
            Block unmittelbar vorausging, ohne Park) ∧ flipEnabled → Slew-Eintrag um flipDurationS verlängert
            (durationS = slewCenterS + flipDurationS), t += flipDurationS
        aktueller Filter/Panel = leer, Dither-Zähler 0; ohne Panel-Einheiten: Panel-Zeiten von r = 0
    blockEnd = (letzter Slot des zusammenhängenden Laufs von r ab s + 1)·300
    solange t < (s+1)·300 ∧ t < nightEnd:
        cs = ⌊t/300⌋; cs > s ∧ SlotAssignment[cs] ≠ r → Slot-Schleife verlassen (nächstes s)
        Mosaik ohne Panel-Einheiten: blockEnd − t < Mindestzeit → auf aktuelles Panel sperren (Panel-Index, A-19),
            sofern pick(nur aktuelles Panel) ≠ leer; sonst bleibt der Pool offen und jede Wahl muss samt
            Panelwechsel (slewCenterS + filterChangeS) bis Blockende passen (A-19, A-29; 0.8.0)
        Meridian-Flip prüfen (flip-rotation.md §2) VOR der Filterwahl                     ← A-5
        Autofokus fällig (afEveryMin > 0 ∧ t − letzterAF ≥ afEveryMin·60, nicht in Transit) → autofocus_hint, t += afDurationS, letzterAF = t
        cs = ⌊t/300⌋
        pick = pick(r, cs, targetRemainingSec = blockEnd − t)                              # nur Zeilen mit exposureS + downloadS ≤ blockEnd − t (A-7)
        pick leer ∧ bonusEnabled → pick(…, includeCompleted); danach (nur mit Bonus) letzte Zeile **derselben Einheit**, falls in cs sicher
        pick leer:
            Nachtende-Kulanz: produktiv, wenn blockEnd = nightEnd ∧ keine Einheit nach blockEnd zugeteilt ∧ Kulanz unbenutzt
                              ∧ t + exposureS + downloadS ≤ kulanzGrenze                                   ← NT-13, M4
                              (kulanzGrenze = min(darknessEndUtc, block.twilightEndUtc), null-Werte zaehlen nicht;
                               beide null: blockEnd, d. h. keine Kulanz)
                              → pick ohne Blockend-Filter erlaubt (einmal, Eintrag mit lastOfNight = true);
                              Kompatibilität: t + exposureS > nightEnd, einmal (SE 1900)
            sonst → produktiv (A-29): Rest des Laufs (Slots ⌈t/300⌉ … runEnd−1, ohne gesperrte) **freigeben**,
                    Leerlauf ab t merken, Warnung idle_gap, Block mit end-Eintrag schließen, weiter bei runEnd;
                    Kompatibilität: nur Slot-Schleife verlassen (Slots bleiben zugeteilt, SE)
        Panelwechsel → slew_center(_rotate) Panel, t += slewCenterS (+ flipDurationS bei Pierseitenwechsel, NT-27), Dither-Zähler 0
        Filterwechsel → filter, t += filterChangeS, Dither-Zähler 0
        expose (bonus = Zeile hat keinen Planungsbedarf mehr), t += exposureS + downloadS
        pick-Zustand übernehmen (Filterzyklus, Panel-Zeit) – erst jetzt, nach Annahme                ← A-7
        Dither aktiv ∧ ditherEvery > 0 ∧ ¬Transit ∧ Zähler ≥ ditherEvery ∧ es folgt in diesem Block noch eine Belichtung (ENG5-6)
                → dither, t += ditherSettleS, Zähler 0
```
- **8.1 Blockende (harter Blockschluss):** Im Produktivmodus beginnt keine Belichtung, die über `blockEnd` hinausliefe (A-7). Einzige Ausnahme ist die **Nachtende-Kulanz** (A-24): ein `lastOfNight`-Eintrag beginnt nur, wenn `t + exposureS + downloadS ≤ kulanzGrenze` mit `kulanzGrenze = min(darknessEndUtc, block.twilightEndUtc)` (NT-13, M4; `darknessEndUtc` = **spätester** Aufwärtsdurchgang der genutzten Dämmerungsgrenzen, `night.md` §3, NT-12; `block.twilightEndUtc` = Aufwärtsdurchgang der **eigenen** Grenze des Blockprojekts, TK 7.6). Ohne die zweite Grenze liefe ein astronomisches Projekt in der Kulanz bis zur nautischen Morgendämmerung eines anderen Projekts weiter. `null`-Werte zählen nicht; sind beide `null`, ist die Grenze `blockEnd` – es gibt dann keine Kulanz. Dieselbe Regel prüft das Plugin zur Laufzeit; passt die Belichtung nicht mehr, endet der Block mit `block_end` Grund `night_end` (`execution.md`). Einen Überhang in den Folgeblock gibt es nicht. Zur Laufzeit darf das Plugin bei Verzug höchstens eine Belichtung bis zum weichen Blockende laufen lassen, wenn die Zeit danach frei ist (`execution.md` §4.2, Plugin 0.4.8); die Engine plant unverändert mit hartem Blockschluss. Kompatibilität: Uhr kann in den Folgeblock laufen.
- **8.2 Transit-Einheit:** `slew_center(_rotate)`, dann `expose_series {lineId, filter, exposureS, untilUtc = Fensterende}`; der Walk belichtet die Transit-Zeile **bis Fensterende unabhängig vom Planungsbedarf**; Zusatzframes sind kein Bonus (A-21). Kein Dither, kein Filterwechsel, kein AF. Liegt `tM + afterMin` im Fenster, weist der Walk die **Flip-Lücke** aus und zählt die geplanten Aufnahmen ohne sie (`transit.md` §3, NT-25).
- **8.3 Panel-Koordinaten:** Slew und `tM` je aktivem Panel.
- **8.4 Blöcke:** neuer Block bei jedem Slew (Einheit, Panel oder nach Leerlauf) und nach jedem `wait`; Blockende = Start des nächsten Blocks bzw. Nachtende. Jeder Block endet mit einem `end`-Eintrag bei `blockEnd` (Zeitmarke, `execution.md` §4.2). `lastOfNight = true` trägt genau der Eintrag, der die Nachtende-Kulanz nutzt; sonst `false`. Blöcke ohne `expose`/`expose_series` entfallen (ihre Slots sind dann Leerlauf – außer dem angeschnittenen ersten Slot, in den die letzte Belichtung des vorigen Blocks derselben Einheit hineinläuft). Block-IDs: UUID v7 aus `nightPlanId` + laufender Nummer (deterministisch: `uuidv7FromHash(nightPlanInputHash, n)`).

- **8.5 Auslegungen (AP-13c, Vorschlag):**
  1. **`end` und `wait`:** `end` steht bei der Zeit, zu der die letzte Aktion des Blocks endet (A-29) bzw. am Ende seines Laufs (wie im Beispiel TK 7.6: `end` 09:20:01). Ein Leerlauf von mindestens 5 min vor dem nächsten Block steht als `wait` am **Ende des vorigen** Blocks (danach dessen `end`). Damit liegt kein Eintrag vor dem Blockbeginn, außer dem Transit-Vorlauf.
  2. **Dither (ENG5-6):** Der Dither nach einer Belichtung wird zurückgestellt. Er entsteht erst, wenn `pick` zur Zeit `t + ditherSettleS` noch eine passende Belichtung im Block findet.
  3. **Panelwechsel** eines Mosaiks ohne Panel-Einheiten beginnt einen neuen Block (§8.4). Der erste Slew des Blocks zielt auf das Panel der ersten Belichtung (A-19), nicht auf das Projektzentrum.
  4. **Mondsicherheit ab Belichtungsbeginn:** Bei LA-Zeilen zählt `headroom` ab `t`, nicht ab Slotbeginn (`headroom(cs) − (t − cs·300) ≥ exposureS + downloadS`, A-26).
  5. **Filterwechsel muss passen:** Passt `filterChangeS + exposureS + downloadS` nicht mehr bis Blockende, gilt `pick` als leer (A-29).
  6. **Filterzyklus:** Bleibt die Zeile gleich, zählt `subsOnLine` weiter; `(pick, 1)` nur bei gewechselter Zeile. Die Panel-Zeit zählt `exposureS + downloadS`.
  7. **Transit (bis AP-13d ohne Flip-Lücke):**
     - Der Vorlauf steht vor dem ersten gesperrten Fenster-Slot.
     - Die Serie beginnt am Fensterbeginn, wenn dessen Slot gesperrt ist.
     - Sie endet am Fensterende, spätestens aber mit dem letzten gesperrten Slot: Wo das Ziel unter die Mindesthöhe fällt, ist nichts gesperrt.
     - Überlappende Transits: Jeder Slot des Fensters zählt, auch ohne `CanImage`.
  8. **`planNight` nur produktiv:** Den Kompatibilitätsmodus gibt es nur für Grids und das Orakel; `mode: compat` ergibt `engine.input_invalid`.
- **8.6 Auslegungen (AP-13d, Vorschlag – mit den Ablauf-Soll-Plänen abzunehmen, H-13):**
  1. **Flip passt nicht:** Liegt `tM + afterMin + flipDurationS` hinter dem Blockende, steht ab der Belichtung, die über die Flip-Grenze liefe, ein `wait` bis zum Blockende; der Block endet ohne `meridian_flip`. `meridianFlip` wird mit `planned: false` ausgewiesen (`waitStartUtc` = Wartebeginn).
  2. **Pierseite** eines Blocks = Vorzeichen des Stundenwinkels bei Blockbeginn (`LHA < 0` → `west`, sonst `east`); nach einem Flip gilt die andere Seite bis Blockende. Ein Folgeblock auf einer anderen Seite als der zuletzt belegten zählt `flipDurationS` zum ersten Slew (NT-27).
  3. **Transit-Vorlauf** beginnt bei `max(t, Serienbeginn − slewCenterS − 60 s)`, gemessen am tatsächlichen Serienbeginn (Fensterbeginn oder erster gesperrter Fenster-Slot, §8.5 Nr. 7).
  4. **Serienende bei angeschnittenem letzten Slot:** Die Slotmitte-Regel sperrt den letzten Fenster-Slot nicht, wenn seine Mitte hinter dem Fensterende liegt. Die Serie läuft trotzdem bis zum Fensterende, sofern das Ziel dort noch nutzbar ist (Rest ≤ ½ Slot, A-21); der Folgeblock beginnt danach.
  5. **Lücke im Fenster (M8):** `gapStartUtc` ist der Beginn der ersten Serienbelichtung, die nicht mehr vor `tM + afterMin` endet (mit Pause vor Meridian: die über `tM − Pause` liefe). `gapDurationS` = Wartezeit bis zum Flip + `flipDurationS` + `slewCenterS`; Beispielnacht HAT-P-17 b: 04:33:57Z, 330 s, 305 statt 310 Aufnahmen.
  6. **`tM` (WS-24):** überall die geschlossene Form (`astro/target.ts` `meridianTransitUtc`); die untere Kulmination ist Kandidat, wenn die Höhe dort ≥ Mindesthöhe (NT-26). Ein Test sichert, dass die Engine keine Newton-Iteration enthält.
  7. **Beobachtungen, offen zur Entscheidung:**
     - Nach einem A-17-Ersatz freigegebene Slots werden im selben Lauf nicht erneut angeboten (G23: A könnte schon ab 900 s beginnen).
     - `idle_gap` zählt Slots aus der Maske; eine Belichtung länger als ein Slot, die nicht mehr passt, erzeugt so eine Warnung, obwohl nichts Erreichbares frei war.

## 9. Filter- und Panelwahl (`pick`)

```
panels in Panel-Index-Reihenfolge; moonDown = MoonDown[cs]
Kandidaten: erlaubte Panels, exposureS > 0, aktiv, (Rest > 0 ∨ includeCompleted), LA-Zeile nur wenn ESsafe[cs] **und** `headroom(l) ≥ exposureS + downloadS` (Mondsicherheit über die ganze Belichtung, A-26 – sonst liefe eine 600-s-Belichtung in einen unsicheren Slot, ENG5-8),
            produktiv: exposureS + downloadS ≤ targetRemainingSec (außer Kulanz)
            Rest(l) = effRemaining_l − im Walk bereits ausgegebene Belichtungen der Zeile (live)
leer → null
aktivesPanel = Panel der zuletzt angenommenen Belichtung der Einheit
            (Kompatibilität: Panel aus Filterzyklus – ohne Filterwechsel leer → keine Panel-Rotation, SS 496)   ← A-22
Mosaik: forceOff = moonDown ∧ aktives Panel ohne LA-Kandidat ∧ anderes Panel mit LA-Kandidat
        rotate  = Zeit auf aktivem Panel ≥ Mindestzeit ∧ Kandidat auf anderem Panel
Pool:
  moonDown ∧ LA-Kandidaten → nur LA-Kandidaten; bei forceOff ∨ rotate: davon andere Panels (falls vorhanden),
                              sonst davon aktives Panel (falls vorhanden)
  ¬moonDown ∧ LA-Kandidaten:
     aktives Panel ∧ Mosaik ∧ ¬forceOff ∧ ¬rotate: Kandidaten aktives Panel vorhanden → deren Nicht-LA, sonst **alle des aktiven Panels**;
                                                   keine auf aktivem Panel → Nicht-LA aller, sonst alle
     aktives Panel ∧ Mosaik ∧ (forceOff ∨ rotate): Kandidaten anderer Panels → deren Nicht-LA, sonst diese; keine → Nicht-LA aller, sonst alle
     sonst: Nicht-LA aller, sonst alle
  sonst (keine LA-Kandidaten): aktives Panel ∧ (forceOff ∨ rotate) → andere Panels, sonst alle; aktives Panel → dessen Kandidaten, sonst alle; ohne → alle
moonDown ∧ Pool enthält „Kein Mond“-Zeilen → nur diese
headroom(l) = LA ? 300 × Anzahl aufeinanderfolgender Slots k = cs, cs+1, … ≤ S−1 mit ESsafe[l][k] : ∞
rising = cs+1 < S ∧ MoonAlt[cs+1] > MoonAlt[cs]  (letzter Slot: false); preferRelaxed = ¬moonDown ∧ ¬rising
R(l) = Kein Mond ? ∞ : Profil-Restriktivität (§3 Punkt 4); ohne LA 0
sortiere Pool: headroom ↑, dann R (preferRelaxed ? ↑ : ↓), dann (Geplant − Akzeptiert zu Nachtbeginn) ↓, dann Definitionsreihenfolge (Panel, Zeile)
Filterwechsel aktiv (filterSwitchEvery = N > 0, nicht Transit):
  Schlüssel des Zyklus: produktiv Zeilen-ID; Kompatibilität Filtername (SS 662)                                 ← A-22
  minSubs = max(1, ⌈N × tolerancePct/100⌉); runway(l) = min(targetRemainingSec, headroom(l)); fits(l) = ⌊runway / (exposureS + downloadS)⌋ ≥ min(minSubs, Rest(l))
       (Kompatibilität: Divisor exposureS)
  Zyklus vorhanden:
    subsOnLine < N ∧ gleiche Zeile im Pool → diese, subsOnLine+1
    subsOnLine ≥ N ∧ andere Zeilen im Pool ∧ keine fits → gleiche Zeile (falls im Pool), subsOnLine+1
  pick = Pool[0]
  subsOnLine ≥ N ∧ |Pool| > 1 ∧ aktuelle Zeile im Pool an Index i:
    next = erste Pool[(i+k) mod n] mit fits, k = 1…n−1; keine → aktuelle
    next ≠ aktuelle:
      headroom(akt) ≥ headroom(next) ∨ headroom(akt) ≥ Rest(akt)·exp(akt) + min(Rest(next), N)·exp(next) → next
      sonst aktuelle, außer es gibt Pool[(i+k)] ≠ aktuelle mit headroom ≤ headroom(akt) ∧ fits → diese
  neuer Zyklus = (pick, 1) wenn Zeile gewechselt
ohne Filterwechsel: Pool[0]
Panel gewechselt → Panel-Zeiten der Einheit zurücksetzen
```
**Panelreihenfolge nach einem Flip (verbindlich, NT-27):** Hat im laufenden Block ein `meridian_flip` stattgefunden und ist die Einheit ein Mosaik ohne Panel-Einheiten, wird der Pool vor dem Sortieren auf Kandidaten von Panels mit `tM ≤ cursor` (Meridian schon überschritten, gleiche Pierseite `east`) beschränkt, sofern es solche gibt; sonst bleibt er unverändert. Panels, deren Meridian noch bevorsteht, würden die Montierung auf die andere Pierseite zurückschwenken und einen zweiten Flip erzwingen. Gilt ein Panelwechsel dennoch mit Pierseitenwechsel, trägt der Slew-Eintrag die Flip-Dauer (§8).
`pick` ist im Produktivmodus **seiteneffektfrei**; der Walk übernimmt Zyklus/Panel-Zeit erst nach Annahme der Belichtung (A-7). Kompatibilität: Zustand wird in `pick` geschrieben und bei Proben zurückgesetzt (SS/SE wie Original).

## 10. Abweichungen vom Original (verbindlich im Produktivmodus)

| # | Original | Svenesis NINA-PM | Grund |
|---|---|---|---|
| A-1 | Mittlere Mond-/Sonnenbewegung, geozentrisch, ohne Refraktion/Präzession | Astronomie aus AP-08b (astropy-Referenz), scheinbare Höhen | Genauigkeit (Fehler im Original ~6° Mond) |
| A-2 | Mond ≤ Max-Höhe → sicher; Relax/Min-Höhe wirkungslos | `moonSafe` nach `moon.md` | Profile wirken wie beschrieben |
| A-3 | „No Moon“: Zuteilung nur Mond unten, Filterwahl nach Formel | überall `mustBeDown` ⇔ Mondhöhe ≤ 0 | Konsistenz |
| A-4 | Slot = 300 s Belichtung; Walk ohne Overheads | Arbeitssekunden inkl. Download, anteiligem Dither-Settle, anteiligem Filterwechsel und anteiligem Autofokus (§2 `ov`); Walk mit Slew, Filterwechsel, Download, Dither, Autofokus | realistischer Plan |
| A-5 | Kein Flip im Plan | Meridian-Flip nach `flip-rotation.md`, geprüft vor der Filterwahl | FA-SCH-17 |
| A-6 | Pass 0/0b, enforceMinimum, gapFill prüfen `CanImage` | `UsableSlot` (stufenbewusst) | keine Slots ohne mögliche Arbeit |
| A-7 | Belichtung darf in den Folgeblock laufen; `pick` schreibt Zustand | Belichtung nur, wenn sie bis Blockende passt; `pick` ohne Seiteneffekte | Plan = Ausführung, FA-SCH-15 |
| A-8 | `ComputeOverlap`/`OrganizeMoonBlocks` ohne Wirkung | entfallen | toter Code |
| A-9 | `List.Sort` instabil; Einheiten in Cloud-Reihenfolge; Gleichstand nach Projektname | vollständige Tie-Breaks: früherer Start; Projekt-ID, Panel-Index | Determinismus |
| A-10 | Budgets nur nach Restbedarf | Nachtfairness mit bereits Belichtetem (§5.2) | faire Neuplanung |
| A-11 | Einmal pro Nacht planen | Neuplanung mit `startAtUtc` und `tonight` (§5.3) | FA-SIM-05, FA-SYN-03 |
| A-12 | Transitfenster ±(T14/2 + 1 h) | Fenster aus `transit.md` (mit Unsicherheitspuffer) | FA-EXO |
| A-13 | Sortierschlüssel ohne Zieltermin | zusätzlich `due_soonest` | FA-SCH-03 |
| A-14 | `accessible` in Pass 3 vor 3a eingefroren → 3a-Reserve doppelt | nach 3a neu berechnet | keine Überbuchung |
| A-15 | Panel-Einheiten konkurrieren einzeln | gemeinsamer Bedarf je Projekt (§5.2) | Fairness Mosaik vs. Einzelfeld |
| A-16 | Restposten ohne Blockfixkosten; Aussortieren mit voller Mindestzeit | `fix` = Slew + fälliger AF + erwarteter Flip, in MinChunk, Aussortieren **und** Bedarf (`d_i = work + nBlocks·fix`) | Restposten werden fertig, Plan nicht überbucht |
| A-17 | Blockanfang-Ersatz prüft nur `CanImage[s]`, auch Transit/vorgefiltert | CanImage in allen übertragenen Slots; Transit/vorgefiltert ausgeschlossen | keine Belichtung unter Mindesthöhe |
| A-18 | Kein Slew nach Leerlauf auf derselben Einheit | Slew/Zentrieren nach jedem Leerlauf | Montierung kann geparkt/abgedriftet sein |
| A-19 | Masken am Projektzentrum; Panel-Lock mit Listenposition | Panel-Einheiten mit Panel-Koordinaten; Panel-Index | Genauigkeit bei großen Mosaiken |
| A-20 | PreClaim in Zeilenreihenfolge | nach `locked_at` | FA-EXO-33 |
| A-21 | Transitreihe endet bei erreichter Anzahl | bis Fensterende | Baseline vollständig |
| A-22 | Filterzyklus am Filternamen; aktives Panel nur mit Filterwechsel | Zyklus je Zeilen-ID; aktives Panel = Panel der letzten Belichtung | zwei Zeilen gleichen Filters, Panel-Rotation ohne Filterwechsel |
| A-23 | „Letzte Zeile wiederholen“ über **alle** Einheiten (globales `lastEs`, SE 1883) | nur dieselbe Einheit | keine fremde Zeile im Block |
| A-24 | Nachtende-Kulanz global am letzten nutzbaren Slot | Kulanz nur im letzten Block der Nacht, einmal, Eintrag mit `lastOfNight` | Plan = Ausführung |
| A-25 | Nachtgrenzen (`First/LastUsableSlot` der Nacht) inkl. Einheiten ohne Arbeit (SE 384) | nur Einheiten mit Arbeit oder Bonus-Möglichkeit | Nacht endet nicht wegen leerer Projekte später |
| A-26 | Masken zum Slotbeginn | Slot nutzbar nur, wenn Bedingung zu Beginn **und** am Ende gilt | keine Belichtung unter Mindesthöhe/nach Dämmerung |
| A-27 | Budgets als Bruchzahlen, `⌈Budget/300⌉` je Einheit | Budgets vor dem Malen auf ganze Slots quantisiert (größter Rest), `Σ ≤ supply` | keine Überzeichnung, Determinismus |
| A-28 | Stufenmaske über eine Repräsentant-Zeile | Stufe sicher, wenn **eine** Zeile mit Arbeit sicher ist | keine Totzeit durch unsichere Zeilen |
| A-29 | Leeres `pick` mitten im Block lässt die Slots zugeteilt | Rest des Laufs wird freigegeben, `idle_gap` | keine stille Totzeit |
| A-31 | Restriktivität `A × (1 + 100/(maxIllum+1))` – ignoriert die Profilbreite `W`, Stufenordnung nicht monoton | `restrictiveness = A · W · arctan(14,77/W)` aus `moon.md`, zweites Kriterium `maxIllum` aufsteigend | richtige Stufenordnung (AST-M3: zwei zulässige Profile wurden vertauscht, das strengere fiel in `moon_blocked`) |
| A-30 | *(entfällt)* | — | harter Blockschluss (A-7), einzige Ausnahme Nachtende-Kulanz A-24 (NT-18) |

## 11. Tests

### 11.1 Kompatibilitätsmodus (Schalter)
**Ein** Feld steuert den Modus: `PlanInput.mode = 'productive' | 'compat'` (kein zweites `compat`-Feld; TK 8.2, Soll-Plan-Format). `mode: 'compat'` setzt **alle** Abweichungen A-1…A-31 auf das Original-Verhalten:

| Abweichung | im Kompatibilitätsmodus |
|---|---|
| A-1, A-2, A-3 | Astronomie wird nicht genutzt (Grid liefert Masken), `MoonDown` ≤ 0 |
| A-4 | `ov = 0`, `fix = 0`; Overhead-**Einträge** (`Slew`, `Filter`, `Dither`) werden wie im Original protokolliert, verbrauchen aber **keine Zeit** (die Uhr läuft nur um `exposureS`, SE 2023) – genau das setzt der Log-Adapter §11.2 voraus |
| A-5, A-6, A-7, A-13, A-14, A-15, A-16, A-17, A-18, A-20, A-21, A-22, A-26, A-27, A-28, A-29, A-31 | aus (Original) |
| A-8 | ohne Wirkung (toter Code im Original, kein Verhaltensunterschied) |
| A-9 | Einheitenreihenfolge = Grid, Prioritäts-Gleichstand nach `projectName` **ordinal ohne Groß-/Kleinschreibung** (`StringComparer.OrdinalIgnoreCase`, `TargetInstructionSet.cs:1048–1053`), Tier-Gleichstand nach erstem Auftreten, Laufsortierung mit Start-Tie-Break wie im Patch |
| A-10, A-11 | `tonight` wird ignoriert, `startAtUtc` nur als Uhrstart (kein `existing` aus `pastBlocks`) |
| A-12 | Transitfenster ±(T14/2 + 1 h) ohne Unsicherheitspuffer |
| A-19 | Masken am Projektzentrum, Panel-Lock mit Listenposition |
| A-23 | globales `lastEs` über alle Einheiten (SE 1883) |
| A-24 | Nachtende-Kulanz global am letzten nutzbaren Slot (SE 1900) |
| A-25 | Nachtgrenzen inkl. Einheiten ohne Arbeit (SE 384) |

Im Kompatibilitätsmodus werden außerdem die produktiven Validierungen (Mindestzeit, `minAlt < maxAlt`) nur protokolliert, nicht angewandt.

### 11.2 Orakel `tools/astropm-oracle` (AP-13a)
- Quellen: `Models/ScheduleEngine.cs`, `Models/SessionScheduler.cs`, `Models/ProjectTarget.cs`, `Models/AstroCalculator.cs` (nur für Typen), `Models/ExoTransit.cs` **und `Instructions/TargetInstructionSet.cs`** (nur für die Sortier-Tie-Breaks Z. 1048–1053) per Skript aus GitHub (Commit `5dd621d`) laden; nicht eingecheckt.
- Minimal-Patch (`oracle.patch`): (1) Stub-Typ `NINA.Core.Utility.Logger` mit `Info/Warning/Debug/Error`; (2) `HorizonProfile` durch leeren Stub ersetzen; (3) Feld `ExposureSetData.Id` ergänzen und in `SessionScheduler.IsExposureSetMoonSafe` nach `MoonAltDeg ≤ 0 → true` in `OracleMasks[(es.Id, slot.UtcStart)]` nachschlagen; (4) `TierClassifier.IsNoMoonProfile` unverändert (Grid benennt `mustBeDown`-Profile „No Moon“); (5) `PaintChunks`-Sortierung um `a.Start.CompareTo(b.Start)` ergänzen; (6) `PaintTrace` nicht parallel nutzen (Orakel läuft sequentiell).
- Aufruf: nicht `RunSchedule` (ignoriert die Sortierkette), sondern `BuildMatrix(slots, profiles, priorityOrder)` → `PaintSlots`/`PaintSlotsGreedy` → `WalkToLog(matrix, state, tz, ditherEnabled, ditherEvery, filterSwitchEnabled, filterSwitchCount, sortChain, bonusEnabled, filterSwitchTolerance)` mit `ScheduleSessionState { OvershootFraction }`.
- **Abbildung Grid-`settings` → Parameter:** `ditherEnabled/ditherEvery` aus `settings.dither`, `filterSwitchEnabled/filterSwitchCount/filterSwitchTolerance` aus `settings.filterSwitch`, `sortChain` aus `settings.sortChain`, `bonusEnabled` aus `settings.bonusEnabled`, `OvershootFraction = settings.overshootPct/100`, `tz = UTC`. `priorityOrder` = Einheitenreihenfolge des Grids (Tie-Breaks §11.1).
- **Adapter Grid → C# (vollständig):**
  - `TimeSlot`: `UtcStart = 2000-01-01T00:00Z + s·300 s`, `SunAltDeg = −30` (Dunkelheit steckt in `canImage`), `MoonAltDeg = grid.moonAltDeg[s]`, `MoonIllumPct = 100` (Stufe 3 nie aktiv; Sicherheit kommt aus den Masken).
  - `TargetProfile` je Einheit: `SlotUsable = canImage`, `AltitudePerSlot[s] = canImage ? peakAltDeg : 0`, `MoonSepPerSlot = 0`, `SlotMoonOk = true`, `WindowStartSlot`/`WindowEndSlot` aus `canImage`, `FixedWindowStartUtc`/`FixedWindowEndUtc` (**`DateTime?`**, aus `transitWindowS` relativ zu Slot 0), `PanelIndex`, `Tiers`/`TierSlotSafe` aus den `safe`-Masken (§3 Punkt 4), `TierRemainingSec[t] = Σ_{Zeilen der Stufe} max(0, planned − accepted)·exposureS` (im Original gibt es **kein** `TierWorkSec`).
  - `ProjectTarget`: `Panels` = Panel-Liste (Einzelfeld = ein Panel mit Index 0), `ConstraintsData.MinTimeOnTargetHrs = minTimeOnTargetH`, `ConstraintsData.Priority = priority` (`ProjectTarget.Priority` ist read-only), `ProjectName = projectId` (Gleichstand-Tie-Break), `AvoidLunar` bzw. `MoonAvoidanceProfile` setzen (**`HasMoonAvoidance` ist berechnet und nicht setzbar**, `ProjectTarget.cs:204`). Einen Zieltermin gibt es im Original nicht (A-13 ist eine Abweichung) – im Kompatibilitätsmodus wird der Sortierschlüssel `due_soonest` **abgelehnt** (Grid ungültig, Fehler `grid.unsupported_sort_key`).
  - `First/LastUsableSlot`, `PeakAltitude` und `UserPriorityIndex` liegen auf **`TargetRow`** und werden von `BuildMatrix` berechnet (`ScheduleEngine.cs:161–176, 370–379`) – der Adapter setzt sie **nicht**.
  - Zeilenidentität: Das Original kennt die Zeile als `(PanelIdx, EsIdx)` (`SessionScheduler.cs:463/476`); `ExposureSetData` hat **kein** `Id` und kein `TierIndex` (`TierIndex` sitzt auf `TierInfo`). Der Patch ergänzt deshalb ein Feld `ExposureSetData.Id` für den Masken-Hook. Gesetzt werden `FilterName = filter`, `ExposureLengthSec = exposureS`, `PlannedCount = planned`, `AcceptedCount = accepted`, `Enabled = enabled`, `MoonAvoidanceProfile`/`AvoidLunar`.
  - Mondprofile: `MoonAvoidanceProfileData {Name, MoonSeparationDeg = distanceDeg, MaxMoonIlluminationPct = maxIllumPct}` (nur die Restriktivität ist relevant); `mustBeDown`-Profile heißen `"No Moon"`.
  - **Aussortieren:** Das Original filtert nicht in `BuildMatrix`, sondern in `SessionScheduler.cs:296–304` (`usableHrs = längsterLauf·5/60 < MinTimeOnTargetHrs → Einheit fällt weg`). Der Adapter baut diesen Schritt **vor** `PaintSlots` nach, sonst weicht das Orakel systematisch von der TS-Engine ab (ENG-3).
- **Adapter Log → entries:** `Slew` → `slew_center`, `Filter` → `filter`, `Image`/`Bonus` → `expose` (`bonus`), `Dither` → `dither`, `Wait` → `wait`; `atS = (UtcTime − Slot0)`. `Info/Start/End` ignorieren.
- Vergleich: `SlotAssignment` nach Paint (13b) und Eintragsfolge nach Walk (13c/13d) identisch für alle Soll-Plan-Grids + ≥ 500 Zufallsgrids (feste Seeds).

### 11.3 Soll-Pläne und Eigenschaftstests
- Soll-Pläne im Produktivmodus (`contracts/golden-plans/`): Paint-Fälle in AP-13b, Ablauf-Fälle in AP-13d; Abnahme durch Sven (H-13) ist **Merge-Bedingung** der Soll-Plan-PRs.
- Eigenschaften: nie zwei Einheiten je Slot; gesperrte Slots unverändert; LA-Belichtung nur bei `ESsafe` über die ganze Belichtung (A-26); kein `expose` über Blockende (außer der Nachtende-Kulanz A-24, die spätestens bei `min(darknessEndUtc, block.twilightEndUtc)` endet); deterministisch (`outputHash`); Neuplanung mit leerem `tonight` und `startAtUtc` = Nachtbeginn ≡ Erstplan.
- Zusätzlich (Review 4): `Σ Budgets ≤ supply` (A-27); Mosaik-Deckel `Σ Slots eines Projekts ≤ b_P/300 + Panels · MinChunkSlots` (A-15); Neuplanung ohne Änderung an Zielen/Settings ändert den Restplan nicht (Hysterese-Voraussetzung, `execution.md` §3.2); zwei gleiche Ziele, Neuplanung vor Block 2 → Anteile über die Nacht bleiben ±1 Slot gleich (A-10); kein zugeteilter Slot ohne `expose` im Plan (A-29); jeder Block endet mit `end`, genau ein Eintrag je Nacht darf `lastOfNight` tragen.
- **Sonderfälle als Pflichtfälle:** leere Nacht (`FirstUsableSlot = −1` → keine Blöcke, `warnings = []`, `diagnostics` je Projekt, Plan trotzdem mit `nightWindow`/Zeitmarken), nur Transit (kein regulärer Block), alle Einheiten vorgefiltert (ENG-19).

## 12. Warnungen und Diagnose (FA-SIM-03)

Warnungen (Code, Stufe): `idle_gap` ≥ 10 min **ungenutzte Zeit** – Leerlauf oder zugeteilte Slots ohne Belichtung (A-29) –, obwohl eine nicht vorgefilterte Einheit mit erreichbarer Arbeit nutzbar wäre (error) · `la_unsafe` LA-Belichtung in unsicherem Slot (error, darf nie auftreten) · `total_min` Einheit mit Belichtungen, aber < MinChunk zugeteilt, obwohl Arbeit ≥ MinChunk (warn) · `no_alloc` Arbeit und nutzbare Zeit, aber 0 Belichtungen (warn) · `la_miss` > 10 min LA-Arbeit und Mond-unten-Zeit, aber keine Belichtung bei Mond unten (warn) · `filter_stuck` > 30 gleiche Belichtungen in Folge, außer Transit-Einheiten und Einheiten mit nur einer aktiven Zeile (warn) · `past_mismatch` `tonight.exposedSecByUnit` weicht um mehr als 2 Slots von `pastBlocks` ab (warn, §5.2) · `panel_rotation_mismatch` Panel-Positionswinkel weicht ohne Rotator um mehr als die Toleranz ab (warn, `geometry.md` §2.2) · `twilight_grazing` streifende Dämmerungsgrenze, Zeitpunkt schlecht bestimmt (warn, `night.md` §2).

**Ein** Diagnose-Kanal: `diagnostics[]` mit `{projectId, panelId?, lineId?, reason, message?}`; mehrere Gründe je Projekt sind erlaubt (je Grund ein Eintrag), `unscheduled` gibt es nicht mehr (ENG-10). Gründe (`enums.json` → `diagnosticReasons`): `start_date`, `not_visible`, `below_min_time`, `moon_blocked` (nutzbar, aber alle Stufen mit Arbeit nie sicher), `prefiltered` (erreichbare Arbeit < Mindestzeit), `outranked` (Kandidat ohne Slot), `no_need`, `transit_conflict`, `flip_in_transit` (Meldung nennt die erwartete Lücke, `transit.md` §3, und zusätzlich „AF nach Flip aktiv“, wenn das NINA-Profil `AutoFocusAfterFlip` meldet, NT-25), `filter_not_found` (Zeile ohne bestätigten `ninaFilterName`, immer mit `lineId`, NT-E1), `rotation_mismatch`.

Für das Aufwand-Kennzeichen (`effort.md`) liefert `planNight` die Gründe zusätzlich **je Zeile** (`lineId` gesetzt), wenn eine Zeile Arbeit hat, aber keine Belichtung erhält: `moon_blocked`, `filter_not_found`, `below_min_time`, `outranked`, `not_visible`, `prefiltered`.

**Determinismus-Festlegungen:** Im **Produktivmodus** sind alle Zeichenketten-Vergleiche (IDs, Projekt-/Profilnamen) **ordinal** (Code-Unit-Vergleich auf UTF-16), nie kulturabhängig; im Kompatibilitätsmodus gilt für den Prioritäts-Gleichstand `OrdinalIgnoreCase` wie im Original (§11.1). Vergleichswerte werden vor Sortierung und Schwellenprüfung quantisiert: Winkel auf 1e-6° (**`q(x,1e6)`** – zweites Argument ist der ganzzahlige Kehrwert, nicht die Schrittweite; `q(x,1e-6)` machte aus 30° den Wert 0, AST-D9; dieselbe Schreibweise in `moon.md`), Zeiten auf ganze Sekunden, `peakAltDeg` auf 1e-6°. `rising` ist im letzten Slot der Nacht `false` (dokumentiert); der zugehörige Testfall „Stufenwahl im letzten Slot“ gehört zu den Pflichtfällen.
