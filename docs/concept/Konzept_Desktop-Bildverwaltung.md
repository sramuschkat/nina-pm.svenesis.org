# Konzept – NINA-PM Desktop: Bildverwaltung, Sichtung und Bildanalyse (Entwurf)

| | |
|---|---|
| Stand | Entwurf 09.10.2026 – zur Abstimmung mit Sven, noch nicht im Fachkonzept |
| Vorbilder (nur Ideen, kein Code) | „SubInspector“ und „Image Analysis“ von astro-pm.com; ASTAP als Plate-Solver |
| Betrifft | Fachkonzept 2.3 („Ausdrücklich nicht im Umfang“: Sub Inspector, Bildanalyse, Bilddateien verwalten) – wird mit diesem Konzept bewusst geöffnet, siehe §11 |

## 1. Ziel

NINA-PM plant Projekte, NINA führt sie aus, der Server kennt jede Aufnahme mit ihren Messwerten (AP-70 bis AP-72) und
– nach AP-74 – auch, ob sie in der Dropbox gesichert ist. **Die Bilder selbst sieht NINA-PM nie.** Sie liegen am Rig, in
der Dropbox und auf dem Rechner, auf dem gestackt wird.

Ein eigenes Programm **„NINA-PM Desktop“** läuft nativ auf **Windows und macOS**, greift auf einen lokalen Bildordner zu
und spricht über die Web-API mit NINA-PM. Damit lassen sich

1. alle Rohbilder eines Projekts oder einer Nacht **sehen** (gestreckt, gezoomt, im Blink-Vergleich),
2. jedes Bild **selbst vermessen** (Sterne, HFR/FWHM, Exzentrizität, Hintergrund, Rauschen) und **bewerten**,
3. einzelne Bilder **tiefer analysieren** (Tilt, Bildfeldkrümmung, Kollimation, Vignettierung, Staub, Belichtung, PSF),
4. Bilder mit **ASTAP** plate-solven und die Bildmitte und Rotation mit dem Projekt vergleichen,
5. die Entscheidung „behalten / verwerfen“ **mit NINA-PM abgleichen** – die Zähler im Belichtungsplan stimmen dann mit
   dem überein, was wirklich gestackt wird.

Die Bilder verlassen den Rechner nicht. Hoch zu NINA-PM gehen nur Messwerte, Bewertungen und Plate-Solve-Ergebnisse.

## 2. Abläufe aus Sicht des Nutzers

| Ablauf | Schritte |
|---|---|
| **Einrichten** | App installieren → „Mit NINA-PM verbinden“ (Code im Browser bestätigen, §6.1) → Mandant wählen → Bildordner je Rig wählen (z. B. der lokale Dropbox-Ordner `AstroRemote/NINA`) → optional ASTAP-Pfad (wird gesucht) |
| **Nacht sichten** | Start: Liste der Nächte mit neuen Bildern (vom Server) → Nacht öffnen → Raster aller Lights nach Filter, Kurven der Nacht (HFR, FWHM, Sterne, Exzentrizität, Hintergrund) → Ausreißer markiert → Blink über die markierten → mit Tasten behalten/verwerfen → „Mit NINA-PM abgleichen“ |
| **Projekt sichten** | Projekt öffnen → alle Bilder aller Nächte, gruppiert Nacht × Filter oder Filter × Nacht → Bewertungsband je Filter → Stack-Liste exportieren |
| **Einzelbild analysieren** | Bild doppelklicken → Sternüberlagerung, 3×3-Feld (HFR je Zone), Tilt und Krümmung, Exzentrizität mit Richtung, Vignettierung, Staub/Reflexe, Belichtungsurteil, PSF eines Sterns in 3D |
| **Plate-Solve** | Ein Bild oder eine Auswahl → ASTAP mit Hinweisen aus Rig und Projekt → Bildmitte, Rotation, Maßstab; Abweichung zum Projektziel bzw. Panel; Ergebnis an NINA-PM |
| **Ohne Netz** | Sichten und Analysieren gehen offline; Bewertungen warten und werden beim nächsten Verbinden abgeglichen |

## 3. Funktionsumfang

### 3.1 Bibliothek
- **Bildordner je Rig** (mehrere möglich), nur lesend durchsucht; Formate **FITS** (NINA-Standard) und **XISF**; Farbkameras
  mit Debayer (Bayer-Muster aus dem Header). RAW-Formate von DSLRs: zunächst nicht (§11).
