import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { FORGE_UI_ICON_NAMES, forgeUiSpriteSources } from "./sprites";

describe("forgeUiSpriteSources", () => {
  it("returns two sources", () => {
    expect(forgeUiSpriteSources()).toHaveLength(2);
  });

  it("source paths exist on disk", () => {
    for (const source of forgeUiSpriteSources()) {
      expect(existsSync(source.path)).toBe(true);
    }
  });

  it("core source has the expected files", () => {
    const sources = forgeUiSpriteSources();
    expect(sources[0]?.files).toEqual(["spinner.svg", "chevron-down.svg", "hamburger.svg", "close.svg"]);
  });

  it("theme source has the expected files", () => {
    const sources = forgeUiSpriteSources();
    expect(sources[1]?.files).toEqual(["sun.svg", "moon.svg", "monitor.svg"]);
  });

  it("every named glyph has a real svg file on disk", () => {
    for (const source of forgeUiSpriteSources()) {
      for (const file of source.files) {
        expect(existsSync(join(source.path, file))).toBe(true);
      }
    }
  });
});

describe("FORGE_UI_ICON_NAMES", () => {
  it("has exactly 7 names", () => {
    expect(FORGE_UI_ICON_NAMES).toHaveLength(7);
  });

  it("contains the expected glyph names", () => {
    const expected = ["spinner", "chevron-down", "hamburger", "close", "sun", "moon", "monitor"];
    expect([...FORGE_UI_ICON_NAMES].sort()).toEqual([...expected].sort());
  });
});
