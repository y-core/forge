import { fileURLToPath } from "node:url";

/** Returns everything before the first `node_modules` segment of a module path, or `undefined` when there is none. @public */
export function findAppRoot(modulePath: string): string | undefined {
  const match = /^(.*?)[\\/]node_modules[\\/]/.exec(modulePath);
  return match?.[1];
}

/** Returns the consuming application's root, or `undefined` when forge is not installed under one. @public */
export function installedAppRoot(): string | undefined {
  return findAppRoot(fileURLToPath(import.meta.url));
}

/** Returns the explicitly stated root, or the app forge is installed into, throwing when neither is available. @public */
export function resolveAppRoot(explicit?: string): string {
  if (explicit !== undefined) return explicit;
  const installed = installedAppRoot();
  if (installed !== undefined) return installed;
  throw new Error(
    "Cannot determine the application root: @y-core/forge is not installed under a node_modules directory. Pass the root explicitly — resolveAppRoot(myRoot).",
  );
}
