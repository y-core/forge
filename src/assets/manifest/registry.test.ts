import { describe, expect, it } from "bun:test";
import { createManifest } from "./manifest";
import { createSpriteRegistry } from "./registry";

describe("createSpriteRegistry — get", () => {
  it("returns the manifest path for a registered sprite name", () => {
    const manifest = createManifest({ "icons.svg": "icons.svg" }, "/assets");
    const registry = createSpriteRegistry({ icons: "icons.svg" }, manifest);
    expect(registry.get("icons")).toBe("/assets/icons.svg");
  });

  it("throws an error with the unknown name when the sprite group is not registered", () => {
    const manifest = createManifest({ "icons.svg": "icons.svg" }, "/assets");
    const registry = createSpriteRegistry({ icons: "icons.svg" }, manifest);
    expect(() => registry.get("icons-unknown")).toThrow('Unknown sprite group: "icons-unknown"');
  });

  it("returns the same path on repeated calls with the same name", () => {
    const manifest = createManifest({ "icons.svg": "icons.svg" }, "/assets");
    const registry = createSpriteRegistry({ icons: "icons.svg" }, manifest);
    const first = registry.get("icons");
    const second = registry.get("icons");
    expect(first).toBe(second);
  });

  it("resolves each sprite name independently via the manifest", () => {
    const manifest = createManifest({ "icons.svg": "icons.svg", "avatars.svg": "avatars.svg" }, "/assets");
    const registry = createSpriteRegistry({ icons: "icons.svg", avatars: "avatars.svg" }, manifest);
    expect(registry.get("icons")).toBe("/assets/icons.svg");
    expect(registry.get("avatars")).toBe("/assets/avatars.svg");
  });

  it("throws for a name that exists in manifest but not in sprites config", () => {
    const manifest = createManifest({ "icons.svg": "icons.svg" }, "/assets");
    const registry = createSpriteRegistry({}, manifest);
    expect(() => registry.get("icons")).toThrow('Unknown sprite group: "icons"');
  });
});
