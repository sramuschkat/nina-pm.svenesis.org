/**
 * Discord-Meldungen je Ereignis (`ops/discord-embeds.md`, TK 7.7, FA-DIS-04, FA-AUS-21): Titel, Felder und
 * Link in die App. Keine Dateinamen, Tokens, Koordinaten oder E-Mail-Adressen; Anzeigenamen nur mit
 * `showNames`. Limits: ≤ 10 Embeds je Nachricht, Titel ≤ 256, Feldwert ≤ 1024, gesamt ≤ 6000 Zeichen –
 * längere Inhalte werden auf mehrere Nachrichten verteilt („Teil 1/2“).
 */
import type {
  DiscordProjectBrief,
  DiscordReportExtras,
  DiscordSessionBrief,
  SessionReviewRepository,
} from '@nina-pm/db';
import type { Language } from '@nina-pm/i18n';
import type { DiscordEventKey } from '@nina-pm/shared';
import {
  duration,
  hours,
  nightLabel,
  relative,
  siteSpan,
  siteTime,
  tenantDateTime,
  text,
} from './format';
import type { DiscordMessage } from './webhook';

export const APP_URL = 'https://nina-pm.svenesis.org';
export const DISCORD_USERNAME = 'Svenesis NINA-PM';

/** Farben je Kategorie (`ops/discord-embeds.md`, aus ui-tokens). */
export const DISCORD_COLORS = { approvals: 5793266, sessions: 3046706, alerts: 12976168 } as const;

export const LIMITS = {
  embeds: 10,
  title: 256,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  total: 6000,
} as const;

export const LINKS = {
  queue: '/projekte/warteschlange',
  project: (id: string) => `/projekte/${id}`,
  session: (id: string) => `/auswertung/sessions/${id}`,
  instances: '/nina/instanzen',
  rigs: '/ausruestung/rigs',
  discord: '/verwaltung/discord',
} as const;

export interface EmbedField {
  readonly name: string;
  readonly value: string;
  readonly inline?: boolean;
}

export interface Embed {
  readonly title: string;
  readonly url?: string;
  readonly description?: string;
  readonly color: number;
  readonly fields: EmbedField[];
  readonly footer: { readonly text: string };
  readonly timestamp: string;
}

/** Session-Detail wie S-61 (`SessionReviewRepository.detail`). */
export type SessionDetailData = Awaited<ReturnType<SessionReviewRepository['detail']>>;

export interface EmbedContext {
  readonly lang: Language;
  readonly tenantName: string;
  readonly tenantTimeZone: string;
  readonly showNames: boolean;
  readonly now: Date;
}

/** Was der Baukasten aus der Datenbank braucht (im Test gefälscht). */
export interface EmbedLoaders {
  project(id: string): Promise<DiscordProjectBrief | undefined>;
  session(id: string): Promise<DiscordSessionBrief | undefined>;
  /** Session-Detail wie S-61 (Soll/Ist, Flats, Kennzahlen, Gründe); für Bericht und „Session beendet“. */
  sessionDetail(id: string): Promise<SessionDetailData | undefined>;
  /** Transits und fertig gewordene Projekte für den Nachtbericht (FA-AUS-21). */
  reportExtras(sessionId: string, projectIds: readonly string[]): Promise<DiscordReportExtras>;
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const str = (v: unknown) =>
  typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);

function field(name: string, value: string, inline = true): EmbedField {
  return {
    name: clip(name, LIMITS.fieldName),
    value: clip(value || '–', LIMITS.fieldValue),
    inline,
  };
}

function embedSize(e: Embed): number {
  return (
    e.title.length +
    (e.description?.length ?? 0) +
    e.footer.text.length +
    e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0)
  );
}

