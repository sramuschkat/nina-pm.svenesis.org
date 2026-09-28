# apps/nina-plugin

C#-Lösung des NINA-Plugins (TK 10.1, 10.5). Kein pnpm-Paket.

| Projekt | Ziel | Inhalt |
|---|---|---|
| `NinaPm.Core` | `net8.0` | plattformneutrale Logik, Engine über Jint |
| `NinaPm.Core.Tests` | `net8.0` | xUnit, läuft auf macOS, Linux und Windows |
| `NinaPm.Nina` | `net8.0-windows` | NINA-Adapter, ohne eigene XAML-Datei |
| `NinaPm.Nina.Tests` | `net8.0-windows` | Adapter-Tests, ausgeführt nur auf `windows-latest` |
| `NinaPm.Nina.Ui` | `net8.0-windows` (WPF) | XAML-Ansichten |

Die Lösung entsteht mit AP-16a; AP-S2c hat den Build-Weg nachgewiesen (`spikes/nina-build/`, `docs/adr/ADR-S2c-build.md`). Übersetzt wird gegen die NuGet-Pakete `NINA.*` in der Version `NinaVersion` aus `Directory.Build.props` (jetzt 3.2.0.9001, passend zu NINA 3.2 auf dem Rig). Jedes Projekt mit NINA-Bezug bindet `NINA.Plugin` mit `IncludeAssets="compile"` ein, ausgeliefert wird keine NINA-Assembly. `tools/nina-build-check.sh apps/nina-plugin` prüft Paketversionen und Ausgabe. Alle fünf Projekte bauen auf macOS und Linux; nur die Adapter-Tests und das Plugin selbst laufen ausschließlich auf Windows.
