---
title: Per-Request Context Accessors
description: "Type-safe accessors over the framework's stringly-keyed request context, and the loudly-failing seam that exposes env and executionCtx."
audience: consumer
---

# `@y-core/forge/context`

Per-request context utilities for `@remix-run/fetch-router` on Cloudflare Workers. This namespace turns the framework's stringly-keyed `RequestContext` into a set of **type-safe accessors** and exposes the Workers `env` / `executionCtx` through a single, loudly-failing `AppContext` seam.

```ts
import { getAppContext, contextVar, type AppContext } from "@y-core/forge/context";
```

---

## Features

- **`AppContext` narrowing** — promote a bare `RequestContext` to a Workers-aware `AppContext<Bindings>` that exposes typed `env`, `executionCtx`, and `config`.
- **Fail-loud assertions** — `getAppContext` throws a clear error when per-request state was never injected, instead of silently yielding an `undefined env` that surfaces as a spooky error downstream.
- **Typed context variables** — `contextVar<T>` binds a key and its value type into one accessor, so `get` and `set` can never drift apart.
- **Explicit key management** — `createContextKey<T>` plus the `EnvKey` / `ExecutionContextKey` built-ins for middleware authors who manage keys directly.

---

## Usage

### Reading Workers state inside a handler

Handlers and middleware receive a `RequestContext`. Narrow it to an `AppContext` to read the typed Workers `env` and `executionCtx`:

```ts
import { getAppContext } from "@y-core/forge/context";

interface Bindings {
  CSRF_SECRET: string;
}

function handler(context) {
  const c = getAppContext<Bindings>(context);

  c.env.CSRF_SECRET; // typed Workers binding
  c.executionCtx.waitUntil(p); // defer async work past the response
  c.request; // the standard Request
  c.url.pathname; // parsed URL
}
```

`getAppContext` asserts the Forge router has already injected per-request state. If the handler ran outside the Forge chain, it throws rather than returning a context with a missing `env`:

```ts
// Throws: "getAppContext: per-request state is not available — the Forge router
// must inject request state (provideRequestState) before this handler runs."
getAppContext(rawContext);
```

An empty bindings object (`{}`) counts as present — only a never-injected context throws.

### Custom per-request variables

Use `contextVar` to store request-scoped values with a typed accessor instead of raw `get`/`set`:

```ts
import { contextVar } from "@y-core/forge/context";

interface User {
  id: string;
}

const userCtx = contextVar<User>("user");

// In an auth middleware:
userCtx.set(context, { id: "u_123" });

// In a downstream handler:
const user = userCtx.get(context); // throws if unset
const maybe = userCtx.getOptional(context); // undefined if unset
```

Pass a custom message to `get` to override the default "not set" error:

```ts
const user = userCtx.get(context, "Authentication middleware must run first");
```

### Explicit keys for middleware authors

When you need direct control over the key (rather than the `contextVar` accessor pair), create one with `createContextKey` and use the context's native `get`/`set`:

```ts
import { createContextKey } from "@y-core/forge/context";

const TraceKey = createContextKey<string>();

context.set(TraceKey, crypto.randomUUID());
const traceId = context.get(TraceKey);
```

---

## Core Components & APIs

### `getAppContext<Bindings, Params, Config>(context)`

Narrows a `RequestContext` to an `AppContext`, asserting that the Forge router injected per-request state (`env`, `executionCtx`, `config`) via `provideRequestState`. Reads `EnvKey` so it fails loudly with a clear message if state is absent.

| Parameter | Type | Description |
| --- | --- | --- |
| `context` | `RequestContext` | The raw context received by a handler or middleware. |

| Type parameter | Default | Description |
| --- | --- | --- |
| `Bindings` | `Record<string, unknown>` | Shape of the Workers `env` bindings. |
| `Params` | `Record<string, string>` | Route parameter shape. |
| `Config` | `unknown` | App config shape carried on the context. |

**Returns** `AppContext<Bindings, Params, Config>`. **Throws** if per-request state was never injected.

### `AppContext<Bindings, Params, Config>`

Extends `RequestContext<Params>` with Workers-specific, read-only properties. Available on any context once the app router has injected per-request state.

