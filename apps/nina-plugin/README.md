# apps/nina-plugin

C#-Lösung des NINA-Plugins (TK 10.1, 10.5). Kein pnpm-Paket.

| Projekt | Ziel | Inhalt |
|---|---|---|
| `NinaPm.Core` | `net8.0` | plattformneutrale Logik, Engine über Jint |
| `NinaPm.Core.Tests` | `net8.0` | xUnit, läuft auf macOS, Linux und Windows |
| `NinaPm.Nina` | `net8.0-windows` | NINA-Adapter, ohne eigene XAML-Datei |
| `NinaPm.Nina.Tests` | `net8.0-windows` | Adapter-Tests, ausgeführt nur auf `windows-latest` |
| `NinaPm.Nina.Ui` | `net8.0-windows` (WPF) | XAML-Ansichten |

Die Lösung entsteht mit AP-S2c (Build-Nachweis, `Directory.Build.props`, `tools/fetch-nina-refs.ps1`, `plugin.yml`) und AP-16a. `refs/nina-<version>/` enthält die NINA-Referenz-Assemblies aus H-14; die DLLs werden nie committet, nur die `README.md` je Version.
