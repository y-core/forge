# Forge — Full-Codebase Code Review

> Tracking document for the comprehensive review of the forge codebase (454 files, ~44k LOC,
> 20 namespaces). 11 finder passes with adversarial verification surfaced **15 verified defects**
> plus a long tail; 7 are security-relevant.
>
> **Not published.** `package.json` `files` is an allowlist naming only `README.md` at root, so
> this file never ships. It is also outside `scripts/validate-docs.ts`'s walk (`.decisions/`,
> `.claude/agents/`, `CLAUDE.md`, `README.md`), so the `## 0. Quick Reference` format and size
> limits do not apply here.

## Ground rules

Per [`CODE_REVIEW.md`](.decisions/CODE_REVIEW.md) §2, a row may only be ticked once **both** a
pass and a fail test exist for it and `bun run check` is green. Assertions are exact-match
accounting for HTML entities — never substring ([`TESTING.md`](.decisions/TESTING.md)).
Pre-v1.0.0: no deprecation shims, no back-compat paths.

Severity per [`CODE_REVIEW.md`](.decisions/CODE_REVIEW.md) §4.

---

## Wave 1 — Security

One commit per finding.

| ID | Location | Sev | Defect | Fix | Required test | Done |
|---|---|---|---|---|---|---|
| W1-1 | `src/storage/db/sql.ts:17,29` | Critical | `isSqlFragment` is an unbranded structural duck-type. Attacker-controlled JSON shaped `{text,params}` interpolated into `` sql`…` `` is concatenated raw (line 18) instead of bound — SQL injection. | Brand `SqlFragment` (`src/storage/db/types.ts:9`) with a `unique symbol` key, unforgeable from `JSON.parse` output; `sql()` sets it; `isSqlFragment` checks the brand. | Attacker-JSON injection repro: `JSON.parse('{"text":"1=1 OR 1=1","params":[]}')` interpolated must bind as a param, not concatenate. Pass: a real `sql` fragment still flattens. | [x] |
| W1-2 | `src/security/cop.ts:22,69` | Critical | Only `cross-site` is rejected, so `same-site` passes — any sibling subdomain drives authenticated POSTs. Line 69 additionally returns early when `Sec-Fetch-Site` is present, so `originProtection` skips `allowedOrigins` entirely (forgeable by any non-browser client). | Accept only `same-origin`/`none` (Go 1.25 `http.CrossOriginProtection` parity). Treat Sec-Fetch-Site as a **veto, not a pass**: drop the early return, consult `allowedOrigins` whenever Origin or Referer is present, and fall back to the browser's vouching only when both are absent. Fail closed otherwise. | Fail: `same-site` POST → 403. Fail: `same-origin` POST with a disallowed `Origin` → 403. Pass: `same-origin` POST with an allowed `Origin` → 200. Pass: `same-origin` POST with no Origin/Referer → 200. | [x] |
| W1-3 | `src/security/cors.ts:11,12` | Major | Wildcard expands to `[^.]+`, which matches `/`, `:` and `@` — `https://a/b.example.com` satisfies `https://*.example.com` and is reflected into `Access-Control-Allow-Origin`. | Expand `*` to `[^./:@]+`; add `?` to the escape class on line 11. | Fail: `https://a/b.example.com` vs `https://*.example.com` → no match. Pass: `https://api.example.com` → match. | [x] |
| W1-4 | `src/router/filter.ts:16` | Major | Strict `===` misses `ANY` routes. Upstream `@remix-run/fetch-router` builds bare-string routes as method `ANY` and dispatches them for every method, so `routePaths(routes, {method:"POST"})` returns `[]` and a guard silently attaches to nothing. | Treat `ANY` as matching any method filter. Fail loudly on an empty result. | Fail: a bare-string route map filtered by `{method:"POST"}` must include the `ANY` path. Pass: an explicit `GET` route is excluded by a `POST` filter. | [x] |
| W1-5 | `src/form/csrf.ts:137` | Critical | `ring.keys[_kid]` on a plain object walks the prototype chain — kid `constructor` returns a truthy non-`CryptoKey`, passes the `!key` guard, and throws an uncaught `TypeError` from `crypto.subtle.verify`. Unauthenticated single-request 500 on every guarded mutation route. | `Object.hasOwn(ring.keys, _kid)` (or move the ring to a `Map`). | Fail: `X-CSRF-Token` whose payload kid is `constructor` → 403, not 500/throw. Pass: a valid kid still verifies. | [x] |
| W1-6 | `src/session/anonymous.ts:66` | Critical | Cache key is `${cookieName}\|${secure}\|${secret}` but the cached closure captures the per-request `options.kv(c)` (line 79). Two tenants sharing a cookie name, secure flag and secret read/write each other's KV namespace. Also an unbounded `Map` under a rotating secret. | Key on the `env` object via `WeakMap`. `src/form/csrf.ts:180-193` is the in-repo reference implementation. | Fail: two-tenant isolation — tenant A writes, tenant B (distinct `env`, distinct KV) must not read it. Pass: same `env` across requests reuses one middleware. | [x] |
| W1-7 | `src/assets/build/sprites.ts:172` | Major | The event-handler strip is the only regex in `sanitizeSVG` without `i` (every sibling on 155–163 uses `/gi`), so `ONMOUSEOVER=` survives; HTML lowercases it back into a live handler. | `/gi`. | Fail: `<path ONMOUSEOVER="alert(1)"/>` is stripped. Pass: `onmouseover` (already handled) stays stripped; a legitimate `on`-prefixed non-handler attribute is unaffected. | [x] |

