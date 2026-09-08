---
title: Library Architecture
description: "Structural principles: the dependency facade, the runtime-only no-build-step constraint, demand composition, and the Web-APIs-only rule."
---

# Library Architecture

> Owns forge's structural principles — how it is layered, why it ships raw TypeScript, and the
> constraints that keep it portable across Workers runtimes.
>
> Defers to: [`NAMESPACES.md`](./NAMESPACES.md) §4 for the leaf/integration
> classification and the namespace catalog; [`CODE_RULES.md`](../warden/canon/libs/CODE_RULES.md)
> for the coding rules; `tsconfig.json` for the compiler configuration.

---

## 0. Quick Reference

- §1 Core Architectural Principles: the four structural commitments
- §2 Namespace Dependency Tiers: pointer to the owning classification
- §3 Runtime-Only Library Constraints: what shipping raw TS requires
- §3a No Build Step in the Gate: the library is always consumed as source
- §3b TypeScript Configuration Constraints: what source and test files see
- §3c Peer Dependencies for Build Tools: esbuild and sharp are optional
- §3d CSS Source Scanning Stops at `ui/`: what a consumer's Tailwind build must be told
- §4 Facade Pattern Implementation: how a facade namespace is written
- §4a Re-export Rules for Facade Namespaces: expose what consumers need
- §4b Breaking the Facade: the sanctioned way to add an export
- §5 Demand Composition in Practice: assembly at the consumer
- §6 Cloudflare Workers Runtime Model: the module-scope constraints
- §7 Pre-1.0 API Evolution: no shim, no compatibility path, and how a breaking change ships instead

---

## 1. Core Architectural Principles

See [`LIBRARY_ARCHITECTURE.md`](../warden/canon/libs/LIBRARY_ARCHITECTURE.md) §1 for the four structural
principles — facade over dependencies, runtime-only, demand composition, Web-APIs-only — and
[`LIBRARY_ARCHITECTURE.md`](../warden/canon/libs/LIBRARY_ARCHITECTURE.md) §1e for why the build-time
exemption is reachability rather than a path glob. What forge wraps, and which of its namespaces
are wholly build-time, is §3 and §4 below.

---

## 2. Namespace Dependency Tiers

See [`NAMESPACE_DESIGN.md`](../warden/canon/libs/NAMESPACE_DESIGN.md) §3 for the leaf/integration split.
forge's membership is declared in `config/namespaces.ts` and explained in
[`NAMESPACES.md`](./NAMESPACES.md) §4.

---

## 3. Runtime-Only Library Constraints

### 3a. No Build Step in the Gate

**There is no build step in `bun run verify`** — the library is always consumed as raw TS.
[`TESTING.md`](./TESTING.md) §6 owns the gate.

### 3b. TypeScript Configuration Constraints

`tsconfig.json` owns the `lib` and `types` configuration. The decision it encodes: **no `@types/*`
is auto-included, and source files see the standard Web-API libs and nothing else**, so a Node or
Bun global is a type error rather than a portability bug found at deploy time. Test files reach
`bun:test` through a hand-written stub instead of a package — [`TESTING.md`](./TESTING.md) §1b owns
that rule and the reason.

### 3c. Peer Dependencies for Build Tools

`esbuild`, `sharp` and `tailwindcss` are **optional peer dependencies** for the `tooling/assets`
pipeline. None is in the main dependency tree — only apps that build assets need them, and none is
ever imported by runtime source, so none reaches a Worker bundle.

**A tool the pipeline shells out to is a peer dependency, declared.** `buildCSS` runs
`execFileSync("tailwindcss", …)` exactly as `buildJS` runs `esbuild` and the image step runs
`sharp`; the three are one category. Nothing _imports_ `tailwindcss`, which is exactly how such a
requirement escapes declaration — but an undeclared requirement does not stop being one, it only
stops being checked, and it surfaces as a `command not found` mid-build where `bun install` should
have warned.

Declaring it also makes forge's own palette **readable**. Tailwind v4 ships its default theme as
CSS (`tailwindcss/theme.css`, `--color-red-700: oklch(…)`), which is what lets the contrast audit
resolve the status hues rather than pinning a human's measurement of them
(`src/tooling/gate/checks/contrast.ts`, pointed at that stylesheet by `config/steps.ts`). That capability is a
consequence of the declaration, not its justification — the declaration was owed either way.

