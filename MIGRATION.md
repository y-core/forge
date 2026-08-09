# Migration Guide — the `defineAction` schema pipeline

For a consuming app upgrading from **0.0.80** to **0.0.81**, the release carrying the `defineAction`
rewrite.

`CHANGELOG.md`'s `[0.0.81]` section is the record of **what** changed and is not repeated here.
This file covers **what to do**, and it is weighted deliberately: most of it is about the changes a
consuming app will *not* notice. The type errors announce themselves and a compiler will walk you
through them. The rest of this list keeps compiling, keeps returning `200`, keeps passing the test
suite — and behaves differently in production.

Read this alongside the rules it applies:

- [`.decisions/INPUT_VALIDATION.md`](.decisions/INPUT_VALIDATION.md) §1d — the schema contract, what
  each guard consumes, and the failure modes.
- [`.decisions/ROUTING_AND_MIDDLEWARE.md`](.decisions/ROUTING_AND_MIDDLEWARE.md) §2b — the
  derive-only drop rule, and why a permissive default was rejected.
- [`src/form/README.md`](src/form/README.md) and [`src/app/README.md`](src/app/README.md) — the
  worked examples and the current option tables.

---

## Which breaks announce themselves

| Break | How you find out |
|---|---|
| `parse` / `validate` replaced by `schema` | Compile error |
| `injectedFields` removed | Compile error |
| `readFields`, `readTextField`, `FormFieldReader` removed | Compile error |
| `onValidationError` receives issues, not strings | Compile error |
| `scopeAttrs` / `ScopeAttrsProps` moved to `ui/contracts` | Compile error — unresolved import |
| A `_csrf` submitted to a route with no `csrfProtection` | Every submission refused, at runtime |
| A missing `honeypot:` / `turnstile:` **on a strict schema** | Every submission refused, at runtime |
| A missing `honeypot:` / `turnstile:` on a **non-strict** schema | **Nothing.** Bot detection is gone |
| An implicitly-optional schema field | Nothing, until a user omits the field |
| A dropped `v.safeParse` config | Nothing |
| A hand-rolled `Object.fromEntries` body read | Nothing |
| A refusal body a client parses | Nothing — the *status* is unchanged |

The runtime refusals are loud by design: a submission that is refused every time is found on the
first manual test of the form. The bottom five rows are the substance of this guide.

---

## Silent hazard 1 — a field that was optional by accident now hard-fails

The removed `readFields` wrote `""` for a field the caller never sent. A schema field that was
*labelled* optional in the UI but declared as a plain string therefore validated fine: `""` passes
`v.maxLength`, and it passes any `*`-quantified `v.regex`. The absence was collapsed before the
schema could observe it.

`formToObject` leaves an absent field **absent**. `v.string()` then sees `undefined` and refuses,
and because a valibot object refusal is a refusal of the whole object, one omitted input rejects the
entire submission.

```ts
import { formText, v } from "@y-core/forge/validation";

// before — worked only because the reader substituted "" for an absent `phone`
phone: v.pipe(v.string(), v.trim(), v.maxLength(30), v.regex(/^[\d +-]*$/)),

// after — say what the form actually permits
phone: v.optional(v.pipe(formText(), v.maxLength(30), v.regex(/^[\d +-]*$/))),
```

**Downstream symptom:** a form that has always worked starts refusing whenever a user leaves an
optional input blank. The refusal is a correct `422` naming the field, so nothing looks broken — the
schema is simply now enforcing a rule the app never meant to state. It reproduces only for the
submissions that omit the field, so a filled-in smoke test passes.

Every field the markup does **not** mark `required` needs `v.optional` in the schema. Note also that
`v.optional(v.string())` accepts `""` as well as absence, which is what a browser sends for an empty
optional text input that *is* present — so `v.optional` is the right shape for both.

---

## Silent hazard 2 — the refusal status, and the workaround that must not survive

A consuming app that returned its own status for a refusal is the case to read carefully, because
the *before* and *after* are the same number and the conclusion "nothing to do" is wrong.

```ts
import { defineAction } from "@y-core/forge/app";
import { fragmentResponse } from "@y-core/forge/http";

// before — the app's own handler chose the status
const result = validateContact(formData);
if (!result.ok) return fragmentResponse(renderValidationErrors(result.error), 422);

// after — the pipeline answers 422 itself; the route never sees the failure
export const contactAction = defineAction<typeof ContactSchema, Bindings, AppConfig>({
  schema: ContactSchema,
  handle: async (data) => { /* reached only through a passing safeParse */ },
});
```

