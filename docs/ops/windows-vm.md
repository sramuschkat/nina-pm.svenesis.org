# Windows-VM auf dem Mac für NINA (H-14)

Schritt-für-Schritt-Anleitung für den H-14-Rechner als virtuelle Maschine auf dem Entwicklungs-Mac (Apple Silicon, hier MacBook Air M4 mit 24 GB). Die VM ist der **Laufzeit- und Testrechner** für das Plugin (AP-S2b, P-01…P-24 nach `plugin-test-protocol.md`). **Gebaut wird auf dem Mac** (ADR-S2c), abgenommen wird mit einer echten Nacht auf dem Rig in Texas.

Einschränkung (TK 10.5): Windows 11 auf Apple Silicon ist Windows für ARM. NINA, ASCOM und PHD2 laufen dort über die eingebaute x64-Emulation. Für alle Protokolle genügt das, **Zeitmessungen** (Flip-Dauer, Settle, `flip_duration_s`) gelten aber nur auf x64-Hardware, also auf dem Rig.

Zeitbedarf: etwa 2 Stunden, davon die Hälfte Downloads und Installationen.

---

## 1. VM anlegen

1. **VMware Fusion Pro** aktualisieren (für private Nutzung kostenlos; Version 13.6 oder neuer).
2. **Windows-11-ARM-Abbild besorgen.** Entweder im Assistenten *Neu → „Windows von Microsoft herunterladen“* (neuere Fusion-Versionen) oder die ARM64-ISO direkt von Microsoft („Windows 11 für Arm-basierte PCs herunterladen“).
3. Neue VM aus der ISO anlegen:
   - **Verschlüsselung:** Fusion fragt wegen des virtuellen TPM, das Windows 11 braucht. Wähle „nur die für das TPM nötigen Dateien verschlüsseln“ und lass Fusion das Kennwort im Schlüsselbund speichern.
   - **Vor dem ersten Start** unter *Einstellungen*:
     - Prozessoren: **4 Kerne**
     - Arbeitsspeicher: **8 GB**
     - Festplatte: **80 GB** (wächst dynamisch)
     - Netzwerk: **„Mit meinem Mac teilen“ (NAT)**
4. Windows installieren. Hängt die Einrichtung an „Mit einem Netzwerk verbinden“, weil der Netzwerktreiber vor den VMware Tools fehlt:
   - `Umschalt+F10` drücken und `OOBE\BYPASSNRO` eingeben; die VM startet neu und bietet „Ich habe kein Internet“ an.
   - Bei neueren Windows-Builds stattdessen `start ms-cxh:localonly` eingeben.
   - Ein **lokales Konto** reicht, z. B. `nina`.
5. **VMware Tools installieren:** In Fusion *Virtuelle Maschine → VMware Tools installieren*, danach Neustart. Damit gehen Netzwerk, Zwischenablage, Bildschirmgröße und freigegebene Ordner.
6. Windows aktivieren (eigene Lizenz). Ohne Aktivierung läuft die VM, hat aber Einschränkungen bei der Personalisierung.
7. **Zeitzone:** *Einstellungen → Zeit und Sprache* → **(UTC−06:00) Central Time** (Texas), automatische Umstellung an.
   - Grund: NINA nutzt die PC-Zone für Ordner- und Dateinamen. Die Empfehlung aus TK 10.1 (NT-06) lautet PC-Zone = Standortzone, und sonst meldet der SiteCheck `pc_timezone_differs`.
8. Windows-Updates einmal vollständig einspielen und neu starten.

**Snapshot „Windows frisch“** anlegen (*Virtuelle Maschine → Snapshots*).

## 2. Astronomie-Software

Alles als **x64**-Installer, Windows emuliert sie.

1. **NINA 3.2**, genau die Version vom Rig in Texas, von nighttime-imaging.eu:
   - Fragt der Installer nach der .NET 8 Desktop Runtime, installiere die **x64**-Version von dotnet.microsoft.com.
   - In NINA unter *Optionen → Allgemein* die automatische Update-Suche abschalten. Die NINA-Version darf nur zusammen mit `NinaVersion` im Repo wechseln (ADR-S2c).
2. **ASCOM Platform 7** von ascom-standards.org. Die Plattform bringt die Simulatoren mit (OmniSim/Alpaca-Simulatoren): Montierung, Kamera, Filterrad, Fokussierer, Rotator, Flat-Panel (CoverCalibrator), Safety Monitor. Beim ersten Start fragt die Windows-Firewall nach, bitte zulassen.
3. **PHD2** (aktuelle Version von openphdguiding.org). Im Verbindungsdialog als Kamera und Montierung jeweils **„Simulator“** wählen.

## 3. NINA-Profil mit Simulatoren

Ein eigenes Profil anlegen, z. B. **„NINA-PM Test“**, und unter *Ausrüstung* verbinden:

| Gerät | Auswahl |
|---|---|
| Kamera | N.I.N.A.-Simulator-Kamera oder ASCOM-Kamera-Simulator |
| Montierung | ASCOM-Teleskop-Simulator (OmniSim) |
| Filterrad | ASCOM-Filterrad-Simulator, **7 Plätze**: L, R, G, B, Ha, OIII, SII |
| Fokussierer | ASCOM-Fokussierer-Simulator |
| Rotator | ASCOM-Rotator-Simulator |
| Flat-Panel | ASCOM-CoverCalibrator-Simulator |
| Guider | PHD2 (läuft mit Simulator) |
| Safety Monitor | ASCOM-SafetyMonitor-Simulator |

