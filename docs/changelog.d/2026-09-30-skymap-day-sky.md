### Sternkarte: Taghimmel (2026-09-30)

Anforderungen: FA-FRM-03…11 (S-20, Ebene *Taghimmel*) · Wunsch Sven 30.09.2026 („wenn Tag, soll heller Himmel kommen“)

- **Taghimmel standardmäßig an** (Ebenen → Sonnensystem, abschaltbar); braucht wie bisher einen Standort (Rig).
- **Himmelsfarbe nach der Sonnenhöhe:**
  - Tageslicht 0 bei Sonne ≤ −12° (Nacht und astronomische Dämmerung schwarz), steigt weich an und erreicht 1 bei ≥ +4°;
  - Verlauf vom hellen Horizont (`sky-day-horizon`) zum Zenitblau (`sky-day`);
  - **über** den Himmelsfotos, damit sie am Tag verblassen – bisher lag das Blau darunter und war mit 55 % Deckkraft kaum zu sehen.
- **Am Tag treten Sterne und Katalogobjekte zurück:**
  - die Grenzgröße sinkt bis 1 mag, sodass nur die hellsten Sterne zur Orientierung bleiben;
  - Katalogobjekte werden blasser, ihre Namen (außer dem gewählten) entfallen ab halbem Tageslicht;
  - Sonne, Mond, Planeten, Gitter, Horizont und Bildfeld bleiben.
- **Tokens:** `sky-day` deckend `#4a86c8`, neu `sky-day-horizon` `#a9cbea`; wie der Himmelsverlauf im Nachtdiagramm in beiden Themes gleich.
- **Tests:** Tageslicht-Kurve, Sterngrenze, Standard-Ebenen.
- **Nachträge:** AP-42 und AP-43 von Sven am 30.09.2026 abgenommen (☑).
