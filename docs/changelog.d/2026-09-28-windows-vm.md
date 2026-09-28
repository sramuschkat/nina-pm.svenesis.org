### Anleitung: Windows-VM auf dem Mac für NINA (H-14) (2026-09-28)

- Neu `docs/ops/windows-vm.md`: H-14 Schritt für Schritt als Windows-11-ARM-VM in VMware Fusion auf dem Entwicklungs-Mac. Die Anleitung umfasst:
  - VM-Einstellungen, TPM und Einrichtung ohne Netzwerk;
  - NINA 3.2 mit abgeschalteten Updates, ASCOM Platform 7 mit Simulatoren und PHD2-Simulator;
  - NINA-Profil mit Standort Texas, Filternamen wie im Web, Flip und trainierten Flats;
  - Versionsabgleich `NINA.Sequencer.dll` gegen `NinaVersion` (ADR-S2c);
  - Plugin laden, Test-Server auf dem Mac über NAT erreichen, Snapshots und Update-Reihenfolge.
- Grenze aus TK 10.5: Die VM trägt alle Protokolle, Zeitmessungen gelten nur auf x64 (Rig).
