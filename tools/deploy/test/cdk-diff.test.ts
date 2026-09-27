import { describe, expect, it } from 'vitest';
import { deployConcurrencyArgs, hasSecurityChanges } from '../src/cdk-diff';

const PLAIN = `Stack NinaPm-Api
Resources
[~] AWS::Lambda::Function Api/Fn ApiFn1234
 └─ [~] Code
`;
// Ausschnitt aus `cdk diff` von #106 (neues Recht des worker auf catalog/sky/*).
const IAM = `Stack NinaPm-Jobs
IAM Statement Changes
┌───┬──────────────────────────────┬────────┬──────────────┬────────────────────┐
│   │ Resource                     │ Effect │ Action       │ Principal          │
├───┼──────────────────────────────┼────────┼──────────────┼────────────────────┤
│ + │ \${WebBucket.Arn}/catalog/sky/* │ Allow  │ s3:PutObject │ AWS:\${WorkerRole} │
└───┴──────────────────────────────┴────────┴──────────────┴────────────────────┘
`;

describe('cdk diff → Parallelität des Deploys', () => {
  it('ohne Sicherheitsänderungen parallel (4)', () => {
    expect(hasSecurityChanges(PLAIN)).toBe(false);
    expect(deployConcurrencyArgs(PLAIN)).toEqual(['--concurrency', '4']);
  });
  it('mit IAM-Änderungen nacheinander, damit CDK nachfragen kann', () => {
    expect(hasSecurityChanges(IAM)).toBe(true);
    expect(deployConcurrencyArgs(IAM)).toEqual([]);
    expect(hasSecurityChanges('Security Group Changes\n…')).toBe(true);
  });
});
