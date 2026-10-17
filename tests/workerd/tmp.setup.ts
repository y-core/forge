import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Gives the run's workers one TMPDIR and removes it once they have all exited, taking miniflare's fire-and-forget scratch with it. */
export default function setupWorkerdTmp(): () => void {
  const dir = mkdtempSync(join(tmpdir(), "forge-workerd-"));
  process.env.TMPDIR = dir;
  return () => rmSync(dir, { recursive: true, force: true });
}