### W1-2 resolution note

The plan left open whether to drop the "COP authoritative" early return. Determination: **drop it,
but keep Sec-Fetch-Site as a veto**. Rationale:

- `Sec-Fetch-Site` is a forbidden header name, so web content cannot forge it and a browser is
  never tricked into sending `same-origin` cross-origin. For **CSRF** alone, the early return
  loses nothing — which is why Go's implementation stops there.
- But forge's `allowedOrigins` is an allowlist, and the sibling tier `originGuard` enforces it
  unconditionally. The early return let the two tiers disagree and let any non-browser client skip
  the allowlist with one forged header.
- `verifyOrigin` returns `err("missing")` when Origin **and** Referer are both absent, so a naive
  deletion would 403 legitimate browser POSTs that carry no Origin. The fallback preserves those.

**Behaviour change:** an app must now list its own origin in `allowedOrigins` or its own
same-origin POSTs are rejected. Fail-closed, and consistent with `originGuard`.

---

## Wave 2 — `src/testing/fakes.ts`

Gates Wave 3. The fakes diverge from the real bindings, making whole classes of tests false
passes; `fakeKV`'s lossiness is what hides W3-5.

| ID | Location | Sev | Defect | Fix | Required test | Done |
|---|---|---|---|---|---|---|
| W2-1 | `src/testing/fakes.ts` (`fakeKV`) | Major | Stores every value as a JS string via `TEXT_DECODER.decode(value)`, so binary round-trips are lossy. Also drops `expirationTtl`. | Store bytes verbatim; honour `expirationTtl`. | Round-trip of a non-UTF-8 byte sequence is byte-identical; `expirationTtl` is observable. | [x] |
| W2-2 | `src/testing/fakes.ts` (`fakeR2`) | Major | Ignores `range`. | Honour `range` on `get`. | A ranged `get` returns exactly the requested slice. | [x] |
| W2-3 | `src/testing/fakes.ts` (`fakeD1`) | Minor | Never fails, so no consumer error path is exercised. | Add opt-in failure injection. | A client's error branch is reachable and returns the `Result` error shape. | [x] |

Existing tests are expected to break here. Each break is either a real bug or a test that was
asserting the fake's behaviour rather than the binding's — triage, don't paper over.

### Wave 2 triage outcome — the premise was partly wrong

**Zero tests broke** (2037 pass, 0 fail), and that is a real result rather than a missed check.
The framing above — "the fakes diverge from the real bindings, making whole classes of tests false
passes" — assumed the fakes were widely used. They are not: inside this repo the shared fakes are
imported only by `src/testing/fakes.test.ts`. Every storage suite
(`src/storage/{kv,db,r2}/*.test.ts`) hand-rolls a **local stub** instead — `makeKVStub`,
`makeD1Stub`. So the fakes' lossiness was never load-bearing for any assertion, and the triage
found nothing in category (a) or category (b).

That is worth recording as its own smell: a shared test fixture that the suites it exists for do
not use is dead weight, and the hand-rolled stubs are the place divergence will actually hide.
Consolidating them is a design question, not a defect — not actioned here.

W2-1 did what it was supposed to for W3-5: with a byte-accurate `fakeKV`, driving `createKVStore`
with `bytesCodec()` over `new Uint8Array([1,2,3,4,5,6]).subarray(2,4)` yields the **whole** backing
buffer (`[1,2,3,4,5,6]` where `[3,4]` was expected) with `ok: true`. Directly demonstrable.

---

## Wave 3 — Correctness, app-breaking

