import { dirname, join } from "node:path";

import { sha256 } from "../digest";
import type { DbIo, DeclaredPath } from "../types";
import type { DesiredState } from "./types";

function isDirectory(io: DbIo, path: string): boolean {
  if (path.endsWith(".sql")) return false;
  try {
    io.readDir(path);
    return true;
  } catch {
    return false;
  }
}

/** One declared schema as read from its file, or its directory's `.sql` files in name order; null when the path is absent. @internal */
export function readDesiredState(io: DbIo, source: DeclaredPath): DesiredState | null {
  const { path } = source;
  if (!io.exists(path)) return null;
  if (isDirectory(io, path)) {
    const files = io
      .readDir(path)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => join(path, name));
    const text = files.map((file) => `-- ---- ${file.slice(dirname(path).length + 1)} ----\n\n${io.readText(file)}`).join("\n");
    return { source: source.declared, path, files, text, digest: sha256(text) };
  }
  const text = io.readText(path);
  return { source: source.declared, path, files: [path], text, digest: sha256(text) };
}
