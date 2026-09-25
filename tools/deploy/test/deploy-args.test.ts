import { describe, expect, it } from 'vitest';
import { parseDeployArgs } from '../src/deploy-args';

describe('pnpm deploy:prod – Argumente (Import-Modus, restore.md)', () => {
  it('ohne Argumente: normaler Deploy', () => {
    expect(parseDeployArgs([])).toEqual({});
  });

  it('-c dsqlClusterId=<id> übernimmt den wiederhergestellten Cluster', () => {
    expect(parseDeployArgs(['-c', 'dsqlClusterId=yjudhrafalpw4tu4zf5wxard7y'])).toEqual({
      dsqlClusterId: 'yjudhrafalpw4tu4zf5wxard7y',
    });
  });

  it('andere Kontextwerte und freie Argumente sind nicht erlaubt', () => {
    expect(() => parseDeployArgs(['-c', 'buildId=abc'])).toThrow('dsqlClusterId');
    expect(() => parseDeployArgs(['--force'])).toThrow('Unbekanntes Argument');
    expect(() => parseDeployArgs(['-c', 'dsqlClusterId=../x'])).toThrow('dsqlClusterId');
  });
});
