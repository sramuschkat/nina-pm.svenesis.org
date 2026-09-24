/**
 * Sortierkette per Ziehen (FA-SCH-03, sort-chain.md): geordnete Liste der Schlüssel aus
 * `sortChainKeys`, jeder höchstens einmal; leer ist erlaubt. Tastatur-Alternative: *nach oben* /
 * *nach unten* / *entfernen* je Eintrag und *hinzufügen* aus den übrigen Schlüsseln.
 */
import { sortChainKeys, type SortChainKey } from '@nina-pm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ICON_SIZE, actionIcons, uiIcons } from '../../components/icons';
import styles from './equipment.module.css';

/** i18n-Schlüssel je Sortierschlüssel (sort-chain.md, Spalte „Anzeige“). */
const LABEL: Record<SortChainKey, string> = {
  lowest_peak_altitude: 'sortChain.lowestPeakAltitude',
  setting_soonest: 'sortChain.settingSoonest',
  most_remaining: 'sortChain.mostRemaining',
  constrained: 'sortChain.constrained',
  most_moon_limited: 'sortChain.mostMoonLimited',
  mosaic_grouping: 'sortChain.mosaicGrouping',
  card_order: 'sortChain.cardOrder',
  due_soonest: 'sortChain.dueSoonest',
};

export const DEFAULT_SORT_CHAIN: readonly SortChainKey[] = [
  'lowest_peak_altitude',
  'setting_soonest',
  'most_remaining',
  'constrained',
];

/** Verschiebt den Eintrag `from` an die Stelle `to` (Ziehen und Tastatur). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

export function SortChainEditor({
  value,
  onChange,
  disabled,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState<number | null>(null);
  const label = (key: string) => (key in LABEL ? t(LABEL[key as SortChainKey]) : key);
  const unused = sortChainKeys.filter((k) => !value.includes(k));
  const Up = uiIcons.up;
  const Down = uiIcons.down;
  const Remove = actionIcons.delete;
  const Add = actionIcons.add;
  return (
    <div className={styles.listEditor}>
      <ol className={styles.chain} aria-label={t('rigs.scheduler.sortChain')}>
        {value.map((key, i) => (
          <li
            key={key}
            className={styles.chainItem}
            draggable={!disabled}
            data-dragging={dragging === i ? 'true' : undefined}
            onDragStart={(e) => {
              setDragging(i);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(i));
            }}
            onDragOver={(e) => {
              if (dragging !== null) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragging ?? Number(e.dataTransfer.getData('text/plain'));
              if (Number.isInteger(from) && from !== i) onChange(moveItem(value, from, i));
              setDragging(null);
            }}
            onDragEnd={() => setDragging(null)}
          >
            <span className={styles.chainRank}>{i + 1}.</span>
            <span className={styles.chainLabel}>{label(key)}</span>
            {disabled ? null : (
              <span className={styles.inline}>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('rigs.scheduler.moveUp', { name: label(key) })}
                  disabled={i === 0}
                  onClick={() => onChange(moveItem(value, i, i - 1))}
                >
                  <Up size={ICON_SIZE.table} aria-hidden />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('rigs.scheduler.moveDown', { name: label(key) })}
                  disabled={i === value.length - 1}
                  onClick={() => onChange(moveItem(value, i, i + 1))}
                >
                  <Down size={ICON_SIZE.table} aria-hidden />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('rigs.scheduler.removeKey', { name: label(key) })}
                  onClick={() => onChange(value.filter((k) => k !== key))}
                >
                  <Remove size={ICON_SIZE.table} aria-hidden />
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {value.length === 0 ? <p className={styles.muted}>{t('rigs.scheduler.chainEmpty')}</p> : null}
      {disabled || unused.length === 0 ? null : (
        <div className={styles.inline}>
          {unused.map((key) => (
            <button
              key={key}
              type="button"
              className={styles.button}
              onClick={() => onChange([...value, key])}
            >
              <Add size={ICON_SIZE.table} aria-hidden />
              {label(key)}
            </button>
          ))}
        </div>
      )}
      {disabled ? null : (
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => onChange([...DEFAULT_SORT_CHAIN])}
        >
          {t('rigs.scheduler.chainDefault')}
        </button>
      )}
    </div>
  );
}
