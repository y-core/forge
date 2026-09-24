import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { forgeUiSpriteSources } from "./glyph-sources";

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
    expect(sources[0]?.files).toEqual([
      "spinner.svg",
      "chevron-down.svg",
      "chevron-left.svg",
      "chevron-right.svg",
      "hamburger.svg",
      "close.svg",
      "panel-open.svg",
      "panel-close.svg",
      "upload.svg",
    ]);
  });

  it("theme source has the expected files", () => {
    const sources = forgeUiSpriteSources();
    expect(sources[1]?.files).toEqual(["sun.svg", "moon.svg", "monitor.svg"]);
  });

  it("every named glyph has a real svg file on disk", () => {
    for (const source of forgeUiSpriteSources()) {
      for (const entry of source.files) {
        const filename = typeof entry === "string" ? entry : entry.file;
        expect(existsSync(join(source.path, filename))).toBe(true);
      }
    }
  });
});
