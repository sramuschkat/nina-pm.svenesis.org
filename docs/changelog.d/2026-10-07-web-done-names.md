### Web: „Heute Nacht abgearbeitet“ mit Projektname; laufendes Projekt nicht als abgearbeitet (2026-10-07)

Anforderungen: FA-SIM-10; Rig-Nacht 06./07.10.2026 (WASP-3b, IC 1795)

- In „Plan für diese Nacht“ fehlte bei abgearbeiteten Projekten der Name. Der Server lieferte nur Namen von Projekten in der Eingabe; WASP-3b nach dem Transit stand dort nicht mehr. Jetzt lädt das Ist der Nacht die Namen aller belichteten Projekte nach (`projectNames`, auch Blocktitel im Plugin-Simulator).
- Simulator: IC 1795 stand um 05:33 CDT als „Heute Nacht abgearbeitet“ da, obwohl die Rig noch SII aus dem gespeicherten Plan belichtete. Die Rechnung ab jetzt teilte nichts mehr zu. Ein Projekt mit laufendem Ist-Block oder einem noch nicht beendeten Block im gespeicherten Plan gilt jetzt als „läuft noch“, auch in „Plan für diese Nacht“.
