# Kopfloser Nachtlauf mit Rig-Zeiten – 05.10.2026

`pnpm plugin:sim real-rig-newmoon real-rig-fullmoon`: je zwei ganze Starfront-Nächte gegen den echten Server mit virtueller Uhr. Laufzeit etwa 35 s je Lauf.

- **Ziele:** echte Ziele der Jahreszeit (NGC 7000, M 31, M 45, M 42 …) à 300 s, Gain/Offset 125/50.
- **Ausführung im Simulator (Starfront-Logs):** Slew + Zentrieren 35 s, Dither je Aufnahme 18 s, NINAs *Autofokus nach Zeit* alle 60 min mit 210 s, Flip 250 s mit 5 min Pause vor dem Meridian.
- **Rig-Einstellungen im Server:** Flip frühestens 5, spätestens 10 min nach dem Meridian; Slew 40 s, Filterwechsel 10 s, AF 60 min / 210 s, Download 3 s.

## Ergebnis – alle vier Nächte grün

| Nacht | Lights | im Erstplan | belichtet von der Spanne erste–letzte Aufnahme |
|---|---|---|---|
| 09./10.10. (Neumond) | 90 | 97 (93 %) | 79 % |
| 10./11.10. | 93 | 99 (94 %) | 82 % |
| 24./25.10. (Vollmond) | 96 | 103 (93 %) | 83 % |
| 25./26.10. | 99 | 106 (93 %) | 84 % |

In allen vier Nächten grün:
- Sessions abgeschlossen, Outbox leer, Zähler gleich Lights;
- Abschluss- und Bericht-Job erledigt, Discord-Meldungen angekommen;
- Nacht 1 endet mit der astronomischen Dämmerung, danach Flats;
- Nacht 2 beginnt mit der Dunkelheit;
- Pläne nur für diese beiden Nächte.

Prüfungen des echten Servers (`rigTimes`):
- **Plan = Ausführung:** je Nacht mindestens 90 % der im Erstplan geplanten Aufnahmen.
- **Keine Lücke über 30 min zwischen zwei Aufnahmen.**

## Wo die Zeit verloren geht (70–95 min Pausen je Nacht, ohne Dither)

1. **Meridian-Flip: 16–23 min.** Davon sind etwa 10 min Warten: 5 min Pause vor dem Meridian und Flip frühestens 5 min danach. Läuft NINAs Autofokus direkt danach, sind es bis zu 28 min. Ursache sind die NINA-Einstellungen am Rig. Erlaubt die Montierung einen kleineren Abstand nach dem Meridian, spart das etwa 5–8 min je Flip.
2. **Zielwechsel: 8–13 min je Wechsel.** Der neue Block beginnt erst an der nächsten 5-min-Slotgrenze. Danach wartet das Plugin bis zur geplanten ersten Belichtung (`WAIT_PLAN`), weil der Plan Zeit für Slew und Autofokus reserviert, die NINA an dieser Stelle oft nicht braucht.
3. **6–7 Aufnahmen je Nacht weniger als geplant.** NINAs Autofokus-Zeitpunkte und die `autofocus_hint` des Plans fallen nicht immer zusammen.

## Folgearbeit (Engine, nach der ersten Rig-Nacht)

Etwa 20–30 min mehr Belichtung je Nacht sind möglich durch:
- **Freigegebene Slots im selben Plan neu anbieten** (allocation.md §8.6 Nr. 7).
- **Kein `slew_center`,** wenn der erste Block einer Neuplanung dasselbe Ziel fortsetzt (`currentUnitId`).
- **Block direkt nach dem vorigen beginnen** statt an der Slotgrenze.
