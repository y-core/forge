import { addCommand, createCommand } from "../../cli/command";
import type { CommandBase } from "../../cli/types";
import { buildCSS } from "../build/css";
import { buildFonts } from "../build/fonts";
import { buildIcons } from "../build/icons";
import { buildJS } from "../build/js";
import { buildAll } from "../build/pipeline";
import { buildSprites } from "../build/sprites";
import { loadConfig } from "../config";

const CONFIG_FLAG = { type: "string", description: "Path to assets.config.ts" } as const;

async function loadAssetsConfig(flags: { config: string | undefined }) {
  return loadConfig(flags.config, process.env);
}

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
      flags: { minify: { type: "boolean", description: "Minify output" }, config: CONFIG_FLAG },
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
      flags: { minify: { type: "boolean", description: "Minify output" }, config: CONFIG_FLAG },
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
      flags: { config: CONFIG_FLAG },
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
      flags: { config: CONFIG_FLAG },
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
      flags: { minify: { type: "boolean", description: "Enable content-hashed filenames" }, config: CONFIG_FLAG },
      run: async (_args, flags) => {
        const config = await loadAssetsConfig(flags);
        await buildSprites(config.sprites, config.paths.publicDir, { hash: flags.minify });
      },
    }),
  );

  return root;
}
