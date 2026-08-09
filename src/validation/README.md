# `@y-core/forge/validation`

Schema validation for forge apps, built on [valibot](https://valibot.dev). The namespace re-exports the entire valibot API under a single `v` import, adds a small set of forge's own schema and issue helpers beside it, carries the `ValidationResult<T>` result type used across forge's request pipeline, and ships a Cloudflare env-schema code generator (`forge-cfgen`) under the `/cli` sub-path.

| Import path | Surface |
|---|---|
| `@y-core/forge/validation` | `v` (valibot namespace), `strictObject`, `formText`, `formMultilineText`, `describeValidationIssue`, `formatValidationIssues`, `ValidationResult` |
| `@y-core/forge/validation/cli` | `forge-cfgen` env-schema generator API (also a `bin`) |

**Everything except `v` is a sibling of it, not a member.** `strictObject` and `v.strictObject` are two different functions, and the one without the prefix is the recommendation for untrusted input.

---

## Features

- **Single valibot entry point** — `v` is the complete valibot namespace re-exported as one import, so every app uses the same pinned valibot version and never deep-imports the upstream package.
- **`strictObject`** — the strict object schema to use for anything parsing untrusted input. Only a field the schema actually declares counts as declared, so an undeclared key is refused rather than silently dropped, for **every** key a caller can send.
- **Form-text primitives** — `formText()` for a single-line control and `formMultilineText()` for a `<textarea>`. A form body reaches a schema exactly as submitted, so trimming and CRLF folding are the schema's job; these are the two shapes worth having.
- **Bounded issue descriptions** — `describeValidationIssue` names the field one issue is about and nothing else, so a refusal a caller reads cannot carry the submitted value, the schema's own rule, or a length the caller chose. `formatValidationIssues` is the internal diagnostic counterpart.
- **`ValidationResult<T>`** — a domain alias of forge's one `Result` primitive, `Result<T, readonly string[]>` (`{ ok: true; data: T } | { ok: false; error: readonly string[] }`), the canonical return type for any service that validates its own input.
- **`forge-cfgen` env-schema generator** — reads `wrangler.jsonc` bindings and `.dev.vars` keys and emits a committed, schema-first valibot `EnvSchema` (plus an inferred `type Env`), replacing the env half of `wrangler types`.

---

## `@y-core/forge/validation`

### Usage

Declare the schema with `strictObject` and the form-text primitives, parse untrusted input with `v.safeParse`, and convert the result into a `ValidationResult` at the system boundary.

```typescript
import {
  describeValidationIssue,
  formMultilineText,
  formText,
  strictObject,
  v,
  type ValidationResult,
} from "@y-core/forge/validation";

const ContactSchema = strictObject({
  name: v.pipe(formText(), v.minLength(2)),
  email: v.pipe(formText(), v.email()),
  message: v.pipe(formMultilineText(), v.minLength(10)),
});

type ContactInput = v.InferOutput<typeof ContactSchema>;

function validateContact(fields: unknown): ValidationResult<ContactInput> {
  const result = v.safeParse(ContactSchema, fields, { abortEarly: true });
  if (!result.success) {
    // `describeValidationIssue`, not `issue.message` — the message embeds the rejected value.
    return { ok: false, error: result.issues.map(describeValidationIssue) };
  }
  return { ok: true, data: result.output };
}
```

Inspect `result.ok` before reading `data`:

```typescript
const outcome = validateContact(rawFields);
if (!outcome.ok) {
  // outcome.error: readonly string[] — the field names that failed
  return;
}
// outcome.data: ContactInput — typed, validated
sendContact(outcome.data);
```

A route on `defineAction` (from `@y-core/forge/app`) writes none of this: it hands the same `ContactSchema` to the pipeline, which reads the body, parses with `abortEarly`, and renders the refusal through `describeValidationIssue` itself. Write a function like the one above for a **service** that validates its own input, or for a handler outside that pipeline.

### Core Components & APIs

#### `v` — valibot namespace

`v` is the entire valibot namespace re-exported under one name. Use `v.object(...)`, `v.string()`, `v.pipe(...)`, `v.email()`, `v.minLength()`, `v.safeParse(...)`, `v.InferOutput<...>`, and every other valibot primitive, action, and combinator through this prefix. Never import `valibot` directly — `v` guarantees the forge-pinned version and avoids dual-package conflicts.

```typescript
import { v } from "@y-core/forge/validation";

const schema = v.object({ count: v.pipe(v.number(), v.minValue(0)) });
const result = v.safeParse(schema, { count: 3 }); // { success, output | issues }
```

`v.safeParse(schema, value, config?)` returns a valibot result (`success`/`output`/`issues`), not a `ValidationResult`. Pass `{ abortEarly: true }` to stop at the first issue (typical for field-level form errors); omit it to collect every issue. An enumerating refusal is one a caller can lengthen by adding fields, so choose it deliberately.

#### `strictObject(entries, message?)`

```typescript
function strictObject<TEntries extends v.ObjectEntries>(
  entries: TEntries,
  message?: v.ErrorMessage<v.StrictObjectIssue>,
): v.StrictObjectSchema<TEntries, …>;
```

A strict object schema in which only a field the schema *actually declares* counts as declared. Use it in place of `v.strictObject` for anything parsing untrusted input — a request body above all.

```typescript
import { strictObject, v } from "@y-core/forge/validation";

const ContactSchema = strictObject({ name: v.string(), email: v.pipe(v.string(), v.email()) });
```

The difference is the declared-key test. Valibot answers "is this key declared?" by looking the name up on the schema's entries object, and on an ordinary object literal that lookup reaches inherited members — so a caller sending `__proto__`, `constructor`, `toString`, `valueOf` or any other inherited name reads as declared for *any* schema and is dropped from the parsed output instead of being refused. That is the one case where the unknown-key guarantee would not hold, and `strictObject` closes it for the whole class of names at once, with no branch naming any of them.

The correction is applied **at construction**, so it survives composition: the property holds when the schema is nested in another object, wrapped in `v.pipe`, or used as a `v.union` / `v.variant` option. A patch applied to a finished schema would not.

> A schema written with raw `v.strictObject` keeps the original behaviour. This is opt-in rather than automatic, and the choice is visible at the call site.

#### `formText()` / `formMultilineText()`

```typescript
function formText(): v.GenericSchema<string, string>;          // trim
function formMultilineText(): v.GenericSchema<string, string>; // CRLF → LF, then trim
```

The default shapes for form text. `formText()` is the single-line variant and **preserves** CRLF; `formMultilineText()` folds CRLF pairs to LF first, which is what a browser submits from a `<textarea>` regardless of platform. Compose either like any other schema:

```typescript
import { formMultilineText, formText, strictObject, v } from "@y-core/forge/validation";

const MessageSchema = strictObject({
  subject: v.pipe(formText(), v.minLength(1)),                        // refuses "   "
  body: v.pipe(formMultilineText(), v.minLength(1), v.maxLength(2000)),
});
```

**Why here and not in the body reader.** A form body reaches a schema exactly as submitted, so without one of these a bare `v.pipe(v.string(), v.minLength(1))` accepts `"   "` and every required-field check becomes bypassable with spaces. Normalizing in the reader was rejected for four reasons, and [`INPUT_VALIDATION.md`](../../.decisions/INPUT_VALIDATION.md) §1d owns them — the short version is that only the schema knows a field was a textarea.

**The fold runs before the trim, and that ordering is about length, not output.** `trim` treats `\r` and `\n` alike, so the two operations produce the same string in either order. What the order decides is what the rest of the pipe sees: under `v.pipe(formMultilineText(), v.maxLength(500))` each line break counts once, so a 500-character limit means the same thing whether the newline arrived as LF or CRLF instead of silently halving the budget for line breaks.

#### `describeValidationIssue(issue)` / `formatValidationIssues(issues)`

```typescript
function describeValidationIssue(issue: v.BaseIssue<unknown>): string;
function formatValidationIssues(issues: readonly v.BaseIssue<unknown>[]): string;
```

Two formatters with different audiences, and they are **not** interchangeable.

| | `describeValidationIssue` | `formatValidationIssues` |
|---|---|---|
| Audience | the caller — a response body | the operator — a log line or a thrown message |
| Output | the failing field's name, bounded in depth and per-segment length | `path: message` per issue, joined by `; ` |
| Reproduces the submission | no | **yes**, via `issue.message` |

Use `describeValidationIssue` for anything a caller reads. It names the field and nothing else, because each of the alternatives is a disclosure: `issue.message` embeds the rejected value, `issue.expected` can be the source text of the schema's own `v.regex`, and `issue.input` is the submission itself. Only the path survives, bounded, because a `v.record` key or a refused undeclared key is caller-chosen text of caller-chosen length. The result therefore varies only with *which* field failed — a 50,000-character value and a 5-character one produce the same string, and extra fields cannot multiply the response.

```typescript
const messages = result.issues.map(describeValidationIssue); // ["email"]
return fragmentResponse(renderValidationErrors(messages), 422);
```

`formatValidationIssues` exists so the `Invalid environment: …` message shape stays uniform across the env and config validators. **Never put its output in a response.**

#### `ValidationResult<T>`

A domain alias of forge's one `Result` primitive describing the outcome of a validation pass — its failure channel carries the per-field message list in the single `error` field:

```typescript
type ValidationResult<T> = Result<T, readonly string[]>;
//  ≡ { ok: true; data: T } | { ok: false; error: readonly string[] };
```

| Variant | Fields | Meaning |
|---|---|---|
| Success | `ok: true`, `data: T` | Input parsed; `data` is the typed value. |
| Failure | `ok: false`, `error: readonly string[]` | Validation failed; `error` holds the human-readable messages. |

This type is defined in and re-exported from `@y-core/forge/result` (the single result primitive). Convert a valibot result into it by mapping `result.issues` through `describeValidationIssue` on failure (see the usage example above) — not through `issue.message`, which reproduces the submitted value.

---

## `@y-core/forge/validation/cli`

The `forge-cfgen` env-schema generator. It reads a Cloudflare `wrangler.jsonc` config plus a `.dev.vars` secrets file and emits a single committed module containing a runtime valibot `EnvSchema` and a compile-time `type Env = v.InferOutput<typeof EnvSchema>` — a schema-first replacement for the env half of `wrangler types`. The package exposes both the `forge-cfgen` binary and the underlying functions.

### Usage

The generator is one third of the **standard three-part env setup** (see the full guide in [src/config/README.md](../config/README.md)):

1. **`src/app/env.config.ts`** — optional hand-written policy, a `Partial<GenOptions>`: e.g. `optional: new Set(["RATE_LIMITER"])` for bindings absent under `wrangler dev`, `refinements: { SESSION_SECRET: { minLength: 32 } }` for per-var constraints.
2. **`src/app/env.schema.ts`** — the **generated** module (`EnvSchema` + `type Env`), committed and regenerated whenever `wrangler.jsonc` bindings change.
3. **`validateBindings(EnvSchema)`** (`@y-core/forge/app`) — registered as middleware so the contract is enforced on the first request.

Run the generator as a `package.json` script:

```json
{
  "scripts": {
    "gen:env": "forge-cfgen"
  }
}
```

```bash
bun run gen:env
```

| Flag | Default | Description |
|---|---|---|
| `--wrangler` | `wrangler.jsonc` | Path to the wrangler config. |
| `--dev-vars` | `.dev.vars` | Path to the `.dev.vars` secrets file. |
| `--out` | `src/app/env.schema.ts` | Output module path. |
| `--config` | `src/app/env.config.ts` | Host-policy module exporting a `Partial<GenOptions>`; built-in `DEFAULT_OPTIONS` are used when this file is absent. |

The command reads the wrangler bindings and dev-vars keys, collects entries, emits the module, and runs a biome format pass so the generated file passes the lint gate. A typical generated module:

```typescript
/** env.schema.ts — GENERATED — do not edit; run `bun run gen:env`. */
import { v } from "@y-core/forge/validation";

export const EnvSchema = v.object({
  MY_KV: v.custom<KVNamespace>((x) => typeof x === "object" && x !== null, "MY_KV must be a KV namespace binding"),
  ASSETS: v.custom<Fetcher>((x) => typeof x === "object" && x !== null, "ASSETS must be a Fetcher binding"),
  API_BASE_URL: v.string(),
});

export type Env = v.InferOutput<typeof EnvSchema>;
```

Override generation policy with a `--config` module that exports a `Partial<GenOptions>` (as `options` or `default`), merged over `DEFAULT_OPTIONS`:

```typescript
// src/app/env.config.ts
import type { GenOptions } from "@y-core/forge/validation/cli";

export const options: Partial<GenOptions> = {
  optional: new Set(["ANALYTICS"]),
  refinements: { API_BASE_URL: { minLength: 8 } },
};
```

To call the generator programmatically (e.g. wiring it into a custom CLI via `execute`):

```typescript
import { execute } from "@y-core/forge/cli";
import { createGenEnv } from "@y-core/forge/validation/cli";

await execute(createGenEnv());
```

### Core Components & APIs

#### Command API (`cf-env-command`)

| Export | Signature | Description |
|---|---|---|
| `createGenEnv` | `() => CommandBase` | Builds the `gen-env` command (read wrangler + dev-vars → collect → emit → format). Pass to `execute`; it is also the `forge-cfgen` bin entry. |
| `readWranglerConfig` | `(path: string) => Record<string, unknown>` | Reads and parses a `wrangler.jsonc` file (JSONC comments and trailing commas stripped). |
| `loadOptions` | `(configPath?: string) => Promise<GenOptions>` | Loads a `--config` policy module and merges it over `DEFAULT_OPTIONS`; returns the defaults when no path is given. |

#### Generator internals (`cf-env-registry` + `cf-env-gen`)

The generator core is split across two files, and **all of it is `@internal`** — none of these
symbols are barrel-exported. Drive generation through the command API above (`createGenEnv`); there is
no supported way to assemble a schema from the internal pieces.

- **`cf-env-registry.ts`** holds the **data**: the `REGISTRY` binding-kind table (`configKey → nameField
  → TS type` rows in wrangler's collection order), the `DEFAULT_OPTIONS` policy default, the baked
  `HEADER` comment, and the `BindingDef` / `Entry` shapes. All `@internal`.
- **`cf-env-gen.ts`** holds the **codegen**: the pure `collectBindings`, `collectVars`, `emit`, and
  `stripJsonc` functions that walk the registry and render the module text. All `@internal`.

#### Types

Only `GenOptions` is public — the host-policy shape you pass via a `--config` module.

| Type | Shape | Description |
|---|---|---|
| `GenOptions` | `{ optional: Set<string>; refinements: Record<string, { minLength?: number }>; bindingCheck: string }` | Host policy layered over the generated schema: optional bindings, per-var refinements, and the shared `v.custom` presence check. Merged over the internal `DEFAULT_OPTIONS`. |
