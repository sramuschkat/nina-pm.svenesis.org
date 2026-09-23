# Spezifikation: Objektkatalog-Import (OpenNGC → `dso_object`)

Verbindlich für AP-20 (Objektkatalog und Objektbrowser, Import `packages/catalog-data` → `dso_object`, Job `catalog_refresh`) und AP-25 (Vorschaubilder). Bezug: FK 6.3 (FA-FRM-01, FA-FRM-13, FA-FRM-15), FK Kap. 9, TK 8.4 und 12, Schema `dso_object` (v1.18), `docs/contracts/enums.json` (`dsoObjectTypes`, `dsoObjectTypeGroups`, `dsoCatalogPrefixes`).

> **Warum diese Datei (WS-25, Entscheidung WS-E4).** Bisher war die einzige Quelle des Katalogs der **Auszug der Website** (`data/ngc.json`, `js/dso-catalog.js`). Dieser Auszug trägt eigene Kurzcodes für den Objekttyp, **eine** gerundete Helligkeit ohne Bandangabe und keine Flächenhelligkeit – die Spalten `mag_b`, `mag_band_used` und `surf_br_mag_arcsec2` des Schemas (AST-D6/D7) wären damit nicht füllbar. Quelle ist deshalb die **OpenNGC-Quelldatei**; der Website-Auszug liefert nur noch Namen, Aliase, Vorschaubilder und Wikipedia-Titel. Diese Datei legt Felder, Einheiten, Filter und Tests des Imports fest, damit der Import wiederholbar und prüfbar ist.

## 1. Quellen und Lizenzen

| Quelle | Umfang | Lizenz | Verwendung |
|---|---|---|---|
| OpenNGC `NGC.csv` | **13.957** Zeilen (NGC, IC samt Komponenten) | CC-BY-SA-4.0 | **Leitquelle**: Koordinaten, Typ, Sternbild, Größen, Positionswinkel, B-/V-Helligkeit, Flächenhelligkeit, weitere Bezeichnungen |
| OpenNGC `addendum.csv` | **`n_addendum`** Zeilen – Objekte außerhalb von NGC/IC (u. a. eigene Sharpless-Regionen, Barnard-Objekte); die Zeilenzahl der verwendeten Version wird beim Import gezählt und festgehalten | CC-BY-SA-4.0 | wie `NGC.csv` |
| Website-Auszug `data/ngc.json` | Zeilen mit Namen und Aliasen, Wikipedia-Titel | CC-BY-SA-4.0 (abgeleitet) | **nur** zusätzliche Namen/Aliase und Wikipedia-Titel |
| Website-Auszug `js/dso-catalog.js` | 168 kuratierte Objekte mit Trivialnamen | CC-BY-SA-4.0 (abgeleitet) | **nur** zusätzliche Namen/Aliase (Trivialnamen) |
| `img/dso/`, `img/ngc/`, `img/ngc-l/` | **kopierte** Katalogbilder der Website (128 px, Kandidaten 320 px) | DSS/Pan-STARRS-Bedingungen | einmalig nach **`catalog/img/…`** kopiert (AP-25, H-11) |

**Version und Abrufdatum.** Jeder Importlauf hält Release-Bezeichnung und Abrufdatum der verwendeten OpenNGC-Auslieferung fest und schreibt sie je Zeile nach `dso_object.source` (`openngc:NGC.csv <Version>` bzw. `openngc:addendum.csv <Version>`). Version und Abrufdatum stehen zusätzlich in `packages/catalog-data/LICENSES.md` und im Quellen-Hinweis der Anwendung (FA-ADM-07). **Was 13.957 genau bezählt (verbindlich).** Die Zahl **13.957 ist die Zeilenzahl von `NGC.csv`** in der beim Konzept vorliegenden OpenNGC-Version – nicht die Gesamtzahl des Katalogs. Die Zeilen von `addendum.csv` (`n_addendum`) **kommen hinzu**; die Gesamtzahl der Quellzeilen ist also **`13.957 + n_addendum`** und `n_addendum` wird aus der verwendeten Version gezählt, nicht geraten. Wo eine Zahl geschrieben wird, steht sie immer in dieser Form (`13.957` aus `NGC.csv`, dazu die Addendum-Zeilen der Version). Beide Zahlen werden beim Import aus den Dateien gezählt (Test T-KAT-10); weichen sie ab, gelten die gezählten, und FK 6.3/Kap. 9/11, TK 8.4 und der Kommentar an `dso_object` werden mit ihnen nachgezogen (WS-27) – es steht **überall dieselbe** Zahl. Wie viele Zeilen davon am Ende in `dso_object` stehen, ist kleiner: `Dup` und `NonEx` werden nach §3 nicht als eigene Zeile geführt.