- **Zuordnung zu NINA-PM-Aufnahmen** über den relativen Pfad (`capture.metrics.relativePath`, AP-72b), sonst Dateiname
  (`capture.file_name`), zur Kontrolle FITS-Header (`DATE-OBS`, `FILTER`, `EXPTIME`, `OBJECT`). Nicht zuordenbare Bilder
  erscheinen als „ohne Projekt“ und lassen sich trotzdem sichten.
- **Lokaler Zwischenspeicher** (SQLite je Bibliothek): Vorschaubilder, Messwerte je Bild, Stand des Abgleichs – ein
  Bild wird nur neu vermessen, wenn sich Datei oder Messverfahren ändern.
- Neue Bilder im Ordner (Dropbox-Sync) werden beim Start bzw. durch Beobachten des Ordners erkannt und im Hintergrund
  vermessen.

### 3.2 Sichtung (Vorbild SubInspector)
- **Raster** aller Bilder einer Nacht bzw. eines Projekts, gruppiert **Nacht × Filter** oder **Filter × Nacht**
  (umschaltbar ohne Neuladen), Vorschau automatisch gestreckt (Auto-STF), Bewertung als Farbe am Rand.
- **Kurven der Nacht**: HFR, FWHM, Sternzahl, Exzentrizität, Hintergrund (ADU), Rauschen, SNR-Schätzung, dazu vom Server
  Höhe, Wolken, Guiding-RMS – auf einer Zeitachse, Klick springt zum Bild.
- **Bewertung je Filter**: dieselben Regeln wie AP-72b (Bezug = Median der behaltenen Lights des Projekts und Filters;
  Grenzwerte vom Rig: HFR +30 %, Sterne < 50 %, RMS > 1,5″, Wolken > 50 %), ergänzt um lokale Kennzahlen
  (FWHM, Exzentrizität, Hintergrund). Ergebnis: *gut / markiert / verworfen*, jede Markierung mit Grund.
- **Blink**: Folge von Bildern mit fester Streckung, Tempo einstellbar, Ausrichtung auf Sterne optional; Tasten für
  behalten / verwerfen / weiter.
- **Vergleich**: zwei bis vier Bilder nebeneinander, gemeinsamer Zoom.
- **Stack-Liste**: Dateiliste der behaltenen Lights je Projekt und Filter (Text, CSV, WBPP-taugliche Ordnerstruktur
  als Kopie oder Verknüpfung – nur auf Wunsch).

### 3.3 Einzelbild-Analyse (Vorbild Image Analysis)
- **Sterne**: Erkennung mit einstellbarer Schwelle; je Stern Position, HFR, FWHM, Spitze, Güte der Gauß-Anpassung,
  Exzentrizität und Richtung; Überlagerung im Bild.
- **3×3-Zonen**: HFR und Exzentrizität je Zone; **Tilt** (Richtung und Stärke der Schärfeebene) und **Bildfeldkrümmung**
  getrennt geschätzt; **Kollimation** als Asymmetrie der Zonen gegenüber der Mitte mit Richtung.
- **Vignettierung**: Helligkeitsverlauf Mitte → Ecken, Schnitte waagerecht/senkrecht verschiebbar.
- **Staub und Reflexe**: Donuts, Kratzer, Reflexe heller Sterne mit Lage, Größe, Stärke.
- **Belichtung**: Hintergrund, gesättigte Pixel, Histogramm, Abstand zum Ausleserauschen der Kamera (Daten aus der
  Kamera in NINA-PM) → „Belichtung zu kurz / passt / zu lang“, Verweis auf den Belichtungsrechner (AP-61).
- **PSF 3D** eines gewählten Sterns, drehbar.
- **Header**: alle FITS-/XISF-Schlüssel.

### 3.4 Plate-Solving mit ASTAP
- ASTAP läuft als **eigenes Programm** (Kommandozeile `astap -f <datei> -r <Radius> -fov <Bildhöhe°> -z <Binning>`),
  das die App startet; Ergebnis aus der `.ini`/`.wcs`-Datei neben dem Bild (bzw. in einem Temp-Ordner).
