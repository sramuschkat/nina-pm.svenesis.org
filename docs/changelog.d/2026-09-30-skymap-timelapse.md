### Sternkarte: Zeitraffer statt Echtzeitlauf (2026-09-30)

Anforderungen: FA-FRM-11 (Spec-Ergänzung 30.09.2026) · Frage Sven „was macht der Abspielen-Button?“

- **Abspielen** lässt die Zeit im Zeitraffer laufen, **Standard 10 min/s**. Eine Nacht dauert gut eine Minute: Sternbilder gehen auf, das Ziel kulminiert, der Mond wandert, die Dämmerung blendet mit dem Taghimmel.
  - Bisher lief die Zeit in Echtzeit (1 s je Sekunde) und die Karte bewegte sich praktisch nicht.
- **Geschwindigkeit** neben dem Knopf wählbar: Echtzeit, 1 min/s, 10 min/s, 1 h/s. Die Wahl merkt sich der Browser.
- **Ende der Nacht:** Am Ende des Nachtfensters hält der Lauf an. Erneutes Abspielen beginnt am Anfang der Nacht.
- **Gleichmäßiger Takt:** Der Taktgeber läuft durch und baut auf der zuletzt gesetzten Zeit auf. Vorher setzte jedes Neuzeichnen der Karte den Takt zurück; gemessen läuft 10 min/s jetzt mit rund 10 min/s statt 5.
- **FK FA-FRM-11:** „Echtzeitlauf“ wird „Zeitraffer mit wählbarer Geschwindigkeit“.
- **Tests:** Zeitraffer mit simulierter Uhr (Standard, Wechsel auf 1 h/s, Anhalten); Halt am Nachtende (`playStep`).
