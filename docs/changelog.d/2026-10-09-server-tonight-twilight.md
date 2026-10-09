### Web und Server: Dämmerungen auf „Heute Nacht“, Rig-Zustand 12 h, ruhigeres Log (2026-10-09)

Anforderungen: S-02, S-43 (FA-RIG-17), TK 5.6.

- **„Heute Nacht“, Kachel „Dunkel“:** Unter der astronomischen Dunkelzeit steht eine kleine Tabelle mit Sonnenunter- und -aufgang sowie bürgerlicher, nautischer und astronomischer Dämmerung für Abend und Morgen, in Standortzeit.
  - Weicht die Zeitzone des Geräts ab, steht darunter gedämpft die eigene Zeit, an einem anderen Kalendertag mit „+1“ bzw. „−1“.
  - Gibt es in der Nacht keinen Durchgang (Polarnähe), steht „–“.
  - Der Server rechnet die Zeiten mit derselben Engine wie Nachtfenster und Dunkelheit (`TonightRig.twilight`).
- **Rig-Zustand** öffnet mit den letzten **12 h** statt 24 h. Der Standard steht nicht in der Adresse.
- **NINA-Instanzen:** „Zuletzt gesehen“ wird nur noch für wirklich alte Einträge geschrieben. Ein Konflikt mit einer gleichzeitigen Anfrage derselben Instanz wird still übergangen, statt als Warnung `nina_touch_failed` im Lambda-Log zu landen (09.10.2026, einzige Warnung in 12 h).
- AP-68 (Plugin 0.4.20) abgenommen (Sven, 09.10.2026).