- **Hinweise** aus NINA-PM: Bildfeld und Maßstab des Rigs, Ziel bzw. Panel des Projekts → kleiner Suchradius, schnell.
- Ergebnis: Mitte RA/Dec, Rotation, Maßstab, gelöst ja/nein; **Abweichung zum Ziel/Panel** in Bogenminuten und Grad;
  bei Mosaiken Überdeckung der Panels.
- ASTAP und seine Sterndatenbank (z. B. D50) installiert der Nutzer selbst; die App findet ASTAP an den üblichen Orten
  oder fragt nach dem Pfad und verlinkt die Download-Seite. ASTAP ist GPL-lizenziert – deshalb nur als getrennter Prozess
  aufrufen, nicht einbinden und nicht mitliefern.

### 3.5 Dateiaktionen
- Grundsatz: **nichts löschen.** Verwerfen ist zunächst nur eine Bewertung (lokal und in NINA-PM).
- Optional je Bibliothek: verworfene Bilder in einen Unterordner `_verworfen/` **verschieben** (rückgängig machbar),
  damit Stacking-Programme sie nicht mitnehmen. Vorsicht bei Dropbox-Ordnern: das Verschieben synchronisiert in die
  Cloud (§11).

## 4. Zusammenspiel mit NINA-PM

| Richtung | Was | Woher / wohin |
|---|---|---|
| ↓ vom Server | Mandant, Rigs (Optik, Maßstab, Bildfeld, Grenzwerte der Bewertung), Projekte mit Zielen/Panels und Belichtungsplan, Aufnahmen mit Messwerten des Plugins, Bewertung und Bezug (AP-72b), „gesichert“ (AP-74) | vorhandene Web-API, erweitert um Abfragen je Nacht/Rig |
| ↑ zum Server | Lokale Messwerte je Aufnahme (FWHM, Exzentrizität, Hintergrund, Rauschen, Sterne, HFR lokal), Plate-Solve-Ergebnis, Entscheidung behalten/verwerfen | neue Routen `POST /desktop/v1/captures/metrics` (Stapel), `POST /desktop/v1/captures/solve`; Verwerfen/Behalten über die vorhandenen Routen aus AP-72b |
| nie | Bilddaten, Vorschaubilder, lokale Pfade außerhalb des relativen Pfads | – |

- **Wer hat recht?** Verwerfen/Behalten ist eine Entscheidung des Nutzers und gilt überall (wie heute im Reiter „Bilder“).
  Lokale Messwerte ergänzen die des Plugins (eigene Felder, z. B. `desktop.fwhm`), sie überschreiben sie nicht; die
  Bewertung des Servers kann sie später einbeziehen.
- **Konflikte**: gleiche Aufnahme in Web und App unterschiedlich bewertet → der letzte Stand gewinnt, mit Zeitstempel
  und Hinweis in der App.
- **Rechte**: wie im Web (`session.correct` zum Verwerfen, `project.read` zum Sehen).

## 5. Architektur

### 5.1 Empfehlung: Tauri 2 (Rust-Kern, Oberfläche als Web-UI)
- **Rust-Kern** für alles Rechenintensive und den Dateizugriff: FITS/XISF lesen, Debayer, Streckung, Sternerkennung,
  PSF-Anpassung, Zonen-Analysen, Zwischenspeicher, ASTAP-Aufruf, API-Client. Parallel über alle Kerne.
- **Oberfläche** im System-Webview (WebView2 unter Windows, WKWebView unter macOS) mit **React, `packages/ui-tokens`,
  `packages/i18n`** und den Bausteinen der Web-App – gleiche Optik, gleiche Texte DE/EN, beide Themes, ein Team-Stack.
  Bilder kommen nicht als Base64, sondern über ein eigenes Protokoll (`npmimg://…`) als fertig gestreckte Kacheln aus dem
  Rust-Kern; Zoom und Blink bleiben flüssig.
- Ergebnis: echte native Programme (`.msi`/`.exe`, `.dmg`/`.app`, Apple Silicon und Intel), klein (~10–20 MB),
  ohne mitgeliefertes Chromium.

### 5.2 Alternative: reine Rust-Oberfläche (egui oder Slint)
- Vorteil: alles in Rust, sehr schnelle Bildanzeige über die GPU.
- Nachteil: eigene Optik, Texte, Themes und Bausteine neu bauen; kein Wiederverwenden der Web-App; Barrierefreiheit
  schwächer. → nur, wenn die Bildanzeige im Webview nicht reicht (Spike in D0 entscheidet).

