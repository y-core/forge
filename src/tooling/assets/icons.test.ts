import { describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIcons } from "./icons";
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
});
