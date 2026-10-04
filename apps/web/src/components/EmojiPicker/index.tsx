/**
 * `EmojiPicker` (FA-PRJ-17, components.md §2.23): Knopf mit Symbol, der eine feste Auswahl als Raster öffnet
 * (Radix `Popover`, `Esc` schließt, Fokus zurück auf den Knopf). Die Auswahl kommt vom Aufrufer – Emoji im
 * Kommentartext bzw. die Reaktionen aus `commentReactions`; der Baustein kennt keine Liste und keine Rechte.
 * Emoji sind hier Inhalt der Nutzer, keine Symbole der Oberfläche (rules/ui.md: Symbole bleiben Lucide).
 */
import * as Popover from '@radix-ui/react-popover';
import { useState, type ComponentType } from 'react';
import { ICON_SIZE } from '../icons';
import styles from './EmojiPicker.module.css';

export interface EmojiPickerProps {
  /** Feste Auswahl in Anzeigereihenfolge. */
  emojis: readonly string[];
  onPick: (emoji: string) => void;
  /** Beschriftung des Knopfs (Tooltip und `aria-label`) und der Auswahl. */
  label: string;
  /** Lucide-Symbol des Knopfs aus `components/icons.ts`. */
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  /** Bereits gewählte Einträge (z. B. eigene Reaktionen) – `aria-pressed`. */
  selected?: readonly string[];
  disabled?: boolean;
}

export function EmojiPicker({
  emojis,
  onPick,
  label,
  icon: Icon,
  selected = [],
  disabled = false,
}: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        className={styles.trigger}
        aria-label={label}
        title={label}
        disabled={disabled}
      >
        <Icon size={ICON_SIZE.table} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={styles.panel} align="start" sideOffset={4} aria-label={label}>
          <div className={styles.grid} role="group" aria-label={label}>
            {emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={styles.emoji}
                aria-label={emoji}
                aria-pressed={selected.includes(emoji)}
                onClick={() => {
                  onPick(emoji);
                  setOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
