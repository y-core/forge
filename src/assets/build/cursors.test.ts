import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CursorsConfig } from "../types";
import { buildCursors } from "./cursors";

const TEMPLATE = `<svg width="32" height="32" viewBox="{{viewBox}}"><g stroke="{{halo}}" fill="none">{{markup}}</g><g stroke="{{signal}}" fill="none">{{markup}}</g></svg>`;

const CURSOR_SVG = `<svg viewBox="0 0 24 24" data-cursor-token="--foreground" data-cursor-hotspot="6 4"><path d="M1 0"/></svg>`;

const CSS = `
:root {
  --foreground: oklch(0.2 0.02 260);
  --background: #ffffff;
}
.dark {
  --foreground: oklch(0.95 0.01 260);
  --background: #000000;
}
`;

function setup(): { dir: string; config: CursorsConfig } {
  const dir = join(tmpdir(), `forge-cursors-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "template.svg"), TEMPLATE);
  writeFileSync(join(dir, "select.svg"), CURSOR_SVG);
  const config: CursorsConfig = {
    target: "css/cursors.css",
    template: { path: dir, file: "template.svg" },
    themes: { light: ":root", dark: ".dark" },
    sources: [{ path: dir, files: [{ key: "select", file: "select.svg" }] }],
  };
  return { dir, config };
}

describe("buildCursors()", () => {
  it("bakes each cursor per theme with viewBox, markup, colours, and hotspot", () => {
    const { dir, config } = setup();
    try {
      const result = buildCursors(config, CSS);

      expect(Object.keys(result)).toEqual(["select"]);
      const select = result.select!;
      expect(Object.keys(select).sort()).toEqual(["dark", "light"]);

      const light = decodeURIComponent(select.light!);
      const dark = decodeURIComponent(select.dark!);

      expect(light).toContain("0 0 24 24");
      expect(dark).toContain("0 0 24 24");
      expect(light).toContain(`d="M1 0"`);
      expect(dark).toContain(`d="M1 0"`);

      // Different themes yield different resolved halo/signal colours.
      expect(light).not.toBe(dark);

      expect(select.light!.startsWith(`url("data:image/svg+xml,`)).toBe(true);
      expect(select.dark!.startsWith(`url("data:image/svg+xml,`)).toBe(true);
      expect(select.light!.endsWith("6 4, auto")).toBe(true);
      expect(select.dark!.endsWith("6 4, auto")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when a cursor references a missing CSS token", () => {
    const dir = join(tmpdir(), `forge-cursors-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, "template.svg"), TEMPLATE);
      writeFileSync(join(dir, "select.svg"), `<svg viewBox="0 0 24 24" data-cursor-token="--nope"><path d="M1 0"/></svg>`);
      const config: CursorsConfig = {
        target: "css/cursors.css",
        template: { path: dir, file: "template.svg" },
        themes: { light: ":root" },
        sources: [{ path: dir, files: [{ key: "select", file: "select.svg" }] }],
      };
      expect(() => buildCursors(config, CSS)).toThrow(/missing CSS token/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
