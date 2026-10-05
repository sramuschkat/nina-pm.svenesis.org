/**
 * Hilfe zu den NINA-PM-Bausteinen im Advanced Sequencer (Web, NINA › Hilfe: Sequencer) je Sprache. Inhalt aus
 * dem Plugin-Code (`apps/nina-plugin/NinaPm.Nina/Sequencer`, `NinaPm.Core`), `docs/specs/nina/execution.md` und
 * `docs/ops/sample-sequences.md`, Stand Plugin 0.4.0. Fließtexte sind Markdown (Anzeige über `react-markdown`
 * ohne HTML); die Namen der Bausteine stehen so, wie NINA sie zeigt (englisch, nicht lokalisiert).
 */
import type { Language } from './index';

export type SequencerItemKind = 'container' | 'instruction' | 'condition' | 'trigger';

export interface SequencerHelpSetting {
  readonly name: string;
  readonly values: string;
  readonly meaning: string;
}

export interface SequencerHelpItem {
  readonly id: string;
  /** Name in NINA (Kategorie „NINA-PM“). */
  readonly name: string;
  readonly kind: SequencerItemKind;
  readonly summary: string;
  /** Wo der Baustein hingehört (Markdown). */
  readonly place: string;
  readonly settings: readonly SequencerHelpSetting[];
  /** Ablauf (Markdown). */
  readonly behavior: string;
  /** Hinweise und typische Fehler (Markdown). */
  readonly tips?: string;
}

/** Tabelle in einem Abschnitt (zwei Spalten, Zellen Markdown) – die Markdown-Anzeige kennt keine GFM-Tabellen. */
export interface SequencerHelpTable {
  readonly label: string;
  readonly columns: readonly [string, string];
  readonly rows: readonly (readonly [string, string])[];
}

export interface SequencerHelpSection {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** Tabelle nach `body`, danach `after` (Markdown). */
  readonly table?: SequencerHelpTable;
  readonly after?: string;
}

export interface SequencerHelp {
  readonly intro: string;
  readonly basics: SequencerHelpSection;
  /** Begriffe, die mehrere Bausteine betreffen (Nachtende, Dithern), direkt nach den Grundregeln. */
  readonly concepts: readonly SequencerHelpSection[];
  readonly templates: readonly SequencerHelpSection[];
  readonly items: readonly SequencerHelpItem[];
  readonly flats: SequencerHelpSection;
  readonly checks: {
    readonly intro: string;
    readonly rows: readonly { code: string; text: string }[];
  };
  readonly options: SequencerHelpSection;
}

