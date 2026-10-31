---
title: Development Relaxations for an App
description: "Giving an app's own code a development-only behaviour that `forge cf dev` arms and a deploy never bundles."
audience: consumer
---

# `@y-core/forge/relax`

Some of your own code should behave differently while you develop: a debug banner, a live-reload hash in the CSP, a local tooling origin. This
namespace is how that code knows it is running in a build `forge cf dev` armed, so the development behaviour stays out of every deployed Worker.

```ts
import { isDevBuildArmed, whenArmed } from "@y-core/forge/relax";
```

Import it only from a `*.dev.ts` module. A Worker built without `forge cf dev` cannot resolve it.

---

## Getting started

Your app has one relaxation alias, `#app/relax`, backed by one pair of files. Map it in your `package.json`:

```json
{
  "imports": {
    "#app/relax": {
      "forge-dev": "./src/app/relax.dev.ts",
      "default": "./src/app/relax.strict.ts"
    }
  }
}
```

The strict file holds the production answer:

```ts
// src/app/relax.strict.ts
export const debugBanner = (): string | undefined => undefined;
```

The dev file wraps it. `whenArmed` answers with the relaxed function in an armed build and with the strict one otherwise:

```ts
// src/app/relax.dev.ts
import { isDevBuildArmed, whenArmed } from "@y-core/forge/relax";

import { debugBanner as strictDebugBanner } from "./relax.strict";

export const developmentBanner = (): string => "development build";

export const debugBanner: typeof strictDebugBanner = whenArmed(isDevBuildArmed, developmentBanner, strictDebugBanner);
```

Shared code imports the alias, never either file:

```ts
import { debugBanner } from "#app/relax";
```

Run the app with `forge cf dev` ([`src/tooling/cf/README.md`][cf-local]). A deploy resolves `default`, so the dev file never reaches the bundle.

---

## Adding another relaxation

Add an export to both files of the pair. Do not add a second alias or a second pair of files: one pair is the list of everything a development
build loosens ([`NAMESPACES.md`][ns-5i] §5i).

**Annotate each dev export with `typeof` its strict twin.** `bun check` types the code importing `#app/relax` against the `default` target
only, so a dev export that changed shape would go unnoticed. A dev export that is missing altogether fails the `forge cf dev` build with esbuild's
`No matching export`, never the deploy, so add both halves together.

---

## Testing a relaxation

`bun test` resolves `@y-core/forge/relax`, and nothing in a test run arms it, so a test of `src/app/relax.dev.ts` sees the strict answer. Export the
relaxed function by name and call it directly to test the development behaviour:

```ts
// src/app/relax.dev.test.ts
import { describe, expect, it } from "bun:test";

import { debugBanner, developmentBanner } from "./relax.dev";

describe("debugBanner", () => {
  it("shows no banner in a run that does not arm the development build", () => {
    expect(debugBanner()).toBeUndefined();
  });
});

describe("developmentBanner", () => {
  it("names the development build", () => {
    expect(developmentBanner()).toBe("development build");
  });
});
```

---

## Gotchas

- **A plain `wrangler dev` answers strict.** Only `forge cf dev` both selects `relax.dev.ts` and arms it. A build that selects the dev file without
  arming it still gets the strict answer.
- **Importing `@y-core/forge/relax` from a production module fails twice.** `validate-dev-boundary` fails a value import of it outside a `*.dev.ts`
  ([`src/tooling/gate/README.md`][gate-preset]), and a Worker built without `forge cf dev` fails to resolve it.
- **A fake binding is not a relaxation.** Stand one in with `@y-core/forge/testing` instead.

---

## See also

- [`docs/NAMESPACES.md`][ns-5i] §5i — why a development relaxation is a module the build selects, and why an app has one alias for it
- [`src/tooling/cf/README.md`][cf-local] — running the app under `forge cf dev`
- [`src/security/README.md`][security-dev] — a dev-only CSP source on the same pair

[cf-local]: ../tooling/cf/README.md#running-the-app-locally
[gate-preset]: ../tooling/gate/README.md#starting-from-a-preset
[ns-5i]: ../../docs/NAMESPACES.md#5i-dev-only-relaxations--a-relax-module-never-a-boolean-on-a-production-option
[security-dev]: ../security/README.md#keeping-dev-only-sources-out-of-the-production-policy
