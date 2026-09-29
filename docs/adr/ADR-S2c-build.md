# ADR-S2c – Plugin ohne Windows bauen: NuGet statt Referenz-Assemblies

| | |
|---|---|
| Status | vorgeschlagen (angenommen mit dem Merge des PR durch Sven) |
| Datum | 2026-09-28 |
| Arbeitspaket | AP-S2c |
| Anforderungen | TK 10.1, 10.5, 18 · NFA (Wartbarkeit) |

## Kontext
TK 10.5 plant, den NINA-Adapter `NinaPm.Nina` auf macOS und Linux gegen **Referenz-Assemblies** zu übersetzen: fünf NINA-DLLs, die `tools/fetch-nina-refs.ps1` auf dem Windows-Rechner aus H-14 aus der NINA-Installation kopiert und die auf den Entwicklungsrechner übertragen werden (`apps/nina-plugin/refs/nina-<version>/`). Grund war, dass das NuGet-Paket `NINA.Plugin` damals nur einen Teil der Assemblies lieferte.

Am 28.09.2026 zeigte sich beim ersten Build auf dem Entwicklungsrechner (MacBook Air M4, macOS, .NET SDK 8.0.425 arm64): **`NINA.Plugin` 3.2.0.9001 zieht alle fünf Adapter-Assemblies als eigene NuGet-Pakete nach.** Das Rig in Texas läuft mit NINA 3.2 (Sven, 28.09.2026). Damit entfällt die Kopie vom Windows-Rechner.

## Geprüft
Alle Versuche auf macOS arm64 mit .NET SDK 8.0.425, ohne Windows-Dateien und ohne `-p:`-Schalter. Nachweisprojekte unter `spikes/nina-build/`, derselbe Build im CI auf `ubuntu-latest` und `windows-latest` (`plugin.yml`).

| Punkt | Befehl / Versuch | Ergebnis |
|---|---|---|
| Inhalt von `NINA.Plugin` 3.2.0.9001 | `dotnet restore`, Abhängigkeiten laut `nina.plugin.nuspec` | ✔ `NINA.Sequencer`, `NINA.Equipment`, `NINA.WPF.Base`, `NINA.PlateSolving`, `NINA.Image` sowie `NINA.Core`, `NINA.Profile`, `NINA.Astrometry`, alle in 3.2.0.9001; Lizenz MPL-2.0 (`LICENSE.txt` im Paket) |
| (a) Kern `net8.0` | `dotnet test -c Release spikes/nina-build/Core.Tests` | ✔ 2/2 Tests |
| (b) Adapter `net8.0-windows`, `UseWPF`, ohne XAML: Erbe von `SequenceItem`, `IFilterWheelMediator` (NINA.Equipment), `IApplicationStatusMediator` (NINA.WPF.Base), `PluginBase` mit MEF-Export | `dotnet build -c Release spikes/nina-build/Adapter` | ✔ 0 Fehler, 0 Warnungen (**Frage 1 aus TK 10.5**) |
| (c) dieselben Quellen ohne `UseWPF` | `dotnet build -c Release spikes/nina-build/AdapterNoWpf` | ✔ baut, auch ohne `FrameworkReference` (**Frage 2**) |
| (d) WPF mit XAML (`UserControl` mit Code-Behind, `ResourceDictionary` mit Options-Template) | `dotnet build -c Release spikes/nina-build/Ui` | ✔ der Markup-Compiler läuft ohne Windows (**Frage 3**) |
| Ausgabe | `IncludeAssets="compile"` an `NINA.Plugin` | ✔ nur eigene DLLs. Mit `ExcludeAssets="runtime"` (TK 10.5) landen dagegen `Microsoft.Web.WebView2.*` und `runtimes/*/native/WebView2Loader.dll` in der Ausgabe: WebView2 kopiert über `build`-Targets, nicht über `runtime` |
| `PlatformTarget` aus TK 10.5 | Bedingung `'$(TargetFramework)' == 'net8.0-windows'` in `Directory.Build.props`, `dotnet msbuild -getProperty:PlatformTarget` | ✘ leer: `Directory.Build.props` wird **vor** dem Projekt gelesen, `TargetFramework` ist dort noch nicht gesetzt. In `Directory.Build.targets` ✔ `x64` |
| Warnung NU1701 | Restore von `NINA.Plugin` | NINA zieht `ToastNotifications` und `VVVV.FreeImage` (.NET Framework) nach. Nicht übersetzungsrelevant, nicht ausgeliefert → `NoWarn NU1701` für `net8.0-windows` in `Directory.Build.targets` |
| Versionsgleichheit | `tools/nina-build-check.sh spikes/nina-build`, Gegenprobe mit `-p:NinaVersion=3.1.2.9001` | ✔ meldet jede abweichende `NINA.*`-Version (ausgenommen `NINA.Accord.*`, NINAs Accord-Abspaltung mit eigener Nummer) und jede fremde DLL in der Ausgabe; Gegenprobe mit `ExcludeAssets="runtime"` meldet die WebView2-DLLs |
| Orakel `tools/astropm-oracle` | `pnpm oracle:run tools/astropm-oracle/grids docs/contracts/golden-plans --random 20 --seed 1 --repeat 2` | ✔ 60/60 Grids, keine Orakelfehler, beide Läufe identisch |

