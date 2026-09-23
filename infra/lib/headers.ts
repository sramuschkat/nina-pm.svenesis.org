/** Wortlaut der beiden Response-Headers-Policies (specs/infra/iam.md §10, SV-16). */
import { config } from '../config';

const dataBucketOrigin = `https://${config.buckets.data}.s3.${config.region}.amazonaws.com`;
const cds = 'https://alasky.cds.unistra.fr';

/** CSP der Anwendung (`npm-html`, nur Default-Behavior). */
export const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${cds} https://cdn.discordapp.com ${dataBucketOrigin}`,
  `connect-src 'self' ${cds} ${dataBucketOrigin}`,
  "worker-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

/** Harte CSP für `/api/*`, `/catalog/*` und `/downloads/*` (`npm-api-static`). */
export const API_STATIC_CSP =
  "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'";

export const HSTS_MAX_AGE_SECONDS = 63072000;
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
