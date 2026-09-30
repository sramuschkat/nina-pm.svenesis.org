### Transitsuche: Belichtungsempfehlung und Hilfe-Tooltips (2026-09-30)

Anforderungen: FA-EXO-13, FA-EXO-14a (neu) · transit.md §6 (neu) · Wunsch Sven 30.09.2026 (eigene kleine Karte statt Rechnerseite; Defokus-Empfehlung und zusätzlich die kurze Belichtung im Fokus)

- **Karte *Belichtung*** in der aufgeklappten Zeile von S-22, neben Sternfeld und Himmelsposition:
  - große Zahl mit Filter und Standard-Gain des Rigs;
  - Aufnahmen im Fenster, Genauigkeit je Aufnahme (mmag), Transit-SNR mit Einstufung (gut/knapp/schwach) und Stern-Spitze in % der Sättigung;
  - Grund der Begrenzung (Sättigung, Ingress, 180 s, Defokus);
  - bei hellen Sternen „Leicht defokussieren auf ≈ x″ FWHM“ für 30 s und darunter die Variante **ohne Defokus** im Fokus;
  - fehlen Kamera-, Teleskop- oder Filterangaben, nennt die Karte sie.
- **Engine 0.15.0:** `exposureAdvice` mit Sättigungsgrenze 50 %, Obergrenze min(180 s, Ingress/4), Defokus bis 20″, Rauschen aus Photonen, Himmel (Bortle), Dunkelstrom, Ausleserauschen und Szintillation (Young/Osborn).
- **API:** `ExoTransitView.exposure` (`status: 'ok' | 'missing'`); Kennwerte aus Teleskop (mit Reducer), Kamera am Standard-Gain (Gain-Modus vor Kamerawerten, Sättigung = min(Full Well, ADC · e⁻/ADU)), Filter, Standort und Download-Zeit des Rigs.
- **Hilfe-Tooltips:** Die Fragezeichen der Zieldetails und der neuen Karte zeigen ihre Erklärung jetzt bei Maus, Fokus und Antippen; Escape schließt. Bisher stand die Erklärung nur im SVG-Titel, den der Browser kaum anzeigte.
- **Seed:** Die Demo-Kameras (IMX571, Unity-Gain) tragen Ausleserauschen, Full Well und e⁻/ADU.
- **Spec-Ergänzungen:** transit.md §6 (Modell, Annahmen, Wahl der Belichtung); FK FA-EXO-14a (K) – vorgezogener Teil des Modus *Exoplanet-Stern* aus R6.
- **Tests:** Engine (erf, Spitzenanteil, alle fünf Begrenzungen, Öffnung); API (Rig-Kennwerte, fehlende Angaben, Route); Web (Karte mit Defokus und Variante im Fokus, fehlende Angaben, Tooltip, axe); E2E mit Karte bei 768/2400 px.
