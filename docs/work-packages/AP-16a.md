# AP-16a – Plugin: Lösung, Core, Kopplung, NINA-Test-Server

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-S2b, AP-S2c, AP-08c, AP-14a · **Menschliche Aufgaben:** H-14, H-15

## Ziel
Die Plugin-Lösung mit testbarem Kern, lokalem SQLite-Speicher und Kopplung steht. Der NINA-Test-Server macht alle weiteren Plugin-Tests tagsüber möglich.

## Anforderungen
FA-NIN-01, FA-NIN-03, FA-NIN-19

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §2 (Nacht-Schlüssel und Zeitzonen, NT-05), §8–9
- TK 10.1–10.2, 10.5
- TK 4.1 (`NinaPm-Edge`), TK 12 (Beispielsequenzen), TK 18 (`plugin.yml`)
- contracts/nina/README.md
- ops/plugin-test-protocol.md (Ablauf, `result.json`, P-04)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `NinaPm.sln` mit den **fünf** Projekten aus TK 10.1/10.5 – hier neu angelegt werden vier davon auf Basis von `Directory.Build.props` und `refs/` aus AP-S2c: `NinaPm.Core` (net8.0: Abstraktionen `ISequenceHost`/`ICameraControl`/`IMountControl`/`IFilterWheelControl`/`IRotatorControl`, ApiClient aus `openapi.yaml` per NSwag, Optionsmodell, `LocalStore` SQLite `ninapm.db` mit Tabellen laut execution.md §8, Logging `NINA-PM | EVENT key=value`; **Zeittypen (NT-05):** Zeitpunkte als `DateTimeOffset` in UTC, `night` als `string`/`DateOnly`, Uhr über ein injiziertes `IClock`, `Microsoft.CodeAnalysis.BannedApiAnalyzers` verbietet `DateTime.Now`, `DateTime.Today`, `TimeZoneInfo.Local` und `ToLocalTime` in `NinaPm.Core` und `NinaPm.Nina` (einzige Ausnahme: SiteCheck-Hinweis `pc_timezone_differs`, AP-16f), NSwag erzeugt `format: date` als `string`, Newtonsoft mit `DateTimeZoneHandling.Utc` und Ausgabe mit `Z`, SQLite speichert ISO-UTC-Strings; **Token verschlüsselt ablegen** per `ProtectedData`/DPAPI mit Geltungsbereich `CurrentUser` und **nie** in Logs, Diagnoseausgaben oder Fehlermeldungen – SV-08), `NinaPm.Nina` (net8.0-windows **ohne eigene XAML-Datei**: Plugin-Manifest, MEF-Export, Adapter-Gerüst) `NinaPm.Nina.Tests` (net8.0-windows: Gerüst für die Adapter-Tests, Attrappen der NINA-Mediatoren) und `NinaPm.Nina.Ui` (net8.0-windows mit WPF und XAML: Optionsseite *Verbindung testen*); das Testprojekt `NinaPm.Core.Tests` **existiert schon aus AP-08c** und wird hier nur erweitert (CC5-16)
- Ausgabe-Eigenschaften der beiden Plugin-Projekte nach TK 10.5 (`Append*`, `GenerateDependencyFile`, `GenerateRuntimeConfigurationFiles` auf `false` **in den Projektdateien**), `Debug`-`OutputPath` nur unter Windows; von NINA mitgebrachte Pakete (`System.ComponentModel.Composition`, `Newtonsoft.Json`) nur mit `ExcludeAssets runtime`
- `tools/nina-test-server` (Node): NINA-API mit Plänen relativ zu „jetzt“ (Blöcke ab now + 2 min, Flip-Ziel mit `RA_J2000 = LST + n min − (α_app − α_J2000)` (NT-35), Transitfenster), Header `X-NPM-Test: 1`, Szenario-Dateien (`one-night`, `replan`, `replan-transit`, `transit`, `flip`, `delay`, `night-end`, `flats`, `multi-night`, `lease`, `mosaic-flip`, `transit-flip`, `current-night`, `safety`), `POST /test/actions` mit allen Aktionen der Tabelle in `ops/plugin-test-protocol.md` (inkl. `lease_release`, `rig_busy`, `revoke_token`, `clear`) und `GET /test/report`
- `plugin.yml` vollständig nach TK 18: Aufträge `refs` und `build` auf `windows-latest`, `cross-build` auf `ubuntu-latest` (Grundzüge aus AP-S2c, hier auf die echte Lösung gezogen); beim Tag `plugin-v*` gehen ZIP und Beispielsequenzen als **GitHub-Release-Asset** hinaus – `plugin.yml` hat keinen AWS-Zugang (E1)
- Beispielsequenzen nach S3: **zweites `BucketDeployment`** im Stack `NinaPm-Edge` aus dem Repository-Ordner der Sequenzen nach `downloads/nina-sequences/<pluginVersion>/` (`prune: false`), das mit dem nächsten lokalen `pnpm deploy:prod` läuft (TK 4.1, 12); das SPA-Deployment berührt `downloads/` nicht

## Nicht im Umfang
- Ausführung

## Automatisierte Abnahme
- [ ] Core-Tests grün (Linux, macOS lokal, Windows im CI)
- [ ] `dotnet build` von `NinaPm.Nina` **und** `NinaPm.Nina.Tests` grün im Auftrag `cross-build`, ohne zusätzliche `-p:`-Schalter – der Adapter bleibt ohne Windows baubar
- [ ] keine XAML-Datei in `NinaPm.Nina` (CI-Prüfung)
- [ ] ZIP-Inhalt geprüft: `Jint`, `Microsoft.Data.Sqlite`, `Polly` enthalten, keine NINA-Assembly und kein `Newtonsoft.Json` (TK 10.5)
- [ ] ApiClient gegen `nina-test-server` (Integrationstest)
- [ ] LocalStore-Migrationstest
- [ ] BannedApiAnalyzers: `DateTime.Now` in `NinaPm.Core` bricht den Build (Fehler, nicht Warnung)
- [ ] JSON-Rundreise: Zeitpunkte mit `Z`, `night` bleibt `YYYY-MM-DD`, SQLite-Werte als ISO-UTC
- [ ] CDK-Assertion: das zweite `BucketDeployment` schreibt nur unter `downloads/nina-sequences/` und mit `prune: false`
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-04