### 5.3 Bausteine im Repo
```
apps/desktop/                 Tauri-App (Rust-Shell + React-Oberfläche)
crates/npm-image/             FITS/XISF lesen, Debayer, Statistik, Streckung (Auto-STF), Vorschauen
crates/npm-analysis/          Sternerkennung, PSF/Gauß, HFR/FWHM/Exzentrizität, Zonen, Tilt, Vignettierung, Staub
crates/npm-solve/             ASTAP-Aufruf und Auswertung, Hinweise aus Rig/Projekt
crates/npm-api/               API-Client aus der OpenAPI (generiert), Anmeldung, Abgleich, Offline-Warteschlange
crates/npm-library/           Ordner durchsuchen/beobachten, Zuordnung zu Aufnahmen, SQLite-Zwischenspeicher
```
- Verträge zuerst wie überall: neue Routen in `packages/shared/src/contracts`, OpenAPI → Rust-Client und TS-Typen.
- Rechenregeln der Bewertung einmal fachlich beschrieben (Spec), umgesetzt in TS (Server) und Rust (App), mit
  gemeinsamen Testfällen (JSON-Fixtures), wie Engine und Jint-Parität.

### 5.4 Leistungsziele (Vorschlag)
- Öffnen und Strecken eines 60-MP-FITS (16 bit): < 0,5 s; Sternanalyse eines Bildes: < 1,5 s auf einem aktuellen
  Laptop; 300 Bilder einer Nacht im Hintergrund in < 5 min.
- Blink mit 5 Bildern/s aus dem Zwischenspeicher.

## 6. Sicherheit und Datenschutz

### 6.1 Anmeldung
- Anmeldung bleibt **nur Discord** (Regel 5). Die App nutzt einen **Gerätecode-Ablauf**: Sie zeigt einen Code und öffnet
  `nina-pm.svenesis.org/verbinden`; dort bestätigt der angemeldete Nutzer den Code und wählt den Mandanten. Die App erhält
  ein **Geräte-Token** (je Gerät, widerrufbar unter „Persönliche Einstellungen → Geräte“, mit „zuletzt gesehen“).
- Token im **Schlüsselbund** (macOS Keychain, Windows Credential Manager), nie in Dateien oder Logs.
- Server: neue Token-Art „Desktop“ neben Sitzung und NINA-Instanz; Rechte = die des Mitglieds; CSRF entfällt für
  Token-Aufrufe (kein Cookie), dafür Ratenbegrenzung wie bei der NINA-API.

### 6.2 Daten
- Die App liest nur die gewählten Ordner. Bilder bleiben lokal; zum Server gehen nur Messwerte und Entscheidungen.
- ASTAP bekommt nur die einzelne Datei und die Hinweise.

## 7. Verteilung und Updates
- Builds in GitHub Actions (`macos-latest`, `windows-latest`), Veröffentlichung als **GitHub Release** des öffentlichen
  Repos; Tags/Releases setzt Sven (wie bisher). Keine Änderung an www.svenesis.org; ein Link auf der NINA-PM-Seite
  („App herunterladen“) zeigt auf das Release.
- **macOS**: Signieren und Notarisieren braucht ein Apple-Developer-Konto (menschliche Aufgabe, Kosten ~99 $/Jahr) –
  ohne öffnet macOS die App nur mit Umweg. **Windows**: ohne Code-Signing warnt SmartScreen; Zertifikat optional.
- **Auto-Update** über den Tauri-Updater mit signierten Paketen (Schlüssel in GitHub-Secrets/SSM, nie im Repo).

## 8. Tests
- Rust: Unit-Tests je Crate; **Messwerte gegen Referenzen** (Beispiel-FITS mit bekannten Werten aus NINA bzw.
  PixInsight SubframeSelector, Toleranzen festgelegt); ASTAP-Adapter mit aufgezeichneten Ausgaben.
- Gemeinsame Bewertungs-Fixtures TS ↔ Rust.
- Oberfläche: Vitest wie im Web; E2E der App mit Tauri-Treiber (WebDriver) auf Windows und macOS im CI.
- Server: Verträge, Rechte-Tests, Repository-Tests der neuen Routen wie immer.

## 9. Ausbaustufen (Vorschlag)

