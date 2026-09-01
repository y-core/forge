import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildRasters } from "./rasters";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 315 95" width="315" height="95"><rect width="315" height="95" fill="#123456"/></svg>`;

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function withTmp(label: string, run: (dirs: { tmpDir: string; publicDir: string; from: string }) => Promise<void>): Promise<void> {
  const tmpDir = join(tmpdir(), `forge-rasters-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const publicDir = join(tmpDir, "public");
  mkdirSync(tmpDir, { recursive: true });
  try {
    const from = join(tmpDir, "logo.svg");
    writeFileSync(from, SVG);
    await run({ tmpDir, publicDir, from });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("buildRasters()", () => {
  it("derives the height from the source ratio when only a width is given", async () => {
    await withTmp("width-only", async ({ publicDir, from }) => {
      await buildRasters([{ from, to: "logo.png", width: 360 }], publicDir);
      expect(pngSize(join(publicDir, "logo.png"))).toEqual({ width: 360, height: 109 });
    });
  });

  it("derives the width from the source ratio when only a height is given", async () => {
    await withTmp("height-only", async ({ publicDir, from }) => {
      await buildRasters([{ from, to: "logo.png", height: 190 }], publicDir);
      expect(pngSize(join(publicDir, "logo.png"))).toEqual({ width: 630, height: 190 });
    });
  });

  it("honours both dimensions verbatim when both are given", async () => {
    await withTmp("both", async ({ publicDir, from }) => {
      await buildRasters([{ from, to: "logo.png", width: 200, height: 200 }], publicDir);
      expect(pngSize(join(publicDir, "logo.png"))).toEqual({ width: 200, height: 200 });
    });
  });

  it("creates missing intermediate destination directories", async () => {
    await withTmp("nested", async ({ publicDir, from }) => {
      await buildRasters([{ from, to: "email/logo@2x.png", width: 315 }], publicDir);
      expect(existsSync(join(publicDir, "email", "logo@2x.png"))).toBe(true);
    });
  });

  it("throws when the destination escapes publicDir (safeJoin guard)", async () => {
    await withTmp("escape", async ({ tmpDir, publicDir, from }) => {
      mkdirSync(publicDir, { recursive: true });
      await expect(buildRasters([{ from, to: "../evil.png", width: 100 }], publicDir)).rejects.toThrow(/escapes the asset root/);
      expect(existsSync(join(tmpDir, "evil.png"))).toBe(false);
    });
  });

  it("writes nothing for an empty raster list", async () => {
    await withTmp("empty", async ({ publicDir }) => {
      await buildRasters([], publicDir);
      expect(existsSync(publicDir)).toBe(false);
    });
  });

  it("rasterizes every entry in the list", async () => {
    await withTmp("multi", async ({ publicDir, from }) => {
      await buildRasters(
        [
          { from, to: "a.png", width: 315 },
          { from, to: "b.png", height: 95 },
        ],
        publicDir,
      );
      expect(readdirSync(publicDir).sort()).toEqual(["a.png", "b.png"]);
    });
  });
});
