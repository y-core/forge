---
title: Runtime Asset Lookup
description: "Two pure helpers that resolve a logical asset or sprite name to its content-hashed public URL, against a mapping baked in at build time."
audience: consumer
---

# `@y-core/forge/assets`

A view wants to write `styles.css`; the browser needs `/assets/styles.abc12345.css`. This subpath is the lookup between the two — a logical name in,
a public content-hashed URL out — at request time, in a Worker.

```ts
import { createManifest, createSpriteRegistry } from "@y-core/forge/assets";
```

The mapping is **baked into the generated module at build time**. Neither function touches the filesystem, scans a directory, or reads an
environment variable: they close over a plain record handed to them at construction. That is what makes this subpath Worker-safe — no Node built-in
is imported anywhere beneath it.

---

## Getting started

You will rarely call `createManifest` yourself. The generated `.forge/assets.ts` does it for you, with the mapping the build emitted and the
configured `publicPrefix`. Import that module — aliased `@assets` — and ask it for a path:

```tsx
import { assets } from "@assets";

<link rel='stylesheet' href={assets.path("styles.css")} />;
```

Reference the logical name everywhere, and let the resolved hash be the build's business.

---

## Calling it over your own mapping

In a test, or anywhere the generated module is not what you want:

```ts
const assets = createManifest({ "styles.css": "styles.abc12345.css" }, "/assets");
assets.path("styles.css"); // "/assets/styles.abc12345.css"
assets.path("unknown.png"); // "/assets/unknown.png" — pass-through fallback

const sprites = createSpriteRegistry({ ui: "sprites/ui.svg" }, assets);
sprites.get("ui"); // "/assets/sprites/ui.svg"
```

The prefix is a public URL prefix, and a trailing slash on it is trimmed. A leading `/` on the key is stripped before lookup, so `path("/x.css")`
and `path("x.css")` agree.

---

## Gotchas

**An unmapped asset passes through; an unregistered sprite throws.** The asymmetry is deliberate. A name the build did not emit still produces a
plausible URL rather than `undefined`, which fails visibly in the browser and not in the middle of a render. A sprite group, by contrast, has no
plausible fallback — an unknown name would resolve to a broken `<use href>` that renders as nothing at all, so it throws instead.

---

## See also

- [`@y-core/forge/tooling/assets`][tooling-assets-readme] — authoring `assets.config.ts`, running the build, and the generated module these two
  functions are called from
- [`ASSET_PIPELINE.md`][ap-3] §3 — the runtime lookup contract as a ruling

[ap-3]: ../../docs/ASSET_PIPELINE.md#3-assets--the-runtime-namespace
[tooling-assets-readme]: ../tooling/assets/README.md
