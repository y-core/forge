import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function hashFile(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex").slice(0, 8);
}

export function hashString(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}
