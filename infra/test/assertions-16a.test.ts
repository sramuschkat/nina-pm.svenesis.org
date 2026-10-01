import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NINA_SEQUENCES_DIR, ninaPluginVersion } from '../lib/nina-sequences';
import { resources, synth } from './synth';

// AP-16a: Beispielsequenzen per zweitem BucketDeployment (TK 4.1/12, FA-NIN-25).
const t = synth();
const deployments = resources(t.edge, 'Custom::CDKBucketDeployment');
const byId = (id: string) =>
  deployments.find(([logicalId]) => logicalId.startsWith(id))?.[1].Properties;

describe('NinaPm-Edge: Beispielsequenzen', () => {
  it('Plugin-Version aus NinaPm.Nina.csproj', () => {
    expect(ninaPluginVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('zweites BucketDeployment schreibt nur unter downloads/nina-sequences/<Version>/ und mit prune: false', () => {
    const p = byId('NinaSequences');
    expect(p).toBeDefined();
    expect(p?.DestinationBucketKeyPrefix).toBe(`downloads/nina-sequences/${ninaPluginVersion()}/`);
    expect(p?.Prune).toBe(false);
    expect(p?.SystemMetadata).toEqual({ 'cache-control': 'public, max-age=3600' });
  });

  it('kein BucketDeployment im Stack löscht etwas, nur die Sequenzen schreiben unter downloads/', () => {
    expect(deployments.map(([id]) => id.replace(/[A-F0-9]{8}$/, '')).sort()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^NinaSequences/),
        expect.stringMatching(/^SpaAssets/),
      ]),
    );
    for (const [id, d] of deployments) {
      expect(d.Properties.Prune, id).toBe(false);
      if (!id.startsWith('NinaSequences'))
        expect(d.Properties.DestinationBucketKeyPrefix, id).toBeUndefined();
    }
  });

  it('Quellordner liegt im Repository und liefert nur *.json aus', () => {
    expect(readdirSync(NINA_SEQUENCES_DIR)).toContain('README.md');
  });
});
