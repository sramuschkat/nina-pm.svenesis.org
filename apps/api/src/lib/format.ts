/** Zeiten als ISO-8601 UTC mit `Z`, ganze Sekunden (rules/api.md). */
export function isoUtc(d: Date | string): string {
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function isoUtcOrNull(d: Date | string | null | undefined): string | null {
  return d === null || d === undefined ? null : isoUtc(d);
}

/** Einladungslink: Token im Fragment, damit es keine Zugriffslogs erreicht (DAT-20). */
export function invitationLink(origin: string, token: string): string {
  return `${origin}/einladung#${token}`;
}
