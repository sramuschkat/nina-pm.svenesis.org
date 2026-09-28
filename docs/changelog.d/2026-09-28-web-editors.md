### Web-Editoren: keine verlorenen Änderungen, Koordinaten erst bei Übernahme (Prüfung 28.09.2026)

Anforderungen: FA-PRJ-01/13, FA-BPL-05, FA-RIG-14, FA-STO-01/05, FA-KAM-04, FA-MAN-05, FA-SIM-09; components.md §2.6

- **Projekt-Editor und Rigs speichern gegen ihre Basis.** Der Entwurf merkt sich die Fassung, auf der er beruht, und sendet deren Version im `If-Match`. Vorher wurde gegen die zuletzt nachgeladene Fassung verglichen und mit deren Version gespeichert – nach dem Neuladen beim Fensterfokus setzte Speichern fremde Änderungen still zurück. Eine neuere Fassung wird jetzt in den Entwurf übernommen, soweit sich die Änderungen nicht überschneiden; ändern beide dasselbe Feld, erscheint der Hinweis „Neu laden“ und der Server antwortet mit 412.
- **Koordinatenfeld übernimmt erst beim Verlassen oder mit Enter.** Teilwerte je Tastendruck landen nicht mehr im Entwurf (Standort „9° 8′ W“ wurde als +9,13 Ost gespeichert) und lösen in der Panel-Liste kein PATCH je Taste aus. Ungültiger Text bleibt mit Fehler stehen, Standorte sperren dann *Speichern*. Breite und Länge verstehen N/S bzw. E/O/W. Durchtabben der Panel-Rotation schreibt keinen gerundeten Wert mehr.
- **Standorte:** Eine offene Remote-Verbindung gehört zu ihrem Standort und wird beim Wechsel verworfen (vorher wurde sie mit dem neuen Standort gespeichert). Zeitzonen wie „UTC“, „Asia/Kolkata“ und „Europe/Kyiv“ gelten als gültig (Prüfung wie der Server statt `Intl.supportedValuesOf`), ebenso in den Mandanteneinstellungen.
- **Mandantenwechsel** verwirft den Cache des vorigen Mandanten; Stammdatenseiten behandeln ein gewähltes Objekt, das nicht mehr in der Liste steht, als nicht gewählt.
- **Rigs:** Nach dem Speichern werden Filterrad und Übernahmestatus neu geladen – das Filterrad schickte sonst die alte Einstellungsversion (falsches 412).
- **Projektliste:** Mit aktivem Filter zeigt die Priorität den echten Rang im Rig, und *nach oben/unten* rückt an den Platz des sichtbaren Nachbarn (vorher Position innerhalb der gefilterten Liste).
- **Belichtungsplan:** „Vorlage auf alle Panels“ fragt nach, sobald irgendein Panel Zeilen hat.
- **Kameras:** Umbenennen oder Entfernen von Auslesemodi und Abwählen von Binning-Stufen halten den Standard gültig (Umbenennen folgt, sonst erster gültiger Wert).
