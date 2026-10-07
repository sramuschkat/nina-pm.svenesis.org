/**
 * Personen mit Bild in Datenmasken (Wunsch Sven 30.09.2026): Mitgliederverzeichnis
 * (`GET /members/directory`, `member.directory`, einmal je Sitzung, 5 min frisch) und die angebundenen
 * Fassungen des Bausteins `MemberName` (components.md §2.22). Ohne Anmelde-Kontext (Baustein-Übersicht,
 * Tests) kein Verzeichnis: nur Symbol und Name.
 */
import { can } from '@nina-pm/shared';
import { useQuery } from '@tanstack/react-query';
import { memberApi, type MemberDirectoryEntry } from '../api/client';
import { useOptionalAuth } from '../auth';
import { MemberAvatar, MemberName } from '../components/MemberName';

export const MEMBER_DIRECTORY_KEY = ['members', 'directory'] as const;

/** Mitgliederverzeichnis des Mandanten als Map `id → Eintrag` (leer außerhalb eines Mandanten). */
export function useMemberDirectory(): ReadonlyMap<string, MemberDirectoryEntry> {
  const auth = useOptionalAuth();
  const me = auth?.me;
  const allowed = can(auth?.context ?? null, 'member.directory');
  const query = useQuery({
    queryKey: [...MEMBER_DIRECTORY_KEY, me?.tenant?.id ?? ''],
    queryFn: async () => (await memberApi.directory()).items,
    enabled: allowed && me?.context === 'tenant',
    staleTime: 5 * 60_000,
  });
  return new Map((query.data ?? []).map((m) => [m.id, m]));
}

/**
 * Person mit Bild: `id` (`app_user.id`) für das Bild, `name` aus der Zeile (historisch korrekt), sonst der Name
 * aus dem Verzeichnis.
 */
export function Person({
  id,
  name,
  size,
  compact,
}: {
  id?: string | null;
  name?: string | null;
  size?: 'sm' | 'md';
  /** Kurzform neben Projektnamen (AP-64): mehr als 10 Zeichen → 10 Zeichen + „…“, voller Name im Tooltip. */
  compact?: boolean;
}) {
  const directory = useMemberDirectory();
  const entry = id ? directory.get(id) : undefined;
  return (
    <MemberName
      name={name || entry?.displayName || '–'}
      avatarUrl={entry?.avatarUrl ?? null}
      {...(size ? { size } : {})}
      {...(compact ? { compact } : {})}
    />
  );
}

/** Name zu einer Mitglieds-ID für reinen Text (Auswahllisten, CSV); `''` ohne Eintrag. */
export function useMemberNames(): (id: string | null | undefined) => string {
  const directory = useMemberDirectory();
  return (id) => (id ? (directory.get(id)?.displayName ?? '') : '');
}

/** Nur das Bild eines Mitglieds (z. B. vor einem Satz „eingereicht von … am …“). */
export function MemberAvatarFor({
  id,
  size = 20,
}: {
  id: string | null | undefined;
  size?: number;
}) {
  const directory = useMemberDirectory();
  return <MemberAvatar url={id ? directory.get(id)?.avatarUrl : null} size={size} />;
}
