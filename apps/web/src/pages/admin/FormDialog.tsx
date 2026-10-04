import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useRef, type ReactNode } from 'react';
import styles from './admin.module.css';
import local from './members.module.css';

/**
 * Formular-Dialog (Radix `AlertDialog` wie der `ConfirmDialog`, hier mit Rolle `dialog`): Fokus beim Öffnen
 * auf das erste Feld, `Esc` schließt, Klick außerhalb schließt nicht (keine Eingaben verlieren), danach
 * kehrt der Fokus zum auslösenden Knopf zurück.
 */
export function FormDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Auslösender Knopf; fehlt bei Dialogen, die die Seite selbst öffnet (z. B. aus dem ⋯-Menü). */
  trigger?: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger> : null}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={local.overlay} />
        <AlertDialog.Content
          ref={contentRef}
          role="dialog"
          className={local.dialog}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            contentRef.current
              ?.querySelector<HTMLElement>('input, select, textarea, button')
              ?.focus();
          }}
        >
          <AlertDialog.Title className={local.dialogTitle}>{title}</AlertDialog.Title>
          <AlertDialog.Description className={styles.muted}>{description}</AlertDialog.Description>
          {children}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
