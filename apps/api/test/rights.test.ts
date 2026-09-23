/**
 * Rechte-Testgenerator (TK 5.5, NFA-17): für **jede** registrierte Route × {Owner, Admin, Admin ohne 2FA,
 * User, fremder Mandant, anonym, Super User im System-Kontext} ein Aufruf; erwartet wird, was `can()`
 * mit dem Beispielobjekt sagt. Eine neue Route ohne Beispiel in EXAMPLES lässt den Test scheitern.
 */
import { can, type Action, type ResourceMeta } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../src/app';
import { NOW, testApp, viaCloudFront } from './support/app';
import { MemoryJobs } from './support/memory-jobs';
import { MEMBER, PERSONAS, TENANT_A, type Persona } from './support/personas';

interface Example {
  readonly url: string;
  readonly method?: string;
  readonly body?: unknown;
  /** Objekt, auf das die Route zugreift (für `can` mit Objekt); fehlt bei Routen ohne Objekt. */
  readonly resource?: ResourceMeta;
  readonly okStatus?: number;
}

async function seed(jobs: MemoryJobs) {
  const { jobId } = await jobs.enqueue(TENANT_A, {
    kind: 'multi_sim',
    dedupeKey: 'multi_sim:rig:2026-09-23',
    createdBy: MEMBER.user,
  });
  const job = jobs.rows.get(jobId);
  if (job) {
    jobs.rows.set(jobId, {
      ...job,
      status: 'done',
      dedupeActive: null,
      resultS3Key: `tenant/${TENANT_A}/jobs/${jobId}.json`,
    });
  }
  return jobId;
}

const JOB_ID = '00000000-0000-4000-8000-000000000001';
const ownJob: ResourceMeta = { tenantId: TENANT_A, createdBy: MEMBER.user };

const EXAMPLES: Record<string, Example> = {
  'GET /api/health': { url: '/api/health' },
  'GET /api/web/v1/jobs/{id}': { url: `/api/web/v1/jobs/${JOB_ID}`, resource: ownJob },
  'GET /api/web/v1/files/download-url': {
    url: `/api/web/v1/files/download-url?purpose=job_result&id=${JOB_ID}`,
    resource: ownJob,
  },
};

const routeKey = (r: { method: string; path: string }) => `${r.method.toUpperCase()} ${r.path}`;
const actionOf = (r: object) => (r as { 'x-npm-action': Action })['x-npm-action'];

async function call(persona: Persona, example: Example) {
  const jobs = new MemoryJobs(() => NOW);
  await seed(jobs);
  const { app } = testApp(persona.auth, jobs);
  const res = await app.request(example.url, {
    method: example.method ?? 'GET',
    headers: { ...viaCloudFront, 'x-npm-request': '1', 'content-type': 'application/json' },
    ...(example.body ? { body: JSON.stringify(example.body) } : {}),
  });
  const body = (await res.json()) as { code?: string };
  return { status: res.status, code: body.code };
}

describe('Rechte-Tests: Route × Rolle (generiert)', () => {
  it('jede Route hat eine Aktion und ein Beispiel', () => {
    for (const route of ROUTES) {
      expect(actionOf(route), routeKey(route)).toBeTruthy();
      expect(EXAMPLES[routeKey(route)], `Beispiel fehlt für ${routeKey(route)}`).toBeDefined();
    }
  });

  for (const route of ROUTES) {
    const key = routeKey(route);
    const action = actionOf(route);
    const example = EXAMPLES[key];
    if (!example) continue;
    describe(`${key} (${action})`, () => {
      for (const persona of PERSONAS) {
        it(persona.name, async () => {
          const { status, code } = await call(persona, example);
          const ok = example.okStatus ?? 200;
          if (action === 'public') {
            expect(status).toBe(ok);
          } else if (!persona.auth) {
            expect([status, code]).toEqual([401, 'auth.unauthenticated']);
          } else if (!can(persona.auth, action)) {
            expect([status, code]).toEqual([403, 'permission.denied']);
          } else if (persona.foreign && example.resource) {
            // Mandantengebundenes Repository: fremde Objekte existieren nicht.
            expect(status).toBe(404);
          } else if (can(persona.auth, action, example.resource)) {
            expect(status).toBe(ok);
          } else {
            expect([status, code]).toEqual([403, 'permission.denied']);
          }
        });
      }

      it('Admin ohne 2FA verhält sich wie User (SV-03)', async () => {
        const noMfa = PERSONAS.find((p) => p.name === 'Admin ohne 2FA');
        const user = PERSONAS.find((p) => p.name === 'User');
        if (!noMfa?.auth || !user?.auth) throw new Error('Personas fehlen');
        const asUser: Persona = {
          name: 'User mit Admin-ID',
          auth: { ...user.auth, memberId: noMfa.auth.memberId },
        };
        expect(await call(noMfa, example)).toEqual(await call(asUser, example));
      });
    });
  }
});
