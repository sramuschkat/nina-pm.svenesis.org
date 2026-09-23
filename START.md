# Start – Sitzung 1 mit Claude Code

## Schritt 1: Repository anlegen (Sven, H-02)

Privates GitHub-Repository `svenesis-nina-pm`, Branch-Schutz auf `main` (PR + grüne CI), Token für Claude Code mit den Scopes `repo` **und** `workflow`. Dann klonen:

```bash
cd ~/Cursor-AI                 # oder ein anderer Ort deiner Wahl, nicht im Website-Ordner
gh repo create svenesis-nina-pm --private --clone
cd svenesis-nina-pm
```

## Schritt 2: Paket ins Repository kopieren (Sven, zwei Minuten)

Das Paket wird **von Hand** kopiert, nicht von Claude Code – dann liegt `CLAUDE.md` schon im Wurzelverzeichnis, wenn die erste Sitzung startet, und Claude Code liest sie automatisch.

```bash
SRC=~/Claude-CoWork/Svenesis-NINA-PM/claude-code      # Pfad zum entpackten Paket anpassen

cp "$SRC/CLAUDE.md" "$SRC/START.md" "$SRC/THIRD_PARTY_NOTICES.md" .
mkdir -p docs && cp -R "$SRC/docs/." docs/

git add -A && git commit -m "docs: Umsetzungspaket (Fachkonzept, Technisches Konzept, Schema, Specs, Briefs)" && git push
```

Prüfen: `ls` zeigt `CLAUDE.md`, `START.md`, `THIRD_PARTY_NOTICES.md`, `docs/`; `ls docs` zeigt `README.md`, `rules`, `specs`, `contracts`, `seed`, `ops`, `work-packages`, `concept`, `adr`, `history`.

## Schritt 3: Kopiervorlage der Astro-Tools bereitstellen (Sven, H-03)

Stand 21.09.2026 – die Bewertung des Wetters liegt seit diesem Stand in `js/weather-core.js` (WS-19). Nur die Quellen, **nicht** die 132 MB Katalogbilder (die kommen später über H-11 nach S3). Der Ordner ist eine schreibgeschützte Vorlage; die Website selbst wird nie angefasst.

```bash
mkdir -p legacy/astro-tools-2026-09-21
WWW=~/Cursor-AI/www.svenesis.org/astro-tools
cp -R "$WWW/js" "$WWW/data" "$WWW/tools" legacy/astro-tools-2026-09-21/
cp "$WWW"/astro-weather_*.html "$WWW"/observing-planner_*.html legacy/astro-tools-2026-09-21/
cp ~/Cursor-AI/www.svenesis.org/css/style.css legacy/astro-tools-2026-09-21/style.css

cat > legacy/astro-tools-2026-09-21/README.md <<'EOF'
Unveraenderte Kopie der Astro-Tools von www.svenesis.org, Stand 21.09.2026 (WS, Uebernahme 23.09.2026).
Herkunft: www.svenesis.org/astro-tools (js, data, tools, die vier HTML-Seiten) und css/style.css.
Nur Kopiervorlage (AP-01, AP-08b, AP-20, AP-21, TK 8.4, TK 11.3). Nicht aendern, nicht ausliefern.
Nicht kopiert: img/ (132 MB Katalogbilder; kommen ueber H-11 nach S3).
EOF

chmod -R a-w legacy/astro-tools-2026-09-21
git add -A && git commit -m "chore: legacy Astro-Tools als Kopiervorlage (H-03)" && git push
```

## Schritt 4: Claude Code starten und den Prompt einsetzen

```bash
cd ~/Cursor-AI/svenesis-nina-pm
claude
```

Prompt für Sitzung 1 (kopieren):

