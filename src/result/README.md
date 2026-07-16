# `@y-core/forge/result`

A tiny, dependency-free utility for explicit, type-safe error handling. It is forge's
**single result primitive**: one discriminated-union `Result` type with one failure
field (`error`), the `ok()` / `err()` value-constructors, a `result()` wrapper that
captures any throw as data, a `toError()` helper for coercing unknown thrown values,
and two domain aliases (`GuardResult`, `ValidationResult`).

```ts
import {
  ok,
  err,
  result,
  toError,
  type Result,
  type GuardResult,
  type ValidationResult,
} from "@y-core/forge/result";
```

## Features

- **One `Result<T, E>` primitive** — success carries `data`, failure carries `error`. There is exactly one failure field; a single `if (!r.ok)` guard narrows the type with no casts.
- **`ok()` / `err()` constructors** — the sanctioned value-constructors: `ok()` for a passing `void` result, `ok(data)` for a success, `err(error)` for a failure. Prefer them to hand-written object literals so the discriminant and field names stay uniform.
- **`result()` wrapper** — runs a sync function, an async function, or a bare promise and turns any throw or rejection into `{ ok: false, error }`. No `try/catch` at the call site.
- **`toError()` coercion** — converts any thrown value (string, number, object, `undefined`, `null`) into a real `Error` instance, safe for `catch (err: unknown)` blocks.
- **`GuardResult<R>` alias** — `Result<void, R>` for predicate/authorization checks (origin, CSRF, Turnstile); the machine-readable reason code lives in `.error`.
- **`ValidationResult<T>` alias** — `Result<T, readonly string[]>`; the failure branch carries the per-field message list as `error: readonly string[]`. Produced by `@y-core/forge/validation` functions and `defineAction`'s `validate` hook.
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

### Building results with `ok()` and `err()`

When you construct a result by hand (rather than wrapping a throw with `result()`),
use the `ok()` / `err()` constructors. `ok()` with no argument produces a passing
`Result<void>`; `ok(data)` carries a value; `err(error)` carries the failure:

```ts
import { ok, err, type Result } from "@y-core/forge/result";

function parsePort(raw: string): Result<number, string> {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? ok(n) : err("port must be a positive integer");
}
```

`ok` / `err` are the only sanctioned value-constructors — a documented exception to
forge's `create*` factory-naming rule, because they construct **values**, not
configured objects (the naming follows the neverthrow convention).

### Guard checks with `GuardResult`

`GuardResult<R>` is `Result<void, R>` — the shape for predicate/authorization checks
that produce no success value. The success arm is `void`; the reason code lives in
`.error`. Build a passing check with `ok()` and a failing one with `err(reason)`:

```ts
import { ok, err, type GuardResult } from "@y-core/forge/result";

type OriginReason = "missing" | "disallowed";

function verifyOrigin(origin: string | null, allowed: string[]): GuardResult<OriginReason> {
  if (!origin) return err("missing");
  if (!allowed.includes(origin)) return err("disallowed");
  return ok();
}

const r = verifyOrigin(request.headers.get("Origin"), allowed);
if (!r.ok) {
  // r.error: OriginReason — server-log only; never echo the reason to clients
  return new Response("Forbidden", { status: 403 });
}
```

### Working with `ValidationResult`

Validation functions return `ValidationResult<T>` (`Result<T, readonly string[]>`),
whose failure branch carries the per-field message list as `error: readonly string[]`.
Surface all of them at once:

```ts
import { ok, err, type ValidationResult } from "@y-core/forge/result";

function validateContact(input: unknown): ValidationResult<Contact> {
  const messages: string[] = [];
  // ...collect per-field messages...
  if (messages.length > 0) return err(messages);
  return ok(input as Contact);
}

const r = validateContact(form);
if (!r.ok) {
  // r.error: readonly string[] — e.g. ["Email is required", "Name is too long"]
  return renderErrors(r.error);
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
automatically inside the guard. There is exactly **one** failure field — `error`;
the domain aliases below reuse it rather than introducing new fields.

### `ok(data?)` and `err(error)`

```ts
function ok(): Result<void, never>;
function ok<T>(data: T): Result<T, never>;
function err<E>(error: E): Result<never, E>;
```

The sanctioned value-constructors. `ok()` with no argument builds a passing
`Result<void>` (e.g. a passing `GuardResult`); `ok(data)` builds a success carrying
`data`; `err(error)` builds a failure carrying `error`. Use them instead of writing
`{ ok: true, data }` / `{ ok: false, error }` object literals so the discriminant and
field names stay uniform across the codebase.

| Function | Parameter | Returns |
|---|---|---|
| `ok` | — | `{ ok: true, data: undefined }` typed `Result<void, never>`. |
| `ok` | `data: T` | `{ ok: true, data }` typed `Result<T, never>`. |
| `err` | `error: E` | `{ ok: false, error }` typed `Result<never, E>`. |

### `GuardResult<R>`

```ts
type GuardResult<R = string> = Result<void, R>;
//  ≡ { ok: true; data: void } | { ok: false; error: R };
```

A domain alias of `Result` for predicate/authorization checks (origin, CSRF,
Turnstile) that produce no success value. The success arm is `void`; the failure
channel carries a machine-readable reason code in `.error` — typically a
string-literal union (e.g. `"missing" | "disallowed"`). The reason is for server
diagnostics only; never surface it to clients.

| Type parameter | Default | Description |
|---|---|---|
| `R` | `string` | The reason-code type carried in `error` on failure. |

### `ValidationResult<T>`

```ts
type ValidationResult<T> = Result<T, readonly string[]>;
//  ≡ { ok: true; data: T } | { ok: false; error: readonly string[] };
```

A domain alias of `Result` for validation. The failure branch carries the per-field
message list as `error: readonly string[]` — a list of already-formatted,
human-readable field messages, so a UI can surface every failing field at once.
Produced by `@y-core/forge/validation` functions and `defineAction`'s `validate` hook.

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
