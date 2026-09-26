/**
 * Bereich *Filterradbelegung – Zuordnung zu NINA* auf S-10 (FA-RIG-14, NT-E1, FK 14.3): je Platz
 * Web-Filter, von NINA gemeldeter Name, NINA-Filtername (vorbelegt mit dem Vorschlag der Heuristik aus
 * `GET …/filter-wheel`) und Status *bestätigt* / *Vorschlag – nicht bestätigt* / *nicht zugeordnet* /
 * *von NINA geändert*. Bestätigen je Zeile oder *Alle Vorschläge bestätigen* (ConfirmDialog), nur
 * Admin/Owner (`rig.settings.write`); alle anderen lesend. Nicht bestätigte Plätze plant die Engine
 * nicht ein.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { equipmentApi, type FilterWheelView, type RigView } from '../../api/client';
import { ApiError, useAuth } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { FilterChip } from '../../components/FilterChip';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage, problemI18nKey } from '../../components/ProblemMessage';
import { formatDateTime } from '../../lib/time';
import styles from './equipment.module.css';
import { equipmentKey, problemCode, useEquipmentList } from './shared';

type Slot = FilterWheelView['slots'][number];

export type SlotStatus = 'confirmed' | 'suggested' | 'unassigned' | 'changed';

/** Status eines Platzes (FK 14.3 S-10): „von NINA geändert“ vor „bestätigt“. */
export function slotStatus(slot: Slot): SlotStatus {
  if (slot.changedByNina) return 'changed';
  if (slot.ninaFilterName !== null && slot.ninaConfirmedAt !== null) return 'confirmed';
  const filter = slot.filterId ?? slot.suggestedFilterId;
  // Vorschlag nur aus der Heuristik; ohne Web-Filter der gemeldete Name (FA-RIG-14).
  const name = slot.suggestion ?? (slot.filterId ? null : slot.reportedName);
  return filter !== null && name !== null ? 'suggested' : 'unassigned';
}

const STATUS_CLASS: Record<SlotStatus, string | undefined> = {
  confirmed: styles.statusOk,
  suggested: styles.statusWarn,
  unassigned: styles.statusNone,
  changed: styles.statusDanger,
};

interface Row {
  position: number;
  filterId: string | null;
  ninaFilterName: string | null;
}

/** Entwurf je Platz: bestätigte Werte, sonst Vorschlag (Filter aus dem Kurznamen, NINA-Name). */
export function draftRows(view: FilterWheelView): Row[] {
  return view.slots.map((s) => {
    const filterId = s.filterId ?? s.suggestedFilterId;
    const confirmed = s.ninaConfirmedAt !== null ? s.ninaFilterName : null;
    return {
      position: s.position,
      filterId,
      ninaFilterName: confirmed ?? s.suggestion ?? (s.filterId ? null : s.reportedName),
    };
  });
}

/**
 * Nutzlast für `PUT …/filter-wheel`: bestätigte Plätze unverändert, die zu bestätigenden mit ihrem
 * Entwurf, alle übrigen ohne NINA-Namen (der Server bestätigt jeden gesendeten Namen).
 */
export function confirmPayload(view: FilterWheelView, rows: Row[], confirm: ReadonlySet<number>) {
  return view.slots.map((s) => {
    const row = rows.find((r) => r.position === s.position);
    if (confirm.has(s.position) && row) return { ...row };
    const kept = s.ninaConfirmedAt !== null && !s.changedByNina;
    return {
      position: s.position,
      filterId: kept ? s.filterId : (row?.filterId ?? s.filterId),
      ninaFilterName: kept ? s.ninaFilterName : null,
    };
  });
}

