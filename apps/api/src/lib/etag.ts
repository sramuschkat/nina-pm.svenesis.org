/**
 * `If-None-Match` nach RFC 9110 §13.1.2: **schwacher** Vergleich (ein `W/`-Präfix zählt nicht), Liste
 * durch Kommas, `*` passt immer. Nötig, weil CloudFront beim Komprimieren (`compress: true` auf `/api/*`)
 * aus einem starken ETag `"t-…"` einen schwachen `W/"t-…"` macht und das Plugin diesen zurückschickt.
 */
export function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, '');
  const wanted = opaque(etag);
  return header.split(',').some((tag) => tag.trim() === '*' || opaque(tag) === wanted);
}
