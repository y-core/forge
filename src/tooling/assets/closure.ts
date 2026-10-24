import { isAbsolute, relative, resolve, sep } from "node:path";

const ENTRY = "forge-import-closure-entry.ts";

const WRANGLER_MODULE_RULES = { ".txt": "text", ".html": "text", ".sql": "text", ".bin": "binary", ".wasm": "binary" } as const;

function relativeTo(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

/** Every file under `root` that `specifiers`, resolved from `from` as esbuild bundles them, statically import, relative to `root`; rejects when any one does not resolve. @public */
export async function importClosure(root: string, specifiers: readonly string[], from: string = root): Promise<string[]> {
  if (specifiers.length === 0) return [];
  const { build } = await import("esbuild");
  const contents = specifiers
    .map((specifier, i) => `import * as m${i} from ${JSON.stringify(specifier)};\nglobalThis["m${i}"] = m${i};`)
    .join("\n");
  const result = await build({
    stdin: { contents, resolveDir: resolve(root, from), loader: "ts", sourcefile: ENTRY },
    absWorkingDir: resolve(root),
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["node:*", "cloudflare:*", "bun:*", "bun"],
    loader: WRANGLER_MODULE_RULES,
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const entry = relativeTo(root, resolve(root, from, ENTRY));
  return Object.keys(result.metafile.inputs)
    .map((path) => relativeTo(root, resolve(root, path)))
    .filter((path) => path !== entry && !path.startsWith("node_modules/") && !path.includes("/node_modules/"))
    .filter((path) => !path.startsWith("../") && !isAbsolute(path))
    .sort();
}
