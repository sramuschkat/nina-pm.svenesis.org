/**
 * Rechte-Testgenerator (TK 5.5, NFA-17): für **jede** registrierte Route × {Owner, Admin, Admin ohne 2FA,
 * User, fremder Mandant, anonym, Super User im System-Kontext} ein Aufruf mit echter Sitzung; erwartet
 * wird, was `can()` mit dem Kontext der echten Sitzungsprüfung und dem Beispielobjekt sagt. Eine neue
 * Route ohne Beispiel in EXAMPLES lässt den Test scheitern.
 */
import {
  can,
  COOKIE_NAMES,
  EMPTY_SESSION_LOG,
  ProjectConditions,
  type Action,
  type ResourceMeta,
} from '@nina-pm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { replaceExoCatalog, readExoCatalog } from '@nina-pm/db';
import { ROUTES } from '../src/app';
import {
  ephemerisOf as ephemerisOf2,
  findMerged,
  mergedCatalog,
  snapshotOf,
} from '../src/exo/project';
import { clearExoCatalogCache } from '../src/exo/search';
import { resolveSessionState } from '../src/auth/session';
import { seedPersonas, type Persona, type PersonaWorld } from './support/personas';
import {
  CAMERA,
  filterInput,
  MOON,
  rigInput,
  SCHEDULER,
  SITE,
  TELESCOPE,
} from './support/equipment';
import { HAT } from './support/exo';
import { createStack, type Stack } from './support/stack';

interface Example {
  readonly url: string;
  readonly method?: string;
  /** Rumpf; als Funktion je Aufruf neu (z. B. frische Client-UUID). */
  readonly body?: unknown;
  /** Stellt nach jedem Aufruf den Ausgangszustand wieder her (verändernde Routen). */
  readonly reset?: () => Promise<unknown>;
  /** Objekt, auf das die Route zugreift (für `can` mit Objekt); fehlt bei Routen ohne Objekt. */
  readonly resource?: ResourceMeta;
  readonly okStatus?: number;
  /** Abweichende Erwartung je Persona (fachliche Ergebnisse jenseits der Rechte). */
  readonly expect?: Readonly<Record<string, number>>;
}

let stack: Stack;
let world: PersonaWorld;
let jobId: string;
let EXAMPLES: Record<string, Example>;

beforeAll(async () => {
  stack = await createStack();
  world = await seedPersonas(stack);
  const repo = stack.services.repositories({ tenantId: world.tenantA });
  jobId = (
    await repo.job.enqueue({
      kind: 'multi_sim',
      dedupeKey: 'multi_sim:r:2026-09-24',
      createdBy: world.members.user,
    })
  ).jobId;
  await stack.pg.admin.query(
    "UPDATE job SET status = 'done', dedupe_active = NULL, result_s3_key = $1 WHERE id = $2",
    [`tenant/${world.tenantA}/jobs/${jobId}.json`, jobId],
  );
  const ownJob: ResourceMeta = { tenantId: world.tenantA, createdBy: world.members.user };
  const notSuper = Object.fromEntries(
    ['Owner', 'Admin', 'Admin ohne 2FA', 'User', 'User 2', 'fremder Mandant (Admin)'].map((n) => [
      n,
      403,
    ]),
  );
  EXAMPLES = {
    'GET /api/health': { url: '/api/health' },
    'GET /api/banner': { url: '/api/banner' },
    'GET /api/web/v1/audit/system': { url: '/api/web/v1/audit/system' },
    'GET /api/web/v1/audit/changes': { url: '/api/web/v1/audit/changes' },
    'GET /api/web/v1/tenant/settings': { url: '/api/web/v1/tenant/settings' },
    'PATCH /api/web/v1/tenant/settings': {
      url: '/api/web/v1/tenant/settings',
      method: 'PATCH',
      body: { settings: { defaultLanguage: 'de' } },
    },
    'GET /api/auth/discord/start': { url: '/api/auth/discord/start?next=/projekte', okStatus: 302 },
    'GET /api/auth/discord/callback': {
      url: '/api/auth/discord/callback?code=x&state=y',
      okStatus: 302,
    },
    'POST /api/auth/invitation/claim': {
      url: '/api/auth/invitation/claim',
      method: 'POST',
      body: { token: 'A'.repeat(43) },
      okStatus: 404,
    },
    'POST /api/auth/context': {
      url: '/api/auth/context',
      method: 'POST',
      body: { system: true },
      expect: notSuper,
    },
    'POST /api/auth/logout': { url: '/api/auth/logout', method: 'POST', okStatus: 204 },
    'GET /api/auth/me': { url: '/api/auth/me' },
    'GET /api/auth/sessions': { url: '/api/auth/sessions' },
    'DELETE /api/auth/sessions/{id}': {
      url: `/api/auth/sessions/${crypto.randomUUID()}`,
      method: 'DELETE',
      okStatus: 404,
    },
    'DELETE /api/auth/sessions': { url: '/api/auth/sessions', method: 'DELETE', okStatus: 204 },
    'POST /api/auth/invitations/preview': {
      url: '/api/auth/invitations/preview',
      method: 'POST',
      body: { token: 'A'.repeat(43) },
      okStatus: 404,
    },
    'GET /api/web/v1/jobs/{id}': { url: `/api/web/v1/jobs/${jobId}`, resource: ownJob },
    // Kein fertiges Simulationsergebnis → 404 für alle, die den Job lesen dürfen (AP-32a).
    'GET /api/web/v1/jobs/{id}/result': {
      url: `/api/web/v1/jobs/${jobId}/result`,
      resource: ownJob,
      okStatus: 404,
    },
    'GET /api/web/v1/files/download-url': {
      url: `/api/web/v1/files/download-url?purpose=job_result&id=${jobId}`,
      resource: ownJob,
    },
    ...memberExamples(),
    ...systemExamples(),
    ...(await equipmentExamples()),
    ...(await projectExamples()),
  };
});

afterAll(() => stack.close());

const admin = () => stack.pg.admin;
const target = () => ({
  tenantId: world.tenantA,
  targetMemberId: world.members.user2,
  targetRole: 'user' as const,
});

