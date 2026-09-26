/**
 * Job `thumbnail` (AP-25; FA-PRJ-02, TK 7.4/12/13; PGlite): Projektänderung legt den Job an; der Job
 * holt den Ausschnitt einmal (hips2fits nachgebildet), legt ihn unter `catalog/thumbs/<sha256>.jpg` ab
 * und setzt `project.thumbnail_s3_key` ohne Versionssprung; unveränderter Ausschnitt → nichts; gleicher
 * Ausschnitt bei einem anderen Projekt → kein zweiter Abruf; falsche Antwort → Job fehlgeschlagen, kein
 * Schlüssel; `tick-hourly` holt Projekte ohne Bild nach. Nie unter `catalog/img/…`.
 */
import {
  JobQueue,
  projectsWithoutThumbnail,
  setProjectThumbnail,
  thumbnailKeyInUse,
  type EnqueueInput,
} from '@nina-pm/db';
import { COOKIE_NAMES, hips2fitsUrl, projectThumbnailParams, thumbnailKey } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { thumbnailLoader } from '../src/worker/thumbnail-db';
import { runJob, type JobRunnerDeps } from '../src/worker/jobs';
import {
  runThumbnail,
  thumbnailJobHandler,
  thumbnailTick,
  type ThumbnailDeps,
} from '../src/worker/thumbnail';
import { CAMERA, rigInput, SITE, TELESCOPE } from './support/equipment';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(() => s.reset());
afterAll(() => s.close());

const API = '/api/web/v1';
const id = () => crypto.randomUUID();
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const identity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(identity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const cookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant') };
  const eq = s.services.repositories({ tenantId, memberId: owner }).equipment();
  const now = s.clock.now();
  const site = await eq.createSite(id(), SITE, now);
  const telescope = await eq.createTelescope(id(), TELESCOPE, now);
  const camera = await eq.createCamera(id(), CAMERA, now);
  const rig = await eq.createRig(
    id(),
    { ...rigInput(site.id, telescope.id, camera.id), hasRotator: true },
    now,
  );
  const create = async (body: Record<string, unknown>) => {
    const projectId = id();
    const res = await s.request(`${API}/projects`, {
      method: 'POST',
      body: { id: projectId, name: 'M 31', rigId: rig.id, ...body },
      cookies,
    });
    expect(res.status).toBe(201);
    return projectId;
  };
  return { tenantId, create };
}

function deps(over: Partial<ThumbnailDeps> = {}) {
  const store = new Map<string, Uint8Array>();
  const fetchImage = vi.fn(() => Promise.resolve({ bytes: JPEG, contentType: 'image/jpeg' }));
  const d: ThumbnailDeps = {
    load: thumbnailLoader(() => Promise.resolve(s.pg.db)),
    keyInUse: (key) => thumbnailKeyInUse(s.pg.db, key),
    fetchImage,
    put: (key, bytes) => {
      store.set(key, bytes);
      return Promise.resolve();
    },
    save: (t, p, key) => setProjectThumbnail(s.pg.db, t, p, key),
    ...over,
  };
  return { d, store, fetchImage };
}

async function projectRow(projectId: string) {
  const r = await s.pg.admin.query('SELECT thumbnail_s3_key, version FROM project WHERE id = $1', [
    projectId,
  ]);
  return r.rows[0] as { thumbnail_s3_key: string | null; version: number };
}

describe('Auslöser', () => {
  it('Anlegen und Ändern eines Projekts legen den Job thumbnail:<id> an', async () => {
    const { create } = await setup();
    const projectId = await create({ raDeg: 10.6847, decDeg: 41.269 });
    const jobs = await s.pg.admin.query(
      "SELECT kind, dedupe_key FROM job WHERE kind = 'thumbnail'",
    );
    expect(jobs.rows).toEqual([{ kind: 'thumbnail', dedupe_key: `thumbnail:${projectId}` }]);
  });
});

