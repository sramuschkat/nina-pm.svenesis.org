# Stufe 2b: kurzer Lauf gegen prod

Ein VM-Lauf gegen `https://nina-pm.svenesis.org` mit dem Test-Mandanten (**Svenesis-Texas-Rig**). Er prüft, was die lokalen `real-*`-Läufe nicht abdecken:
- CloudFront;
- Aurora DSQL mit Konflikt-Wiederholung;
- die Lambda-Grenzen;
- die Zeitpläne in AWS (`tick-5min`: Abschluss, Bericht, verwaiste Sessions);
- echtes Discord.

Die Nacht wird wie bei den `real-*`-Läufen über die **Daten** gestaucht: Der Standort steht vorübergehend so, dass die Dunkelheit etwa 30 min nach dem Start endet.

Dauer: etwa 15 min Vorbereitung im Web, 45–50 min Lauf, 10 min Prüfen und Rückbau.

**Wichtig:** Der Test-Mandant ist der Mandant des echten Rigs. Am Rig läuft noch Astro PM, darum sind die Änderungen am Standort für eine Stunde unkritisch. Sie müssen aber danach vollständig zurückgestellt werden (Abschnitt 4).

## 1. Vorher (Claude Code)

- VM bereit: `pnpm vm-bench status` zeigt Agent, NINA und Advanced API. Das Prod-Profil der VM gibt es seit P-05 (`prodProfileId` in der Prüfstand-Konfiguration, Token von Sven eingetragen). Plugin 0.4.4 ist installiert.
- Standort und Ziel für die geplante Startzeit ausrechnen, Start 10–15 min nach dem Ausrechnen:

  ```bash
  pnpm vm-bench prod-site --start 2026-10-06T08:00:00Z
  ```

  Die Ausgabe nennt:
  - Breite, Länge, Höhe und Zone für den Standort;
  - das Ende der Dunkelheit;
  - RA/Dec für das Testprojekt.

  Außerdem schreibt der Befehl die Laufdatei `.vm-bench/prod-short.json` mit demselben Standort fürs NINA-Profil. Die Montierung übernimmt ihn beim Verbinden.

## 2. Im Web (Sven), direkt vor dem Start

Im Mandanten **Svenesis-Texas-Rig**:

1. **Alte Werte notieren** (für den Rückbau):
   - Standort Starfront: Breite, Länge, Höhe, Zone `America/Chicago`;
   - Rig-Einstellungen Flats und Nachtbericht.
2. **Andere Projekte pausieren:** Alle aktiven Projekte des Rigs auf *Pausiert* setzen. Sonst plant der Server sie mit ein, und Simulator-Aufnahmen landen in den Zählern echter Projekte.
3. **Standort Starfront** (*Ausrüstung › Standorte*): Breite, Länge, Höhe und Zone aus `prod-site` eintragen. Eine Warnung zur Länge passt hier nicht, denn Länge und Zone sind stimmig.
4. **Kamera** (*Ausrüstung › Kameras*): Auslesemodus `normal1` ergänzen. Die Simulator-Kamera der VM kennt nur `normal1`/`normal2`, sonst entfällt jeder Block mit `readout_mode_not_found`.
5. **Testprojekt** anlegen:
   - Name „Bench prod“, RA/Dec aus `prod-site`;
   - Zeilen L 12 × 30 s und Ha 12 × 30 s, Auslesemodus `normal1`, Gain/Offset leer;
   - freigeben, *Aktiv*, Rig Texas.
6. **Rig** (*Ausrüstung › Rigs*):
   - Flats an, Quelle Panel, Anzahl 3, Dark-Flats an mit 2, Auto-Flats aus;
   - Nachtbericht nach Discord an;
   - Rotator aus.
7. Unter *NINA › An NINA ausgeliefert* steht nur „Bench prod“.

## 3. Lauf (Claude Code)

```bash
pnpm vm-bench run .vm-bench/prod-short.json
```

Ablauf:
- NINA startet mit dem Prod-Profil, das Plugin holt Plan und Session von prod.
- Nach etwa 30 min endet die Dunkelheit; es folgen Flats mit Panel, Abschluss und Nachtbericht.
- Der Prüfstand endet, sobald das Plugin `SESSION status=finished` meldet. Danach wartet er 3 min auf die Outbox und wertet das NINA-Log aus. Grün heißt:
  - keine `ERROR`-Zeile;
  - keine vom Server abgelehnte Anfrage;
  - Outbox leer;
  - Flat-Panel geschaltet.
- Danach setzt der Prüfstand den Standort im NINA-Profil und an der Montierung zurück.

## 4. Prüfen und Rückbau (Sven, Claude Code liest mit)

**Prüfen im Web:**

| Wo | Erwartet |
|---|---|
| *Sessions* | Session der Nacht `completed`, Outbox 0, Zähler „Bench prod“ = gespeicherte Lights |
| Session-Details | Flat-Kombinationen L und Ha `done`, Dark-Flat-Gruppe `done` |
| Discord | Nachtbericht im Kanal, höchstens etwa 10 min nach dem Abschluss (Zeitplan `tick-5min`) |
| *NINA › NINA-Instanzen* | Prod-Instanz der VM mit Plugin 0.4.4; keine Einstellungswarnung außer der erwarteten zum Flip, falls das Rig andere Flip-Werte hat |
| Benachrichtigungen | keine Alarme außer erwarteten (siehe oben) |

**Rückbau (vollständig, in dieser Reihenfolge):**
1. Standort Starfront auf die notierten Werte zurück (31,55° N / 99,38° W, `America/Chicago`, Höhe).
2. Testprojekt „Bench prod“ archivieren oder löschen.
3. Kamera: Auslesemodus `normal1` entfernen.
4. Rig-Einstellungen (Flats, Nachtbericht) auf die notierten Werte bzw. auf die Werte aus `rig-first-night.md` §1.
5. Pausierte Projekte wieder auf *Aktiv*.
6. Testdaten aus P-05 (03.10.2026) gleich mit aufräumen:
   - Sh2-132: RGB-Zeilen mit `normal1`, je 10 Simulator-Aufnahmen; Korrektur „verworfen“ in der Session 03./04.10.;
   - HA: 4 Aufnahmen, Herkunft prüfen;
   - RGB-Zeilen ohne `normal1` neu anlegen und die alten löschen.

Protokoll: `docs/test-runs/<Datum>/stage-2b-prod/` mit NINA-Log, `summary.json`, Screenshots und dieser Prüfliste mit Ergebnis.