function memberExamples(): Record<string, Example> {
  const m = world.members;
  const onlyOwner = { Admin: 403 };
  return {
    'GET /api/web/v1/members': { url: '/api/web/v1/members' },
    'PATCH /api/web/v1/members/{id}': {
      url: `/api/web/v1/members/${m.user2}`,
      method: 'PATCH',
      body: { displayName: 'User Zwei' },
      resource: target(),
      okStatus: 204,
    },
    'DELETE /api/web/v1/members/{id}': {
      url: `/api/web/v1/members/${m.user2}`,
      method: 'DELETE',
      resource: target(),
      okStatus: 204,
      reset: () => admin().query("UPDATE app_user SET status = 'active' WHERE status = 'removed'"),
    },
    // Rollen nur durch den Owner (E2): Route-Aktion member.manage, Rollenwechsel member.admin.manage.
    'PUT /api/web/v1/members/{id}/role': {
      url: `/api/web/v1/members/${m.user2}/role`,
      method: 'PUT',
      body: { role: 'user' },
      resource: target(),
      okStatus: 204,
      expect: onlyOwner,
    },
    'DELETE /api/web/v1/members/{id}/sessions': {
      url: `/api/web/v1/members/${m.user2}/sessions`,
      method: 'DELETE',
      resource: target(),
      okStatus: 204,
    },
    'POST /api/web/v1/me/leave': {
      url: '/api/web/v1/me/leave',
      method: 'POST',
      okStatus: 204,
      expect: { Owner: 409 },
      reset: () => admin().query("UPDATE app_user SET status = 'active' WHERE status = 'removed'"),
    },
    'POST /api/web/v1/tenant/owner-transfer': {
      url: '/api/web/v1/tenant/owner-transfer',
      method: 'POST',
      body: { memberId: m.admin },
      okStatus: 204,
      reset: () =>
        admin().query('UPDATE tenant SET owner_member_id = $1 WHERE id = $2', [
          m.owner,
          world.tenantA,
        ]),
    },
    'POST /api/web/v1/invitations': {
      url: '/api/web/v1/invitations',
      method: 'POST',
      body: () => ({ id: crypto.randomUUID() }),
      okStatus: 201,
    },
    'POST /api/web/v1/invitations/admin': {
      url: '/api/web/v1/invitations/admin',
      method: 'POST',
      body: () => ({ id: crypto.randomUUID() }),
      okStatus: 201,
    },
    'GET /api/web/v1/invitations': { url: '/api/web/v1/invitations' },
    'GET /api/web/v1/me/preferences': { url: '/api/web/v1/me/preferences' },
    'GET /api/web/v1/notifications': { url: '/api/web/v1/notifications' },
    'POST /api/web/v1/notifications/read': {
      url: '/api/web/v1/notifications/read',
      method: 'POST',
      body: { all: true },
    },
    'PUT /api/web/v1/me/preferences/{key}': {
      url: '/api/web/v1/me/preferences/ui.theme',
      method: 'PUT',
      body: { value: 'dark' },
      okStatus: 204,
    },
    'DELETE /api/web/v1/invitations/{id}': {
      url: `/api/web/v1/invitations/${crypto.randomUUID()}`,
      method: 'DELETE',
      okStatus: 404,
    },
  };
}

/** Ausrüstung (AP-09a): je Objektart ein Bestandsobjekt; Löschen zielt auf eine unbekannte ID. */
async function equipmentExamples(): Promise<Record<string, Example>> {
  const eq = stack.services
    .repositories({ tenantId: world.tenantA, memberId: world.members.owner })
    .equipment();
  const now = stack.clock.now();
  const site = await eq.createSite(crypto.randomUUID(), SITE, now);
  const link = await eq.createSiteLink(
    crypto.randomUUID(),
    {
      siteId: site.id,
      serviceType: 'web',
      name: 'Allsky',
      remoteIdOrUrl: 'https://example.org',
      notes: '',
      isDefault: false,
    },
    now,
  );
  const telescope = await eq.createTelescope(crypto.randomUUID(), TELESCOPE, now);
  const camera = await eq.createCamera(crypto.randomUUID(), CAMERA, now);
  const filter = await eq.createFilter(crypto.randomUUID(), filterInput('L'), now);
  const moon = await eq.createMoonProfile(crypto.randomUUID(), MOON, now);
  const template = await eq.createTemplate(
    crypto.randomUUID(),
    { name: 'LRGB', telescopeId: null, cameraId: null, notes: '', lines: [] },
    now,
  );
  const rig = await eq.createRig(
    crypto.randomUUID(),
    rigInput(site.id, telescope.id, camera.id),
    now,
  );
  let n = 0;
  const unique = (prefix: string) => `${prefix} ${String((n += 1))}`;
  const gone = crypto.randomUUID();
  const own: ResourceMeta = { tenantId: world.tenantA };
  const crud = (
    path: string,
    id: string,
    body: object,
    fresh: () => object,
    foreignRefs = false,
  ): Record<string, Example> => {
    const post: Example = {
      url: `/api/web/v1/${path}`,
      method: 'POST',
      body: () => ({ id: crypto.randomUUID(), ...fresh() }),
      okStatus: 201,
    };
    return {
      [`GET /api/web/v1/${path}`]: { url: `/api/web/v1/${path}` },
      [`GET /api/web/v1/${path}/{id}`]: { url: `/api/web/v1/${path}/${id}`, resource: own },
      [`POST /api/web/v1/${path}`]: post,
      [`PUT /api/web/v1/${path}/{id}`]: {
        url: `/api/web/v1/${path}/${id}`,
        method: 'PUT',
        body,
        resource: own,
      },
      [`DELETE /api/web/v1/${path}/{id}`]: {
        url: `/api/web/v1/${path}/${gone}`,
        method: 'DELETE',
        okStatus: 404,
        resource: own,
      },
      ...(foreignRefs
        ? { [`POST /api/web/v1/${path}`]: { ...post, expect: { 'fremder Mandant (Admin)': 422 } } }
        : {}),
    };
  };
  const linkBody = {
    siteId: site.id,
    serviceType: 'web',
    name: 'Allsky',
    remoteIdOrUrl: 'https://example.org',
  };
  return {
    ...crud('sites', site.id, SITE, () => ({ ...SITE, name: unique('Standort') })),
    ...crud('site-links', link.id, linkBody, () => ({ ...linkBody, name: unique('Link') }), true),
    ...crud('telescopes', telescope.id, TELESCOPE, () => ({
      ...TELESCOPE,
      name: unique('Teleskop'),
    })),
    ...crud('cameras', camera.id, CAMERA, () => ({ ...CAMERA, name: unique('Kamera') })),
    ...crud('filters', filter.id, filterInput('L'), () => filterInput(unique('F'))),
    ...crud('moon-profiles', moon.id, MOON, () => ({ ...MOON, name: unique('Mond') })),
    ...crud('exposure-templates', template.id, { name: 'LRGB' }, () => ({
      name: unique('Vorlage'),
    })),
    ...crud(
      'rigs',
      rig.id,
      rigInput(site.id, telescope.id, camera.id),
      () => ({
        ...rigInput(site.id, telescope.id, camera.id),
        name: unique('Rig'),
      }),
      true,
    ),
    'PUT /api/web/v1/rigs/{id}/scheduler-settings': {
      url: `/api/web/v1/rigs/${rig.id}/scheduler-settings`,
      method: 'PUT',
      body: SCHEDULER,
      resource: own,
    },
    'GET /api/web/v1/rigs/{id}/filter-wheel': {
      url: `/api/web/v1/rigs/${rig.id}/filter-wheel`,
      resource: own,
    },
    'PUT /api/web/v1/rigs/{id}/filter-wheel': {
      url: `/api/web/v1/rigs/${rig.id}/filter-wheel`,
      method: 'PUT',
      body: { slots: [{ position: 1, filterId: filter.id, ninaFilterName: 'L' }] },
      resource: own,
    },
    'GET /api/web/v1/sites/{id}/nights': {
      url: `/api/web/v1/sites/${site.id}/nights?from=2026-09-17&count=3`,
      resource: own,
    },
    'GET /api/web/v1/sites/{id}/weather': {
      url: `/api/web/v1/sites/${site.id}/weather`,
      resource: own,
    },
  };
}

