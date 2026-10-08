/**
 * Kommentar-Sprechblase mit Vorschau (08.10.2026): `CommentCount` plus die letzten Kommentare des Projekts als
 * Tooltip. Geladen wird erst beim ersten Öffnen (gleicher Abfrageschlüssel wie der Reiter *Kommentare*, also aus dem
 * Cache, wenn dort schon geladen). Gezeigt werden die jüngsten `PREVIEW_COUNT` nicht gelöschten Kommentare –
 * Antworten eingeschlossen –, ältester zuerst, als gekürzter Klartext.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { projectsApi, type NoteView } from '../api/client';
import { CommentCount, type CommentPreview } from '../components/CommentCount';

export const PREVIEW_COUNT = 5;
const TEXT_MAX = 200;

/** Markdown grob zu Klartext (Links → Text, Zeichen für Hervorhebung, Überschriften, Zitate, Code weg). */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Letzte Kommentare chronologisch (ältester zuerst) und Anzahl der älteren. */
export function previewOf(
  notes: readonly NoteView[],
  format: (iso: string) => string,
): Omit<CommentPreview, 'state'> {
  // Die API liefert die neuesten zuerst; umgedreht bleibt bei gleicher Sekunde der ältere vorn (stabile Sortierung).
  const visible = [...notes]
    .reverse()
    .filter((n) => n.deletedAt === null)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const last = visible.slice(-PREVIEW_COUNT);
  return {
    older: visible.length - last.length,
    items: last.map((n) => {
      const text = plainText(n.bodyMd);
      return {
        id: n.id,
        author: n.authorName,
        when: format(n.createdAt),
        text: text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1)}…` : text,
      };
    }),
  };
}

export function ProjectCommentCount({ projectId, count }: { projectId: string; count: number }) {
  const { i18n } = useTranslation();
  const [wanted, setWanted] = useState(false);
  const notes = useQuery({
    queryKey: ['project-notes', projectId],
    queryFn: async () => (await projectsApi.notes(projectId)).items,
    enabled: wanted && count > 0,
    staleTime: 60_000,
  });
  const format = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      Date.parse(iso),
    );
  const preview: CommentPreview = notes.isError
    ? { state: 'error', items: [], older: 0 }
    : notes.data
      ? { state: 'ready', ...previewOf(notes.data, format) }
      : { state: 'loading', items: [], older: 0 };
  return <CommentCount count={count} preview={preview} onPreviewOpen={() => setWanted(true)} />;
}
