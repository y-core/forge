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

  it("per-source template override uses that source's template wrapper", () => {
    const dir = join(tmpdir(), `forge-cursors-per-src-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, "template-a.svg"), `<svg viewBox="{{viewBox}}"><g class="wrapper-a">{{markup}}</g></svg>`);
      writeFileSync(join(dir, "template-b.svg"), `<svg viewBox="{{viewBox}}"><g class="wrapper-b">{{markup}}</g></svg>`);
      const cursorSvg = `<svg viewBox="0 0 24 24"><path d="M1 0"/></svg>`;
      writeFileSync(join(dir, "cursor-a.svg"), cursorSvg);
      writeFileSync(join(dir, "cursor-b.svg"), cursorSvg);

      const config: CursorsConfig = {
        target: "css/cursors.css",
        template: { path: dir, file: "template-a.svg" },
        themes: { light: ":root" },
        sources: [
          { path: dir, files: [{ key: "cursor-a", file: "cursor-a.svg" }] },
          { path: dir, files: [{ key: "cursor-b", file: "cursor-b.svg" }], template: { path: dir, file: "template-b.svg" } },
        ],
      };

      const result = buildCursors(config, CSS);
      const svgA = decodeURIComponent(result["cursor-a"]!.light!);
      const svgB = decodeURIComponent(result["cursor-b"]!.light!);

      expect(svgA).toContain('class="wrapper-a"');
      expect(svgA).not.toContain('class="wrapper-b"');
      expect(svgB).toContain('class="wrapper-b"');
      expect(svgB).not.toContain('class="wrapper-a"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("config.vars flat and per-theme values resolve via cssvar() to per-theme hex", () => {
    const dir = join(tmpdir(), `forge-cursors-vars-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      const template = `<svg viewBox="{{viewBox}}"><rect fill="cssvar(--cursor-shadow)"/><circle fill="cssvar(--cursor-accent)">{{markup}}</circle></svg>`;
      writeFileSync(join(dir, "template.svg"), template);
      writeFileSync(join(dir, "cursor.svg"), `<svg viewBox="0 0 24 24"><path d="M1 0"/></svg>`);

      const config: CursorsConfig = {
        target: "css/cursors.css",
        template: { path: dir, file: "template.svg" },
        themes: { light: ":root", dark: ".dark" },
        sources: [{ path: dir, files: [{ key: "cursor", file: "cursor.svg" }] }],
        vars: { "--cursor-shadow": "#ff0000", "--cursor-accent": { light: "#0000ff", dark: "#00ff00" } },
      };

      const result = buildCursors(config, CSS);
      const lightSvg = decodeURIComponent(result.cursor!.light!);
      const darkSvg = decodeURIComponent(result.cursor!.dark!);

      // Flat var resolves to the same hex in both themes.
      expect(lightSvg).toContain('fill="#ff0000"');
      expect(darkSvg).toContain('fill="#ff0000"');

      // Per-theme var resolves to distinct hex values.
      expect(lightSvg).toContain('fill="#0000ff"');
      expect(darkSvg).toContain('fill="#00ff00"');
      expect(lightSvg).not.toContain('fill="#00ff00"');
      expect(darkSvg).not.toContain('fill="#0000ff"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when cssvar() references a missing token", () => {
    const dir = join(tmpdir(), `forge-cursors-cssvar-miss-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      const template = `<svg viewBox="{{viewBox}}"><rect fill="cssvar(--not-defined)"/>{{markup}}</svg>`;
      writeFileSync(join(dir, "template.svg"), template);
      writeFileSync(join(dir, "cursor.svg"), `<svg viewBox="0 0 24 24"><path d="M1 0"/></svg>`);

      const config: CursorsConfig = {
        target: "css/cursors.css",
        template: { path: dir, file: "template.svg" },
        themes: { light: ":root" },
        sources: [{ path: dir, files: [{ key: "cursor", file: "cursor.svg" }] }],
      };

      expect(() => buildCursors(config, CSS)).toThrow(/missing token.*via cssvar/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("template without cssvar() bakes identically to pre-cssvar behaviour (regression)", () => {
    const { dir, config } = setup();
    try {
      const result = buildCursors(config, CSS);
      // The core bake properties are unchanged: per-theme output, correct hotspot suffix.
      expect(Object.keys(result)).toEqual(["select"]);
      expect(Object.keys(result.select!).sort()).toEqual(["dark", "light"]);
      expect(result.select!.light!.endsWith("6 4, auto")).toBe(true);
      expect(result.select!.dark!.endsWith("6 4, auto")).toBe(true);
      // Themes still differ because halo/signal colors differ.
      expect(result.select!.light).not.toBe(result.select!.dark);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