**Spalten von `NGC.csv`.** Erwartet werden (Trennzeichen `;`, eine Kopfzeile):
`Name, Type, RA, Dec, Const, MajAx, MinAx, PosAng, B-Mag, V-Mag, SurfBr, Hubble, Common names, NGC, IC, Identifiers`.
Die verwendete OpenNGC-Version führt weitere Spalten (u. a. Infrarot-Helligkeiten, Eigenbewegung, Rotverschiebung, Quellen); sie werden nicht importiert. **Verbindlich:** Der Import liest die Spalten **über die Kopfzeile**, nie über feste Positionen, und bricht mit einer Meldung ab, wenn eine benötigte Spalte fehlt. Die Spalten `Common names`, `Identifiers`, `NGC` und `IC` sowie eine etwaige eigene Messier-Spalte (`M`) sind **beim Import gegen die Kopfzeile der verwendeten OpenNGC-Version zu prüfen** – ihre Benennung hat sich zwischen OpenNGC-Ständen geändert.

**Zeilenformat des Website-Auszugs `data/ngc.json`** (dokumentiert, damit Namen und Wikipedia-Titel übernommen werden können; Prüfung `tools/verify-planner.js:322`):

```
Datei:  { source, licence, objects[], aliases{}, nonexistent[] }
Zeile:  [ Name, ra, dec, Typ, Großachse′, Kleinachse′, PA, Helligkeit, Sternbild, aka[]|null, [wikiDE, wikiEN] ]
          0     1   2    3    4            5            6   7           8          9         10
```

- `ra` in Grad (0…360), `dec` in Grad (−90…90), Großachse/Kleinachse in Bogenminuten, `PA` in `[0, 180)` (`verify-planner.js:200` prüft `o.pa >= 0 && o.pa < 180`). Übernommen wird der Wert trotzdem nicht – maßgeblich ist `PosAng` aus OpenNGC (§2).
- `Typ` sind die **Kurzcodes der Website** (`Gx, EN, RN, DN, PN, SNR, GC, OC, St, DS, Ast`) – sie werden **nicht** übernommen (Vokabular: §2, `dsoObjectTypes`).
- `aka[]` sind weitere Bezeichnungen der Zeile, `aliases{}` bildet Bezeichnung → Zeilenname ab, `nonexistent[]` sind die von OpenNGC als nicht existent geführten Nummern.
- `[wikiDE, wikiEN]`: je Sprache ein Artikeltitel als Zeichenkette, oder `1` (Artikel trägt den Objektnamen) bzw. `0` (kein Artikel → Suchlink).
- **Ausdrücklich:** `Helligkeit` (Feld 7) ist ein **gerundeter Richtwert ohne Bandangabe**. Der Wert wird **nicht** nach `mag_v` oder `mag_b` übernommen und auch nicht zum Füllen fehlender OpenNGC-Helligkeiten benutzt (Test T-KAT-08). Gleiches gilt für Größen, Positionswinkel und Typ des Auszugs.

## 2. Feldabbildung OpenNGC → `dso_object`

