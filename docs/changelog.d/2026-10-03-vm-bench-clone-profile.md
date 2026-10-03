### VM-Prüfstand: Prod-Profil per Agent anlegen

- `pnpm vm-bench clone-profile` lässt den Agenten in der VM ein NINA-Profil kopieren:
  - neue Id und Name, Filternamen, Meridian-Flip-Werte (*Recenter* aus);
  - NINA-PM-Server-URL, Testbetrieb aus, **Token der Kopie geleert**.
- Danach aktiviert der Prüfstand das Profil in NINA. Das Token trägt nur ein Mensch auf der Optionsseite ein.
- Angelegt am 03.10.2026: „NINA-PM Prod-Test“ für P-05/P-11 gegen prod (Test-Mandant).
