/**
 * Auswertung von `cdk diff` für `pnpm deploy:prod`: Enthält der Diff sicherheitsrelevante Änderungen (IAM,
 * Sicherheitsgruppen), will CDK sie beim Deploy einzeln bestätigen lassen – das geht nur ohne Parallelität
 * (sonst Abbruch „Stack includes security-sensitive updates, but concurrency is greater than 1“, Deploy
 * 27.09.2026). Die Nachfrage von CDK bleibt so erhalten.
 */
const SECURITY_HEADINGS = [
  'IAM Statement Changes',
  'IAM Policy Changes',
  'Security Group Changes',
  'Resource-based Policy Changes',
];

export function hasSecurityChanges(diffOutput: string): boolean {
  return SECURITY_HEADINGS.some((h) => diffOutput.includes(h));
}

/** Parallelität für `cdk deploy --all`: 4 ohne, keine (1) mit sicherheitsrelevanten Änderungen. */
export function deployConcurrencyArgs(diffOutput: string): string[] {
  return hasSecurityChanges(diffOutput) ? [] : ['--concurrency', '4'];
}
