# `@y-core/forge/result`

A tiny, dependency-free utility for explicit, type-safe error handling. It replaces
ad-hoc `try/catch` and `null | T` return shapes with a discriminated-union `Result`
type, plus a `result()` wrapper that captures any throw as data and a `toError()`
helper for coercing unknown thrown values.

```ts
import { result, toError, type Result, type ValidationResult } from "@y-core/forge/result";
```

## Features

- **Discriminated-union `Result<T, E>`** — success carries `data`, failure carries `error`. A single `if (!r.ok)` guard narrows the type with no casts.
- **`result()` wrapper** — runs a sync function, an async function, or a bare promise and turns any throw or rejection into `{ ok: false, error }`. No `try/catch` at the call site.
- **`toError()` coercion** — converts any thrown value (string, number, object, `undefined`, `null`) into a real `Error` instance, safe for `catch (err: unknown)` blocks.
- **`ValidationResult<T>`** — a specialization whose failure branch carries an array of messages (`errors: string[]`) instead of a single `error`. Produced by `@y-core/forge/validation` functions and `defineAction`'s `validate` hook.
- **Synchronous error preservation** — `result()` returns the failure variant synchronously for sync throws and a `Promise` for async work; existing `Error` instances pass through unwrapped.

## Usage

### Wrapping a synchronous operation

`result()` runs the function and captures any throw. Narrow the union with one
guard before touching `data`:

```ts
import { result } from "@y-core/forge/result";

const r = result(() => new URL(input));
if (!r.ok) {
  return new Response(r.error.message, { status: 400 });
}
const url = r.data; // type-narrowed to URL — no cast needed
```

### Wrapping async work

When passed an async function or a bare promise, `result()` returns a
`Promise<Result<T, E>>`. `await` it, then narrow as usual:

```ts
import { result } from "@y-core/forge/result";

// async function
const a = await result(async () => fetchRemote(id));
if (!a.ok) {
  return new Response("Upstream unavailable", { status: 502 });
}
const payload = a.data;

// bare promise
const b = await result(fetch("https://example.com"));
if (!b.ok) {
  console.error(b.error.message);
}
```

### Chaining fallible steps

Return early on each failure rather than nesting. This keeps the happy path at
the left margin:

```ts
import { result } from "@y-core/forge/result";

const parsed = result(() => JSON.parse(raw));
if (!parsed.ok) return parsed; // propagate the failure

const validated = result(() => schema.parse(parsed.data));
if (!validated.ok) return validated;

return { ok: true as const, data: validated.data };
```

### Coercing an unknown thrown value

In a `catch` block, `err` is typed `unknown`. Use `toError()` to get a guaranteed
`Error` with a sensible `message`:

```ts
import { toError } from "@y-core/forge/result";

try {
  doRiskyThing();
} catch (err) {
  const e = toError(err); // always an Error
  log.error(e.message);
}
```

`toError()` leaves existing `Error` instances untouched and wraps everything else
with `new Error(String(thrown))`:

| Thrown value | `toError(...).message` |
|---|---|
| `new Error("boom")` | `"boom"` (same instance returned) |
| `"oops"` | `"oops"` |
| `404` | `"404"` |
| `{ code: 1 }` | `"[object Object]"` |
| `undefined` | `"undefined"` |
| `null` | `"null"` |

### Working with `ValidationResult`

Validation functions return `ValidationResult<T>`, whose failure branch holds a
flat list of human-readable messages. Surface all of them at once:

```ts
import type { ValidationResult } from "@y-core/forge/result";

function validateContact(input: unknown): ValidationResult<Contact> {
  const errors: string[] = [];
  // ...collect per-field messages...
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: input as Contact };
}

const r = validateContact(form);
if (!r.ok) {
  // r.errors: string[] — e.g. ["Email is required", "Name is too long"]
  return renderErrors(r.errors);
}
const contact = r.data;
```

## Core Components & APIs

### `Result<T, E>`

```ts
type Result<T, E = Error> =
  | { ok: true; data: T }
  | { ok: false; error: E };
```

A discriminated union representing the outcome of a fallible operation. Use it as
the return type for any function that can fail in a predictable way — never return
`null | T` or throw for expected failures.

| Type parameter | Default | Description |
|---|---|---|
| `T` | — | Type of the success payload, available as `data` when `ok` is `true`. |
| `E` | `Error` | Type of the failure payload, available as `error` when `ok` is `false`. |

Always check `r.ok` before accessing `r.data` or `r.error`; the union narrows
automatically inside the guard.

### `ValidationResult<T>`

```ts
type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };
```

A specialization of `Result` for validation. The failure branch carries an array
of already-formatted, human-readable field messages instead of a single `error`,
so a UI can surface every failing field at once. Produced by
`@y-core/forge/validation` functions and `defineAction`'s `validate` hook.

| Type parameter | Description |
|---|---|
| `T` | Type of the parsed, validated value on success. |

### `result(arg)`

Runs `arg` and returns a `Result`, capturing any throw or rejection as the failure
variant. Overloaded by the shape of `arg`:

```ts
function result<T, E = Error>(fn: () => T): Result<T, E>;
function result<T, E = Error>(fn: () => Promise<T>): Promise<Result<T, E>>;
function result<T, E = Error>(promise: Promise<T>): Promise<Result<T, E>>;
```

| Parameter | Type | Description |
|---|---|---|
| `arg` | `() => T` | Sync function — returns `Result<T, E>` synchronously. |
| `arg` | `() => Promise<T>` | Async/promise-returning function — returns `Promise<Result<T, E>>`. |
| `arg` | `Promise<T>` | A bare promise — returns `Promise<Result<T, E>>`. |

Behavior:

- A returned value becomes `{ ok: true, data }`.
- A thrown value or rejected promise becomes `{ ok: false, error }`, with the
  thrown value coerced via `toError()`.
- Falsy values (`0`, `""`, `false`) are treated as success — only an actual throw
  or rejection produces the failure branch.
- Existing `Error` instances pass through to `error` unwrapped.

### `toError(thrown)`

```ts
function toError(thrown: unknown): Error;
```

Coerces any thrown value into an `Error` instance. Returns `thrown` unchanged if it
is already an `Error`; otherwise returns `new Error(String(thrown))`. Safe to use
in `catch (err)` blocks where `err` is `unknown`.

| Parameter | Type | Description |
|---|---|---|
| `thrown` | `unknown` | The caught value to normalize into an `Error`. |

## Related

- [`@y-core/forge/validation`](../validation) — produces `ValidationResult<T>` values.
- [`@y-core/forge/http`](../http) — `renderValidationErrors`, `renderError`, `fragmentResponse` for turning results into HTMX fragments.
- `.decisions/ERROR_HANDLING.md` — the governing error-handling doctrine (error taxonomy, fail-closed posture, router error boundary).
