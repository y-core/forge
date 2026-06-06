import { describe, expect, it } from "bun:test";
import { createManifest } from "./manifest";
import { createSpriteRegistry } from "./registry";

// The manifest data maps a key to a path string. When the key is found in data,
// the resolved value is used; otherwise the key itself is used. Given
// createManifest({ "icons.svg": "icons.svg" }, "/assets"), manifest.path("icons.svg")
// yields "/assets/icons.svg".
//
// The sprites config maps sprite-registry-name → manifest-key. So:
//   sprites = { icons: "icons.svg" }  →  registry.get("icons") calls manifest.path("icons.svg")

describe("createSpriteRegistry — get", () => {
  it("returns the manifest path for a registered sprite name", () => {
    // data maps "icons.svg" → "icons.svg" (identity), prefix "/assets"
    // manifest.path("icons.svg") = "/assets/icons.svg"
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
