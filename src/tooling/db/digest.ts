import { createHash } from "node:crypto";

/** SHA-256 of `input` as lowercase hex. @internal */
export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}
