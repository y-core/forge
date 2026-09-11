import { utf8Encode } from "./bytes";

/** Computes SHA-256 of a string or byte array, returns raw bytes. @internal */
export async function sha256(data: string | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = typeof data === "string" ? utf8Encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