```
Lies CLAUDE.md, docs/README.md und docs/work-packages/README.md.

Setze dann AP-01 um:
1. Lies docs/work-packages/AP-01.md und nur die dort unter „Lesen" genannten Abschnitte
   (Zeilenbereiche über docs/concept/INDEX.md) – nicht die vollständigen Konzepte.
2. Prüfe in docs/ops/human-tasks.md, ob H-02 und H-03 erledigt sind. legacy/astro-tools-2026-09-21/
   ist vorhanden und schreibgeschützt; wenn nicht, frag nach statt zu improvisieren.
3. Arbeite auf dem Branch ap-01-monorepo und öffne am Ende einen PR mit AP-ID und
   Anforderungs-IDs; ergänze docs/CHANGELOG.md.
4. Setze in docs/work-packages/README.md den Status von AP-01 auf ◐ (☑ setze ich).
5. Nichts deployen, keine Tags, keine Geheimnisse erfragen.

Sag mir am Ende, was im CI noch grün werden muss und was ich als Nächstes tun soll.
```

Danach laufen zwei Schienen parallel. **Plugin-Schiene:** **AP-S2c** (Build-Nachweis ohne Windows) und **AP-S2b** (Spike NINA-Laufzeit) – beide brauchen H-14, siehe den Abschnitt „Plugin: was auf welchem Rechner läuft“. **AWS-Schiene:** **AP-02a** (braucht H-01 und H-04).

## Folgesitzungen (kurz)

```
Lies CLAUDE.md. Nimm das nächste Arbeitspaket mit Status ☐, dessen Abhängigkeiten ☑ sind,
lies dessen Brief und nur die genannten Abschnitte, prüfe blockierende H-Aufgaben und setze es um.
```

## Was wann gebraucht wird

| Aufgabe | Wird gebraucht für | Vorher nötig? |
|---|---|---|
| H-02 Repo, H-03 Astro-Tools | AP-01 | **ja**, sonst kann Sitzung 1 nicht starten |
| H-14 Windows + NINA-Simulatoren, **Referenz-Assemblies** (fünf davon für den Adapter) | AP-S2c, AP-S2b | ja, für die Plugin-Schiene |
| H-01 AWS-Konto (inkl. Lambda-Parallelitäts-Kontingent ≥ 125), H-04 Standard-`cdk bootstrap` | AP-02a | ja |
| H-05 SSM-Parameter, H-09 SNS-Bestätigung | AP-02b | nein – nur für die **Abnahme** von AP-02b |
| H-07 Discord-Anwendung | AP-04a | ja | 
| H-08 Super-User-ID | AP-04a/b | nein – nur für die Abnahme |
| H-12a / H-12b Test-Mandant und -Instanz | AP-04b bzw. AP-16h | nein – nur für die Abnahme |
| H-13 Soll-Pläne abnehmen | Merge von AP-13b und AP-13d | nur für den Merge, nicht für den Start |
| **H-22 DSQL-Spike und `pnpm test:dsql` lokal ausführen** (Sven, Admin-Profil, kurzlebiger Cluster) | AP-S1, AP-03, PRs mit Migrationen | nein – nur für die **Abnahme**; Claude Code liefert Skripte und Tests, Sven gibt das Protokoll zurück |
| **H-19 Beispieldateien Transit-Ergebnisse** | AP-45 | **ja (Startsperre)** |
| Rest (H-06 Deploy, H-16 … H-18, H-20, H-21, H-23, H-24) | Deploys, Abnahmen und Go-live | nein |

Vollständige Liste mit Reihenfolge: `docs/ops/human-tasks.md`.

## Plugin: was auf welchem Rechner läuft

Das NINA-Plugin ist die einzige Stelle, an der ein zweiter Rechner nötig ist. Der Schnitt steht in TK 10.5:

| Was | Entwicklungsrechner (macOS/Linux) | Windows-Rechner (H-14) |
|---|---|---|
| `NinaPm.Core` + `NinaPm.Core.Tests` bauen und testen | ja | ja |
| Adapter `NinaPm.Nina` schreiben und **kompilieren** | ja, mit `refs/` (fünf NINA-Assemblies) | ja |
| `NinaPm.Nina.Tests` kompilieren | ja | ja |
| Adapter-Tests **ausführen** | nein (`net8.0-windows`) | ja |
| `NinaPm.Nina.Ui` (XAML) bauen | nicht eingeplant – das übernimmt der CI (AP-S2c prüft, ob es auch lokal geht) | ja |
| Plugin **ausführen**, Protokolle P-01…P-24 | nein (NINA und ASCOM sind Windows-Programme) | ja |
| `tools/nina-test-server`, `pnpm test-run:check` | ja | ja |

