---
title: Typed Environment Configuration
description: "Maps raw Worker bindings to a validated config object that resolves on first access and caches per env object."
audience: consumer
---

# `@y-core/forge/config`

Raw Worker bindings arrive as a flat bag of strings with no shape and no guarantees. This namespace maps that bag into a structured object,
validates the result, and caches it — so a malformed environment fails at the edge with a path-qualified error instead of surfacing as `undefined`
deep inside a handler.

Reach for it when a value comes from the environment and the rest of your code should see it typed.

```ts
import { createConfig, env, optionalGroup, registerConfig, resolveConfig, retrieveConfig } from "@y-core/forge/config";
```

---

## Getting started

Define a config once at module scope: an **env mapping** on the left, a schema on the right. Read it inside a handler from the Workers `env`.

```ts
import { createConfig, env } from "@y-core/forge/config";
import { v } from "@y-core/forge/validation";

export const emailConfig = createConfig(
  { apiKey: env("RESEND_API_KEY"), fromAddress: env("EMAIL_FROM") },
  v.object({ apiKey: v.string(), fromAddress: v.pipe(v.string(), v.email()) }),
);

// Inside a loader, action, or middleware:
const { apiKey, fromAddress } = emailConfig.get(c.env);
```

`env("RESEND_API_KEY")` is a reference, not a read — it resolves to `rawEnv.RESEND_API_KEY` when `get` runs. A bare string in the mapping is used
verbatim, which is how a literal default sits beside a binding.

**Build every holder through `createConfig`.** The `Config` constructor is private, so `new Config(…)` is not available.

---

## Choosing where a value belongs

A production app has two layers, and they have different owners. Getting a value into the wrong one is the most common mistake here.

| Layer | Owns | Written by |
| --- | --- | --- |
| Bindings and vars — `KVNamespace`, `R2Bucket`, secrets | `wrangler.jsonc` | generated, never by hand |
| App config — site settings, feature flags, service groups | this namespace | you |

**Layer 1 is generated because `wrangler.jsonc` already is the source of truth.** `forge cf gen env` emits `env.schema.ts` from it, and
`validateBindings(EnvSchema)` enforces the result on the first request. Wire the generator as a script and re-run it when bindings change:

```ts
// src/app/env.config.ts — hand-written policy, optional
import type { GenOptions } from "@y-core/forge/tooling/cf";
export const options: Partial<GenOptions> = {
  optional: new Set(["RATE_LIMITER"]),
  refinements: { SESSION_SECRET: { minLength: 32 } },
};
```

Layer 2 — the `Config` stores below — then consumes already-validated vars. It is where mapping, shaping and caching happen, and it never re-checks
that a binding exists.

---

## Grouping related variables

Mappings nest, so a config can carry structure the environment does not.

```ts
const siteConfig = createConfig(
  { site: { name: env("SITE_NAME"), debug: env("DEBUG") }, email: { from: env("EMAIL_FROM") } },
  v.object({
    site: v.object({ name: v.string(), debug: v.pipe(v.string(), v.transform((s) => s === "true")) }),
    email: v.object({ from: v.pipe(v.string(), v.email()) }),
  }),
);

const { site, email } = siteConfig.get(c.env);
```

---

## Turning an integration off until it is configured

An analytics or email integration that is half-configured is worse than one that is off. `optionalGroup` collapses a whole block to `null` when a
required key is absent, so the calling code branches once on `null` rather than checking each field.

```ts
import { optionalGroup } from "@y-core/forge/config";

const schema = v.object({
  analytics: optionalGroup({ siteId: v.string(), host: v.string() }, { required: ["siteId"], defaults: { host: "analytics.example.com" } }),
});

// SITE_ID set    → { siteId, host: "analytics.example.com" }
// SITE_ID absent → null
```

The choice you are making is which keys make the integration _viable_: `required` names those, `"all"` requires every key, and `defaults` fills the
rest. A key that is neither required nor defaulted is still validated — declare it `v.optional(…)` if it may legitimately be absent, and make sure
each `defaults` value satisfies its own entry schema.

---

## Patching config for development

Pass `overrides` to rewrite the resolved config when a detector matches. `detect` reads the raw env; `patch` transforms the **already-validated**
config, so an override can never smuggle a value past the schema.

```ts
const config = createConfig(
  { apiUrl: env("API_URL") },
  v.object({ apiUrl: v.string() }),
  { detect: (rawEnv) => rawEnv.DEV === "true", patch: (cfg) => ({ ...cfg, apiUrl: "http://localhost:8787" }) },
);
```

---

## Sharing a store without importing it

`registerConfig` and `retrieveConfig` associate a store with any host object through a module-private `WeakMap`. A module can then read config **by
reference**, which is how `createApp({ config })` and `applyAssets` reach the app's config without importing it.

```ts
registerConfig(hostObject, emailConfig);

// Elsewhere — no import of `emailConfig` needed.
const cfg = resolveConfig(retrieveConfig<EmailCfg>(hostObject), c.env);
```

`resolveConfig` tolerates a missing store, returning `{}` cast to the config type — which is what makes it the natural pairing for `retrieveConfig`,
whose result may be `undefined`. Entries are garbage-collected with their host, so there is no unregister.

`InferConfig<E>` extracts the resolved type from a record carrying a `Config` field, for code that reads config off an env-shaped object.

---

## Testing against config

`seed` injects a fixed config and skips env resolution entirely; `reset` clears it.

```ts
beforeEach(() => emailConfig.reset());

it("uses the seeded value", () => {
  emailConfig.seed({ apiKey: "test-key", fromAddress: "noreply@example.com" });
  expect(emailConfig.get({}).apiKey).toBe("test-key");
});
```

**Cases that pass different `env` objects need no `reset()` between them** — see the caching rule below. Call `reset()` to clear a `seed()`, or to
force re-resolution for the same `env`.

---

## Gotchas

**Resolution is cached per distinct `env` object, not once per process.** The cache is a `WeakMap` keyed on `env` identity: each distinct `env`
resolves once, and a different `env` resolves independently. There is no first-env-wins behaviour, and the cache lives as long as the V8 isolate
rather than a request — which is correct on Workers, where bindings are stable per isolate.

**`optionalGroup` strips undeclared keys.** A group is projected out of an `env` carrying many unrelated bindings, so only keys named in `entries`
reach the parsed config.

**A schema failure throws; it does not return a `Result`.** A malformed environment is a deployment error, not a runtime condition a handler can
recover from.

---

## See also

- [`src/app/README.md`][app-readme] — `validateBindings` and `validateEnv`, which enforce layer 1 on the first request
- [`src/validation/README.md`][validation-readme] — the schema facade every config is parsed through
- [`docs/SOURCE_OF_TRUTH.md`][sot-2f] §2f — why this README, and not a `docs/` document, owns the rulings above

[app-readme]: ../app/README.md
[sot-2f]: ../../docs/SOURCE_OF_TRUTH.md#2f-the-prose-rows
[validation-readme]: ../validation/README.md
