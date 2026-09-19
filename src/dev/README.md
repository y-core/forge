---
title: The Development Allowance
description: "A branded token a development entry point mints, and production cannot: the one key every dev-only relaxation in forge takes."
audience: consumer
---

# `@y-core/forge/dev`

Some things forge refuses in production are reasonable locally — a rate limiter with no binding, an error page that prints the real message. Rather
than a boolean per relaxation that a production config could set by accident, forge takes one **token**, and only a development entry point can mint
it.

```ts
import { devAllowance, type DevAllowance } from "@y-core/forge/dev";
```

**This subpath is dev-only, and the gate knows it.** `package.json` declares it under `forge.devOnly`, and `validate-dev-boundary` fails any
deployable module that imports it at value — so the mint is reachable from `src/worker.dev.ts` and nowhere a `wrangler deploy` bundles. The _type_
is exempt, because a type is erased at emit: a production option may name `DevAllowance` freely and still be unable to construct one.

---

## Getting started

Mint once, in the development entry, and thread the token through:

```ts
// src/worker.dev.ts — the only file in the application that imports this subpath at value.
import { devAllowance } from "@y-core/forge/dev";

import { createWorker } from "./worker-factory";

export default createWorker({
  dev: devAllowance({ rateLimitOptional: true, errorDetail: true, extraOrigins: ["https://localhost:8787"] }),
});
```

The production entry calls the same factory and passes no token, so every relaxation stays shut:

```ts
// src/worker.ts
export default createWorker({});
```

A module that only threads the token names the type and imports nothing at value:

```ts
import type { DevAllowance } from "@y-core/forge/dev";

export interface WorkerOptions {
  dev?: DevAllowance;
}
```

---

## Choosing what to relax

Every field is optional and every one is off when absent — an allowance granting nothing relaxes nothing. Grant the narrowest set that makes local
work possible:

| Grant | What opens |
| --- | --- |
| `rateLimitOptional` | `rateLimit` skips enforcement when its binding is absent, instead of answering 503 ([`SECURITY_HARDENING.md`][sh-4b] §4b) |
| `missingFetchMetadata` | `checkCrossOriginProtection` accepts a request carrying no `Sec-Fetch-Site` header, instead of failing closed |
| `errorDetail` | `createErrorPage` prints the thrown message instead of a fixed sentence |
| `turnstileTestingSecrets` | `verifyTurnstile` skips the hostname comparison, and only under one of Cloudflare's published testing secrets ([`INPUT_VALIDATION.md`][iv-4a] §4a) |
| `extraOrigins` | `deriveAllowedOrigins` appends these origins to the derived set ([`SECURITY_HARDENING.md`][sh-3f] §3f) |

The options are copied at mint time, so editing your object afterwards grants nothing more.

---

## Gotchas

**A token cannot be forged outside this module.** `DevAllowance` carries a `unique symbol` the module does not export, so no object literal written
anywhere else satisfies it — minting one means importing `devAllowance`, which is exactly the import the gate looks for.

**This namespace holds no development behaviour** — a token and an option shape, and nothing else. Each relaxation lives in the namespace owning
its concern (`security`, `app`, `form`) ([`NAMESPACES.md`][namespaces-5i] §5i).

**It is not the only dev-only subpath.** `@y-core/forge/testing` and `@y-core/forge/tooling/*` are declared dev-only beside it, and the same check
forbids the same import.

**It is not a substitute for a deliberate production opt-out.** Where a relaxation is legitimate in production it stays an explicit literal a grep
finds, in the idiom `csrfProtection({ subject: false })` uses ([`INPUT_VALIDATION.md`][iv-3a] §3a). The token is for the ones that are not.

---

## See also

- [`docs/NAMESPACES.md`][namespaces-5i] §5i — why a relaxation is a grant here rather than a boolean on the production option

[iv-3a]: ../../docs/INPUT_VALIDATION.md#3a-csrfprotection-middleware--guard-mutating-routes
[iv-4a]: ../../docs/INPUT_VALIDATION.md#4a-verifyturnstile--cloudflare-turnstile-captcha
[namespaces-5i]: ../../docs/NAMESPACES.md#5i-dev--a-dev-only-allowance-never-a-boolean-on-a-production-option
[sh-3f]: ../../docs/SECURITY_HARDENING.md#3f-deriving-allowedorigins-in-dev
[sh-4b]: ../../docs/SECURITY_HARDENING.md#4b-the-dev-allowance-for-a-missing-binding