| Stufe | Inhalt | Ergebnis |
|---|---|---|
| **D0 Spike** | Tauri-Gerüst, FITS lesen + Auto-STF, Raster mit 300 Vorschauen, Zoom 1:1, ASTAP-Aufruf eines Bildes; Messung der Ladezeiten Webview vs. egui | Entscheidung Tauri/egui (ADR), Machbarkeit |
| **D1 Bibliothek & Anmeldung** | Gerätecode-Ablauf, Bildordner, Zuordnung zu Aufnahmen, Zwischenspeicher, Nacht-/Projektansicht mit Server-Bewertung | Bilder sehen, mit NINA-PM verbunden |
| **D2 Sichtung** | lokale Sternanalyse, Kurven, Bewertung je Filter, Blink, Vergleich, behalten/verwerfen mit Abgleich, Stack-Liste | SubInspector-Ersatz |
| **D3 Plate-Solving** | ASTAP mit Hinweisen, Abweichung zu Ziel/Panel, Ergebnis an NINA-PM, Anzeige im Web (Projekt/Nacht) | Framing-Kontrolle |
| **D4 Einzelbild-Analyse** | Zonen, Tilt/Krümmung, Kollimation, Vignettierung, Staub, Belichtung, PSF 3D | Image-Analysis-Ersatz |
| **D5 Verteilung** | Signieren/Notarisieren, Auto-Update, Download-Link, Anleitung | Installierbar für alle Mitglieder |

## 10. Neue Anforderungen (Vorschlag für das Fachkonzept, neues Kapitel 6.15 „Desktop“)
| ID | Anforderung |
|---|---|
| FA-DSK-01 | Native App für Windows und macOS, verbunden mit NINA-PM per Gerätecode und widerrufbarem Geräte-Token. |
| FA-DSK-02 | Lokale Bildbibliothek je Rig (FITS, XISF), Zuordnung der Dateien zu Aufnahmen über relativen Pfad bzw. Dateiname. |
| FA-DSK-03 | Sichtung je Nacht und Projekt (Raster, Gruppierung Nacht × Filter, Kurven, Blink, Vergleich). |
| FA-DSK-04 | Lokale Vermessung (HFR, FWHM, Exzentrizität, Sterne, Hintergrund, Rauschen) und Bewertung nach den Regeln aus AP-72b. |
| FA-DSK-05 | Behalten/Verwerfen in der App wirkt in NINA-PM (Zähler, Reiter „Bilder“) und umgekehrt. |
| FA-DSK-06 | Einzelbild-Analyse: Zonen, Tilt, Krümmung, Kollimation, Vignettierung, Staub/Reflexe, Belichtung, PSF. |
| FA-DSK-07 | Plate-Solving mit ASTAP (vom Nutzer installiert), Abweichung zu Ziel/Panel, Ergebnis an NINA-PM. |
| FA-DSK-08 | Stack-Liste der behaltenen Lights je Projekt und Filter. |
| NFA-DSK-01 | Bilder verlassen den Rechner nicht; Token im Schlüsselbund; nichts wird gelöscht. |

## 11. Offene Entscheidungen
1. **Fachkonzept 2.3 öffnen?** Sub Inspector, Bildanalyse und lokale Bildverwaltung waren ausdrücklich ausgeschlossen
   („Bewertung außerhalb, z. B. PixInsight“). Mit diesem Konzept würden sie Teil von NINA-PM – als eigenes Programm,
   der Server bleibt ohne Bilddateien. → ADR „Desktop-App“ und Fachkonzept-Änderung.
2. **Oberfläche:** Tauri mit Web-UI (Empfehlung) oder reine Rust-GUI (egui/Slint)? Entscheidung nach dem Spike D0.
3. **Dateiaktion „verwerfen“:** nur bewerten (Empfehlung für den Anfang) oder zusätzlich in `_verworfen/` verschieben?
   Im Dropbox-Ordner wirkt das sofort in der Cloud.
4. **Formate:** FITS und XISF; Farbkameras ja; DSLR-RAW (CR2/NEF) später oder nie?
5. **Plate-Solver:** nur ASTAP (vom Nutzer installiert) oder zusätzlich ein eingebauter Solver später (z. B. das
   MIT-lizenzierte Rust-Projekt `arcsec`, das sich als ASTAP-kompatibel beschreibt – erst prüfen)?
