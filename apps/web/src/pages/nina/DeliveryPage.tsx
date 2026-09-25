/**
 * S-41 „An NINA ausgeliefert“ (FK 14.3, FA-NIN-22): Infobox, was NINA erhält; Filter Standort/Teleskop/
 * Kamera bzw. Rig, Gruppieren, Sortieren, *Aktualisieren*. Karte je Ziel mit Name, Status, Einzelfeld/
 * Mosaik, RA/Dec, Rotation, Rig, Stand und Fortschritt je Filter; *Aus Auslieferung nehmen* (Admin) setzt
 * das Projekt auf *Pausiert* – nur über den `ConfirmDialog`. Die Liste kommt je Rig aus derselben Regel
 * wie `GET /nina/v1/targets` (`GET /web/v1/rigs/{id}/delivery`).
 */
import { formatNightKey } from '@nina-pm/shared';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ninaApi,
  projectsApi,
  type NinaDeliveryItem,
  type NinaRigDelivery,
} from '../../api/client';
import { useAuth, useCan } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatCoordinate } from '../../components/CoordinateInput/coords';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { ProgressBar } from '../../components/ProgressBar';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDateTime } from '../../lib/time';
import { problemCode, useConfirm } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import styles from './nina.module.css';

type Group = 'none' | 'rig' | 'status';
type Sort = 'priority' | 'name' | 'updated' | 'progress';
interface Card {
  readonly item: NinaDeliveryItem;
  readonly rig: NinaRigDelivery;
}

const progressOf = (i: NinaDeliveryItem) => {
  const planned = i.filters.reduce((s, f) => s + f.planned, 0);
  return planned > 0
    ? i.filters.reduce((s, f) => s + Math.min(f.accepted, f.planned), 0) / planned
    : 0;
};

const SORTERS: Record<Sort, (a: Card, b: Card) => number> = {
  priority: (a, b) => a.item.priority - b.item.priority || a.item.name.localeCompare(b.item.name),
  name: (a, b) => a.item.name.localeCompare(b.item.name),
  updated: (a, b) => (a.item.updatedAt < b.item.updatedAt ? 1 : -1),
  progress: (a, b) => progressOf(b.item) - progressOf(a.item),
};

export function DeliveryPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
  const [filter, setFilter] = useState({ site: '', telescope: '', camera: '', rig: '' });
  const [group, setGroup] = useState<Group>('rig');
  const [sort, setSort] = useState<Sort>('priority');

  const rigList = useMemo(
    () =>
      (rigs.data ?? []).filter(
        (r) =>
          (!filter.site || r.siteId === filter.site) &&
          (!filter.telescope || r.telescopeId === filter.telescope) &&
          (!filter.camera || r.cameraId === filter.camera) &&
          (!filter.rig || r.id === filter.rig),
      ),
    [rigs.data, filter],
  );
  const deliveries = useQueries({
    queries: rigList.map((r) => ({
      queryKey: ['nina-delivery', r.id],
      queryFn: () => ninaApi.delivery(r.id),
    })),
  });
  const loaded = deliveries.map((d) => d.data).filter((d): d is NinaRigDelivery => !!d);
  const failed = deliveries.find((d) => d.isError);
  const cards: Card[] = loaded
    .flatMap((rig) => rig.items.map((item) => ({ item, rig })))
    .sort(SORTERS[sort]);
  const groups: { key: string; title: string | null; cards: Card[] }[] =
    group === 'none'
      ? [{ key: 'all', title: null, cards }]
      : group === 'rig'
        ? loaded.map((rig) => ({
            key: rig.rigId,
            title: `${t('nina.delivery.rigName', { name: rig.rigName })} · ${t('nina.delivery.night', { night: formatNightKey(rig.night) })}`,
            cards: cards.filter((c) => c.rig.rigId === rig.rigId),
          }))
        : [...new Set(cards.map((c) => c.item.status))].map((status) => ({
            key: status,
            title: t(`status.project.${status}`),
            cards: cards.filter((c) => c.item.status === status),
          }));
  const refresh = () => client.invalidateQueries({ queryKey: ['nina-delivery'] });
  const RefreshIcon = actionIcons.refresh;
  const select = (
    id: string,
    label: string,
    value: string,
    options: readonly { id: string; name: string }[],
    key: keyof typeof filter,
  ) => (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className={styles.input}
        value={value}
        onChange={(e) => setFilter({ ...filter, [key]: e.target.value })}
      >
        <option value="">{t('nina.delivery.all')}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>{t('nina.delivery.title')}</h1>
        <button
          type="button"
          className={styles.button}
          onClick={() => void refresh()}
          disabled={deliveries.some((d) => d.isFetching)}
        >
          <RefreshIcon size={ICON_SIZE.button} aria-hidden />
          {t('nina.delivery.refresh')}
        </button>
      </div>
      <p className={styles.info}>{t('nina.delivery.info')}</p>
      <div className={styles.toolbar}>
        {select(
          'delivery-site',
          t('nina.delivery.filterSite'),
          filter.site,
          sites.data ?? [],
          'site',
        )}
        {select(
          'delivery-telescope',
          t('nina.delivery.filterTelescope'),
          filter.telescope,
          telescopes.data ?? [],
          'telescope',
        )}
        {select(
          'delivery-camera',
          t('nina.delivery.filterCamera'),
          filter.camera,
          cameras.data ?? [],
          'camera',
        )}
        {select('delivery-rig', t('nina.delivery.filterRig'), filter.rig, rigs.data ?? [], 'rig')}
        <div className={styles.field}>
          <label htmlFor="delivery-group">{t('nina.delivery.group')}</label>
          <select
            id="delivery-group"
            className={styles.input}
            value={group}
            onChange={(e) => setGroup(e.target.value as Group)}
          >
            <option value="none">{t('nina.delivery.groupNone')}</option>
            <option value="rig">{t('nina.delivery.groupRig')}</option>
            <option value="status">{t('nina.delivery.groupStatus')}</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="delivery-sort">{t('nina.delivery.sort')}</label>
          <select
            id="delivery-sort"
            className={styles.input}
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value="priority">{t('nina.delivery.sortPriority')}</option>
            <option value="name">{t('nina.delivery.sortName')}</option>
            <option value="updated">{t('nina.delivery.sortUpdated')}</option>
            <option value="progress">{t('nina.delivery.sortProgress')}</option>
          </select>
        </div>
      </div>

      {rigs.isPending || deliveries.some((d) => d.isPending) ? (
        <p role="status">{t('common.loading')}</p>
      ) : rigs.isError ? (
        <ProblemMessage code={problemCode(rigs.error)} onRetry={() => void rigs.refetch()} />
      ) : failed ? (
        <ProblemMessage code={problemCode(failed.error)} onRetry={() => void refresh()} />
      ) : (
        <>
          {loaded
            .filter((r) => !r.deliveryEnabled)
            .map((r) => (
              <p key={r.rigId} className={styles.pillWarn}>
                {t('nina.delivery.deliveryOff', { rig: r.rigName })}
              </p>
            ))}
          {cards.length === 0 ? (
            <p className={styles.muted}>{t('nina.delivery.empty')}</p>
          ) : (
            groups
              .filter((g) => g.cards.length > 0)
              .map((g) => (
                <section
                  key={g.key}
                  className={styles.group}
                  aria-label={g.title ?? t('nina.delivery.title')}
                >
                  {g.title ? <h2>{g.title}</h2> : null}
                  <div className={styles.cards}>
                    {g.cards.map((c) => (
                      <DeliveryCard key={c.item.id} card={c} />
                    ))}
                  </div>
                </section>
              ))
          )}
        </>
      )}
    </div>
  );
}

