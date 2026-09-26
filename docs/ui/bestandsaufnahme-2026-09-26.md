# UI-Bestandsaufnahme (26.09.2026, Stand nach R2)

Grundlage für das UI-Paket vor R3. Geprüft im lokalen Stand (`main` d1acc03) mit Beispieldaten (7 Projekte in verschiedenen Zuständen, 2 Rigs), als Owner, bei 1280 × 800 und 768 px, hell und dunkel. Messwerte per Skript im Browser: Seitenhöhe in Bildschirmen (800 px), Spaltenzahl und horizontaler Überhang je Tabelle, Anzahl Formularfelder. Wünsche von Sven vorab: **Tabellen per Klick auf den Spaltenkopf sortieren**, **weniger Information gleichzeitig – mehr auf Reiter verteilen**.

## 1. Tabellen

**1.1 Sortierung.** Von 34 Tabellen (28 Dateien) ist genau **eine** sortierbar – die Warteschlange S-33, mit einer eigenen Lösung (Knöpfe im Kopf, `queue-model.ts`). Der Objektbrowser sortiert über eine Auswahlliste *Sortierung*, alle übrigen gar nicht.

**1.2 Horizontales Scrollen trotz breitem Fenster.** Die Tabellen liegen in Scroll-Containern; bei 1280 px laufen diese über:

| Bildschirm | Tabelle | Spalten | Überhang bei 1280 px | bei 768 px |
|---|---|---|---|---|
| Projekt-Editor S-31 | Belichtungsplan | 17 | 421 px | – |
| Warteschlange S-33 | Einreichungen | 14 | 400 px | – |
| Objektbrowser S-21 | Treffer | 12 | 379 px | – |
| Filter | Filterliste | 9 | 291 px | – |
| Projektliste S-30 | je Rig eine Tabelle | 9 | 206 px / 69 px | **678 px** / 541 px |
| Kameras | Auslesemodi, Gain | 6 / 4 | 56 / 46 px | – |

Die Bausteinregel (components.md §1: „nicht umbrechen, sondern Inhalt reduzieren – niemals horizontal scrollen“) gilt bisher nur für Bausteine, nicht für Seitentabellen.

**1.3 Hohe Zeilen.** Filter-Chips im Plan stehen untereinander (drei Zeilen je Projekt), der Status zeigt zwei Abzeichen übereinander, Namen brechen um. In der Projektliste hat jede Rig-Gruppe eine eigene Tabelle mit **eigenen Spaltenbreiten** – die Spalten der Gruppen fluchten nicht.

**Vorschlag:** ein gemeinsamer Baustein **`DataTable`** (neuer Vertrag in components.md):
- Sortieren per Klick auf den Spaltenkopf: auf-, absteigend, aus; `aria-sort`; stabil; Zustand in der URL.
- Kopfzeile bleibt beim Scrollen stehen.
- Spalten mit **Priorität**: bei wenig Platz verschwinden die unwichtigen, statt dass die Tabelle scrollt. Die ausgeblendeten Werte stehen in einer aufklappbaren Detailzeile.
- Optional Spaltenauswahl und eine **kompakte Zelldarstellung** (Plan als eine Zeile „Ha 40×300 · O 30×300 · S +1“, Tooltip mit allen).
- Gruppen (Projektliste je Rig) als Zwischenüberschriften **in einer** Tabelle, damit die Spalten fluchten.

Alle Tabellen stellen darauf um; die Warteschlange gibt ihre Eigenlösung auf.

## 2. Zu viel auf einer Seite – Reiter statt Scrollen

| Bildschirm | Höhe | Felder | Befund | Vorschlag |
|---|---|---|---|---|
| **Projekt-Editor S-31** | 3,6 Bildschirme | 62 | zwei Reiterleisten übereinander (*Ziel/Bedingungen/Vorschau* und *Diagramme/Wetter/Notizen/Verlauf*), darunter immer Panels und Belichtungsplan | **eine** Reiterleiste: *Übersicht* (Ziel, Vorschaubild, Kennzahlen) · *Bedingungen* · *Belichtungsplan* (Panels + Plan) · *Diagramme* (Nacht + Saison) · *Wetter* · *Notizen* · *Verlauf*; Kopf mit Name, Status, Speichern bleibt stehen |
| **Rigs** | 4,5 Bildschirme | 55 | 14 Abschnitte untereinander (Rotation, Standort/Teleskop/Kamera, Kennzahlen, Scheduler mit 5 Unterabschnitten, Filterrad, NINA-Status) | Reiter *Allgemein* · *Ausrüstung* · *Scheduler* · *Filterrad* · *NINA* |
| **Objektbrowser S-21** | 10 Bildschirme | 14 | großer Filterblock vor den Treffern, lange Trefferliste | Suche + 3 Hauptfilter sichtbar, Rest unter *Weitere Filter*; 25 Treffer je Seite; Sortierung über Spaltenköpfe statt Auswahlliste |
| **Nacht-Simulator S-40** | 2,8 Bildschirme | 28 | Scheduler-Einstellungen vor dem Ergebnis | Ergebnis zuerst, Einstellungen in einer einklappbaren Seitenleiste oder als Reiter |
| **Projektliste S-30** | 2 Bildschirme | 7 | zwei Reiterebenen (*Projektliste/Meine Objekte/…* und *Projekte/Gelöscht*), Filterblock mit 6 Auswahllisten nimmt bei 768 px den halben Bildschirm | Filter als **eine Zeile** mit Chips („Rig: A ×“), *Gelöscht* als Filter statt Reiter |
| **Mitglieder** | 1,8 Bildschirme | 7 | 4 Abschnitte (Einladen, Mitglieder, offene Einladungen, Owner übertragen) | Liste im Mittelpunkt; *Einladen* und *Owner übertragen* als Dialog, offene Einladungen als Reiter |
| Kameras, Filter | 2,5–2,8 | 25–33 | Formular + Tabellen untereinander | mit dem einheitlichen Listen-/Detail-Muster (3.3) erledigt |

