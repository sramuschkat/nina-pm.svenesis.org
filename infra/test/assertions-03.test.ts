import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { resources, synth } from './synth';

// AP-03: Stack Migrate, Rolle NinaPmMigrate, DB-Rolle je Lambda (TK 6.8, iam.md §4, SEC-4).
const t = synth();
const all = [t.data, t.config, t.cert, t.web, t.migrate, t.edge, t.jobs, t.api, t.ops];
const fnByName = (name: string) =>
  all
    .flatMap((tpl) => resources(tpl, 'AWS::Lambda::Function'))
    .find(([, f]) => f.Properties.FunctionName === name)?.[1];
const env = (name: string) =>
  (fnByName(name)?.Properties.Environment as { Variables: Record<string, string> }).Variables;

describe('NinaPm-Migrate', () => {
  it('Lambda nina-pm-migrate mit Rolle NinaPmMigrate, 15 min, liest nur dsql-endpoint', () => {
    const fn = fnByName(config.lambdas.migrate.functionName);
    expect(fn?.Properties).toMatchObject({ Timeout: 900, MemorySize: 512, Runtime: 'nodejs24.x' });
    t.migrate.hasResourceProperties('AWS::IAM::Role', { RoleName: 'NinaPmMigrate' });
    const policies = resources(t.migrate, 'AWS::IAM::Policy').filter(([, p]) =>
      JSON.stringify(p.Properties.Roles).includes('MigrateRole'),
    );
    const doc = JSON.stringify(policies.map(([, p]) => p.Properties.PolicyDocument));
    expect(doc).toContain('parameter/nina-pm/dsql-endpoint');
    expect(doc).not.toMatch(/oauth|client-secret|bootstrap-super-users|origin-verify/);
    expect(doc).not.toContain('s3:');
  });

  it('nennt die drei IAM-Zuordnungen für Migration 0000 (iam.md §1)', () => {
    expect(JSON.parse(env(config.lambdas.migrate.functionName).MIGRATE_IAM_GRANTS ?? '[]')).toEqual(
      [
        { role: 'app_rw', arn: `arn:aws:iam::${config.account}:role/NinaPmApi` },
        { role: 'app_rw', arn: `arn:aws:iam::${config.account}:role/NinaPmOpsCli` },
        { role: 'app_job', arn: `arn:aws:iam::${config.account}:role/NinaPmWorker` },
      ],
    );
  });

  it('läuft als CDK-Trigger bei jeder Änderung des Handlers', () => {
    expect(resources(t.migrate, 'Custom::Trigger')).toHaveLength(1);
  });

  it('Api und Jobs hängen am Stack Migrate (CC-7)', () => {
    expect(t.stacks.api.dependencies.map((d) => d.stackName)).toContain('NinaPm-Migrate');
    expect(t.stacks.jobs.dependencies.map((d) => d.stackName)).toContain('NinaPm-Migrate');
  });
});

describe('DSQL_DB_ROLE je Lambda (SEC-4)', () => {
  it.each([
    [config.lambdas.api.functionName, 'app_rw'],
    [config.lambdas.opsCli.functionName, 'app_rw'],
    [config.lambdas.worker.functionName, 'app_job'],
  ])('%s verbindet als %s', (name, role) => {
    expect(env(name).DSQL_DB_ROLE).toBe(role);
  });

  it('migrate setzt keine DB-Rolle (verbindet als admin)', () => {
    expect(env(config.lambdas.migrate.functionName).DSQL_DB_ROLE).toBeUndefined();
  });
});