/** Projekte (AP-11a): Entwurf D des Owners und freigegebenes Projekt Q; Papierkorb-Projekt T. */
async function projectExamples(): Promise<Record<string, Example>> {
  const repos = stack.services.repositories({
    tenantId: world.tenantA,
    memberId: world.members.owner,
  });
  const eq = repos.equipment();
  const now = stack.clock.now();
  const site = await eq.createSite(crypto.randomUUID(), { ...SITE, name: 'Projekt-Standort' }, now);
  const telescope = await eq.createTelescope(
    crypto.randomUUID(),
    { ...TELESCOPE, name: 'Projekt-Teleskop' },
    now,
  );
  const camera = await eq.createCamera(
    crypto.randomUUID(),
    { ...CAMERA, name: 'Projekt-Kamera' },
    now,
  );
  const filter = await eq.createFilter(crypto.randomUUID(), filterInput('Ha'), now);
  const template = await eq.createTemplate(
    crypto.randomUUID(),
    { name: 'Leer', telescopeId: null, cameraId: null, notes: '', lines: [] },
    now,
  );
  const rig = await eq.createRig(
    crypto.randomUUID(),
    { ...rigInput(site.id, telescope.id, camera.id), name: 'Projekt-Rig' },
    now,
  );
  const projects = repos.projects();
  const base = {
    rigId: rig.id,
    targetName: 'NGC 281',
    targetType: null,
    dsoObjectId: null,
    catalogNames: '',
    descriptionMd: '',
    raDeg: 13.2458,
    decDeg: 56.6194,
    rotationDeg: 0,
    startDate: null,
    dueDate: null,
    requestPeriodFrom: null,
    requestPeriodTo: null,
    requestComment: null,
    conditions: ProjectConditions.parse({}),
  };
  const draft = await projects.create({ ...base, id: crypto.randomUUID(), name: 'Entwurf' }, now);
  const approved = await projects.create(
    { ...base, id: crypto.randomUUID(), name: 'Freigegeben' },
    now,
  );
  const trash = await projects.create(
    { ...base, id: crypto.randomUUID(), name: 'Papierkorb' },
    now,
  );
  const D = draft.project.id;
  const Q = approved.project.id;
  const T = trash.project.id;
  const panel = draft.panels[0]?.id as string;
  const withLine = await projects.addLine(
    D,
    {
      id: crypto.randomUUID(),
      panelId: panel,
      filterId: filter.id,
      exposureS: 300,
      plannedCount: 20,
      gain: null,
      offsetAdu: null,
      binning: 1,
      readoutMode: null,
      moonMode: 'none',
      moonProfileId: null,
      enabled: true,
      notes: '',
    },
    now,
  );
  const line = withLine.panels[0]?.lines[0]?.id as string;
  // Exoplaneten (AP-42 Teil 2): Katalogzeile HAT-P-17 b, Owner-Entwurf auf dem Projekt-Rig; angelegt wird in
  // den Beispielen auf einem eigenen Rig, das `reset` wieder leert.
  await replaceExoCatalog(stack.pg.db, 'exoclock', [HAT], now);
  clearExoCatalogCache();
  const hat = findMerged(mergedCatalog(await readExoCatalog(stack.pg.db)), 'exoclock', 'HAT-P-17b');
  if (!hat) throw new Error('HAT-P-17b fehlt');
  const exoDraft = await projects.createExoplanet(
    {
      ...base,
      id: crypto.randomUUID(),
      name: 'HAT-P-17b',
      targetName: 'HAT-P-17',
      raDeg: hat.raDeg,
      decDeg: hat.decDeg,
    },
    {
      planet: hat.planet,
      star: hat.star,
      catalog: hat.catalog,
      catalogEntryId: hat.id,
      bufferSigma: 1,
      catalogSnapshot: snapshotOf(hat),
      ephemeris: ephemerisOf2(hat),
      line: null,
    },
    now,
  );
  const E = exoDraft.project.id;
  // AP-43: Transit-Zeile, ein Wunsch (Epoche 402 = 11.10.2026) und ein freigegebenes Projekt mit Bestätigung.
  await projects.addLine(
    E,
    {
      id: crypto.randomUUID(),
      panelId: exoDraft.panels[0]?.id as string,
      filterId: filter.id,
      exposureS: 60,
      plannedCount: 0,
      gain: null,
      offsetAdu: null,
      binning: 1,
      readoutMode: null,
      moonMode: 'none',
      moonProfileId: null,
      enabled: true,
      notes: '',
    },
    now,
  );
  const observation = (projectId: string, epoch: number) => ({
    projectId,
    ephemerisId: '',
    epoch,
    night: '2026-10-10',
    ingressUtc: new Date('2026-10-11T04:44:00Z'),
    midUtc: new Date('2026-10-11T06:45:00Z'),
    egressUtc: new Date('2026-10-11T08:46:00Z'),
    windowStartUtc: new Date('2026-10-11T03:39:00Z'),
    windowEndUtc: new Date('2026-10-11T09:51:00Z'),
    baselineBeforeMin: 60,
    baselineAfterMin: 60,
    bufferMin: 5,
    plannedCount: 350,
    confirmDeadlineUtc: new Date('2026-10-11T03:21:00Z'),
  });
  const ephemerisOf = async (projectId: string) =>
    (await repos.exoProjects().ephemerides(projectId))[0]?.id as string;
  const wishId = await repos.transits().lock(
    {
      observation: { ...observation(E, 402), ephemerisId: await ephemerisOf(E) },
      rigId: rig.id,
      planet: hat.planet,
      mode: 'wish',
      maxOpen: null,
      line: null,
    },
    now,
  );
  const exoApproved = await projects.createExoplanet(
    {
      ...base,
      id: crypto.randomUUID(),
      name: 'HAT-P-17b B',
      targetName: 'HAT-P-17',
      raDeg: hat.raDeg,
      decDeg: hat.decDeg,
    },
    {
      planet: hat.planet,
      star: hat.star,
      catalog: hat.catalog,
      catalogEntryId: hat.id,
      bufferSigma: 1,
      catalogSnapshot: snapshotOf(hat),
      ephemeris: ephemerisOf2(hat),
      line: { filterId: filter.id, exposureS: 60 },
    },
    now,
  );
  const EA = exoApproved.project.id;
  await admin().query(
    "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id WHERE id = $1",
    [EA],
  );
  const confirmId = await repos.transits().lock(
    {
      observation: { ...observation(EA, 404), ephemerisId: await ephemerisOf(EA) },
      rigId: rig.id,
      planet: hat.planet,
      mode: 'request',
      maxOpen: null,
      line: null,
    },
    now,
  );
  const reopen = (id: string) => () =>
    admin().query(
      "UPDATE transit_observation SET status = 'requested', locked_at = NULL, locked_by = NULL WHERE id = $1",
      [id],
    );
  const approvedRes: ResourceMeta = {
    tenantId: world.tenantA,
    createdBy: world.members.owner,
    approvalStatus: 'approved',
  };
  const exoRig = await eq.createRig(
    crypto.randomUUID(),
    { ...rigInput(site.id, telescope.id, camera.id), name: 'Exo-Rig' },
    now,
  );
  const clearExoRig = async () => {
    const ids = (
      await admin().query(
        "SELECT id FROM project WHERE requested_rig_id = $1 AND project_type = 'exoplanet'",
        [exoRig.id],
      )
    ).rows.map((r) => (r as { id: string }).id);
    if (ids.length === 0) return;
    for (const table of ['ephemeris', 'exo_project', 'exposure_line', 'project_panel'])
      await admin().query(`DELETE FROM ${table} WHERE project_id = ANY($1)`, [ids]);
    await admin().query('DELETE FROM change_log WHERE entity_id = ANY($1)', [ids]);
    await admin().query('DELETE FROM project WHERE id = ANY($1)', [ids]);
  };
  await admin().query(
    "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id WHERE id = $1",
    [Q],
  );
  await admin().query('UPDATE project SET deleted_at = now() WHERE id = $1', [T]);
  const owner = world.members.owner;
  const draftRes: ResourceMeta = {
    tenantId: world.tenantA,
    createdBy: owner,
    approvalStatus: 'draft',
  };
  const qRes: ResourceMeta = {
    tenantId: world.tenantA,
    createdBy: owner,
    approvalStatus: 'approved',
  };
  const P = '/api/web/v1/projects';
  const lineBody = () => ({
    id: crypto.randomUUID(),
    panelId: panel,
    filterId: filter.id,
    exposureS: 120,
    plannedCount: 5,
    moonMode: 'none',
  });
  // Duplizieren: Routen-Aktion project.create (jedes Mitglied); die Quelle muss lesbar sein.
  const readableOnly = { User: 403, 'Admin ohne 2FA': 403 };
  return {
    [`GET ${P}`]: { url: P },
    [`POST ${P}`]: {
      url: P,
      method: 'POST',
      body: () => ({ id: crypto.randomUUID(), name: 'Neu' }),
      okStatus: 201,
    },
    [`GET ${P}/{id}`]: { url: `${P}/${D}`, resource: draftRes },
    'POST /api/web/v1/exo/projects': {
      url: '/api/web/v1/exo/projects',
      method: 'POST',
      body: () => ({
        id: crypto.randomUUID(),
        rigId: exoRig.id,
        catalog: 'exoclock',
        planet: 'HAT-P-17b',
      }),
      reset: clearExoRig,
      okStatus: 201,
      // Rig eines anderen Mandanten: unsichtbar.
      expect: { 'fremder Mandant (Admin)': 404 },
    },
    [`GET ${P}/{id}/exo`]: { url: `${P}/${E}/exo`, resource: draftRes },
    [`POST ${P}/{id}/ephemeris/refresh`]: {
      url: `${P}/${E}/ephemeris/refresh`,
      method: 'POST',
      resource: draftRes,
    },
    [`POST ${P}/{id}/exo/lock`]: {
      url: `${P}/${E}/exo/lock`,
      method: 'POST',
      body: { epoch: 402 },
      resource: draftRes,
    },
    [`DELETE ${P}/{id}/exo/lock/{observationId}`]: {
      url: `${P}/${E}/exo/lock/${wishId}`,
      method: 'DELETE',
      resource: draftRes,
      reset: reopen(wishId),
    },
    [`PATCH ${P}/{id}/exo`]: {
      url: `${P}/${E}/exo`,
      method: 'PATCH',
      body: { allowRecenter: true },
      resource: draftRes,
    },
    'POST /api/web/v1/transit-observations/{id}/confirm': {
      url: `/api/web/v1/transit-observations/${confirmId}/confirm`,
      method: 'POST',
      resource: approvedRes,
      reset: reopen(confirmId),
      okStatus: 204,
    },
    'POST /api/web/v1/transit-observations/{id}/decline': {
      url: `/api/web/v1/transit-observations/${confirmId}/decline`,
      method: 'POST',
      body: { comment: 'Nacht belegt' },
      resource: approvedRes,
      reset: reopen(confirmId),
      okStatus: 204,
    },
    [`PATCH ${P}/{id}`]: {
      url: `${P}/${D}`,
      method: 'PATCH',
      body: { name: 'Entwurf' },
      resource: draftRes,
    },
    [`DELETE ${P}/{id}`]: {
      url: `${P}/${D}`,
      method: 'DELETE',
      resource: draftRes,
      okStatus: 204,
      reset: () => admin().query('UPDATE project SET deleted_at = NULL WHERE id = $1', [D]),
    },
    [`POST ${P}/{id}/restore`]: {
      url: `${P}/${T}`.concat('/restore'),
      method: 'POST',
      resource: draftRes,
      reset: () => admin().query('UPDATE project SET deleted_at = now() WHERE id = $1', [T]),
    },
    [`POST ${P}/{id}/duplicate`]: {
      url: `${P}/${D}/duplicate`,
      method: 'POST',
      body: () => ({ id: crypto.randomUUID() }),
      resource: draftRes,
      okStatus: 201,
      expect: readableOnly,
    },
    [`POST ${P}/{id}/panels`]: {
      url: `${P}/${D}/panels`,
      method: 'POST',
      body: () => ({ id: crypto.randomUUID(), raDeg: 13.9, decDeg: 56.6 }),
      resource: draftRes,
      okStatus: 201,
    },
    [`PATCH ${P}/{id}/panels/{panelId}`]: {
      url: `${P}/${D}/panels/${panel}`,
      method: 'PATCH',
      body: { label: 'Main' },
      resource: draftRes,
    },
    // Unvollständige Liste: nach der Rechteprüfung 422 (die Panels ändern sich durch andere Beispiele).
    [`PUT ${P}/{id}/panels/order`]: {
      url: `${P}/${D}/panels/order`,
      method: 'PUT',
      body: { panelIds: [crypto.randomUUID()] },
      resource: draftRes,
      okStatus: 422,
    },
    // 1 × 1 behält Panel 1 (vom PATCH-Beispiel benutzt) und entfernt nur hinzugefügte Panels.
    [`POST ${P}/{id}/mosaic`]: {
      url: `${P}/${D}/mosaic`,
      method: 'POST',
      body: { raDeg: 13.2458, decDeg: 56.6194, rotationDeg: 0, cols: 1, rows: 1, overlapPct: 20 },
      resource: draftRes,
    },
    [`DELETE ${P}/{id}/panels/{panelId}`]: {
      url: `${P}/${D}/panels/${crypto.randomUUID()}`,
      method: 'DELETE',
      resource: draftRes,
      okStatus: 404,
    },
    [`POST ${P}/{id}/lines`]: {
      url: `${P}/${D}/lines`,
      method: 'POST',
      body: lineBody,
      resource: draftRes,
      okStatus: 201,
    },
    [`PATCH ${P}/{id}/lines/{lineId}`]: {
      url: `${P}/${D}/lines/${line}`,
      method: 'PATCH',
      body: { plannedCount: 20 },
      resource: draftRes,
    },
    [`DELETE ${P}/{id}/lines/{lineId}`]: {
      url: `${P}/${D}/lines/${crypto.randomUUID()}`,
      method: 'DELETE',
      resource: draftRes,
      okStatus: 404,
    },
    [`POST ${P}/{id}/lines/{lineId}/duplicate`]: {
      url: `${P}/${D}/lines/${line}/duplicate`,
      method: 'POST',
      body: () => ({ id: crypto.randomUUID() }),
      resource: draftRes,
      okStatus: 201,
    },
    [`POST ${P}/{id}/apply-template`]: {
      url: `${P}/${D}/apply-template`,
      method: 'POST',
      body: { templateId: template.id, replace: false },
      resource: draftRes,
    },
    [`PUT ${P}/{id}/status`]: {
      url: `${P}/${Q}/status`,
      method: 'PUT',
      body: { status: 'on_hold' },
      resource: qRes,
      reset: () => admin().query("UPDATE project SET status = 'active' WHERE id = $1", [Q]),
    },
    [`PUT ${P}/{id}/priority`]: {
      url: `${P}/${Q}/priority`,
      method: 'PUT',
      body: { position: 1 },
      resource: qRes,
    },
    'PUT /api/web/v1/me/favorites/{projectId}': {
      url: `/api/web/v1/me/favorites/${Q}`,
      method: 'PUT',
      resource: qRes,
      okStatus: 204,
    },
    'DELETE /api/web/v1/me/favorites/{projectId}': {
      url: `/api/web/v1/me/favorites/${Q}`,
      method: 'DELETE',
      resource: qRes,
      okStatus: 204,
    },
    [`GET ${P}/{id}/notes`]: { url: `${P}/${Q}/notes`, resource: qRes },
    [`POST ${P}/{id}/notes`]: {
      url: `${P}/${Q}/notes`,
      method: 'POST',
      body: { bodyMd: 'Framing passt.' },
      resource: qRes,
      okStatus: 201,
    },
    [`GET ${P}/{id}/history`]: { url: `${P}/${Q}/history`, resource: qRes },
    'POST /api/web/v1/rigs/{id}/compatibility': {
      url: `/api/web/v1/rigs/${rig.id}/compatibility`,
      method: 'POST',
      body: { projectId: Q },
      resource: qRes,
    },
    ...(await approvalExamples(base, filter.id)),
  };

  /**
   * Freigabe-Workflow (AP-12a): eingereichtes Objekt eines eigenen Einreichers (keine Persona, damit
   * „eigene Objekte“ die Rechte-Erwartung nicht verändern), Entwurf und Einreichung des Owners für
   * Einreichen/Zurückziehen. Jedes Beispiel stellt den Ausgangsstatus wieder her.
   */
  async function approvalExamples(
    common: typeof base,
    filterId: string,
  ): Promise<Record<string, Example>> {
    const identity = await stack.seed.identity();
    const submitter = await stack.seed.member(identity.id, world.tenantA, 'user');
    const complete = async (memberId: string, name: string) => {
      const repo = stack.services.repositories({ tenantId: world.tenantA, memberId }).projects();
      const d = await repo.create({ ...common, id: crypto.randomUUID(), name }, now);
      await repo.addLine(
        d.project.id,
        {
          id: crypto.randomUUID(),
          panelId: d.panels[0]?.id as string,
          filterId,
          exposureS: 300,
          plannedCount: 20,
          gain: null,
          offsetAdu: null,
          binning: 1,
          readoutMode: null,
          moonMode: 'none',
          moonProfileId: null,
          enabled: true,
          notes: '',
        },
        now,
      );
      return d.project.id;
    };
    const S = await complete(submitter, 'Eingereicht');
    const OD = await complete(owner, 'Owner-Entwurf');
    const OS = await complete(owner, 'Owner-Einreichung');
    const submitted = (id: string) =>
      admin().query(
        "UPDATE project SET approval_status = 'submitted', status = NULL, rig_id = NULL, submitter_rank = 1 WHERE id = $1",
        [id],
      );
    await submitted(S);
    await submitted(OS);
    const sRes: ResourceMeta = {
      tenantId: world.tenantA,
      createdBy: submitter,
      approvalStatus: 'submitted',
    };
    const odRes: ResourceMeta = {
      tenantId: world.tenantA,
      createdBy: owner,
      approvalStatus: 'draft',
    };
    const osRes: ResourceMeta = {
      tenantId: world.tenantA,
      createdBy: owner,
      approvalStatus: 'submitted',
    };
    const instance = await stack.services
      .repositories({ tenantId: world.tenantA, memberId: owner })
      .ninaInstances()
      .create(
        {
          id: crypto.randomUUID(),
          rigId: common.rigId,
          name: 'Rechte-PC',
          tokenHash: 'e'.repeat(64),
          tokenPrefix: 'npm_rech',
        },
        stack.clock.now(),
      );
    // Session am Rig von Mandant A mit freigegebenem Projekt eines Nicht-Persona-Users (AP-15).
    const SP = await complete(submitter, 'Session-Projekt');
    await admin().query(
      "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = $2 WHERE id = $1",
      [SP, common.rigId],
    );
    const spLine = (
      (await admin().query('SELECT id FROM exposure_line WHERE project_id = $1', [SP])).rows[0] as {
        id: string;
      }
    ).id;
    const sessionId = crypto.randomUUID();
    await admin().query(
      "INSERT INTO session (id, tenant_id, rig_id, night, started_at, status) VALUES ($1, $2, $3, '2026-09-18', '2026-09-19T01:00:00Z', 'completed')",
      [sessionId, world.tenantA, common.rigId],
    );
    // Gespeichertes Light der Zeile (AP-31): Verwerfen setzt der Reset zurück.
    const spPanel = (
      (await admin().query('SELECT panel_id FROM exposure_line WHERE id = $1', [spLine]))
        .rows[0] as { panel_id: string }
    ).panel_id;
    const captureId = crypto.randomUUID();
    await admin().query(
      `INSERT INTO capture (id, tenant_id, session_id, project_id, panel_id, exposure_line_id, night,
         captured_at, filter_short_name, exposure_s, result, file_name)
       VALUES ($1, $2, $3, $4, $5, $6, '2026-09-18', '2026-09-19T02:00:00Z', 'Ha', 300, 'saved', 'a.fits')`,
      [captureId, world.tenantA, sessionId, SP, spPanel, spLine],
    );
    const siteId = (
      (await admin().query('SELECT site_id FROM rig WHERE id = $1', [common.rigId])).rows[0] as {
        site_id: string;
      }
    ).site_id;
    const clearNight = `/api/web/v1/sites/${siteId}/clear-nights/2026-09-10`;
    const clearVotes = () => admin().query('DELETE FROM queue_vote WHERE subject_id = $1', [S]);
    // Änderungsantrag des Einreichers zum freigegebenen Session-Projekt (AP-32b).
    const cr = await stack.services
      .repositories({ tenantId: world.tenantA, memberId: submitter })
      .changeRequests()
      .create(
        SP,
        {
          proposal: { lines: [{ lineId: spLine, plannedCount: 50 }], newLines: [] },
          comment: null,
        },
        stack.clock.now(),
      );
    const crId = cr.row.id;
    const crRes = { tenantId: world.tenantA, createdBy: submitter, status: 'open' };
    const reopen = () =>
      admin().query(
        "UPDATE change_request SET status = 'open', decided_by = NULL, decided_at = NULL, submitter_rank = 1 WHERE id = $1",
        [crId],
      );
    return {
      'GET /api/web/v1/sessions': { url: '/api/web/v1/sessions' },
      'GET /api/web/v1/dso': { url: '/api/web/v1/dso?q=M%2031' },
      'GET /api/web/v1/dso/region': { url: '/api/web/v1/dso/region?ra=10&dec=41&radius=2' },
      'GET /api/web/v1/exo/transits': {
        url: `/api/web/v1/exo/transits?rigId=${common.rigId}&night=2026-10-10`,
        // Rig eines anderen Mandanten: unsichtbar (Mandantentrennung), wie `GET /forecast`.
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'GET /api/web/v1/sessions/{id}': {
        url: `/api/web/v1/sessions/${sessionId}`,
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'POST /api/web/v1/sessions/{id}/corrections': {
        url: `/api/web/v1/sessions/${sessionId}/corrections`,
        method: 'POST',
        body: { exposureLineId: spLine, rejected: 0 },
        resource: {
          tenantId: world.tenantA,
          createdBy: submitter,
          settings: { userCorrections: false },
        },
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'GET /api/web/v1/sessions/{id}/log': {
        url: `/api/web/v1/sessions/${sessionId}/log`,
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'PUT /api/web/v1/sessions/{id}/log': {
        url: `/api/web/v1/sessions/${sessionId}/log`,
        method: 'PUT',
        body: { ...EMPTY_SESSION_LOG, sqm: 21.2 },
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'GET /api/web/v1/sites/{id}/clear-nights': {
        url: `/api/web/v1/sites/${siteId}/clear-nights?from=2026-09-01&to=2026-09-23`,
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'PUT /api/web/v1/sites/{id}/clear-nights/{night}': {
        url: clearNight,
        method: 'PUT',
        body: { usable: false },
        okStatus: 204,
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'DELETE /api/web/v1/sites/{id}/clear-nights/{night}': {
        url: clearNight,
        method: 'DELETE',
        okStatus: 204,
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'PATCH /api/web/v1/captures/{id}': {
        url: `/api/web/v1/captures/${captureId}`,
        method: 'PATCH',
        body: { rejected: false },
        resource: {
          tenantId: world.tenantA,
          createdBy: submitter,
          settings: { userCorrections: false },
        },
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'PUT /api/web/v1/sessions/{id}/review': {
        url: `/api/web/v1/sessions/${sessionId}/review`,
        method: 'PUT',
        body: { reviewed: false },
        okStatus: 204,
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      [`POST ${P}/{id}/submit`]: {
        url: `${P}/${OD}/submit`,
        method: 'POST',
        body: {},
        resource: odRes,
        reset: () =>
          admin().query(
            "UPDATE project SET approval_status = 'draft', submitter_rank = NULL WHERE id = $1",
            [OD],
          ),
      },
      [`POST ${P}/{id}/withdraw`]: {
        url: `${P}/${OS}/withdraw`,
        method: 'POST',
        resource: osRes,
        reset: () => submitted(OS),
      },
      [`POST ${P}/{id}/approve`]: {
        url: `${P}/${S}/approve`,
        method: 'POST',
        body: { rigId: common.rigId, status: 'active' },
        resource: sRes,
        reset: () => submitted(S),
      },
      [`POST ${P}/{id}/return`]: {
        url: `${P}/${S}/return`,
        method: 'POST',
        body: { comment: 'Bitte überarbeiten' },
        resource: sRes,
        reset: () => submitted(S),
      },
      [`POST ${P}/{id}/reject`]: {
        url: `${P}/${S}/reject`,
        method: 'POST',
        body: { comment: 'Außerhalb der Saison' },
        resource: sRes,
        reset: () => submitted(S),
      },
      'GET /api/web/v1/queue': { url: '/api/web/v1/queue' },
      'GET /api/web/v1/nina-instances': { url: '/api/web/v1/nina-instances' },
      'POST /api/web/v1/nina-instances': {
        url: '/api/web/v1/nina-instances',
        method: 'POST',
        okStatus: 201,
        body: () => ({ id: crypto.randomUUID(), rigId: common.rigId, name: 'Beobachtungs-PC' }),
        // Das Rig gehört zu Mandant A.
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'POST /api/web/v1/rigs/{id}/lease/release': {
        url: `/api/web/v1/rigs/${common.rigId}/lease/release`,
        method: 'POST',
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      // Unbekannte Aufnahme: nach der Rechteprüfung 404 (das Objekt ist ein Pfadparameter).
      'PATCH /api/web/v1/captures/{id}/assign': {
        url: `/api/web/v1/captures/${crypto.randomUUID()}/assign`,
        method: 'PATCH',
        body: { exposureLineId: crypto.randomUUID() },
        okStatus: 404,
      },
      // Unbekannte Instanz: nach der Rechteprüfung 404 (Löschen verändert sonst den Ausgangszustand).
      'DELETE /api/web/v1/nina-instances/{id}': {
        url: `/api/web/v1/nina-instances/${crypto.randomUUID()}`,
        method: 'DELETE',
        okStatus: 404,
      },
      'GET /api/web/v1/nina-instances/{id}/diagnostics': {
        url: `/api/web/v1/nina-instances/${instance.id}/diagnostics`,
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'GET /api/web/v1/rigs/{id}/delivery': {
        url: `/api/web/v1/rigs/${common.rigId}/delivery`,
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'POST /api/web/v1/nina-instances/{id}/revoke': {
        url: `/api/web/v1/nina-instances/${instance.id}/revoke`,
        method: 'POST',
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'POST /api/web/v1/simulations': {
        url: '/api/web/v1/simulations',
        method: 'POST',
        okStatus: 201,
        // Das Rig gehört zu Mandant A: für den fremden Mandanten existiert es nicht.
        expect: { 'fremder Mandant (Admin)': 404 },
        body: {
          rigId: common.rigId,
          night: '2026-09-17',
          plan: {
            nightPlanId: '0190c3f4-0000-7000-8000-00000000abcd',
            engineVersion: '0.6.0',
            inputHash: `sha256:${'a'.repeat(64)}`,
            outputHash: `sha256:${'b'.repeat(64)}`,
            night: '2026-09-17',
            startAtUtc: null,
            nightWindow: { startUtc: '2026-09-17T23:00:00Z', endUtc: '2026-09-18T12:00:00Z' },
            darkness: {
              civilStartUtc: null,
              civilEndUtc: null,
              nauticalStartUtc: null,
              nauticalEndUtc: null,
              astronomicalStartUtc: null,
              astronomicalEndUtc: null,
            },
            darknessEndUtc: null,
            flatsNotBeforeUtc: '2026-09-18T11:00:00Z',
            flatsNotAfterUtc: null,
            sessionEndUtc: '2026-09-18T12:00:00Z',
            blocks: [],
            summary: { targets: 0, plannedFrames: {} },
            diagnostics: [],
            warnings: [],
          },
        },
      },
      'POST /api/web/v1/projects/{id}/change-requests': {
        url: `/api/web/v1/projects/${SP}/change-requests`,
        method: 'POST',
        okStatus: 201,
        body: { proposal: { lines: [{ lineId: spLine, enabled: false }] }, comment: null },
        resource: { tenantId: world.tenantA, createdBy: submitter, approvalStatus: 'approved' },
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'GET /api/web/v1/projects/{id}/change-requests': {
        url: `/api/web/v1/projects/${SP}/change-requests`,
        resource: { tenantId: world.tenantA, createdBy: submitter, approvalStatus: 'approved' },
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'GET /api/web/v1/change-requests/{id}': {
        url: `/api/web/v1/change-requests/${crId}`,
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'PATCH /api/web/v1/change-requests/{id}': {
        url: `/api/web/v1/change-requests/${crId}`,
        method: 'PATCH',
        body: { proposal: { lines: [{ lineId: spLine, plannedCount: 60 }] }, comment: 'mehr Ha' },
        resource: crRes,
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      // Zurückziehen darf nur der Antragsteller (kein Persona) – Admins lehnen ab statt zurückzuziehen.
      'POST /api/web/v1/change-requests/{id}/withdraw': {
        url: `/api/web/v1/change-requests/${crId}/withdraw`,
        method: 'POST',
        resource: crRes,
        okStatus: 403,
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'POST /api/web/v1/change-requests/{id}/decide': {
        url: `/api/web/v1/change-requests/${crId}/decide`,
        method: 'POST',
        body: { decision: 'rejected', comment: 'nicht jetzt', projectVersion: 1 },
        reset: reopen,
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'GET /api/web/v1/reports/projects': {
        url: '/api/web/v1/reports/projects?from=2026-09-01&to=2026-09-30',
      },
      'GET /api/web/v1/tonight': { url: '/api/web/v1/tonight' },
      'PUT /api/web/v1/projects/{id}/lines/{lineId}/tonight': {
        url: `/api/web/v1/projects/${SP}/lines/${spLine}/tonight`,
        method: 'PUT',
        body: { disabled: true },
        expect: { 'fremder Mandant (Admin)': 404 },
        reset: () =>
          admin().query('UPDATE exposure_line SET disabled_for_night = NULL WHERE id = $1', [
            spLine,
          ]),
      },
      'GET /api/web/v1/forecast': {
        url: `/api/web/v1/forecast?rigId=${common.rigId}`,
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'POST /api/web/v1/forecast/run': {
        url: '/api/web/v1/forecast/run',
        method: 'POST',
        okStatus: 202,
        body: { rigId: common.rigId },
        expect: { 'fremder Mandant (Admin)': 404 },
      },
      'POST /api/web/v1/simulations/multi': {
        url: '/api/web/v1/simulations/multi',
        method: 'POST',
        okStatus: 202,
        expect: { 'fremder Mandant (Admin)': 404 },
        body: { rigId: common.rigId, nightFrom: '2026-09-18', nights: 2 },
      },
      'POST /api/web/v1/queue/{kind}/{id}/impact': {
        url: `/api/web/v1/queue/project/${S}/impact`,
        method: 'POST',
        resource: sRes,
        okStatus: 202,
      },
      'PUT /api/web/v1/queue/{kind}/{id}/vote': {
        url: `/api/web/v1/queue/project/${S}/vote`,
        method: 'PUT',
        resource: sRes,
        reset: clearVotes,
      },
      'DELETE /api/web/v1/queue/{kind}/{id}/vote': {
        url: `/api/web/v1/queue/project/${S}/vote`,
        method: 'DELETE',
        resource: sRes,
      },
      'POST /api/web/v1/queue/{kind}/{id}/vote/acknowledge': {
        url: `/api/web/v1/queue/project/${S}/vote/acknowledge`,
        method: 'POST',
        resource: sRes,
        okStatus: 204,
      },
      // Leere Rangfolge: vollständig für alle ohne offene Einreichung; der Owner hat eine (422).
      'PUT /api/web/v1/me/submission-ranking': {
        url: '/api/web/v1/me/submission-ranking',
        method: 'PUT',
        body: { items: [] },
        okStatus: 204,
        expect: { Owner: 422 },
      },
      'GET /api/web/v1/drafts': { url: '/api/web/v1/drafts' },
    };
  }
}

function systemExamples(): Record<string, Example> {
  let n = 0;
  return {
    'GET /api/system/v1/tenants': { url: '/api/system/v1/tenants' },
    'GET /api/system/v1/catalogs': { url: '/api/system/v1/catalogs' },
    // Offener Job wird wiederverwendet (Deduplizierung), der Invoker ist im Test ein No-op.
    'POST /api/system/v1/catalogs/{catalog}/refresh': {
      url: '/api/system/v1/catalogs/dso/refresh',
      method: 'POST',
      okStatus: 202,
    },
    'POST /api/system/v1/tenants': {
      url: '/api/system/v1/tenants',
      method: 'POST',
      body: () => ({ tenantKey: `rights-${(n += 1)}`, displayName: 'Rechte-Test' }),
      okStatus: 201,
    },
    'PATCH /api/system/v1/tenants/{id}': {
      url: `/api/system/v1/tenants/${world.tenantB}`,
      method: 'PATCH',
      body: { status: 'active' },
    },
    'POST /api/system/v1/tenants/{id}/invitations': {
      url: `/api/system/v1/tenants/${world.tenantB}/invitations`,
      method: 'POST',
      body: () => ({ id: crypto.randomUUID() }),
      okStatus: 201,
    },
    'PUT /api/system/v1/tenants/{id}/owner': {
      url: `/api/system/v1/tenants/${world.tenantB}/owner`,
      method: 'PUT',
      body: {
        memberId: world.members.foreignAdmin,
        reason: 'Rechte-Test',
        keepPreviousAsAdmin: true,
      },
      reset: () =>
        admin().query('UPDATE tenant SET owner_member_id = NULL WHERE id = $1', [world.tenantB]),
    },
    'GET /api/system/v1/tenants/{id}/members': {
      url: `/api/system/v1/tenants/${world.tenantA}/members`,
    },
    'GET /api/system/v1/super-users': { url: '/api/system/v1/super-users' },
    'POST /api/system/v1/super-users': {
      url: '/api/system/v1/super-users',
      method: 'POST',
      body: { discordUserId: '9'.repeat(18) },
      okStatus: 404,
    },
    'PATCH /api/system/v1/super-users/{id}': {
      url: `/api/system/v1/super-users/${world.identities.superUser}`,
      method: 'PATCH',
      body: { status: 'active' },
      okStatus: 204,
    },
    'DELETE /api/system/v1/super-users/{id}': {
      url: `/api/system/v1/super-users/${crypto.randomUUID()}`,
      method: 'DELETE',
      okStatus: 404,
    },
    'PATCH /api/system/v1/identities/{id}': {
      url: `/api/system/v1/identities/${world.identities.user2}`,
      method: 'PATCH',
      body: { status: 'active' },
      okStatus: 204,
    },
    'DELETE /api/system/v1/tenants/{id}': {
      url: `/api/system/v1/tenants/${crypto.randomUUID()}`,
      method: 'DELETE',
      body: { confirmTenantKey: 'gibt-es-nicht' },
      okStatus: 404,
    },
    'GET /api/system/v1/audit': { url: '/api/system/v1/audit' },
    'GET /api/system/v1/settings/{key}': { url: '/api/system/v1/settings/maintenanceBanner' },
    'PUT /api/system/v1/settings/{key}': {
      url: '/api/system/v1/settings/maintenanceBanner',
      method: 'PUT',
      body: { value: { active: false, textDe: '', textEn: '' } },
    },
    'GET /api/system/v1/identities': {
      url: '/api/system/v1/identities?discordUserId=' + '9'.repeat(18),
      okStatus: 404,
    },
  };
}

const routeKey = (r: { method: string; path: string }) => `${r.method.toUpperCase()} ${r.path}`;
const metaOf = (r: object) => r as { 'x-npm-action': Action; 'x-npm-session'?: 'required' };

async function call(persona: Persona, example: Example) {
  const sid = await persona.session();
  const auth = sid
    ? (await resolveSessionState(stack.services.auth, sid, stack.clock.now())).auth
    : null;
  const body =
    typeof example.body === 'function' ? (example.body as () => unknown)() : example.body;
  const res = await stack.request(example.url, {
    method: example.method ?? 'GET',
    ...(body !== undefined ? { body } : {}),
    ...(sid ? { cookies: { [COOKIE_NAMES.session]: sid } } : {}),
  });
  await example.reset?.();
  const text = await res.text();
  const code = text.startsWith('{') ? (JSON.parse(text) as { code?: string }).code : undefined;
  return { status: res.status, code, auth };
}

describe('Rechte-Tests: Route × Rolle (generiert)', () => {
  it('jede Route hat eine Aktion und ein Beispiel', () => {
    for (const route of ROUTES) {
      expect(metaOf(route)['x-npm-action'], routeKey(route)).toBeTruthy();
      expect(EXAMPLES[routeKey(route)], `Beispiel fehlt für ${routeKey(route)}`).toBeDefined();
    }
  });

  for (const route of ROUTES) {
    const key = routeKey(route);
    const { 'x-npm-action': action, 'x-npm-session': session } = metaOf(route);
    describe(`${key} (${action}${session ? ', Sitzung' : ''})`, () => {
      const names = [
        'Owner',
        'Admin',
        'Admin ohne 2FA',
        'User',
        'fremder Mandant (Admin)',
        'anonym',
        'Super User im System-Kontext',
      ];
      for (const name of names) {
        it(name, async () => {
          const example = EXAMPLES[key];
          const persona = world.personas.find((p) => p.name === name);
          if (!example || !persona) throw new Error('Beispiel/Persona fehlt');
          const { status, code, auth } = await call(persona, example);
          const ok = example.expect?.[name] ?? example.okStatus ?? 200;
          if (action === 'public' && !session) {
            expect(status).toBe(ok);
          } else if (!auth) {
            expect([status, code]).toEqual([401, 'auth.unauthenticated']);
          } else if (action === 'public') {
            expect(status).toBe(ok);
          } else if (!can(auth, action)) {
            expect([status, code]).toEqual([403, 'permission.denied']);
          } else if (persona.foreign && example.resource) {
            // Mandantengebundenes Repository: fremde Objekte existieren nicht.
            expect(status).toBe(404);
          } else if (can(auth, action, example.resource)) {
            expect(status).toBe(ok);
          } else {
            expect([status, code]).toEqual([403, 'permission.denied']);
          }
        });
      }

      it('Admin ohne 2FA verhält sich wie User (SV-03)', async () => {
        const example = EXAMPLES[key];
        const noMfa = world.personas.find((p) => p.name === 'Admin ohne 2FA');
        const user2 = world.personas.find((p) => p.name === 'User 2');
        if (!example || !noMfa || !user2) throw new Error('Personas fehlen');
        const a = await call(noMfa, example);
        const b = await call(user2, example);
        expect({ status: a.status, code: a.code }).toEqual({ status: b.status, code: b.code });
      });
    });
  }
});
