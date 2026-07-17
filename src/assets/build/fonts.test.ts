import { describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFonts } from "./fonts";

describe("buildFonts()", () => {
  it("downloads each font and writes it under publicDir", async () => {
    const tmpDir = join(tmpdir(), `forge-fonts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public");
    mkdirSync(tmpDir, { recursive: true });
    const bytesA = new Uint8Array([1, 2, 3, 4]);
    const bytesB = new Uint8Array([9, 8, 7]);
    const fetchSpy = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(bytesA, { status: 200 }))
      .mockResolvedValueOnce(new Response(bytesB, { status: 200 }));
    try {
      await buildFonts(
        {
          downloads: [
            { url: "https://fonts.example.com/inter.woff2", to: "fonts/inter.woff2" },
            { url: "https://fonts.example.com/mono.woff2", to: "fonts/mono.woff2" },
          ],
        },
        publicDir,
      );

      const destA = join(publicDir, "fonts", "inter.woff2");
      const destB = join(publicDir, "fonts", "mono.woff2");
      expect(existsSync(destA)).toBe(true);
      expect(existsSync(destB)).toBe(true);
      expect(new Uint8Array(readFileSync(destA))).toEqual(bytesA);
      expect(new Uint8Array(readFileSync(destB))).toEqual(bytesB);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips the fetch when the destination already exists (cache)", async () => {
    const tmpDir = join(tmpdir(), `forge-fonts-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public");
    const dest = join(publicDir, "fonts", "inter.woff2");
    mkdirSync(join(publicDir, "fonts"), { recursive: true });
    writeFileSync(dest, "CACHED");
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([0]), { status: 200 }));
    try {
      await buildFonts({ downloads: [{ url: "https://fonts.example.com/inter.woff2", to: "fonts/inter.woff2" }] }, publicDir);

      expect(fetchSpy).toHaveBeenCalledTimes(0);
      expect(readFileSync(dest, "utf-8")).toBe("CACHED");
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws when the download responds with a non-ok status", async () => {
    const tmpDir = join(tmpdir(), `forge-fonts-fail-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public");
    mkdirSync(tmpDir, { recursive: true });
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404, statusText: "Not Found" }));
    try {
      await expect(
        buildFonts({ downloads: [{ url: "https://fonts.example.com/missing.woff2", to: "fonts/missing.woff2" }] }, publicDir),
      ).rejects.toThrow("fetch https://fonts.example.com/missing.woff2: 404 Not Found");
      expect(existsSync(join(publicDir, "fonts", "missing.woff2"))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws when a download destination escapes publicDir (safeJoin guard)", async () => {
    const tmpDir = join(tmpdir(), `forge-fonts-escape-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public");
    mkdirSync(publicDir, { recursive: true });
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([0]), { status: 200 }));
    try {
      await expect(buildFonts({ downloads: [{ url: "https://fonts.example.com/x.woff2", to: "../escape.woff2" }] }, publicDir)).rejects.toThrow(
        /escapes the asset root/,
      );
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
