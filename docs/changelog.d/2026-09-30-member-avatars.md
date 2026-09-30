### Personen mit Discord-Bild in allen Datenmasken (2026-09-30)

Anforderungen: FA-BEN-04, FA-WEB-04, components.md §2.22 · Wunsch Sven 30.09.2026 („überall, wo der Username verwendet wird, Userbild und Name wie oben rechts“); Datenschutz-Ergänzung von Sven entschieden

- Neuer Baustein **`MemberName`** (rundes Discord-Bild + Name; ohne Bild bzw. bei Ladefehler Personen-Symbol) und Anbindung `lib/member.tsx` (`Person`, `MemberAvatarFor`).
- Eingesetzt in: Projektliste (Ersteller, Papierkorb), Warteschlange (Einreicher, Entscheidung mit Stimmen je Person), Änderungsantrag- und Transit-Entscheidung, Notizen, Verlauf, Änderungsanträge (Antragsteller, Entscheider), Exoplanet-Transit (Konflikt-Hinweis, Projekte anderer Mitglieder), Sitzungsprotokoll (gespeichert von), Startseite (Warteschlange), Mitglieder (Liste, Detail), Änderungsprotokoll (handelnd). Tooltips bleiben Text; System-Bereich unverändert.
- Neu: `GET /api/web/v1/members/directory` (Aktion **`member.directory`**, jedes Mitglied): Name, fertige Bild-Adresse (`cdn.discordapp.com`, nur wohlgeformte Werte), Status – auch deaktivierte/entfernte Mitglieder, keine Rollen.
- Verträge um Mitglieds-IDs ergänzt: `ChangeRequestView.decidedBy`, `ExoTransitConflict.createdBy`, `ExoProjectDetail.others[].createdBy`, `SessionLogView.updatedBy`, `ChangeLogEntry.actorId`.
- **Datenschutz** (DE/EN): „Andere Mitglieder deines Mandanten sehen deinen Anzeigenamen und dein Discord-Profilbild.“
- TK (Aktion, Route), `components.md` §2.22. Tests: API (Verzeichnis, Rechte-Beispiel), Rechtematrix, Baustein/Anbindung; E2E 54 grün.
