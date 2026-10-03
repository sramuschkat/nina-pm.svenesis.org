### Kopflose Starfront-Szenarien aus echten Nächten, Heartbeat vor dem ersten Plan

Anforderungen: FA-NIN-09/10/12/21, FA-SYN-07; execution.md §4.2, §4.6, §6; flip-rotation.md §2

- **Vier neue Läufe** (`pnpm plugin:sim`). Sie beruhen auf 21 NINA-Logs und dem NINA-Profil des Rigs in Starfront (gemessen 03.10.2026, Logs nicht im Repository):
  - `starfront-night`: Rig-Werte auf den gemessenen Medianen. Plan und Nacht stimmen überein (54/54).
  - `starfront-night-untuned`: die bisherigen Rig-Werte. Die Planuhr verschiebt sich, es gibt keine Sprünge (57 geplant, 55 aufgenommen).
  - `starfront-roof`: Dach beim Start zu, dann offen, vor dem Ende der Dunkelheit wieder zu.
  - `starfront-center-fails`: Zentrieren scheitert für ein Ziel, das nächste Ziel läuft pünktlich.
- **Test-Server:**
  - Overhead- und Flip-Werte des Rigs je Szenario (`scheduler`).
  - Die Pause vor dem Meridian stoppt Belichtungen vor `tM − pause` und wartet bis zum Flip (flip-rotation.md §2, `limitEnd`).
- **Simulation:** Dither-Settle, Dauer von Slew und Zentrieren, scheiterndes Zentrieren je Ziel und Safety beim Start sind einstellbar.
- **Behoben:** Der Heartbeat meldet die eigene Engine-Version auch vor dem ersten Bootstrap.
  - Bisher stand dort bis zum ersten Plan ein leerer Wert, und jeder Heartbeat wurde mit `422` abgelehnt.
  - In Starfront wäre das der ganze Nachmittag, solange NINA vor dem Sequenzstart läuft. Das erklärt auch die zwei 422 im VM-Lauf vom 03.10.2026.
