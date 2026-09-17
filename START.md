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

Nur die Quellen, **nicht** die 132 MB Katalogbilder (die kommen später über H-11 nach S3). Der Ordner ist eine schreibgeschützte Vorlage; die Website selbst wird nie angefasst.

```bash
mkdir -p legacy/astro-tools-2026-09-17
WWW=~/Cursor-AI/www.svenesis.org/astro-tools
cp -R "$WWW/js" "$WWW/data" "$WWW/tools" legacy/astro-tools-2026-09-17/
cp "$WWW"/astro-weather_*.html "$WWW"/observing-planner_*.html legacy/astro-tools-2026-09-17/
cp ~/Cursor-AI/www.svenesis.org/css/style.css legacy/astro-tools-2026-09-17/style.css

cat > legacy/astro-tools-2026-09-17/README.md <<'EOF'
Unveraenderte Kopie der Astro-Tools von www.svenesis.org, Stand 17.09.2026.
Herkunft: www.svenesis.org/astro-tools (js, data, tools, die vier HTML-Seiten) und css/style.css.
Nur Kopiervorlage (AP-01, AP-08b, AP-20, AP-21, TK 8.4, TK 11.3). Nicht aendern, nicht ausliefern.
Nicht kopiert: img/ (132 MB Katalogbilder; kommen ueber H-11 nach S3).
EOF

chmod -R a-w legacy/astro-tools-2026-09-17
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
2. Prüfe in docs/ops/human-tasks.md, ob H-02 und H-03 erledigt sind. legacy/astro-tools-2026-09-17/
   ist vorhanden und schreibgeschützt; wenn nicht, frag nach statt zu improvisieren.
3. Arbeite auf dem Branch ap-01-monorepo und öffne am Ende einen PR mit AP-ID und
   Anforderungs-IDs; ergänze docs/CHANGELOG.md.
4. Setze in docs/work-packages/README.md den Status von AP-01 auf ◐ (☑ setze ich).
5. Nichts deployen, keine Tags, keine Geheimnisse erfragen.

Sag mir am Ende, was im CI noch grün werden muss und was ich als Nächstes tun soll.
```

Danach in dieser Reihenfolge: **AP-S2b** (Spike NINA-Laufzeit, braucht H-14: Windows-Rechner mit NINA-Simulatoren – läuft parallel zur AWS-Schiene), dann **AP-02a** (braucht H-01 und H-04).

## Folgesitzungen (kurz)

```
Lies CLAUDE.md. Nimm das nächste Arbeitspaket mit Status ☐, dessen Abhängigkeiten ☑ sind,
lies dessen Brief und nur die genannten Abschnitte, prüfe blockierende H-Aufgaben und setze es um.
```

## Was wann gebraucht wird

| Aufgabe | Wird gebraucht für | Vorher nötig? |
|---|---|---|
| H-02 Repo, H-03 Astro-Tools | AP-01 | **ja**, sonst kann Sitzung 1 nicht starten |
| H-14 Windows + NINA-Simulatoren | AP-S2b | ja, für den Plugin-Spike |
| H-01 AWS-Konto, H-04 `cdk bootstrap` mit `NinaPmDeployBoundary` | AP-02a | ja |
| H-05 SSM-Parameter, H-09 SNS-Bestätigung | AP-02b | ja |
| **H-25 `db-bootstrap` einmalig aufrufen** | AP-03 (erste Migration) | ja – ohne diesen Lauf bricht `migrate` mit `db.bootstrap_missing` ab |
| H-07 Discord-Anwendung, H-08 Super-User-ID | AP-04a/b | ja |
| H-12a / H-12b Test-Mandant und -Instanz | AP-04b bzw. AP-16h | ja |
| H-13 Soll-Pläne abnehmen | Merge von AP-13b und AP-13d | nur für den Merge, nicht für den Start |
| Rest (H-16 … H-24, H-26) | Abnahmen und Go-live | nein |

Vollständige Liste mit Reihenfolge: `docs/ops/human-tasks.md`.

## Umgebung
Welche Prüfungen lokal laufen und welche nur im CI, steht in `CLAUDE.md` (Abschnitt „Umgebung“). Kurz: alles ohne Docker, .NET, Browser, Python und AWS läuft lokal; der Rest wird über den PR im CI geprüft (`gh run view --log-failed`).

## Regeln für den Start
- Keine Geheimnisse erfragen; SSM-Parameter nur mit Namen verwenden (H-05).
- Website www.svenesis.org, deren Repo und CloudFront-Distribution `E2L6Q80SD8XPT0` nie anfassen.
- `cdk bootstrap` und `cdk deploy` macht **nur** Sven (H-04, H-06); Claude Code nie.
- Widersprüche: Brief > specs/contracts > rules > Technisches Konzept > Fachkonzept; als Issue melden.
