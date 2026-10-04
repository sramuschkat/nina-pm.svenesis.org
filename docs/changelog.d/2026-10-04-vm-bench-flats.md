### VM-Prüfstand: Flat-Läufe `vm-flats` und `vm-flats-auto` (AP-50/AP-50b)

- **Zwei kurze Läufe** statt vier Protokollläufen (≈ 45 min statt 4–5 h): `vm-flats` deckt P-12 und P-35 ab, `vm-flats-auto` P-38.
- **Prüfstand-Sequenz mit Flat-Boxen:** *Je Kombination* mit *Trained Flat Exposure* und *Trained Dark Flat Exposure* (*Keep Panel Closed*).
- **Agent-Auftrag `set-trained-flats`:** schreibt trainierte Belichtungen je Filterposition und Binning ins Prüfstand-Profil (mit Sicherung); der Lauf prüft, dass NINA sie geladen hat – kein Training von Hand.
- **Schritt `restartAfterLog`:** NINA-Neustart, sobald eine Log-Zeile zum n-ten Mal (verschieden) erscheint, danach Geräte und Sequenz wieder an (P-12: Neustart in der 2. Flat-Kombination).
- **Test-Server:** Szenario-Optionen `flats.count` und `flats.onRecord` (vorhandene Flats je Projekt ohne zweite Nacht); Szenarien `vm-flats`, `vm-flats-auto` mit kopflosen Gegenstücken und benannten Prüfungen.
