# `@y-core/forge/validation`

Schema validation for forge apps, built on [valibot](https://valibot.dev). The namespace re-exports the entire valibot API under a single `v` import, adds the `ValidationResult<T>` result type used across forge's request pipeline, and ships a Cloudflare env-schema code generator (`forge-cfgen`) under the `/cli` sub-path.

| Import path | Surface |
|---|---|
| `@y-core/forge/validation` | `v` (valibot namespace) + `ValidationResult` |
| `@y-core/forge/validation/cli` | `forge-cfgen` env-schema generator API (also a `bin`) |

---

## Features

- **Single valibot entry point** — `v` is the complete valibot namespace re-exported as one import, so every app uses the same pinned valibot version and never deep-imports the upstream package.
- **`ValidationResult<T>`** — a discriminated union (`{ ok: true; data: T } | { ok: false; errors: string[] }`) that is the canonical return type for the `validate` hook of `defineAction` and for any service that validates its own input.
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
    return { ok: false, errors: result.issues.map((issue) => issue.message) };
  }
  return { ok: true, data: result.output };
}
```

Inspect `result.ok` before reading `data`:

```typescript
const outcome = validateContact(rawFields);
if (!outcome.ok) {
  // outcome.errors: string[] — human-readable messages
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

A discriminated union describing the outcome of a validation pass:

```typescript
type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };
```

| Variant | Fields | Meaning |
|---|---|---|
| Success | `ok: true`, `data: T` | Input parsed; `data` is the typed value. |
| Failure | `ok: false`, `errors: string[]` | Validation failed; `errors` are human-readable messages. |

This type is also re-exported from `@y-core/forge/result`. Convert a valibot result into it by mapping `result.issues` to `issue.message` on failure (see the usage example above).

---

## `@y-core/forge/validation/cli`

The `forge-cfgen` env-schema generator. It reads a Cloudflare `wrangler.jsonc` config plus a `.dev.vars` secrets file and emits a single committed module containing a runtime valibot `EnvSchema` and a compile-time `type Env = v.InferOutput<typeof EnvSchema>` — a schema-first replacement for the env half of `wrangler types`. The package exposes both the `forge-cfgen` binary and the underlying functions.

### Usage

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
import { makeGenEnv } from "@y-core/forge/validation/cli";

await execute(makeGenEnv());
```

### Core Components & APIs

#### Command API (`cf-env-command`)

| Export | Signature | Description |
|---|---|---|
| `makeGenEnv` | `() => CommandBase` | Builds the `gen-env` command (read wrangler + dev-vars → collect → emit → format). Pass to `execute`; it is also the `forge-cfgen` bin entry. |
| `readWranglerConfig` | `(path: string) => Record<string, unknown>` | Reads and parses a `wrangler.jsonc` file (JSONC comments and trailing commas stripped). |
| `loadOptions` | `(configPath?: string) => Promise<GenOptions>` | Loads a `--config` policy module and merges it over `DEFAULT_OPTIONS`; returns the defaults when no path is given. |

#### Generator core (`cf-env-gen`)

Pure, IO-free functions. Use these directly to assemble a schema without the CLI shell.

| Export | Signature | Description |
|---|---|---|
| `collectBindings` | `(cfg: Record<string, unknown>, opts: GenOptions) => Entry[]` | Walks `REGISTRY` over a parsed wrangler config and extracts binding entries (KV, R2, D1, Durable Objects, services, …) in wrangler's emission order. |
| `collectVars` | `(devVarsText: string, wranglerVars: Record<string, unknown>, opts: GenOptions) => Entry[]` | Extracts plain-text env vars: typed `wrangler.jsonc` `vars` first, then `.dev.vars` secrets (`v.string()`); `.dev.vars` wins on name collisions. |
| `emit` | `(entries: Entry[]) => string` | Renders the full `EnvSchema` + `type Env` module text (prefixed with `HEADER`) for the collected entries. |
| `stripJsonc` | `(text: string) => string` | Strips `//` and block comments from JSONC, string-aware so `//` inside a string survives. |
| `REGISTRY` | `readonly BindingDef[]` | The binding-kind table — `(configKey → nameField → TS type)` rows in wrangler's collection order. |
| `DEFAULT_OPTIONS` | `GenOptions` | Default policy: nothing optional, no refinements, presence/shape binding floor. |
| `HEADER` | `string` | The doc-comment header baked into every generated module. |

Composing the core directly:

```typescript
import {
  collectBindings,
  collectVars,
  DEFAULT_OPTIONS,
  emit,
  readWranglerConfig,
} from "@y-core/forge/validation/cli";

const cfg = readWranglerConfig("wrangler.jsonc");
const entries = [
  ...collectBindings(cfg, DEFAULT_OPTIONS),
  ...collectVars(devVarsText, (cfg.vars as Record<string, unknown>) ?? {}, DEFAULT_OPTIONS),
];
const moduleSource = emit(entries);
```

#### Types

| Type | Shape | Description |
|---|---|---|
| `BindingDef` | `{ configKey; nameField: "binding" \| "name"; tsType; shape: "list" \| "object"; label; message }` | One binding flavour: where it lives in config, how its name is read, its Cloudflare TS type, and its validation message. |
| `Entry` | `{ name: string; expr: string }` | One emitted schema entry — a binding/var key and its valibot expression. |
| `GenOptions` | `{ optional: Set<string>; refinements: Record<string, { minLength?: number }>; bindingCheck: string }` | Host policy layered over the generated schema: optional bindings, per-var refinements, and the shared `v.custom` presence check. |