function makeEmbed(
  ctx: EmbedContext,
  category: keyof typeof DISCORD_COLORS,
  title: string,
  link: string | null,
  fields: EmbedField[],
  description?: string,
): Embed {
  return {
    title: clip(title, LIMITS.title),
    ...(link ? { url: `${APP_URL}${link}` } : {}),
    ...(description ? { description: clip(description, 4096) } : {}),
    color: DISCORD_COLORS[category],
    fields: fields.slice(0, LIMITS.fields),
    footer: { text: text(ctx.lang, 'footer', { tenant: ctx.tenantName }) },
    timestamp: ctx.now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

/** Embeds auf Nachrichten verteilen (≤ 10 Embeds, ≤ 6000 Zeichen); bei mehreren Teilen „Teil n/m“ im Titel. */
export function toMessages(ctx: EmbedContext, embeds: Embed[]): DiscordMessage[] {
  const groups: Embed[][] = [];
  let current: Embed[] = [];
  let size = 0;
  for (const e of embeds) {
    const s = embedSize(e) + 20;
    if (current.length > 0 && (current.length >= LIMITS.embeds || size + s > LIMITS.total)) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(e);
    size += s;
  }
  if (current.length > 0) groups.push(current);
  return groups.map((g, i) => ({
    username: DISCORD_USERNAME,
    allowed_mentions: { parse: [] },
    embeds:
      groups.length > 1
        ? g.map((e, j) =>
            j === 0
              ? {
                  ...e,
                  title: clip(
                    `${e.title} · ${text(ctx.lang, 'part', { n: i + 1, of: groups.length })}`,
                    LIMITS.title,
                  ),
                }
              : e,
          )
        : g,
  }));
}

export function testMessage(ctx: EmbedContext, channelName: string): DiscordMessage[] {
  return toMessages(ctx, [
    makeEmbed(
      ctx,
      'approvals',
      text(ctx.lang, 'test.title'),
      LINKS.discord,
      [],
      text(ctx.lang, 'test.description', { channel: channelName }),
    ),
  ]);
}

const titleKey = (key: DiscordEventKey) => `title.${key.replace('.', '_')}`;

async function approvalEmbed(
  key: DiscordEventKey,
  data: Record<string, unknown>,
  ctx: EmbedContext,
  loaders: EmbedLoaders,
): Promise<Embed> {
  const projectId = str(data.projectId);
  const p = projectId ? await loaders.project(projectId) : undefined;
  const name = p?.name ?? str(data.name);
  const t = (k: string, v?: Record<string, unknown>) => text(ctx.lang, k, v);
  const fields: EmbedField[] = [];
  const submitter =
    ctx.showNames && p?.createdByName ? field(t('field.submitter'), p.createdByName) : null;
  const rig = p?.rigName ? field(t('field.rig'), p.rigName) : null;
  const comment = str(data.comment).trim();
  switch (key) {
    case 'submission.new':
      if (submitter) fields.push(submitter);
      if (rig) fields.push(rig);
      if (p?.effortTag)
        fields.push(
          field(
            t('field.effort'),
            p.effortNights !== null
              ? t('value.effort', { tag: p.effortTag, nights: p.effortNights })
              : t('value.effortTag', { tag: p.effortTag }),
          ),
        );
      break;
    case 'submission.withdrawn':
      if (submitter) fields.push(submitter);
      break;
    case 'approval.approved':
      if (rig) fields.push(rig);
      if (p) fields.push(field(t('field.priority'), String(p.priority)));
      break;
    case 'approval.returned':
      if (comment) fields.push(field(t('field.comment'), clip(comment, 200), false));
      break;
    case 'approval.rejected':
      if (comment) fields.push(field(t('field.comment'), comment, false));
      break;
    case 'approval.expired':
      if (typeof data.deadlineDays === 'number')
        fields.push(
          field(t('field.deadline'), t('value.deadlineDays', { days: data.deadlineDays })),
        );
      break;
    case 'deadline.near':
      if (typeof data.deadlineUtc === 'string')
        fields.push(
          field(t('field.deadline'), tenantDateTime(data.deadlineUtc, ctx.tenantTimeZone)),
        );
      break;
    case 'change_request.decided':
      if (data.decision === 'accepted' || data.decision === 'rejected')
        fields.push(field(t('field.decision'), t(`value.decision.${data.decision}`)));
      if (comment) fields.push(field(t('field.comment'), clip(comment, 200), false));
      break;
    default:
      break;
  }
  const toQueue =
    key === 'submission.new' || key === 'submission.withdrawn' || key === 'deadline.near';
  return makeEmbed(
    ctx,
    'approvals',
    t(titleKey(key), { name }),
    toQueue ? LINKS.queue : projectId ? LINKS.project(projectId) : LINKS.queue,
    fields,
  );
}

function alertEmbed(key: DiscordEventKey, data: Record<string, unknown>, ctx: EmbedContext): Embed {
  const t = (k: string, v?: Record<string, unknown>) => text(ctx.lang, k, v);
  const subject = str(data.subject);
  switch (key) {
    case 'session.no_heartbeat': {
      const rig = subject.split(' · ')[0] ?? subject;
      const sessionId = str(data.sessionId);
      return makeEmbed(
        ctx,
        'alerts',
        t(titleKey(key), { rig, min: typeof data.minutes === 'number' ? data.minutes : 10 }),
        sessionId ? LINKS.session(sessionId) : null,
        [field(t('field.details'), subject, false)],
      );
    }
    case 'plugin.dead_letters':
    case 'rig.busy':
      return makeEmbed(ctx, 'alerts', t(titleKey(key)), LINKS.instances, [
        field(t('field.details'), subject, false),
      ]);
    case 'nina.settings_mismatch':
      return makeEmbed(ctx, 'alerts', t(titleKey(key)), LINKS.rigs, [
        field(t('field.details'), subject.split(':')[0] ?? subject, false),
        field(
          t('field.codes'),
          str(data.codes)
            .split(',')
            .filter(Boolean)
            .map((c) => `\`${c}\``)
            .join(', '),
          false,
        ),
      ]);
    case 'discord.channel_failed':
      return makeEmbed(
        ctx,
        'alerts',
        t(titleKey(key), { name: str(data.name) || subject }),
        LINKS.discord,
        [
          field(t('field.httpStatus'), str(data.status) || '–'),
          field(t('field.attempts'), str(data.attempts) || '–'),
        ],
      );
    default:
      return makeEmbed(ctx, 'alerts', subject || key, null, []);
  }
}

async function sessionEmbed(
  key: DiscordEventKey,
  data: Record<string, unknown>,
  ctx: EmbedContext,
  loaders: EmbedLoaders,
): Promise<Embed | undefined> {
  const t = (k: string, v?: Record<string, unknown>) => text(ctx.lang, k, v);
  const sessionId = str(data.sessionId);
  const s = sessionId ? await loaders.session(sessionId) : undefined;
  if (!s) return undefined;
  const tz = s.siteTimeZone;
  const link = LINKS.session(s.id);
  switch (key) {
    case 'session.started': {
      const fields = [
        field(t('field.night'), nightLabel(s.night)),
        field(t('field.start'), siteTime(s.startedAt, tz)),
      ];
      return makeEmbed(ctx, 'sessions', t(titleKey(key), { rig: s.rigName }), link, fields);
    }
    case 'session.completed': {
      const end = s.endedAt ?? ctx.now;
      const detail = await loaders.sessionDetail(s.id);
      const fields = [
        field(t('field.span'), siteSpan(s.startedAt, end, tz), false),
        field(
          t('field.duration'),
          duration(ctx.lang, (end.getTime() - s.startedAt.getTime()) / 1000),
        ),
        field(t('field.status'), t(`status.${s.status}`)),
      ];
      if (detail) {
        fields.push(
          field(t('field.lights'), String(detail.session.frames + detail.session.bonusFrames)),
        );
        fields.push(
          field(
            t('field.integration'),
            t('value.integrationShort', { h: hours(detail.session.integrationS) }),
          ),
        );
      }
      return makeEmbed(ctx, 'sessions', t(titleKey(key), { rig: s.rigName }), link, fields);
    }
    case 'session.stale': {
      const last = s.lastHeartbeatAt ?? s.startedAt;
      return makeEmbed(ctx, 'sessions', t(titleKey(key), { rig: s.rigName }), link, [
        field(t('field.night'), nightLabel(s.night)),
        field(t('field.lastHeartbeat'), `${siteTime(last, tz)} · ${relative(last)}`, false),
      ]);
    }
    default:
      return undefined;
  }
}

function transitEmbed(
  key: DiscordEventKey,
  data: Record<string, unknown>,
  ctx: EmbedContext,
): Embed {
  const t = (k: string, v?: Record<string, unknown>) => text(ctx.lang, k, v);
  const planet = str(data.planet);
  const fields: EmbedField[] = [];
  if (typeof data.coveragePct === 'number')
    fields.push(
      field(t('field.coverage'), t('value.percent', { p: Math.round(data.coveragePct) })),
    );
  const tz = str(data.siteTimeZone);
  if (tz && typeof data.startUtc === 'string' && typeof data.endUtc === 'string')
    fields.push(field(t('field.span'), siteSpan(data.startUtc, data.endUtc, tz), false));
  const projectId = str(data.projectId);
  return makeEmbed(
    ctx,
    'sessions',
    t(titleKey(key), { planet }),
    projectId ? LINKS.project(projectId) : null,
    fields,
  );
}

/** Höchstzahl Projekte im Nachtbericht (FA-AUS-21), Rest als „+ n weitere“. */
export const REPORT_MAX_PROJECTS = 10;

/**
 * Nachtbericht (FA-AUS-21): Kopf mit Status, Beginn–Ende, Belichtung/Effizienz, dann je Projekt ein Embed
 * mit Soll/Ist je Filter, zuletzt Flats/Dark-Flats und Abweichungsgründe. `preliminary` bei offenen
 * Plugin-Meldungen (2-h-Grenze, NT-09).
 */
export function reportEmbeds(
  ctx: EmbedContext,
  detail: SessionDetailData,
  opts: {
    preliminary: boolean;
    extras?: DiscordReportExtras;
    weather?: DiscordSessionBrief['weather'];
  },
): Embed[] {
  const t = (k: string, v?: Record<string, unknown>) => text(ctx.lang, k, v);
  const s = detail.session;
  const tz = s.siteTimeZone;
  const link = LINKS.session(s.id);
  const k = detail.kpis;
  const head: EmbedField[] = [
    field(t('field.status'), t(`status.${s.status}`)),
    field(t('field.night'), nightLabel(s.night)),
  ];
  if (s.endedAt) head.push(field(t('field.span'), siteSpan(s.startedAt, s.endedAt, tz), false));
  head.push(
    field(
      t('field.exposure'),
      t('value.exposureLine', {
        h: hours(k.exposureS),
        eff:
          k.efficiencyPct === null ? '–' : t('value.percent', { p: Math.round(k.efficiencyPct) }),
      }),
    ),
  );
  head.push(
    field(
      t('field.lights'),
      `${s.frames}${s.bonusFrames > 0 ? ` (${t('value.bonus', { n: s.bonusFrames })})` : ''}`,
    ),
  );
  const rating = opts.weather?.ratingIndex;
  if (rating !== null && rating !== undefined && rating >= 0 && rating <= 4)
    head.push(
      field(
        t('field.weather'),
        opts.weather?.nightMean === null || opts.weather?.nightMean === undefined
          ? t(`rating.${rating}`)
          : t('value.weather', {
              rating: t(`rating.${rating}`),
              pct: Math.round(opts.weather.nightMean * 100),
            }),
      ),
    );
  const done = opts.extras?.projectsDone ?? [];
  if (done.length > 0) head.push(field(t('field.projectsDone'), done.join(', '), false));
  const transits = opts.extras?.transits ?? [];
  if (transits.length > 0)
    head.push(
      field(
        t('field.transits'),
        transits
          .map((x) =>
            t('value.transitLine', {
              planet: x.name,
              coverage:
                x.coveragePct === null ? '–' : t('value.percent', { p: Math.round(x.coveragePct) }),
            }),
          )
          .join('\n'),
        false,
      ),
    );
  if (opts.preliminary) head.push(field(t('field.preliminary'), t('field.preliminaryText'), false));
  const embeds = [
    makeEmbed(
      ctx,
      'sessions',
      t('title.session_report', { night: nightLabel(s.night), rig: s.rigName }),
      link,
      head,
    ),
  ];

  // Je Projekt: Filter Soll/Ist und Integrationszeit.
  const byProject = new Map<string, { name: string; rows: SessionDetailData['rows'] }>();
  for (const r of detail.rows) {
    const entry = byProject.get(r.projectId) ?? { name: r.projectName, rows: [] };
    entry.rows.push(r);
    byProject.set(r.projectId, entry);
  }
  const projects = [...byProject.values()];
  for (const p of projects.slice(0, REPORT_MAX_PROJECTS)) {
    const fields = p.rows.map((r) =>
      field(
        r.filterShortName,
        `${
          // Transit-Serie: Soll ist ein Zeitfenster, keine Anzahl (07.10.2026).
          r.planned === null || (r.plannedSeries !== null && r.planned === 0)
            ? t('value.framesNoPlan', { acquired: r.accepted })
            : t('value.frames', { acquired: r.accepted, planned: r.planned })
        }${r.bonus > 0 ? ` ${t('value.bonus', { n: r.bonus })}` : ''} · ${t('value.integrationShort', { h: hours(r.integrationS) })}`,
      ),
    );
    embeds.push(makeEmbed(ctx, 'sessions', p.name, null, fields));
  }
  const rest: EmbedField[] = [];
  if (projects.length > REPORT_MAX_PROJECTS)
    rest.push(
      field(t('field.details'), t('more', { n: projects.length - REPORT_MAX_PROJECTS }), false),
    );
  if (detail.flats.length > 0)
    rest.push(
      field(
        t('field.flats'),
        detail.flats
          .map((f) =>
            t('value.flatsLine', {
              filter: f.filterShortName,
              flats: f.flatsTaken,
              flatsPlanned: f.flatsPlanned,
              darkFlats: f.darkFlatsTaken,
              darkFlatsPlanned: f.darkFlatsPlanned,
            }),
          )
          .join('\n'),
        false,
      ),
    );
  rest.push(
    field(
      t('field.reasons'),
      detail.reasons.length === 0
        ? t('value.noReasons')
        : detail.reasons
            .map((r) =>
              t('value.reasonLine', {
                reason: t(`reason.${r.reason}`),
                count: r.count,
                duration: r.durationS ? ` · ${duration(ctx.lang, r.durationS)}` : '',
              }),
            )
            .join('\n'),
      false,
    ),
  );
  embeds.push(makeEmbed(ctx, 'sessions', `${s.rigName} · ${nightLabel(s.night)}`, link, rest));
  return embeds;
}

/**
 * Nachricht(en) zu einem Ereignis; `[]`, wenn das Objekt nicht mehr existiert. Der Nachtbericht kommt über
 * `reportEmbeds` (der Job lädt das Session-Detail selbst).
 */
export async function eventMessages(
  key: DiscordEventKey,
  data: Record<string, unknown>,
  ctx: EmbedContext,
  loaders: EmbedLoaders,
): Promise<DiscordMessage[]> {
  let embed: Embed | undefined;
  switch (key) {
    case 'submission.new':
    case 'submission.withdrawn':
    case 'approval.approved':
    case 'approval.returned':
    case 'approval.rejected':
    case 'approval.expired':
    case 'deadline.near':
    case 'change_request.new':
    case 'change_request.decided':
      embed = await approvalEmbed(key, data, ctx, loaders);
      break;
    case 'session.started':
    case 'session.completed':
    case 'session.stale':
      embed = await sessionEmbed(key, data, ctx, loaders);
      break;
    case 'transit.observed':
    case 'transit.missed':
      embed = transitEmbed(key, data, ctx);
      break;
    case 'session.report': {
      const sessionId = str(data.sessionId);
      const detail = sessionId ? await loaders.sessionDetail(sessionId) : undefined;
      const s = sessionId ? await loaders.session(sessionId) : undefined;
      if (!detail || !s) return [];
      const extras = await loaders.reportExtras(s.id, [
        ...new Set(detail.rows.map((r) => r.projectId)),
      ]);
      return toMessages(
        ctx,
        reportEmbeds(ctx, detail, { preliminary: s.outboxPending > 0, extras, weather: s.weather }),
      );
    }
    default:
      embed = alertEmbed(key, data, ctx);
  }
  return embed ? toMessages(ctx, [embed]) : [];
}
