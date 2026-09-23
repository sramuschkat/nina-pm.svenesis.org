# AP-07c – Mandanteneinstellungen, Owner-Übertragung, Protokolle

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-07b · **Menschliche Aufgaben:** –

## Ziel
Mandanteneinstellungen, die sofortige Owner-Übertragung, das Änderungsprotokoll und die eigenen Anmeldesitzungen sind bedienbar. Damit ist die Benutzerverwaltung R1 vollständig.

## Anforderungen
FA-BEN-09, FA-ADM, S-70, S-71, S-72, S-73

## Lesen (nur diese Abschnitte)
- FK 6.12–6.14
- FK 14.3 (S-70 *Owner übertragen*, S-71…S-73)
- TK 5.3 (Sitzungsliste)
- TK 7.2 (Mandant, Rollen & Owner, Auth)
- rules/ui.md
- specs/ui/components.md
- contracts/errors.json
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- S-71 Mandanteneinstellungen (Reiter *Allgemein*; Schlüssel ausschließlich aus `contracts/enums.json` `tenantSettingsKeys`) – **kein** Reiter *Sicherheit*: Sitzungsdauer und 2FA-Regel sind fest (SV-01, SV-03)
- *Owner übertragen* in S-70 (nur Owner): Auswahl eines aktiven Admins, `ConfirmDialog` („Owner-Rolle an … übertragen? Du bleibst Admin.“), wirkt sofort über `POST /web/v1/tenant/owner-transfer`
- S-72 Änderungsprotokoll (`GET /web/v1/audit/changes`)
- S-73 persönliche Einstellungen und Anmeldesitzungen (`GET/DELETE /auth/sessions`, *Beenden* je Sitzung und *Überall abmelden* mit `ConfirmDialog`, letzte Anmeldung aus `identity.last_login_at`)

## Nicht im Umfang
- Discord-Reiter (AP-60)

## Checkliste Bildschirm (S-71…S-73)
- [ ] Jedes Feld und jede Aktion aus FK 14.3 für S-71…S-73 vorhanden (Liste im PR abhaken)
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
- [ ] E2E: Owner überträgt nach `ConfirmDialog` an einen Admin → der Empfänger ist sofort Owner, der alte Owner bleibt Admin
- [ ] *Owner übertragen* ist für Admins nicht sichtbar; die API lehnt mit 403 ab
- [ ] unbekannter Schlüssel auf `PATCH /web/v1/tenant/settings` → `422 validation.failed`
- [ ] E2E: *Überall abmelden* → ein zweiter Tab erhält bei der nächsten Anfrage `401 auth.unauthenticated`
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