| Property | Type | Description |
| --- | --- | --- |
| `env` | `Bindings` | The Workers `env` bindings. |
| `executionCtx` | `ExecutionContext` | The Workers execution context (`waitUntil` / `passThroughOnException`). |
| `config` | `Config` | App-level config carried on the context. |
| `request` | `Request` | Inherited from `RequestContext` — the standard `Request`. |
| `url` | `URL` | Inherited from `RequestContext` — the parsed request URL. |

### `contextVar<T>(name)`

Creates a typed accessor for a per-request variable, binding the key and value type into one source of truth.

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | Label used in the default "not set" error message. |

**Returns** a `ContextVar<T>`:

| Member | Signature | Description |
| --- | --- | --- |
| `set` | `(context, value: T) => void` | Sets the value on the context for this request. |
| `get` | `(context, message?: string) => T` | Reads the value; throws if unset. `message` overrides the default error. |
| `getOptional` | `(context) => T \| undefined` | Reads the value; returns `undefined` if unset. |
| `key` | `ContextKey<T>` | The underlying typed key. |

### `createContextKey<T>(name?)`

Lower-level key factory re-exported from `@remix-run/fetch-router`. Used internally by `contextVar` and directly by middleware authors who want explicit key management. Pair it with the context's native `get`/`set`.

### `EnvKey`

The context key under which the raw Workers `env` bindings are stored. Reading it is how `getAppContext` detects whether per-request state has been injected.

### `ExecutionContextKey`

The context key under which the Workers `ExecutionContext` is stored.

### `RequestContext`

Re-exported from `@remix-run/fetch-router` — the base context type every handler and middleware receives. A thin wrapper over the standard `Request`.

### `validateEnv<T>(env, schema)`

Parses `env` against a valibot schema, returning the validated output or throwing
`Invalid environment: <field>: <reason>; …`. The rejected value never appears in the message.

### `validateBindings(schema)`

Builds a `Middleware` that runs `validateEnv` on the first request, and again whenever the `env`
reference changes. Register it with `app.use("*", …)` **before** `app.map(...)`, so no request is
served against a broken binding. The storage namespaces' `validateKVBinding` / `validateDBBinding` /
`validateR2Binding` are thin wrappers over it.

### `bindingSchema(name, methods, label, options?)`

The schema for one binding: the named key must carry every method in `methods`, or the failure reads
`<name> must be <label>`. It is a **shape** check — a value present but of the wrong shape always
fails.

`options.optional` relaxes presence only: an absent binding passes, a present one of the wrong shape
still fails. Use it for a binding the code is written to survive without — a KV log channel, a rate
limiter — never for one that is security-critical.

```ts
app.use("*", validateBindings(bindingSchema("LOGS_KV", ["get", "put"], "a KV namespace binding", { optional: true })));
```

### `bindingSetSchema(specs)`

The same, for several bindings in one pass, so an app registers one middleware rather than one per
binding. Each `BindingSpec` is `{ name, methods, label, optional? }`, and both forms build from the
same entry so a required and an optional binding cannot diverge.

```ts
app.use(
  "*",
  validateBindings(
    bindingSetSchema([
      { name: "DB", methods: ["prepare"], label: "a D1 database binding" },
      { name: "LOGS_KV", methods: ["get", "put"], label: "a KV namespace binding", optional: true },
    ]),
  ),
);
```

### Types

| Type | Description |
| --- | --- |
| `BindingSpec` | One binding's declared shape: `name`, `methods`, `label`, and `optional`. |
| `ContextVar<T>` | The accessor pair returned by `contextVar` (`get` / `set` / `getOptional` / `key`). |
| `ContextKey<T>` | Opaque key type for context-variable storage. |
| `Middleware` | Standard middleware type (re-exported from `@remix-run/fetch-router`). |
| `RequestHandler` | Standard route handler type (re-exported from `@remix-run/fetch-router`). |

---

## See also

- [`ROUTING_AND_MIDDLEWARE.md`](../../docs/ROUTING_AND_MIDDLEWARE.md) — why `context` is a public
  subpath and what it is the canonical home of (§4), the rule that a namespace publishes its own
  accessor rather than letting consumers invent slots (§4a), the one-accessor-per-slot rule (§4b),
  and what a handler reads from `c` (§5d).
- [`STORAGE_BINDINGS.md`](../../docs/STORAGE_BINDINGS.md) — the resolve/validate binding pattern the
  storage namespaces build on `validateBindings`.
- [`@y-core/forge/app`](../app/README.md) — `createApp`, which injects the per-request state
  `getAppContext` asserts on.
