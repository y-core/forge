---
title: Schema Validation
description: "Declaring a schema against the pinned valibot, picking the right shape for a form field, and turning a parse failure into a safe refusal."
audience: consumer
---

# `@y-core/forge/validation`

This namespace is forge's [valibot](https://valibot.dev) facade: the whole library under one `v`, with a few forge-owned helpers beside it. Every schema in an
app and in the library is built from here, which is what keeps one valibot version in play. The rule is [`CODE_RULES.md`][cr-3b] §3b's, and it
reaches test files too.

```ts
import { describeValidationIssue, formMultilineText, formText, v, type ValidationResult } from "@y-core/forge/validation";
```

**What is not prefixed is not valibot.** `formText`, `formMultilineText`, `formDigits`, `safeCheck` and `describeValidationIssue` sit beside `v`,
never inside it. Everything else you reach for, `v.strictObject` included, is valibot's own.

---

## Getting started

Declare the schema with `v.strictObject`, parse with `v.safeParse`, and turn the issues into a [`ValidationResult`][result-readme] at the boundary.

```ts
import { describeValidationIssue, formMultilineText, formText, v, type ValidationResult } from "@y-core/forge/validation";
import { err, ok } from "@y-core/forge/result";

const ContactSchema = v.strictObject({
  name: v.pipe(formText(), v.minLength(2)),
  email: v.pipe(formText(), v.email()),
  message: v.pipe(formMultilineText(), v.minLength(10)),
});

type ContactInput = v.InferOutput<typeof ContactSchema>;

export function validateContact(fields: unknown): ValidationResult<ContactInput> {
  const parsed = v.safeParse(ContactSchema, fields, { abortEarly: true });
  if (!parsed.success) return err(parsed.issues.map(describeValidationIssue));
  return ok(parsed.output);
}
```

`v.strictObject` rather than `v.object` means an undeclared field is **refused** rather than quietly dropped, which is what you want for anything a
caller composed, and it holds for a key colliding with an `Object.prototype` name — `__proto__`, `constructor`, `toString` — as it does for any
other; [`INPUT_VALIDATION.md`][iv-1d] §1d states the guarantee. `abortEarly: true` means the caller learns about one failing field at a time —
deliberate, because an enumerating refusal is one a caller can lengthen by adding fields (§1b).

**A route built with `defineAction` writes none of this.** Hand it the same `ContactSchema` and the pipeline reads the body, parses, and renders the
refusal itself. Write a function like the one above for a service that validates its own input, or a handler outside that pipeline.

---

## Picking a shape for a form field

A form body reaches the schema exactly as submitted — nothing trims it on the way in — so the schema is where a field's shape is decided. These
primitives cover the cases where the raw value would make a later check mean the wrong thing.

| Reach for | When the control is | Because |
| --- | --- | --- |
| `formText()` | a single-line `<input>` | `"   "` must not satisfy a required-field check |
| `formMultilineText()` | a `<textarea>` | a CRLF line break should cost one character against a length bound, not two |
| `formDigits()` | a number whose separators are cosmetic | `"4111 1111 1111 1111"` and `"4111111111111111"` are the same card |

```ts
const PaymentSchema = v.strictObject({
  card: v.pipe(formDigits(), v.length(16)), // accepts "4111 1111 1111 1111"
  note: v.pipe(formMultilineText(), v.maxLength(2000)),
});
```

Each one normalizes and never refuses, so compose the bound you actually mean after it. That split — normalizing in the schema rather than in the
body reader — is [`INPUT_VALIDATION.md`][iv-1d] §1d's, along with the reasons it is not the reader's job.

**`formDigits()` is the one that discards.** A leading `+`, an `x` before an extension, a letter in an alphanumeric code: all gone. A field that
must keep any of them belongs on `formText()`.

---

## Writing an env rule a deployer can act on

Every `v.check` in a schema shares the issue type `check`, and env validation renders the issue type rather than the message — so a rule whose
sentence was written for a deployer surfaces as the bare word `check`. `safeCheck` is how you get the sentence back.

```ts
import { safeCheck, v } from "@y-core/forge/validation";

const OriginSchema = v.pipe(
  v.string(),
  v.url(),
  safeCheck((url) => url.startsWith("https://"), "must use https"),
);
// Invalid environment: site.url: must use https
```

Calling it is a statement about the message: that it describes the requirement and never interpolates the value. Nothing can check that statically,
which is why a plain `v.check` still renders as `check` and adoption is one rule at a time ([`INPUT_VALIDATION.md`][iv-1b] §1b).

**Write the requirement, not the variable.** `must use https`, not `BASE_URL must use https` — the refusal's own `<field>:` prefix already says
where, and the env key is the consuming app's choice, so naming one sends an operator looking for a variable their repo may not have.

---

## Gotchas

**`describeValidationIssue`, never `issue.message`.** The valibot message embeds the rejected value; `issue.expected` can be the source text of your
own `v.regex`; `issue.input` is the submission itself. Only the field path survives, bounded, so a 50,000-character value and a 5-character one
produce the same refusal. No forge renderer reproduces `issue.message` on any channel, a log included ([`INPUT_VALIDATION.md`][iv-1b] §1b).

**A length bound means whatever the shape above it left.** `v.maxLength(10)` under `formDigits()` bounds the digits; the same bound under
`formText()` counts the punctuation too and refuses `"(555) 123-4567"`. And a character-class `v.regex` composed after `formDigits()` can never fail
— it reads as a check that is not there.

**`safeCheck` registers against the predicate reference.** Passing an already-vouched predicate to a plain `v.check` still resolves to the vouched
message, and vouching the same predicate twice replaces the first message.

---

## See also

- [`docs/INPUT_VALIDATION.md`][iv] — the governing doctrine: the facade and what sits beside `v` (§1a), `abortEarly`, issue formatting and
  `safeCheck` (§1b), and the `defineAction` schema contract (§1d)
- [`src/result/README.md`][result-readme] — the `Result` primitive `ValidationResult` narrows
- [`src/tooling/cf/README.md`][cf-readme] — `forge cf gen env`, which emits the env schema this namespace's `v` then types

[cf-readme]: ../tooling/cf/README.md
[cr-3b]: ../../warden/canon/shared/CODE_RULES.md#3b-the-validation-facade
[iv]: ../../docs/INPUT_VALIDATION.md
[iv-1b]: ../../docs/INPUT_VALIDATION.md#1b-vsafeparse-with-abortearly
[iv-1d]: ../../docs/INPUT_VALIDATION.md#1d-defineaction--the-schema-contract
[result-readme]: ../result/README.md
