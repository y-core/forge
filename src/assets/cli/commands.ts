import { addCommand, createCommand } from "../../cli/mod";
import type { CommandBase } from "../../cli/types";
import { buildAll, buildCSS, buildFonts, buildJS, buildSprites, generateManifest } from "../build/mod";
import { loadConfig } from "../config";

export function createAssetsCommands(): CommandBase {
  const root = createCommand({
    name: "forge-assets",
    description: "Asset pipeline for @y-core/forge consumer projects",
  });

  const buildCmd = createCommand({
    name: "build",
    description: "Build asset types",
  });

  addCommand(
    buildCmd,
    createCommand({
      name: "all",
      description: "Build all assets and generate the manifest",
      flags: {
        minify: { type: "boolean", description: "Minify CSS and JS output" },
        config: { type: "string", description: "Path to assets.config.ts" },
        out: { type: "string", description: "Manifest output path" },
      },
      run: async (_args, flags) => {
        const config = await loadConfig(flags.config);
        await buildAll(config, { minify: flags.minify, manifestPath: flags.out });
      },
    }),
  );

  addCommand(
    buildCmd,
    createCommand({
      name: "css",
      description: "Build CSS only",
      flags: {
        minify: { type: "boolean", description: "Minify output" },
        config: { type: "string", description: "Path to assets.config.ts" },
      },
      run: async (_args, flags) => {
        const config = await loadConfig(flags.config);
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
      flags: {
        minify: { type: "boolean", description: "Minify output" },
        config: { type: "string", description: "Path to assets.config.ts" },
      },
      run: async (_args, flags) => {
        const config = await loadConfig(flags.config);
        for (const bundle of config.js.bundles) {
          await buildJS(bundle, { outDir: config.paths.publicDir, minify: flags.minify });
        }
      },
    }),
  );

  addCommand(
    buildCmd,
    createCommand({
      name: "fonts",
      description: "Download fonts",
      flags: {
        config: { type: "string", description: "Path to assets.config.ts" },
      },
      run: async (_args, flags) => {
        const config = await loadConfig(flags.config);
        await buildFonts(config.fonts, config.paths.publicDir);
      },
    }),
  );

  addCommand(root, buildCmd);

  addCommand(
    root,
    createCommand({
      name: "sprites",
      description: "Build SVG sprite sheets",
      flags: {
        config: { type: "string", description: "Path to assets.config.ts" },
      },
      run: async (_args, flags) => {
        const config = await loadConfig(flags.config);
        await buildSprites(config.sprites, config.paths.publicDir);
      },
    }),
  );

  addCommand(
    root,
    createCommand({
      name: "manifest",
      description: "Generate asset manifest from built files",
      flags: {
        config: { type: "string", description: "Path to assets.config.ts" },
        out: { type: "string", description: "Output path", default: ".assets-manifest.json" },
      },
      run: async (_args, flags) => {
        const config = await loadConfig(flags.config);
        await generateManifest(config.paths.publicDir, flags.out ?? ".assets-manifest.json");
      },
    }),
  );

  return root;
}
