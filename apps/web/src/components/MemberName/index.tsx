/**
 * `MemberName` – Person in Datenmasken mit Discord-Bild und Namen, wie oben rechts im Benutzermenü (Wunsch
 * Sven 30.09.2026; components.md §2.22). Reiner Baustein: das Bild kommt als `avatarUrl` von der Seite (über
 * `lib/member.tsx` aus dem Mitgliederverzeichnis); ohne Bild – oder wenn es nicht lädt – das Personen-Symbol.
 */
import { useState } from 'react';
import { uiIcons } from '../icons';
import styles from './MemberName.module.css';

/** Rundes Discord-Bild bzw. Personen-Symbol. */
export function MemberAvatar({
  url,
  size = 20,
}: {
  url: string | null | undefined;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    const Icon = uiIcons.user;
    return (
      <span className={styles.fallback} style={{ width: size, height: size }} aria-hidden>
        <Icon size={Math.round(size * 0.7)} />
      </span>
    );
  }
  return (
    <img
      className={styles.avatar}
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}

export interface MemberNameProps {
  readonly name: string;
  readonly avatarUrl?: string | null;
  readonly size?: 'sm' | 'md';
}

export function MemberName({ name, avatarUrl, size = 'sm' }: MemberNameProps) {
  return (
    <span className={styles.member} data-size={size}>
      <MemberAvatar url={avatarUrl} size={size === 'md' ? 24 : 20} />
      <span className={styles.name}>{name}</span>
    </span>
  );
}
