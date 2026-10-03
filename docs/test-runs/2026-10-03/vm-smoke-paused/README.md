# VM-Prüfstand `vm-smoke` mit Live-Status „Paused – unsafe“ – 03.10.2026

Plugin lokal gebaut (`dotnet publish -r win-x64`, wie der CI-Auftrag `build`; `nina-zip-check` grün), Branch `ap-16h-live-paused`. Lauf über den VM-Prüfstand, ohne Handgriff. Auswertung: **alle sieben Prüfungen grün** (`vm-check.txt`).

`safety-pause.png`:
- Während der Safety-Pause zeigt der Live-Status **„Paused – unsafe“** statt „Waiting“, abgeleitet aus demselben Zustand wie Heartbeat `paused`.
- Daneben „Next block 14:09“ (Standortzeit), rotes Testbetrieb-Banner, Outbox-Zähler; Sicherung läuft, *Is Safe* rot.

Der Lauf endete erstmals vorzeitig, 60 s nach der abgeschlossenen Session (#224).
