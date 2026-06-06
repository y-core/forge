import type { FontDownload } from "../types";
import { fetchURL } from "./download";
import { safeJoin } from "./paths";

export async function buildFonts(fonts: { downloads: FontDownload[] }, publicDir: string): Promise<void> {
  for (const download of fonts.downloads) {
    const dest = safeJoin(publicDir, download.to);
    await fetchURL(download.url, dest);
  }
}