| Quellspalte | Einheit in der Quelle | Zielspalte | Regel |
|---|---|---|---|
| – | – | `id` | **nicht importiert** – Server-UUID (`gen_random_uuid()`), die Zeile ist über `primary_id` stabil: der Upsert läuft `ON CONFLICT (primary_id)` und lässt `id` unangetastet. Eine Neuvergabe (Zeile löschen und neu einfügen) bricht jeden Fremdschlüssel auf `dso_object` – Panels, Projekte, Bildkandidaten (T-KAT-11) |
| `Name` | – | `primary_id` | Schreibweise normalisieren: Katalogkürzel, ein Leerzeichen, Nummer ohne führende Nullen (`NGC0224` → `NGC 224`); Komponentenbuchstaben bleiben erhalten (`NGC 1234A`). `primary_id` ist der **stabile Schlüssel** und bleibt die OpenNGC-Bezeichnung, auch wenn die Anzeige einen Messier-Namen bevorzugt (§3) |
| `Type` | Code | `object_type` | Code aus `dsoObjectTypes` (`enums.json`, WS-26) unverändert übernehmen. Unbekannter Code → `Other` **und** Importwarnung. Anzeigegruppe der Oberfläche über `dsoObjectTypeGroups`, nie am Code selbst |
| `RA` | `HH:MM:SS.ss` (J2000) | `ra_deg` | `ra_deg = 15 · (hh + mm/60 + ss/3600)`, Wertebereich 0 ≤ `ra_deg` < 360, `double precision` |
| `Dec` | `±DD:MM:SS.s` (J2000) | `dec_deg` | Vorzeichen des Grad-Anteils gilt für Minuten und Sekunden; −90 ≤ `dec_deg` ≤ 90. Keine Präzession, keine Eigenbewegung (FK 8.1) |
| `Const` | IAU-Kürzel (3 Zeichen) | `constellation` | Groß-/Kleinschreibung der IAU-Kürzel (`And`, `Cas`); muss eines der 88 Kürzel sein |
| `MajAx` | Bogenminuten | `size_major_arcmin` | leer → `null`; > 0, sonst Importwarnung |
| `MinAx` | Bogenminuten | `size_minor_arcmin` | leer → `null`; `MinAx ≤ MajAx`, sonst tauschen und Importwarnung |
| `PosAng` | Grad, Nord über Ost | `position_angle_deg` | **Konvention `[0, 180)`** – der Großachsen-PA ist eine **Achsenrichtung**, 180° bezeichnet dieselbe Achse wie 0° und ist deshalb kein eigener Wert: `position_angle_deg = PosAng mod 180` (Ergebnis ≥ 0, `180 → 0`). Leer → `null`. **Fehlt `MajAx` oder `MinAx`, gilt `position_angle_deg = null`** – ohne beide Achsen gibt es keine Ellipse, deren Lage der Winkel beschreiben könnte (T-KAT-03). **Andere Winkelart** als der Kamera-Positionswinkel (`flip-rotation.md` §3, `[0, 360)`, Bild-Oberkante, AST-D21) |
| `B-Mag` | mag (Johnson B) | `mag_b` | leer → `null`. Nie nach `mag_v` schreiben (AST-D6) |
| `V-Mag` | mag (Johnson V) | `mag_v` | leer → `null` |
| – | – | `mag_band_used` | `'V'`, wenn `mag_v` vorliegt, sonst `'B'`, wenn `mag_b` vorliegt, sonst `null` |
| `SurfBr` | mag/arcsec² | `surf_br_mag_arcsec2` | leer → `null`. OpenNGC führt den Wert nur für Flächenobjekte (vor allem Galaxien); er wird nicht geschätzt |
| `NGC`, `IC`, `Identifiers`, `Common names` | Bezeichnungen, kommagetrennt | `names` (jsonb-Liste) | Reihenfolge: Messier, NGC, IC, Caldwell, Sharpless, sonstige Kataloge, Trivialnamen. Schreibweise wie üblich (`Sh2-142`, `C 20`, `NGC 6994`), keine führenden Nullen. Ergänzt um Trivialnamen und Aliase des Website-Auszugs |
| abgeleitet aus `names` | – | `catalogs` (jsonb-Liste) | Katalogkürzel der Bezeichnungen (`["M","NGC","Sh2"]`), Grundlage des Katalogfilters in S-21. **Erlaubte Kürzel ausschließlich aus `contracts/enums.json` → `dsoCatalogPrefixes`** (`M, NGC, IC, C, Sh2, LBN, LDN, B, PGC, UGC, ESO, Mel, Cl`); ein Kürzel, das dort fehlt, wird **nicht** nach `catalogs` geschrieben, sondern erzeugt eine Importwarnung – sonst wächst der Filter mit jeder Katalogversion um Werte, die die Oberfläche nicht kennt. Die Bezeichnung selbst bleibt in `names` erhalten |
| `Hubble` | Morphologie | – | nicht importiert (keine Zielspalte) |
| – | – | `source` | `openngc:NGC.csv <Version>` bzw. `openngc:addendum.csv <Version>` (§1) |
| – | – | `updated_at` | Zeit des Importlaufs; unveränderte Zeilen werden nur hier berührt (Idempotenz, T-KAT-11) |

**Bilder und Wikipedia-Titel** stehen nicht in `dso_object`. Die Bildablage ist **nach Herkunft getrennt** (verbindlich, auch in T-KAT-12, AP-25 und TK 8.4):

| Pfad (S3) | Inhalt |
|---|---|
| **`catalog/img/…`** | die aus dem Website-Ordner **kopierten** Katalogbilder (`img/dso/`, `img/ngc/`, `img/ngc-l/`), unverändert übernommen |
| **`catalog/thumbs/…`** | die von NINA-PM **selbst erzeugten** Vorschauen des Jobs `thumbnail` (AP-25), 128 px je Katalogzeile und 320 px je Bildkandidat |