| ID | Location | Sev | Defect | Fix | Required test | Done |
|---|---|---|---|---|---|---|
| W3-1 | `src/ui/client/signal.ts:41-49,59-65` | Critical | `depth++ … depth--` and `activeEffect = node … = prev` have no `try/finally`. One throwing effect leaves `depth > 0` forever → `epoch` freezes → every signal write page-wide silently stops re-running every effect, with no further error. The `activeEffect` leak also pins a dead node as the global tracking target. | `try/finally` on both. | Fail: a throwing effect must not stop a subsequent signal write from re-running an unrelated effect. Pass: normal batching still coalesces. **`signal.ts` is pure JS with no DOM dependency and `signal.test.ts` already runs under `bun test` — the test belongs there, inside the gate, not in the browser suite.** | [x] |
| W3-2 | `src/app/forge-app.ts:132` | Critical | `resolveConfig` runs before the `try` on line 136, so an invalid env throws out of `fetch()` past the error boundary, logger, `_onError` and hardening headers — the raw Workers 1101 page. `Config.get` caches only on success, so it throws forever. Related: line 124 places `errorBoundary` innermost, so a throw from any `app.use` guard also bypasses `applyHeaders`. | Move `resolveConfig` inside the `try` so failures route through `_handleError`; reorder so `errorBoundary` wraps the guard stack. | Fail: an invalid env yields the app's error response with hardening headers, not a raw throw. Fail: a throwing `app.use` guard is caught and still gets headers. Pass: valid env unaffected. | [x] |
| W3-3 | `src/form/parse-form-data.ts:49` | Major | `options` is read only inside `if (!cached)`, so the first caller's `maxBytes` wins permanently. `csrf.ts:217` always parses first at the 100 KiB default and its bare `catch {}` swallows the 413 → a CSRF-guarded route can never raise its cap and answers a misleading 403. | Key the cache on `maxBytes` (or validate against the cached entry). Thread options through `defineAction` (`src/app/action.ts:40`). | Fail: a route configured above 100 KiB behind `csrfProtection` accepts a body over the default cap. Pass: a body over the route's own cap still 413s. | [x] |
| W3-4 | `src/config/config.ts:76` | Major | `optionalGroup`'s `entries` are a type carrier only — the sole runtime read is `Object.keys(entries)` on line 62, and line 76 is `return result as Output` over a spread of raw input. A number or a binding object passes as a validated `string`. Violates "validation first" ([`PRODUCTION_TS_RULES.md`](.decisions/PRODUCTION_TS_RULES.md)). | Actually run each key's schema in the transform; decide explicitly whether unknown keys pass through or are stripped. | Fail: a non-string value for a `string` entry is rejected. Pass: a valid group parses and the group stays optional when absent. | [x] |
| W3-5 | `src/storage/kv/codec.ts:15` | Critical | `encode: (value) => value.buffer` ignores `byteOffset`/`byteLength`, so a `subarray`/view writes the **entire** backing buffer to KV — wrong length plus adjacent-buffer disclosure, durably, with `ok: true`. | Slice the view's exact range. | Fail: a `subarray` view round-trips to exactly its own bytes, not the backing buffer. Pass: a whole-buffer `Uint8Array` is unchanged. Depends on W2-1. | [x] |
| W3-6 | `src/app/page.ts:67` | Major | `PageDefinition.action` is declared (`src/app/types.ts:61`), exported and documented (`src/app/README.md:154`) — and never read. `method` is hardcoded `"GET"` and `actionData` `undefined`, so a POST through `definePage` type-checks and is then silently discarded with a 200. | **Wire `action` into the pipeline** (decision: wire, not delete). Dispatch non-GET to `action`, pass its result as `actionData`, and route errors through the existing boundary. | Fail: a POST through `definePage` with an `action` invokes it and its result reaches the view as `actionData`. Pass: a GET still skips `action` and renders with `actionData: undefined`. | [x] |
| W3-7 | `src/ui/client/dom.ts:97` | Critical | `closestAcross` duck-types a shadow boundary on `.host`, but `HTMLAnchorElement.host` is the URL's host **string**. Any `<a href>` in the climb makes `current` a string → the next iteration throws `TypeError: current.getRootNode is not a function` out of the delegated document listener on **every link click**. Reachable from `resume.ts:200`, `bind.ts:93`, `tabs.ts:52`, `number-field.ts:13`. | Test `nodeType === 11` (`DOCUMENT_FRAGMENT_NODE`) instead of `.host` truthiness. | Fail: a click on an `<a href>` nested in the climb resolves without throwing. Pass: a genuine shadow-root crossing still resolves. **This is a real-DOM defect (`HTMLAnchorElement.host` is a URL string), so the test belongs in the existing `src/ui/client/dom.browser.ts` — do not create a `dom.test.ts`.** Browser suite. | [x] |

### W3-2 resolution note — the boundary is at **two depths**, not moved outward

The instruction was "reorder so `errorBoundary` wraps the guard stack rather than sitting
innermost." **That was not done as written**, and the reason is a documented invariant:

```
before:  provideRequestState → applyHeaders → guards → errorBoundary → route
after:   provideRequestState → applyHeaders → errorBoundary → guards → errorBoundary → route
```

Moving the innermost boundary outward regresses [`ERROR_HANDLING.md`](.decisions/ERROR_HANDLING.md)
§5b, which states that an in-chain error's response "flows back out through the path-scoped guards
… so error pages carry the consumer's full CSP". That holds **only** because
`createSecurityHeaders` queues its headers *after* `await next()`. If a route throw propagates past
it to a boundary sitting outside, the queuing never happens and every error page loses HSTS/CSP —
the existing test `attaches CSP, HSTS, and X-Content-Type-Options to a 500 response` fails.

So the innermost instance was kept and an outer one added. The two positions carry genuinely
different guarantees, documented at the registration site. The plan's *intent* — that neither an
invalid env nor a throwing `app.use` guard escapes without hardening headers — is satisfied, and
both required tests exist and pass.

**Flagged, not actioned:** making `createSecurityHeaders` queue *pre-*`next` would allow a single
outer boundary, but it inverts header-conflict precedence for every consumer (outer middleware
currently wins). That needs its own decision.

One consequence stated honestly rather than papered over: on the **guard-throw** path the response
carries only *baseline* hardening, because the security guard never reached its post-`next` queue.
The new test asserts exactly that rather than pretending otherwise.

### W3-3 resolution note — validate against the cached entry, don't key on `maxBytes`