Damit der Adapter ohne Windows kompiliert, brauchst du einmal je NINA-Version die Referenz-Assemblies aus der NINA-Installation – das Paket `NINA.Plugin` enthält sie nicht. Es sind sechs Dateien: fünf NINA-Assemblies (die braucht der Adapter) und `Microsoft.Xaml.Behaviors` (nur für die Ansichten):

```powershell
# auf dem Windows-Rechner, im Repository (H-14)
pwsh tools/fetch-nina-refs.ps1        # legt apps/nina-plugin/refs/nina-<version>/ an
```

```bash
# auf dem Entwicklungsrechner, einmal je NINA-Version
scp -r <windows>:<repo>/apps/nina-plugin/refs/nina-3.1.2 apps/nina-plugin/refs/
```

Die DLLs bleiben außerhalb von Git (`.gitignore`), nur die `README.md` des Ordners wird eingecheckt. `apps/nina-plugin/Directory.Build.props` findet sie und setzt `EnableWindowsTargeting` und `PlatformTarget`, deshalb brauchen die Befehle keine Schalter. Das ist die lokale Abnahme vor jedem Plugin-PR:

```bash
dotnet build apps/nina-plugin/NinaPm.Core
dotnet test  apps/nina-plugin/NinaPm.Core.Tests
dotnet build apps/nina-plugin/NinaPm.Nina
dotnet build apps/nina-plugin/NinaPm.Nina.Tests
```

Die Runde danach: PR → `plugin.yml` baut auf `windows-latest` die vollständige Lösung und legt die ZIP ab → ZIP auf dem Windows-Rechner nach `%LOCALAPPDATA%\NINA\Plugins\3.0.0\Svenesis.NinaPm\` entpacken → Protokoll aus `docs/ops/plugin-test-protocol.md` fahren → `result.json`, `nina.log` und Screenshots nach `docs/test-runs/<JJJJ-MM-TT>/<P-xx>/` committen → auf dem Entwicklungsrechner `pnpm test-run:check <ordner>`; Claude Code liest `logCheck` und repariert.

**AP-S2c** weist diesen Build-Weg an Minimalprojekten nach, bevor die Plugin-Pakete darauf bauen, und liefert `Directory.Build.props`, `tools/fetch-nina-refs.ps1` und die CI-Aufträge. Trägt er nicht, fällt der Adapter auf reines CI-Bauen zurück und nur `NinaPm.Core` bleibt lokal.

## Umgebung
Welche Prüfungen lokal laufen und welche nur im CI, steht in `CLAUDE.md` (Abschnitt „Umgebung“). Kurz: alles ohne Docker, Browser, Python und AWS läuft lokal, DSQL-Tests und Deploy führt nur Sven aus – **.NET 8 inklusive**, bis auf WPF und das Ausführen des Plugins (siehe oben); der Rest wird über den PR im CI geprüft (`gh run view --log-failed`).

## Regeln für den Start
- Keine Geheimnisse erfragen; SSM-Parameter nur mit Namen verwenden (H-05).
- Website www.svenesis.org, deren Repo und CloudFront-Distribution `E2L6Q80SD8XPT0` nie anfassen.
- `cdk bootstrap`, `pnpm deploy:prod` und die DSQL-Läufe macht **nur** Sven lokal mit seinem Admin-Profil (H-04, H-06, H-22); Claude Code nie. GitHub hat keinen AWS-Zugang.
- Widersprüche: Brief > specs/contracts > rules > Technisches Konzept > Fachkonzept; als Issue melden.
