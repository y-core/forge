# `@y-core/forge/validation`

Schema validation for forge apps, built on [valibot](https://valibot.dev). The namespace re-exports the entire valibot API under a single `v` import, adds the `ValidationResult<T>` result type used across forge's request pipeline, and ships a Cloudflare env-schema code generator (`forge-cfgen`) under the `/cli` sub-path.

| Import path | Surface |
|---|---|
| `@y-core/forge/validation` | `v` (valibot namespace) + `ValidationResult` |
| `@y-core/forge/validation/cli` | `forge-cfgen` env-schema generator API (also a `bin`) |

---

## Features

- **Single valibot entry point** — `v` is the complete valibot namespace re-exported as one import, so every app uses the same pinned valibot version and never deep-imports the upstream package.
- **`ValidationResult<T>`** — a domain alias of forge's one `Result` primitive, `Result<T, readonly string[]>` (`{ ok: true; data: T } | { ok: false; error: readonly string[] }`), that is the canonical return type for the `validate` hook of `defineAction` and for any service that validates its own input.
- **`forge-cfgen` env-schema generator** — reads `wrangler.jsonc` bindings and `.dev.vars` keys and emits a committed, schema-first valibot `EnvSchema` (plus an inferred `type Env`), replacing the env half of `wrangler types`.

---

## `@y-core/forge/validation`

### Usage

Define a schema with `v`, parse untrusted input with `v.safeParse`, and convert the result into a `ValidationResult` at the system boundary.

```typescript
import { v, type ValidationResult } from "@y-core/forge/validation";

const ContactSchema = v.object({
  name: v.pipe(v.string(), v.minLength(2)),
  email: v.pipe(v.string(), v.email()),
  message: v.pipe(v.string(), v.minLength(10)),
});

type ContactInput = v.InferOutput<typeof ContactSchema>;

function validateContact(fields: unknown): ValidationResult<ContactInput> {
  const result = v.safeParse(ContactSchema, fields, { abortEarly: true });
  if (!result.success) {
    return { ok: false, error: result.issues.map((issue) => issue.message) };
  }
  return { ok: true, data: result.output };
}
```

Inspect `result.ok` before reading `data`:

```typescript
const outcome = validateContact(rawFields);
if (!outcome.ok) {
  // outcome.error: readonly string[] — human-readable messages
  return;
}
// outcome.data: ContactInput — typed, validated
sendContact(outcome.data);
```

`validateContact` matches the shape `defineAction` (from `@y-core/forge/app`) expects for its `validate` hook — `(data: unknown) => ValidationResult<T>` — so the same function plugs directly into the request pipeline.

### Core Components & APIs

#### `v` — valibot namespace

`v` is the entire valibot namespace re-exported under one name. Use `v.object(...)`, `v.string()`, `v.pipe(...)`, `v.email()`, `v.minLength()`, `v.safeParse(...)`, `v.InferOutput<...>`, and every other valibot primitive, action, and combinator through this prefix. Never import `valibot` directly — `v` guarantees the forge-pinned version and avoids dual-package conflicts.

```typescript
import { v } from "@y-core/forge/validation";

const schema = v.object({ count: v.pipe(v.number(), v.minValue(0)) });
const result = v.safeParse(schema, { count: 3 }); // { success, output | issues }
```

`v.safeParse(schema, value, config?)` returns a valibot result (`success`/`output`/`issues`), not a `ValidationResult`. Pass `{ abortEarly: true }` to stop at the first issue (typical for field-level form errors); omit it to collect every issue.

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

This type is defined in and re-exported from `@y-core/forge/result` (the single result primitive). Convert a valibot result into it by mapping `result.issues` to `issue.message` on failure (see the usage example above).

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
