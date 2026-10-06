### CI: Läufe gegen den echten Server parallel (2026-10-06)

- Die vier kopflosen Läufe gegen den echten Server (`real-dst`, `real-dst-spring`, `real-upgrade`, `real-all-done`) laufen im neuen Auftrag `plugin-sim-real` als Matrix auf je einem eigenen Runner statt nacheinander im Auftrag `plugin-sim`. Ein Plugin-PR wartet damit etwa 2½ statt 7 min auf diese Prüfung. Die Ergebnisse liegen als Artefakte `plugin-sim-<Lauf>` bereit.
