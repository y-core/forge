import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { RasterEntry } from "../types";
import { safeJoin } from "./paths";

/** Rasterizes each configured SVG to PNG under `publicDir`, deriving the unset dimension from the source ratio. @public */
export async function buildRasters(rasters: RasterEntry[], publicDir: string): Promise<void> {
  if (rasters.length === 0) return;
  // Dynamic import keeps sharp optional — configs without rasters never load it
  const { default: sharp } = await import("sharp");
  for (const entry of rasters) {
    const dest = safeJoin(publicDir, entry.to);
    mkdirSync(dirname(dest), { recursive: true });
    const resize = {
      ...(entry.width !== undefined ? { width: entry.width } : {}),
      ...(entry.height !== undefined ? { height: entry.height } : {}),
    };
    await sharp(readFileSync(entry.from), { density: 300 }).resize(resize).png().toFile(dest);
    console.log(`✓ raster: ${entry.to}`);
  }
}
