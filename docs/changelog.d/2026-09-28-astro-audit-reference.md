### Astronomie-Prüfung: Referenzdaten für hohe Breiten

- Neue Referenzstandorte: Tromsø (69,6° N), Longyearbyen (78,2° N) und Casey (66,3° S), mit Nächten am Rand der Polarnacht und weißen Nächten. Die Saison läuft neu für NGC 6946 in Tromsø.
- Der Generator (`tools/reference`) sucht die Sonnendurchgänge über Transit und Antitransit wie die Engine. Er rechnet Polartag, Polarnacht und die Begrenzung des Nachtfensters auf Mittag bis Mittag wie night.md §3.
- Die scheinbare Zielhöhe rechnet der Generator jetzt mit Saemundsson wie die Engine; vorher nahm er astropys eigene Refraktion, obwohl die Metadaten „Saemundsson“ angaben. Der Test vergleicht dadurch bis zum Horizont.
- Neue Nächte 1995 und 2045 prüfen Präzession und Nutation über Jahrzehnte.
- Die Fixtures sind aus dem CI-Job `reference` übernommen (astropy 6.1.4, DE432s).
- Sonnendurchgänge gelten auf ±15 s bzw. 0,01° Höhe, je nachdem, was mehr Zeit zulässt. In hohen Breiten sinkt die Sonne am Horizont so langsam, dass 0,006° Modellunterschied 19 s ausmachen.
