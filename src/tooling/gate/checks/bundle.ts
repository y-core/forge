import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { checkResult, fail } from "../finding";
import type { CheckResult, Finding } from "../types";
import { moduleImports } from "./packaging";
import { collectFiles } from "./source-scan";
import type { BundleCheckConfig, ExportsMap, NodeBundle, NodeExportsCheckConfig, NodeManifest } from "./types";

/** Whether `esbuild` can be resolved — a bundle cannot be rebuilt without it, and it is an optional peer. @public */
export function hasEsbuild(): boolean {
  try {
    import.meta.resolve("esbuild");
    return true;
  } catch {
    return false;
  }
}

/** Bundles an entry into the single self-contained ES module node loads. @public */
export async function bundleSource(config: BundleCheckConfig): Promise<string> {
  const esbuild = (await import("esbuild")) as typeof import("esbuild");
  const result = await esbuild.build({
    entryPoints: [resolve(config.root, config.entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    write: false,
    // Node refuses to strip types under `node_modules`, so a consumer can only load a plain `.mjs`.
    // The banner is what tells a reader of that file not to edit it.
    banner: { js: `// Generated from ${config.entry} by \`${config.fixer}\` — do not edit.` },
  });
  return result.outputFiles[0]?.text ?? "";
}

/** Rebuilds a bundle and reports any drift from the committed copy. @public */
export async function checkBundle(config: BundleCheckConfig): Promise<CheckResult> {
  const expected = await bundleSource(config);
  const path = resolve(config.root, config.bundle);

  let actual: string;
  try {
    actual = readFileSync(path, "utf-8");
  } catch {
    return checkResult([fail("the committed bundle is missing", { file: config.bundle, detail: [`run \`${config.fixer}\``] })], "");
  }

  if (actual === expected) return checkResult([], `${config.bundle} matches a fresh bundle of ${config.entry}`);

  return checkResult(
    [
      fail("the committed bundle no longer matches its source", {
        file: config.bundle,
        detail: [
          `\`${config.entry}\` now bundles to something else — a source edit, an \`esbuild\` release, or a hand edit to the generated file`,
          `run \`${config.fixer}\` and review the diff before committing it`,
        ],
      }),
    ],
    "",
  );
}

/** Writes a fresh bundle over the committed one. @public */
export async function writeBundle(config: BundleCheckConfig): Promise<void> {
  writeFileSync(resolve(config.root, config.bundle), await bundleSource(config), "utf-8");
}

function importTarget(target: ExportsMap[string]): string | undefined {
  return typeof target === "string" ? target : target.import;
}

/** The `types` source and `import` bundle of an export shaped as Node needs it, or `undefined` for any other shape. */
function bundlePair(target: ExportsMap[string] | undefined): { entry: string; bundle: string } | undefined {
  if (target === undefined || typeof target === "string") return undefined;
  const { types, import: bundle } = target;
  if (types?.endsWith(".ts") !== true || bundle?.endsWith(".mjs") !== true) return undefined;
  return { entry: types.replace(/^\.\//, ""), bundle: bundle.replace(/^\.\//, "") };
}

/** Every file the entry reaches through relative imports, itself included. */
function importClosure(root: string, entry: string, present: ReadonlySet<string>): string[] {
  const seen = new Set([entry]);
  const queue = [entry];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const next of moduleImports(root, file, present)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return [...seen].sort();
}

/** The bundle rows a manifest's `forge.node` declaration implies, each watching the module graph it is built from. @public */
export function nodeBundles(root: string, manifest: NodeManifest): NodeBundle[] {
  const present = new Map<string, ReadonlySet<string>>();
  const sources = (entry: string): ReadonlySet<string> => {
    const dir = entry.slice(0, entry.indexOf("/"));
    const cached = present.get(dir) ?? new Set(collectFiles(root, dir, (name) => name.endsWith(".ts") || name.endsWith(".tsx")));
    present.set(dir, cached);
    return cached;
  };
  return (manifest.forge?.node ?? []).flatMap((subpath) => {
    const pair = bundlePair(manifest.exports[subpath]);
    if (pair === undefined) return [];
    return [
      {
        label: `validate-${subpath.replace(/^\.\//, "").replaceAll("/", "-")}-bundle`,
        ...pair,
        watches: [...importClosure(root, pair.entry, sources(pair.entry)), pair.bundle],
      },
    ];
  });
}

/** The finding for one `forge.node` subpath, or none when its export already points `import` at a bundle. */
function nodeExportFinding(subpath: string, target: ExportsMap[string] | undefined, fixer: string): Finding[] {
  if (target === undefined)
    return [
      fail(`\`${subpath}\` is listed under \`forge.node\` but is not an export`, {
        file: "package.json",
        detail: [`add the export, or drop \`${subpath}\` from \`forge.node\``],
      }),
    ];
  if (bundlePair(target) !== undefined) return [];
  if (importTarget(target)?.endsWith(".mjs") === true)
    return [
      fail(`\`${subpath}\` points \`import\` at a \`.mjs\` but has no \`.ts\` \`types\` condition to build it from`, {
        file: "package.json",
        detail: [`add \`"types": "<entry>.ts"\` beside its \`import\`, then run \`${fixer}\``],
      }),
    ];
  return [
    fail(`\`${subpath}\` is imported by Node but its export does not point \`import\` at a generated \`.mjs\``, {
      file: "package.json",
      detail: [
        "Node refuses to strip types under `node_modules`, so a consumer cannot load a `.ts` target",
        `give it \`{ "types": "<entry>.ts", "import": "<entry>.mjs" }\`, then run \`${fixer}\``,
      ],
    }),
  ];
}

/** Checks every `forge.node` export points `import` at a generated `.mjs`, and every `.mjs` export is listed there. @public */
export function checkNodeExports(config: NodeExportsCheckConfig): CheckResult {
  const listed = config.node.flatMap((subpath) => nodeExportFinding(subpath, config.exports[subpath], config.fixer));
  const unlisted = Object.entries(config.exports)
    .filter(([subpath, target]) => importTarget(target)?.endsWith(".mjs") === true && !config.node.includes(subpath))
    .map(([subpath]) =>
      fail(`\`${subpath}\` exports a \`.mjs\` bundle but is not listed under \`forge.node\``, {
        file: "package.json",
        detail: [`add \`${subpath}\` to \`forge.node\` so \`${config.fixer}\` regenerates it and the gate checks it`],
      }),
    );
  return checkResult([...listed, ...unlisted], "every `forge.node` export points `import` at a generated `.mjs`");
}
