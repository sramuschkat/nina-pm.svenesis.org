/** `If-None-Match` mit schwachem Vergleich (RFC 9110 §13.1.2; CloudFront macht komprimierte ETags schwach). */
import { describe, expect, it } from 'vitest';
import { ifNoneMatchHits } from '../src/lib/etag';

describe('ifNoneMatchHits', () => {
  const etag = '"t-0123456789abcdef"';
  it('stark, schwach, Liste und * treffen; fremd, leer und fehlend nicht', () => {
    expect(ifNoneMatchHits(etag, etag)).toBe(true);
    expect(ifNoneMatchHits(`W/${etag}`, etag)).toBe(true);
    expect(ifNoneMatchHits(etag, `W/${etag}`)).toBe(true);
    expect(ifNoneMatchHits(`"x", W/${etag}`, etag)).toBe(true);
    expect(ifNoneMatchHits(' * ', etag)).toBe(true);
    expect(ifNoneMatchHits('"t-other"', etag)).toBe(false);
    expect(ifNoneMatchHits('', etag)).toBe(false);
    expect(ifNoneMatchHits(undefined, etag)).toBe(false);
  });
});
