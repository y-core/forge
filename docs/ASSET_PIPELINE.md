---
title: Asset Pipeline
description: "The asset pipeline and its config, change detection, the runtime manifest namespace, and the generated assets module the build exists to write."
audience: internal
---

# Asset Pipeline

> Owns the build-time asset surface (`tooling/assets`) and its config, the one runtime namespace the
> pipeline writes for (`assets`), and the generated module both ends at. Everything under
> `src/tooling/` runs on a developer's machine, never in a Worker; membership in that container _is_
> the exemption from the Web-APIs-only rule ([`NAMESPACES.md`](./NAMESPACES.md) §4a).
>
> Defers to: [`BUILD_TOOLING.md`](./BUILD_TOOLING.md) for the CLI framework, the verification gate
> and the release workflow that drive it;
> [`LIBRARY_ARCHITECTURE.md`](../warden/canon/libs/LIBRARY_ARCHITECTURE.md) §1d for that exemption, and
> [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §3c for the optional build peer
> dependencies.

---

## 0. Quick Reference

- §1 Assets Config: declaring and discovering the pipeline config
- §1a defineAssetsConfig — Schema and Validation: the canonical entry point
- §1b AssetsConfig Type Shape: who owns the field list, and the one field readers mis-guess
- §1c loadConfig — Config Resolution: resolving `assets.config.ts` against cwd, and why you should pass it
- §2 tooling/assets Pipeline: the build functions and change detection
- §2a Build Functions — Orchestration: `buildAll`, the per-stage functions, and the absence of globs
- §2b Hash and Change Detection: opt-in content hashing, and why the state helpers go unused
- §2c The Namespace Orchestrates Builders and Is Not One: the drives-one/is-one routing rule, and where the compute half went
- §3 assets — the Runtime Namespace: resolving logical names to hashed paths
- §3a createManifest — Content-Hashed Paths: a record and a prefix, not a directory scan
- §3b createSpriteRegistry — Sprite Sheet URL Lookup: group name to sheet URL, and what it is not
- §4 Generated Assets Module: the git-ignored artifact the build exists to write
- §4a The Ordered Stages and the Two Codegen Passes: why codegen straddles `buildJS`
- §4b Build and Types Artifacts Are Shape-Identical: the header split and the idempotent write
- §4c The Emitted Glyph Union — the ForgeIcon Seam: the name a consumer spells in type position

---

## 1. Assets Config

### 1a. defineAssetsConfig — Schema and Validation

`defineAssetsConfig` is the canonical entry point: call it in an `assets.config.ts` at the
project root and export the result as default. `src/tooling/assets/README.md` carries the example.

**It types, it does not validate.** It is the identity function over `AssetsConfig`; the schema
runs in `loadConfig`, which `v.parse`s the imported module into a `ResolvedConfig` with every
optional field defaulted. A mistyped config therefore fails at _load_ time, in the CLI — the
only point at which a config file can be checked at all, since nothing imports it before then.

`paths.publicDir` is the single output root; every artifact lands under it, including JS
bundles, whose subdirectory is per-bundle (`js.bundles[].outdir`) rather than global.
`paths.publicPrefix` is the URL prefix the manifest resolves against (§3a).

### 1b. AssetsConfig Type Shape

**The config shape is owned by `src/tooling/assets/types.ts`** — the valibot schemas there _are_ the
type, via `InferInput`, and `src/tooling/assets/README.md` carries the field-by-field reference. This
document enumerates none of it: a second copy of a field list is indistinguishable from an
amendment the moment the two disagree.

One field is named here because readers reliably guess it wrong: **`sprites` is a record of
named groups, and a group lists its files explicitly** — `sources[].path` plus `sources[].files`
— with **no glob anywhere in the pipeline** (§2a).

### 1c. loadConfig — Config Resolution

**`loadConfig` resolves its argument against `process.cwd()`; it does not search.** An omitted
argument means `assets.config.ts` in the current directory and nothing more — no walk up the tree,
and a run from a subdirectory does not find the root's config. Every app in the fleet passes
`--config` explicitly, so the fallback is effectively unused. **Prefer passing the path**: it is
the difference between a build whose inputs are stated and one whose inputs depend on where the
command was typed. [`BUILD_TOOLING.md`](./BUILD_TOOLING.md) §2h states the rule this is an instance of.

---

## 2. tooling/assets Pipeline

### 2a. Build Functions — Orchestration

| Function | Runs |
| --- | --- |
| `buildAll` | Every configured stage, in the order §4 fixes, then the generated module and `_headers` |
| `buildCSS` | One Tailwind CLI build per `css[]` entry, purging only that entry's own prior outputs |
| `buildJS` | One esbuild bundle per `js.bundles[]` entry, into that bundle's own `outdir` |
| `buildSprites` | One sheet per named sprite group, from its explicit `sources[].files` list |
| `copyAssets` | Each `copy[]` rule, `from` → `to` |
| `buildFonts`, `buildIcons`, `buildCursors` | The font downloads, the rasterised icon outputs, the baked cursor values |

Signatures live in `src/tooling/assets/README.md`; none of these takes the whole config — each takes its
own slice plus an output directory.

**There is no glob.** A sprite group names every file it contains: a `sources[].path` (a
directory or an `http(s)` base) and a `files` list of bare names or `{ key, file }` pairs. A
missing local file is a warning and a skipped symbol, not a failure, and a group producing no
symbols writes nothing. The consequence is the point — the symbol set is stated in the config,
so the glyph-name union generated from it (§4) changes only when a human edits that list, where
a glob would let a file appearing on disk silently widen a published type.

`buildAll` is the standard entry for CI and `package.json` scripts. The per-stage functions exist
because the CLI exposes each as its own subcommand, so a developer can rerun one stage alone.

### 2b. Hash and Change Detection

Content hashing is one SHA-256 digest truncated to its first 8 hex characters, and it is
**opt-in with `--minify`**: an unhashed build emits logical filenames and the manifest maps each
key to itself. Hashes are taken from the _emitted_ file, not its sources, so an output that
compiles to identical bytes keeps its URL — and the `_headers` file `buildAll` writes claims
`immutable` only when hashing was on.

**The `_headers` rule path is `paths.publicPrefix`, not a literal.** `emitHeaders` normalises the
prefix exactly as `createManifest` does — one trailing slash stripped, so `"/"` degrades to `/*` —
because the build-time cache rule and the runtime manifest URL are the same path and a
disagreement between them is invisible: the build stays green and the only symptom is a
cache-miss rate in production.

**The incremental-state helpers in `src/tooling/assets/state.ts` are published but unused by the
pipeline.** No forge build path calls them, and `buildAll` re-runs every configured stage
unconditionally. Their contract is a state file the _consumer_ names — forge bakes in no path
and writes no build state of its own. What makes a repeat build cheap for the one artifact that
matters is the skip-if-identical write in §4, not stored hashes.

### 2c. The Namespace Orchestrates Builders and Is Not One

**`src/assets` drives external builders; a module that computes the artifact itself does not
belong to it.** The stages §2a lists are shells around the Tailwind CLI, esbuild, a font download
and a file copy — each one resolves config, shells out, and reports. That is the whole warrant for the
build-time exemption [`LIBRARY_ARCHITECTURE.md`](../warden/canon/libs/LIBRARY_ARCHITECTURE.md) §1d grants,
and [`LIBRARY_ARCHITECTURE.md`](../warden/canon/libs/LIBRARY_ARCHITECTURE.md) §1e states that exemption as
**reachability**, not as a path glob: no Worker-executed entry point reaches these modules.

Reachability cuts both ways. It is what admits a Node-API shell into `src/assets`, and it is also
what declines to admit an algorithm merely because it happens to run at build time. A module that
computes rather than orchestrates has no external tool behind it, so nothing about `src/assets`
explains why it lives there — only that it was written during a build stage.

**The compute half now lives under `src/ui/assets/build/`**, where the artifact each module produces
is already the subject of the surrounding namespace — `color.ts` most plainly, since
`ui/contracts/theme/color.ts` already owns the same arithmetic (§2b of
[`THEME_GENERATION.md`](./THEME_GENERATION.md)). It carries its own `./ui/assets/build` subpath rather
than sitting behind `./ui/assets`, so a Node-API import cannot reach a consumer who took the parent
barrel for runtime-safe.

`sprites.ts` split rather than moved whole: `svgToSymbol` and its sanitizer compute and went with the
rest, while `buildSprites` — which fetches, hashes, writes and renames — is orchestration and stayed.
Moving it would have made `ui/assets/build` and `assets/build` name each other at value.

**The routing question for anything new: does this drive an external builder, or is it one?**
Drives one → `src/tooling/assets`. Is one → the namespace that owns the artifact.

A shrink-only exempt list was considered and deferred: it would make `config/steps.ts` a fourth
writer for a rule the sentence above already enforces.

---

## 3. assets — the Runtime Namespace

### 3a. createManifest — Content-Hashed Paths

**`createManifest(data, prefix)` reads nothing.** It takes the logical-to-emitted mapping as a
plain record plus a URL prefix, and returns a `Manifest` whose single method is
`path(key) => string`. No filesystem, no directory listing — which is what makes it legal in a
Worker at all: the mapping is baked into the generated module at build time (§4) and the runtime
only looks up. That module exports one `assets` instance, so views import it rather than
constructing a manifest of their own.

An unmapped key resolves to itself under the prefix rather than throwing. An unhashed dev build
has no mapping to speak of, and a missing entry must degrade to the logical URL — a 404 a
developer can read — rather than a 500 on a page that merely referenced a new file.

### 3b. createSpriteRegistry — Sprite Sheet URL Lookup

**`createSpriteRegistry(sprites, manifest)` resolves a sprite _group name_ to that sheet's
public URL** — `get(name) => string`, delegating to `manifest.path`. It parses no SVG and knows
nothing about symbols; an unknown group name **throws**, because a sprite URL that silently
resolves to nothing renders every glyph on the page as an empty `<use>`.

Symbol-level data has two other homes: the per-symbol `viewBox` is generated into the `*_META`
const at build time (§4), and a glyph's inner markup at runtime is
`@y-core/forge/ui/assets/glyphs` (`src/ui/README.md`).
---

## 4. Generated Assets Module

**The build's real product is a TypeScript file.** `buildAll` and `forge assets gen types` both end by
writing one module — carrying the manifest mapping, one `viewBox` const per sprite group, one
bound icon component per group, and the glyph-name union those components are typed on.
Everything the runtime knows about the build, it knows by importing that module; nothing reads the
output directory. `src/tooling/assets/README.md` owns how to author against it.

**The path is `.forge/assets.ts` unless `--out` overrides it, and the directory is git-ignored.**
Every content hash in it churns on each production build, so committing it would put a file no
human edits into every diff and would let a stale copy typecheck green against assets absent from
the current build. A consuming app aliases it as `@assets` and regenerates it with
`forge assets gen types`.

### 4a. The Ordered Stages and the Two Codegen Passes

**`src/tooling/assets/pipeline.ts` owns the stage sequence** and is authoritative over it. Two
properties of the order are decisions rather than incidents:

- **Codegen runs twice, before and after `buildJS`.** esbuild resolves the `@assets` alias while
  bundling, so a bundle importing the manifest needs the module to _already exist_ — the first
  pass exists solely to make the second pass's inputs bundleable. The second pass then rewrites it
  with the JS bundle keys the first pass could not know.
- **Cursors run after CSS.** Baking a cursor value means reading the emitted stylesheet for the
  custom properties it resolved, so the CSS stage must have produced a file the manifest can name.

The first pass is why a _clean_ checkout still typechecks: `forge assets gen types` (§4b) writes the
same module from the config alone, so `tsc` never depends on a toolchain having run.

### 4b. Build and Types Artifacts Are Shape-Identical

`generateAssetsModule` is one template with a swappable header, and both entry points go through
it: `buildAll` passes `BUILD_HEADER`, `generateAssetsTypes` passes `TYPES_HEADER` and a manifest
synthesised from the config with every value a placeholder — each logical name mapped to itself
and every `viewBox` the empty string.

**The invariant is that the two artifacts differ only in values, never in shape** — same exports,
same group consts, same `createIcon` calls, same union members. It has to hold, because a
typecheck run against the types-only artifact is asserting about the build artifact, and a shape
difference would let a green typecheck ship against a module the build emits differently. The
headers keep a human from mistaking one for the other: the types-only header says in plain words
that every path is unhashed and every `viewBox` empty.

**The write is skipped when the content is byte-identical.** Codegen compares against the file on
disk and returns without writing, so an unchanged build does not touch the mtime — which is what
keeps the twice-per-build codegen from retriggering every watcher, typechecker, and dev server
downstream of it.

**`gen types` is non-destructive, and the shape identity is what makes it so.** Both commands write
the same path, and the gate runs `gen types` on every verify — so without a guard the cheap artifact
replaces a real build and every hashed URL 404s. Because the two artifacts differ only in values,
"does this build artifact still fit the config?" is answerable: blank every emitted value in each
(`structuralSignature`) and compare. Equal means the build artifact is current, and `gen types`
keeps it. Unequal — an added bundle, a renamed sprite target, a new glyph, a changed prefix — means
the module on disk describes a config that has moved on, and rewriting it as a types artifact is the
correct outcome: a stale build must not be pinned in place of one the config can still be
typechecked against. `buildAll` is unaffected; a build always writes.

**The guard keeps `gen types` from degrading the manifest; `validate-asset-manifest` catches it
being ahead of the tree for any other reason** — a `public/` nobody rebuilt, a pruned hashed output,
a hand-edited artifact. The check asserts one thing: every `DATA` value resolves to a file under
`publicDir`. A types-only artifact passes a fast run, because its identity paths deliberately do not
exist — that is what lets `tsc` run on a clean checkout — and fails a `standard` or `full` run,
where a green on an artifact nobody built is the 404 it exists to prevent.

### 4c. The Emitted Glyph Union — the ForgeIcon Seam

Per sprite group, codegen emits a **glyph-name union** — `${Pascal}IconName`, whose members are
the group's symbol keys with the group's prefix stripped — alongside the `*_META` const and the
`${Pascal}Icon` component bound to it. The union is derived from the same `meta` keys
`createIcon` narrows its `name` prop against, so the two cannot disagree.

**It exists to be usable in type position.** `createIcon` already infers the narrow component
type at the _value_ site, but a consumer writing a props interface — `icon: ForgeIcon<G>` — needs
the union as a name it can spell. Without one it hand-maintains a literal union beside the sprite
config, a second copy of the glyph list that drifts the first time a glyph is added. `ForgeIcon`
declares no default for its parameter, so the widening a missing union invites does not compile
([`CODE_REVIEW.md`](./CODE_REVIEW.md) §3b).

Forge's own glyph list is a separate fact with its own owner: `src/ui/assets/glyphs.ts`
enumerates it as `ForgeUiIconName`, because forge's components must name the glyphs they require
without depending on any consumer's generated module.
