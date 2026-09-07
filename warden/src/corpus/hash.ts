/** FNV-1a over the bytes of `text`, as eight hex digits.
 *
 *  A content hash is the third and most expensive freshness tier, reached only for a file whose
 *  size and mtime already disagree with the index — so it runs on a handful of files, never the
 *  corpus. FNV-1a rather than a cryptographic digest: nothing here defends against an adversary,
 *  and this needs no dependency and no async. @public */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    const high = text.charCodeAt(i) >>> 8;
    if (high !== 0) {
      hash ^= high;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}