Beide werden über die normalisierte `primary_id` gefunden; ein selbst erzeugtes Bild überschreibt nie ein kopiertes, weil die Pfade getrennt sind. Die Wikipedia-Titel kommen aus dem Website-Auszug und werden als Recherche-Link angezeigt (FA-FRM-14).

## 3. Filter und Dubletten

1. **`Type = Dup`** (OpenNGC-Dublette): **keine** eigene Zeile. Die Bezeichnung wird **Alias** des Objekts, auf das die Zeile zeigt (Ziel aus `Identifiers`, ersatzweise `NGC`/`IC`). Fehlt das Ziel, wird die Zeile verworfen und eine Importwarnung geschrieben.
2. **`Type = NonEx`** (nicht existierender Eintrag): **keine** eigene Zeile. Die Nummer wird in die Liste `nonexistent` des Importlaufs aufgenommen; nur diese Nummern dürfen im Vollständigkeitstest fehlen (T-KAT-05).
3. **Mehrfacheinträge desselben Himmelsobjekts** (z. B. M 102 = NGC 5866, M 16 = IC 4703): **eine** Zeile je Objekt. Die zweite Bezeichnung wird Alias, nicht eine zweite Zeile. Erkennung: gleiche Objektart und Winkelabstand < 0,1′ (Regel der Website, `verify-planner.js:363`).
4. **`primary_id` und Anzeigename.** `primary_id` bleibt die OpenNGC-Bezeichnung (stabiler Schlüssel, `UNIQUE`); der **Anzeigename** ist die erste vorhandene Bezeichnung in der Reihenfolge Messier → NGC → IC → Caldwell → Sharpless → sonstige. Damit heißt das Objekt in der Oberfläche `M 31`, während der Schlüssel `NGC 224` bleibt (Abweichung vom Website-Auszug, der `M31` als Schlüssel führt).
5. **Aliasauflösung.** Ein Alias zeigt auf genau eine `primary_id`. Ein Alias, der selbst eine `primary_id` ist, wird verworfen (Importwarnung); zeigen zwei Zeilen denselben Alias, bricht der Import ab. Aliase sind für die Suche gleichwertig (FA-FRM-01) und werden ohne Leerzeichen und ohne Groß-/Kleinschreibung verglichen.
6. **Komponenten** (`NGC 1234A`, `NGC 2237`-Teile) bleiben eigene Zeilen, gelten aber **nicht** als Bildkandidaten für die Galerie: Kandidat ist eine Zeile mit Typ außer `*`, `**`, `*Ass` und `MajAx` zwischen 3′ und 180′ und ohne Komponentenbuchstaben (Regel der Website, `verify-planner.js:385`; > 800 Kandidaten erwartet).
7. **Doppelte `primary_id`** nach der Normalisierung: Import bricht ab (`UNIQUE`-Verletzung wäre sonst die Folge).

## 4. Pflicht-Tests

Katalogteil der Positivliste aus WS-22; Fundstellen in `astro-tools/tools/verify-planner.js` (Portierung nach `packages/engine/test/legacy-checks.spec.ts` bzw. in die Importtests von AP-20).

