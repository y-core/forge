import { CliError } from "../cli/errors";

/** Loads an optional peer, failing with the config that demanded it and the command that installs it. @internal */
export async function peer<T>(pkg: string, configKey: string, demand: string): Promise<T> {
  try {
    // A dynamic import is what keeps the peer optional — a config asking for none loads none.
    return (await import(pkg)) as T;
  } catch (cause) {
    throw new CliError(
      "external",
      `[forge-assets] ${configKey} asks for ${demand}, which needs the optional peer "${pkg}". Install it: bun add -d ${pkg}`,
      { cause },
    );
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
