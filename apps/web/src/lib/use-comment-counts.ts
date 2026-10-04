/**
 * Kommentaranzahl je Projekt (FA-PRJ-17) für Seiten, deren Daten sie nicht selbst tragen (*Heute Nacht*, Zielkarten
 * des Simulators): aus der Projektliste, die Übersicht und Projektliste mit demselben Schlüssel cachen.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { projectsApi } from '../api/client';

export const PROJECT_LIST_KEY = ['projects', 'list'] as const;

export function useCommentCounts(): (projectId: string) => number {
  const list = useQuery({
    queryKey: PROJECT_LIST_KEY,
    queryFn: async () => (await projectsApi.list()).items,
  });
  const counts = useMemo(
    () => new Map((list.data ?? []).map((p) => [p.id, p.commentCount] as const)),
    [list.data],
  );
  return (projectId) => counts.get(projectId) ?? 0;
}