| ID | Test | Fundstelle | Erwartung |
|---|---|---|---|
| T-KAT-01 | Wertebereiche je Zeile | `:197`, `:322` | 0 ≤ `ra_deg` < 360, \|`dec_deg`\| ≤ 90, `object_type` ∈ `dsoObjectTypes`, `size_major_arcmin` > 0 oder `null`, `size_minor_arcmin` ≤ `size_major_arcmin`, **`0 ≤ position_angle_deg < 180`** oder `null` (der Wert 180 darf nicht vorkommen, T-KAT-03), `constellation` eines der 88 IAU-Kürzel |
| T-KAT-02 | Helligkeiten und Bänder | – (neu, WS-E4; `:197` prüft nur, dass **eine** Helligkeit existiert – `isFinite(o.m)` –, nicht ihr Band und nicht ihre Herkunft) | `mag_v`/`mag_b` nur aus OpenNGC, `mag_band_used` = `'V'` bei vorhandenem `mag_v`, sonst `'B'`, sonst `null`; `surf_br_mag_arcsec2` nur bei Flächenobjekten gesetzt |
| T-KAT-03 | Positionswinkel und Achsverhältnis | `:200` (`o.pa >= 0 && o.pa < 180`) | `position_angle_deg` nur gesetzt, wenn **beide** Achsen (`MajAx` **und** `MinAx`) vorliegen – sonst `null`; **`0 ≤ PA < 180`**, der Wert 180 kommt nach `mod 180` nicht vor |
| T-KAT-04 | Aliasziele | `:327` | jeder Alias zeigt auf eine vorhandene `primary_id` (`NGC 224` → `M 31`), kein Alias auf zwei Objekte, kein Alias auf sich selbst |
| T-KAT-05 | Vollständigkeit Messier/NGC/IC | `:348`, `:379` | Messier 1…110 (110 Objekte), NGC 1…7840 und IC 1…5386 vollständig auffindbar über `primary_id`, `names` oder Alias – **nur** die als `NonEx` geführten Nummern dürfen fehlen |
| T-KAT-06 | Vollständigkeit Caldwell und Sharpless | `:335`, `:342`; Paare und eigene Regionen aus `:337-339` | Caldwell 1…109 und Sh2-1…313 auffindbar. **Alle 14 Paare** aus `:337-338`: Sh2-281 = M 42 · Sh2-117 = NGC 7000 · Sh2-49 = M 16 · Sh2-25 = M 8 · Sh2-30 = M 20 · Sh2-275 = NGC 2237 · Sh2-131 = IC 1396 · Sh2-155 = C 9 · Sh2-244 = M 1 · C 30 = NGC 7331 · C 14 = NGC 869 · C 20 = NGC 7000 · C 50 = NGC 2239 · C 37 = NGC 6882. **Alle 4 eigenen Regionen** aus `:339` (Bezeichnung zeigt auf sich selbst): **Sh2-103** (Cygnus Loop), **Sh2-129**, **Sh2-240**, **Sh2-276** (Barnard's Loop) |
| T-KAT-07 | Dubletten | `:324`, `:363` | kein Himmelsobjekt zweimal (gleiche Art, Abstand < 0,1′); NGC 5866 → M 102 und IC 4703 → M 16 sind Aliase; keine Zeile mit `object_type` `Dup` oder `NonEx` in `dso_object` |
| T-KAT-08 | Herkunft der Helligkeiten | – (neu, WS-E4) | kein Helligkeitswert des Website-Auszugs in `mag_v`/`mag_b`; Stichprobe: gerundeter Auszugswert ≠ OpenNGC-`V-Mag` bei mindestens 20 Objekten, `source` beginnt bei jeder Zeile mit `openngc:` |
| T-KAT-09 | Bezeichnungen normalisiert | `:369`, `:377` | keine führenden Nullen (`PGC 0…`, `SH 2…`), Sterne benannt (`NGC 1990` → `Alnilam`, `M 73` → `NGC 6994`); keine Sternnummern (`HD`, `HIP`, `WDS`) an Nebeln; keine Bezeichnung eines Objekts an einem anderen (M 102 nicht an M 101) |
| T-KAT-10 | Objektzahl | `:322`, `:379` | Zeilen getrennt gezählt: **`13.957` aus `NGC.csv`** (Sollwert der in §1 genannten Version) **+ `n_addendum`** aus `addendum.csv` (Sollwert = Zeilenzahl derselben Version). Der Test prüft beide Zahlen einzeln und schreibt die Summe `13.957 + n_addendum` in den Importbericht; Abweichung → Test schlägt fehl, die Zahlen werden in FK, TK und Schema-Kommentar nachgezogen (WS-27) |
| T-KAT-11 | Idempotenz | – (AP-20) | zweiter Importlauf ändert außer `updated_at` keine Zeile; Import bricht bei doppelter `primary_id` ab |
| T-KAT-12 | Bilder und Vorschauen | `:351`, `:385` | ein 128-px-Bild je Zeile, ein 320-px-Bild je Bildkandidat; Dateinamen aus der normalisierten `primary_id` eindeutig. Geprüft wird **beides getrennt**: kopierte Katalogbilder unter `catalog/img/…`, selbst erzeugte Vorschauen unter `catalog/thumbs/…` (§2, AP-25, H-11) |

**Nicht Teil der Importtests** (Negativliste WS-23): alle Prüfungen zu Seitenstruktur, `?v=`-Versionen, HEALPix, Projektion, Sternbinärdatei, Doppelsternen und TLE-Alter sowie die Wikipedia-Weiterleitungstests (`:355`, `:358`, `:371`) – Wikipedia-Titel sind Anzeige und brechen keinen Import.