Keying the cache on `maxBytes` (the row's first suggestion) is wrong here: **a body is readable
exactly once**, so a second caller with a different cap would re-parse an already-consumed stream
and get a confusing "body used" error instead of a 413. Instead the first call meters the read, the
cache entry records the bytes actually seen, and every later caller compares that count against its
own cap. A stricter caller still gets an honest 413 off the shared parse; nobody silently inherits
the first caller's budget.

`csrf.ts`'s bare `catch {}` now returns a real **413** rather than letting it propagate: propagating
reaches the app error boundary as an opaque **500** and logs it as an unhandled server error —
trading one misleading status for a worse one. Non-413 parse failures still fall through to 403,
unchanged.

**Beyond the row's literal text:** `CsrfProtectionOptions.maxBytes` was added. The row named only
`defineAction`, but its own acceptance test is unreachable without it — `csrfProtection` runs
*first* and short-circuits, so the handler's cap never gets a say. Both sides must be raised
together.

### W3-4 resolution note — unknown keys are **stripped**

`optionalGroup` now runs each entry's schema via `v.nullable(v.object(entries))`. `v.object`
builds a fresh output containing only declared keys, so **unknown keys are silently stripped**.

- `v.object` (strip) was chosen over `v.strictObject` (error) because a Workers `env` legitimately
  carries many unrelated bindings — erroring would make the common case fail.
- Passing unknowns through would place arbitrary binding objects inside a value *typed* as a
  validated group, which is the identical bug class W3-4 reports.
- Safe to change: `optionalGroup` has **no callers** in the repo outside `src/config`, and all 32
  pre-existing tests pass unmodified.

**Two behaviour changes fall out of "actually run each schema", both breaking:**

1. A `defaults` value must now satisfy its own entry schema — defaults are filled in *before*
   validation.
2. A key that is neither required nor defaulted is now validated, so it **must** be declared
   `v.optional(...)` if it may be absent. Previously it silently passed as `undefined` while typed
   `string` — which is the defect.

---

## Wave 4 — SSR / UI, observability, conventions

### JSX / UI

| ID | Location | Sev | Defect | Fix | Done |
|---|---|---|---|---|---|
| W4-1 | `src/jsx/render-to-string.ts:84` | Major | The blanket `value === false → continue` precedes the `aria-` branch at line 96, so `aria-expanded={false}` renders nothing. `src/jsx/types.ts:33,36,41,42` type these as `boolean`, so it type-checks. | Let `aria-*` serialize `false` as `"false"`. **Revert the call-site workarounds** it forced: `String(pressed)` at `toggle.tsx:42`, `tabs.tsx:70`, `menu.tsx:156`, `toggle-group.tsx:76` — **plus `menu.tsx:170`, a fifth site this row missed** (`RadioItem`, identical to `CheckboxItem` at `:156`). | [x] |
| W4-2 | `src/ui/core/tabs.tsx:72` | Major | Missing `ACTIVE_COMPOSITE_ITEM`, so `composite.ts:261` resolves the initial roving-focus index to 0 and the first Tab keypress reselects tab 0. | Follow `toolbar.tsx:60`: `...(pressed ? { [ACTIVE_COMPOSITE_ITEM]: "" } : {})`. | [x] |
| W4-3 | `src/ui/client/resume.ts:48,89` | Major | Module-level `disposers` grows unbounded across htmx swaps, pinning detached DOM and live `MutationObserver`s; `resumed` is not cleared on teardown. | Dispose and drop entries on teardown. Implemented as a root-keyed `active` map plus a `sweepDetached` pass on re-resume, so one scope can be dropped alone; `resumed` is now cleared per root too. `htmx.ts` needed no change — the replacement scope resuming is what triggers the sweep. | [x] |
| W4-4 | `src/ui/core/switch.tsx:13`, `toggle-group.tsx:77` | Major | Pressed state is baked into a static SSR class while the controller only flips attributes no stylesheet keys on — the visual state never moves. | Key the styling off the attribute the controller actually toggles. **The row is right about `toggle-group.tsx` and half-wrong about `switch.tsx` — see the note below.** | [x] |
| W4-5 | `src/ui/core/utils/as-child.ts:44` | Major | Spreads `type: undefined` / `disabled: undefined` over the child's own props; a child `<button type="button">` becomes an accidental submit. | Omit undefined-valued keys before spreading. | [x] |
| W4-6 | `src/ui/core/field.tsx:86` | Major | `aria-describedby` always points at `field-<name>-description` even when none renders (dangling IDREF); name-only ids collide across two forms on a page. | Emit `aria-describedby` only when a description renders; scope ids. Id scoping is **caller-opt-in** (`FieldDescriptor.scope`), not automatic: deriving a unique id without a caller-supplied scope needs module-level mutable state, which `PRODUCTION_TS_RULES.md` §1 forbids. Default output is byte-identical to before. | [x] |
| W4-7 | `src/ui/chrome/navbar.tsx:181` | Minor | Duplicate ids when two navbars share a page. | Scope ids per instance. Follows `ui/chrome/toolbar.tsx` (the sibling solving this exact problem), not `field.tsx`: `idBase = id ?? placement`. **Residual, deliberate:** two navbars with no `id` and the same `placement` still collide — that is `toolbar.tsx`'s documented posture verbatim, and the escape hatch is the `id` prop. Fully instance-unique ids would need module-level counter state (banned by `PRODUCTION_TS_RULES.md` §1) or new public API. | [x] |
| W4-8 | `src/storage/r2/serve.ts:27` | Major | The "ASCII fallback" strips only C0/DEL, so a CJK filename throws on `Headers.set` → 500. | Produce a genuinely ASCII fallback alongside the RFC 5987 `filename*`. Approximation chosen: NFKD-fold accents to their base letter, collapse each remaining run of non-printable-ASCII to a single `_`, emit `"`/`\` as quoted-pairs, fall back to `download` only for an empty name. Substituting **in place** means every ASCII character survives — including the dot and extension — with no filename parsing (`年度報告.pdf` → `_.pdf`, `invoice-年度.pdf` → `invoice-_.pdf`). | [x] |

### W4-1 resolution note — two sites deliberately not reverted

Both were checked against the "is this the same workaround?" test and failed it:

- **`src/ui/core/toolbar.tsx:59`** — carries **no cast**, so there is no type lie to remove; it is a
  value in a `Record<string, string>` attribute map whose every other member is a string by design
  (reverting would widen the return type and desynchronise it from `stateAttrs`). Decisively, it
  **never depended on the bug**: the explicit `pressed === undefined ? {} : …` guard already
  distinguishes "no such state" (omit) from `false` (emit `"false"`) — exactly the distinction W4-1
  is about. It was already correct.
- **`src/ui/core/icon.tsx:52`** — `aria-hidden={ariaLabel ? undefined : String(ariaHidden)}`. A
  fourth `String()` site this row did not list, but `ariaHidden` is typed `string | boolean` and
  defaults to the *string* `"true"`, so this is genuine union narrowing, not a renderer workaround.

**Consumer-visible consequence.** A consumer passing `aria-invalid={false}` (or any explicit
`aria-*={false}`) now gets `aria-invalid="false"` where they previously got nothing at all. That is
the intended fix rather than a side effect, but it **is** a rendered-output change for code outside
this repo. Forge's own five components are unaffected: their output was already `"false"` via the
casts, verified byte-for-byte across 19 rendered variants before and after.

### W4-4 resolution note — the row is right about one file and half-wrong about the other

Diagnosed separately, as the two files fail differently.

**`toggle-group.tsx` — the row is exactly right.** `bindGroup` → `setPressed` writes only
`aria-pressed` and `data-pressed` (via `applyStateAttrs`), but `ITEM_ACTIVE` was applied as
`pressed && ITEM_ACTIVE` **at render**, so the highlight was frozen on whichever item the server
rendered pressed. Fixed by making the class unconditional and keying it on `data-[pressed]:`. Side
benefit: `[data-pressed]` raises specificity, so `data-[pressed]:hover:bg-primary` now reliably
beats `hover:bg-accent` instead of depending on stylesheet emission order.

**`switch.tsx` — there is no controller and no attribute here.** The state is the native
`:checked`, which `UI_SSR_COMPONENTS.md` §1e ratifies. So the row's stated cause does not apply.
But a **worse** bug was found underneath it:

- The **track** is a following sibling of `.peer`, so `peer-checked:bg-primary` genuinely matches —
  that half was never broken.
- The **thumb** is a *child of the track*, not a sibling of the input. `peer-checked:` compiles to
  `:is(:where(.peer):checked ~ *)` — a **general-sibling** combinator. So
  `peer-checked:translate-x-4` on the thumb **matched nothing, ever**: the switch has never
  animated its thumb, in any release.

Re-keyed to a descendant selector anchored on `data-slot`, matching the existing idiom in
`toggle-group.tsx`:
`[[data-slot=switch-input]:checked~[data-slot=switch-track]_&]:translate-x-4`

### Logging / conventions

| ID | Location | Sev | Defect | Fix | Done |
|---|---|---|---|---|---|
| W4-9 | `src/logging/request-logger.ts:37` | Major | Error branch unreachable; every 500 persists with no detail. | Fixed **not** by making that branch reachable — the defect is not in this file. `requestLogger` is registered via `app.use("*", …)` so it sits **outside** the innermost `errorBoundary`; a handler throw is caught below it and converted to a 500 `Response`, so `await next()` resolves and the success branch logs no error. The boundary is deliberately innermost (see W3-2), so the fix publishes the error *from* the boundary that already holds it: `requestLog.getOptional(context)?.error("unhandled error", { error: serializeError(err) })` in `Forge._handleError`. No ordering change, no new public symbol. The `catch` at `:37` **stays** — it is still reached when a throw escapes `next()` from middleware below `requestLogger`, and on that path it is the only thing that gets error detail into the flushed batch (the outer boundary records *after* `waitUntil(log.flush())` was already scheduled). | [x] |
| W4-10 | `src/logging/kv-channel.ts:23` | Minor | `Object.fromEntries` collapses `Date`/`Map`/`Set` to `{}`. | Serialize those shapes meaningfully. `Date` → ISO 8601 (invalid → `null`, since `toISOString()` throws and the log path must not); `Map`/`Set` → tagged forms that rebuild. Cycles cut with a `WeakSet` of the **currently open path**, so a repeated *sibling* reference survives and only true ancestors become `"[circular]"`. | [x] |
| W4-11 | `src/logging/show/route.tsx:64` | Major | Unvalidated `?level=` cast straight to `LogLevel`. | Validate at the boundary ([`INPUT_VALIDATION.md`](.decisions/INPUT_VALIDATION.md)). Invalid value **drops the filter and renders unfiltered**, not 400 and not fail-closed: the level filter *narrows* a row set the caller was already authorised to read in full (`access` ran first), so widening back cannot expose anything the guard did not permit — it is not an authorization input. Matches `parseLogLevel`'s existing posture. Required a newly **declared** `logging/show → validation` edge in `NAMESPACE_DESIGN.md` §4b. | [x] |
| W4-12 | `src/logging/show/components.tsx:168` | Major | "Load more" `outerHTML`-swaps the tbody, destroying loaded rows and dropping the active `level`/`q` filters. | Append instead of replace; carry the filters. Implemented as `hx-target="closest tr"` + `outerHTML` — **not** `beforeend`. `HTMX.md` §6d's append default is wrong here because the control's `<tr>` lives *inside* the tbody it would append to, so `beforeend` would leave a spent control below the new rows still pointing at the consumed cursor (a second click refetches the same page), and would nest a `<tbody>` fragment inside a `<tbody>`. Replacing the control's own row is htmx's canonical click-to-load, is an append in effect, and is self-cleaning. | [x] |
| W4-13 | `src/html/htmx/htmx-patterns.ts:24` | Major | `withQueryParam` discards scheme + host of an absolute `get`. | Preserve the absolute URL. | [x] |
| W4-14 | `src/security/request-id.ts:24` | Minor | `??` lets a client-supplied empty `CF-Ray` through. | Treat empty as absent. Note: `Headers` normalizes `" \t "` to `""` before the middleware runs, so the whitespace case is not independently observable through `app.request` — the `.trim()` guard is real (it covers a non-`Headers` request object) but its test passes partly for that reason, and says so in a comment. | [x] |
| W4-15 | `src/ui/core/form.tsx:58-59` | Major | Hardcodes `"_csrf"` / `"__surname"`. CLAUDE.md's Source-of-Truth Register names `src/form/constants.ts` their sole owner — renaming the constant today silently disables the honeypot with a green gate. | Import the constants. The `ui/core → form` edge was **already declared** at `NAMESPACE_DESIGN.md:217` — the doc was ahead of the code, so no declaration work was needed. Tests interpolate the imported constants into the expected HTML, so a rename fails loudly instead of silently disabling the honeypot. | [x] |

### Enforcement-script gaps

Land last; each with a regression fixture.

| ID | Location | Sev | Defect | Fix | Done |
|---|---|---|---|---|---|
| W4-16 | `scripts/validate-exports.ts:26` | Major | `hasExportStar` misses `export * as ns from`. | Match the namespaced form too. | [x] |
| W4-17 | `scripts/validate-exports.ts:119` | Major | The `@public` lookahead window is 9 lines; a longer TSDoc block silently drops the symbol from the barrel check. | Scan the whole preceding TSDoc block rather than a fixed window. | [x] |

---

## Tests that currently pin broken behaviour

A green gate on these is the bug, not the baseline. Each **must** change alongside its fix.

| Test | Pins | Fix |
|---|---|---|
| `src/security/cop.test.ts:44` | `same-site` POST asserted as allowed | W1-2 |
| `src/security/cop.test.ts:112,118` | "COP authoritative" early return | W1-2 |
| `src/router/filter.test.ts:9` | A `POST` filter asserted to exclude the `ANY` route `/api/any` | W1-4 |
| `src/router/filter.test.ts:13` | A `GET` filter asserted to exclude the `ANY` route `/api/any` | W1-4 |
| `src/storage/r2/serve.test.ts:155-163` | The lossy ASCII filename fallback | W4-8 |
| `src/ui/core/field.test.tsx:34,50` | The dangling `aria-describedby` IDREF | W4-6 |
| `src/ui/core/tabs.browser.ts:35` | The missing `ACTIVE_COMPOSITE_ITEM` | W4-2 |

---

### W4-16 / W4-17 resolution note

**A third defect fell out of the fixtures.** Searching *forward* from the TSDoc block's start —
the literal wording of W4-17's fix — makes an `export const …` line inside an `@example` look like
the declaration. The old code did exactly this: for a symbol documented with an example, it
returned `["example"]` instead of `["buildConfig"]`. The implementation therefore starts the
declaration search at the block's **last** line, with the original 9-line allowance measured from
there. The stated goal (window determined by the comment's actual extent) is met; the literal
instruction is not, deliberately.

**Structural decision worth review.** The parsers were extracted to a new
`scripts/barrel-parse.ts`, and the tests co-locate as `scripts/barrel-parse.test.ts`. Reason:
`validate-exports.ts` executes at top level and ends in `process.exit(1)`, so a co-located test
importing it would run the entire gate inside `bun test` and could kill the run. The alternative —
wrapping ~355 lines in `if (import.meta.main)` — is a whole-file reindent far larger than these two
findings warrant. `validate-exports.ts` remains the entry point and retains **every policy
decision**, so CLAUDE.md's Source-of-Truth Register entry ("Barrel rules as *enforced*") still
resolves to it. If the Register is read as requiring the matchers themselves to live in that exact
file, this is the decision to revisit.

**Policy question left open, deliberately.** `export type * from` remains unflagged — it was
unflagged before (the old regex could not match across the `type` token), and W4-16 named it as a
false-positive risk. Existing behaviour is now pinned by a test rather than silently widened.
`NAMESPACE_DESIGN.md` §1b bans `export * from './foo'` and is **silent** on the type-only form;
whether it should be banned is a policy call, not a defect fix.

**No violations surfaced in `src/`**, checked directly rather than inferred: `rg 'export\s*\*'`
over `src/` returns zero hits, and diffing old vs. new `findPublicSymbols` across every non-test
source file shows exactly one difference (`src/html/htmx/mod.ts`), which is a module-level `@public`
in a barrel's own header — a file `collectOwnedSourceFiles` excludes from that pass anyway.
`bun run validate-exports` output is byte-for-byte identical to the pre-change baseline.

---

## Findings surfaced during remediation — resolved

Each was found while fixing an adjacent row, recorded rather than folded into an unrelated fix, and
resolved in the follow-up pass below. Every claim was re-verified against the tree before being
acted on; **four of the eight rows were wrong as recorded**, in both directions. The corrections are
stated per row and summarised under *Corrections* after the table.

Severity is by consequence, not by effort ([`CODE_REVIEW.md`](.decisions/CODE_REVIEW.md) §4).
Several rows were originally deferred for scope reasons, which that rubric rejects as a basis.

| Location | Observation as recorded | Resolution |
|---|---|---|
| `src/ui/client/dom.ts` — `closestAcross` fallback branch | The **same** `.host`-truthiness defect as W3-7 appears a second time in the `getRootNode()` fallback. | **Fixed** (F1). Extracted a private `shadowHost(node)` carrying the `nodeType === 11` guard, and routed all three reads through it. **Two corrections:** the finding said "latent — every call site passes attached nodes", but `closestAcross` is **public API** (`ui/client/mod.ts`, `ui/README.md`), so that bounds forge's callers and not consumers'; and it listed four call sites when there are six (`resume.ts:224` and `bind.ts:99` are missing). A third correction came from the tests: a **relative** `href` is not the safe case the old comment claimed — a *detached* anchor resolves it against the document base URL, so `host` is non-empty there too. Regression tests in `dom.browser.ts`. |
| `src/ui/client/dom.ts` — `contains` | *(not recorded — `grep contains code-review.md` returned zero hits)* | **Fixed** (F1). Carried the byte-identical unguarded `.host` read at the same fallback position, and is exported from `mod.ts` too. One of the two defects the original table missed. |
| `src/ui/client/signal.ts` — `effect(fn)` | A first-run throw propagates out of `effect()`, so the disposer is never returned; "bounded" because `cleanup` runs at the start of the next `run()`. | **Fixed** (F2). **The "bounded" characterisation was wrong.** `cleanup` is a no-op on the first run — `deps` is empty — so a signal read before the throw leaves the node in that signal's `subs` permanently, with no disposer in the caller's hands. Every later write to that signal then re-enters `run()` and rethrows out of the **setter**, at an unrelated call site, forever: a poisoned signal, not a bounded leak. The initial `run()` now unsubscribes on throw and rethrows. The pre-existing test could not see this because its throwing body read no signal. |
| `src/ui/client/signal.ts` — `epoch` / `depth` | Module-level mutable globals that `PRODUCTION_TS_RULES.md` §1 would flag. | **Resolved as documented** (F12), not fixed — **the finding was largely wrong.** §1a bans module-level mutables holding *request-scoped* data, with Workers isolate recycling as the stated rationale; `ui/client` never executes in a Worker (`UI_CLIENT_RUNTIME.md` §1, §5). The pattern is the house style across seven files there (`active-descendant.ts`, `resume.ts`, `nav.ts`, `turnstile.ts`, …) with no exemption marker anywhere. The finding also names two globals and **omits `activeEffect`** — there are three. New `PRODUCTION_TS_RULES.md` §1e states the carve-out explicitly, and notes that §4a (testability) — the rule this actually touches, and the one the finding did not cite — still applies in full. |
| `src/ui/core/checkbox-group.tsx`, `radio-group.tsx` | The identical dangling-IDREF defect as W4-6: `aria-describedby` emitted unconditionally. | **Fixed** (F3). Extracted `fieldDescribedBy` from `field.tsx` and had both groups call it, with new `description?` and `scope?` props. The groups genuinely **cannot** adopt `fieldControlProps` wholesale — a `<fieldset>` is not a labelable control — but the `aria-describedby` half is not structural. This was **live on the shipped showcase**, which rendered both groups with no `Description` child. New `checkbox-group.test.tsx` and `radio-group.test.tsx`; no existing assertion needed changing. |
| `src/ui/core/checkbox-group.tsx`, `radio-group.tsx` — `itemId` | *(not recorded)* | **Fixed** (F3). `itemId()` called `fieldId(name)` **without** the `scope` param W4-6 added, so *every item id* collided across two same-named groups, not just the description id. The second defect the original table missed. |
| `src/app/forge-app.ts` — `_handleError`'s console path | Records only `err.message`, losing `name` and `stack`. Left because widening it breaks one assertion in `app.test.ts`. | **Fixed** (F4). The "deliberate redaction" reading does not survive the docs: `STRUCTURED_LOGGING.md` §6a puts stacks in `consoleChannel` **only** and §2e has `kvLogChannel` strip them via `persistStack: false` — redaction is *channel*-level, not call-site-level. `this._logger` is a `consoleChannel`, i.e. the worker log stream; the HTTP response is separately guarded behind `isDebug`. Exactly one assertion changed, as predicted. |
| `src/app/forge-app.ts` — guard-throw path | Yields **two** error records; deduplication needs machinery judged worse than the redundancy. | **Fixed** (F5) — **the recorded finding concealed the real one.** `requestLogger`'s `finally` flushes *before* the boundary writes, and `flush()` **splices** the pending buffer, so the boundary's record lands in a buffer nobody awaits. Under a synchronous test channel both records are captured; under a real async `kvLogChannel` the boundary's record **may never persist before isolate teardown**. So production sees two records *or* one-plus-a-lost-one, and a dropped error record is strictly worse than a duplicated one. `_handleError` now schedules its own flush. The suite was structurally incapable of seeing this — the new tests use an asynchronous channel fixture, which is the only kind that can. Deduplication remains out of scope; the two are distinguishable by `message`. |
| `src/storage/kv/store.test.ts` — `makeKVStub` | "Lossy in the same way the old `fakeKV` was." | **Fixed in place** (F7). **Correction:** it is not lossiness — `makeKVStub` is byte-faithful but **reference-leaky**, and the write side is safe by accident because `bytesCodec.encode` already slices. Consolidating onto `fakeKV` was considered and rejected: `TESTING.md` §4a affirmatively blesses hand-rolled in-test object-literal fakes, §7's shared-fixture rule is explicitly *consumer*-facing, and consolidation is blocked by 56 white-box `._store` references in `kv-channel.test.ts` alone, no `meta` control in `fakeD1`, and an `R2Bucket`/`R2BucketLike` mismatch. `get` now returns a copy; the isolation property is asserted against **both** fakes so they cannot drift. |
| `src/router/README.md` — the `routePaths` → `csrfGuard` example | The documented loop attaches the guard to an `ANY` route's path for all methods, GET included. | **Fixed** (F8) by adding the missing capability rather than only rewording. No method-scoped middleware registration existed anywhere in forge or the vendored `@remix-run/fetch-router` — `Router` has no `use` at all. New `forMethod(method, middleware)` lives beside `routePaths` in `src/router/`, keeping `router` a leaf (`Middleware` and `RequestMethod` are already re-exported there). README rewritten, and the imprecision stated plainly: `app.use` is path-scoped only. |

### Corrections to the table as originally written

1. **The `signal.ts` globals finding is largely wrong** — see the §1e row above. Resolved as a
   documented carve-out, not a refactor.
2. **Stub consolidation is not indicated** — `TESTING.md` §4a blesses the pattern, and three
   concrete gaps block it. Only the aliasing bug was real.
3. **`closestAcross` has six call sites, not four**, and is public API, so "latent because in-repo
   callers pass attached nodes" bounds forge's callers rather than consumers'.
4. **`contains()` and `itemId` were missing from the table entirely** — two defects, both now fixed.

### Additionally resolved in the same pass

| Item | Resolution |
|---|---|
| `src/ui/core/form.tsx` — unconditional honeypot | **Fixed, breaking** (F6). The decoy rendered on `method="get"` too, where the browser serialises it into the query string of every resulting URL — address bar, bookmarks, shared links, history, outbound `Referer` — and where it protects nothing, since only mutation handlers consult `isHoneypotFilled`. Extracted to a standalone `Honeypot` component; `honeypotField` removed from `FormProps` so a consumer who customised it gets a compile error rather than silent degradation. The GET half of the public `method` union had **zero** coverage, which is why this survived; it now has its own describe block. |
| `scripts/barrel-parse.ts` — `export type * from` | **Banned** (F9). §1b was silent on the type-only form and `barrel-parse.test.ts` *pinned it as allowed*. Two of the ban's three harms still apply (surface leak, ungreppable API); erasure at emit removes only the circular-dependency harm. It also failed misleadingly before — a barrel of nothing but `export type *` was rejected as "no value exports found in barrel". Matcher extended, pinning test inverted, §1b amended. Zero occurrences in `src/`. |
| `CLAUDE.md` Source-of-Truth Register | **Updated** (F10) to name `scripts/validate-exports.ts` **and** `scripts/barrel-parse.ts`, with a note that the former remains the entry point and retains every policy decision while the latter holds the matchers. |
| `src/security/headers.ts` — queueing after `next()` | **Moved before `next()`** (F11). Verified in advance that no passing test would break — which was precisely the risk, since the move flips header-conflict precedence from outer-wins to inner-wins for consumer middleware. It is now **pinned by test and documented** in `SECURITY_HARDENING.md` §2a and `ERROR_HANDLING.md` §5b, where before it was neither. The move also closed a real gap the plan did not anticipate: a guard registered *after* `createSecurityHeaders` that threw previously produced a 500 with **no CSP and no HSTS**, because the headers were only queued on the way back out — and the response never came back out. Collapsing the error boundary to one depth remains explicitly out of scope: it would widen F5's hazard rather than close it. |
| `src/ui/chrome/navbar.tsx` — `id` escape hatch | **Documented** (F13). W4-7 called this "toolbar's documented posture verbatim", true of the *mechanism* but not the *documentation*: `toolbar.tsx` documents the hatch on the public `id` prop, `navbar.tsx` documented it only on the `@internal` `NavRenderCtx` field a consumer never sees. `id` is now declared and documented on `NavbarProps`, and the two-bars-same-placement collision is pinned by test so the residual is explicit rather than accidental. |

---

## Verification

Per wave, and again at the end — delegated to `cc-tester`, never run inside the agent that owns
the fix:

```bash
bun run check > /tmp/check.log 2>&1; echo "EXIT:$?"
```

`package.json` `scripts.check` is the source of truth for the steps: `typecheck`, `lint`, `test`,
`validate-exports`, `validate-jsx`, `validate-docs`, `validate-css-sources`.

`bun run test:browser` is **not** part of the gate and must be run separately after Wave 3
(`dom.ts` — W3-7) and Wave 4 (`tabs`, `resume`, `switch` — W4-2/3/4) — those defects are
browser-only and invisible to `bun test`. It needs a Chromium binary
(`bun run test:install`); if that binary is unavailable, the specs are still written and
reported as *written but unverified*, never as done. Baseline for this remediation: Chromium
installed and the suite ran green at **306 passed**, so the browser findings are genuinely gated.

`signal.ts` (W3-1) is **not** in that set — it is pure JavaScript and its regression test runs
inside the gate. See the W3-1 row.