6. **Signieren:** Apple-Developer-Konto und ggf. Windows-Zertifikat anschaffen (Kosten, menschliche Aufgabe)?
7. **Wer nutzt die App?** Nur Admins oder alle Mitglieder (dann braucht jeder Zugriff auf die Bilder, z. B. geteilten
   Dropbox-Ordner)?
8. **Linux** mit bauen (Tauri kann es, kostet CI-Zeit)?

## 12. Nicht im Umfang
- Stacken, Kalibrieren, Bildbearbeitung (bleibt PixInsight, Siril o. Ä.).
- Hochladen von Bildern zu NINA-PM, Bildgalerie, Vorschaubilder im Web.
- Steuerung von NINA oder des Rigs aus der App.

## 13. Lehren aus PSF Guard (09.10.2026, nur Ideen)

[PSF Guard](https://github.com/theatrus/psf-guard) (Apache-2.0) ist ein fast gleiches Programm: Rust-Kern, Tauri, React,
Windows/macOS/Linux; Sichtung, Bewertung, Prüfungen, eigener Solver (Seiza), Stack-Vorschau, Export nach WBPP/AstroBin.
Datenquelle ist die Datenbank des NINA-Plugins *Target Scheduler*; mit „Director“ entsteht dort zudem ein eigener Planer.

**Übernehmen (als Idee):**
- **Sterngrößen nie mischen:** NINA-gleich messen oder je Projekt und Filter nur aus einer Quelle bewerten – unser Bezug
  stammt aus NINA-Werten des Plugins.
- **Bewertung:** Toleranzband ohne Abzug, dann linear fallend; „bester“ Bezug (p10/p90) neben dem Median; fehlende
  Messwerte herausrechnen; harte Grenzen („weiche Sterne“ ab 1,5–2× bestem HFR des Ziels über alle Nächte,
  Sensortemperatur); nur gleiche Belichtung/Gain/Offset/Binning/Auslesemodus vergleichen.
- **Schleier und Abdeckung** (Dach, Baum): 8×6-Raster „toter Zellen“, Transparenz über denselben Sternfluss,
  Hintergrundanstieg – Sternzahl und HFR allein lassen solche Bilder durch.
- **Zuordnung** über Dateiname **und** Aufnahmezeit (±2 s); Dateien, die noch kopiert werden, erkennen und abwarten.
- **Abgleich** mit Vorschau → Übernehmen, 409 bei geändertem Stand; automatische Vorschläge mit „[Auto]“, Verwerfen
  bestätigt ein Mensch.
- **Hintergrundarbeit:** erst Header, dann Analyse als Job; Worker nach freiem RAM, Nutzerarbeit vor Hintergrund.
- **Release:** Signieren nur über Tauris `signCommand`, Updater-Signatur nach Authenticode neu, DMG nach der App erneut
  notarisieren, eigener Signier-Testlauf, E2E gegen die gebaute App mit FITS-Testdaten.
- **Plate-Solving:** Seiza (Rust, Apache-2.0, nach eigener Angabe ASTAP-kompatibel und schneller) als Alternative zu
  ASTAP; nur ein frisch gelöstes Bild zählt; „neben dem Ziel“, Drift, schiefe Rotation erkennen.

**Vermeiden:** lokalen HTTP-Server ohne Anmeldung mit offenem CORS und ohne CSP (stattdessen Tauri-IPC/eigenes Protokoll);
riesige Handler-Dateien; Kopplung an das Target-Scheduler-Schema. **Lizenz prüfen:** Die Nachbauten der NINA- und
HocusFocus-Sternerkennung sind als Apache-2.0 markiert, die Originale stehen unter MPL-2.0.

**Wege (offen, Entscheidung Sven):**

| Weg | Was | Für | Gegen |
|---|---|---|---|
| A | Eigene App wie §1–§10 | ein Datenmodell, unsere Anmeldung und Optik | viel Arbeit (Erkennung, Prüfungen, Solver, Release) |
| B | An PSF Guard andocken (Sync-API/MCP) | sofort nutzbar | fremde Richtung (Director), Target-Scheduler-Modell, ungeschützter lokaler Server |
| C | Eigene App mit Seiza-Crates (Empfehlung) | spart den schwersten Teil, NINA-gleiche Messung | Abhängigkeit von einem Ein-Personen-Projekt, Lizenzprüfung |

Vorher PSF Guard mit einer echten SFRO-Nacht ausprobieren (Download nur mit Freigabe).