## Entscheidung
Die Plugin-Projekte übersetzen gegen die **NuGet-Pakete `NINA.*`** in der Version `NinaVersion` aus `apps/nina-plugin/Directory.Build.props` (jetzt `3.2.0.9001`). Jedes Projekt mit NINA-Bezug bindet `NINA.Plugin` mit `Version="$(NinaVersion)"` und `IncludeAssets="compile"` ein. Ausgeliefert wird keine NINA-Assembly und nichts, was NINA mitbringt. Die Plugin-Assembly trägt `MinimumApplicationVersion = $(NinaVersion)` (`AssemblyMetadata`), damit NINA sie nicht in einer älteren Version lädt.

Es gibt **keinen** Ordner `refs/` und kein `fetch-nina-refs.ps1` mehr. Vom Ziel-Framework abhängige Eigenschaften (`PlatformTarget`, `NoWarn NU1701`) stehen in `Directory.Build.targets`. `tools/nina-build-check.sh` prüft nach jedem Build:
- dass alle `NINA.*`-Pakete in `NinaVersion` aufgelöst sind;
- dass die Ausgabe nur eigene DLLs enthält;
- dass keine DLL im Git liegt.

`NinaPm.Nina.Ui` baut ebenfalls ohne Windows. Nur die Adapter-Tests **ausführen** und das Plugin **laufen lassen** bleiben Windows vorbehalten.

## Folgen
- **Versionsabgleich erledigt:** Sven hat am 28.09.2026 in der Windows-VM (H-14) die Dateiversion von `NINA.Sequencer.dll` geprüft: 3.2.0.9001 = `NinaVersion`.
- **TK 10.1, 10.5, 18** (`docs/concept/Technisches_Konzept_Svenesis-NINA-PM.md`): Referenz-Assemblies durch NuGet ersetzt; Snippet mit `Directory.Build.targets`; Tabelle „ohne Windows“ mit `NinaPm.Nina.Ui` = ja; `plugin.yml` ohne Auftrag `refs`. Als Spec-Ergänzung gekennzeichnet.
- **`CLAUDE.md`** (Umgebung, Befehle, Regel 13), **`START.md`** (Plugin-Abschnitt), `docs/specs/nina/execution.md` (Aufteilung), `docs/ops/human-tasks.md` (H-14 ohne DLL-Kopie), `docs/work-packages/AP-S2c.md` und `AP-16a.md`, `apps/nina-plugin/README.md`, `THIRD_PARTY_NOTICES.md`, `.gitignore`.
- **H-14** wird für AP-S2c nicht mehr gebraucht, weiter aber für AP-S2b und die Laufzeit (NINA 3.2 mit Simulatoren, z. B. in einer Windows-11-VM auf dem Mac).
- **Neues Risiko: Versionsbindung.** Ein NINA-Update auf dem Rig ohne passendes `NinaVersion` führt zu Ladefehlern oder falschen Signaturen. Deshalb: `NinaVersion` nur zusammen mit dem Update anheben; H-15 hält die NINA-Version in jedem Protokoll fest. Die Prüfung, ob die DLLs aus NuGet mit denen der Installation übereinstimmen, macht Sven einmal je Version auf dem Windows-Rechner (Dateiversion `NINA.Sequencer.dll` = `NinaVersion`).
- Offen für AP-16a: ZIP-Inhaltsprüfung auf die echte Lösung ziehen (`--allow Jint,Polly,Microsoft.Data.Sqlite…`), Debug-Ausgabe in den NINA-Plugin-Ordner nur unter Windows.

## Alternativen
- **Referenz-Assemblies aus der Installation (bisher TK 10.5):** abgelehnt. Das NuGet-Paket liefert seit 3.2 dieselben fünf Assemblies. Die Kopie brauchte einen Windows-Rechner vor dem ersten Build, ein Skript und einen CI-Auftrag, der NINA installiert.
- **`ExcludeAssets="runtime"` wie in TK 10.5:** abgelehnt. WebView2 landet über `build`-Targets trotzdem in der Ausgabe; `IncludeAssets="compile"` schließt alles außer dem Übersetzen aus.
- **Nur im CI bauen (Rückfallebene aus START.md):** unnötig, der lokale Build trägt vollständig.
