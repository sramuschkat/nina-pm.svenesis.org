# AP-26b – Seitenaufbau: Reiter statt Scrollen, Projekt-Editor in drei Bereichen

**Release:** UI-Überarbeitung (vor R3) · **Größe:** M · **Abhängigkeiten:** AP-26a · **Menschliche Aufgaben:** –

## Ziel
Arbeitsseiten zeigen weniger gleichzeitig: Inhalte liegen auf Reitern statt untereinander (Wunsch Sven, 26.09.2026). Der Projekt-Editor folgt der Aufteilung des Astro-PM-Plugins (Screenshots von Sven, 26.09.2026) – nur als Vorbild für die Anordnung, ohne Name oder Logo (CLAUDE.md Nr. 14).

## Anforderungen
FK 14.3 (S-31, S-10, S-40, S-70), `../ui/bestandsaufnahme-2026-09-26.md` §2/§3.3/§3.5

## Liefern
- **Projekt-Editor S-31 – drei Bereiche auf etwa einer Bildschirmhöhe**, jeder mit eigenen Reitern und eigener Scrollfläche:
  1. **Kopf:** Brotkrumen *Projekte › Name*; rechts Rig, Projektstatus, *Speichern* (Hauptaktion), *Duplizieren*, *Löschen* bzw. Freigabe-Aktionen.
  2. **Oberer Bereich**, Reiter:
     - *Ziel*: Katalogsuche, Name, Typ, Startdatum, Zieltermin, RA/Dec, Rotation, Bildfeld; *Aus Sternkarte laden*, *Mosaik bearbeiten*.
     - *Bedingungen*: Mindesthöhe, Mindestzeit, Dämmerung, Mondvermeidung mit Profil.
     - *Bild & Notizen* mit Unterreitern *Vorschaubild* (Bildfeld bzw. Katalogbild, daneben Standort, Teleskop, Kamera, Maßstab, Bildfeld, Recherche-Links), *Himmelslage* (kleine Übersichtskarte mit Zielmarke), *Notizen*, *Freigabe-Verlauf*.
  3. **Mittlerer Bereich**, Reiter: *Nachtdiagramm* (mit Nachtwahl und Standortzeit) · *Saisondiagramm* · *Wetter*.
  4. **Unterer Bereich**, Reiter: je Panel einer (*Panel 1*, *Panel 2*, …) mit dem Belichtungsplan des Panels (Eingabezeile zum Hinzufügen, Vorlage) · *Panels* (Liste, Reihenfolge, aktiv, Mosaik).
- **Rigs:** Reiter *Allgemein* · *Ausrüstung* · *Scheduler* · *Filterrad* · *NINA*.
- **Nacht-Simulator:** Ergebnis zuerst, Einstellungen einklappbar.
- **Mitglieder:** Liste im Mittelpunkt; *Einladen* und *Owner übertragen* als Dialog, offene Einladungen als Reiter.
- **Ausrüstung:** ein Listen-/Detail-Muster für alle Arten (Liste links, Detail rechts).
- **Seitenkopf:** Titel links, Hauptaktion rechts, auf allen Arbeitsseiten gleich.

## Automatisierte Abnahme
- [ ] Seitentests angepasst (Reiter, Tastatur, axe), keine Funktion entfällt
- [ ] Projekt-Editor bei 1280 × 800: Kopf und alle drei Reiterleisten ohne Scrollen sichtbar
- [ ] CI grün, Changelog-Eintrag

## Menschliche Freigabe
Sichtabnahme Sven (Projekt-Editor, Rigs, Simulator)
