import { fileURLToPath } from "node:url";

import { CliError } from "../cli/errors";

function absent(pkg: string, configKey: string, demand: string, cause: unknown): CliError {
  return new CliError(
    "external",
    `[forge-assets] ${configKey} asks for ${demand}, which needs the optional peer "${pkg}". Install it: bun add -d ${pkg}`,
    { cause },
  );
}

/** Loads an optional peer, failing with the config that demanded it and the command that installs it. @internal */
export async function peer<T>(pkg: string, configKey: string, demand: string): Promise<T> {
  try {
    // A dynamic import is what keeps the peer optional — a config asking for none loads none.
    return (await import(pkg)) as T;
  } catch (cause) {
    throw absent(pkg, configKey, demand, cause);
  }
}

// Resolution runs from this module rather than the working directory, so the file is found wherever
// the installer put the peer — a nested `node_modules`, a workspace root, or a linked checkout.
/** Locates a file an optional peer ships, failing the same way a missing peer import does. @internal */
export function peerFile(pkg: string, subpath: string, configKey: string, demand: string): string {
  try {
    return fileURLToPath(import.meta.resolve(`${pkg}/${subpath}`));
  } catch (cause) {
    throw absent(pkg, configKey, demand, cause);
  }
}

/** Loads the optional `sharp` peer, naming the config that demanded it when it is not installed. @internal */
export async function rasterizer(configKey: string): Promise<typeof import("sharp").default> {
  const mod = await peer<{ default: typeof import("sharp").default }>("sharp", configKey, "a rasterized PNG");
  return mod.default;
}

/** Loads the optional `esbuild` peer, naming the config that demanded it when it is not installed. @internal */
export async function bundler(configKey: string): Promise<typeof import("esbuild")> {
  return peer<typeof import("esbuild")>("esbuild", configKey, "a JavaScript bundle");
}

/** Loads the optional `harfbuzzjs` peer, naming the config that demanded it when it is not installed. @internal */
export async function shaper(configKey: string): Promise<typeof import("harfbuzzjs")> {
  return peer<typeof import("harfbuzzjs")>("harfbuzzjs", configKey, "a subset font");
}

/** Locates the subsetter module `harfbuzzjs` ships, which is a `.wasm` file rather than an import. @internal */
export function subsetWasm(configKey: string): string {
  return peerFile("harfbuzzjs", "dist/harfbuzz-subset.wasm", configKey, "a subset font");
}
