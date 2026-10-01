# Rechner S-23 – Belichtung, Sampling, Exoplanet-Stern (AP-61)

**Spec-Ergänzung 01.10.2026, Wunsch Sven; Aufbau und Grenzen freigegeben 01.10.2026.** FK 2.4 nennt den Belichtungs- und Sampling-Rechner samt Modus *Exoplanet-Stern* nur als Ausbaustufe; FK 14.3 hat keinen Bildschirm dafür. Diese Datei legt Bildschirm und Formeln fest.

Code: Engine `packages/engine/src/calculator` (Belichtung, Sampling), `packages/shared/src/exo-exposure.ts` (Rig-Kennwerte und Antwortform der Exoplaneten-Empfehlung, bis 01.10.2026 in der API), Seite `apps/web/src/pages/calculator`. Tests: `packages/engine/test/calculator.spec.ts`, `apps/web/src/pages/calculator/calculator.test.tsx`, `e2e/calculator.spec.ts`.

## 1. Bildschirm

- **Ort:** `/planung/rechner`, vierter Reiter der Planung (*Objektbrowser · Sternkarte · Exoplaneten · Rechner*). Alle Rollen (wie die Planung, `catalog.read`); rechnet nur im Browser, keine eigene API.
- **Links *Ausrüstung*:** Rig (`RigSelect`) und Filter (Plätze des Filterrads, ohne Belegung alle Filter), *Band des Modells* (vorbelegt aus dem Filter, änderbar), darunter die Kennwerte in den Gruppen *Optik*, *Kamera*, *Filter*, *Himmel und Standort*. Alle Felder sind vorbelegt und frei änderbar; Änderungen gelten nur im Rechner. *Aus Rig zurücksetzen* verwirft die eigenen Werte der Ausrüstung; ein anderes Rig oder ein anderer Filter tut das auch. Werte der Reiter bleiben.
- **Rechts drei Reiter** (`Tabs`): *Belichtung*, *Sampling*, *Exoplanet-Stern*.
- **URL:** `tab`, `rig`, `filter`, `band` und – für den Exoplanet-Stern – `star`, `mag`, `depth`, `t14`, `k`, `window` (h), `altMax`, `altMid`.
- **Aus S-22:** Die Karte *Belichtung* der aufgeklappten Zeile hat den Link *Im Rechner öffnen* (Aktion *Rechner* aus FA-EXO-14), auch wenn sie mangels Angaben keine Empfehlung zeigt. Er öffnet den Reiter *Exoplanet-Stern* mit Rig, Filter, Band und Helligkeit der Empfehlung (ohne Empfehlung Band der Filterwahl und Katalog-Helligkeit), Tiefe, T14, Rp/R★, Fensterdauer und den Höhen wie die API sie verwendet (§6 von transit.md).
- **Layout:** volle Breite; ab 1024 px Ausrüstung links (1 Teil) und Reiter rechts (2 Teile), darunter untereinander. 768 px ohne horizontales Scrollen.
- **Fehlende oder ungültige Werte:** statt eines Ergebnisses „Für diese Rechnung fehlen: …“ bzw. „Bitte prüfen: …“ mit den Feldnamen.

## 2. Vorbelegung

Wie die Belichtungsempfehlung der Transitsuche (`exposureRig`, transit.md §6): Öffnung, Obstruktion und Brennweite × Reducer des Teleskops; Pixelgröße, Auflösung, QE (ohne Angabe 80 %), Ausleserauschen und Sättigung aus dem Gain-Modus des Standard-Gains vor den Kamerawerten, Sättigung = min(Full Well, (2^Bits − 1) · e⁻/ADU), Dunkelstrom bei Kühlung halbiert je 6 °C unter 20 °C; Bandbreite und Transmission des Filters; Himmelshelligkeit in V aus der Bortle-Klasse des Standorts (Tabelle transit.md §6, ohne Angabe Klasse 4), überschreibbar mit einem SQM-Wert; Höhe ü. NN; Download-Zeit aus dem Aufwand des Rigs.

**Band je Filter** (`calculatorBand`): photometrisches Band (U/B/g/V → V, Rc/r → Rc, Ic/i/z → Ic, clear/lum → lum), sonst Typ Luminanz, UV/IR-Sperr- oder Lichtverschmutzungsfilter → lum, sonst die Mittenwellenlänge (< 600 nm V, < 750 nm Rc, sonst Ic), ohne Angabe V. Ohne Filter lum.

## 3. Reiter *Belichtung* (SNR-Effizienz)

- Himmel je Pixel und Sekunde: `S_sky = Φ₀(Band) · Δλ[Å] · A[cm²] · τ · 10^(−0,4 · (m_V − Farbe(Band))) · s²` mit Φ₀, Ersatzbandbreite, Himmelsfarbe und τ = 0,7 · Transmission · QE wie transit.md §6, `A = π/4 · D² · (1 − Obstruktion²)`, `s = 206,265 · Pixel[µm] / Brennweite[mm]` (″/px). Ohne Bin (bei Software-Binning einer CMOS-Kamera kürzt sich das Binning heraus).
- Hintergrund `B = S_sky + Dunkelstrom` (e⁻/px/s).
- **Kürzeste Einzelbelichtung** `t_min = k · RN² / B`, aufgerundet auf 0,5 s (< 10 s), 5 s (< 60 s), sonst 10 s. **k = 10** (Entscheidung Sven 01.10.2026: Ausleserauschen erhöht das Rauschen um höchstens etwa 5 %), im Feld *Hintergrund mindestens* zwischen 3 und 20 änderbar.
- **Tabelle** für 30, 60, 120, 180, 300, 600 s und `t_min` (als *kürzeste* markiert, ohne Doppelzeile): Hintergrund je Pixel `B·t` (e⁻), **Effizienz** `B·t / (B·t + RN²)` (Anteil des SNR² einer Kamera ohne Ausleserauschen bei gleicher Gesamtzeit), **Rauschzuschlag** `√(1 + RN²/(B·t)) − 1`, **Anteil der Sättigung** `B·t / Sättigung` (ohne Sättigungswert „–“).
- Annahmen wie transit.md §6: theoretischer Nullpunkt, ohne Mond, Schmalband mit dem Kontinuum des Himmels im Band.

## 4. Reiter *Sampling*

- Seeing-FWHM, Standard **2,5″**, änderbar.
- Je Binning 1–4: Maßstab `s · Bin`, FWHM in Pixeln `Seeing / (s · Bin)`, Bildfeld `Breite·s × Höhe·s` in Bogenminuten (gleich für alle Binnings; ohne Auflösung „–“).
- **Einstufung** (Entscheidung Sven 01.10.2026): FWHM < 1,5 px *unterabgetastet*, 1,5–3,5 px *passend*, > 3,5 px *überabgetastet*.
- **Empfohlenes Binning:** das kleinste *passende*, sonst das mit der FWHM am nächsten an 2,5 px.

## 5. Reiter *Exoplanet-Stern*

Dieselbe Rechnung wie die Karte *Belichtung* in S-22 (`exposureAdvice`, transit.md §6) mit den Feldern der Ausrüstung und den Ziel-Feldern Sternhelligkeit im Band, Transittiefe (mmag), T14 (h), Rp/R★ (optional), Beobachtungsfenster (h), höchste Höhe im Fenster und Höhe zur Mitte; Anzeige mit derselben Karte (`ExposureCard`, `exposureResult`). Die Antwort der Transitsuche nennt dafür zusätzlich `band` und `mag` der Empfehlung (`ExoExposure`, additiv).
