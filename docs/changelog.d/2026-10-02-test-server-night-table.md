### NINA-Test-Server: keine neue Nacht mitten im Test (2026-10-02)

Anforderungen: AP-16a (Test-Server), NT-01 · Befund aus dem ersten Lauf von AP-16c in NINA (Sven, 02.10.2026)

- Die relativen Szenarien (alle außer `current-night`) lieferten die echte Nacht-Tabelle von Starfront, die Blöcke aber relativ zum Serverstart. Endete während des Tests das echte Nachtfenster (Lauf 02.10.: 13:05Z), wechselte `currentNight`; das Plugin verwarf die Session – korrekt nach Spec – und begann mitten im Block eine neue Nacht.
- Jetzt liegen die Nächte dieser Szenarien um den Serverstart (Mittag = Start ± 12 h, je Nacht + 24 h), das Nachtfenster der ersten endet frühestens 1 h nach dem Nachtende des Szenarios. Nacht-Schlüssel und Zeitzonenwechsel bleiben echt; `current-night` (P-29) nutzt weiter die echte Tabelle. Test für den Lauf vom 02.10.
