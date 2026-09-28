# spikes/nina-build – Nachweis: Plugin ohne Windows bauen (AP-S2c)

Minimalprojekte, die den Build-Weg aus TK 10.5 belegen, bevor die echten Projekte in AP-08c/AP-16a entstehen. Ergebnis und Entscheidung: `docs/adr/ADR-S2c-build.md`.

| Projekt | Ziel | Nachweis |
|---|---|---|
| `Core` + `Core.Tests` | `net8.0` | (a) Kern ohne NINA, Tests laufen auf macOS, Linux und Windows |
| `Adapter` | `net8.0-windows`, `UseWPF`, ohne XAML | (b) Erbe von `SequenceItem`, Mediatoren aus `NINA.Equipment` und `NINA.WPF.Base`, MEF-Export – gegen `NINA.Plugin` aus NuGet |
| `AdapterNoWpf` | `net8.0-windows` ohne `UseWPF` | (c) dieselben Typen ohne `UseWPF` |
| `Ui` | `net8.0-windows`, WPF mit XAML | (d) Markup-Compiler ohne Windows |

```bash
dotnet test  spikes/nina-build/Core.Tests
dotnet build spikes/nina-build/Adapter
dotnet build spikes/nina-build/AdapterNoWpf
dotnet build spikes/nina-build/Ui
tools/nina-build-check.sh spikes/nina-build
```

Keine zusätzlichen `-p:`-Schalter: `apps/nina-plugin/Directory.Build.props` setzt `NinaVersion`, `EnableWindowsTargeting` und `PlatformTarget`. Die Projekte sind kein Produktivcode und entfallen, sobald AP-16a die echte Lösung anlegt.
