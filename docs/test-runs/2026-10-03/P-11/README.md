# P-11 Zielbrowser & Framing – 03.10.2026 (VM, Test-Mandant prod)

| Gerät | Simulator | Zustand |
|---|---|---|
| Kamera, Montierung, Filterrad | Sky Simulator (ALPACA) | getrennt (für P-11 nicht nötig) |
| Guider, Safety-Monitor | PHD2, OmniSim | getrennt |
| NINA-Profil | „NINA-PM Prod-Test“ (Ziele aus prod, Test-Mandant) bzw. „SkySimulator“ nach Neuinstallation – die Ziele kommen aus dem Cache | – |

Ablauf (Sven): Plugins → NINA-PM → *Delivered to NINA* → *Refresh* → je Ziel *Load into Framing Assistant*.

| Prüfung | Sh2-132 (Einzelfeld) | M 31 (2×2, 20 %) |
|---|---|---|
| Zentrum = Web | 22h19m09,0s / +56°04′44,8″ ✓ | 00h42m44,3s / +41°16′08,6″ ✓ |
| Rotation | 0° ✓ | 0° ✓ |
| Sensor/Pixel/Brennweite | 3008×3008, 3,76 µm, 382,4 mm ✓ | ✓ |
| Raster/Überlappung | 1×1 ✓ | 2×2, 20 % ✓ |
| Panelzentren = Web | – | 1: 00:46:23 / +41°56′36″, 2: 00:39:06 / +41°56′36″, 3: 00:46:19 / +40°35′16″, 4: 00:39:10 / +40°35′16″ ✓ (Web: 00h46m23,0s, 00h39m05,7s, 00h46m18,5s, 00h39m10,1s) |
| Panel 1 oben links = Nordost (NT-32) | – | ✓ (`m31-mosaik-nachher.jpg`) |

Befund vor dem Fix (`m31-mosaik-vorher.webp`, Plugin aus `main` e4fe2f8): Überlappung als 20 statt 0,2 an NINA übergeben → negative Rahmen, Panelzentren Stunden neben dem Ziel (23:33:55 … 02:33:17), keine Rahmen im Bild; außerdem Bildfeld 3° < Mosaik 3,05° und Brennweite `382.40000000000003`. Behoben im PR dieses Ordners.

Hinweis: NINA zeigt je Panel Rotation 0,00°, das Web 0,6°/359,4° (Meridiankonvergenz je Panel, geometry.md §2). Für das Framing ohne Bedeutung; ausgeführt wird je Panel mit dem Winkel aus dem Plan.

**Ergebnis: Go** (vorbehaltlich Svens Abnahme).
