---
title: Per-Request Context Accessors
description: "Reading Workers env and executionCtx off a request context, carrying your own values between middleware and handlers, and checking bindings."
audience: consumer
---

# `@y-core/forge/context`

Every handler and middleware in a forge app is handed a `RequestContext` from `@remix-run/fetch-router` — a thin object around the request, with a
stringly-keyed store hanging off it. This namespace is how you read the Workers state forge put on it, and how you put your own values there without
inventing keys.

```ts
import { contextVar, getAppContext, type AppContext } from "@y-core/forge/context";
```

It runs only where a request does: inside the Worker, never in browser code.

---

## Getting started

`getAppContext` narrows the context you were handed to an `AppContext`, which is the same object plus typed `env`, `executionCtx` and `config`. Pass
your bindings interface as the type argument and the rest follows.

```ts
import { getAppContext } from "@y-core/forge/context";
import type { RequestContext } from "@y-core/forge/context";

interface Bindings {
  CSRF_SECRET: string;
  SESSIONS: KVNamespace;
}

async function handler(context: RequestContext) {
  const c = getAppContext<Bindings>(context);

  c.env.CSRF_SECRET; // typed binding
  c.executionCtx.waitUntil(auditLog(c.request)); // work that outlives the response
  c.config; // the app config `createApp` resolved
  return new Response(c.url.pathname);
}
```

The call is an assertion as much as a cast: it throws if forge never injected per-request state, rather than handing back a context whose `env` is
`undefined`. What else is safe to read off `c` — and the rule that a response is built with the `http` helpers rather than by hand — is
[`ROUTING_AND_MIDDLEWARE.md`][ram-5d] §5d's.

---

## Carrying a value from middleware to a handler

Authentication resolves a user; a handler downstream needs it. `contextVar` mints one accessor that owns both ends of that slot, so the key and its
type cannot drift apart and no caller has to remember a string.

```ts
import { contextVar } from "@y-core/forge/context";

export const userCtx = contextVar<User>("user");

// in the auth middleware
userCtx.set(context, user);

// in a handler that requires it
const user = userCtx.get(context, "Authentication middleware must run first");

// in a handler that renders differently when signed out
const maybeUser = userCtx.getOptional(context);
```

**Choosing between `get` and `getOptional` is choosing what absence means.** `get` treats an unset slot as a bug and throws, so use it where an
earlier middleware was supposed to guarantee the value; the optional message argument is what the next developer will read when it did not run.
`getOptional` treats absence as an answer and returns `undefined` — that is the right call whenever "nobody set this" is a state your code handles.

Export the accessor rather than the key, and read a slot only through its accessor. Forge namespaces do the same — `requestIdCtx` from `security`,
`csrfTokenCtx` from `form` — and reaching for one of those instead of minting your own is [`ROUTING_AND_MIDDLEWARE.md`][ram-4a] §4a's rule, with the
one-accessor-per-slot rule in §4b. `createContextKey<T>()` is re-exported for the rare middleware that must hold the raw key itself.

---

## Refusing to serve a request against a broken binding

`validateBindings` builds a middleware that checks `env` against a valibot schema on the first request and again whenever the env reference changes,
throwing if the shape is wrong. `bindingSchema` writes that schema for one binding, `bindingSetSchema` for a whole set in one pass.

```ts
import { bindingSetSchema, validateBindings } from "@y-core/forge/context";

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

`methods` is what makes it a **shape** check: the named binding must carry every method listed, so a string where a KV namespace belongs fails even
though the key is present. `label` completes the failure message — `LOGS_KV must be a KV namespace binding`.

**`optional: true` relaxes presence and never shape.** Mark a binding optional when the code is written to run without it — a log channel, a rate
limiter — and never when it is security-critical; [`STORAGE_BINDINGS.md`][sb-4b] §4b owns that rule along with where the middleware is registered,
and the storage namespaces' `validateKVBinding` / `validateD1Binding` / `validateR2Binding` are thin wrappers over this one.

Outside a request — a script, a test, a bootstrap path where you already hold the raw env — `validateEnv(env, schema)` runs the same check once and
returns the typed env.

---

## Gotchas

**`getAppContext` throws outside the forge request chain.** The message names `provideRequestState`, which is what a unit test calling a handler
with a hand-built `RequestContext` is missing — reach for `createTestContext` from [`src/testing/README.md`][testing-readme] instead. An empty
bindings object counts as present, so a context built with `{}` satisfies the assertion.

**A binding failure is a throw, not a `Result`.** A malformed environment is a deployment error rather than a runtime condition a handler could
recover from ([`FORGE_ERRORS.md`][fe-5e] §5e), and the message carries the field and the reason but never the rejected value.

---

## See also

- [`docs/ROUTING_AND_MIDDLEWARE.md`][ram-4] §4 — why this is a public subpath, and what it is the canonical home of
- [`docs/STORAGE_BINDINGS.md`][sb] — the resolve-then-validate pattern the storage namespaces build on `validateBindings`
- [`src/app/README.md`][app-readme] — `createApp`, which injects the per-request state `getAppContext` asserts on, and where the binding middleware
  sits in the global chain
- [`src/config/README.md`][config-readme] — the typed config that arrives on `c.config`
- [`src/testing/README.md`][testing-readme] — `createTestContext`, which builds a context carrying the state `getAppContext` requires

[app-readme]: ../app/README.md
[config-readme]: ../config/README.md
[fe-5e]: ../../docs/FORGE_ERRORS.md#5e-startup-invariants--env-validation-and-binding-resolvers-throw
[ram-4]: ../../docs/ROUTING_AND_MIDDLEWARE.md#4-context-namespace
[ram-4a]: ../../docs/ROUTING_AND_MIDDLEWARE.md#4a-contextvar-typed-accessor
[ram-5d]: ../../docs/ROUTING_AND_MIDDLEWARE.md#5d-the-appcontext-surface
[sb]: ../../docs/STORAGE_BINDINGS.md
[sb-4b]: ../../docs/STORAGE_BINDINGS.md#4b-registering-binding-checks
[testing-readme]: ../testing/README.md
