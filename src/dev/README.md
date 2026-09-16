---
title: The Development Allowance
description: "A branded token a development entry point mints, and production cannot: the one key every dev-only relaxation in forge takes."
audience: consumer
---

# `@y-core/forge/dev`

One token, and the option shape behind it. `devAllowance()` mints a `DevAllowance` — the key every relaxation forge is willing to grant a developer
demands, and the only thing that can open one.

```ts
import { devAllowance, type DevAllowance, type DevAllowanceOptions } from "@y-core/forge/dev";
```

**This subpath is dev-only, and the gate knows it.** `package.json` declares it under `forge.devOnly`, and `validate-dev-boundary` fails any
deployable module that imports it at value — so the mint is reachable from `src/worker.dev.ts` and from nowhere a `wrangler deploy` bundles. The
_type_ is exempt, because a type is erased at emit: a production option may name `DevAllowance` freely, and still be unable to construct one.

---

## Features

- **Unforgeable outside this module** — `DevAllowance` carries a `unique symbol` this module does not export, so no object literal written anywhere
  else satisfies it. Minting one means importing `devAllowance`, which is exactly the import the gate is looking for.
- **One token, every relaxation** — an entry mints once and threads the same token through each middleware, instead of spreading four independent
  booleans across a shared module both entries import.
- **Two layers, not one** — the type makes a relaxation unrepresentable without the token, and `validate-dev-boundary` rule C makes the import that
  mints one a gate failure outside a development entry. A `{} as DevAllowance` cast defeats the first; the second still fails the import the cast
  exists to avoid, and the cast itself is greppable.
- **Opt-out, never default** — every field is optional and every one is off when absent. An allowance granting nothing relaxes nothing.

---

## Usage

### Minting one, in the development entry

```ts
// src/worker.dev.ts — the only file in the application that imports this subpath at value.
import { devAllowance } from "@y-core/forge/dev";

import { createWorker } from "./worker";

export default createWorker({
  dev: devAllowance({
    rateLimitOptional: true,
    missingFetchMetadata: true,
    errorDetail: true,
    turnstileTestingSecrets: true,
    extraOrigins: ["https://localhost:8787"],
  }),
});
```

### Taking one, in shared code

The production entry calls the same `createWorker` and passes no token, so every relaxation below stays shut:

```ts
// src/worker.ts
import { createWorker } from "./worker-factory";

export default createWorker({});
```

A module that threads the token names the type, and imports nothing at value:

```ts
import type { DevAllowance } from "@y-core/forge/dev";

export interface WorkerOptions {
  dev?: DevAllowance;
}
```

---

## API

### `devAllowance(options)`

Mints the allowances a development entry grants. The options are copied, so a later edit of the caller's object grants nothing more.

| Option | Type | Grants |
| --- | --- | --- |
| `rateLimitOptional` | `true` | `rateLimit` skips enforcement when its binding is absent, instead of answering 503 ([`SECURITY_HARDENING.md`][sh-4b] §4b). |
| `missingFetchMetadata` | `true` | `checkCrossOriginProtection` accepts a request carrying no `Sec-Fetch-Site` header, instead of failing closed. |
| `errorDetail` | `true` | `createErrorPage` prints the thrown message instead of a fixed sentence. |
| `turnstileTestingSecrets` | `true` | `verifyTurnstile` skips the hostname comparison — and only under one of Cloudflare's three published testing secrets ([`INPUT_VALIDATION.md`][iv-4a] §4a). |
| `extraOrigins` | `string[]` | `deriveAllowedOrigins` appends these origins to the derived set ([`SECURITY_HARDENING.md`][sh-3f] §3f). |

**Types:** `DevAllowance`, `DevAllowanceOptions`.

---

## What this namespace is not

**Not a place for development behaviour.** It owns a token and an option shape, and holds no middleware, no fake binding and no rendering. The
relaxations themselves stay in the namespace that owns each concern — `security`, `app`, `form` — which is why `dev` is a leaf with no edge out.

**Not the only dev-only subpath.** `@y-core/forge/testing` (fake bindings) and `@y-core/forge/tooling/*` (the command layer and the gate) are
declared dev-only beside it, and the same check forbids the same import.

**Not a substitute for a deliberate production opt-out.** Where a relaxation is legitimate in production it stays an explicit literal a grep finds,
in the idiom `csrfProtection({ subject: false })` uses ([`INPUT_VALIDATION.md`][iv-3a] §3a). The token is for the ones that are not.

[iv-3a]: ../../docs/INPUT_VALIDATION.md#3a-csrfprotection-middleware--guard-mutating-routes
[iv-4a]: ../../docs/INPUT_VALIDATION.md#4a-verifyturnstile--cloudflare-turnstile-captcha
[sh-3f]: ../../docs/SECURITY_HARDENING.md#3f-deriving-allowedorigins-in-dev
[sh-4b]: ../../docs/SECURITY_HARDENING.md#4b-the-dev-allowance-for-a-missing-binding
