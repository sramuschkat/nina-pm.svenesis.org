# AP-S2c – Spike Build: Adapter ohne Windows bauen (Mensch + Agent)

**Release:** RP · **Größe:** S · **Abhängigkeiten:** AP-01 · **Menschliche Aufgaben:** – (bis 28.09.2026: H-14)

> **Umsetzung abweichend vom Brief (28.09.2026, `docs/adr/ADR-S2c-build.md`):** `NINA.Plugin` 3.2.0.9001 bringt alle fünf Adapter-Assemblies als NuGet-Pakete mit. Übersetzt wird deshalb gegen NuGet statt gegen `refs/`. **Es entfallen:** `NinaRefPath`, `tools/fetch-nina-refs.ps1`, die `README.md` je Version, der CI-Auftrag `refs` und das Artefakt `nina-refs`. **Dazu kommen:** `Directory.Build.targets` (PlatformTarget greift in der Props-Datei nicht), `tools/nina-build-check.sh` (NINA-Paketversionen, Ausgabe nur mit eigenen DLLs, keine DLL im Git) und der Nachweis (d) für XAML. Die Abnahmekriterien unten gelten in der angepassten Form.

## Ziel
Nachweisen, dass sich `NinaPm.Core` **und** der Adapter `NinaPm.Nina` mit dem .NET-8-SDK ohne Windows bauen lassen, sobald die NINA-Referenz-Assemblies aus H-14 vorliegen. Damit findet die Plugin-Entwicklung auf dem Entwicklungsrechner statt und Windows bleibt für die Laufzeit. Nachgewiesen wird an Minimalprojekten unter `spikes/nina-build/`, weil die echten Projekte erst ab AP-08c/AP-16a existieren. Ergebnis sind die Build-Dateien (`Directory.Build.props`, `tools/fetch-nina-refs.ps1`, die CI-Aufträge `refs` und `cross-build`) und ein ADR mit Go/No-Go, kein Plugin-Code.

## Anforderungen
TK 10.1, 10.5, NFA (Wartbarkeit)

## Lesen (nur diese Abschnitte)
- TK 10.1, 10.2, 10.5
- TK 18 (plugin.yml)
- ops/human-tasks.md H-14
- docs/adr/ADR-TEMPLATE.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `apps/nina-plugin/Directory.Build.props` genau nach TK 10.5: `NinaVersion`, `NinaRefPath` (auf Windows das NINA-Installationsverzeichnis, sonst `refs/nina-$(NinaVersion)/` mit Schrägstrichen; ein von außen gesetztes `NinaRefPath` schlägt beides), `EnableWindowsTargeting`, `PlatformTarget` für `net8.0-windows` – **nicht** `<Platforms>`, das ändert den Standard `AnyCPU` nicht und macht die `-p:`-Schalter nur scheinbar nötig
- Dokumentierte Regel für die Plugin-Projekte (Umsetzung erst in AP-16a): `AppendTargetFrameworkToOutputPath`, `AppendRuntimeIdentifierToOutputPath`, `GenerateDependencyFile`, `GenerateRuntimeConfigurationFiles` auf `false` **in den Projektdateien**, nicht in `Directory.Build.props` (Testprojekte brauchen `deps.json` und `runtimeconfig.json`); `Debug`-`OutputPath` nach `%LOCALAPPDATA%` nur unter `'$(OS)'=='Windows_NT'`
- `tools/fetch-nina-refs.ps1`: kopiert sechs Dateien aus der NINA-Installation nach `apps/nina-plugin/refs/nina-<version>/` – fünf NINA-Assemblies (`NINA.Equipment`, `NINA.WPF.Base`, `NINA.PlateSolving`, `NINA.Image`, `NINA.Sequencer`) und `Microsoft.Xaml.Behaviors` (MIT, nur für die Ansichten) –, liest die Version aus der Dateiversion von `NINA.Sequencer.dll`, setzt `NinaVersion` in `Directory.Build.props` und schreibt daneben eine `README.md` mit Version, Quellpfad, Datum und **beiden** Lizenzen (die von NINA beim ersten Lauf prüfen und mit Fundstelle festhalten)
- `.gitignore`-Eintrag `apps/nina-plugin/refs/**/*.dll` (die `README.md` wird versioniert); Hinweis in `THIRD_PARTY_NOTICES.md`, dass gegen NINA-Assemblies kompiliert, aber keine mitgeliefert wird
- Nachweisprojekte unter `spikes/nina-build/`: (a) eine `net8.0`-Bibliothek – weist nach, dass der plattformneutrale Kern ohne NINA baut; (b) eine `net8.0-windows`-Bibliothek **mit `UseWPF=true` und ohne eigene XAML-Datei**, die die fünf NINA-Assemblies per `Reference`/`HintPath` mit `<Private>false</Private>` und `NINA.Plugin` per `PackageReference` mit `ExcludeAssets runtime` zieht, einen Erben von `SequenceItem` enthält und ein Mediator-Feld aus `NINA.WPF.Base` benutzt; (c) dieselbe Bibliothek ohne `UseWPF` als Zusatzversuch (erwarteter Fehler sonst `CS0012`)
- `plugin.yml` nach TK 18: Auftrag `refs` (windows-latest, Vergleich der **im CI installierten** NINA-Version gegen `refs/nina-<version>/README.md`, Artefakt `nina-refs`) und Auftrag `cross-build` (ubuntu-latest, `nina-refs` laden, die Nachweisprojekte (a) und (b) ohne zusätzliche `-p:`-Schalter bauen)
- Ergebnis → `docs/adr/ADR-S2c-build.md` (Vorlage ADR-TEMPLATE) mit den drei Fragen aus TK 10.5 in dieser Reihenfolge: (1) baut (b) ohne Windows? – nur das ist notwendig; (2) geht es auch ohne `UseWPF` bzw. mit `<FrameworkReference Include="Microsoft.WindowsDesktop.App" />`? (3) trägt der XAML-Markup-Compiler ohne Windows, sodass `NinaPm.Nina.Ui` lokal mitgebaut werden kann? Bei Abweichung Änderungsvorschlag für TK 10.5

## Nicht im Umfang
- Plugin-Logik, Ansichten, Ausführung; kein Produktivcode im Plugin

## Automatisierte Abnahme
- [ ] `cross-build` auf `ubuntu-latest` grün: die Nachweisprojekte (a)–(d) übersetzen gegen die NuGet-Pakete `NINA.*`, **ohne** `-p:Platform`/`-p:EnableWindowsTargeting` am Aufruf (angepasst, ADR-S2c)
- [ ] `tools/nina-build-check.sh` bricht ab, wenn ein `NINA.*`-Paket nicht in `NinaVersion` aufgelöst ist (mit `-p:NinaVersion=3.1.2.9001` geprüft) oder fremde DLLs in der Ausgabe liegen (mit `ExcludeAssets="runtime"` geprüft) (ersetzt den Auftrag `refs`)
- [ ] CI-Schritt meldet Fehler, sobald eine `.dll` unter `apps/nina-plugin/` oder `spikes/` versioniert ist
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
~~Die sechs Dateien per `fetch-nina-refs.ps1` bereitstellen (H-14), nach `apps/nina-plugin/refs/` auf den Entwicklungsrechner kopieren~~ (entfällt, ADR-S2c) und die Nachweisprojekte aus `spikes/nina-build/` einmal auf dem Entwicklungsrechner bauen (die vier Befehle aus TK 10.5 greifen erst ab AP-16a, weil `NinaPm.*` noch nicht existiert); Go/No-Go für den Adapter-Build ohne Windows
