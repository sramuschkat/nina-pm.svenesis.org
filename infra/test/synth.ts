import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { buildApp } from '../lib/app';

const readJson = (name: string) =>
  JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;

/** Synthese mit den eingecheckten Feature-Flags und Lookup-Werten, ohne AWS-Zugang (TK 18). */
export function synth(extraContext: Record<string, unknown> = {}) {
  const cdkJson = readJson('cdk.json') as { context: Record<string, unknown> };
  const app = new App({
    // Ohne Bündeln der Lambdas (schneller); das echte Bündeln prüft `pnpm cdk synth` im CI.
    context: {
      ...cdkJson.context,
      ...readJson('cdk.context.json'),
      'aws:cdk:bundling-stacks': [],
      ...extraContext,
    },
  });
  const stacks = buildApp(app);
  return {
    stacks,
    data: Template.fromStack(stacks.data),
    config: Template.fromStack(stacks.config),
    cert: Template.fromStack(stacks.cert),
    web: Template.fromStack(stacks.web),
    edge: Template.fromStack(stacks.edge),
    migrate: Template.fromStack(stacks.migrate),
    jobs: Template.fromStack(stacks.jobs),
    api: Template.fromStack(stacks.api),
    ops: Template.fromStack(stacks.ops),
  };
}

export interface Resource {
  Type: string;
  Properties: Record<string, unknown>;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
}

export function resources(template: Template, type: string): [string, Resource][] {
  return Object.entries(template.findResources(type)) as [string, Resource][];
}
