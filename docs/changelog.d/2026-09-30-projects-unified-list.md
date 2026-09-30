### Projekte: eine Liste mit Status-Chips statt vier Ansichten (2026-09-30)

Anforderungen: S-30, S-32, S-33, S-34, FA-PRJ-19, FA-FRG-13, FA-FRG-15, FA-BER-02 · Wunsch Sven 30.09.2026 („nicht einheitliche Darstellung, nicht einfach nach Status zu filtern und deren Anzahl zu sehen“), Variante B

- **Zwei Reiter** statt vier: *Projekte* und *Warteschlange*. „Meine Objekte“ und „Entwürfe“ entfallen als eigene Seiten; die alten Adressen leiten weiter (`/projekte/meine-objekte` → `/projekte?meine=1`, `/projekte/entwuerfe` → `/projekte?status=draft,returned`).
- **Status-Chips mit Anzahl** unter der Filterleiste: *Alle* sowie je Status ein Umschalter – vor der Freigabe Entwurf, Eingereicht, Zurückgegeben, Abgelehnt; danach Planung … Archiv. Mehrfachauswahl; die Anzahl zählt mit allen übrigen Filtern (Suche, *Meine*, Rig …). Ersetzt die beiden Auswahllisten *Freigabestatus* und *Projektstatus*.
- **Ein Status je Projekt** über die ganze Lebensdauer (ein Badge statt zwei), gleiche Farbe wie die Chips.
- Schalter **Alle / Meine** in der Filterleiste; **Gruppieren** *je Rig* (wie bisher, mit Priorität), *je Status* oder *keine*. Status, *Meine* und Gruppierung stehen in der Adresse.
- Aus „Meine Objekte“ übernommen: **Kommentar der Freigabe** unter dem Status bei zurückgegebenen bzw. abgelehnten Projekten; **Einreichen** im ⋯-Menü der Zeile (öffnet den Dialog im Editor, `?einreichen=1`); Rangliste der eigenen Einreichungen als Reiter **Meine Rangfolge** der Warteschlange. Aus „Entwürfe“: Spalte **Zuletzt geändert**.
- Fachkonzept (FA-PRJ-19, FA-FRG-13/15, FA-PRJ-23, Navigation, S-30, S-32/S-34) und `components.md` angepasst.
- Tests: Modell (Status, Anzahl, Gruppen, Adresse), Komponenten (Chips, *Meine*, Gruppierung, Kommentar, *Einreichen*, *Meine Rangfolge*), E2E `project-views.spec.ts` (ersetzt `my-objects.spec.ts`).
