/** Coordinate size of the only curve forge verifies ECDSA on, P-256. @internal */
export const ECDSA_P256_COORDINATE_BYTES = 32;

function readInteger(der: Uint8Array<ArrayBuffer>, offset: number, size: number): { value: Uint8Array<ArrayBuffer>; next: number } {
  if (der[offset] !== 0x02) throw new Error("unwrapEcdsaSignature: expected an ASN.1 INTEGER");
  const length = der[offset + 1];
  if (length === undefined || length === 0 || length > 0x7f) throw new Error("unwrapEcdsaSignature: unsupported ASN.1 INTEGER length");
  const end = offset + 2 + length;
  if (end > der.byteLength) throw new Error("unwrapEcdsaSignature: ASN.1 INTEGER runs past the end of the signature");

  let start = offset + 2;
  // DER prefixes a 0x00 whenever the high bit would read as a sign bit, so the padding is
  // meaningful in DER and meaningless in the fixed-width form — it comes off before padding.
  while (start < end - 1 && der[start] === 0x00) start++;
  const value = der.slice(start, end);
  if (value.byteLength > size) throw new Error("unwrapEcdsaSignature: integer is wider than the curve's coordinate");
  return { value, next: end };
}

/** Converts a DER-encoded ECDSA signature to the fixed-width `r‖s` form WebCrypto verifies. @internal */
export function unwrapEcdsaSignature(der: Uint8Array<ArrayBuffer>, size = ECDSA_P256_COORDINATE_BYTES): Uint8Array<ArrayBuffer> {
  if (der[0] !== 0x30) throw new Error("unwrapEcdsaSignature: expected an ASN.1 SEQUENCE");
  const declared = der[1];
  if (declared === undefined || declared > 0x7f) throw new Error("unwrapEcdsaSignature: unsupported ASN.1 SEQUENCE length");
  if (declared + 2 !== der.byteLength) throw new Error("unwrapEcdsaSignature: declared SEQUENCE length does not match the input");

  const r = readInteger(der, 2, size);
  const s = readInteger(der, r.next, size);
  if (s.next !== der.byteLength) throw new Error("unwrapEcdsaSignature: trailing bytes after the second integer");

  // Right-aligned: a left-aligned short integer is silently multiplied by 256 per missing byte,
  // and the verification then fails on a signature that is in fact valid.
  const out = new Uint8Array(size * 2);
  out.set(r.value, size - r.value.byteLength);
  out.set(s.value, size * 2 - s.value.byteLength);
  return out;
}
