---
title: The Result Primitive
description: "How to capture a throw as data, return a typed failure from your own code, and read the domain aliases forge's pipeline hands back."
audience: consumer
---

# `@y-core/forge/result`

An operation that can fail predictably returns its failure here instead of throwing it. This namespace is the type that shape is written in, plus
the constructors that build it. It touches no platform API, so it behaves the same in a Worker, a test, or a build script.

```ts
import { err, ok, result, toError, type GuardResult, type Result, type ValidationResult } from "@y-core/forge/result";
```

The contract — one failure field, never `null | T`, never a throw for an expected failure — is [`FORGE_ERRORS.md`][fe-1a] §1a's, and the aliases are
§1c's.

---

## Getting started

`result()` runs your function and hands back the outcome as a value. One `if (!r.ok)` guard narrows the union, and no cast is needed afterwards.

```ts
import { result } from "@y-core/forge/result";

const parsed = result(() => new URL(input));
if (!parsed.ok) {
  return new Response(parsed.error.message, { status: 400 });
}
const url = parsed.data; // URL
```

Hand it an async function or a bare promise and you get a promise back, so `await` moves to the front and nothing else changes.

```ts
const remote = await result(async () => fetchRemote(id));
if (!remote.ok) return new Response("Upstream unavailable", { status: 502 });

const response = await result(fetch("https://example.com"));
```

Anything thrown or rejected arrives on `error` as a real `Error`. Outside a `result()` wrapper — in a hand-written `catch`, where the caught value
is typed `unknown` — `toError()` performs the same coercion on its own.

```ts
try {
  doRiskyThing();
} catch (thrown) {
  log.error(toError(thrown).message);
}
```

---

## Returning a failure from your own function

When your code decides the failure rather than catching one, build the value with `ok()` and `err()`. `err(error)` carries whatever describes the
failure — an `Error`, a reason code, a message list.

```ts
import { err, ok, type Result } from "@y-core/forge/result";

function parsePort(raw: string): Result<number, string> {
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? ok(port) : err("port must be a positive integer");
}
```

Choosing `E` is the real decision. Leave it at the default `Error` when the caller will log or surface the message; make it a string-literal union
when the caller will branch on it, because that is the only version a `switch` can be exhaustive over.

A caller that cannot handle a failure returns it unchanged. Doing that at each step keeps the success path at the left margin instead of nesting.

```ts
const parsed = result(() => JSON.parse(raw));
if (!parsed.ok) return parsed;

const validated = validateContact(parsed.data);
if (!validated.ok) return validated;

return ok(validated.data);
```

---

## Reading the aliases a forge signature hands you

These aliases appear across forge's own signatures. They narrow `Result` rather than extending it, so the guard you already write is the whole API.

**`GuardResult<R>` comes back from a check that either passes or gives a reason** — origin, CSRF, Turnstile. There is no success value, so a passing
check is `ok()` and the reason lives on `.error`, typically as a string-literal union.

```ts
import { err, ok, type GuardResult } from "@y-core/forge/result";

function verifyOrigin(origin: string | null, allowed: string[]): GuardResult<"missing" | "disallowed"> {
  if (!origin) return err("missing");
  return allowed.includes(origin) ? ok() : err("disallowed");
}

const origin = verifyOrigin(request.headers.get("Origin"), allowed);
if (!origin.ok) return new Response("Forbidden", { status: 403 }); // log `origin.error`; never send it
```

**`ValidationResult<T>` is the alias you give your own input-parsing function.** Forge exports the type, not a helper that returns one: its `error`
is a `readonly string[]` of already-formatted field messages, so a UI can surface every failing field in one pass rather than one at a time.
`renderValidationErrors` from `@y-core/forge/http` takes that list directly.

```ts
const contact = validateContact(form);
if (!contact.ok) return fragmentResponse(renderValidationErrors(contact.error), 422);
```

---

## Gotchas

**Only a throw produces the failure branch.** `0`, `""`, `false`, `null` and `undefined` are all successes carried on `data` — `result()` has no
opinion about truthiness.

**A sync function stays sync.** `result(() => …)` returns the `Result` itself, not a promise, so `await`-ing it out of habit is harmless but
`if (!r.ok)` without the `await` on an async call silently tests a promise. The return type says which you have.

**`toError()` stringifies whatever it is given.** An `Error` passes through untouched; everything else becomes `new Error(String(thrown))`, which
turns a thrown plain object into the message `[object Object]`. Throw an `Error` when the message has to survive.

---

## See also

- [`docs/FORGE_ERRORS.md`][fe] — the governing doctrine: the primitive (§1a), the narrowing guard (§1b), the aliases (§1c), and which failures are
  expected, unexpected, or infrastructural (§5)
- [`src/http/README.md`][http-readme] — turning a failure into a response fragment
- [`src/validation/README.md`][validation-readme] — the schemas and issue formatting a `ValidationResult` of your own is usually built from

[fe]: ../../docs/FORGE_ERRORS.md
[fe-1a]: ../../docs/FORGE_ERRORS.md#1a-the-unified-result-primitive-okerr-result-and-toerror
[http-readme]: ../http/README.md
[validation-readme]: ../validation/README.md
