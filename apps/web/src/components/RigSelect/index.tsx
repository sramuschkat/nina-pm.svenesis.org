/**
 * `RigSelect` (components.md §2.7): Radix `Select`; je Zeile Name fett, darunter Standort · Teleskop ·
 * Kamera · Skala · Bildfeld. Rigs mit `showInPlanning = false` unter einem Trenner, wählbar mit Hinweis.
 * `rigs` leer → `empty` („kein Rig konfiguriert“, optional Aktion).
 */
import * as Select from '@radix-ui/react-select';
import { useTranslation } from 'react-i18next';
import { ICON_SIZE, uiIcons } from '../icons';
import styles from './RigSelect.module.css';

export interface RigOption {
  id: string;
  name: string;
  siteName: string;
  telescopeName: string;
  cameraName: string;
  scaleArcsecPx: number;
  fovDeg: [number, number];
  showInPlanning: boolean;
}

export interface RigSelectProps {
  rigs: readonly RigOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  includeAll?: boolean;
  disabled?: boolean;
  onEmptyAction?: () => void;
  label?: string;
}

const ALL = '__all__';

function detail(r: RigOption, lang: string): string {
  const nf = (n: number, d: number) =>
    new Intl.NumberFormat(lang, { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
  return `${r.siteName} · ${r.telescopeName} · ${r.cameraName} · ${nf(r.scaleArcsecPx, 2)}″/px · ${nf(r.fovDeg[0], 1)}°×${nf(r.fovDeg[1], 1)}°`;
}

export function RigSelect({
  rigs,
  value,
  onChange,
  includeAll,
  disabled,
  onEmptyAction,
  label,
}: RigSelectProps) {
  const { t, i18n } = useTranslation();
  const Chevron = uiIcons.menu;
  if (rigs.length === 0) {
    return (
      <div className={styles.empty}>
        <span>{t('rigSelect.empty')}</span>
        {onEmptyAction ? (
          <button type="button" className={styles.link} onClick={onEmptyAction}>
            {t('rigSelect.emptyAction')}
          </button>
        ) : null}
      </div>
    );
  }
  const planned = rigs.filter((r) => r.showInPlanning);
  const hidden = rigs.filter((r) => !r.showInPlanning);
  const item = (r: RigOption) => (
    <Select.Item key={r.id} value={r.id} className={styles.item} textValue={r.name}>
      <Select.ItemText>
        <span className={styles.name}>{r.name}</span>
      </Select.ItemText>
      <span className={styles.detail}>{detail(r, i18n.language)}</span>
    </Select.Item>
  );
  return (
    <Select.Root
      value={value ?? (includeAll ? ALL : undefined)}
      onValueChange={(v) => onChange(v === ALL ? null : v)}
      disabled={disabled}
    >
      <Select.Trigger className={styles.trigger} aria-label={label ?? t('rigSelect.placeholder')}>
        <Select.Value placeholder={t('rigSelect.placeholder')} />
        <Select.Icon>
          <Chevron size={ICON_SIZE.table} aria-hidden />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className={styles.content} position="popper" sideOffset={4}>
          <Select.Viewport>
            {includeAll ? (
              <Select.Item value={ALL} className={styles.item}>
                <Select.ItemText>{t('rigSelect.all')}</Select.ItemText>
              </Select.Item>
            ) : null}
            {planned.map(item)}
            {hidden.length > 0 ? (
              <>
                <Select.Separator className={styles.separator} />
                <Select.Group>
                  <Select.Label className={styles.groupLabel}>
                    {t('rigSelect.notInPlanning')}
                  </Select.Label>
                  {hidden.map(item)}
                </Select.Group>
              </>
            ) : null}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
