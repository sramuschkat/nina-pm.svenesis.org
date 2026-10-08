/** Vorschau der letzten Kommentare (08.10.2026): Klartext aus Markdown, jüngste fünf chronologisch, ohne gelöschte. */
import { describe, expect, it } from 'vitest';
import type { NoteView } from '../api/client';
import { plainText, previewOf } from './project-comments';

const note = (id: string, at: string, bodyMd: string, deleted = false): NoteView => ({
  id,
  userId: '00000000-0000-4000-8000-000000000001',
  authorName: `A${id}`,
  bodyMd: deleted ? '' : bodyMd,
  createdAt: at,
  parentId: null,
  editedAt: null,
  deletedAt: deleted ? at : null,
  reactions: [],
});

describe('Kommentar-Vorschau', () => {
  it('Markdown wird lesbarer Klartext', () => {
    expect(
      plainText('## Hinweis\n**Fokus** prüfen, siehe [Log](https://x.y) und `af`.\n> Zitat'),
    ).toBe('Hinweis Fokus prüfen, siehe Log und af. Zitat');
  });

  it('jüngste fünf, ältester zuerst, gelöschte nicht, Rest als Zahl, lange Texte gekürzt', () => {
    const notes = [
      note('7', '2026-10-08T07:00:00Z', 'g'),
      note('1', '2026-10-01T07:00:00Z', 'a'),
      note('2', '2026-10-02T07:00:00Z', 'b'),
      note('3', '2026-10-03T07:00:00Z', 'c', true),
      note('4', '2026-10-04T07:00:00Z', 'd'),
      note('5', '2026-10-05T07:00:00Z', 'e'),
      note('6', '2026-10-06T07:00:00Z', 'x'.repeat(300)),
    ];
    const p = previewOf(notes, (iso) => iso.slice(0, 10));
    expect(p.older).toBe(1);
    expect(p.items.map((i) => i.id)).toEqual(['2', '4', '5', '6', '7']);
    expect(p.items[0]).toMatchObject({ author: 'A2', when: '2026-10-02', text: 'b' });
    expect(p.items[3]?.text).toHaveLength(200);
  });

  it('gleiche Sekunde: Reihenfolge der API (neueste zuerst) wird umgedreht', () => {
    const at = '2026-10-08T10:12:00Z';
    const p = previewOf(
      [note('3', at, 'drei'), note('2', at, 'zwei'), note('1', at, 'eins')],
      (x) => x,
    );
    expect(p.items.map((i) => i.text)).toEqual(['eins', 'zwei', 'drei']);
  });
});
