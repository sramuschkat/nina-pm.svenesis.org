# Beispielsequenzen (FA-NIN-25)

NINA-Sequenzen (`*.json`) nach der verbindlichen Sequenzvorlage (`docs/specs/nina/execution.md` §1, NT-44), ohne
Gerätewerte. Sie kommen mit den Paketen, die ihre Anweisungen liefern:

| Datei | Sequenz | Paket |
|---|---|---|
| `one-night-safety.json` | Eine Nacht mit Safety | AP-16c (R1) |
| `one-night.json` | Eine Nacht ohne Safety | AP-16c (R1) |
| `multi-night.json` | Mehrere Nächte | AP-52 (R5) |
| `with-flats.json` | mit Flats | AP-50 (R5) |

Auslieferung (AP-16a, TK 4.1/12):

- **Web:** `pnpm deploy:prod` lädt alle `*.json` dieses Ordners mit dem zweiten `BucketDeployment` im Stack
  `NinaPm-Edge` nach `downloads/nina-sequences/<Plugin-Version>/` (Version aus `NinaPm.Nina.csproj`, `prune: false`
  – Sequenzen älterer Versionen bleiben abrufbar). Abruf unter
  `https://nina-pm.svenesis.org/downloads/nina-sequences/<Plugin-Version>/<Datei>`.
- **GitHub-Release:** beim Tag `plugin-v*` packt `plugin.yml` sie als `nina-pm-sequences-<Tag>.zip` dazu.

Diese README wird nicht ausgeliefert.