const de: SequencerHelp = {
  intro: `NINA-PM bringt eigene Bausteine für den **Advanced Sequencer** von NINA mit. Sie stehen in NINA in der Kategorie **NINA-PM** und heißen dort englisch (z. B. *NINA-PM Night Loop*). Den Plan der Nacht rechnet der Server; die Bausteine holen ihn ab, fahren die Blöcke ab und melden Aufnahmen, Ereignisse und den Status zurück. Am einfachsten startest du mit einer der Beispielsequenzen (Links auf der Optionsseite des Plugins) und passt nur die Geräte-Anweisungen an.`,
  basics: {
    id: 'basics',
    title: 'Grundregeln',
    body: `- **Ohne Server-URL und Sync-Token tun die Bausteine nichts**: der Container wartet je Aufruf 60 s, *Night Loop* und *Day Loop* sind falsch (die Sequenz springt in den Ende-Bereich), *Wait for Time* und *Wait until Safe or Night End* warten nicht. Beides trägst du unter *Optionen › Plugins › NINA-PM* ein.
- **Genau ein Container *NINA-PM Instructions*** je Sequenz. Er führt je Aufruf genau einen Schritt aus (planen, warten, einen Block, Flats, Nachtabschluss); die Schleifen um ihn herum rufen ihn so lange auf, bis die Nacht vorbei ist.
- **Bedingungen an die umgebenden Container**, nie an *NINA-PM Instructions* selbst – der Container wertet eigene Bedingungen nicht aus.
- **Erst warten, dann entparken**: Warte-Anweisungen stehen vor *Unpark Scope*.
- **Dithern steuert der Plan.** Dither-Trigger in der Sequenz werden immer unterdrückt ([warum](#dither)). Autofokus und Meridian-Flip laufen über NINAs eigene Trigger (*Autofocus After Time*, *Meridian Flip*); NINA-*Recenter* nach dem Flip ausschalten, NINA-PM zentriert selbst nach jedem Flip.
- **Zeiten** gelten immer in der Standortzeit des Rigs, nicht in der Zeitzone des Windows-PCs.
- **„Deaktiviert“ speichert NINA 3.2 nicht** in der Sequenzdatei. Was nicht laufen soll, löschst du.`,
  },
  concepts: [
    {
      id: 'night-end',
      title: 'Nachtende – wann die Nacht vorbei ist',
      body: `**Kurz:** Das Nachtende ist das **Ende der Dunkelheit laut Plan**, nicht der Sonnenaufgang und nicht das Ende des Nachtfensters. Hat die Nacht keine Dunkelheit (siehe unten), gilt das **Sessionende**.

**Woraus es sich ergibt**
- Jedes Projekt hat eine Dämmerungsgrenze: **astronomisch** (Sonne −18°, Vorgabe für Deep-Sky), **nautisch** (−12°, Vorgabe für Exoplaneten) oder **bürgerlich** (−6°).
- Das Nachtende ist der **späteste** Morgendurchgang der Grenzen, die die Projekte **dieser Nacht** nutzen. Steht ein nautisches Exoplaneten-Projekt im Plan, endet die Nacht erst bei −12°, auch wenn die Deep-Sky-Projekte schon bei −18° aufhören. Jeder Block endet trotzdem an der Grenze **seines** Projekts.
- Das **Sessionende** ist das Ende des Nachtfensters: bürgerliche Morgendämmerung (−6°) + 1 h, auf 5 min aufgerundet. Spätestens dann ist die Nacht vorbei. Beispiel Starfront, Nacht 17.09.2026: bürgerliche Morgendämmerung 06:59 CDT, Sessionende 08:00 CDT.
- Alle Zeiten rechnet der Server für den Standort des Rigs; sie stehen im Plan und in der Live-Anzeige des Containers.

**Welche Dämmerung gilt:** Die Sonne erreicht morgens zuerst −18°, dann −12°, dann −6°. Es gewinnt also die **flachste** Grenze unter den Projekten der Nacht:`,
      table: {
        label: 'Welche Dämmerung das Nachtende bestimmt',
        columns: ['Projekte im Plan der Nacht', 'Nachtende'],
        rows: [
          ['nur Deep-Sky mit Vorgabe', '**astronomische** Dämmerung (−18°)'],
          [
            'mit Exoplanet (Vorgabe nautisch)',
            '**nautische** Dämmerung (−12°), etwa eine halbe Stunde später (je nach Breite und Jahreszeit)',
          ],
          ['mindestens ein Projekt auf bürgerlich', '**bürgerliche** Dämmerung (−6°)'],
          [
            'keine genutzte Grenze wird erreicht (weiße Nacht)',
            '**Sessionende** (bürgerliche Morgendämmerung + 1 h)',
          ],
        ],
      },
      after: `Für ein Rig mit reinem Deep-Sky endet die Nacht also an der astronomischen Morgendämmerung; ist ein festgelegter Exoplaneten-Transit dabei, an der nautischen.

**Was am Nachtende passiert** (*NINA-PM Instructions*)
1. **Letzte Belichtung:** Eine Belichtung beginnt nur, wenn sie samt Download vor dem Ende der Dunkelheit fertig wird. Der laufende Block endet (Grund \`night_end\`), das Guiding stoppt.
2. **Flats**, falls im Rig eingeschaltet: frühestens am Nachtende (Panel) bzw. ab Sonne −8° (Himmelsflats, dann höchstens bis −2°). Ab dem Sessionende beginnt keine Kombination mehr.
3. **Session abschließen**; danach folgt der Nachtbericht.
4. *NINA-PM Night Loop* wird falsch, und NINA führt den **Ende-Bereich** aus (Parken, Kamera aufwärmen). Das geschieht direkt nach der Dunkelheit bzw. nach den Flats, nicht erst am Morgen.

**Bei Unsicherheit:** *NINA-PM Wait until Safe or Night End* wartet höchstens bis zu diesem Nachtende; ohne gespeicherten Plan bis zum Ende des Nachtfensters. Wird es bis dahin nicht sicher, schließt die Anweisung die Nacht **ohne Wiederaufnahme** ab: Flats nur, wenn der Monitor sicher meldet, sonst entfallen die offenen Kombinationen; danach Session abschließen und Ende-Bereich.

**Sonderfall weiße Nacht:** Erreicht die Sonne keine der genutzten Grenzen (hohe Breite im Sommer), gibt es keine Dunkelheit. Die Nacht endet dann am Sessionende, Panel-Flats beginnen frühestens 1 h davor. Die nächste Nacht beginnt im Plugin erst nach dem Ende des Nachtfensters.`,
    },
    {
      id: 'dither',
      title: 'Dithern – warum NINA-Dither-Trigger unterdrückt werden',
      body: `Bei NINA-PM steuert **der Plan** das Dithern, nicht NINA. Ob und wie oft gedithert wird, stellst du im Web am Rig ein („Dithern alle n Belichtungen“). Ein Dither-Trigger in der Sequenz (*Dither after Exposures*) würde dem Plan ins Gehege kommen:

1. **Die Zeit ist eingeplant.** Der Server rechnet die Settle-Zeit je Dither in die Blocklänge ein. Dithert NINA zusätzlich nach eigenem Zähler, fehlt diese Zeit im Plan: Im zeitgeführten Ablauf fehlen Belichtungen am Blockende, und das Plugin plant wegen Verzug neu.
2. **Die richtigen Stellen.** Der Plan dithert nur zwischen Belichtungen desselben Ziels, nicht vor einem Zielwechsel, Flip oder Blockende. NINAs Trigger zählt nur Belichtungen und kennt keine Blockgrenzen.
3. **Kein Dithern im Transit.** Für die Photometrie muss der Stern auf denselben Pixeln bleiben; ein Dither in der Transitserie verfälscht die Lichtkurve. Der Plan belichtet dort ohne Dither.
4. **Eine Stelle für die Einstellung.** Die Vorgabe steht im Web am Rig; ein Trigger in der Sequenzdatei wäre eine zweite, die im Web niemand sieht.

**Warum unterdrücken statt verbieten?** Damit es auch mit einer alten Sequenz richtig läuft, etwa einer aus Astro-PM-Zeiten. Das Plugin überspringt jeden Trigger mit „Dither“ im Typnamen – in normalen Blöcken und im Transit –, meldet beim Planen einmal die Warnung \`nina_dither_trigger_present\` und arbeitet nach dem Plan weiter.

Der Rat „keinen Dither-Trigger einbauen“ ist also Ordnung, keine Pflicht: Ein Trigger schadet nicht, erzeugt aber eine Warnung und verwirrt beim Lesen der Sequenz. **Autofokus** läuft dagegen über NINAs Trigger *Autofocus After Time*; den plant der Server ein.`,
    },
  ],
  templates: [
    {
      id: 'template-safety',
      title: 'Eine Nacht mit Safety-Monitor',
      body: `Datei \`one-night-safety.json\`. Bedingungen in eckigen Klammern [B: …], Trigger [T: …].

\`\`\`
Start:  Wait if Sun Altitude (−6°) → Unpark Scope → Cool Camera → Run Autofocus
Ziel-Bereich:
  „NINA-PM Nacht“            [B: NINA-PM Night Loop]
    „Ziel“                   [B: Loop While Safe, NINA-PM Night Loop]
                             [T: Meridian Flip, Autofocus After Time, Restore Guiding,
                                 optional AF nach HFR/Temperatur, Center After Drift,
                                 optional NINA-PM Before/After Each Exposure,
                                 NINA-PM Before/After Target Change – kein Dither-Trigger]
      Unpark Scope           (Wiederherstellung nach einer Safety-Pause)
      „Blöcke“               [B: NINA-PM Night Loop]
        NINA-PM Instructions (mit den Flat-Boxen, falls Flats gewünscht)
    „Sicherung“              [B: Loop While Unsafe, NINA-PM Night Loop]
      Stop Guiding → Park Scope → (Close Cover …)
      → NINA-PM Wait until Safe or Night End   ← immer die letzte Anweisung
Ende:   Stop Guiding → Park Scope → Warm Camera
\`\`\`

- Der eigene Container **„Blöcke“** ist nötig: stünde *NINA-PM Instructions* direkt in „Ziel“, liefe *Unpark Scope* vor jedem Block.
- **Home statt Park** (z. B. Dach-Sternwarte): Park Scope → *Find Home* + *Set Tracking: Stopped*, Wiederherstellung → *Set Tracking: Sidereal*.
- *Autofocus After Time*: Intervall wie im Rig (Vorgabe 60 min). Fehlt der Trigger, plant der Server ohne Autofokus.`,
    },
    {
      id: 'template-plain',
      title: 'Eine Nacht ohne Safety-Monitor',
      body: `Datei \`one-night.json\`: wie oben, aber **ohne** *Loop While Safe* an „Ziel“ und **ohne** den Container „Sicherung“. Enthält die Sequenz Safety-Bedingungen, ohne dass ein Safety-Monitor verbunden ist, warnt die Vorlagenprüfung.`,
    },
    {
      id: 'template-multi',
      title: 'Mehrere Nächte (Tagesschleife)',
      body: `Datei \`multi-night.json\`: die ganze Nacht samt Start- und Morgenanweisungen liegt in einem Container mit *NINA-PM Day Loop*.

\`\`\`
Start:  (leer)
Ziel-Bereich:
  „NINA-PM Tage“             [B: NINA-PM Day Loop (Letzte Nacht leer, Höchstens 14)]
    NINA-PM Wait for Time    (Nautische Dämmerung, Versatz 0, Tageswechsel 12:00)
    → Unpark Scope → Cool Camera → Run Autofocus
    → „NINA-PM Nacht“        (wie oben: „Ziel“ / „Blöcke“ / „Sicherung“)
    → Stop Guiding → Park Scope → Warm Camera      (jeden Morgen)
Ende:   Stop Guiding → Park Scope → Warm Camera
\`\`\`

Mit Tagesschleife gelten die Anweisungen vor bzw. nach „NINA-PM Nacht“ als Start bzw. Ende der Nacht.`,
    },
    {
      id: 'template-test',
      title: 'Testkopie für Läufe tagsüber',
      body: `Für einen Test am Tag mit dem lokalen Test-Server *Wait if Sun Altitude* bzw. *NINA-PM Wait for Time* aus einer **Kopie** der Sequenz löschen (nicht nur deaktivieren) und auf der Optionsseite den *Testbetrieb* einschalten. Im Container erscheint dann ein rotes Banner „Testbetrieb – Sicherheitsprüfungen aus“.`,
    },
  ],
  items: [
    {
      id: 'instructions',
      name: 'NINA-PM Instructions',
      kind: 'container',
      summary:
        'Führt den Nachtplan von NINA-PM aus: je Aufruf genau ein Schritt – planen, auf den nächsten Block warten, einen Block fahren (Slew, Zentrieren, Belichtungen), Flats oder den Nachtabschluss.',
      place: `In den Container **„Blöcke“** (mit *NINA-PM Night Loop*) innerhalb von **„Ziel“**. Genau einmal je Sequenz.`,
      settings: [
        {
          name: 'Zurücksetzen',
          values: 'Knopf',
          meaning:
            'Plant die Nacht neu, hebt eine Planungssperre auf (z. B. nach einem Fehler) und vergisst erledigte Blöcke.',
        },
        {
          name: 'Block überspringen',
          values: 'Knopf',
          meaning:
            'Ein wartender Block entfällt; ein laufender endet nach der aktuellen Belichtung.',
        },
        {
          name: 'Flats am Nachtende',
          values: 'drei Boxen',
          meaning: 'Vor Flats, je Kombination, nach Flats – siehe Abschnitt *Flats am Nachtende*.',
        },
      ],
      behavior: `1. Plan vom Server holen (beim ersten Aufruf und nach jeder Neuplanung). Gelingt das nicht, folgt der nächste Versuch nach 5 min; der Status zeigt den Grund.
2. Bis zum Start des nächsten Blocks warten (Status *Warten*, „Nächster Block 21:40“).
3. **Block**: vergangene oder nicht belichtbare Blöcke überspringen, Höhe und Dunkelheit prüfen, Ziel setzen, Slew und Zentrieren (mit Rotator *Center and Rotate*; Wiederholungen mit wachsenden Pausen), Box *Before Target Change*, Guiding starten, dann je Eintrag Filter → Dither laut Plan → Trigger → Belichtung → Nach-Trigger, zuletzt Box *After Target Change*.
4. **[Nachtende](#night-end)** (Ende der Dunkelheit laut Plan): Flats, falls eingeschaltet, dann Session abschließen. *NINA-PM Night Loop* wird falsch, NINA führt den Ende-Bereich aus.

**Safety**: Meldet *Loop While Safe* unsicher, wird die laufende Belichtung abgebrochen und der Block beendet; nach „wieder sicher“ plant NINA-PM neu und fährt immer neu an und zentriert.

**Ohne Verbindung** arbeitet der Container den gespeicherten Server-Plan der laufenden Nacht weiter ab; Meldungen warten in der Outbox.

**Anzeige**: Live-Status (alle 2 s) mit Zustand (*Warten / Läuft / Flats / Pausiert – unsicher / Gesperrt / Beendet*), Ziel, RA/Dec, Rotation, aktueller Belichtung, Outbox und aufklappbar „Heutige Ziele“.`,
      tips: `- Bedingungen nie an diesen Container hängen – sie wirken nicht.
- Steht der Container direkt in „Ziel“ statt in „Blöcke“, läuft die Wiederherstellung (*Unpark Scope*) vor jedem Block.
- Keine Dither-Trigger einbauen; sie werden ohnehin unterdrückt ([Dithern](#dither)). Fehlt *Autofocus After Time*, plant der Server ohne Autofokus.`,
    },
    {
      id: 'night-loop',
      name: 'NINA-PM Night Loop',
      kind: 'condition',
      summary:
        'Wahr, solange die NINA-PM-Nacht läuft; falsch nach dem Nachtabschluss – dann führt NINA den Ende-Bereich aus (Parken, Aufwärmen).',
      place: `An **vier** Containern der Vorlage: „NINA-PM Nacht“, „Ziel“, „Blöcke“ und „Sicherung“.`,
      settings: [],
      behavior: `- **Wahr** vor dem ersten Block, bei leerem Plan (dann wird alle 5 min neu geplant) und immer, solange ein Block oder Flats laufen.
- **Falsch** erst nach dem Nachtabschluss: nach den Flats und dem Abschluss der Session, nach einem Abschluss durch *Wait until Safe or Night End* oder bei einem nicht behebbaren Fehler (Rig belegt, Token ungültig, Mandant gesperrt, Uhrzeit falsch).
- **Nachtende** ist das Ende der Dunkelheit laut Plan (spätestens das Sessionende): der Ende-Bereich beginnt also direkt nach der Dunkelheit, nicht erst am Morgen. Details unter [Nachtende](#night-end).
- Mit *NINA-PM Day Loop* wird sie zu Beginn jeder neuen Runde wieder wahr.`,
      tips: `- Ohne Server-URL und Token ist sie sofort falsch – die Sequenz springt direkt in den Ende-Bereich.`,
    },
    {
      id: 'safety-wait',
      name: 'NINA-PM Wait until Safe or Night End',
      kind: 'instruction',
      summary:
        'Wartet, bis der Safety-Monitor „sicher“ meldet – höchstens bis zum Nachtende; danach wird die Nacht ohne Wiederaufnahme abgeschlossen.',
      place: `Als **letzte** Anweisung im Container „Sicherung“ (*Loop While Unsafe* + *NINA-PM Night Loop*), nach *Stop Guiding*, *Park Scope* (bzw. *Find Home*) und ggf. *Close Cover*. Ersetzt NINAs *Wait until Safe*, das ohne Frist wartet.`,
      settings: [],
      behavior: `- Prüft alle 10 s: Monitor **verbunden und sicher** → Ende; NINA kehrt in „Ziel“ zurück und stellt wieder her (*Unpark Scope*).
- **Monitor getrennt** zählt wie unsicher (einmal eine Warnung); die Montierung bleibt geparkt.
- **[Nachtende](#night-end) erreicht** → Nacht abschließen: offene Flat-Kombinationen entfallen (mit Auto-Flats holt sie der nächste Morgen nach), die Session wird beendet, *Night Loop* wird falsch und NINA führt den Ende-Bereich aus.`,
      tips: `- **Nichts dahinter einfügen**: NINA prüft nach jeder Anweisung die Bedingungen und überspringt den Rest, sobald es sicher ist – eine Anweisung danach liefe nie.
- Ohne Server-URL und Token wartet sie nicht.`,
    },
    {
      id: 'day-loop',
      name: 'NINA-PM Day Loop',
      kind: 'condition',
      summary:
        'Wiederholt die ganze Nacht Nacht für Nacht, solange NINA-PM für eine der nächsten 3 Nächte Ziele liefert – bis zu einem Enddatum oder einer Anzahl Nächte.',
      place: `An einem Container im Ziel-Bereich („NINA-PM Tage“), der die ganze Nacht mit Start- und Morgenanweisungen enthält. Erste Anweisung darin: *NINA-PM Wait for Time*.`,
      settings: [
        {
          name: 'Letzte Nacht',
          values: 'Datum JJJJ-MM-TT, leer = ohne',
          meaning:
            'Letzte Nacht (einschließlich, Nacht-Schlüssel des Standorts). Ein ungültiges Datum wird rot markiert und ignoriert.',
        },
        {
          name: 'Höchstens Nächte',
          values: 'Ganzzahl ≥ 1, Vorgabe 14',
          meaning: 'Höchstzahl der Nächte, die in diesem Sequenzlauf beendet werden.',
        },
      ],
      behavior: `- Entscheidet **nur an der Grenze einer Runde** (Beginn oder Ende); mitten in der Nacht ist sie immer wahr, damit das Parken am Morgen nicht entfällt.
- **Ende** (in dieser Reihenfolge): nächste Nacht nach der *Letzten Nacht* → „Enddatum erreicht“; beendete Nächte ≥ *Höchstens Nächte* → „Höchstzahl Nächte erreicht“; für die nächsten 3 Nächte keine Ziele → „keine Ziele in den nächsten 3 Nächten“.
- Beim Start einer Runde wird die nächste Nacht angefordert; die Zählung beginnt mit jedem Sequenzstart neu.
- Anzeige: „N. Nacht“ bzw. der Grund des Endes.`,
    },
    {
      id: 'wait-for-time',
      name: 'NINA-PM Wait for Time',
      kind: 'instruction',
      summary:
        'Wartet auf eine Uhrzeit oder die Abenddämmerung der nächsten NINA-PM-Nacht – in Standortzeit des Rigs, nicht in der Zeitzone des PCs.',
      place: `Erste Anweisung im Tagesschleifen-Container bzw. im Start-Bereich, **vor** *Unpark Scope*. In der Ein-Nacht-Vorlage optional statt *Wait if Sun Altitude*.`,
      settings: [
        {
          name: 'Quelle',
          values:
            'Uhrzeit · Bürgerliche (−6°) · Nautische (−12°, Vorgabe) · Astronomische Dämmerung (−18°)',
          meaning: 'Worauf gewartet wird; die Dämmerungszeiten liefert der Server je Nacht.',
        },
        {
          name: 'Uhrzeit',
          values: 'HH:MM, Vorgabe 21:00',
          meaning:
            'Nur bei Quelle *Uhrzeit*. Eine Zeit vor dem Tageswechsel gehört zum Morgen nach dem Abend (z. B. 01:30).',
        },
        {
          name: 'Versatz (min)',
          values: '−720 … +720, Vorgabe 0',
          meaning:
            'Wird auf die Zielzeit addiert, z. B. +15 = eine Viertelstunde nach der Dämmerung.',
        },
        {
          name: 'Tageswechsel',
          values: 'HH:MM, Vorgabe 12:00',
          meaning:
            'Grenze zwischen zwei Nächten. Weicht er von 12:00 ab, erscheint ein roter Hinweis (Nacht-Definition von NINA-PM ist der lokale Mittag).',
        },
      ],
      behavior: `- Frischt zuerst Rig-Einstellungen und Ziele auf, bestimmt die Zielnacht (nach einer beendeten Nacht die folgende) und wartet im 10-s-Takt; Anzeige „Warten noch hh:mm:ss“ und „bis 20:41 CDT (Nacht 17./18.10.)“.
- Liegt die Zielzeit schon zurück, geht es sofort weiter. Hat die Nacht die gewählte Dämmerung nicht (Polartag), wird nicht gewartet.
- Fehlt die Nacht-Tabelle des Servers, versucht sie es jede Minute erneut und entparkt nicht.
- **Zeitumstellung**: eine doppelt vorkommende Zeit gilt beim ersten Auftreten, eine ausfallende wird nach vorn verschoben (02:30 → 03:30).`,
      tips: `- Ohne Server-URL und Token wartet sie **nicht** – die Sequenz liefe sofort weiter. Verbindung vor dem Start prüfen.`,
    },
    {
      id: 'update-targets',
      name: 'NINA-PM Update Targets',
      kind: 'instruction',
      summary:
        'Lädt Rig-Einstellungen und die an NINA ausgelieferten Ziele vom Server in den lokalen Speicher des Plugins.',
      place: `Beliebig, z. B. im Start-Bereich. Optional – Container und *Wait for Time* laden beides ohnehin selbst.`,
      settings: [],
      behavior: `- Lädt die Rig-Einstellungen neu und fragt die Ziele ab (nur geänderte werden übertragen). Ein Fehler wird nur protokolliert; der gespeicherte Stand bleibt gültig, die Sequenz läuft weiter.
- Im Offline-Modus wird nichts abgerufen. Anzeige: „n Ziele im Cache“.`,
    },
    {
      id: 'before-exposure',
      name: 'NINA-PM Before Each Exposure / After Each Exposure',
      kind: 'trigger',
      summary:
        'Trigger mit eigener Anweisungsbox: führt die hineingezogenen Anweisungen direkt vor bzw. nach jeder Belichtung von NINA-PM aus.',
      place: `In die Trigger-Liste eines **übergeordneten** Containers von *NINA-PM Instructions* („Ziel“, „Blöcke“, „NINA-PM Nacht“ oder global). An einem Nachbar-Container (z. B. „Sicherung“) feuern sie nie.`,
      settings: [
        {
          name: 'Anweisungsbox',
          values: 'beliebige Anweisungen/Container',
          meaning: 'Wird vor bzw. nach jeder NINA-PM-Belichtung ausgeführt.',
        },
      ],
      behavior: `- Ausgelöst nur vom Plugin selbst, nicht von NINAs normalem Ablauf.
- *Center*, *Center and Rotate* und *Slew to Ra/Dec* in der Box erhalten automatisch die Koordinaten des aktuellen Ziels.
- Im Transit wird eine Box mit Autofokus übersprungen, wenn die Beobachtung keinen Autofokus erlaubt.
- Während der Flats laufen keine Sequenz-Trigger.
- Schlägt eine Anweisung fehl, gibt es eine Warnung; die Belichtung läuft weiter.`,
      tips: `- Dither oder Autofokus nicht zusätzlich hineinlegen: Dithern steuert der Plan, Autofokus NINAs AF-Trigger – sonst läuft es doppelt.`,
    },
    {
      id: 'target-change',
      name: 'NINA-PM Before Target Change / After Target Change',
      kind: 'trigger',
      summary:
        'Trigger mit Anweisungsbox je NINA-PM-Block: *Before* nach Slew und Zentrieren, vor dem Guiding; *After* nach den Belichtungen des Blocks.',
      place: `Wie die Belichtungs-Trigger: in der Trigger-Liste eines übergeordneten Containers von *NINA-PM Instructions*, auch global.`,
      settings: [
        {
          name: 'Anweisungsbox',
          values: 'beliebige Anweisungen/Container',
          meaning: 'Wird je Block ausgeführt; eine leere Box tut nichts.',
        },
      ],
      behavior: `- NINA löst sie nie selbst aus; der Container ruft sie je Block auf.
- Koordinatenabhängige Anweisungen erhalten wie oben die Zielkoordinaten.
- Ein Fehler in *Before* bricht den Block ab; ein Fehler in *After* wird nur protokolliert.`,
      tips: `- Zum Abschalten den Trigger löschen (NINA 3.2 speichert „deaktiviert“ nicht).`,
    },
  ],
  flats: {
    id: 'flats',
    title: 'Flats am Nachtende',
    body: `Der Container *NINA-PM Instructions* hat den Aufklappbereich **„Flats am Nachtende“** mit drei Boxen. Flats laufen nur, wenn sie **im Rig eingeschaltet** sind **und** die Box „Je Kombination“ nicht leer ist.

- **Vor Flats** (einmal): z. B. parken, Panel schließen, Licht an.
- **Je Kombination**: z. B. *Trained Flat Exposure*, danach *Trained Dark Flat Exposure*. Filter, Gain, Offset, Binning und Anzahl **nicht** selbst eintragen – NINA-PM setzt sie je Kombination (Filter + Rotatorwinkel + Gain + Offset + Binning + Auslesemodus); bei *Trained Flat Exposure* *Keep Panel Closed* einschalten.
- **Nach Flats** (einmal): z. B. Licht aus, Panel öffnen.

Ablauf: Am Nachtende **vor** dem Ende-Bereich (also bevor die Sequenz parkt) stoppt NINA-PM das Guiding und fährt die Kombinationen ab; Sequenz-Trigger laufen dabei nicht. Ab dem Sessionende beginnt keine Kombination mehr. Dark-Flats entstehen einmal je Belichtungszeit/Gain/Offset/Binning/Auslesemodus und Nacht; die Dateien werden in die Ordner der anderen Ziele kopiert. Für **Himmelsflats** (Sonne −8° bis −2°) in „Vor Flats“ nicht parken und kein Panel. Liegt die mittlere Helligkeit der ersten Aufnahme außerhalb von 20–80 % des Vollausschlags, gibt es eine Warnung.`,
  },
  checks: {
    intro:
      'Beim Planen prüft das Plugin die Sequenz gegen die Vorlage. Abweichungen sind Hinweise, kein Abbruch: sie stehen im NINA-Log (englisch: „Sequence template: …“, höchstens alle 12 h) und gehen als Ereignis an den Server.',
    rows: [
      { code: 'start_wait_missing', text: 'Start: Warten auf Sonnenhöhe fehlt.' },
      {
        code: 'start_unpark_before_wait',
        text: 'Start: Entparken steht vor dem Warten – erst warten, dann entparken.',
      },
      { code: 'start_cool_missing', text: 'Start: Kamera kühlen fehlt.' },
      { code: 'start_autofocus_missing', text: 'Start: Autofokus vor dem ersten Ziel fehlt.' },
      { code: 'start_order', text: 'Start: Kühlen bzw. Autofokus steht vor dem Entparken.' },
      { code: 'box_missing', text: 'Keine NINA-PM-Anweisungen in der Sequenz.' },
      {
        code: 'blocks_container_missing',
        text: 'Die NINA-PM-Anweisungen gehören in einen Container „Blöcke“ mit NINA-PM Nachtschleife innerhalb von „Ziel“.',
      },
      {
        code: 'target_night_loop_missing',
        text: 'Zielcontainer ohne Bedingung NINA-PM Night Loop.',
      },
      { code: 'loop_while_safe_missing', text: 'Zielcontainer ohne Loop While Safe.' },
      {
        code: 'restore_missing',
        text: '„Ziel“ beginnt nicht mit der Wiederherstellung (Unpark Scope bzw. Set Tracking).',
      },
      { code: 'flip_trigger_missing', text: 'Trigger Meridian Flip fehlt (nur mit Flip im Rig).' },
      {
        code: 'af_time_trigger_missing',
        text: 'Trigger Autofokus nach Zeit fehlt – der Server plant dann ohne Autofokus.',
      },
      { code: 'af_time_mismatch', text: 'Autofokus nach Zeit weicht vom Intervall des Rigs ab.' },
      {
        code: 'dither_trigger_present',
        text: 'Dither-Trigger in der Sequenz – das Dithern steuert der Plan.',
      },
      {
        code: 'wait_until_safe_used',
        text: 'Wait until Safe wartet ohne Frist – NINA-PM Wait until Safe or Night End verwenden.',
      },
      {
        code: 'secure_container_missing',
        text: 'Sicherungscontainer mit Loop While Unsafe fehlt.',
      },
      {
        code: 'secure_night_loop_missing',
        text: 'Sicherungscontainer ohne NINA-PM Night Loop.',
      },
      {
        code: 'safety_wait_not_last',
        text: 'NINA-PM Wait until Safe or Night End muss die letzte Anweisung der Sicherung sein.',
      },
      { code: 'secure_park_missing', text: 'Sicherung: Park Scope bzw. Find Home fehlt.' },
      { code: 'end_secure_missing', text: 'Ende: Park Scope bzw. Find Home fehlt.' },
      { code: 'end_warm_missing', text: 'Ende: Kamera aufwärmen fehlt.' },
    ],
  },
  options: {
    id: 'options',
    title: 'Optionsseite des Plugins',
    body: `*Optionen › Plugins › NINA-PM*:

- **Server-URL** (Vorgabe \`https://nina-pm.svenesis.org/api\`) und **Sync-Token** aus *NINA › NINA-Instanzen*; das Token wird verschlüsselt gespeichert und nie angezeigt.
- **Offline-Modus**: keine Server-Aufrufe; der gespeicherte Plan der laufenden Nacht wird abgearbeitet, Meldungen warten in der Outbox. Eine neue Nacht beginnt erst wieder mit Verbindung.
- **Testbetrieb**: wirkt nur mit einem lokalen Test-Server (localhost oder private Adresse, der Server bestätigt den Testbetrieb). Dann entfällt die Prüfung von Höhe und Dunkelheit vor jedem Block; im Container steht ein rotes Banner.
- **Zurücksetzen / Block überspringen / Erneut hochladen** wirken wie die Knöpfe im Container.
- **Standort**: weicht der Standort im NINA-Profil vom Rig ab, gibt es eine Warnung und den Knopf *Standort aus NINA-PM übernehmen*.`,
  },
};

