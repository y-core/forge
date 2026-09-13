import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { IconLink } from "../../assets/types";
import type { IconOutput, IconsConfig } from "./types";

function normalisePrefix(prefix: string | undefined): string {
  if (prefix === undefined || prefix === "" || prefix === "/") return "";
  const leading = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return leading.endsWith("/") ? leading.slice(0, -1) : leading;
}

/** Where an icon output is written and the URL path it is served from, given the config's prefix. @public */
export function iconTarget(config: IconsConfig, output: IconOutput): { dir: string; path: string } {
  const prefix = output.root ? "" : normalisePrefix(config.publicPrefix);
  return { dir: `${config.outDir}${prefix}`, path: `${prefix}/${output.file}` };
}

/** The head links a configured icon set needs, so the markup and the files derive from one list. @public */
export function iconLinks(config: IconsConfig): IconLink[] {
  const links: IconLink[] = [];
  for (const output of config.outputs) {
    const { path: href } = iconTarget(config, output);
    switch (output.kind) {
      case "svg":
        links.push({ rel: "icon", href, type: "image/svg+xml" });
        break;
      case "ico":
        links.push({ rel: "icon", href, sizes: output.sizes.map((size) => `${size}x${size}`).join(" ") });
        break;
      // A manifest png is declared by the manifest, so only an explicit `rel` earns a link of its own.
      case "png":
        if (output.rel) links.push({ rel: output.rel, href });
        break;
      case "manifest":
        links.push({ rel: "manifest", href });
        break;
    }
  }
  return links;
}

/** Writes every configured icon output, loading the optional `sharp` dependency on demand. @public */
export async function buildIcons(config: IconsConfig): Promise<void> {
  // Dynamic import keeps sharp optional — callers without icons skip it entirely
  const { default: sharp } = await import("sharp");
  const src = readFileSync(config.src, "utf-8");
  for (const dir of new Set(config.outputs.map((output) => iconTarget(config, output).dir))) {
    mkdirSync(dir, { recursive: true });
  }

  const darkRule = config.darkColor ? `@media(prefers-color-scheme:dark){path{fill:${config.darkColor}}}` : "";
  const faviconSvg = src.replace("<path", `<style>path{fill:${config.lightColor}}${darkRule}</style><path`);

  // sharp doesn't resolve currentColor — replace with the explicit light fill
  const rasterSvg = new TextEncoder().encode(src.replaceAll("currentColor", config.lightColor));

  const sizes = [...new Set(config.outputs.flatMap((o) => (o.kind === "png" ? [o.size] : o.kind === "ico" ? o.sizes : [])))];
  const rasters = new Map(
    await Promise.all(sizes.map(async (s) => [s, await sharp(rasterSvg, { density: 300 }).resize(s, s).png().toBuffer()] as const)),
  );
  const getPixels = (size: number): Uint8Array => {
    const buf = rasters.get(size);
    if (!buf) throw new Error(`no raster for size ${size}`);
    return buf;
  };

  const manifestPngs = config.outputs.filter((o): o is Extract<IconOutput, { kind: "png" }> => o.kind === "png" && !!o.manifest);

  for (const o of config.outputs) {
    const dest = `${iconTarget(config, o).dir}/${o.file}`;
    switch (o.kind) {
      case "svg":
        writeFileSync(dest, faviconSvg);
        break;
      case "png":
        writeFileSync(dest, getPixels(o.size));
        break;
      case "ico":
        writeFileSync(dest, buildIco(o.sizes, o.sizes.map(getPixels)));
        break;
      case "manifest":
        writeFileSync(dest, renderManifest(config, manifestPngs));
        break;
    }
    console.log(`✓ icons: ${o.file}`);
  }
}

function renderManifest(config: IconsConfig, pngs: Array<Extract<IconOutput, { kind: "png" }>>): string {
  return JSON.stringify(
    {
      name: config.app?.name ?? "",
      short_name: config.app?.shortName ?? "",
      theme_color: config.lightColor,
      background_color: config.app?.backgroundColor ?? "",
      display: "standalone",
      // Both default to the manifest's own directory, so a manifest served under a prefix would
      // otherwise launch an installed app into that prefix rather than the site root.
      start_url: "/",
      scope: "/",
      icons: pngs.map((png) => ({ src: iconTarget(config, png).path, sizes: `${png.size}x${png.size}`, type: "image/png" })),
    },
    null,
    2,
  );
}

function buildIco(sizes: number[], pngs: Uint8Array[]): Uint8Array {
  const count = sizes.length;
  const headerSize = 6 + count * 16;
  let cursor = headerSize;
  const offsets = pngs.map((png) => {
    const off = cursor;
    cursor += png.length;
    return off;
  });

  const out = new Uint8Array(cursor);
  const view = new DataView(out.buffer);

  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type = 1 (ICO)
  view.setUint16(4, count, true); // count

  let pos = 6;
  for (let i = 0; i < count; i++) {
    const size = sizes[i] ?? 0;
    const png = pngs[i];
    const offset = offsets[i] ?? 0;
    const sz = size < 256 ? size : 0;
    out[pos] = sz; // width
    out[pos + 1] = sz; // height
    out[pos + 2] = 0; // color count
    out[pos + 3] = 0; // reserved
    view.setUint16(pos + 4, 1, true); // planes
    view.setUint16(pos + 6, 32, true); // bit count
    view.setUint32(pos + 8, png ? png.length : 0, true); // size
    view.setUint32(pos + 12, offset, true); // offset
    pos += 16;
  }

  for (const png of pngs) {
    out.set(png, pos);
    pos += png.length;
  }

  return out;
}