### 3d. CSS Source Scanning Stops at `ui/`

See [`LIBRARY_ARCHITECTURE.md`](../warden/canon/libs/LIBRARY_ARCHITECTURE.md) §3d for why a scanner
never reaches `node_modules`, why the source paths are written relative to the stylesheet, and why
the scope stops at the component tier. Here the scanner is Tailwind, the stylesheet is `forge.css`,
the paths are `@source` directives, and the component tier is `ui/`.

**The scope is enforced in both directions, and the coverage direction is the one that catches
drift.** A directory under `src/ui/` whose files declare a utility class must be scanned or
explicitly registered as class-free — a new component directory added without either fails the gate
rather than shipping classes no consumer build generates. The other direction refuses an `@source`
path resolving outside `src/ui/`, and a namespace outside `ui/` that declares a class string must
instead document the `@source` requirement in its own README. `src/tooling/gate/checks/css-sources.ts`
owns all three, derived from disk, so none is a list to keep in step.

---

## 4. Facade Pattern Implementation

### 4a. Re-export Rules for Facade Namespaces

When a namespace wraps a third-party package:

- **Export only what consumers actually need.**
- **Never re-export the entire third-party namespace.**
- **Name exports by forge convention**, not the third party's naming quirks.

`src/validation/mod.ts` exposes exactly two symbols — `v` and the `ValidationResult` type —
never the raw valibot surface.

Two facades are deliberately **thin pass-throughs** whose forge-authored surface is minimal:

- **`router`** re-exports the fetch-router and route-pattern engine verbatim; its only
  forge-authored surface is the `routePaths` / `RouteFilter` introspection pair.
- **`http/headers`** is a **pure re-export** of `@remix-run/headers` — the typed header classes
  and their `*Init` types, with no forge-authored logic.

**Both still obey the facade rule**: consumers import from `@y-core/forge/{router,http}`, never
from `@remix-run/*`.

### 4b. Breaking the Facade

See [`LIBRARY_ARCHITECTURE.md`](../warden/canon/libs/LIBRARY_ARCHITECTURE.md) §4c for the procedure
and the ban on reaching into `node_modules`. Here the barrel to add the export to is the namespace's
`mod.ts`, and the gate step that answers is `validate-exports`.

---

## 5. Demand Composition in Practice

See [`LIBRARY_ARCHITECTURE.md`](../warden/canon/libs/LIBRARY_ARCHITECTURE.md) §5 for demand composition at
the consumer and the ban on namespace aggregators. The subpaths an app composes from are
catalogued in [`NAMESPACES.md`](./NAMESPACES.md) §3a.

---

## 6. Cloudflare Workers Runtime Model

See [`LIBRARY_ARCHITECTURE.md`](../warden/canon/libs/LIBRARY_ARCHITECTURE.md) §6 for the isolate model, the
module-scope prohibitions, and the rule that a `waitUntil` promise must cover every piece of work
its function started. Runtime background and worked examples are in `src/app/README.md`.

---

## 7. Pre-1.0 API Evolution

**Before v1.0.0, forge ships no deprecation shim and no backward-compatible path.** A renamed export
is renamed; a removed one is removed; a changed signature changes. There is no alias left behind, no
`@deprecated` re-export, and no dual code path that accepts both the old shape and the new one.

**A published shim is unrecoverable.** Once a consumer depends on it, removing it is itself a
breaking change — which is precisely what a pre-1.0 version number exists to avoid. The shim
therefore does not defer the break; it doubles it, and the second one lands after the version number
has stopped warning anybody.

**What ships instead is the signal.** A commit altering or removing a published export carries the
`minor:` subject prefix, so the version number moves and the surface guard is answered rather than
silenced ([`BUILD_TOOLING.md`](./BUILD_TOOLING.md) §2j). Consumers pin codeload tarballs at a tag, so
nobody is upgraded without choosing to; the changelog entry written in the same commit is what tells
them what changed.

**This expires at 1.0.0, and not before.** After that the same rule reads differently — a breaking
change becomes a `major:` and the question of a migration path is open on its own merits. Until
then, the absence of shims is what keeps the surface small enough to reach 1.0 at all.
