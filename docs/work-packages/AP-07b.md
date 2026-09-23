# AP-07b – Mitglieder, Einladungen, Admin-Rechte (Owner)

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-07a · **Menschliche Aufgaben:** –

## Ziel
Admins verwalten Mitglieder und Einladungen in S-70; nur der Owner ernennt und entzieht Admins. Folgenreiche Aktionen laufen über den Bestätigungsdialog.

## Anforderungen
FA-BEN-01…11, S-70

## Lesen (nur diese Abschnitte)
- FK 6.13, 6.14
- FK 14.3 (S-70)
- TK 5.5 (Owner-Invarianten)
- TK 7.2 (Einladungen, Mitglieder, Rollen & Owner)
- rules/ui.md
- specs/ui/components.md
- contracts/errors.json
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- S-70 Mitglieder/Einladungen: Liste mit Owner-Kennzeichen und Hinweis „Rechte ruhen – 2FA fehlt“; User einladen (Admin/Owner) und Admin einladen (nur Owner); *Zu Admin machen* mit Grund und *Admin-Rechte entziehen* – nur für den Owner sichtbar; Sitzungen eines Mitglieds beenden, deaktivieren, entfernen mit Folgen FA-BEN-11 (Entwürfe weich gelöscht, später in der Ansicht *Gelöscht* aus AP-11c wiederherstellbar)
- `ConfirmDialog` vor Rechte entziehen, Deaktivieren, Entfernen, Sitzungen beenden und Einladung widerrufen (E4)
- Austritt `POST /web/v1/me/leave` (*Mandant verlassen* im Benutzermenü, nicht für den Owner)

## Nicht im Umfang
- Owner-Übertragung und Mandanteneinstellungen (AP-07c)

## Checkliste Bildschirm (S-70)
- [ ] Jedes Feld und jede Aktion aus FK 14.3 für S-70 vorhanden (Liste im PR abhaken)
- [ ] Wiederverwendbare Bausteine nur nach `docs/specs/ui/components.md`; Abstände über `--npm-space-*`, Symbole aus `components/icons.ts`, kein Emoji
- [ ] Rechte je Rolle (Owner, Admin, User; Admin oder Owner ohne Discord-2FA wirkt als User) über `useCan` ein-/ausgeblendet; API lehnt trotzdem ab
- [ ] Folgenreiche Aktionen (Löschen, Rechte entziehen, Owner übertragen, Ablehnen, Token widerrufen, Sitzungen beenden) nur über `ConfirmDialog` (`docs/specs/ui/components.md` §2.10), nie `window.confirm`; Markdown-Felder nur über `react-markdown` ohne rohes HTML
- [ ] Zustände leer / laden / Fehler (Problem Details → i18n `errors.*`) / 412-Konflikt
- [ ] Texte DE/EN über i18n, Zeiten mit Zeitzonen-Kürzel (FK 8.1)
- [ ] Themes `light` und `dark` (Theme-Test gegen die Tokens, TK 11.3); Dichtestufen `compact`/`normal`/`wide`
- [ ] **Volle Fensterbreite ohne Obergrenze** (kein `max-width`; nur Textseiten auf Lesebreite) und **768 px** Mindestbreite ohne horizontales Scrollen – bei 768 px und bei 2400 px geprüft (NFA-01)
- [ ] Tastaturbedienung mit sichtbarem Fokusring
- [ ] `axe`-Komponententest ohne Verstöße der Stufen *serious* und *critical* (`@axe-core/playwright` im E2E bzw. `vitest-axe` im Komponententest; CI-Schritt `pnpm test:a11y`, TK 18) – **kein** Lighthouse-Schwellwert

## Automatisierte Abnahme
- [ ] UI blendet Owner-Aktionen (Admin ernennen/entziehen, Admin einladen) für Admins aus; API lehnt trotzdem ab (403)
- [ ] Admin ohne 2FA sieht nur User-Aktionen und den Hinweis `auth.mfa_required`
- [ ] E2E: Owner macht einen User zum Admin → ab der nächsten Anfrage Admin-Rechte; *Admin-Rechte entziehen* nach `ConfirmDialog` → wieder User
- [ ] E2E: *Sitzungen beenden* → das Mitglied erhält bei der nächsten Anfrage `401 auth.unauthenticated`
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
