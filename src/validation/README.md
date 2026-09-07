---
title: Schema Validation
description: "The whole valibot API under one import, forge's own schema and issue helpers beside it, and the result type the request pipeline carries."
---

# `@y-core/forge/validation`

Schema validation for forge apps, built on [valibot](https://valibot.dev). The namespace re-exports the entire valibot API under a single `v` import, adds a small set of forge's own schema and issue helpers beside it, and carries the `ValidationResult<T>` result type used across forge's request pipeline.

| Import path | Surface |
| --- | --- |
| `@y-core/forge/validation` | `v` (valibot namespace), `strictObject`, `formText`, `formMultilineText`, `formDigits`, `safeCheck`, `describeValidationIssue`, `ValidationResult` |

**Everything except `v` is a sibling of it, not a member.** `strictObject` and `v.strictObject` are two different functions, and the one without the prefix is the recommendation for untrusted input.

---

## Features

- **Single valibot entry point** — `v` is the complete valibot namespace re-exported as one import, so every app uses the same pinned valibot version and never deep-imports the upstream package.
- **`strictObject`** — the strict object schema to use for anything parsing untrusted input. Only a field the schema actually declares counts as declared, so an undeclared key is refused rather than silently dropped, for **every** key a caller can send.
- **Form-value primitives** — `formText()` for a single-line control, `formMultilineText()` for a `<textarea>`, and `formDigits()` for a control whose separators are cosmetic. A form body reaches a schema exactly as submitted, so trimming, CRLF folding, and separator removal are the schema's job. Each earns its place by making one downstream check mean one thing — a required-field check, a line-counted length, a digit-counted length — and that criterion, not a count, closes the set.
- **`safeCheck`** — a `v.check` whose message its author has vouched for as naming no input. Every `v.check` shares the single issue type `check`, so the message is the only thing that ever tells two of them apart, and an env refusal drops it — a rule with a sentence written for a deployer reads as the bare word `check`. `safeCheck` registers the message and the env formatter surfaces it verbatim; a plain `v.check` is unchanged, which is what keeps a message that interpolates the rejected value out of the throw.
- **Bounded issue descriptions** — `describeValidationIssue` names the field one issue is about and nothing else, so a refusal a caller reads cannot carry the submitted value, the schema's own rule, or a length the caller chose. **No forge renderer reproduces `issue.message` on any channel** — not a response, and not a log.
- **`ValidationResult<T>`** — a domain alias of forge's one `Result` primitive, `Result<T, readonly string[]>` (`{ ok: true; data: T } | { ok: false; error: readonly string[] }`), the canonical return type for any service that validates its own input.

---

## Usage

Declare the schema with `strictObject` and the form-text primitives, parse untrusted input with `v.safeParse`, and convert the result into a `ValidationResult` at the system boundary.

```ts
import { describeValidationIssue, formMultilineText, formText, strictObject, v, type ValidationResult } from "@y-core/forge/validation";

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

```ts
const outcome = validateContact(rawFields);
if (!outcome.ok) {
  // outcome.error: readonly string[] — the field names that failed
  return;
}
// outcome.data: ContactInput — typed, validated
sendContact(outcome.data);
```

A route on `defineAction` (from `@y-core/forge/app`) writes none of this: it hands the same `ContactSchema` to the pipeline, which reads the body, parses with `abortEarly`, and renders the refusal through `describeValidationIssue` itself. Write a function like the one above for a **service** that validates its own input, or for a handler outside that pipeline.

## Core Components & APIs

### `v` — valibot namespace

`v` is the entire valibot namespace re-exported under one name. Use `v.object(...)`, `v.string()`, `v.pipe(...)`, `v.email()`, `v.minLength()`, `v.safeParse(...)`, `v.InferOutput<...>`, and every other valibot primitive, action, and combinator through this prefix. Never import `valibot` directly — `v` guarantees the forge-pinned version and avoids dual-package conflicts.

```ts
import { v } from "@y-core/forge/validation";

const schema = v.object({ count: v.pipe(v.number(), v.minValue(0)) });
const result = v.safeParse(schema, { count: 3 }); // { success, output | issues }
```

`v.safeParse(schema, value, config?)` returns a valibot result (`success`/`output`/`issues`), not a `ValidationResult`. Pass `{ abortEarly: true }` to stop at the first issue (typical for field-level form errors); omit it to collect every issue. An enumerating refusal is one a caller can lengthen by adding fields, so choose it deliberately.

### `strictObject(entries, message?)`

```ts
function strictObject<TEntries extends v.ObjectEntries>(
  entries: TEntries,
  message?: v.ErrorMessage<v.StrictObjectIssue>,
): v.StrictObjectSchema<TEntries, …>;
```

A strict object schema in which only a field the schema _actually declares_ counts as declared. Use it in place of `v.strictObject` for anything parsing untrusted input — a request body above all.

```ts
import { strictObject, v } from "@y-core/forge/validation";

const ContactSchema = strictObject({ name: v.string(), email: v.pipe(v.string(), v.email()) });
```

The difference is the declared-key test. Valibot answers "is this key declared?" by looking the name up on the schema's entries object, and on an ordinary object literal that lookup reaches inherited members — so a caller sending `__proto__`, `constructor`, `toString`, `valueOf` or any other inherited name reads as declared for _any_ schema and is dropped from the parsed output instead of being refused. That is the one case where the unknown-key guarantee would not hold, and `strictObject` closes it for the whole class of names at once, with no branch naming any of them.

The correction is applied **at construction**, so it survives composition: the property holds when the schema is nested in another object, wrapped in `v.pipe`, or used as a `v.union` / `v.variant` option. A patch applied to a finished schema would not.

> A schema written with raw `v.strictObject` keeps the original behaviour. This is opt-in rather than automatic, and the choice is visible at the call site.

### `formText()` / `formMultilineText()`

```ts
function formText(): v.GenericSchema<string, string>; // trim
function formMultilineText(): v.GenericSchema<string, string>; // CRLF → LF, then trim
```

The default shapes for form text. `formText()` is the single-line variant and **preserves** CRLF; `formMultilineText()` folds CRLF pairs to LF first, which is what a browser submits from a `<textarea>` regardless of platform. Compose either like any other schema:

```ts
import { formMultilineText, formText, strictObject, v } from "@y-core/forge/validation";

const MessageSchema = strictObject({
  subject: v.pipe(formText(), v.minLength(1)), // refuses "   "
  body: v.pipe(formMultilineText(), v.minLength(1), v.maxLength(2000)),
});
```

**Why here and not in the body reader.** A form body reaches a schema exactly as submitted, so without one of these a bare `v.pipe(v.string(), v.minLength(1))` accepts `"   "` and every required-field check becomes bypassable with spaces. Normalizing in the reader was rejected for four reasons, and [`INPUT_VALIDATION.md`](../../docs/INPUT_VALIDATION.md) §1d owns them — the short version is that only the schema knows a field was a textarea.

**The fold runs before the trim, and that ordering is about length, not output.** `trim` treats `\r` and `\n` alike, so the two operations produce the same string in either order. What the order decides is what the rest of the pipe sees: under `v.pipe(formMultilineText(), v.maxLength(500))` each line break counts once, so a 500-character limit means the same thing whether the newline arrived as LF or CRLF instead of silently halving the budget for line breaks.

### `formDigits()`

```ts
function formDigits(): v.GenericSchema<string, string>; // every non-digit removed
```

The shape for a control whose separators are cosmetic — a card number the user reads as `4111 1111 1111 1111`, a phone number as `(555) 123-4567`. Every character outside `0`–`9` is removed, so one number reaches the schema as one string however it was rendered:

```ts
import { formDigits, strictObject, v } from "@y-core/forge/validation";

const PaymentSchema = strictObject({
  card: v.pipe(formDigits(), v.length(16)), // accepts "4111 1111 1111 1111"
});
```

**A composed length now counts digits, not characters.** That is the point of the primitive and also the trap: `v.maxLength(10)` under `formDigits()` bounds the number, while the same bound under `formText()` refuses `"(555) 123-4567"` for its punctuation. Pick the bound against the digits you mean to allow, not against the widest rendering.

**A downstream character class is meaningless.** After the strip, the value cannot contain anything a `v.regex` would exclude, so a pattern like `/^[\d\s-]+$/` composed after `formDigits()` always passes and reads as a check that is not there. Bound the length; drop the pattern.

**`formDigits()` is destructive in a way its siblings are not.** `formText()` and `formMultilineText()` only normalize whitespace, but this one discards significant characters: a leading `+` on an international number, an `x` before an extension, a letter in an alphanumeric code. A field that must preserve any of those stays on `formText()`.

### `safeCheck(requirement, message)`

```ts
function safeCheck<TInput>(requirement: (input: TInput) => boolean, message: string): v.CheckAction<TInput, string>;
```

A `v.check` whose `message` the author states is **value-free** — it describes the requirement and never interpolates the input. An env refusal surfaces a registered message verbatim in place of the bare word `check`:

```ts
import { safeCheck, v } from "@y-core/forge/validation";

const OriginSchema = v.pipe(
  v.string(),
  v.url(),
  safeCheck((url) => url.startsWith("https://"), "must use https"),
);
// Invalid environment: site.url: must use https
```

**Nothing can tell statically whether a message names the value, so the author says so.** A plain `v.check` still renders as `check`, which is the fail-closed direction: adopting `safeCheck` is opt-in, one rule at a time, and forgetting it costs detail rather than disclosure.

**Write the requirement, not the variable.** The schema validates a _value_; which env key supplies it is the consuming app's choice, and the refusal's own `<field>:` prefix already locates it. A message reading `BASE_URL must use https` sends an operator whose repo maps `SITE_ORIGIN` to a variable that does not exist.

**The registration is keyed by the predicate function** — valibot hands the very same reference back on the issue. Passing an already-vouched predicate to a plain `v.check` therefore still resolves to the vouched message, and re-vouching one predicate with a second message replaces the first.

### `describeValidationIssue(issue)`

```ts
function describeValidationIssue(issue: v.BaseIssue<unknown>): string;
```

Names the failing field, bounded in depth and per-segment length, and nothing else.

Each of the alternatives is a disclosure: `issue.message` embeds the rejected value, `issue.expected` can be the source text of the schema's own `v.regex`, and `issue.input` is the submission itself. Only the path survives, bounded, because a `v.record` key or a refused undeclared key is caller-chosen text of caller-chosen length. The result therefore varies only with _which_ field failed — a 50,000-character value and a 5-character one produce the same string, and extra fields cannot multiply the response.

```ts
const messages = result.issues.map(describeValidationIssue); // ["email"]
return fragmentResponse(renderValidationErrors(messages), 422);
```

**There is no operator-facing counterpart that reproduces `issue.message`.** `formatValidationIssues` used to be one, and it leaked: valibot interpolates the rejected value into its own message, so a malformed secret was reproduced verbatim in the `Invalid environment: …` throw, and from there into the app logger, the KV log channel and the debug 500 body. Env validation now renders `field: reason` from `issue.type` — `missing` for an absent binding — which is a closed valibot vocabulary carrying neither the value nor the schema's text. The one exception is a message registered through `safeCheck`, which its author has vouched for; nothing else about a `check` issue survives.

### `ValidationResult<T>`

A domain alias of forge's one `Result` primitive describing the outcome of a validation pass — its failure channel carries the per-field message list in the single `error` field:

```ts
type ValidationResult<T> = Result<T, readonly string[]>;
//  ≡ { ok: true; data: T } | { ok: false; error: readonly string[] };
```

| Variant | Fields | Meaning |
| --- | --- | --- |
| Success | `ok: true`, `data: T` | Input parsed; `data` is the typed value. |
| Failure | `ok: false`, `error: readonly string[]` | Validation failed; `error` holds the human-readable messages. |

This type is defined in and re-exported from `@y-core/forge/result` (the single result primitive). Convert a valibot result into it by mapping `result.issues` through `describeValidationIssue` on failure (see the usage example above) — not through `issue.message`, which reproduces the submitted value.

---

## `@y-core/forge/tooling/cf`

The `forge cf gen env` env-schema generator lives in the Cloudflare tooling namespace, not here —
it emits a valibot `EnvSchema` this namespace's `v` then types. Its flags, the three-part env
setup it belongs to, and its programmatic API are documented in
[`src/tooling/cf/README.md`](../tooling/cf/README.md).
