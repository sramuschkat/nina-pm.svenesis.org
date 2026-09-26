# AP-26c – Rahmen: Kopf, Filterleisten, Seitenleiste, Startseite

**Release:** UI-Überarbeitung (vor R3) · **Größe:** S · **Abhängigkeiten:** AP-26b · **Menschliche Aufgaben:** –

## Ziel
Mehr Platz für Inhalte und ein Einstieg, der den Stand zeigt (`../ui/bestandsaufnahme-2026-09-26.md` §3).

## Liefern
- **Kopfleisten:** Website- und App-Leiste zusammen niedriger. Ob die Website-Leiste beim Scrollen einklappt, entscheidet Sven vor dem Start.
- **Filterleisten** (Projektliste, Warteschlange, Objektbrowser): eine Zeile mit Chips („Rig: A ×“); weitere Filter aufklappbar; *Gelöscht* als Filter statt Reiter.
- **Seitenleiste:** unter 1024 px eingeklappt (nur Symbole), per Knopf aufklappbar.
- **Startseite als Übersicht:** Warteschlange (offen, meine Stimme fehlt), aktive Projekte je Rig mit Fortschritt, Wetter heute je Standort, letzte Sessions; *Heute Nacht* folgt mit AP-35.

## Automatisierte Abnahme
- [ ] Seitentests, axe, 768/2400 px
- [ ] CI grün, Changelog-Eintrag

## Menschliche Freigabe
Sichtabnahme Sven
