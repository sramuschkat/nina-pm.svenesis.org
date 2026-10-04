### Kommentare am Projekt (2026-10-04)

Anforderungen: FA-PRJ-17 (Ausbau der Notizen, Entscheidung Sven 04.10.2026)

- Reiter *Notizen* heißt *Kommentare*: alle, die das Projekt sehen dürfen, kommentieren (Markdown ohne rohes HTML, Emoji über eine feste Auswahl im Eingabefeld) und antworten eine Ebene tief – eine Antwort auf eine Antwort hängt sich an denselben Strang.
- Reaktionen aus fester Auswahl (👍 ❤️ 🎉 😄 😮 🙏 🔭, `enums.json commentReactions`) mit Zähler; ein Klick setzt bzw. entfernt die eigene.
- Bearbeiten nur der Verfasser, höchstens 1 h nach dem Anlegen (`409 comment.edit_window_closed`), Kennzeichen „bearbeitet“; Löschen nur Admin/Owner (`project.note.delete`), weich – „Kommentar gelöscht“, Antworten bleiben.
- Benachrichtigung `project.comment` an den Ersteller des Projekts und alle bisherigen Verfasser (aktive Mitglieder), nie an den Verfasser selbst.
- Sprechblase mit Anzahl (`commentCount`, eine gruppierte Abfrage je Liste) in Projektliste (Liste, Karten, Detail), Freigabe-Warteschlange, Entwürfen, *An NINA ausgeliefert* und Projektbericht.
- API: `/projects/{id}/notes` bleibt und wird erweitert (`parentId`), neu `PATCH`/`DELETE /projects/{id}/notes/{noteId}` und `PUT …/reactions {emoji, active}`. `project.note.write` gilt jetzt wie `project.read`.
- Migration 0012 (additiv): `project_note.parent_id`, `edited_at`, `deleted_at`, `deleted_by`; Tabelle `project_note_reaction` mit GRANTs. Vor dem Deploy: `pnpm test:dsql`-Protokoll (Sven).
