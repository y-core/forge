import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Returns the first 8 hex characters of the file's SHA-256 digest. @public */
export function hashFile(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex").slice(0, 8);
}

/** Returns the first 8 hex characters of the string's SHA-256 digest. @public */
export function hashString(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}
