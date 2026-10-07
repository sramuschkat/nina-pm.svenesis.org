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
  /**
   * Kurzform neben Projektnamen (AP-64, Entscheidung Sven 07.10.2026): Namen mit mehr als 10 Zeichen werden auf die
   * ersten 10 Zeichen plus „…“ gekürzt; der volle Name steht im Tooltip und im zugänglichen Namen.
   */
  readonly compact?: boolean;
}

/** Höchstlänge der Kurzform (Zeichen, nicht Code-Einheiten). */
export const COMPACT_NAME_MAX = 10;

/**
 * Kurzform eines Namens: bis `max` Zeichen unverändert, sonst die ersten `max` Zeichen plus „…“. Gezählt werden
 * Schriftzeichen (Graphem-Cluster), damit Umlaute – auch zerlegt geschrieben – und Emoji als ein Zeichen gelten.
 */
export function compactName(name: string, max = COMPACT_NAME_MAX): string {
  const chars =
    typeof Intl.Segmenter === 'function'
      ? Array.from(
          new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name),
          (s) => s.segment,
        )
      : Array.from(name);
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : name;
}

export function MemberName({ name, avatarUrl, size = 'sm', compact = false }: MemberNameProps) {
  const shown = compact ? compactName(name) : name;
  const cut = shown !== name;
  return (
    <span
      className={styles.member}
      data-size={size}
      data-compact={compact || undefined}
      // Gekürzt: voller Name als Tooltip und zugänglicher Name (Bild + Kurzname bilden eine Grafik).
      {...(cut ? { title: name, 'aria-label': name, role: 'img' } : {})}
    >
      <MemberAvatar url={avatarUrl} size={size === 'md' ? 24 : 20} />
      <span className={styles.name} {...(cut ? { 'aria-hidden': true } : {})}>
        {shown}
      </span>
    </span>
  );
}
