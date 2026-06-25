# `@y-core/forge/context`

Per-request context utilities for `@remix-run/fetch-router` on Cloudflare Workers. This namespace turns the framework's stringly-keyed `RequestContext` into a set of **type-safe accessors** and exposes the Workers `env` / `executionCtx` through a single, loudly-failing `AppContext` seam.

```typescript
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

```typescript
import { getAppContext } from "@y-core/forge/context";

interface Bindings {
  CSRF_SECRET: string;
}

function handler(context) {
  const c = getAppContext<Bindings>(context);

  c.env.CSRF_SECRET;            // typed Workers binding
  c.executionCtx.waitUntil(p);  // defer async work past the response
  c.request;                    // the standard Request
  c.url.pathname;               // parsed URL
}
```

`getAppContext` asserts the Forge router has already injected per-request state. If the handler ran outside the Forge chain, it throws rather than returning a context with a missing `env`:

```typescript
// Throws: "getAppContext: per-request state is not available — the Forge router
// must inject request state (provideRequestState) before this handler runs."
getAppContext(rawContext);
```

An empty bindings object (`{}`) counts as present — only a never-injected context throws.

### Custom per-request variables

Use `contextVar` to store request-scoped values with a typed accessor instead of raw `get`/`set`:

```typescript
import { contextVar } from "@y-core/forge/context";

interface User {
  id: string;
}

const userCtx = contextVar<User>("user");

// In an auth middleware:
userCtx.set(context, { id: "u_123" });

// In a downstream handler:
const user = userCtx.get(context);          // throws if unset
const maybe = userCtx.getOptional(context); // undefined if unset
```

Pass a custom message to `get` to override the default "not set" error:

```typescript
const user = userCtx.get(context, "Authentication middleware must run first");
```

### Explicit keys for middleware authors

When you need direct control over the key (rather than the `contextVar` accessor pair), create one with `createContextKey` and use the context's native `get`/`set`:

```typescript
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
|---|---|---|
| `context` | `RequestContext` | The raw context received by a handler or middleware. |

| Type parameter | Default | Description |
|---|---|---|
| `Bindings` | `Record<string, unknown>` | Shape of the Workers `env` bindings. |
| `Params` | `Record<string, string>` | Route parameter shape. |
| `Config` | `unknown` | App config shape carried on the context. |

**Returns** `AppContext<Bindings, Params, Config>`. **Throws** if per-request state was never injected.

### `AppContext<Bindings, Params, Config>`

Extends `RequestContext<Params>` with Workers-specific, read-only properties. Available on any context once the app router has injected per-request state.

| Property | Type | Description |
|---|---|---|
| `env` | `Bindings` | The Workers `env` bindings. |
| `executionCtx` | `ExecutionContext` | The Workers execution context (`waitUntil` / `passThroughOnException`). |
| `config` | `Config` | App-level config carried on the context. |
| `request` | `Request` | Inherited from `RequestContext` — the standard `Request`. |
| `url` | `URL` | Inherited from `RequestContext` — the parsed request URL. |

### `contextVar<T>(name)`

Creates a typed accessor for a per-request variable, binding the key and value type into one source of truth.

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Label used in the default "not set" error message. |

**Returns** a `ContextVar<T>`:

| Member | Signature | Description |
|---|---|---|
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

### Types

| Type | Description |
|---|---|
| `ContextVar<T>` | The accessor pair returned by `contextVar` (`get` / `set` / `getOptional` / `key`). |
| `ContextKey<T>` | Opaque key type for context-variable storage. |
| `Middleware` | Standard middleware type (re-exported from `@remix-run/fetch-router`). |
| `RequestHandler` | Standard route handler type (re-exported from `@remix-run/fetch-router`). |
