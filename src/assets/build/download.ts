import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export async function fetchURL(url: string, dest: string, opts?: { force?: boolean }): Promise<void> {
  if (!opts?.force && existsSync(dest)) return;

  mkdirSync(dirname(dest), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url}: ${response.status} ${response.statusText}`);

  const buffer = await response.arrayBuffer();
  writeFileSync(dest, new Uint8Array(buffer));
}
