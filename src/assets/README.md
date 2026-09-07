---
title: Runtime Asset Lookup
description: "Two pure helpers that resolve a logical asset or sprite name to its content-hashed public URL, against a mapping baked in at build time."
---

# `@y-core/forge/assets`

Two pure lookup helpers a Worker calls at request time: a logical asset name in, a public,
content-hashed URL out.

```ts
import { createManifest, createSpriteRegistry } from "@y-core/forge/assets";
```

The mapping they resolve against is **baked into the generated module at build time**. Neither
function touches the filesystem, scans a directory, or reads an environment variable — they close
over a plain `Record<string, string>` handed to them at construction. That is what makes this
subpath Worker-safe: no Node built-in is imported anywhere beneath it.

The build that produces that mapping, and the `assets.config.ts` that drives it, are
[`@y-core/forge/tooling/assets`](../tooling/assets/README.md) — build-time only, and never imported
into a Worker.

---

## Features

- **Logical-name resolution** — `createManifest` maps `"styles.css"` to `/assets/styles.abc12345.css`,
  and passes an unmapped key straight through under the same prefix, so a name the build did not
  emit still produces a plausible URL rather than `undefined`.
- **Sprite-group resolution** — `createSpriteRegistry` maps a sprite group name to its sheet URL
  through a `Manifest`, so the result carries the same prefix and hash the rest of the tree does.
- **Loud on an unknown group** — an unregistered sprite name throws rather than resolving to a
  broken `<use href>`.

---

## Usage

The generated `.forge/assets.ts` calls `createManifest` for you, with the mapping the build emitted
and the configured `publicPrefix`. Consumers import that module (aliased `@assets`) rather than
calling `createManifest` themselves:

```ts
import { assets } from "@assets";

const href = assets.path("styles.css"); // "/assets/styles.abc12345.css"
```

In an SSR view, reference the logical name and let the Worker serve the hashed path:

```tsx
<link rel='stylesheet' href={assets.path("styles.css")} />
```

Calling it directly — in a test, or over a mapping you assembled yourself:

```ts
import { createManifest, createSpriteRegistry } from "@y-core/forge/assets";

const assets = createManifest({ "styles.css": "styles.abc12345.css" }, "/assets");
assets.path("styles.css"); // "/assets/styles.abc12345.css"
assets.path("unknown.png"); // "/assets/unknown.png" — pass-through fallback

const sprites = createSpriteRegistry({ ui: "sprites/ui.svg" }, assets);
sprites.get("ui"); // "/assets/sprites/ui.svg"
sprites.get("nope"); // throws: Unknown sprite group: "nope"
```

---

## Core Components & APIs

| Export | Signature | Purpose |
| --- | --- | --- |
| `createManifest` | `(data: Record<string, string>, prefix: string) => Manifest` | Builds a logical-name → public-path resolver |
| `createSpriteRegistry` | `(sprites: Record<string, string>, manifest: Manifest) => SpriteRegistry` | Resolves sprite group names to public sprite paths |

`Manifest` and `SpriteRegistry` are the two interfaces those functions return, and both are exported
as types.

### `createManifest(data, prefix)`

Returns a `Manifest` with one method, `path(key: string): string`. It strips a leading `/` from the
key, looks the remainder up in `data`, falls back to the key itself when unmapped, and joins the
result under `prefix` with the trailing slash normalised away.

| Parameter | Type | Description |
| --- | --- | --- |
| `data` | `Record<string, string>` | Logical name → emitted relative path, as the build wrote it. |
| `prefix` | `string` | Public URL prefix, e.g. `/assets`. A trailing slash is trimmed. |

### `createSpriteRegistry(sprites, manifest)`

Returns a `SpriteRegistry` with one method, `get(name: string): string`. It looks the group name up
in `sprites` and resolves the result through `manifest`, so the returned URL is prefixed and
hash-aware. An unregistered name throws `Unknown sprite group: "<name>"`.

| Parameter | Type | Description |
| --- | --- | --- |
| `sprites` | `Record<string, string>` | Group name → logical sprite target from config. |
| `manifest` | `Manifest` | The manifest the logical target resolves through. |

---

## See also

- [`@y-core/forge/tooling/assets`](../tooling/assets/README.md) — authoring `assets.config.ts`,
  running the build, and the generated module these two functions are called from.
- [`ASSET_PIPELINE.md`](../../docs/ASSET_PIPELINE.md) §3 — the
  runtime lookup contract as a ruling.
