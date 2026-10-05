### NINA › Hilfe: Abschnitte „Nachtende“ und „Dithern“

- **Nachtende** – wann die Nacht vorbei ist:
  - Ende der Dunkelheit laut Plan, gebildet aus dem spätesten Dämmerungsdurchgang der Projekte der Nacht; ohne Dunkelheit das Sessionende (Nachtfensterende = bürgerliche Morgendämmerung + 1 h);
  - Tabelle, welche Dämmerung das Nachtende bestimmt (nur Deep-Sky → astronomisch, mit Exoplanet → nautisch, bürgerlich, weiße Nacht → Sessionende);
  - was dann der Reihe nach passiert: letzte Belichtung, Flats, Abschluss, Ende-Bereich;
  - wie *NINA-PM Wait until Safe or Night End* damit umgeht, und der Sonderfall weiße Nacht.
- **Dithern** – warum NINA-Dither-Trigger unterdrückt werden:
  - eingeplante Settle-Zeit;
  - Dithern nur zwischen Belichtungen desselben Ziels;
  - kein Dithern im Transit;
  - nur eine Stelle für die Einstellung;
  - Unterdrücken statt Verbieten.
- Die Bausteine (*NINA-PM Instructions*, *Night Loop*, *Wait until Safe or Night End*) und die Grundregeln verlinken auf die neuen Abschnitte. Die Hilfe ist auf Deutsch und Englisch, Stand Plugin 0.4.0.
- Hilfe-Abschnitte können eine Tabelle enthalten (`SequencerHelpSection.table`, Anzeige über `DataTable`); die Markdown-Anzeige kennt keine GFM-Tabellen.