Two things did change underneath the unchanged status:

- **The body is different.** It carries one `<li>`, naming the failing field and nothing else — no
  valibot message, no rejected value, no pattern source. A client or a test that read the message
  text is reading something that is no longer there.
- **`abortEarly` holds it to one issue** however many fields a caller broke, so a per-field error
  list rendered from the default fragment now shows the first failure only. Supply
  `onValidationError` if enumerating is genuinely wanted, and bound it deliberately.

**The double-correction.** Between the schema rewrite and the status fix, the default fragment
carried no status and `fragmentResponse` defaults to `200` — so a refusal answered **`200`**. That
window was never released; both changes land in the same release. But an app tracking forge's main
branch through it, as the pre-1.0 same-window policy encourages, may have compensated for the `200`:
detecting a refusal by inspecting the response body, adding a `{ code: "200", swap: true }` htmx
entry, or dropping a `422` entry that had become dead. **Every one of those must come out now**, and
none of them shows up as a diff against 0.0.80 — the workaround and the fix cancel, so the app looks
migrated while the client is decoding the wrong signal.

**Downstream symptom of an uncorrected workaround:** a refusal that swaps twice, swaps the wrong
fragment, or is counted as a success by whatever reads the status — with no error anywhere.

---

## Silent hazard 3 — `v.safeParse` config is not carried over, and the flag names differ

`defineAction` calls `v.safeParse` itself with `{ abortEarly: true }`. Any config the app used to
pass is simply gone.

```ts
import { v } from "@y-core/forge/validation";

// before — the app's own call, with its own config
const result = v.safeParse(ContactSchema, raw, { abortPipeEarly: true });

// after — the pipeline's call, which the route does not supply config to
// { abortEarly: true }
```

**`abortEarly` and `abortPipeEarly` are two different flags.** Both are declared on valibot's
`Config`, and they are one letter apart in effect as well as in spelling:

- `abortEarly` — stop the whole validation at the first issue. **One** issue, total.
- `abortPipeEarly` — stop each *pipeline* at its first issue, and carry on to the next entry. One
  issue **per failing field**.

An app that wants a different shape passes `onValidationError` and runs its own `v.safeParse`.
Passing the wrong flag there is not an error and produces no warning — it produces a longer response
than intended, which is the amplification `abortEarly` exists to close: extra field names an
attacker adds multiply the issue count, and every issue is emitted.

**Downstream symptom:** a refusal body that grows with what the caller sent. Nothing fails; the
response is just steerable by the submission.

---

## Silent hazard 4 — `Object.fromEntries` is last-wins, and that is exploitable

`Object.fromEntries(formData)` is the obvious hand-rolled replacement for the removed reader. It is
wrong in a way no test written against a well-formed body can see.

| Reader | `email=victim@x&email=attacker@y` yields |
|---|---|
| `readFields` (removed) — `formData.get` | `"victim@x"` — **first**-wins |
| `Object.fromEntries(formData)` | `"attacker@y"` — **last**-wins |
| `formToObject(formData)` | `["victim@x", "attacker@y"]` — an array |

```ts
import { formToObject } from "@y-core/forge/form";

// before — first-wins, via formData.get under the hood
const raw = readFields(formData, ["name", "email", "message"]);

// wrong — silently last-wins, and the duplicate disappears
const body = Object.fromEntries(formData);

// after — the reader defineAction uses, public for handlers outside it
const body = formToObject(formData, { drop });
```

**Why this is a vulnerability and not a nit.** A scalar schema field fed an array refuses in its own
words, so `formToObject` turns a duplicated key into a visible `422`. Last-wins turns it into a
*successful* request carrying the attacker's value. Where the submitted value is echoed into an
outbound message — a `reply_to` on a contact email is the canonical case — an attacker appends a
second `email` field and redirects the reply, and the form reports success to the victim who filled
it in. First-wins is not safe either; it merely fails in the victim's favour by luck.

**This audit is not scoped to `defineAction` call sites.** A route inside the pipeline is already
correct. The exposure is every place the app reads a body by hand — a webhook receiver, an API
endpoint, a route that could not use `defineAction`. `formToObject` is exported from
`@y-core/forge/form` precisely so those handlers have a correct primitive to call rather than an
incorrect one to copy; see [`src/form/README.md`](src/form/README.md) for the `drop` set a CSRF
guard makes necessary.

**Downstream symptom:** none. The request succeeds, the log line looks ordinary, and the wrong value
is the one that was used.

