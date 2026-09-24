import { getParameter } from '@aws-lambda-powertools/parameters/ssm';

/** SSM-Werte mit TTL-Cache 5 min (TK 4.2, DAT-5): warme Container sehen neue Werte spätestens nach 5 min. */
export const SSM_MAX_AGE_SECONDS = 300;

export function ssmString(name: string): () => Promise<string> {
  return async () => {
    const value = await getParameter(name, { maxAge: SSM_MAX_AGE_SECONDS, decrypt: false });
    if (!value) throw new Error(`SSM-Parameter ${name} ist leer`);
    return value;
  };
}

/** SecureString (Standardschlüssel `alias/aws/ssm`, SV-13) – Wert nie loggen. */
export function ssmSecret(name: string): () => Promise<string> {
  return async () => {
    const value = await getParameter(name, { maxAge: SSM_MAX_AGE_SECONDS, decrypt: true });
    if (!value) throw new Error(`SSM-Parameter ${name} ist leer`);
    return value;
  };
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return value;
}
