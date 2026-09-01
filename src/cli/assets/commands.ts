import { buildCSS } from "../../assets/build/css";
import { buildFonts } from "../../assets/build/fonts";
import { buildIcons } from "../../assets/build/icons";
import { buildJS } from "../../assets/build/js";
import { buildAll, generateAssetsTypes } from "../../assets/build/pipeline";
import { buildRasters } from "../../assets/build/rasters";
import { buildSprites } from "../../assets/build/sprites";
import { loadConfig } from "../../assets/config";
import { resolveAppRoot } from "../core/app-root";
import { addCommand, createCommand } from "../core/command";
import type { CommandBase } from "../core/types";

const CONFIG_FLAG = { type: "string", description: "Path to assets.config.ts" } as const;
const ROOT_FLAG = { type: "string", description: "Application root (default: derived from forge's install path)" } as const;

function statedRoot(flag: string | undefined): string | undefined {
  return flag || process.env.FORGE_APP_ROOT || undefined;
}

async function loadAssetsConfig(flags: { config: string | undefined; root: string | undefined }) {
  return loadConfig({
    root: resolveAppRoot(statedRoot(flags.root)),
    ...(flags.config !== undefined ? { configPath: flags.config } : {}),
    env: process.env,
  });
}

/** Builds the `forge assets` CLI command tree. @public */
export function createAssetsCommands(): CommandBase {
  const root = createCommand({ name: "assets", description: "Asset pipeline for @y-core/forge consumer projects" });

  const buildAllFlags = {
    minify: { type: "boolean", description: "Minify CSS and JS output; also enables content-hashed filenames" },
    config: CONFIG_FLAG,
    root: ROOT_FLAG,
    out: { type: "string", description: "Output path for the generated assets module (default: .forge/assets.ts)" },
  } as const;

  const runBuildAll = async (
    _args: string[],
    flags: { minify: boolean | undefined; config: string | undefined; root: string | undefined; out: string | undefined },
  ) => {
    const config = await loadAssetsConfig(flags);
    await buildAll(config, {
      ...(flags.minify !== undefined ? { minify: flags.minify } : {}),
      ...(flags.out !== undefined ? { assetsPath: flags.out } : {}),
    });
  };

  // The bare `assets build` is `assets build all`, from the same flags and the same runner. Unlike
  // a scope default, this one defaults to the *union*, so it cannot silently do less than asked.
  const buildCmd = createCommand({
    name: "build",
    description: "Build assets. Defaults to every step; name one to build it alone",
    flags: buildAllFlags,
    run: runBuildAll,
  });

  addCommand(
    buildCmd,
    createCommand({ name: "all", description: "Build all assets and generate the typed assets module", flags: buildAllFlags, run: runBuildAll }),
  );

  addCommand(
    buildCmd,
    createCommand({
      name: "css",
      description: "Build CSS only",
      flags: { minify: { type: "boolean", description: "Minify output" }, config: CONFIG_FLAG, root: ROOT_FLAG },
      run: async (_args, flags) => {
        const config = await loadAssetsConfig(flags);
        for (const css of config.css) {
          buildCSS(css, { outDir: config.paths.publicDir, minify: flags.minify });
        }
      },
    }),
  );

  addCommand(
    buildCmd,
    createCommand({
      name: "js",
      description: "Build JavaScript bundles only",
      flags: { minify: { type: "boolean", description: "Minify output" }, config: CONFIG_FLAG, root: ROOT_FLAG },
      run: async (_args, flags) => {
        const config = await loadAssetsConfig(flags);
        await buildJS(config.js.bundles, { outDir: config.paths.publicDir, minify: flags.minify });
      },
    }),
  );

  addCommand(
    buildCmd,
    createCommand({
      name: "fonts",
      description: "Download fonts",
      flags: { config: CONFIG_FLAG, root: ROOT_FLAG },
      run: async (_args, flags) => {
        const config = await loadAssetsConfig(flags);
        await buildFonts(config.fonts, config.paths.publicDir);
      },
    }),
  );

  addCommand(
    buildCmd,
    createCommand({
      name: "icons",
      description: "Build icon outputs (SVG, PNG, ICO, web app manifest)",
      flags: { config: CONFIG_FLAG, root: ROOT_FLAG },
      run: async (_args, flags) => {
        const config = await loadAssetsConfig(flags);
        if (config.icons) await buildIcons(config.icons);
      },
    }),
  );

  addCommand(
    buildCmd,
    createCommand({
      name: "rasters",
      description: "Rasterize configured SVGs to PNG",
      flags: { config: CONFIG_FLAG, root: ROOT_FLAG },
      run: async (_args, flags) => {
        const config = await loadAssetsConfig(flags);
        await buildRasters(config.rasters, config.paths.publicDir);
      },
    }),
  );

  addCommand(root, buildCmd);

  addCommand(
    root,
    createCommand({
      name: "sprites",
      description: "Build SVG sprite sheets",
      flags: { minify: { type: "boolean", description: "Enable content-hashed filenames" }, config: CONFIG_FLAG, root: ROOT_FLAG },
      run: async (_args, flags) => {
        const config = await loadAssetsConfig(flags);
        await buildSprites(config.sprites, config.paths.publicDir, { hash: flags.minify });
      },
    }),
  );

  const genCmd = createCommand({ name: "gen", description: "Generate a typed module from the assets config" });

  addCommand(
    genCmd,
    createCommand({
      name: "types",
      description: "Generate the typed assets module from config alone — no CSS, JS, sprite or icon build",
      flags: {
        config: CONFIG_FLAG,
        root: ROOT_FLAG,
        out: { type: "string", description: "Output path for the generated assets module (default: .forge/assets.ts)" },
      },
      run: async (_args, flags) => {
        const config = await loadAssetsConfig(flags);
        await generateAssetsTypes(config, flags.out !== undefined ? { assetsPath: flags.out } : {});
      },
    }),
  );

  addCommand(root, genCmd);

  return root;
}
