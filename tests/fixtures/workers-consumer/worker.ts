// The Worker-executed half of the same guard: `./assets` is a runtime subpath, and a Node built-in
// reached through it fails to resolve here, where no `@types/node` is configured.
import { createManifest, createSpriteRegistry } from "@y-core/forge/assets";

const assets = createManifest({ "icons.svg": "icons.a1b2c3d4.svg" }, "/assets");
const sprites = createSpriteRegistry({ ui: "icons.svg" }, assets);

export default { fetch: () => new Response(sprites.get("ui")) };