## 3. Rahmen und Einheitlichkeit

**3.1 Zwei Kopfleisten.** Website-Leiste (64 px) plus App-Leiste (46 px) – der Inhalt beginnt bei 110 px, bei 800 px Fensterhöhe sind das 14 %. Dazu die Fußleiste mit Dichte-Schalter. **Vorschlag:** Website-Leiste schlanker bzw. beim Scrollen einklappen, App-Leiste mit Mandant, Glocke und Benutzer bleibt.

**3.2 Startseite veraltet.** Text „Die Fachbereiche … folgen mit den nächsten Ausbauschritten“, nur eine Kachel *Projektliste*. **Vorschlag:** Übersicht mit Kacheln *Heute Nacht* (ab AP-35), *Warteschlange* (offene Einreichungen, meine Stimme fehlt), *aktive Projekte* je Rig mit Fortschritt, *Wetter heute* (Farbband je Standort), *letzte Sessions*.

**3.3 Ausrüstung uneinheitlich.** Drei Muster für dieselbe Aufgabe:
- *Rigs*: Auswahlliste oben, Formular darunter.
- *Mondprofile*: Liste links, Detail Mitte, Erklärung rechts.
- *Standorte/Teleskope/Kameras*: Tabelle und Formular.

**Vorschlag:** ein Muster für alle – Liste links (durchsuchbar), Detail rechts mit Reitern.

**3.4 Seitenleiste bei 768 px** bleibt aufgeklappt (~150 px). **Vorschlag:** unter 1024 px automatisch eingeklappt (nur Symbole), per Knopf aufklappbar.

**3.5 Aktionen an wechselnden Stellen.** *Speichern* steht im Editor oben rechts, in den Ausrüstungsformularen unten. **Vorschlag:** Seitenkopf mit Titel links und Hauptaktion rechts auf allen Arbeitsseiten.

## 4. Was gut ist und bleibt

- **Tokens:** Farben, Abstände und Schrift kommen durchgehend aus Tokens. Hell und dunkel funktionieren, kein Emoji.
- **Seitenbreite:** Die Seite selbst scrollt nie horizontal (nur die Tabellen-Container).
- **Bausteine:** Nacht-, Saison- und Wetterdiagramm, Bestätigungsdialog und Zustände (laden, leer, Fehler) sind einheitlich.
- **Barrierefreiheit:** axe ohne *serious*/*critical*; Fokusringe sichtbar.

## 5. Vorschlag für den Ablauf (vor AP-30)

| Paket | Inhalt | Größe |
|---|---|---|
| **AP-26a** Tabellen | Baustein `DataTable` (Sortierung per Spaltenkopf, Spaltenprioritäten statt Scrollen, stehender Kopf, Gruppen, URL-Zustand), alle Tabellen umstellen, kompakte Plan-Zelle | M |
| **AP-26b** Seitenaufbau | Reiter statt Scrollen: Projekt-Editor, Rigs, Simulator, Mitglieder; einheitliches Listen-/Detail-Muster in der Ausrüstung; Seitenkopf mit Hauptaktion | M |
| **AP-26c** Rahmen | Kopfleisten, einzeilige Filterleisten mit Chips (Projektliste, Warteschlange, Objektbrowser), Seitenleiste unter 1024 px, Startseite als Übersicht | S–M |

Jedes Paket zieht `components.md` und `rules/ui.md` nach und endet mit deiner Sichtabnahme (Screenshots hell/dunkel, 768 und 2400 px).

## 6. Offene Fragen an Sven

1. Reihenfolge: zuerst Tabellen (26a, dein Hauptpunkt) oder zuerst Seitenaufbau (26b)?
2. Projekt-Editor: ist die Reiterfolge *Übersicht · Bedingungen · Belichtungsplan · Diagramme · Wetter · Notizen · Verlauf* richtig, oder soll der Belichtungsplan auf der Übersicht bleiben?
3. Website-Leiste: darf sie schlanker werden bzw. beim Scrollen einklappen? Sie ist das Bindeglied zu svenesis.org (nur Links, keine Laufzeit-Einbindung).
4. Tabellen bei wenig Platz: Spalten ausblenden (mit aufklappbarer Detailzeile) oder lieber eine Kartenansicht unter einer Breite?
