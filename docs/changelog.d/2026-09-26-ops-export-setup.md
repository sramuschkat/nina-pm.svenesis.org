### Betrieb – Export des Test-Mandanten für Auswertungs-Demodaten (2026-09-26)

Anforderungen: TK 5.4 (ops-cli), Vorbereitung Auswertungs-Demo (Entscheidung Sven, 26.09.2026)

- Neuer `ops-cli`-Befehl **`export-setup`** (`{"command":"export-setup","tenant":"test"}`):
  - Er liest nur und ist nur für den Test-Mandanten zulässig; andere Schlüssel lehnt er ab.
  - Er liefert Standorte, Teleskope, Kameras, Filter, Mondprofile, Rigs mit Filterrad und Scheduler, Projekte mit Panels, Zeilen, Bedingungen und Zählern sowie NINA-Instanzen (ohne Token).
  - Dazu die Mengen der vorhandenen Auswertungsdaten: Zeilen je Tabelle, Nachtpläne je Herkunft, Nachtspanne und Sessions je Rig.
  - Keine Mitgliedsnamen und keine Geheimnisse. Wie jeder `ops-cli`-Aufruf steht er im System-Audit.
- **`pnpm demo:export`** (nur Sven, Admin-Profil) prüft das AWS-Konto, ruft den Befehl per `aws lambda invoke` auf und legt das JSON unter `docs/test-runs/<Datum>/demo-evaluation/test-tenant-export.json` ab.
- Die Auswertungs-Demodaten selbst (Löschen und 90 Nächte erzeugen) folgen in einem eigenen PR auf Basis dieses Exports.
