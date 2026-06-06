import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IconOutput, IconsConfig } from "../types";

export async function buildIcons(config: IconsConfig): Promise<void> {
  // Dynamic import keeps sharp optional — callers without icons skip it entirely
  const { default: sharp } = await import("sharp");
  const src = readFileSync(config.src, "utf-8");
  mkdirSync(config.outDir, { recursive: true });

  const darkRule = config.darkColor ? `@media(prefers-color-scheme:dark){path{fill:${config.darkColor}}}` : "";
  const faviconSvg = src.replace("<path", `<style>path{fill:${config.lightColor}}${darkRule}</style><path`);

  // sharp doesn't resolve currentColor — replace with the explicit light fill
  const rasterSvg = new TextEncoder().encode(src.replace("currentColor", config.lightColor));

  const sizes = [...new Set(config.outputs.flatMap((o) => (o.kind === "png" ? [o.size] : o.kind === "ico" ? o.sizes : [])))];
  const rasters = new Map(
    await Promise.all(sizes.map(async (s) => [s, await sharp(rasterSvg, { density: 300 }).resize(s, s).png().toBuffer()] as const)),
  );
  const getPixels = (size: number): Uint8Array => {
    const buf = rasters.get(size);
    if (!buf) throw new Error(`no raster for size ${size}`);
    return buf;
  };

  // Collect png entries opted-in to the web app manifest
  const manifestPngs = config.outputs.filter((o): o is Extract<IconOutput, { kind: "png" }> => o.kind === "png" && !!o.manifest);

  for (const o of config.outputs) {
    const dest = `${config.outDir}/${o.file}`;
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

function renderManifest(config: IconsConfig, pngs: Array<{ file: string; size: number }>): string {
  return JSON.stringify(
    {
      name: config.app?.name ?? "",
      short_name: config.app?.shortName ?? "",
      theme_color: config.lightColor,
      background_color: config.app?.backgroundColor ?? "",
      display: "standalone",
      icons: pngs.map(({ file, size }) => ({ src: `/${file}`, sizes: `${size}x${size}`, type: "image/png" })),
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

  // ICONDIR
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type = 1 (ICO)
  view.setUint16(4, count, true); // count

  // ICONDIRENTRY × count
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

  // PNG payloads
  for (const png of pngs) {
    out.set(png, pos);
    pos += png.length;
  }

  return out;
}