describe('runThumbnail', () => {
  it('holt den Ausschnitt einmal, legt ihn unter catalog/thumbs/ ab, setzt den Schlüssel ohne Versionssprung', async () => {
    const { tenantId, create } = await setup();
    const projectId = await create({ raDeg: 10.6847, decDeg: 41.269, rotationDeg: 35 });
    const before = await projectRow(projectId);
    const { d, store, fetchImage } = deps();
    expect(await runThumbnail(d, tenantId, projectId)).toBe('fetched');
    const after = await projectRow(projectId);
    expect(after.thumbnail_s3_key).toMatch(/^catalog\/thumbs\/[0-9a-f]{64}\.jpg$/);
    expect(after.version).toBe(before.version);
    expect([...store.keys()]).toEqual([after.thumbnail_s3_key]);
    expect([...store.keys()].some((k) => k.startsWith('catalog/img/'))).toBe(false);
    const loaded = await d.load(tenantId, projectId);
    const params = loaded ? projectThumbnailParams(loaded.project, loaded.rig) : null;
    expect(params).not.toBeNull();
    if (!params) return;
    expect(after.thumbnail_s3_key).toBe(thumbnailKey(params));
    expect(fetchImage).toHaveBeenCalledWith(hips2fitsUrl(params));
    // Ansicht liefert die URL
    expect(loaded?.project.thumbnailUrl).toBe(`/${thumbnailKey(params)}`);
    // Zweiter Lauf ohne Änderung: nichts
    expect(await runThumbnail(d, tenantId, projectId)).toBe('unchanged');
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  it('gleicher Ausschnitt bei einem zweiten Projekt → kein zweiter Abruf', async () => {
    const { tenantId, create } = await setup();
    const a = await create({ raDeg: 83.82, decDeg: -5.39 });
    const b = await create({ raDeg: 83.82, decDeg: -5.39 });
    const { d, fetchImage } = deps();
    expect(await runThumbnail(d, tenantId, a)).toBe('fetched');
    expect(await runThumbnail(d, tenantId, b)).toBe('reused');
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect((await projectRow(b)).thumbnail_s3_key).toBe((await projectRow(a)).thumbnail_s3_key);
  });

  it('ohne Koordinaten kein Bild', async () => {
    const { tenantId, create } = await setup();
    const projectId = await create({});
    const { d, fetchImage } = deps();
    expect(await runThumbnail(d, tenantId, projectId)).toBe('no_frame');
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('falsche Antwort von hips2fits → Job fehlgeschlagen, kein Schlüssel', async () => {
    const { create } = await setup();
    const projectId = await create({ raDeg: 10.6847, decDeg: 41.269 });
    const { d } = deps({
      fetchImage: () => Promise.resolve({ bytes: new Uint8Array(), contentType: 'text/html' }),
    });
    const queue = new JobQueue(s.pg.db);
    const jobs: JobRunnerDeps = {
      queue: () => Promise.resolve(queue),
      handlers: { thumbnail: thumbnailJobHandler(d) },
      now: () => s.clock.now(),
    };
    const row = await s.pg.admin.query("SELECT id FROM job WHERE kind = 'thumbnail'");
    expect(await runJob(jobs, (row.rows[0] as { id: string }).id)).toBe('failed');
    expect((await projectRow(projectId)).thumbnail_s3_key).toBeNull();
  });
});

describe('tick-hourly', () => {
  it('holt Projekte ohne Bild nach, danach nichts mehr', async () => {
    const { tenantId, create } = await setup();
    const a = await create({ raDeg: 10.6847, decDeg: 41.269 });
    await create({});
    // Die vom Anlegen erzeugten Jobs sind erledigt (sonst verhindert dedupe_active einen zweiten).
    await s.pg.admin.query(
      "UPDATE job SET status = 'done', dedupe_active = NULL WHERE kind = 'thumbnail'",
    );
    expect(await projectsWithoutThumbnail(s.pg.db, 20)).toEqual([{ tenantId, projectId: a }]);
    const { d } = deps();
    const queue = new JobQueue(s.pg.db);
    const jobs: JobRunnerDeps = {
      queue: () => Promise.resolve(queue),
      handlers: { thumbnail: thumbnailJobHandler(d) },
      now: () => s.clock.now(),
    };
    const tick = {
      candidates: (limit: number) => projectsWithoutThumbnail(s.pg.db, limit),
      enqueue: (t: string, input: EnqueueInput) =>
        s.services.repositories({ tenantId: t }).job.enqueue(input),
    };
    expect(await thumbnailTick(tick, jobs)).toBe(1);
    expect(await projectsWithoutThumbnail(s.pg.db, 20)).toEqual([]);
    expect(await thumbnailTick(tick, jobs)).toBe(0);
  });
});
