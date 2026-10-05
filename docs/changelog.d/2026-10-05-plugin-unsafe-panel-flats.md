### NINA-Plugin 0.4.4: Panel-Flats auch bei „unsicher“

- **Regel H2 geändert (Entscheidung Sven 05.10.2026):** Bleibt es bis zum Ende der Dunkelheit unsicher, etwa weil das Dach in Starfront schon zur Dämmerung schließt, laufen die **Panel**-Flats trotzdem, bevor die Anweisung *Warten bis sicher oder Nachtende* die Nacht abschließt. Das Panel braucht keinen Himmel. Nur Himmelsflats verlangen weiter „sicher“. Vorher wurden alle ausstehenden Flats übersprungen.
- Ein Abbruch während dieser Flats (wieder sicher, Sequenz gestoppt, NINA beendet) lässt die Kombination offen; sie wird später fortgesetzt.
- Neuer kopfloser Lauf `starfront-roof-flats`: Das Dach schließt vor dem Ende der Dunkelheit und bleibt zu, die Panel-Flats laufen, danach `finished reason=unsafe`. Spec `execution.md` §4.6 und Rig-Checkliste angepasst.
- Gefunden mit dem VM-Lauf `vm-flats` vom 05.10.2026: Beim geordneten Beenden von NINA meldet der getrennte Safety-Monitor „unsicher“, und die restlichen Flats entfielen.
