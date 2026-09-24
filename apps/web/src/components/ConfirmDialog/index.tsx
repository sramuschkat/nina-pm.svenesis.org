/**
 * `ConfirmDialog` (specs/ui/components.md §2.10, E4): Pflicht vor jeder folgenreichen Aktion; nie
 * `window.confirm`. Radix `AlertDialog`: Fokus beim Öffnen auf *Abbrechen* (bei Namenseingabe auf dem
 * Feld), `Esc` = Abbrechen, Klick außerhalb schließt nicht, `onConfirm` genau einmal.
 */
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { actionIcons, ICON_SIZE, uiIcons } from '../icons';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  /** Frage mit Objektname, z. B. „Projekt NGC 7380 löschen?“ (über 60 Zeichen gekürzt). */
  title: string;
  /** Folgen in einem Satz. */
  consequence: string;
  /** Verb, nie „OK“/„Ja“. */
  confirmLabel: string;
  variant?: 'default' | 'danger';
  /** Namenseingabe (nur Mandant löschen, immer mit `danger`). */
  confirmName?: string;
  state?: 'ready' | 'loading' | 'error';
  /** `errors.*`-i18n-Schlüssel für `state = 'error'`. */
  errorKey?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

const MAX_TITLE = 60;

export function ConfirmDialog({
  open,
  title,
  consequence,
  confirmLabel,
  variant = 'default',
  confirmName,
  state = 'ready',
  errorKey,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const danger = variant === 'danger' || confirmName !== undefined;
  const [typed, setTyped] = useState('');
  const [touched, setTouched] = useState(false);
  // Doppelklick/Enter-Wiederholung: nur ein Aufruf, bis der Aufrufer den Zustand wieder freigibt.
  const firing = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();

  useEffect(() => {
    if (open) {
      setTyped('');
      setTouched(false);
    }
  }, [open]);
  useEffect(() => {
    if (state !== 'loading') firing.current = false;
  }, [state]);

  const loading = state === 'loading';
  const nameOk = confirmName === undefined || typed.trim() === confirmName;
  const shortTitle = title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE)}…` : title;

  const fire = () => {
    if (firing.current || loading || !nameOk) return;
    firing.current = true;
    void Promise.resolve(onConfirm()).finally(() => {
      // Hält der Aufrufer keinen `loading`-Zustand, wird der Knopf nach dem Aufruf wieder frei.
      if (stateRef.current !== 'loading') firing.current = false;
    });
  };

  const Warning = actionIcons.warning;
  const Spinner = uiIcons.loading;

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !loading) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={styles.overlay} />
        <AlertDialog.Content
          className={styles.content}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (confirmName !== undefined ? nameRef.current : cancelRef.current)?.focus();
          }}
          onEscapeKeyDown={(e) => {
            if (loading) e.preventDefault();
          }}
        >
          <AlertDialog.Title className={styles.title} title={title}>
            {danger ? (
              <Warning size={ICON_SIZE.button} aria-hidden className={styles.warning} />
            ) : null}
            <span>{shortTitle}</span>
          </AlertDialog.Title>
          <AlertDialog.Description className={styles.consequence}>
            {consequence}
          </AlertDialog.Description>

          {confirmName !== undefined ? (
            <div className={styles.nameField}>
              <label htmlFor={nameId}>{t('confirm.nameLabel', { name: confirmName })}</label>
              <input
                id={nameId}
                ref={nameRef}
                value={typed}
                autoComplete="off"
                spellCheck={false}
                disabled={loading}
                onChange={(e) => setTyped(e.target.value)}
                onBlur={() => setTouched(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (nameOk) fire();
                  }
                }}
                aria-invalid={touched && !nameOk}
              />
              {touched && !nameOk ? (
                <p className={styles.fieldError}>
                  {t('confirm.nameMismatch', { name: confirmName })}
                </p>
              ) : null}
            </div>
          ) : null}

          <div aria-live="assertive" className={styles.live}>
            {state === 'error' && errorKey ? <p className={styles.error}>{t(errorKey)}</p> : null}
          </div>

          <div className={styles.actions}>
            <AlertDialog.Cancel asChild>
              <button ref={cancelRef} type="button" className={styles.cancel} disabled={loading}>
                {t('common.cancel')}
              </button>
            </AlertDialog.Cancel>
            <button
              type="button"
              className={danger ? styles.danger : styles.confirm}
              disabled={loading || !nameOk}
              aria-busy={loading}
              onClick={fire}
            >
              {loading ? (
                <Spinner size={ICON_SIZE.table} aria-hidden className={styles.spin} />
              ) : null}
              {loading ? <span className="visually-hidden">{t('confirm.working')}</span> : null}
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
