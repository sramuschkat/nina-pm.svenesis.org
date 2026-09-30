### Projektliste: gleiche Spalten in allen Status-Ansichten (2026-09-30)

Anforderungen: S-30, FA-PRJ-19, components.md §2.11/EffortChip · Frage Sven 30.09.2026 („warum haben Projekte vor der Freigabe andere Spalten als über alle oder freigegeben?“)

- Ursache: die Tabelle blendet Spalten nach Platz aus. Vor der Freigabe machten der Kommentar der Freigabe (Statusspalte 105 → 335 px) und „· wird aktualisiert“ am Aufwand (170 → 264 px) die Tabelle breiter – „Plan je Filter“ fiel weg; unter „Alle“ kamen die Prioritätspfeile hinzu.
- **Kommentar der Freigabe** nimmt keinen Platz mehr ein: so breit wie das Status-Badge, Rest mit „…“, voller Text im Tooltip und in der aufklappbaren **Detailzeile**.
- **Aufwand-Kennzeichen** in Tabellengröße: „wird aktualisiert“ als Symbol mit Tooltip (Projektliste, Warteschlange); in normaler Größe unverändert als Text.
- **DataTable:** `stableColumns` (Projektliste) – beim Filtern keine Spalte wieder einblenden, nur bei neuer Breite; ohne die Option rechnet die Tabelle bei jedem Wechsel der Zeilen neu (vorher nur bei anderer Anzahl). `renderDetail` darf je Zeile `null` liefern (dann nur mit ausgeblendeten Spalten aufklappbar).
- Tests: DataTable (Detail je Zeile, Neuberechnung und `stableColumns`), EffortChip (`sm` mit Symbol); lokal gemessen bei 1440 px: Alle, vor der Freigabe und freigegeben mit denselben Spalten.
