import { describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildRasters } from "./rasters";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 315 95" width="315" height="95"><rect width="315" height="95" fill="#123456"/></svg>`;

interface Call {
  resize: Record<string, number>;
  dest: string;
}

/** Stands in for `sharp`, recording the resize each entry asks for and writing the file it would.
 *
 *  `png()` answers both `toFile` and `toBuffer` so this stub stays a superset of the one
 *  `icons.test.ts` registers — `mock.module` is process-global, so a narrower stub leaking into
 *  that file would break it.
 */
async function stubSharp(): Promise<Call[]> {
  const calls: Call[] = [];
  await mock.module("sharp", () => ({
    default: () => ({
      resize: (resize: Record<string, number>) => ({
        png: () => ({
          toFile: async (dest: string) => {
            calls.push({ resize, dest });
            writeFileSync(dest, "PNG");
          },
          toBuffer: async () => new TextEncoder().encode("PNG"),
        }),
      }),
    }),
  }));
  return calls;
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
  // The unset dimension is omitted rather than passed as `undefined`: that omission is what lets
  // sharp derive it from the source ratio, and passing the key explicitly would defeat it.
  it("asks for the width alone when only a width is given, leaving the ratio to derive the rest", async () => {
    const calls = await stubSharp();
    await withTmp("width-only", async ({ publicDir, from }) => {
      await buildRasters([{ from, to: "logo.png", width: 360 }], publicDir);
      expect(calls.map((c) => c.resize)).toEqual([{ width: 360 }]);
    });
  });

  it("asks for the height alone when only a height is given, leaving the ratio to derive the rest", async () => {
    const calls = await stubSharp();
    await withTmp("height-only", async ({ publicDir, from }) => {
      await buildRasters([{ from, to: "logo.png", height: 190 }], publicDir);
      expect(calls.map((c) => c.resize)).toEqual([{ height: 190 }]);
    });
  });

  it("passes both dimensions verbatim when both are given", async () => {
    const calls = await stubSharp();
    await withTmp("both", async ({ publicDir, from }) => {
      await buildRasters([{ from, to: "logo.png", width: 200, height: 200 }], publicDir);
      expect(calls.map((c) => c.resize)).toEqual([{ width: 200, height: 200 }]);
    });
  });

  it("creates missing intermediate destination directories", async () => {
    await stubSharp();
    await withTmp("nested", async ({ publicDir, from }) => {
      await buildRasters([{ from, to: "email/logo@2x.png", width: 315 }], publicDir);
      expect(existsSync(join(publicDir, "email", "logo@2x.png"))).toBe(true);
    });
  });

  it("throws when the destination escapes publicDir (safeJoin guard)", async () => {
    await stubSharp();
    await withTmp("escape", async ({ tmpDir, publicDir, from }) => {
      mkdirSync(publicDir, { recursive: true });
      await expect(buildRasters([{ from, to: "../evil.png", width: 100 }], publicDir)).rejects.toThrow(/escapes the asset root/);
      expect(existsSync(join(tmpDir, "evil.png"))).toBe(false);
    });
  });

  // The early return is what keeps sharp an optional peer: a config without rasters must never
  // reach the import, so a consumer that never rasterizes never has to install it.
  it("writes nothing and never loads sharp for an empty raster list", async () => {
    const calls = await stubSharp();
    await withTmp("empty", async ({ publicDir }) => {
      await buildRasters([], publicDir);
      expect(existsSync(publicDir)).toBe(false);
      expect(calls).toEqual([]);
    });
  });

  it("rasterizes every entry in the list", async () => {
    const calls = await stubSharp();
    await withTmp("multi", async ({ publicDir, from }) => {
      await buildRasters(
        [
          { from, to: "a.png", width: 315 },
          { from, to: "b.png", height: 95 },
        ],
        publicDir,
      );
      expect(readdirSync(publicDir).sort()).toEqual(["a.png", "b.png"]);
      expect(calls.map((c) => c.resize)).toEqual([{ width: 315 }, { height: 95 }]);
    });
  });
});