const en: SequencerHelp = {
  intro: `NINA-PM adds its own items to NINA's **Advanced Sequencer**. In NINA they are listed in the category **NINA-PM** (e.g. *NINA-PM Night Loop*). The server computes the night plan; the items fetch it, run the blocks and report captures, events and status back. The easiest start is one of the sample sequences (links on the plugin's options page) – then only adapt the device instructions. The containers in the sample files keep their German names: "NINA-PM Nacht" (night), "Ziel" (target), "Blöcke" (blocks), "Sicherung" (secure) and "NINA-PM Tage" (days).`,
  basics: {
    id: 'basics',
    title: 'Ground rules',
    body: `- **Without server URL and sync token the items do nothing**: the container waits 60 s per call, *Night Loop* and *Day Loop* are false (the sequence jumps to the end area), *Wait for Time* and *Wait until Safe or Night End* do not wait. Enter both under *Options › Plugins › NINA-PM*.
- **Exactly one *NINA-PM Instructions* container** per sequence. Each call runs exactly one step (plan, wait, one block, flats, night end); the loops around it keep calling it until the night is over.
- **Conditions belong on the surrounding containers**, never on *NINA-PM Instructions* itself – the container does not evaluate its own conditions.
- **Wait first, then unpark**: wait instructions come before *Unpark Scope*.
- **The plan controls dithering.** Dither triggers in the sequence are always suppressed ([why](#dither)). Autofocus and meridian flip use NINA's own triggers (*Autofocus After Time*, *Meridian Flip*); turn NINA's *Recenter* after the flip off – NINA-PM re-centers after every flip itself.
- **Times** are always in the rig's site time, not in the Windows PC's time zone.
- **NINA 3.2 does not save "disabled"** in the sequence file. Delete what should not run.`,
  },
  concepts: [
    {
      id: 'night-end',
      title: 'Night end – when the night is over',
      body: `**In short:** night end is the **end of darkness according to the plan** – not sunrise and not the end of the night window. If the night has no darkness (see below), the **session end** applies.

**Where it comes from**
- Every project has a twilight limit: **astronomical** (sun −18°, default for deep sky), **nautical** (−12°, default for exoplanets) or **civil** (−6°).
- Night end is the **latest** morning crossing of the limits used by the projects of **this night**. If a nautical exoplanet project is in the plan, the night ends only at −12°, even if the deep-sky projects stop at −18°. Each block still ends at the limit of **its own** project.
- **Session end** is the end of the night window: civil dawn (−6°) + 1 h, rounded up to 5 min. The night is over at the latest then. Example Starfront, night 2026-09-17: civil dawn 06:59 CDT, session end 08:00 CDT.
- The server computes all times for the rig's site; they are in the plan and in the container's live status.

**Which twilight applies:** in the morning the sun reaches −18° first, then −12°, then −6°. So the **shallowest** limit among the night's projects wins:`,
      table: {
        label: 'Which twilight sets night end',
        columns: ["Projects in the night's plan", 'Night end'],
        rows: [
          ['deep sky only, default limit', '**astronomical** dawn (−18°)'],
          [
            'with an exoplanet (default nautical)',
            '**nautical** dawn (−12°), roughly half an hour later (depending on latitude and season)',
          ],
          ['at least one project set to civil', '**civil** dawn (−6°)'],
          [
            'none of the limits in use is reached (white night)',
            '**Session end** (civil dawn + 1 h)',
          ],
        ],
      },
      after: `So for a rig with deep sky only the night ends at astronomical dawn; with a locked exoplanet transit, at nautical dawn.

**What happens at night end** (*NINA-PM Instructions*)
1. **Last exposure:** an exposure only starts if it finishes, including download, before darkness ends. The running block ends (reason \`night_end\`), guiding stops.
2. **Flats**, if enabled for the rig: at night end at the earliest (panel), or from sun −8° (sky flats, then at most until −2°). No combination starts after session end.
3. **Close the session**; the night report follows.
4. *NINA-PM Night Loop* becomes false and NINA runs the **end area** (park, warm camera) – right after darkness or the flats, not in the morning.

**When unsafe:** *NINA-PM Wait until Safe or Night End* waits at most until this night end; without a stored plan until the end of the night window. If it does not become safe by then, the instruction closes the night **without resuming**: flats only if the monitor reports safe, otherwise the open combinations are skipped; then the session is closed and the end area runs.

**Special case white night:** if the sun reaches none of the limits in use (high latitude in summer), there is no darkness. The night then ends at session end; panel flats start 1 h before it at the earliest. The plugin starts the next night only after the night window has ended.`,
    },
    {
      id: 'dither',
      title: 'Dithering – why NINA dither triggers are suppressed',
      body: `With NINA-PM **the plan** controls dithering, not NINA. Whether and how often to dither is set on the rig in the web app ("dither every n exposures"). A dither trigger in the sequence (*Dither after Exposures*) would interfere with the plan:

1. **The time is planned.** The server includes the settle time per dither in the block length. If NINA dithers additionally on its own count, that time is missing from the plan: in time-aware playback exposures are lost at the end of the block, and the plugin re-plans because it is behind.
2. **The right moments.** The plan dithers only between exposures of the same target – not before a target change, flip or block end. NINA's trigger only counts exposures and knows nothing about blocks.
3. **No dithering during a transit.** For photometry the star must stay on the same pixels; a dither within the transit series distorts the light curve. The plan exposes without dithering there.
4. **One place for the setting.** It lives on the rig in the web app; a trigger in the sequence file would be a second one nobody sees in the web app.

**Why suppress instead of forbid?** So that an old sequence still works correctly, e.g. one from Astro PM times. The plugin skips every trigger with "dither" in its type name – in regular blocks and in transits –, reports the warning \`nina_dither_trigger_present\` once when planning and keeps following the plan.

So "don't add a dither trigger" is housekeeping, not a requirement: a trigger does no harm, but it causes a warning and is confusing when reading the sequence. **Autofocus**, on the other hand, runs through NINA's *Autofocus After Time* trigger; the server plans for it.`,
    },
  ],
  templates: [
    {
      id: 'template-safety',
      title: 'One night with safety monitor',
      body: `File \`one-night-safety.json\`. Conditions in brackets [C: …], triggers [T: …].

\`\`\`
Start:  Wait if Sun Altitude (−6°) → Unpark Scope → Cool Camera → Run Autofocus
Targets:
  "NINA-PM Nacht"            [C: NINA-PM Night Loop]
    "Ziel"                 [C: Loop While Safe, NINA-PM Night Loop]
                             [T: Meridian Flip, Autofocus After Time, Restore Guiding,
                                 optional AF after HFR/temperature, Center After Drift,
                                 optional NINA-PM Before/After Each Exposure,
                                 NINA-PM Before/After Target Change – no dither trigger]
      Unpark Scope           (restore after a safety pause)
      "Blöcke"               [C: NINA-PM Night Loop]
        NINA-PM Instructions (with the flat boxes if you want flats)
    "Sicherung"                 [C: Loop While Unsafe, NINA-PM Night Loop]
      Stop Guiding → Park Scope → (Close Cover …)
      → NINA-PM Wait until Safe or Night End   ← always the last instruction
End:    Stop Guiding → Park Scope → Warm Camera
\`\`\`

- The separate **"Blöcke"** container is required: if *NINA-PM Instructions* were directly in "Ziel", *Unpark Scope* would run before every block.
- **Home instead of park** (e.g. roll-off roof): Park Scope → *Find Home* + *Set Tracking: Stopped*, restore → *Set Tracking: Sidereal*.
- *Autofocus After Time*: interval as in the rig (default 60 min). Without this trigger the server plans without autofocus.`,
    },
    {
      id: 'template-plain',
      title: 'One night without safety monitor',
      body: `File \`one-night.json\`: as above but **without** *Loop While Safe* on "Ziel" and **without** the "Sicherung" container. If the sequence contains safety conditions while no safety monitor is connected, the template check warns.`,
    },
    {
      id: 'template-multi',
      title: 'Several nights (day loop)',
      body: `File \`multi-night.json\`: the whole night including start and morning instructions sits in one container with *NINA-PM Day Loop*.

\`\`\`
Start:  (empty)
Targets:
  "NINA-PM Tage"             [C: NINA-PM Day Loop (Last night empty, Max. nights 14)]
    NINA-PM Wait for Time    (nautical dusk, offset 0, day rollover 12:00)
    → Unpark Scope → Cool Camera → Run Autofocus
    → "NINA-PM Nacht"        (as above: "Ziel" / "Blöcke" / "Sicherung")
    → Stop Guiding → Park Scope → Warm Camera      (every morning)
End:    Stop Guiding → Park Scope → Warm Camera
\`\`\`

With a day loop the instructions before and after "NINA-PM Nacht" count as start and end of the night.`,
    },
    {
      id: 'template-test',
      title: 'Test copy for daytime runs',
      body: `For a daytime test with the local test server, delete *Wait if Sun Altitude* or *NINA-PM Wait for Time* from a **copy** of the sequence (do not just disable it) and turn on *Test mode* on the options page. The container then shows a red banner "Test mode – safety checks off".`,
    },
  ],
  items: [
    {
      id: 'instructions',
      name: 'NINA-PM Instructions',
      kind: 'container',
      summary:
        "Runs NINA-PM's night plan: exactly one step per call – plan, wait for the next block, run a block (slew, centering, exposures), flats or the night end.",
      place: `In the **"Blöcke"** container (with *NINA-PM Night Loop*) inside **"Ziel"**. Exactly once per sequence.`,
      settings: [
        {
          name: 'Reset',
          values: 'button',
          meaning:
            'Re-plans the night, lifts a planning lock (e.g. after an error) and forgets finished blocks.',
        },
        {
          name: 'Skip block',
          values: 'button',
          meaning: 'A waiting block is dropped; a running block ends after the current exposure.',
        },
        {
          name: 'Flats at night end',
          values: 'three boxes',
          meaning: 'Before flats, per combination, after flats – see *Flats at night end*.',
        },
      ],
      behavior: `1. Fetch the plan from the server (on the first call and after every re-plan). If that fails, it retries after 5 min; the status shows the reason.
2. Wait until the next block starts (status *Waiting*, "Next block 21:40").
3. **Block**: skip past or non-imageable blocks, check altitude and darkness, set the target, slew and center (with rotator *Center and Rotate*; retries with growing pauses), box *Before Target Change*, start guiding, then per entry filter → dither per plan → triggers → exposure → after-triggers, finally box *After Target Change*.
4. **[Night end](#night-end)** (end of darkness per plan): flats if enabled, then close the session. *NINA-PM Night Loop* becomes false and NINA runs the end area.

**Safety**: when *Loop While Safe* reports unsafe, the running exposure is aborted and the block ends; once safe again NINA-PM re-plans and always slews and centers anew.

**Offline** the container keeps running the stored server plan of the current night; messages wait in the outbox.

**Display**: live status (every 2 s) with state (*Waiting / Running / Flats / Paused – unsafe / Blocked / Finished*), target, RA/Dec, rotation, current exposure, outbox and the expandable "Tonight's targets".`,
      tips: `- Never attach conditions to this container – they have no effect.
- If the container sits directly in "Ziel" instead of "Blöcke", the restore (*Unpark Scope*) runs before every block.
- Do not add dither triggers; they are suppressed anyway ([dithering](#dither)). Without *Autofocus After Time* the server plans without autofocus.`,
    },
    {
      id: 'night-loop',
      name: 'NINA-PM Night Loop',
      kind: 'condition',
      summary:
        'True while the NINA-PM night is running; false after the night end – then NINA runs the end area (park, warm up).',
      place: `On **four** containers of the template: "NINA-PM Nacht", "Ziel", "Blöcke" and "Sicherung".`,
      settings: [],
      behavior: `- **True** before the first block, with an empty plan (re-planned every 5 min) and always while a block or flats are running.
- **False** only after the night end: after flats and closing the session, after *Wait until Safe or Night End* closed the night, or on an unrecoverable error (rig busy, token invalid, tenant locked, clock wrong).
- **Night end** is the end of darkness per plan (at the latest the session end): the end area starts right after darkness, not in the morning. Details under [night end](#night-end).
- With *NINA-PM Day Loop* it becomes true again at the start of each new round.`,
      tips: `- Without server URL and token it is false immediately – the sequence jumps straight to the end area.`,
    },
    {
      id: 'safety-wait',
      name: 'NINA-PM Wait until Safe or Night End',
      kind: 'instruction',
      summary:
        'Waits until the safety monitor reports safe – at most until the night end; then the night is closed without resuming.',
      place: `As the **last** instruction in the "Sicherung" container (*Loop While Unsafe* + *NINA-PM Night Loop*), after *Stop Guiding*, *Park Scope* (or *Find Home*) and *Close Cover* if needed. Replaces NINA's *Wait until Safe*, which waits without a deadline.`,
      settings: [],
      behavior: `- Checks every 10 s: monitor **connected and safe** → done; NINA returns to "Ziel" and restores (*Unpark Scope*).
- **Monitor disconnected** counts as unsafe (one warning); the mount stays parked.
- **[Night end](#night-end) reached** → close the night: open flat combinations are skipped (with auto flats the next morning catches up), the session ends, *Night Loop* becomes false and NINA runs the end area.`,
      tips: `- **Add nothing after it**: NINA checks the conditions after each instruction and skips the rest as soon as it is safe – an instruction after it would never run.
- Without server URL and token it does not wait.`,
    },
    {
      id: 'day-loop',
      name: 'NINA-PM Day Loop',
      kind: 'condition',
      summary:
        'Repeats the whole night, night after night, while NINA-PM delivers targets for one of the next 3 nights – up to an end night or a number of nights.',
      place: `On a container in the Targets area ("NINA-PM Tage") that contains the whole night with start and morning instructions. First instruction inside: *NINA-PM Wait for Time*.`,
      settings: [
        {
          name: 'Last night',
          values: 'date YYYY-MM-DD, empty = none',
          meaning:
            'Last night (inclusive, night key of the site). An invalid date is marked red and ignored.',
        },
        {
          name: 'Max. nights',
          values: 'integer ≥ 1, default 14',
          meaning: 'Maximum number of nights finished in this sequence run.',
        },
      ],
      behavior: `- Decides **only at the boundary of a round** (start or end); in the middle of the night it is always true so the morning park is not skipped.
- **End** (in this order): next night after *Last night* → "end date reached"; finished nights ≥ *Max. nights* → "maximum nights reached"; no targets for the next 3 nights → "no targets in the next 3 nights".
- At the start of a round the next night is requested; counting restarts with every sequence start.
- Display: "Night N" or the reason for the end.`,
    },
    {
      id: 'wait-for-time',
      name: 'NINA-PM Wait for Time',
      kind: 'instruction',
      summary:
        "Waits for a time or the evening twilight of the next NINA-PM night – in the rig's site time, not the PC's time zone.",
      place: `First instruction in the day-loop container or in the start area, **before** *Unpark Scope*. Optional in the one-night template instead of *Wait if Sun Altitude*.`,
      settings: [
        {
          name: 'Source',
          values: 'Time · Civil (−6°) · Nautical (−12°, default) · Astronomical dusk (−18°)',
          meaning: 'What to wait for; the server supplies the twilight times per night.',
        },
        {
          name: 'Time',
          values: 'HH:MM, default 21:00',
          meaning:
            'Only with source *Time*. A time before the day rollover belongs to the morning after the evening (e.g. 01:30).',
        },
        {
          name: 'Offset (min)',
          values: '−720 … +720, default 0',
          meaning: 'Added to the target time, e.g. +15 = a quarter of an hour after twilight.',
        },
        {
          name: 'Day rollover',
          values: 'HH:MM, default 12:00',
          meaning:
            "Boundary between two nights. If it differs from 12:00 a red hint appears (NINA-PM's night definition is local noon).",
        },
      ],
      behavior: `- First refreshes rig settings and targets, determines the target night (after a finished night the following one) and waits in 10-s steps; display "Waiting hh:mm:ss" and "until 20:41 CDT (night 17/18 Oct)".
- If the target time has passed it continues immediately. If the night lacks the chosen twilight (polar day) it does not wait.
- Without the server's night table it retries every minute and does not unpark.
- **DST change**: a time that occurs twice counts at its first occurrence; a skipped time moves forward (02:30 → 03:30).`,
      tips: `- Without server URL and token it does **not** wait – the sequence would continue immediately. Check the connection before starting.`,
    },
    {
      id: 'update-targets',
      name: 'NINA-PM Update Targets',
      kind: 'instruction',
      summary:
        "Loads the rig settings and the targets delivered to NINA from the server into the plugin's local store.",
      place: `Anywhere, e.g. in the start area. Optional – the container and *Wait for Time* load both themselves.`,
      settings: [],
      behavior: `- Reloads the rig settings and requests the targets (only changes are transferred). An error is only logged; the stored state stays valid and the sequence continues.
- In offline mode nothing is fetched. Display: "n targets in cache".`,
    },
    {
      id: 'before-exposure',
      name: 'NINA-PM Before Each Exposure / After Each Exposure',
      kind: 'trigger',
      summary:
        'Trigger with its own instruction box: runs the instructions dropped into it right before or after each NINA-PM exposure.',
      place: `In the trigger list of a **parent** container of *NINA-PM Instructions* ("Ziel", "Blöcke", "NINA-PM Nacht" or global). On a sibling container (e.g. "Sicherung") they never fire.`,
      settings: [
        {
          name: 'Instruction box',
          values: 'any instructions/containers',
          meaning: 'Runs before or after each NINA-PM exposure.',
        },
      ],
      behavior: `- Fired only by the plugin itself, not by NINA's normal flow.
- *Center*, *Center and Rotate* and *Slew to Ra/Dec* in the box automatically get the coordinates of the current target.
- During a transit a box containing autofocus is skipped if the observation does not allow autofocus.
- No sequence triggers run during flats.
- If an instruction fails, a warning is logged; the exposure continues.`,
      tips: `- Do not add dither or autofocus here as well: the plan controls dithering, NINA's AF trigger controls autofocus – otherwise it runs twice.`,
    },
    {
      id: 'target-change',
      name: 'NINA-PM Before Target Change / After Target Change',
      kind: 'trigger',
      summary:
        'Trigger with an instruction box per NINA-PM block: *Before* after slew and centering, before guiding; *After* after the block’s exposures.',
      place: `Like the exposure triggers: in the trigger list of a parent container of *NINA-PM Instructions*, also global.`,
      settings: [
        {
          name: 'Instruction box',
          values: 'any instructions/containers',
          meaning: 'Runs per block; an empty box does nothing.',
        },
      ],
      behavior: `- NINA never fires them itself; the container calls them per block.
- Coordinate-dependent instructions get the target coordinates as above.
- An error in *Before* aborts the block; an error in *After* is only logged.`,
      tips: `- To turn it off, delete the trigger (NINA 3.2 does not save "disabled").`,
    },
  ],
  flats: {
    id: 'flats',
    title: 'Flats at night end',
    body: `The *NINA-PM Instructions* container has the expandable area **"Flats at night end"** with three boxes. Flats run only if they are **enabled in the rig** **and** the "Per combination" box is not empty.

- **Before flats** (once): e.g. park, close the panel, light on.
- **Per combination**: e.g. *Trained Flat Exposure*, then *Trained Dark Flat Exposure*. Do **not** enter filter, gain, offset, binning or count yourself – NINA-PM sets them per combination (filter + rotator angle + gain + offset + binning + readout mode); with *Trained Flat Exposure* turn on *Keep Panel Closed*.
- **After flats** (once): e.g. light off, open the panel.

Flow: at night end, **before** the end area (i.e. before the sequence parks), NINA-PM stops guiding and runs the combinations; sequence triggers do not run meanwhile. From the session end no new combination starts. Dark flats are taken once per exposure/gain/offset/binning/readout mode and night; the files are copied into the folders of the other targets. For **sky flats** (sun −8° to −2°) do not park and use no panel in "Before flats". If the mean brightness of the first frame is outside 20–80 % of full scale, a warning is logged.`,
  },
  checks: {
    intro:
      'When planning, the plugin checks the sequence against the template. Deviations are hints, not an abort: they appear in the NINA log ("Sequence template: …", at most every 12 h) and are sent to the server as an event.',
    rows: [
      { code: 'start_wait_missing', text: 'Start: waiting for sun altitude is missing.' },
      {
        code: 'start_unpark_before_wait',
        text: 'Start: unpark comes before the wait – wait first, then unpark.',
      },
      { code: 'start_cool_missing', text: 'Start: cooling the camera is missing.' },
      {
        code: 'start_autofocus_missing',
        text: 'Start: autofocus before the first target is missing.',
      },
      { code: 'start_order', text: 'Start: cooling or autofocus comes before unparking.' },
      { code: 'box_missing', text: 'No NINA-PM Instructions in the sequence.' },
      {
        code: 'blocks_container_missing',
        text: 'NINA-PM Instructions belong in a "Blöcke" container with NINA-PM Night Loop inside "Ziel".',
      },
      { code: 'target_night_loop_missing', text: 'Target container without NINA-PM Night Loop.' },
      { code: 'loop_while_safe_missing', text: 'Target container without Loop While Safe.' },
      {
        code: 'restore_missing',
        text: '"Ziel" does not start with the restore (Unpark Scope or Set Tracking).',
      },
      {
        code: 'flip_trigger_missing',
        text: 'Meridian Flip trigger missing (only with flip enabled in the rig).',
      },
      {
        code: 'af_time_trigger_missing',
        text: 'Autofocus After Time trigger missing – the server then plans without autofocus.',
      },
      { code: 'af_time_mismatch', text: "Autofocus After Time differs from the rig's interval." },
      {
        code: 'dither_trigger_present',
        text: 'Dither trigger in the sequence – the plan controls dithering.',
      },
      {
        code: 'wait_until_safe_used',
        text: 'Wait until Safe waits without a deadline – use NINA-PM Wait until Safe or Night End.',
      },
      {
        code: 'secure_container_missing',
        text: 'Secure container with Loop While Unsafe is missing.',
      },
      {
        code: 'secure_night_loop_missing',
        text: 'Secure container without NINA-PM Night Loop.',
      },
      {
        code: 'safety_wait_not_last',
        text: 'NINA-PM Wait until Safe or Night End must be the last instruction of the secure container.',
      },
      { code: 'secure_park_missing', text: 'Secure: Park Scope or Find Home is missing.' },
      { code: 'end_secure_missing', text: 'End: Park Scope or Find Home is missing.' },
      { code: 'end_warm_missing', text: 'End: warming the camera is missing.' },
    ],
  },
  options: {
    id: 'options',
    title: "Plugin's options page",
    body: `*Options › Plugins › NINA-PM*:

- **Server URL** (default \`https://nina-pm.svenesis.org/api\`) and **sync token** from *NINA › NINA instances*; the token is stored encrypted and never shown.
- **Offline mode**: no server calls; the stored plan of the current night keeps running, messages wait in the outbox. A new night only starts again with a connection.
- **Test mode**: only works with a local test server (localhost or a private address, the server confirms test mode). Then the altitude and darkness check before each block is skipped; the container shows a red banner.
- **Reset / Skip block / Re-upload** work like the buttons in the container.
- **Site**: if the site in the NINA profile differs from the rig, a warning appears with the button *Apply site from NINA-PM*.`,
  },
};

export const sequencerHelp: Readonly<Record<Language, SequencerHelp>> = { de, en };