---

## The loud break — `honeypot:` and `turnstile:` are now required arguments

For any route whose view renders a decoy or the Turnstile widget, the action must name the field:

```tsx
import { defineAction } from "@y-core/forge/app";
import { Honeypot } from "@y-core/forge/ui/core";

export const CONTACT_DECOY = "company"; // one app-owned constant, referenced twice

// view
<Honeypot field={CONTACT_DECOY} />

// action
defineAction<typeof ContactSchema, Bindings, AppConfig>({
  schema: ContactSchema,
  honeypot: CONTACT_DECOY,
  turnstile: { secretKey: (_c, config) => config.services.turnstile.secretKey, verify: (c) => ({ expectedHostname: c.url.hostname }) },
  handle: async (data) => { /* … */ },
});
```

Both checks moved into the pipeline, and **each field is dropped because it was checked**. A route
that does not name them gets neither the check nor the strip — so on a `strictObject` schema the
decoy arrives as an undeclared key and every submission is refused. That is the intended direction
to fail in, and it is the reason this break is listed apart from the four above.

**It is loud only on a strict schema.** Both options are optional in the *type* — there is no
compile error, by necessity, since a form with no decoy must stay valid. On a plain `v.object` an
undeclared field is silently dropped, so an app that has not adopted `strictObject` gets no refusal,
no compile error, and **no bot detection**: the pipeline previously stripped the honeypot field
before validation without ever checking it, and forge ships no honeypot or Turnstile middleware to
fall back on. Bot detection did not degrade on migration — it disappeared. Adopt `strictObject` and
this hazard converts itself into the loud one.

There is deliberately no default for `honeypot` and no reserved field-name prefix. A decoy works
only while its name is unpredictable, and forge is open source — any name forge published would be a
one-line bypass for every deployment at once. `HONEYPOT_FIELD_DEFAULT` exists and is public, which
is exactly why an app should not use it.

Two further consequences worth checking before the upgrade lands:

- **`Honeypot` no longer renders `data-slot="form-honeypot"`.** An attribute that names the decoy
  outright makes hardening the field name largely moot. There is no replacement — a consumer
  selector or test asserting on it breaks, by design.
- The field names forge does own live in
  [`src/form/constants.ts`](src/form/constants.ts); read them from there rather than restating the
  literals.

---

## The other loud break — `scopeAttrs` moved subpath

`scopeAttrs` and `ScopeAttrsProps` are now exported from `@y-core/forge/ui/contracts` instead of
`@y-core/forge/ui/server`. Both are published subpaths, so the old import stops resolving. The
symbols and their signatures are unchanged — change the path and nothing else:

```ts
// before
import { scopeAttrs, type ScopeAttrsProps } from "@y-core/forge/ui/server";
// after
import { scopeAttrs, type ScopeAttrsProps } from "@y-core/forge/ui/contracts";
```

```bash
rg -n 'scopeAttrs|ScopeAttrsProps'
```

---

## The diagnostic — an absent `csrfProtection` now refuses `_csrf`

Nothing is dropped on a guess. `csrfProtection` publishes the field it took the token from on
`csrfFieldCtx`, and the pipeline drops exactly that. Absent `csrfFieldCtx` means no guard ran, so
nothing consumed the field — and a submitted `_csrf` is an ordinary undeclared field a strict schema
is right to refuse.

Read this as the report it is, not as a regression. A form rendering a CSRF token against a route
where the middleware was never mounted was **already** unprotected; the token was decoration. What
changed is that the mismatch is now visible on the first submission instead of being absorbed
forever. The fix is to mount the guard, not to relax the schema. A permissive default and a blanket
`403` were both considered and rejected —
[`.decisions/ROUTING_AND_MIDDLEWARE.md`](.decisions/ROUTING_AND_MIDDLEWARE.md) §2b has the argument.

A route that renamed the CSRF field declares the new name **once**, to `csrfProtection`'s
`tokenField`. Nothing declares it a second time; that is what removing `injectedFields` bought.

---

## Tests to add, and one to rewrite

**Add a filled-honeypot rejection test per protected route.** This is the single test that makes the
`honeypot:` hazard non-silent for an app on a non-strict schema, and it is cheap: post a body with
the decoy field filled and assert the refusal.

```ts
it("refuses a submission with the decoy field filled", async () => {
  const res = await app.request("/api/contact", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: token, [CONTACT_DECOY]: "bot", name: "Jane", email: "j@x.test", message: "…" }),
  }, MINIMUM_ENV);

  expect(res.status).toBe(422);
});
```

