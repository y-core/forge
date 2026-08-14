import { resolveAppRoot } from "../../cli/app-root";
import { addCommand, createCommand } from "../../cli/command";
import type { CommandBase } from "../../cli/types";
import { buildCSS } from "../build/css";
import { buildFonts } from "../build/fonts";
import { buildIcons } from "../build/icons";
import { buildJS } from "../build/js";
import { buildAll, generateAssetsTypes } from "../build/pipeline";
import { buildSprites } from "../build/sprites";
import { loadConfig } from "../config";

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

/** Builds the `forge-assets` CLI command tree. @internal */
export function createAssetsCommands(): CommandBase {
  const root = createCommand({ name: "forge-assets", description: "Asset pipeline for @y-core/forge consumer projects" });

  const buildCmd = createCommand({ name: "build", description: "Build asset types" });

  addCommand(
    buildCmd,
    createCommand({
      name: "all",
      description: "Build all assets and generate the typed assets module",
      flags: {
        minify: { type: "boolean", description: "Minify CSS and JS output; also enables content-hashed filenames" },
        config: CONFIG_FLAG,
        root: ROOT_FLAG,
        out: { type: "string", description: "Output path for the generated assets module (default: .forge/assets.ts)" },
      },
      run: async (_args, flags) => {
        const config = await loadAssetsConfig(flags);
        await buildAll(config, { minify: flags.minify, ...(flags.out !== undefined ? { assetsPath: flags.out } : {}) });
      },
    }),
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

  addCommand(
    root,
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

  return root;
}