Dann unter *Optionen*:

1. **Standort** auf die Koordinaten des Rigs in Texas setzen.
   - Grund: Der SiteCheck vergleicht das NINA-Profil mit dem Rig-Standort und warnt ab 10 km Abweichung.
2. **Filternamen** genau so schreiben wie die Rig-Zuordnung im Web (`ninaFilterName`).
   - Grund: Die Plugin-Zuordnung vergleicht exakt (NT-E1).
3. **Meridian-Flip** aktivieren (für P-01).
4. **Trainierte Flat-Belichtung:**
   - Den Flat-Assistenten einmal je Filter mit dem Simulator-Panel laufen lassen und die trainierten Belichtungszeiten speichern.
   - Danach stehen sie unter *Optionen → Bildgebung → Flats*.
   - Die Flat-Protokolle brauchen das (H-14).

Snapshot **„NINA eingerichtet“** anlegen.

## 4. Entwicklerwerkzeuge in der VM

Gebaut wird auf dem Mac; in der VM ist nur der schnelle Weg „direkt dort bauen und in NINA laden“ nötig:

1. **.NET 8 SDK**, ARM64-Installer von dotnet.microsoft.com. Das SDK baut das x64-Plugin trotzdem, denn `PlatformTarget` steht in `Directory.Build.targets`.
2. **Git für Windows** (ARM64), Repository klonen:
   ```powershell
   git clone https://github.com/sramuschkat/nina-pm.svenesis.org.git C:\dev\nina-pm
   ```
   Nicht aus dem freigegebenen Mac-Ordner bauen: Builds auf `\\vmware-host\Shared Folders\…` sind langsam und scheitern gelegentlich an Dateisperren.
3. **Node LTS** (ARM64), nur falls der Test-Server einmal in der VM laufen soll. Standard ist der Mac, siehe Schritt 6.

## 5. Versionsabgleich (Abnahme aus ADR-S2c)

In PowerShell:

```powershell
(Get-Item "C:\Program Files\N.I.N.A. - Nighttime Imaging 'N' Astronomy\NINA.Sequencer.dll").VersionInfo.FileVersion
```

Erwartet wird genau der Wert von `NinaVersion` in `apps/nina-plugin/Directory.Build.props`, jetzt **3.2.0.9001**. Weicht er ab, nicht weitertesten: NINA-Version und `NinaVersion` angleichen. Liegt NINA woanders, zeigt *Hilfe → Über* in NINA die Version.

Ergebnis an Claude Code zurückmelden: die ausgegebene Version und die NINA-Version aus *Hilfe → Über*.

## 6. Plugin laden und testen

- **Ordner:** NINA lädt Plugins aus `%LOCALAPPDATA%\NINA\Plugins\3.0.0\<Plugin-Name>\`. Die Debug-Ausgabe der Plugin-Projekte zeigt unter Windows direkt dorthin (TK 10.5).
- **Aus der VM (ab AP-16a, wenn `apps/nina-plugin` die Projekte enthält):**
  ```powershell
  cd C:\dev\nina-pm; git pull; dotnet build -c Debug apps\nina-plugin\NinaPm.Nina.Ui
  ```
  Danach NINA neu starten.
- **Aus dem CI:** Die ZIP aus `plugin.yml` herunterladen und in denselben Ordner entpacken (ab AP-16a).
- **Test-Server auf dem Mac (ab AP-16a):** Die VM erreicht den Mac über NAT:
  - In der VM `ipconfig` ausführen. Das Standardgateway endet auf **.2**; der Mac hat dieselbe Adresse mit **.1** (z. B. Gateway `192.168.64.2` → Mac `192.168.64.1`).
  - Diese Adresse mit dem Port des Test-Servers in den Plugin-Optionen eintragen.
  - Beim ersten Zugriff fragt die macOS-Firewall nach, bitte zulassen.
- **Ergebnisse** der Protokolle (`result.json`, `nina.log`, Screenshots) nach `docs/test-runs/<JJJJ-MM-TT>/<P-xx>/`. Das NINA-Log liegt unter `%LOCALAPPDATA%\NINA\Logs\`.

## 7. Pflege

- **Snapshots vor jedem Plugin-Test** („vor P-xx“), damit ein kaputtes Profil oder Plugin in Sekunden zurückgesetzt ist.
- **NINA-Update** nur gemeinsam mit dem Rig, in dieser Reihenfolge:
  1. neue Version in der VM installieren;
  2. Schritt 5 ausführen;
  3. `NinaVersion` im Repo per PR anheben (NuGet-Paket `NINA.Plugin` in derselben Version);
  4. erst danach das Rig aktualisieren.
- Die VM braucht im Leerlauf kaum Leistung. Für lange Tests den Mac ans Netzteil hängen und den Ruhezustand abschalten.

## Checkliste H-14

- [ ] VM mit Windows 11 ARM, VMware Tools, Zeitzone Central Time
- [ ] NINA 3.2 (Version wie Rig), automatische Updates aus
- [ ] ASCOM Platform 7 mit Simulatoren, PHD2 mit Simulator
- [ ] NINA-Profil „NINA-PM Test“: alle Geräte verbunden, Standort Texas, Filternamen wie im Web, Flip aktiv, trainierte Flat-Belichtungen
- [ ] .NET 8 SDK, Git, Repository geklont
- [ ] Versionsabgleich aus Schritt 5 = `NinaVersion` (Ergebnis an Claude Code)
- [ ] Snapshots „Windows frisch“ und „NINA eingerichtet“