Assert the status, not the body text: the refusal a tripped guard renders is byte-identical to the
one a real validation failure renders, deliberately, so that a bot cannot tell a guard from a
mistyped field by comparing them. A test that pins the body to a guard-specific string is asserting
a property forge does not have.

**Rewrite the contract test that pinned rendered field names against `readFields` — do not delete
it.** It was the right test: it caught a drift between what the view submits and what the handler
reads, which crafted-body worker tests structurally cannot see. `readFields` no longer exists, so
the contract now sits between the view and the **schema**:

```ts
import { CSRF_FIELD_DEFAULT, TURNSTILE_FIELD_DEFAULT } from "@y-core/forge/form";

const rendered = [...html.matchAll(/<(?:input|textarea)\b[^>]*\bname="([^"]*)"/g)].map((m) => m[1]);
const declared = Object.keys(ContactSchema.entries);
const injected = [CSRF_FIELD_DEFAULT, CONTACT_DECOY, TURNSTILE_FIELD_DEFAULT];

expect(rendered.filter((n) => !injected.includes(n))).toEqual(declared);
```

The three injected names are excluded because the pipeline drops each of them before validation, so
the schema declares none. Keeping them in the assertion as an explicit list is the point: it fails
if the view stops rendering one, which is the drift that matters.

---

## Audit checklist

Each item is a check to run, not advice. Run them against the consuming app.

**1. Every `defineAction` call site.** Confirm each has `schema`, and `honeypot` / `turnstile` where
its view renders those fields.

```bash
rg -n 'defineAction' --glob '*.ts' --glob '*.tsx'
```

**2. Removed symbols.** These are compile errors, but the grep is faster than the compiler and tells
you the size of the job.

```bash
rg -n 'readFields|readTextField|FormFieldReader|injectedFields|form-honeypot'
```

**3. Every hand-rolled body read.** Each hit is a last-wins or first-wins reader to replace with
`formToObject`. Include webhook and API handlers, not only form routes.

```bash
rg -n 'Object\.fromEntries|formData\.get\(|formData\.getAll\(|\.entries\(\)'
```

**4. Every schema field that is optional in the form but not in the schema.** List the inputs the
markup does not mark `required`, then confirm each corresponding schema field is `v.optional`.

```bash
rg -n '<(input|textarea)' --glob '*.tsx' | rg -v 'required'
rg -n 'v\.pipe\(' -A 1 --glob '*model*'
```

**5. Every route rendering a decoy or the Turnstile widget.** Each needs the matching option on its
action; each rendered field name must be the same app-owned constant the action names.

```bash
rg -n '<Honeypot|mountTurnstile|cf-turnstile|turnstileSiteKey|HONEYPOT_FIELD_DEFAULT'
```

**6. Every place a `200`-from-a-refusal was worked around.** Restore a `422` entry, remove any `200`
entry added for this path, and delete any body-inspection that stood in for a status check.

```bash
rg -n 'responseHandling' -A 10
rg -n 'abortPipeEarly'
```

**7. Every test asserting a refusal's status or body.** A status assertion is likely still correct; a
body assertion reading a valibot message, a rejected value, or a per-field list is not.

```bash
rg -n 'toBe\(4[0-9][0-9]\)|toBe\(200\)' --glob '*.test.ts*'
rg -n 'issue\.message|issues\.map|formatValidationIssues|renderValidationErrors' --glob '*.test.ts*'
```

**8. Every `csrfProtection` mount against every form that renders a token.** A form rendering
`_csrf` on a route with no guard now refuses every submission.

```bash
rg -n 'csrfProtection'
rg -n 'csrfToken|_csrf|CSRF_FIELD_DEFAULT'
```

**9. `formatValidationIssues` in any response path.** It reproduces `issue.message` and is an
internal diagnostic. Map through `describeValidationIssue` for anything a caller reads.

```bash
rg -n 'formatValidationIssues'
```

**10. `v.strictObject` adopted as `strictObject`.** The `validation` export corrects the inherited
key set that raw `v.strictObject` does not; the opt-in is visible at the call site.

```bash
rg -n 'v\.strictObject'
```

**11. `scopeAttrs` imported from `ui/server`.** The symbols moved to `ui/contracts`; only the import
path changes.

```bash
rg -n "ui/server'|ui/server\"" -A 2 | rg -n 'scopeAttrs|ScopeAttrsProps'
```
