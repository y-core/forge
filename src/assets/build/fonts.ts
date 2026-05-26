import { join } from "node:path";
import type { FontDownload } from "../types";
import { fetchURL } from "./download";

export async function buildFonts(fonts: { downloads: FontDownload[] }, publicDir: string): Promise<void> {
  for (const download of fonts.downloads) {
    const dest = join(publicDir, download.to);
    await fetchURL(download.url, dest);
  }
}
