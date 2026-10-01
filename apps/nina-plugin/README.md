# apps/nina-plugin

C#-Lösung des NINA-Plugins (TK 10.1, 10.2, 10.5), `NinaPm.sln`. Kein pnpm-Paket.

| Projekt | Ziel | Inhalt (Stand AP-16a) |
|---|---|---|
| `NinaPm.Core` | `net8.0` | plattformneutral: Abstraktionen (`IMountControl`, `ICameraControl`, `IFilterWheelControl`, `IRotatorControl`, `ISequenceHost`), Uhr `IClock` und `UtcText` (NT-05), Log-Grammatik `NINA-PM \| EVENT key=value`, Optionen und `ITokenProtector`, API-Client (NSwag beim Build aus `docs/api/openapi.nina.json`) mit *Verbindung testen*, `LocalStore` (SQLite `ninapm.db`, Tabellen nach `execution.md` §8) |
| `NinaPm.Core.Tests` | `net8.0` | xUnit, läuft auf macOS, Linux und Windows: Jint-Parität (AP-08c), LocalStore-Migration, JSON-Rundreise mit den Vertragsbeispielen, Log-Grammatik, Optionen, Verbindungstest |
| `NinaPm.Nina` | `net8.0-windows` | NINA-Adapter **ohne XAML**: Plugin-Manifest (`NinaPmPlugin`), Optionen je NINA-Profil, Token per DPAPI (`CurrentUser`), Log-Senke in NINAs Log, Export der Ansichten, Adapter-Gerüst |
| `NinaPm.Nina.Tests` | `net8.0-windows` | Adapter-Tests (Manifest, DPAPI, Optionsseite), ausgeführt nur auf `windows-latest` |
| `NinaPm.Nina.Ui` | `net8.0-windows` (WPF) | XAML: Optionsseite `NINA-PM_Options`, Texte DE/EN |

Übersetzt wird gegen die NuGet-Pakete `NINA.*` in der Version `NinaVersion` aus `Directory.Build.props` (3.2.0.9001, ADR-S2c). Mitgeliefert werden nur eigene Assemblies und `Jint`, `Microsoft.Data.Sqlite` (mit `e_sqlite3.dll` flach im Plugin-Ordner) und `Polly`; `Newtonsoft.Json` und `System.ComponentModel.Composition` bringt NINA mit.

## Lokal prüfen (macOS, Linux)

```bash
dotnet build apps/nina-plugin/NinaPm.Core
dotnet test  apps/nina-plugin/NinaPm.Core.Tests
dotnet build apps/nina-plugin/NinaPm.Nina
dotnet build apps/nina-plugin/NinaPm.Nina.Tests
dotnet build apps/nina-plugin/NinaPm.Nina.Ui
tools/nina-build-check.sh --allow Jint,Acornima,Microsoft.Data.Sqlite,SQLitePCLRaw.batteries_v2,SQLitePCLRaw.core,SQLitePCLRaw.provider.e_sqlite3,e_sqlite3,Polly,Polly.Core apps/nina-plugin
tools/nina-banned-api-check.sh
```

Die Paritätstests in `NinaPm.Core.Tests` brauchen vorher `pnpm engine:bundle && pnpm engine:parity`. Zeitregel: `DateTime.Now`, `DateTime.UtcNow`, `TimeZoneInfo.Local` und `ToLocalTime` sind in Kern und Adapter verboten (`BannedSymbols.txt`) – die Uhr kommt über `IClock`.

## Auf dem Windows-Rechner (H-14)

Aus dem CI: Artefakt `nina-pm-plugin` (Auftrag *build* in `plugin.yml`) nach `%LOCALAPPDATA%\NINA\Plugins\3.0.0\Svenesis.NinaPm\` entpacken, NINA neu starten. Oder dort selbst bauen: `dotnet build -c Debug apps\nina-plugin\NinaPm.Nina` schreibt direkt in den Plugin-Ordner.
