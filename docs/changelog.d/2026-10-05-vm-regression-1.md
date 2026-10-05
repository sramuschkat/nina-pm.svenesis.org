### VM-Prüfstand: Absturz-Wächter, Standort zurücksetzen; Protokolle `vm-smoke` und `vm-flip`

- **Absturz-Wächter:** Verschwindet NINA mitten im Lauf, holt der Prüfstand die Windows-Ereignisse (`app-events.txt`), bricht ab und wiederholt den Lauf einmal. Hintergrund: Abstürze der x64-Emulation in der VM (`AccessViolationException` in `coreclr.dll`), zuletzt beim ersten `vm-smoke` am 05.10.
- **Standort zurücksetzen:** Nach `real`-Läufen schreibt der Prüfstand den vorherigen Standort ins NINA-Profil zurück, damit die folgenden Test-Server-Läufe nicht mit dem gestauchten Standort prüfen.
- **Protokolle** der VM-Regression mit Plugin 0.4.0: `vm-smoke` (Grundablauf, Safety, Kühlung, Dither) und `vm-flip` (Flip, Zentrieren, kein Nachrotieren). Beide **Go**.
- **Neue Läufe gegen den echten Server:** `real-full-night` (Starfront-Nacht mit LRGB/SHO, Flats nach der nautischen Dämmerung), `real-network` (Netzausfall) und `real-flip` (Meridian-Flip ohne Rotator wie Starfront). Die Montierung übernimmt in allen Läufen beim Verbinden den Profilstandort, damit NINA zur geplanten Zeit flippt.
- **Testbilder:** Vor jedem Lauf löscht der Agent die Datumsordner im Bildordner (`clean-images`); die Simulator-Kamera hatte mit Transitserien die VM gefüllt.
