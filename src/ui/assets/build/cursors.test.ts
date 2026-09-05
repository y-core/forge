import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CursorsConfig } from "../../../tooling/assets/types";
import { buildCursors } from "./cursors";

const TEMPLATE = `<svg width="32" height="32" viewBox="{{viewBox}}"><g stroke="cssvar(--background)" fill="none">{{markup}}</g><g stroke="{{signal}}" fill="none">{{markup}}</g></svg>`;

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

function parseCursorValue(value: string): { svg: string; hotspot: string } {
  const match = value.match(/^url\("data:image\/svg\+xml,([^"]*)"\) (.+)$/);
  if (!match?.[1]) throw new Error(`not a cursor value: ${value}`);
  return { svg: decodeURIComponent(match[1]), hotspot: match[2] ?? "" };
}

function setup(): { dir: string; config: CursorsConfig } {
  const dir = join(tmpdir(), `forge-cursors-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "template.svg"), TEMPLATE);
  writeFileSync(join(dir, "select.svg"), CURSOR_SVG);
  const config: CursorsConfig = {
    target: "css/cursors.css",
    themes: { light: ":root", dark: ".dark" },
    sources: [{ path: dir, files: [{ key: "select", file: "select.svg" }], template: { path: dir, file: "template.svg" } }],
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

      const light = parseCursorValue(select.light!);
      const dark = parseCursorValue(select.dark!);

      expect(light.svg).toBe(
        `<svg width="32" height="32" viewBox="0 0 24 24"><g stroke="#ffffff" fill="none"><path d="M1 0"/></g><g stroke="#11161f" fill="none"><path d="M1 0"/></g></svg>`,
      );
      expect(dark.svg).toBe(
        `<svg width="32" height="32" viewBox="0 0 24 24"><g stroke="#000000" fill="none"><path d="M1 0"/></g><g stroke="#ebeff5" fill="none"><path d="M1 0"/></g></svg>`,
      );
      expect(light.hotspot).toBe("6 4, auto");
      expect(dark.hotspot).toBe("6 4, auto");
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
        themes: { light: ":root" },
        sources: [{ path: dir, files: [{ key: "select", file: "select.svg" }], template: { path: dir, file: "template.svg" } }],
      };
      expect(() => buildCursors(config, CSS)).toThrow(/missing CSS token/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("each source bakes through its own template wrapper", () => {
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
        themes: { light: ":root" },
        sources: [
          { path: dir, files: [{ key: "cursor-a", file: "cursor-a.svg" }], template: { path: dir, file: "template-a.svg" } },
          { path: dir, files: [{ key: "cursor-b", file: "cursor-b.svg" }], template: { path: dir, file: "template-b.svg" } },
        ],
      };

      const result = buildCursors(config, CSS);
      expect(parseCursorValue(result["cursor-a"]!.light!).svg).toBe(`<svg viewBox="0 0 24 24"><g class="wrapper-a"><path d="M1 0"/></g></svg>`);
      expect(parseCursorValue(result["cursor-b"]!.light!).svg).toBe(`<svg viewBox="0 0 24 24"><g class="wrapper-b"><path d="M1 0"/></g></svg>`);
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
        themes: { light: ":root", dark: ".dark" },
        sources: [{ path: dir, files: [{ key: "cursor", file: "cursor.svg" }], template: { path: dir, file: "template.svg" } }],
        vars: { "--cursor-shadow": "#ff0000", "--cursor-accent": { light: "#0000ff", dark: "#00ff00" } },
      };

      const result = buildCursors(config, CSS);
      expect(parseCursorValue(result.cursor!.light!).svg).toBe(
        `<svg viewBox="0 0 24 24"><rect fill="#ff0000"/><circle fill="#0000ff"><path d="M1 0"/></circle></svg>`,
      );
      expect(parseCursorValue(result.cursor!.dark!).svg).toBe(
        `<svg viewBox="0 0 24 24"><rect fill="#ff0000"/><circle fill="#00ff00"><path d="M1 0"/></circle></svg>`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("vars with alpha bake to per-theme #rrggbbaa via cssvar(), and alpha signal tokens bake 8-digit", () => {
    const dir = join(tmpdir(), `forge-cursors-alpha-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      const template = `<svg viewBox="{{viewBox}}"><rect fill="cssvar(--cursor-shadow)"/><circle stroke="cssvar(--cursor-outline)"/><g stroke="{{signal}}">{{markup}}</g></svg>`;
      writeFileSync(join(dir, "template.svg"), template);
      writeFileSync(join(dir, "cursor.svg"), `<svg viewBox="0 0 24 24" data-cursor-token="--signal-alpha"><path d="M1 0"/></svg>`);

      const css = `
:root { --signal-alpha: rgb(255 0 0 / 0.5); }
.dark { --signal-alpha: rgb(255 0 0 / 0.5); }
`;
      const config: CursorsConfig = {
        target: "css/cursors.css",
        themes: { light: ":root", dark: ".dark" },
        sources: [{ path: dir, files: [{ key: "cursor", file: "cursor.svg" }], template: { path: dir, file: "template.svg" } }],
        vars: { "--cursor-shadow": { light: "rgb(0 0 0 / 0.28)", dark: "rgb(0 0 0 / 0.45)" }, "--cursor-outline": "rgb(255 255 255 / 0.9)" },
      };

      const result = buildCursors(config, css);
      expect(parseCursorValue(result.cursor!.light!).svg).toBe(
        `<svg viewBox="0 0 24 24"><rect fill="#00000047"/><circle stroke="#ffffffe6"/><g stroke="#ff000080"><path d="M1 0"/></g></svg>`,
      );
      expect(parseCursorValue(result.cursor!.dark!).svg).toBe(
        `<svg viewBox="0 0 24 24"><rect fill="#00000073"/><circle stroke="#ffffffe6"/><g stroke="#ff000080"><path d="M1 0"/></g></svg>`,
      );
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
        themes: { light: ":root" },
        sources: [{ path: dir, files: [{ key: "cursor", file: "cursor.svg" }], template: { path: dir, file: "template.svg" } }],
      };

      expect(() => buildCursors(config, CSS)).toThrow(/missing token.*via cssvar/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("strips XML comments from bakes, including commented-out cssvar() refs and `--` hazards", () => {
    const dir = join(tmpdir(), `forge-cursors-comments-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      // Adversarial fixture: a `--` inside a comment and a commented-out cssvar().
      const template = `<svg viewBox="{{viewBox}}">
  <!-- shadow layer uses the --cursor-shadow token -->
  <!-- <rect fill="cssvar(--not-declared-anywhere)"/> -->
  <rect fill="cssvar(--cursor-shadow)"/>{{markup}}</svg>`;
      writeFileSync(join(dir, "template.svg"), template);
      writeFileSync(join(dir, "cursor.svg"), `<svg viewBox="0 0 24 24"><!-- old glyph --><path d="M1 0"/></svg>`);

      const config: CursorsConfig = {
        target: "css/cursors.css",
        themes: { light: ":root" },
        sources: [{ path: dir, files: [{ key: "cursor", file: "cursor.svg" }], template: { path: dir, file: "template.svg" } }],
        vars: { "--cursor-shadow": "#ff0000" },
      };

      const result = buildCursors(config, CSS);
      expect(parseCursorValue(result.cursor!.light!).svg).toBe(`<svg viewBox="0 0 24 24">\n  \n  \n  <rect fill="#ff0000"/><path d="M1 0"/></svg>`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("template without cssvar() bakes identically to pre-cssvar behaviour (regression)", () => {
    const { dir, config } = setup();
    try {
      const result = buildCursors(config, CSS);
      expect(Object.keys(result)).toEqual(["select"]);
      expect(Object.keys(result.select!).sort()).toEqual(["dark", "light"]);
      expect(result.select!.light!.endsWith("6 4, auto")).toBe(true);
      expect(result.select!.dark!.endsWith("6 4, auto")).toBe(true);
      expect(result.select!.light).not.toBe(result.select!.dark);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bakes a short-hex token as its expanded colour, not black", () => {
    const { dir, config } = setup();
    try {
      const result = buildCursors(config, `:root { --foreground: #fff; --background: #000; }`);

      expect(parseCursorValue(result.select!.light!).svg).toBe(
        `<svg width="32" height="32" viewBox="0 0 24 24"><g stroke="#000000" fill="none"><path d="M1 0"/></g><g stroke="#ffffff" fill="none"><path d="M1 0"/></g></svg>`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when a token resolves to an unparseable colour", () => {
    const { dir, config } = setup();
    try {
      expect(() => buildCursors(config, `:root { --foreground: not-a-colour; --background: #ffffff; }`)).toThrow(
        /token "--foreground" resolved to an unparseable colour: not-a-colour/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bakes from minified CSS where the signal chain ends on a last-in-block token", () => {
    const { dir, config } = setup();
    try {
      // Minified fixture: no `;` after each block's last declaration.
      const minified = [
        ":root,:host{--color-gray-50:oklch(98.5% .002 247.839);--color-gray-950:oklch(13% .028 261.692)}",
        ":root{--background:#f3f4f6;--foreground:var(--palette-950)}",
        ":root{--palette-50:var(--color-gray-50);--palette-950:var(--color-gray-950)}",
        ".dark{--background:#1e2939;--foreground:var(--palette-50)}",
      ].join("");

      const result = buildCursors(config, minified);

      expect(parseCursorValue(result.select!.light!).svg).toBe(
        `<svg width="32" height="32" viewBox="0 0 24 24"><g stroke="#f3f4f6" fill="none"><path d="M1 0"/></g><g stroke="#030712" fill="none"><path d="M1 0"/></g></svg>`,
      );
      expect(parseCursorValue(result.select!.dark!).svg).toBe(
        `<svg width="32" height="32" viewBox="0 0 24 24"><g stroke="#1e2939" fill="none"><path d="M1 0"/></g><g stroke="#f9fafb" fill="none"><path d="M1 0"/></g></svg>`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
