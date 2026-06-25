# `@y-core/forge/config`

Typed, lazy environment configuration for Cloudflare Workers. Map raw Worker bindings to a structured,
validated config object that resolves **once** on first access and is cached for the lifetime of the
Worker instance.

```typescript
import { Config, env, optionalGroup, resolveConfig, registerConfig, retrieveConfig } from "@y-core/forge/config";
```

---

## Features

- **Declarative env mapping** — describe your config shape as a record of `env("VAR_NAME")` references
  and literals; `Config` reads `env[VAR_NAME]` at resolution time.
- **Runtime validation** — every config is parsed through a [valibot](https://valibot.dev) schema, so a
  malformed environment fails loudly with a path-qualified error instead of surfacing `undefined` deep
  in a handler.
- **Lazy, cached resolution** — `config.get(env)` resolves on first call and caches the result for the
  V8 isolate's lifetime (keyed by `env` identity). Subsequent calls are free.
- **Optional integration groups** — `optionalGroup` collapses an entire block of related vars to `null`
  when its required keys are absent, so optional integrations (analytics, email, etc.) stay off until
  fully configured.
- **Environment-aware overrides** — patch the resolved config when a detector matches (e.g. apply
  development defaults when a `DEV` flag is set).
- **Decoupled sharing** — `registerConfig` / `retrieveConfig` associate a `Config` store with any host
  object through a `WeakMap`, letting modules read config by reference without a shared import.
- **Test ergonomics** — `seed()` injects a fixed value bypassing env resolution; `reset()` restores
  lazy resolution between cases.

---

## Usage

Define a `Config` once at module scope by mapping env variables to a shape and validating that shape:

```typescript
import { Config, env } from "@y-core/forge/config";
import { v } from "@y-core/forge/validation";

const emailConfig = new Config(
  { apiKey: env("RESEND_API_KEY"), fromAddress: env("EMAIL_FROM") },
  v.object({ apiKey: v.string(), fromAddress: v.pipe(v.string(), v.email()) }),
);
```

Resolve it inside any handler from the Workers `env`. The first call validates and caches; later calls
return the cached value:

```typescript
// Inside a loader, action, or middleware with access to the Workers env.
const { apiKey, fromAddress } = emailConfig.get(c.env);
```

The first argument to `new Config(...)` is an **env mapping**: a record whose values are `env(name)`
references (read from the raw environment) or string literals (used verbatim). Mappings nest, so you can
group related variables:

```typescript
const siteConfig = new Config(
  {
    site: { name: env("SITE_NAME"), debug: env("DEBUG") },
    email: { from: env("EMAIL_FROM") },
  },
  v.object({
    site: v.object({ name: v.string(), debug: v.pipe(v.string(), v.transform((s) => s === "true")) }),
    email: v.object({ from: v.pipe(v.string(), v.email()) }),
  }),
);

const { site, email } = siteConfig.get(c.env);
```

---

## Core Components & APIs

### `class Config<ConfigData>`

A lazy singleton holder that resolves an env mapping through a schema and caches the result.

```typescript
new Config(map, schema, overrides?)
```

| Parameter | Type | Description |
|---|---|---|
| `map` | `EnvMapping` | A string literal, an `EnvRef` from `env(name)`, or a nested record of either. Describes how the raw environment maps into the config shape. |
| `schema` | `v.BaseSchema<unknown, ConfigData, …>` | A valibot schema that validates and types the mapped result. Resolution throws if it fails. |
| `overrides` | `ConfigOverrides<ConfigData>` _(optional)_ | A `{ detect, patch }` pair applied after validation when `detect(rawEnv)` returns `true`. |

| Method | Signature | Description |
|---|---|---|
| `get` | `(env: object) => ConfigData` | Resolves on the first call and caches the result for the isolate's lifetime. The `env` passed on the **first** call wins; later calls ignore their `env` and return the cached value. |
| `seed` | `(config: ConfigData) => void` | Test helper. Sets the cached value directly, bypassing env resolution. |
| `reset` | `() => void` | Test helper. Clears the cached value, restoring lazy resolution on the next `get()`. |

> The cache lives as long as the V8 isolate, **not** a single request — which is correct on Workers
> because bindings are stable per isolate. In tests that vary `env` across cases, call `reset()` (or
> `seed()`) between cases so the first resolution does not leak.

### `env(name)`

Creates an `EnvRef` — a marker that resolves to `rawEnv[name]` when the mapping is applied. Use it as a
mapping value wherever a config field should come from a Worker binding.

```typescript
env<K extends string>(name: K): EnvRef<K>
```

```typescript
const map = { apiKey: env("RESEND_API_KEY") };   // → { apiKey: rawEnv.RESEND_API_KEY }
```

### `optionalGroup(entries, options)`

Builds a valibot schema for an **optional** group of related fields. If any required key is absent
(`null`/`undefined`), the entire group resolves to `null` — ideal for integrations that should stay off
until fully configured. Present keys are validated against their per-field schemas, and `defaults` fill
in any missing optional keys.

```typescript
optionalGroup(entries, { required, defaults? })
```

| Parameter | Type | Description |
|---|---|---|
| `entries` | `Record<string, v.GenericSchema>` | Per-field valibot schemas for each key in the group. |
| `options.required` | `(keyof entries)[] \| "all"` | Keys that must be present. If any is absent, the whole group is `null`. `"all"` requires every key. |
| `options.defaults` | `Partial<Record<keyof entries, unknown>>` _(optional)_ | Default values for keys that are absent but not required. |

```typescript
import { optionalGroup } from "@y-core/forge/config";
import { v } from "@y-core/forge/validation";

const schema = v.object({
  analytics: optionalGroup(
    { siteId: v.string(), host: v.string() },
    { required: ["siteId"], defaults: { host: "analytics.example.com" } },
  ),
});

// SITE_ID set      → analytics resolves to { siteId, host: "analytics.example.com" }
// SITE_ID absent   → analytics resolves to null
```

### `resolveConfig(store, env)`

Resolves a `Config` store for the given `env`, tolerating a missing store. Returns `store.get(env)` when
a store is present, or an empty object cast to `T` when `store` is `undefined`. Pairs naturally with
`retrieveConfig`, which may return `undefined`.

```typescript
resolveConfig<T>(store: Config<T> | undefined, env: object): T
```

```typescript
const cfg = resolveConfig(retrieveConfig<EmailCfg>(host), c.env);
```

### `applyMapping(env, mapping)`

Resolves an env mapping directly against a raw environment record, **without** a `Config` store or schema
validation. Returns the structurally-mapped value: string literals pass through, `EnvRef`s read from
`env`, and nested records map recursively. Useful for one-off resolution or building a mapped object to
validate yourself.

```typescript
applyMapping(env: Record<string, unknown>, map: EnvMapping): unknown
```

```typescript
import { applyMapping, env } from "@y-core/forge/config";

const mapped = applyMapping(
  { RESEND_API_KEY: "sk_live_…", REGION: "eu" },
  { apiKey: env("RESEND_API_KEY"), region: env("REGION"), product: "mailer" },
);
// → { apiKey: "sk_live_…", region: "eu", product: "mailer" }
```

### `registerConfig(target, store)` / `retrieveConfig(target)`

Associate a `Config` store with any host object through a module-private `WeakMap`. This lets modules
expose and read config **by reference** without importing the store directly — the mechanism by which
`createApp({ config })` and `applyAssets` share the app's config.

```typescript
registerConfig(target: object, store: unknown): void
retrieveConfig<T>(target: object): Config<T> | undefined
```

```typescript
import { registerConfig, retrieveConfig, resolveConfig } from "@y-core/forge/config";

registerConfig(hostObject, emailConfig);

// Elsewhere — by reference only, no import of emailConfig needed.
const store = retrieveConfig<EmailCfg>(hostObject);
const cfg = resolveConfig(store, c.env);   // {} when no store was registered
```

Because the registry is a `WeakMap`, entries are garbage-collected with their host object; there is no
explicit unregister.

---

## Advanced

### Environment-aware overrides

Pass an `overrides` object to patch the resolved config when a detector matches the raw environment.
`detect` runs against the raw env, and `patch` transforms the already-validated config — so overrides
never bypass schema validation.

```typescript
const config = new Config(
  { apiUrl: env("API_URL"), debug: env("DEBUG") },
  v.object({ apiUrl: v.string(), debug: v.pipe(v.string(), v.transform((s) => s === "true")) }),
  {
    detect: (rawEnv) => rawEnv.DEV === "true",
    patch: (cfg) => ({ ...cfg, apiUrl: "http://localhost:8787" }),
  },
);
```

### Testing with `seed` and `reset`

`seed` injects a fixed config and skips env resolution entirely; `reset` clears the cache so the next
`get()` resolves lazily again. Reset (or re-seed) between cases that vary `env`, since the first
resolution is cached for the isolate's lifetime.

```typescript
import { describe, expect, it, beforeEach } from "bun:test";

beforeEach(() => emailConfig.reset());

it("uses the seeded value", () => {
  emailConfig.seed({ apiKey: "test-key", fromAddress: "noreply@example.com" });
  expect(emailConfig.get({}).apiKey).toBe("test-key");
});
```

### Inferring the resolved type

`InferConfig<E>` extracts the resolved config type from a record that carries a `Config` field. Use it to
type code that reads config off an env-shaped object.

```typescript
import type { InferConfig } from "@y-core/forge/config";

type AppConfig = InferConfig<{ Config: { site: { name: string } } }>;
// → { site: { name: string } }
```

---

## API Reference

| Export | Kind | Description |
|---|---|---|
| `Config` | class | Lazy, cached config holder built from an env mapping + valibot schema. |
| `env` | function | Creates an `EnvRef` that reads `rawEnv[name]` at resolution time. |
| `optionalGroup` | function | Valibot schema for an optional group that collapses to `null` when required keys are absent. |
| `applyMapping` | function | Resolves an env mapping directly, without a `Config` store or validation. |
| `resolveConfig` | function | Resolves a `Config` store for an `env`, returning `{}` when the store is `undefined`. |
| `registerConfig` | function | Associates a `Config` store with a host object via a `WeakMap`. |
| `retrieveConfig` | function | Retrieves the `Config` store previously associated with a host object. |
| `Config` (type) | — | See class above. |
| `ConfigContext<C>` | type | `{ config: C }` — the per-request variable set by the route config injector. |
| `ConfigDescriptor<ConfigData>` | type | `{ map, schema, overrides? }` — the internal descriptor a `Config` resolves through. |
| `ConfigOverrides<ConfigData>` | type | `{ detect, patch }` — environment-aware override pair. |
| `EnvMapping` | type | A string literal, an `EnvRef`, or a nested record of either. |
| `EnvRef<K>` | type | `{ readonly __env: K }` — a marker produced by `env(name)`. |
| `InferConfig<E>` | type | Infers the resolved config type from a record carrying a `Config` field. |