function DeliveryCard({ card }: { card: Card }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const { me } = useAuth();
  const canRemove = useCan('project.status');
  const { item, rig } = card;
  const zone = me?.tenant?.timeZone ?? 'Europe/Berlin';
  const remove = useConfirm(async () => {
    await projectsApi.setStatus(item.id, 'on_hold');
    await client.invalidateQueries({ queryKey: ['nina-delivery'] });
  });
  const headingId = `delivery-${item.id}`;
  return (
    <article className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h3 id={headingId}>{item.name}</h3>
        <StatusBadge kind="project" value={item.status} />
      </div>
      <p className={styles.facts}>
        <span>
          {item.panelCount > 1
            ? t('nina.delivery.mosaic', { count: item.panelCount })
            : t('nina.delivery.single')}
        </span>
        {item.raDeg !== null && item.decDeg !== null ? (
          <span>
            {t('nina.delivery.coordinates', {
              ra: formatCoordinate('ra', item.raDeg, 'sexagesimal'),
              dec: formatCoordinate('dec', item.decDeg, 'sexagesimal'),
            })}
          </span>
        ) : null}
        {item.rotationDeg !== null ? (
          <span>{t('nina.delivery.rotation', { deg: item.rotationDeg.toFixed(1) })}</span>
        ) : null}
        <span>{t('nina.delivery.rigName', { name: rig.rigName })}</span>
        <span>
          {t('nina.delivery.updated', { at: formatDateTime(item.updatedAt, zone, i18n.language) })}
        </span>
      </p>
      <dl className={styles.filters}>
        {item.filters.map((f) => (
          <div key={f.filterId ?? f.filterShortName} className={styles.filterRow}>
            <dt>
              {f.filterShortName}
              {f.ninaFilterName === null ? (
                <>
                  {' '}
                  <span className={styles.pillWarn}>{t('nina.delivery.unmapped')}</span>
                </>
              ) : null}
            </dt>
            <dd>
              <ProgressBar acquired={f.accepted} planned={f.planned} size="sm" />
            </dd>
          </div>
        ))}
      </dl>
      {canRemove ? (
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={remove.open}>
            {t('nina.delivery.remove')}
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        {...remove.dialog}
        title={t('nina.delivery.removeTitle', { name: item.name })}
        consequence={t('nina.delivery.removeConsequence')}
        confirmLabel={t('nina.delivery.remove')}
      />
    </article>
  );
}
