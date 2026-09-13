import { describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIcons, iconLinks, iconTarget } from "./icons";
import type { IconsConfig } from "./types";

async function stubSharp(): Promise<{ inputs: string[] }> {
  const captured: { inputs: string[] } = { inputs: [] };
  await mock.module("sharp", () => ({
    default: (input: Uint8Array) => {
      captured.inputs.push(new TextDecoder().decode(input));
      return { resize: () => ({ png: () => ({ toBuffer: async () => new TextEncoder().encode("PNG") }) }) };
    },
  }));
  return captured;
}

describe("buildIcons()", () => {
  it("writes a PNG file per configured png/ico size and the svg + manifest outputs", async () => {
    await stubSharp();
    const tmpDir = join(tmpdir(), `forge-icons-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const outDir = join(tmpDir, "icons");
    mkdirSync(tmpDir, { recursive: true });
    try {
      const srcPath = join(tmpDir, "icon.svg");
      writeFileSync(srcPath, `<svg viewBox="0 0 24 24"><path d="M12 12" fill="currentColor"/></svg>`);

      const config: IconsConfig = {
        src: srcPath,
        outDir,
        lightColor: "#163030",
        app: { name: "Demo", shortName: "Demo", backgroundColor: "#ffffff" },
        outputs: [
          { kind: "svg", file: "favicon.svg" },
          { kind: "png", file: "icon-16.png", size: 16 },
          { kind: "png", file: "icon-32.png", size: 32, manifest: true },
          { kind: "ico", file: "favicon.ico", sizes: [16, 32] },
          { kind: "manifest", file: "manifest.webmanifest" },
        ],
      };

      await buildIcons(config);

      expect(readFileSync(join(outDir, "icon-16.png"), "utf-8")).toBe("PNG");
      expect(readFileSync(join(outDir, "icon-32.png"), "utf-8")).toBe("PNG");

      expect(readFileSync(join(outDir, "favicon.svg"), "utf-8")).toBe(
        `<svg viewBox="0 0 24 24"><style>path{fill:#163030}</style><path d="M12 12" fill="currentColor"/></svg>`,
      );

      expect(existsSync(join(outDir, "favicon.ico"))).toBe(true);

      const manifest = JSON.parse(readFileSync(join(outDir, "manifest.webmanifest"), "utf-8"));
      expect(manifest.name).toBe("Demo");
      expect(manifest.theme_color).toBe("#163030");
      expect(manifest.icons).toEqual([{ src: "/icon-32.png", sizes: "32x32", type: "image/png" }]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
      mock.restore();
    }
  });

  it("injects a dark-mode media rule into the svg when darkColor is set", async () => {
    await stubSharp();
    const tmpDir = join(tmpdir(), `forge-icons-dark-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const outDir = join(tmpDir, "icons");
    mkdirSync(tmpDir, { recursive: true });
    try {
      const srcPath = join(tmpDir, "icon.svg");
      writeFileSync(srcPath, `<svg><path d="M0 0"/></svg>`);

      const config: IconsConfig = {
        src: srcPath,
        outDir,
        lightColor: "#000000",
        darkColor: "#ffffff",
        outputs: [{ kind: "svg", file: "favicon.svg" }],
      };

      await buildIcons(config);

      expect(readFileSync(join(outDir, "favicon.svg"), "utf-8")).toBe(
        `<svg><style>path{fill:#000000}@media(prefers-color-scheme:dark){path{fill:#ffffff}}</style><path d="M0 0"/></svg>`,
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
      mock.restore();
    }
  });

  it("resolves every currentColor in the bytes handed to sharp, not just the first", async () => {
    const sharpStub = await stubSharp();
    const tmpDir = join(tmpdir(), `forge-icons-color-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const outDir = join(tmpDir, "icons");
    mkdirSync(tmpDir, { recursive: true });
    try {
      const srcPath = join(tmpDir, "icon.svg");
      writeFileSync(srcPath, `<svg viewBox="0 0 24 24"><path d="M12 12" fill="currentColor" stroke="currentColor"/></svg>`);

      const config: IconsConfig = { src: srcPath, outDir, lightColor: "#163030", outputs: [{ kind: "png", file: "icon-16.png", size: 16 }] };

      await buildIcons(config);

      expect(sharpStub.inputs).toEqual([`<svg viewBox="0 0 24 24"><path d="M12 12" fill="#163030" stroke="#163030"/></svg>`]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
      mock.restore();
    }
  });

  it("writes a prefixed output under the prefix and a root-pinned one at the asset root", async () => {
    await stubSharp();
    const tmpDir = join(tmpdir(), `forge-icons-prefix-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const outDir = join(tmpDir, "public");
    mkdirSync(tmpDir, { recursive: true });
    try {
      const srcPath = join(tmpDir, "icon.svg");
      writeFileSync(srcPath, `<svg><path d="M0 0"/></svg>`);

      const config: IconsConfig = {
        src: srcPath,
        outDir,
        publicPrefix: "/static",
        lightColor: "#000",
        app: { name: "Demo", shortName: "Demo", backgroundColor: "#fff" },
        outputs: [
          { kind: "svg", file: "favicon.svg" },
          { kind: "png", file: "icon-192.png", size: 192, manifest: true },
          { kind: "ico", file: "favicon.ico", sizes: [16], root: true },
          { kind: "manifest", file: "site.webmanifest" },
        ],
      };

      await buildIcons(config);

      expect(existsSync(join(outDir, "favicon.ico"))).toBe(true);
      expect(existsSync(join(outDir, "static", "favicon.svg"))).toBe(true);

      const manifest = JSON.parse(readFileSync(join(outDir, "static", "site.webmanifest"), "utf-8"));
      expect(manifest.icons).toEqual([{ src: "/static/icon-192.png", sizes: "192x192", type: "image/png" }]);
      expect(manifest.start_url).toBe("/");
      expect(manifest.scope).toBe("/");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
      mock.restore();
    }
  });
});

describe("iconTarget()", () => {
  const base = { src: "icon.svg", outDir: "public", lightColor: "#000", outputs: [] };

  it("serves from the asset root when no prefix is configured", () => {
    expect(iconTarget(base, { kind: "svg", file: "favicon.svg" })).toEqual({ dir: "public", path: "/favicon.svg" });
  });

  it("normalises a prefix given without a leading slash or with a trailing one", () => {
    expect(iconTarget({ ...base, publicPrefix: "static/" }, { kind: "svg", file: "favicon.svg" })).toEqual({
      dir: "public/static",
      path: "/static/favicon.svg",
    });
  });

  it("pins a root output to the asset root even under a prefix", () => {
    expect(iconTarget({ ...base, publicPrefix: "/static" }, { kind: "ico", file: "favicon.ico", sizes: [16], root: true })).toEqual({
      dir: "public",
      path: "/favicon.ico",
    });
  });
});

describe("iconLinks()", () => {
  it("derives one head link per output that declares one, skipping a bare manifest png", () => {
    const config: IconsConfig = {
      src: "icon.svg",
      outDir: "public",
      publicPrefix: "/static",
      lightColor: "#000",
      outputs: [
        { kind: "ico", file: "favicon.ico", sizes: [16, 32, 48], root: true },
        { kind: "svg", file: "favicon.svg" },
        { kind: "png", file: "apple-touch-icon.png", size: 180, rel: "apple-touch-icon" },
        { kind: "png", file: "icon-192.png", size: 192, manifest: true },
        { kind: "manifest", file: "site.webmanifest" },
      ],
    };

    expect(iconLinks(config)).toEqual([
      { rel: "icon", href: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { rel: "icon", href: "/static/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/static/apple-touch-icon.png" },
      { rel: "manifest", href: "/static/site.webmanifest" },
    ]);
  });
});