export function FilterWheelSection({ rig, canWrite }: { rig: RigView; canWrite: boolean }) {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const client = useQueryClient();
  const filters = useEquipmentList('filters');
  const key = ['equipment', 'filter-wheel', rig.id] as const;
  const wheel = useQuery({ queryKey: key, queryFn: () => equipmentApi.filterWheel(rig.id) });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [base, setBase] = useState<FilterWheelView | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  if (wheel.data && wheel.data !== base) {
    setBase(wheel.data);
    setRows(draftRows(wheel.data));
  }
  const put = useMutation({
    mutationFn: (confirm: ReadonlySet<number>) => {
      if (!wheel.data || !rows) throw new Error('keine Belegung');
      return equipmentApi.putFilterWheel(
        rig.id,
        confirmPayload(wheel.data, rows, confirm),
        wheel.data.settingsVersion,
      );
    },
    onSuccess: async (view) => {
      client.setQueryData(key, view);
      setConfirmAll(false);
      await client.invalidateQueries({ queryKey: equipmentKey('rigs') });
    },
  });
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const filterOf = (id: string | null) => (filters.data ?? []).find((f) => f.id === id);
  const Confirm = actionIcons.approve;
  const Warn = actionIcons.warning;
  const Add = actionIcons.add;
  if (wheel.isError)
    return <ProblemMessage code={problemCode(wheel.error)} onRetry={() => void wheel.refetch()} />;
  if (!wheel.data || !rows) return <p role="status">{t('common.loading')}</p>;
  const view = wheel.data;
  const reportedNames = view.reported?.slots.map((s) => s.name) ?? [];
  const changed = view.slots.filter((s) => s.changedByNina);
  const pendingPositions = view.slots
    .filter((s) => slotStatus(s) === 'suggested')
    .map((s) => s.position)
    .filter((p) => {
      const r = rows.find((x) => x.position === p);
      return r?.filterId && r.ninaFilterName;
    });
  const setRow = (position: number, patch: Partial<Row>) =>
    setRows((rs) => (rs ?? []).map((r) => (r.position === position ? { ...r, ...patch } : r)));
  const errorCode = put.error instanceof ApiError ? put.error.problem.code : null;
  const rowOf = (slot: Slot) => rows.find((r) => r.position === slot.position);
  // Plätze in NINA-Reihenfolge, daher nicht sortierbar; bei Platzmangel Spalten ausblenden (AP-26a).
  const columns: DataColumn<Slot>[] = [
    { id: 'position', header: t('rigs.wheel.col.position'), cell: (slot) => slot.position },
    {
      id: 'filter',
      header: t('rigs.wheel.col.filter'),
      cell: (slot) => {
        const row = rowOf(slot);
        const filter = filterOf(row?.filterId ?? null);
        return (
          <span className={styles.inline}>
            {filter ? <FilterChip shortName={filter.shortName} color={filter.colorHex} /> : null}
            <select
              className={styles.input}
              aria-label={t('rigs.wheel.filterAt', { position: String(slot.position) })}
              value={row?.filterId ?? ''}
              disabled={!canWrite}
              onChange={(e) =>
                setRow(slot.position, { filterId: e.target.value === '' ? null : e.target.value })
              }
            >
              <option value="">–</option>
              {(filters.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.shortName}
                </option>
              ))}
            </select>
          </span>
        );
      },
    },
    {
      id: 'bandwidth',
      header: t('rigs.wheel.col.bandwidth'),
      priority: 3,
      nowrap: true,
      cell: (slot) => {
        const filter = filterOf(rowOf(slot)?.filterId ?? null);
        return filter?.bandwidthNm ? `${String(filter.bandwidthNm)} nm` : '';
      },
    },
    {
      id: 'reported',
      header: t('rigs.wheel.col.reported'),
      priority: 2,
      cell: (slot) => slot.reportedName ?? '–',
    },
    {
      id: 'ninaName',
      header: t('rigs.wheel.col.ninaName'),
      cell: (slot) => {
        const row = rowOf(slot);
        const names = [
          ...new Set([...reportedNames, ...(row?.ninaFilterName ? [row.ninaFilterName] : [])]),
        ];
        return (
          <select
            className={styles.input}
            aria-label={t('rigs.wheel.ninaNameAt', { position: String(slot.position) })}
            value={row?.ninaFilterName ?? ''}
            disabled={!canWrite}
            onChange={(e) =>
              setRow(slot.position, {
                ninaFilterName: e.target.value === '' ? null : e.target.value,
              })
            }
          >
            <option value="">{t('rigs.wheel.notAssigned')}</option>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      id: 'status',
      header: t('rigs.wheel.col.status'),
      cell: (slot) => {
        const status = slotStatus(slot);
        return (
          <>
            <span className={STATUS_CLASS[status]}>{t(`rigs.wheel.status.${status}`)}</span>
            {status === 'confirmed' && slot.ninaConfirmedAt ? (
              <span className={styles.muted}>
                {' '}
                {formatDateTime(slot.ninaConfirmedAt, zone, i18n.language)}
              </span>
            ) : null}
          </>
        );
      },
    },
    ...(canWrite
      ? [
          {
            id: 'actions',
            header: t('equipment.actions'),
            headerHidden: true,
            cell: (slot: Slot) => {
              const row = rowOf(slot);
              return (
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('rigs.wheel.confirmAt', { position: String(slot.position) })}
                  title={t('rigs.wheel.confirm')}
                  disabled={!row || (!row.filterId && !row.ninaFilterName) || put.isPending}
                  onClick={() => put.mutate(new Set([slot.position]))}
                >
                  <Confirm size={ICON_SIZE.table} aria-hidden />
                </button>
              );
            },
          },
        ]
      : []),
  ];
  return (
    <section className={styles.form} aria-labelledby="wheel-title">
      <div className={styles.formTitle}>
        <h2 id="wheel-title">{t('rigs.wheel.title')}</h2>
        {view.reported?.reportedAt ? (
          <span className={styles.muted}>
            {t('rigs.wheel.reportedAt', {
              at: formatDateTime(view.reported.reportedAt, zone, i18n.language),
            })}
          </span>
        ) : null}
      </div>
      {view.reported === null ? (
        <p className={styles.note} role="note">
          {t('rigs.wheel.noReport')}
        </p>
      ) : null}
      {changed.length > 0 ? (
        <div className={styles.warning} role="alert">
          <p className={styles.usageTitle}>
            <Warn size={ICON_SIZE.button} aria-hidden />
            {t('rigs.wheel.changedTitle')}
          </p>
          <ul>
            {changed.map((s) => (
              <li key={s.position}>
                {t('rigs.wheel.changedSlot', {
                  position: s.position,
                  confirmed: s.ninaFilterName ?? '–',
                  reported: s.reportedName ?? '–',
                })}
              </li>
            ))}
          </ul>
          <p>{t('rigs.wheel.changedHint')}</p>
        </div>
      ) : null}
      {errorCode ? (
        <ProblemMessage
          code={errorCode}
          {...(errorCode === 'resource.version_conflict'
            ? { onRetry: () => void wheel.refetch().then(() => put.reset()) }
            : {})}
        />
      ) : null}
      {rows.length === 0 ? (
        <p className={styles.muted}>{t('rigs.wheel.empty')}</p>
      ) : (
        <DataTable
          columns={columns}
          rows={view.slots}
          rowKey={(slot) => String(slot.position)}
          rowLabel={(slot) => String(slot.position)}
          label={t('rigs.wheel.title')}
        />
      )}
      {canWrite ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={pendingPositions.length === 0 || put.isPending}
            onClick={() => setConfirmAll(true)}
          >
            <Confirm size={ICON_SIZE.button} aria-hidden />
            {t('rigs.wheel.confirmAll')}
          </button>
          {view.reported === null ? (
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                const next = Math.max(0, ...rows.map((r) => r.position)) + 1;
                setRows([...rows, { position: next, filterId: null, ninaFilterName: null }]);
                client.setQueryData(key, {
                  ...view,
                  slots: [
                    ...view.slots,
                    {
                      position: next,
                      filterId: null,
                      ninaFilterName: null,
                      ninaConfirmedAt: null,
                      ninaConfirmedBy: null,
                      reportedName: null,
                      suggestion: null,
                      suggestedFilterId: null,
                      changedByNina: false,
                    },
                  ],
                });
              }}
            >
              <Add size={ICON_SIZE.table} aria-hidden />
              {t('rigs.wheel.addSlot')}
            </button>
          ) : null}
        </div>
      ) : null}
      <p className={styles.muted}>{t('rigs.wheel.planningHint')}</p>
      <ConfirmDialog
        open={confirmAll}
        title={t('rigs.wheel.confirmAllTitle', { count: pendingPositions.length })}
        consequence={t('rigs.wheel.confirmAllConsequence')}
        confirmLabel={t('rigs.wheel.confirmAllVerb')}
        state={put.isPending ? 'loading' : put.isError ? 'error' : 'ready'}
        {...(put.isError ? { errorKey: problemI18nKey(problemCode(put.error)) } : {})}
        onCancel={() => {
          setConfirmAll(false);
          put.reset();
        }}
        onConfirm={() =>
          put.mutateAsync(new Set(pendingPositions)).then(
            () => undefined,
            () => undefined,
          )
        }
      />
    </section>
  );
}
