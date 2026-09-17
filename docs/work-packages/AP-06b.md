# AP-06b – Benachrichtigungen in der App und Startseite R1

**Release:** R1 · **Größe:** S · **Abhängigkeiten:** AP-06a · **Menschliche Aufgaben:** –

## Ziel
Benachrichtigungen erscheinen in der App (Glocke) und die Startseite R1 verlinkt die wichtigsten Listen. Discord folgt erst in R6.

## Anforderungen
FA-BEN (Hinweise), FK 11 R1

## Lesen (nur diese Abschnitte)
- FK 14.3 (Glocke, Startseite)
- TK 7.2 (Benachrichtigungen)
- contracts/enums.json notificationKinds
- rules/ui.md
- specs/ui/components.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `NotificationService.notify(kind, recipients, payload)` (DB + später Discord-Hook-Punkt), `GET /web/v1/notifications`, `POST /notifications/read`
- Glocke mit Zähler, Liste
- Startseite R1: „Meine Objekte“ (User) bzw. Projektliste (Admin) als Platzhalter-Links

## Nicht im Umfang
- Discord-Zustellung (AP-60)

## Checkliste Komponente (Glocke, Startseite)
- [ ] Vertrag aus `docs/specs/ui/components.md` §2 eingehalten: Eigenschaften, Zustände, Mindestgrößen, Grenzfälle, Textalternative
- [ ] Zustände leer / laden / Fehler / bereit; keine Annahmen über Rechte (die Seite entscheidet); kein Import von `useCan`, `fetch` oder Repositories
- [ ] Texte DE/EN über i18n, Zeiten mit Zeitzonen-Kürzel (FK 8.1)
- [ ] Themes `light` und `dark` (Theme-Test gegen die Tokens); Dichtestufen `compact`/`normal`/`wide` ohne Überlauf
- [ ] Mindestbreite laut `components.md` **und** 2400 px ohne horizontales Scrollen (`scrollWidth <= clientWidth`), Tastaturbedienung mit sichtbarem Fokusring
- [ ] `pnpm test:a11y` (axe) ohne *serious*/*critical*-Verstöße

## Automatisierte Abnahme
- [ ] Test: Benachrichtigung erscheint nur beim Empfänger; Mandantenisolation
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
