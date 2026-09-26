/**
 * `ActionMenu` – ⋯-Menü für seltene oder folgenreiche Aktionen (components.md §2.15, Stilsystem AP-26d):
 * Zeilenaktionen in Tabellen, *Löschen* im Seitenkopf. Radix-Dropdown mit Tastatur (Pfeile, `Esc`);
 * Gefahr-Einträge in der Gefahrenfarbe, die Bestätigung bleibt beim Aufrufer (`ConfirmDialog`).
 */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { ICON_SIZE } from '../icons';
import styles from './ActionMenu.module.css';

export interface ActionMenuItem {
  readonly key: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly onSelect: () => void;
  readonly danger?: boolean;
  readonly disabled?: boolean;
}

/** Drei Punkte (Lucide `ellipsis`), inline, damit `icons.ts` unverändert bleibt. */
function Ellipsis({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

export function ActionMenu({
  label,
  items,
  size = 'md',
}: {
  /** Zugänglicher Name des Knopfs, z. B. „Weitere Aktionen zu M 31“. */
  label: string;
  items: readonly ActionMenuItem[];
  size?: 'sm' | 'md';
}) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className={`${styles.trigger} ${size === 'sm' ? styles.sm : ''}`}
        aria-label={label}
        title={label}
      >
        <Ellipsis size={size === 'sm' ? ICON_SIZE.table : ICON_SIZE.button} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.menu} align="end" sideOffset={4}>
          {items.map((i) => (
            <DropdownMenu.Item
              key={i.key}
              className={`${styles.item} ${i.danger ? styles.danger : ''}`}
              disabled={i.disabled}
              onSelect={i.onSelect}
            >
              {i.icon}
              {i.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
