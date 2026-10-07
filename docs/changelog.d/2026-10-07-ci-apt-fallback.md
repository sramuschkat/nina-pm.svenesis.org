### CI: Ausweichspiegel für die Chromium-Systempakete (2026-10-07)

- Der Azure-Ubuntu-Spiegel der GitHub-Runner hing heute dreimal (`Ign: azure.archive.ubuntu.com …`). E2E-Shards brachen nach zwei Versuchen ab, bevor ein Test lief.
- Ab jetzt läuft der zweite Versuch von `playwright install-deps` ohne den Azure-Eintrag in der Spiegelliste `/etc/apt/apt-mirrors.txt`, also über `archive.ubuntu.com`.
