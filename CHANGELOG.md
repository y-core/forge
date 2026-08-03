# Changelog

All notable changes to `@y-core/forge` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Pre-1.0 versioning.** Per the project's architectural policy, breaking changes ship
> **without deprecation shims** and consuming apps are updated in the same window. A `0.0.x`
> bump can therefore contain breaking changes — always read the **Breaking Changes** section
> before upgrading.

---

## [0.0.80] — 2026-08-02

A full-codebase review of 20 namespaces. Twenty-eight verified defects, seven of them
security-relevant, each landed with both a passing and a failing test. Several are described at
length because the mechanism is the interesting part — a defect that survives this long usually
does so because something about it was invisible, and that is the part worth writing down.

### Breaking Changes

- **`Form` no longer renders a honeypot; compose `<Honeypot />` yourself.** It rendered one
  *unconditionally* — including on `method="get"`, a value the public `method?: "get" | "post"`
  union explicitly permits. On GET the browser serialises the decoy into the query string, so
  `?…&__surname=` ended up in every shareable link, bookmark, history entry and outbound `Referer`,
  and a consumer validating search params against a strict schema got a 400. The honeypot has no
  defensive value there in the first place: it flags bots submitting spam, and `isHoneypotFilled` is
  only consulted by mutation handlers. All 14 assertions in `form.test.tsx` used `method="post"` —
  the GET half of a public API union had **zero** coverage, which is why this survived.

  > ⚠️ **This degrades silently.** A POST form that is not updated loses honeypot protection with a
  > green gate and no runtime signal. To make it as loud as the design allows, the `honeypotField`
  > prop was **removed** from `FormProps` rather than deprecated, so any consumer who customised the
  > name gets a **compile-time error**. Consumers on the default get no signal — audit every
  > `<Form>` you ship.

  Migration — add one child to each mutating form:

  ```tsx
  import { Form, Honeypot } from "@y-core/forge/ui/core";

  <Form method='post' csrfToken={token}>
    <Honeypot />          {/* ← add this; pass `field` if you previously set `honeypotField` */}
    {/* … */}
  </Form>;
  ```

- **`export type * from` is now banned in barrels.** `NAMESPACE_DESIGN.md` §1b banned `export *`
  and was silent on the type-only spelling, which the matcher could not see across the `type` token
  — and `barrel-parse.test.ts` *pinned it as allowed*. Erasure at emit removes only the
  circular-dependency harm; the surface leak and the ungreppable API remain, and a barrel of nothing
  but `export type *` previously failed as the misleading "no value exports found in barrel". There
  are **zero** occurrences in `src/`, so nothing inside forge changes; a consumer whose own barrels
  are checked by this script may now fail. Name the types.

- **Header-conflict precedence in `createSecurityHeaders` is now inner-wins, and is stated.** The
  middleware queued its headers *after* `await next()`, which made an overlapping header name
  resolve outer-wins. It now queues *before* `next()`, alongside the nonce, so a middleware
  registered deeper writes last and wins. Nothing inside forge overlaps — `createSecurityHeaders`
  owns its 8–9 names, `requestId` owns `x-request-id`, session and flash use `set-cookie` with
  `{ append: true }` — so only consumer middleware queuing one of those names is affected. **No
  test broke and no doc promised either direction**, which was the actual problem: the behaviour is
  now pinned by test and documented in `SECURITY_HARDENING.md` §2a and `ERROR_HANDLING.md` §5b.
  See *Fixed* for the gap the move closed on the way past.

- **`originProtection` now requires an app to list its own origin in `allowedOrigins`.** Previously
  a present `Sec-Fetch-Site` header caused an early return that skipped the `allowedOrigins` check
  **entirely**. Two things were wrong with that. `Sec-Fetch-Site` is a forbidden header name, so a
  *browser* cannot be tricked into sending a false `same-origin` — but a non-browser client sets
  whatever it likes, and one forged header was enough to walk past the allowlist. It also put this
  tier in standing disagreement with its sibling `originGuard`, which enforces the allowlist
  unconditionally. The header is now a **veto, not a pass**: a bad value still rejects outright, but
  a good one no longer short-circuits anything. `allowedOrigins` is consulted on every mutating
  request carrying an `Origin` or `Referer`; only when both are absent does the guard fall back to
  the browser's vouching, and with no signal at all it fails closed. **This will break deployments
  that relied on the early return** — add your own origin to `allowedOrigins`.
- **`Sec-Fetch-Site: same-site` is now rejected.** The check was a denylist naming only
  `cross-site`, so `same-site` passed — and *any* sibling subdomain produces `same-site`. A single
  XSS or a stale CNAME on one subdomain was enough to drive authenticated mutations against
  another. It is now an allowlist: only `same-origin` and `none` pass. Parity with Go's
  `http.CrossOriginProtection`. `CrossOriginResult` gains a distinct `"same-site"` error code,
  because a sibling subdomain you may partly control and an unrelated origin are different
  attackers and worth telling apart in logs.
- **A hand-built `{ text, params }` object no longer satisfies `isSqlFragment`.** The guard was a
  structural duck-type, so anything with the right shape passed — including `JSON.parse` output.
  Attacker-controlled JSON interpolated into a `` sql`…` `` template was therefore **concatenated
  into the statement text instead of bound as a parameter**: a full SQL injection through what looks
  like a value position. `SqlFragment` now carries a `unique symbol` brand that only `sql` sets and
  that `mod.ts` deliberately does **not** re-export. The security property then falls out of the
  language rather than from a rule we have to keep current: `JSON.parse` can only ever produce
  string-keyed properties, so parsed JSON is structurally incapable of carrying the brand. Only
  `sql` can mint a fragment; everything else gets bound.
- **`routePaths` now includes `ANY` routes in method-filtered results, and throws on a filtered
  miss.** Upstream `@remix-run/fetch-router` builds bare-string route definitions as method `ANY`
  and dispatches them for *every* method. Filtering with `{method:"POST"}` used a strict `===` and
  so omitted paths that genuinely accept POST — and the documented use of that result is
  `app.use(path, csrfGuard)`, so the guard silently attached to **nothing**. An empty list is
  indistinguishable from a correctly-empty one at the call site, so a method filter that matches no
  route in a non-empty map now **throws** rather than returning `[]`. Unfiltered calls and genuinely
  empty maps still return `[]`. Any consumer computing paths for an optionally-empty route group
  will now throw where it previously got a silent empty list — that is the point, but it is a new
  failure mode.
- **`optionalGroup` actually validates its entries, and strips unknown keys.** `entries` was a type
  carrier only: the sole runtime read was `Object.keys()`, and the return was a bare cast over the
  raw input, so a number — or an entire Workers binding object — passed as a validated `string`.
  Two consequences follow from running the schemas for real, both of which surface latent
  contract violations rather than creating new ones: a `defaults` value must now satisfy its own
  entry schema, and a key that is neither required nor defaulted must be declared `v.optional(...)`
  if it may be absent. Unknown keys are **stripped** (`v.object`, not `v.strictObject`) — a Workers
  `env` legitimately carries many unrelated bindings, so erroring on them would reject essentially
  every real deployment.
- **`aria-*` attributes now serialize `false` as `"false"`.** A blanket `value === false → omit` in
  the renderer preceded the `aria-` branch, so `aria-expanded={false}` rendered **nothing** — while
  `jsx/types.ts` types these as `boolean`, so it type-checked. Per WAI-ARIA these are string-valued
  and the distinction is real: absent means "not expandable", `"false"` means "expandable,
  currently collapsed", and screen readers act on the difference. Consumers passing an explicit
  `aria-*={false}` will now see it in the output. Forge's own components are unaffected — they had
  been working around this with `String(x) as "true" | "false"` casts at five call sites, all now
  reverted, with rendered output verified byte-identical across 19 variants.
- **`definePage`'s `action` is now wired into the pipeline.** It was declared, exported, and
  documented — and never read. `method` was hardcoded `"GET"` and `actionData` always `undefined`,
  so a POST through `definePage` type-checked and was then **silently discarded with a 200**.
  Non-GET now dispatches to `action`, its result reaches the view as `actionData`, and errors route
  through the existing boundary.
- **`csrfProtection` answers `413` instead of `403` when a body exceeds its cap**, and both
  `defineAction` and `csrfProtection` accept `maxBytes`. See *Fixed* for why one without the other
  does nothing.

### Added

- **`uuidv7()` and `createUuidv7(options?)`** (`@y-core/forge/storage/db`) — RFC 9562 UUIDv7
  generation for D1 primary keys: unique, non-sequential, and lexicographically sortable by
  creation time, so inserts append to the right edge of the primary-key B-tree and `ORDER BY id`
  doubles as a keyset cursor. The 12-bit `rand_a` field carries a monotonic counter (RFC 9562 §6.2
  Method 1) rather than randomness, which on Workers is load-bearing rather than an optimisation:
  `Date.now()` is frozen between I/O operations as a timing-attack mitigation, so every ID minted
  between two awaits reads the same millisecond and a stock UUIDv7 would emit the batch in random
  order — losing the one property it was chosen for. The counter reseeds to a random 10-bit value
  per clock advance (≥3072 increments of headroom) and borrows the next millisecond on overflow; a
  backwards clock step is absorbed the same way, so a generator never emits an ID that sorts before
  one it already emitted. `createUuidv7` takes an injected clock. Implemented in the
  sealed-internal `crypto` module so `storage/kv` or a future `auth` can consume it without a
  layering violation, and surfaced through `storage/db` alone — there is still no importable
  `crypto` path. **Not a secret:** a UUIDv7 discloses its creation time and mint rate by design.
- **`uuidv7Bytes()`, `uuidFromBytes(value)`, `uuidToBytes(id)` and `createUuidv7Bytes(options?)`**
  (`@y-core/forge/storage/db`) — the `BLOB` form of the same identifier, making the storage-density
  decision reversible per table instead of a schema-wide bet. `uuidv7Bytes` mints the same value as
  `uuidv7` from the **same shared generator**, so an application mixing the two forms still gets one
  global ordering. Bytes are most-significant first, which is the order SQLite's `memcmp` sorts a
  `BLOB` by, so ordering is identical to `TEXT`. `uuidFromBytes` accepts the `number[]` D1 returns
  for a `BLOB` column — its JSON transport has no binary type — alongside `Uint8Array` and
  `ArrayBuffer`; `uuidToBytes` parses a canonical string for binding against one, and is an encoder
  rather than a validator, so a request-supplied ID should still be checked at the boundary. On a
  100k-row table with two secondary indexes the `BLOB` form is ~27% smaller in total
  (11,640 KB vs 15,924 KB), which counts against D1's 10 GB per-database ceiling rather than
  against the bill; the price is byte arrays in every console query, log line and `json_object()`
  projection, so it is a per-table choice, not a default. Related: **`WITHOUT ROWID` is not the
  lever it looks like** — an ordinary rowid table's secondary indexes carry the implicit integer
  rowid, not the primary key, so a 36-character id costs two fixed copies per row however many
  indexes exist; `WITHOUT ROWID` appends the id to every index entry and comes out *larger* past a
  single index.
- **`forMethod(method, middleware)`** (`@y-core/forge/router`) — wraps a middleware so it runs only
  for the given `RequestMethod` (or array of them) and calls `next()` otherwise. `app.use` is
  **path**-scoped only; dispatch never consults the method, so feeding a
  `routePaths(routes, { method: "POST" })` list into it guards those paths for every method they
  serve. With `ANY` routes now included in a concrete method filter (0.0.80, above), the
  `router/README.md` snippet that loops `csrfGuard` "onto only the mutating endpoints" was guarding
  `/health` on GET. No method-scoped registration existed anywhere in forge or the vendored
  `@remix-run/fetch-router` — `Router` has no `use` at all. Lives beside `routePaths`, so `router`
  stays a leaf namespace.
- **`Honeypot`** (`@y-core/forge/ui/core`) — the decoy field extracted out of `Form`; see *Breaking
  Changes*. Takes an optional `field` defaulting to `HONEYPOT_FIELD_DEFAULT`.
- **`fieldDescribedBy(name, options)`** (`@y-core/forge/ui/core`) — the `aria-describedby`
  computation on its own, returning `undefined` when nothing to point at renders. `fieldControlProps`
  uses it, and so do `CheckboxGroup` and `RadioGroup`, which cannot adopt `fieldControlProps`
  wholesale because a `<fieldset>` is not a labelable control.
- **`description` and `scope` props on `CheckboxGroup` and `RadioGroup`** — matching `FormField`.
  `scope` must be repeated on every `.Item`, since each item derives its own id.
- **`id` is now declared and documented on `NavbarProps`.** It was always accepted via the `<nav>`
  intrinsic and always namespaced the generated menu ids, but the escape hatch was documented only
  on an `@internal` field a consumer never sees.

### Fixed

- **A 500 could be logged and then lost.** On the guard-throw path `requestLogger`'s `finally`
  flushes *before* the app's error boundary writes its `unhandled error` record, and `flush()`
  **splices** the pending buffer — so the boundary's record landed in a buffer nobody awaited. With
  the synchronous channel the tests use, both records are captured and everything looks fine; with a
  real asynchronous `kvLogChannel`, the boundary's record **may never persist before isolate
  teardown**. Production therefore saw two records *or* one-plus-a-lost-one, nondeterministically.
  The boundary now schedules its own flush at the point of write, so both records sit inside an
  awaited window on both throw paths. The suite was structurally incapable of observing this; the
  regression tests use an asynchronous channel fixture, which is the only kind that can. The two
  records are still not deduplicated — they are distinguishable by `message`.
- **`closestAcross` and `contains` threw a `TypeError` on a detached subtree.** Both read
  `getRootNode().host` with no `nodeType === 11` guard — the defect fixed at one of the three sites
  in 0.0.80 and left at the other two, and `contains` was not recorded anywhere. For a detached
  subtree `getRootNode()` returns the topmost ancestor *element*; on an `<a href>` that is the URL's
  host string, and the next hop calls a method on a string. A **relative** `href` is no safer, which
  is the non-obvious half: a detached anchor resolves it against the document base URL, so `host` is
  the page's own origin rather than `""`. Both are public API. All three reads now go through one
  private `shadowHost` helper so they cannot drift again.
- **An `effect()` whose first run read a signal and then threw poisoned that signal permanently.**
  The disposer is the return value, so a throw means the caller never receives it — and the first
  run's own `cleanup` is a no-op, because `deps` is still empty when it runs. The dead node
  therefore stayed in the signal's `subs` with nothing able to remove it, and **every** later write
  to that signal re-entered it and rethrew out of the *setter*, at an arbitrary unrelated call site,
  for the signal's lifetime. `effect()` still throws — callers may rely on that — but now
  unsubscribes first, so a failed effect leaves no residue. The existing "does not stay installed"
  test could not catch this: its throwing body read no signal, so it never subscribed.
- **`CheckboxGroup` and `RadioGroup` emitted a dangling `aria-describedby`,** unconditionally
  naming a description element that renders only when the consumer supplies one — the exact defect
  fixed in `field.tsx` in 0.0.80 and not fixed in these two. A dangling IDREF is not ignored by
  assistive technology; it is reported as an error. **This shipped on the component showcase**,
  which renders both groups with no `Description` child. Separately, `itemId()` did not thread the
  `scope` param, so *every item id* — not just the description id — collided across two same-named
  groups on one page, and a click on the second group's item resolved to the first group's. Neither
  group had a unit test; both now do.
- **The console error path dropped `name` and `stack` from unhandled errors.** `_handleError`
  logged `{ error: err.message }` to the app logger, immediately beside a line publishing the full
  `serializeError(err)` to the request logger. Redaction in forge is a **channel**-level decision —
  `consoleChannel` keeps stacks, `kvLogChannel` strips them via `persistStack: false` — and this is
  the worker log stream, not the HTTP response, which is separately guarded behind `isDebug`.
  Dropping the stack made the console the least informative sink of the three.
- **Security headers were missing from the error page when a guard threw.** They were queued only on
  the way back out of `createSecurityHeaders`, and on that path the response never comes back out —
  so a throw from any middleware registered after it produced a 500 with no CSP, no HSTS and no
  `referrer-policy`. Queuing before `next()` (see *Breaking Changes*) fixes this as a side effect;
  it is pinned by its own test.
- **`makeKVStub` in `store.test.ts` handed out the stored `ArrayBuffer` by reference,** so
  `bytesCodec().decode` wrapped it in a writable *view* onto the stub and mutating a retrieved value
  silently rewrote the store. Byte-faithful but reference-leaky — the write side was safe only by
  accident, because `encode` already slices. No test exercised it: a latent trap rather than a live
  bug. `get` now returns a copy, and the isolation property is asserted against both this stub and
  `fakeKV` so the two cannot drift.

- **A cached session middleware leaked one tenant's KV namespace to another.**
  `createAnonymousSession` keyed its cache on `(cookieName, secure, secret)` — but the cached
  closure captured the per-request `options.kv(c)`, which is **not in that key**. Two tenants
  sharing a cookie name, secure flag and secret therefore hashed to one slot and shared one KV
  namespace: tenant B read and wrote tenant A's sessions. The general shape is worth naming —
  whenever a cache key is narrower than what the cached value closes over, you get cross-tenant
  bleed. The cache is now a `WeakMap` keyed on the `env` object itself (the scheme `csrfProtection`
  already used), which makes the key at least as wide as the capture and lets entries be collected;
  the old `Map` also grew without bound under a rotating secret.
- **A CSRF token with kid `constructor` returned 500, not 403.** `ring.keys[_kid]` on a plain object
  walks the prototype chain, so an inherited member name resolved to a truthy non-`CryptoKey`, sailed
  past the `!key` guard, and threw an uncaught `TypeError` out of `crypto.subtle.verify` — an
  unauthenticated single-request 500 on **every** guarded mutation route. Now `Object.hasOwn`.
- **`https://a/b.example.com` matched the CORS pattern `https://*.example.com`** and was reflected
  into `Access-Control-Allow-Origin`. The wildcard expanded to `[^.]+`, which happily matches `/`,
  `:` and `@` — so a path segment, userinfo or port could carry the trusted suffix. Now
  `[^./:@]+`, and `?` is escaped rather than being left to make the previous character optional.
- **`ONMOUSEOVER=` survived SVG sanitization.** The event-handler strip was the only regex in
  `sanitizeSVG` without the `i` flag — every sibling rule had it — and HTML lowercases the attribute
  back into a live handler on parse.
- **A view stored its entire backing buffer in KV.** `bytesCodec`'s `encode` returned `value.buffer`,
  ignoring `byteOffset`/`byteLength`. Because `subarray()` is zero-copy, a view shares its buffer
  with whatever else was allocated there — so storing a 2-byte view durably wrote the whole
  allocation, with the wrong length **and** disclosure of adjacent bytes, reported as `ok: true`.
  This was invisible until the KV test fake was made byte-accurate in the same window: a fake that
  decoded values through `TextDecoder` was structurally incapable of showing it.
- **A single throwing effect froze every signal on the page.** `signal.ts` incremented a batching
  `depth` and swapped the global `activeEffect` without `try/finally`, so one throw stranded
  `depth > 0` forever, froze `epoch`, and every subsequent signal write silently stopped re-running
  every effect — with no further error anywhere. The dead node also stayed installed as the global
  dependency-tracking target.
- **Every `<a href>` click threw a `TypeError` out of the delegated document listener.**
  `closestAcross` duck-typed a shadow boundary on `.host` — but `HTMLAnchorElement.host` is the
  URL's host **string**. Reaching an anchor during the climb reassigned `current` to a string, and
  the next iteration called `.getRootNode()` on it. Reachable from four controllers. Now tests
  `nodeType === 11`.
- **An invalid env produced the raw Workers 1101 page.** `resolveConfig` ran before the `try` in
  `fetch()`, so a config failure escaped past the error boundary, the logger, `_onError` and the
  hardening headers — and because `Config.get` caches only on success, it threw forever. It now
  resolves inside the `try`. The error boundary is additionally registered at an **outer** depth so
  a throwing `app.use` guard is caught with headers intact; the innermost instance is deliberately
  kept, because `createSecurityHeaders` queues its headers *after* `await next()`, so a boundary
  sitting outside the guards would strip CSP and HSTS from every error page.
- **Every 500 was persisted with no error detail at all.** `requestLogger`'s error branch was
  unreachable — it is registered outside the innermost error boundary, so a handler throw was
  already converted to a 500 `Response` and `await next()` resolved normally. The fix publishes the
  error from the boundary that holds it onto the per-request logger, so it reaches KV with
  `requestId` correlation; `persistStack: false` still strips the stack before persistence. The
  local `catch` is **kept**: it is still reached when a throw escapes `next()` from middleware below
  the logger, and on that path it is the only thing that lands error detail inside the `waitUntil`
  flush window.
- **The first caller's `maxBytes` won permanently for the isolate.** `parseFormData` read `options`
  only when populating its cache, and `csrfProtection` always parsed first at the 100 KiB default —
  with a bare `catch {}` that swallowed the resulting 413 and answered a misleading **403**. So a
  CSRF-guarded route could never raise its cap. The cache now records the bytes actually read and
  each caller re-checks that count against its own limit; keying the cache on `maxBytes` would have
  been wrong, because a body is readable exactly once and a second caller would hit a confusing
  "body used" error instead of a 413. `csrfProtection` gained its own `maxBytes` because the
  acceptance case is unreachable without it — the guard runs first and short-circuits, so the
  handler's cap never gets a say. Both sides must be raised together.
- **A CJK filename returned 500.** `serveObject`'s "ASCII fallback" for `Content-Disposition`
  stripped only C0 controls and DEL, so non-Latin-1 characters survived and then threw on
  `Headers.set`. The fallback now folds accents via NFKD, collapses each remaining run of
  non-printable-ASCII to a single `_`, and emits `"` and `\` as quoted-pairs rather than stripping
  them. Substituting *in place* means every ASCII character survives with no filename parsing at
  all, so the extension is preserved: `年度報告.pdf` → `_.pdf`, `invoice-年度.pdf` →
  `invoice-_.pdf`.
- **The Switch has never animated its thumb.** `peer-*` compiles to a **general-sibling**
  combinator, so it reaches only siblings of the input. The track is one and painted correctly; the
  thumb is a *child of the track*, so `peer-checked:translate-x-4` matched nothing — in any release.
  A Tailwind selector that matches nothing produces no build error, no runtime error and no visual
  artifact, and the correct sibling selector next to it kept the component looking half-alive. The
  thumb now keys off a `data-slot`-anchored descendant selector, and
  [`UI_SSR_COMPONENTS.md`](.decisions/UI_SSR_COMPONENTS.md) §1e gains the rule.
- **A ToggleGroup's highlight was frozen on whichever item the server rendered pressed.** The active
  class was applied at render as `pressed && ITEM_ACTIVE`, while the controller only writes
  `aria-pressed` / `data-pressed`. It is now unconditional and keyed on `data-[pressed]:`, which
  also raises specificity enough that `data-[pressed]:hover:` reliably beats `hover:` instead of
  depending on stylesheet emission order.
- **The first Tab keypress reselected tab 0.** `Tab` omitted `ACTIVE_COMPOSITE_ITEM`, so roving
  focus resolved its initial index to 0 regardless of the selection.
- **`asChild` turned a child `<button type="button">` into an accidental submit button.**
  `cloneAsChild` spread `type: undefined` / `disabled: undefined` over the child's own props.
  Undefined-valued keys are now dropped before the spread.
- **`aria-describedby` named a description element that did not exist.** A dangling IDREF is treated
  as an error by assistive technology rather than ignored. `FieldDescriptor` gains `description`
  (default `false`) so the attribute is emitted only when something really describes the field, and
  an opt-in `scope` so two forms with a same-named field stop colliding. Automatic uniqueness would
  need module-level mutable state, which `PRODUCTION_TS_RULES.md` §1 forbids; unscoped output is
  byte-identical to before.
- **Two `Navbar`s on one page emitted duplicate ids.** Menu ids are now namespaced by the navbar's
  own `id`, falling back to `placement` — the posture `ui/chrome/toolbar.tsx` already established.
- **htmx swaps leaked detached DOM indefinitely.** `resume.ts` pushed onto a module-level disposer
  array that only drained at whole-runtime teardown, so every swap stranded another detached tree
  and its live `MutationObserver`s; `resumed` was never cleared, so a re-mounted scope came back
  inert. Disposers are now keyed by root and swept when a replacement scope resumes — which
  `htmx:load` already triggers, so no new hook was needed.
- **`Date`, `Map` and `Set` were persisted as `{}`.** `Object.fromEntries(Object.entries(v))` clones
  property-wise, and all three hold their payload outside enumerable own properties. They now
  serialize to ISO 8601 and tagged rebuildable forms. Cycles are cut with a `WeakSet` of the
  *currently open path*, so a repeated sibling reference survives and only true ancestors become
  `"[circular]"` — the previous implementation was unbounded on a cycle.
- **`?level=` was cast straight to `LogLevel`** with no validation, and echoed back into the rendered
  filter bar. It is now validated at the boundary with the `v` facade. An invalid value **drops the
  filter and renders unfiltered** rather than erroring: the level filter *narrows* a row set the
  caller was already authorised to read in full, so it is not an authorization input, and a 400
  would turn a stale bookmark into a broken admin page for no security gain.
- **"Load more" destroyed the rows already loaded** and dropped the active `level` / `q` filters. It
  `outerHTML`-swapped the whole tbody; it now replaces only its own `<tr>` and carries the filters
  into the next-page URL. (`beforeend` is wrong here: the control lives *inside* the tbody it would
  append to, so it would survive below the new rows still pointing at the cursor just consumed.)
- **`withQueryParam` discarded the scheme and host of an absolute `hx-get`**, silently rewriting an
  absolute endpoint into a path-relative one.
- **An empty client-supplied `CF-Ray` became the request id.** `??` only guards `null` and
  `undefined`; empty and whitespace-only values are now treated as absent.
- **`Form` hardcoded `"_csrf"` and `"__surname"`** rather than importing the constants
  `src/form/constants.ts` owns — so renaming either would have silently disabled the honeypot with a
  green gate. The tests now interpolate the imported constants into the expected HTML, so a rename
  fails loudly.

### Changed

- **`validate-exports` catches two evasions it previously missed.** `export * as ns from` slipped
  past the `export *` ban by one token, and the `@public` lookahead was a fixed nine lines — so a
  *well-documented* export was checked **less** than a sparse one. The window is now the TSDoc
  block's actual extent. A third defect surfaced while writing the fixtures: searching forward from
  the block's start makes an `export const` inside an `@example` look like the declaration, which
  the old code did. Neither fix flags anything new in `src/` — verified by diffing old against new
  across every source file, not inferred from a green run. The pure parsers moved to
  `scripts/barrel-parse.ts` so they can be tested at all; `validate-exports.ts` remains the entry
  point and retains every policy decision.
- **The test fakes match the real bindings.** `fakeKV` stores bytes verbatim instead of round-tripping
  them through `TextDecoder` (lossy for anything non-UTF-8) and records `expirationTtl`; `fakeR2`
  honours `range`; `fakeD1` gains opt-in failure injection so consumer error branches are reachable
  at all. Worth noting what this did **not** find: no existing test broke, because the storage suites
  hand-roll their own local stubs and never used the shared fakes. The fakes' divergence was real but
  load-bearing for nothing — which makes the hand-rolled stubs the place divergence will actually
  hide next.

### Documentation

- **`PRODUCTION_TS_RULES.md` §1e states the browser-only carve-out.** §1a's prohibition on
  module-level mutable state, and its rationale, are both scoped to *request-scoped* data under
  Workers isolate recycling — but `ui/client` never executes in a Worker, and module state is the
  house style across seven files there with no exemption marker anywhere. The carve-out was implied
  by §1's framing plus `UI_CLIENT_RUNTIME.md` and never stated, so it kept resurfacing as a review
  finding. §4a (testability) still applies in full: page-scoped state a test can observe needs a
  reset export, as `active-descendant.ts` already ships.
- **`NAMESPACE_DESIGN.md` §1b names all three star spellings** rather than leaving the type-only
  form to the script. **`CLAUDE.md`'s Source-of-Truth Register** names both
  `scripts/validate-exports.ts` and `scripts/barrel-parse.ts` for barrel rules, with the split
  stated: the former is the entry point and holds every policy decision, the latter holds the
  matchers.
- **`src/logging/README.md` no longer claims the guard-throw path writes one error record** — it
  writes two, and the second one's flush window is now documented. `request-logger.test.ts`'s
  matching test title said "one error record" while its assertion pinned two.
- **`src/form/README.md`, `INPUT_VALIDATION.md` §4a and `src/ui/README.md`** document the required
  `<Honeypot />` composition and the migration. **`src/router/README.md`** documents `forMethod` and
  states plainly that `app.use` is path-scoped only.

---

## [0.0.78] — 2026-08-02

### Fixed

- **`forge.css` never scanned `ui/contracts`, so `Menu`'s row classes were generated for nobody.**
  The `@source` list named `core`, `chrome` and `controls` — the directory added alongside it in the
  same window was not on it. `MENU_ITEM_CLASS` in `contracts/menu-contract.ts` is the one place in
  forge those 22 utilities are *written*; `core/menu.tsx` reads it as `const ITEM_BASE =
  MENU_ITEM_CLASS`, an identifier Tailwind's textual scan cannot see through. The consequence was
  wider than the constant's stated purpose suggests: **forge's own SSR `Menu.Item` lost the rules
  too**, not merely a client-built row, and with it every consumer of `core/Menu`.
  What kept it invisible is that the failure was *partial*. Most of the 22 are ordinary enough that
  unrelated scanned components — `core/popover.tsx`, `core/dialog.tsx`, `core/button.tsx` — emit
  them incidentally, so a menu still looked broadly right; only the five nothing else happened to
  use fell through, and they were `text-left` plus the `focus-visible:` and `aria-disabled:`
  affordances, i.e. exactly the keyboard-focus and disabled states a casual glance does not check.
  A stylesheet that *mostly* works is harder to notice than one that does not.
  **`bun run check` gains `validate-css-sources`**, which reads the direction that would have caught
  it: every directory under `src/ui/` must be covered by an `@source` path or listed as class-free
  with a reason, and each class-free claim is re-tested by a literal detector so an opt-out cannot
  outlive its truth. The old failure was a new directory meeting an old list; that shape now fails
  the gate rather than the render.

---

## [0.0.77] — 2026-08-01

### Fixed

- **`Menu.Popup` rendered a closed menu permanently visible.** `POPUP_BASE` ended in `flex flex-col`,
  and a closed popover is hidden by the UA rule `[popover]:not(:popover-open) { display: none }` —
  which is **not** `!important`, so any author-origin `display` on the same element beats it. Escape
  and light-dismiss both worked, `:popover-open` went false, and the menu stayed on screen. Nothing is
  lost by removing it: every row shape already carries `flex w-full`, so the rows were block-level
  boxes stacking on their own account. **`menu.browser.ts` gains the case that would have caught it**,
  asserting the *computed* display rather than a class — every one of the 25 existing cases read
  `:popover-open` or a state attribute, all of which were correct while the component was broken.
  The general rule: a popover or `<dialog>` must not carry a bare `display` utility.

### Added

- **`mountActiveDescendant` / `resetActiveDescendant` (`ui/client`)** — the combobox controller, and a
  sibling to `mountRovingFocus` rather than an option on it. Three properties of the roving controller
  disqualify it: `belongsToTextField` hands every arrow back to the caret whenever the caret can still
  move (so ArrowDown never reaches the ring mid-query), it calls `item.focus()` and so takes focus out
  of the field a combobox is defined by keeping it in, and its typeahead is gated off for native
  inputs. Items resolve **live**, so a list rebuilt between keystrokes needs no re-registration.
  `resetActiveDescendant` is published separately because only the consumer knows when its list
  changed — and because **reset, never clamp**: clamping keeps the highlight on whatever option now
  occupies the old index, which after a new query is a different command, and Enter would run it.
- **`menuItemAttrs()` and `MENU_ITEM_CLASS` (`ui/contracts`)** — a **client-built** menu row stamped
  from forge's own declaration. An SSR component renders on the Worker and cannot be invoked from the
  browser, so a context menu whose rows arrive from synchronous callbacks previously had no option but
  to re-type forge's class string as a literal. `ITEM_BASE` in `core/menu.tsx` now reads the published
  constant rather than keeping a private copy beside it.
- **A `flip` option on `openPopoverAt`.** Clamping and flipping both keep the panel on screen; they
  differ in where the *point* ends up. Clamping leaves it inside the box, which for a context menu
  pre-hovers the row under the cursor; flipping mirrors the box past the point, which is the desktop
  convention. Per axis, and a flip that would not fit falls back to clamping, so "the whole panel is
  on screen" stays unconditional.
- **`Tooltip.Trigger`'s `asChild`**, same contract as `core/Button`'s. The case is an app adding
  tooltips to controls it already has: wrapping an existing button would give the row two focus stops
  and break every selector addressing it.

### Changed

- **`Tooltip.Content` is positioned at all.** It is `popover="manual"` with no `commandfor`, so it has
  no implicit anchor — and forge shipped **zero** CSS for `[data-slot="tooltip-content"]`, so every
  tooltip rendered centred in the viewport. That was **unfixable from a consuming app**, because the
  anchor name did not exist to bind to. `theme-base.css` now declares `anchor-name` on the trigger,
  `anchor-scope` on the root so many tooltips on one page stay independent, and the four sides × three
  alignments, with flip fallbacks.

## [0.0.76] — 2026-08-01

Add a logging withLevels() feature 

## [0.0.75] — 2026-08-01

The client halves the Base UI refactor was missing. Four components that stamped a styling hook and
had nothing to update it now have controllers; `data-popup-open` gets its first producer; scope
discovery learns to see into shadow roots; the compound button bases are unified on one exported
`cva`; and a popover can finally be placed at a coordinate rather than against an invoker. Contains a
**breaking change** to the toolbar's class strings — see below.

### ⚠️ Breaking Changes

1. **`Toolbar.Button` and `Toolbar.Link` render `core/Button`'s classes, not the toolbar's own.**
   `core/toolbar.tsx` declared a private `ITEM_BASE`; it is gone, and both items now resolve through
   the newly-exported `buttonVariants` at `variant="ghost"`, `size="sm"` by default. This is a real
   visual change, not a reshuffle.

   ```
   before: inline-flex items-center justify-center gap-2 rounded-md px-2 py-1 text-sm text-foreground
           outline-none cursor-pointer hover:bg-accent hover:text-accent-foreground
           focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50

   after:  inline-flex items-center justify-center rounded-lg font-medium transition-colors
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
           disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm
   ```

   Concretely: `rounded-md` → `rounded-lg`, `px-2 py-1` → `h-8 px-3`, `gap-2` and `cursor-pointer`
   dropped, `font-medium` and `transition-colors` added, and hover no longer sets
   `text-accent-foreground`. Migration: a stylesheet or test pinning the old string updates to the
   new one; a caller that wants the old geometry passes `size` and a `class` rather than relying on
   the default. `chrome/Toolbar`'s **rail separators** also change shape, from `w-6 h-px` /
   `h-6 w-px` to `Toolbar.Separator`'s own `h-px w-full` / `h-5 w-px`, with only the margins left as
   a caller class.

   **No `tailwind-merge`, now or later.** It resolves conflicts between class *strings*; conflicts
   between CSS *layers* are invisible to it. It would add a runtime dependency and a per-render cost
   on a Workers SSR path and fix nothing.

2. **`Popover.Content` no longer emits `data-closed` at render.** It emitted a hardcoded
   `open: false` that was never updated — a lie from first render that stayed wrong for the whole
   time the popover was open. The new eager `popover` scope reconciles `data-open` / `data-closed`
   from the element's own `:popover-open`, so the pair is correct at every instant instead of at
   none. Migration: nothing, if you run the `ui/core/client` side-effect import. Without it, markup
   that used to carry a (wrong) `data-closed` now carries neither attribute — which is the honest
   answer for a page with no client half.

### Added

- **`openPopoverAt(el, x, y, options?)`** in `ui/client` — opens a native popover at a viewport
  coordinate, clamped on screen. For the one case CSS Anchor Positioning cannot serve: a **context
  menu has no invoker**, so every anchored rule resolves to nothing and the UA's `[popover]` default
  centres the panel. Coordinates travel as `--anchor-x` / `--anchor-y` written through **CSSOM**,
  never a generated `style` attribute — forge's CSP carries no `style-src 'unsafe-inline'`. Opt in
  with `Menu.Popup`'s new **`coords`** prop, or the `data-coords` attribute directly.
- **`mountPopupTriggerState(popup)`** in `ui/client` — the first producer of `data-popup-open`, the
  trigger's own state while its popup is open. CSS has no selector that walks from a popup to its
  trigger, so "the button that stays lit while its flyout is up" was previously inexpressible.
  Triggers are resolved document-wide via `commandfor` and filtered on the command *verb*, so a
  `Menu.Item` or `Dialog.Close` naming the same target is not mistaken for one.
- **`buttonVariants`** is exported from `ui/core`, with a new **`square`** size
  (`w-full aspect-square p-0`). `icon` and `icon-sm` name a size in pixels; `square` names a
  *relationship* — take the parent's width, be as tall as you are wide — which is the only form an
  app whose icon rail is a design token can consume without overriding the class it just asked for.
- **`Toolbar.Button` and `Toolbar.Link` take `variant`, `size`, `pressed` and `asChild`.** `pressed`
  emits `aria-pressed`, `data-pressed` **and** `ACTIVE_COMPOSITE_ITEM` together — never one without
  the others — so the rail's boot tab stop lands on the active tool rather than on whichever item is
  first. `asChild` is `core/Button`'s exact contract, extracted and shared: exactly one JSX element
  child, or it throws.
- **`DIALOG_SCOPE`, `POPOVER_SCOPE`** (new `contracts/overlay-contract.ts`), **`ACCORDION_SCOPE`** and
  **`ToggleAction`** (`contracts/toggle-contract.ts`), and **`POPOVER_COORDS_ATTR`** /
  `ANCHOR_X_PROPERTY` / `ANCHOR_Y_PROPERTY`, all from `ui/contracts`.
- `ACTIVE_COMPOSITE_ITEM` is now also exported from **`ui/contracts`**. It is unchanged in
  `ui/client`; the declaration simply moved to where an SSR component can reach it.

### Fixed

- **`resume()` could not find an eager scope inside a shadow root.** Discovery used a flat
  `querySelectorAll`, which does not cross a shadow boundary, so a scope rendered inside a web
  component was never *visited*: its `setup` never ran, and nothing warned. That is most of what the
  UI refactor added — `toolbar`, `menu`, `tabs`, `tooltip`, `collapsible`, `number-field`, `theme`
  and `navbar` are all eager. A `core/Menu` inside a web component rendered, opened and
  light-dismissed (all platform) with **no arrow navigation, no typeahead and no focus restoration**
  (all forge). The eager pass now walks the tree and descends into every open `shadowRoot`; a closed
  root is stepped over. `resume(within)` additionally accepts a `ShadowRoot`, so a web component can
  resume only its own subtree.
- **`Dialog`, `Popover` and `Accordion.Item` had no client half at all.** Each stamped state at
  render and then never moved: `Dialog` froze at its `open` prop, `Popover.Content` was hardcoded
  wrong, and `Accordion.Item` emitted **no** `data-open` / `data-closed` ever, so a stylesheet keyed
  on the pair matched nothing at any point in the component's life. All three now stamp a scope and
  mount `mountTransitionState`, which publishes from the element's own state and never decides it.
- **`Toggle` was a button that announced its own behaviour and had none.** It stamped
  `TOGGLE_SCOPE` but no `data-on-click`, and a lazy scope resumes only on a `data-on-*` interaction —
  so nothing could ever resume it and the eager pass skipped it too. The component now emits the
  action itself instead of leaving it to the caller.
- **`chrome/Toolbar` stopped hand-rolling the primitives it sits next to.** A fourth button base
  (`TRIGGER_CLS`), a separator with a different class set from `Toolbar.Separator`, and two
  hand-stamped `TOOLBAR_ITEM_ATTR`s are all deleted in favour of `core/Toolbar`. The rail keeps its
  own `<nav>` root, because the flyout's `data-placement` anchoring is CSS the generic `Popover`
  cannot express.

### Internal / Tooling

- `ACTIVE_COMPOSITE_ITEM` moved from `client/composite.ts` to a new
  `contracts/composite-contract.ts`. It had **zero producers** despite being documented, and the
  reason was structural: an SSR component cannot import a module that names `document`.
- `core/utils/as-child.ts` holds the one `asChild` model, called by `Button`, `Toolbar.Button` and
  `Toolbar.Link` rather than reimplemented per compound.
- `core/toolbar.test.tsx` is new — `core/Toolbar`'s SSR markup previously had no unit coverage at all.
- The `data-*` conformance guard gained `data-coords` as a declared **structural** attribute: it
  names a placement *mode*, sibling to `data-placement`, not to `data-side`.
- Test counts: `bun test` 1931 → **1947** across 168 files; `bun run test:browser` 260 → **290**.

## [0.0.74] — 2026-08-01

Two structural changes to `@y-core/forge/ui`, cut early because they unblocked a consumer: the DOM
contract becomes an addressable namespace of its own, and forge's stylesheets become importable at
all. Contains a **breaking change** to the cascade position of every component rule — see below.

### ⚠️ Breaking Changes

1. **`theme-base.css`'s component rules are now inside `@layer components`.** They were unlayered,
   and unlayered CSS outranks *all* layered CSS whatever the selector weight — so those rules beat
   every Tailwind utility unconditionally, including the ones forge's own components set on the very
   elements they select. A `max-w-sm` on a `<dialog>` read as an override and never was one. Layering
   puts a component default where a caller's utility can win, which is the relationship a default is
   supposed to have.

   Migration: a rule of your own that used to beat a forge component rule by being unlayered still
   does. A forge rule you were **relying on to beat your own utility** now loses to it — raise your
   own specificity, or move your rule out of a layer. The `:root`, `.dark` and `@theme inline` blocks
   deliberately stay unlayered: a custom-property declaration is not a cascade participant in this
   sense, and `@theme` is a Tailwind at-rule that must be seen at the top level.

### Added

- **`@y-core/forge/ui/contracts`** — a subpath of its own for the DOM contract both tiers share:
  `STATE_ATTRS`, `stateAttrs`, `applyStateAttrs`, `SCOPE_EVENTS`, and the scope-name and selector
  constants each keyboard primitive shares between its SSR and its client half. A consuming app has
  to *address* this DOM; without an export its only option was to re-type every name as a string
  literal, becoming a third writer of the same attribute in a repository forge's gate cannot see.
  The eight contract modules moved from `src/ui/*` into `src/ui/contracts/`.
- **`@y-core/forge/ui/assets/css/*.css`** — the stylesheets are addressable, via a subpath
  **pattern** so every real file in the directory is reachable rather than merely declared.
  **`forge.css`** is the one import an app needs (tokens *and* generated rules); **`forge-show.css`**
  covers the showcase.
- **`@source` paths in `forge.css`, resolved relative to itself.** Tailwind v4's automatic content
  scan **ignores `node_modules`**, so without them none of forge's classes were ever generated: the
  markup rendered and every class on it had no rule. A consumer build produced **2** utilities from
  forge's components before this; it produces **302** after. Relative-to-itself is the only form that
  survives pnpm, a workspace, a git dependency and a monorepo alike.

### Removed

- **`data-anchor-hidden`.** It was declared in `STATE_ATTRS` and in the doc table and written by
  **nothing** — no component, no controller. A declared hook that is never emitted is as misleading
  as a hook that drifted: a consumer styles against it and gets a rule that can never match. Removed
  while the table was still new, because after publication a deletion is a breaking change.

### Internal / Tooling

- **`validate-exports` expands subpath patterns from disk.** A literal key proves a subpath was
  *declared*; an expanded pattern proves each real file is *reachable*. The absence of that second
  check is what let forge ship 73 versions of unaddressable stylesheets.
- `validate-docs` and `NAMESPACE_DESIGN.md` §3a updated for the new namespace.

## [0.0.73] — 2026-08-01

The Base UI refactor of `@y-core/forge/ui`. Eleven new SSR primitives, seven new client controllers,
and a real composite-widget layer — one tab stop per widget, arrow keys, typeahead, RTL, focus
restoration — so a segmented control or a toolbar is a **primitive** rather than styled initial
markup. A second test runner drives real Chromium. Contains **breaking changes** to `ToggleGroup`,
`Switch` and `Navbar`'s in-menu markup — see below.

Base UI was read as an implementation specification: its DOM contracts, accessibility behaviour and
testing discipline. None of its React architecture came with it — no contexts, no hooks, no render
props, no portals, and above all **no JavaScript re-creation of native `dialog`, `popover`,
`details` or `select`**. Every overlay here is the platform's.

### ⚠️ Breaking Changes

1. **`ToggleGroup` no longer emits `role="toolbar"`.** It emitted that for *every* group, which
   announced a segmented control as a toolbar and offered assistive technology the wrong interaction
   model. It now emits **no `role`** — a `<fieldset>` already has an implicit `group` — and
   `aria-orientation` went with it, since ARIA does not define that for `group`. A widget that really
   is a toolbar uses the new `Toolbar`, which brings the keyboard behaviour the role promises.

   ```tsx
   // before — announced as a toolbar, with no keyboard behaviour to match
   <ToggleGroup>…</ToggleGroup>
   // after — a group, and it says which kind
   <ToggleGroup type='single'>…</ToggleGroup>
   ```

   Migration: add `type="single"` (default) or `type="multiple"`. If the widget genuinely is a
   toolbar, use `Toolbar` instead. A stylesheet matching `[data-slot='toggle-group'][role='toolbar']`
   or `[aria-orientation]` on a group must move to `[data-orientation]`.

2. **`Switch` renames `data-orientation` to `data-label-position`** (values `before` / `after`). The
   old attribute conflated two different things: a switch's own axis, which is always horizontal, and
   where its label sits. It now emits both honestly — `data-orientation="horizontal"` per the shared
   state-attribute table, and `data-label-position` for the label. Migration: a stylesheet matching
   `[data-slot='switch'][data-orientation='label-before']` becomes
   `[data-slot='switch'][data-label-position='before']`. The `orientation` **prop** is unchanged.

3. **`Navbar`'s in-menu leaves are `Menu.LinkItem`, not `data-slot="navbar-link"`.** A link *on the
   bar* still renders `<a data-slot="navbar-link">`; a link *inside a dropdown* is now
   `<a role="menuitem" data-slot="menu-link-item">`, because a row in a `role="menu"` has to be a
   menu item. Nested dropdown triggers likewise become `data-slot="menu-submenu-trigger"`, and the
   `<div data-slot="popover">` wrapper around a nested submenu is gone — a wrapping element inside a
   `role="menu"` breaks its content model. Migration: a stylesheet or test selecting
   `[data-slot='navbar-link']` inside a dropdown selects `[data-slot='menu-link-item']` instead.
   `NavDefinition` and all nine exported `Navbar` types are unchanged.

4. **`ThemeToggle` no longer carries `aria-label="Toggle theme"`.** A static label never told anyone
   which theme was active. The accessible name now comes from an `sr-only` span inside each of the
   three `theme-*-icon` spans, so it tracks the theme by the same CSS that switches the glyph — with
   no JavaScript, and correct at first paint. Migration: a test asserting that `aria-label` asserts
   the accessible name instead.

### Added

- **Eleven `ui/core` primitives.** `Toolbar`, `Menu`, `Tabs`, `Toggle`, `Collapsible`, `Tooltip`,
  `CheckboxGroup`, `RadioGroup`, `Meter`, `NumberField`, `ScrollArea` — all exported from
  `@y-core/forge/ui/core`, all with a `ui/show` section.
  - `Menu` is built on the Popover and Invoker Commands APIs: opening, closing, light-dismiss and
    Escape involve **no JavaScript at all**. Its items are identified by ARIA role, so a row built in
    the browser is navigable the moment it is a correctly-roled menu item. `Menu.LinkItem` is a real
    `<a>` for rows that navigate; `Menu.SubmenuTrigger` is the roled trigger a nested popup needs.
  - `Collapsible` and `Accordion` are native `<details>`; `Tooltip` is `popover="hint"`, so it does
    not dismiss the menu beneath it; `Meter` is a native `<meter>`, distinct from `Progress`.
- **Seven client controllers**, all `@public`, all returning a disposer:
  `mountRovingFocus`, `mountTransitionState`, `mountMenu`, `mountTabs`, `mountTooltip`,
  `mountNumberField`, and the owner-document utilities (`ownerDocument`, `ownerWindow`,
  `activeElement`, `eventTarget`, `asElement`, `closestAcross`, `contains`).
  - `mountRovingFocus` is the composite controller: one tab stop, arrow keys, Home/End, typeahead,
    RTL, disabled-item skip and focus restoration, as **one function over a DOM subtree**. Items are
    resolved live on every interaction, so a widget whose rows are rebuilt between openings needs no
    re-mounting.
- **`ToggleGroup` gains `type`** (`"single" | "multiple"`, published as `data-multiple`), and
  **`bindGroup` now reconciles pressed state across the whole group** — writing `aria-pressed` and
  `data-pressed` on every item, not just the signal. That reconciliation used to be documented as
  "stays app-side", which is why a segmented control was styled markup rather than a primitive.
- **`data-pressed` and the shared state-attribute table.** Fourteen styling hooks — `data-open` /
  `data-closed` / `data-pressed` / `data-checked` / `data-selected` / `data-disabled` /
  `data-invalid` / `data-orientation` / `data-side` / `data-align` / `data-starting-style` /
  `data-ending-style` / `data-popup-open` / `data-anchor-hidden` — declared once for both tiers, so
  the SSR component and the browser controller cannot drift. Boolean states are emitted **by
  presence** (`data-open=""`), never `"true"`.
- **A browser test set behind its own verb**, `bun run test:browser` (`bun run test:install`
  first). A `*.browser.ts` file runs in real Chromium; `bun test` is untouched, and the two never
  share a process. **260 cases**, including a cross-cutting corpus for the scenarios no single
  component owns: nested overlays, a trigger removed while its popup is open, a widget in a form
  across submit and reset, a widget inside a shadow root, focus restoration across unmount, and RTL.
- **`ui/show` is the complete demo estate**, and it is now checked rather than asserted: a test reads
  the published `ui/core` surface and requires a catalog section for every component. Nine sections
  were missing and were added.

### Changed

- **`@y-core/forge/ui/chrome/client` now side-effect-imports `@y-core/forge/ui/core/client`.** Chrome
  markup names the `menu` and `toolbar` scopes, and a component whose markup names a scope must
  guarantee the scope exists. Without it, an app importing only the chrome island got `resume()`
  warnings and a navbar and toolbar that were dead to the keyboard. Importing both remains harmless.
- **`chrome/Toolbar` adopts the toolbar contracts.** The rail emits `role="toolbar"`,
  `data-scope="toolbar"` and `data-orientation` / `aria-orientation` (`vertical` for a left or right
  rail), every action and popover trigger carries `data-toolbar-item`, and separators are
  `<hr aria-orientation>`. The whole rail is now **one tab stop** with arrow-key navigation. All
  eleven exported types are unchanged, and the flyout markup is untouched — its CSS anchoring cannot
  be expressed through the generic `Popover`.
- **`chrome/Navbar` composes `core/Menu`.** Its dropdowns get arrow navigation, typeahead and focus
  restoration, and their `data-closed` attribute stops lying — nothing previously mounted transition
  state for them. It deliberately does **not** claim `role="menubar"`: forge has no menubar
  controller, and the role without the behaviour announces a keyboard interface that is not there.
- **Every controller resolves its globals from a node** rather than reaching for `document`,
  `window`, `event.target` or `instanceof HTMLElement`. A widget inside an iframe now installs its
  listeners on its own document, and one inside a web component reports the focused *item* rather
  than the shadow host.

### Fixed

- **The `navbar` scope never ran.** It was registered lazily, and a lazy scope resumes on the first
  `data-on-*` interaction inside it — but the navbar's markup emits none at all (native `<details>`,
  native popovers, plain links). Runtime auth filtering therefore silently did nothing. It is now
  eager, as is every other setup-only scope.
- **`mountRovingFocus` was not nestable.** A parent menu's item ring included its *closed* submenu's
  rows, so arrow navigation walked into a `display: none` subtree and focus went nowhere. Items are
  now filtered to what is actually rendered, which also excludes a `hidden` filtered-out navbar row.
- **Two nested composites both consumed the same key.** `keydown` bubbles from an open submenu to the
  popup containing it, so both controllers moved focus and the inner move was immediately
  overwritten. The outer one now stands down when the event was already handled.
- **`localStorage` on an opaque origin.** The theme scope's storage reads are unchanged, but the test
  harness now serves pages from a real origin, which is what surfaced the two fixes above.

### Removed

- **Every hand-rolled DOM mock.** The stub documents, elements, media queries and storage that stood
  in for a browser in `resume`, `turnstile`, `nav` and `chrome/client` tests are gone, replaced by
  browser specs. Two of the theme cases they replaced were unreachable from a stub at any price: a
  `prefers-color-scheme` the browser actually resolves, and a live media change arriving after
  resume — which is the only reason the scope listens for `change` at all.

---

## [0.0.68] — 2026-07-17

Turnstile refactor: a server-rendered `<Turnstile>` mount point plus a rewritten, resilient
`mountTurnstile()` controller, and a honeypot-default alignment fix. Contains **breaking changes**
for apps that mount Turnstile or rely on the built-in honeypot — see the migration guide below.

### ⚠️ Breaking Changes

1. **`mountTurnstile()` is now arg-less.** The `isDark` argument, the `options` argument, and the
   `TurnstileOptions` type (with its `widgetSelector` / `submitSelector` / `formSelector` /
   `resultSelector` / `onSuccess` options) are removed, as is the submit-button gating. The controller
   now finds the widget and its enclosing `<form>` on its own (`widget.closest("form")`) — nothing to
   configure — reads the theme from `.dark` on `<html>` at render time, and no longer disables the
   submit button (the server `verifyTurnstile` is the single fail-closed enforcement point).

   ```ts
   // before
   mountTurnstile(isDark, { onSuccess: "remove" })
   // after
   mountTurnstile()
   ```

   Migration: call `mountTurnstile()` with no arguments, and render the new `<Turnstile siteKey=… />`
   component inside the form in place of any hand-authored `.cf-turnstile` markup (the controller owns
   rendering, so the auto-render class is intentionally omitted).

2. **`<Form>`'s default honeypot field is now `__surname`** (was `surname`), aligning it with
   `HONEYPOT_FIELD_DEFAULT` and `isHoneypotFilled`'s default — previously the component rendered
   `surname` while the verifier checked `__surname`, so the built-in honeypot never fired. Both sides
   now default to `__surname` and remain overridable: `<Form honeypotField="…">` on the markup and
   `isHoneypotFilled(formData, "…")` on the check. Migration: if you relied on the honeypot, ensure
   both sides use the same field name (the new default requires no action; a custom name must be passed
   to both).

### Added

- **`Turnstile` SSR component** (`@y-core/forge/ui/core`) — a server-rendered `[data-ref='turnstile']`
  mount point carrying `data-sitekey` / `data-size` and a hidden fallback message. Props:
  `{ siteKey: string; size?: "compact" | "flexible" | "normal"; children?: JSXNode }` (`children`
  overrides the default fallback text). Place it inside the `<form>`.
- **Resilient `mountTurnstile()` behavior** — engagement-gated script load (loads once on the first
  `focusin` within the form, never on page load or scroll), token reset after every completed
  submission (success or error, via `htmx:afterRequest`) and on expiry/timeout (fixes spent-token
  `403`-on-retry), a visible fallback message on load/render failure, and no submit-button gating.

### Fixed

- **The built-in honeypot never fired.** `<Form>` rendered its honeypot input as `surname` while
  `isHoneypotFilled` checked `__surname`, so submissions were never rejected. Both sides now default
  to `__surname` (see Breaking Changes) — the honeypot works out of the box.

### Internal

- `mountTurnstile` is now unit-tested against a hand-rolled DOM mock (engagement-gated load, render,
  token reset on `htmx:afterRequest`/expiry, fallback-on-failure, idempotent mount, teardown), and the
  `Turnstile` component has exact-match SSR render tests. Internal `ui/turnstile-contract.ts` holds the
  data-ref/script constants shared by the component and controller (not part of the public surface).

---

## [0.0.67] — 2026-07-17

Project Improvement: testing/DX helpers, API-ergonomics normalization, and dead-code/housekeeping.
Additive test infrastructure, plus a handful of **breaking changes** for apps on `0.0.66` —
see the migration guide below.

### ⚠️ Breaking Changes — migration from 0.0.66

1. **Form verification APIs take an options object only.** The trailing positionals and the
   `number | options` union are gone.

   ```ts
   // before (0.0.66)
   verifyTurnstile(formData, secret, { expectedHostname }, "cf-turnstile-response", remoteIp)
   verifyCsrfToken(keyOrRing, token, path, 3_600_000)
   // after (0.0.67)
   verifyTurnstile(formData, secret, { expectedHostname, tokenField: "cf-turnstile-response", remoteIp })
   verifyCsrfToken(keyOrRing, token, path, { maxAgeMs: 3_600_000 })
   ```
   `csrfProtection` now takes the named, exported `CsrfProtectionOptions` type (same shape).

2. **`Config` is constructed via `createConfig()` — the public constructor is gone.**

   ```ts
   // before
   import { Config } from "@y-core/forge/config"
   const cfg = new Config(map, schema, overrides)
   // after
   import { createConfig } from "@y-core/forge/config"
   const cfg = createConfig(map, schema, overrides)
   ```

3. **`htmlResponse` / `fragmentResponse` now throw if you pass a `content-type` header.**
   Previously it was silently discarded (these helpers always emit `text/html`). Remove any
   `content-type` key from the `headers` argument — passing one is now a thrown `Error`.

4. **`Config.get(env)` caches per-`env` instead of first-env-wins.** Different `env` objects now
   resolve independently — no `reset()` needed between them. Only affects tests that relied on the
   old single-slot cache; production (one stable `env`) is unchanged.

5. **Removed exports (all unused/leaked — no runtime behavior lost):**
   - `@y-core/forge/config`: `applyMapping` (now internal).
   - `@y-core/forge/form`: the `CsrfConfig` / `TurnstileConfig` types (orphaned; the runtime path
     uses the `*Schema` valibot schemas).
   - `@y-core/forge/validation/cli`: the codegen internals `REGISTRY`, `emit`, `stripJsonc`,
     `collectBindings`, `collectVars`, `HEADER`, `DEFAULT_OPTIONS` (now `@internal`; `createGenEnv`/
     `loadOptions`/`readWranglerConfig`/`GenOptions` remain public).
   - `createObjectStore` (R2) no longer accepts a `logger` option — it never emitted logs.

### Added

- **Test doubles & helpers in `@y-core/forge/testing`:** `fakeD1` (programmable in-memory D1
  stub — records `calls`, returns configured rows), `fakeR2` (functional in-memory R2 bucket),
  `render` (SSR render-to-string), `mapHandler` (single-route registrar), and `buildRequest(path, opts?)`
  (kills `new Request("http://test/…", {…})` boilerplate). `fakeKV.list` now supports **cursor
  pagination** (`list_complete:false` + `cursor`).
- **`CsrfProtectionOptions`** (`@y-core/forge/form`) and **`SignedCookieOptions`**
  (`@y-core/forge/session`) are now exported named types.
- TSDoc + `@public` tags added to ~20 previously-undocumented exports (heaviest in `security` and
  `config`).

### Changed

- `Forge.map` is now fully typed — the internal `any` cast and `void`-return erasure are gone; the
  router's real signature flows through.
- Logging: `flush()`'s best-effort contract is documented (writes evicted by the pending-cap are
  fire-and-forget); the KV purge window is a named `PURGE_LIST_LIMIT`.

### Internal

- The full test suite's HTML assertions were migrated from substring `toContain` to exact-match
  (catches extra/injected attributes); new coverage for the assets build pipeline (`css`/`fonts`/
  `icons`/`copy`/`state`), `context/pending-headers`, the app error-boundary/HEAD paths, the theme
  FOUC script, and a `http/headers` facade-contract test.
- `validation/cli/cf-env-gen.ts` split into a data module (`cf-env-registry.ts`) + codegen module;
  assets-CLI config plumbing deduped.

---

## [0.0.66] — 2026-07-17

Project Improvement: catalog integrity, namespace layering, a unified
error model, security hardening, and UI component API consistency. This release contains
**breaking changes** for apps on `0.0.65` — see the migration guide below.

### ⚠️ Breaking Changes — migration from 0.0.65

1. **Error model unified — `ValidationResult` failure field renamed `errors` → `error`.**
   `ValidationResult<T>` is now a domain alias of the one `Result` primitive
   (`Result<T, readonly string[]>`), so its failure channel is `error`, not `errors`.
   This affects every consumer `validate` hook and any code reading it.

   ```ts
   // before (0.0.65)
   validate: (data) => data.email ? { ok: true, data } : { ok: false, errors: ["email required"] }
   // after (0.0.66)
   validate: (data) => data.email ? { ok: true, data } : { ok: false, error: ["email required"] }
   ```
   `onValidationError(errors, c)` still receives the message array — only the union field moved.

2. **`@y-core/forge/render` removed — import renderer from `@y-core/forge/jsx`.**
   The redundant `./render` subpath is gone; its symbols are (and were already) exported by `./jsx`.

   ```ts
   // before
   import { renderPage, renderToString, type FC } from "@y-core/forge/render"
   // after
   import { renderPage, renderToString, type FC } from "@y-core/forge/jsx"
   ```

3. **`csrfProtection` — `subject` is now required.**
   Pass a session/subject resolver, or the explicit greppable `subject: false` opt-out
   (path-only tokens). Omitting `subject` is now a compile error. Closes a token-fixation
   risk where a token bound only to a path was transferable between users.

   ```ts
   // before
   csrfProtection({ secret })
   // after — bind to the session…
   csrfProtection({ secret, subject: (c) => c.session?.id })
   // …or explicitly opt out
   csrfProtection({ secret, subject: false })
   ```

4. **Cloudflare header trust is now default-**distrust** (`trustCfHeaders`).**
   `requestId` no longer echoes client-supplied `CF-Ray`, and `rateLimit`'s default key no
   longer reads `CF-Connecting-IP`, unless you opt in. On Cloudflare Workers these headers
   are trustworthy, so **CF-deployed apps must opt in**:

   ```ts
   requestId({ trustCfHeaders: true })
   rateLimit({ limiter, trustCfHeaders: true })   // else the default key throws — or pass your own `key`
   applyMiddlewareChain(app, { ...opts, trustCfHeaders: true })  // threads to both
   ```
   Off Cloudflare (the unsafe case), leave it off: `requestId()` mints a fresh UUID and
   `rateLimit` requires an explicit `key`.

5. **Log viewer is now secure-by-construction — `loadLogViewer` returns a `Response`.**
   The render components (`LogViewerContent`, `LogTable`, `LogDetailCell`, …) and the
   `renderLogFragment`/`renderLogDetailFragment` helpers are now internal — rendering log
   records is only possible through the auth-gated loader. `LogViewerOptions` gained a
   required `icon`. Mount it as a single loader:

   ```ts
   // before: loader returned data, your view rendered LogViewerContent / renderLogFragment
   // after:
   export const logsPage = definePage({
     loader: (c) => loadLogViewer(c, { channel, access, icon: chevronDownIcon }),
     view: (_c, _cfg, s) => s.data, // loader returns a Response and short-circuits
   })
   ```

6. **JSX `style` prop removed from the attribute types.**
   Inline `style` was already silently dropped at render (CSP `style-src 'self'`); it is now a
   compile error so the type matches runtime. Move inline styles to CSS classes.

7. **Guard-result types carry the reason code in `.error` (was `.reason`); `CopResult` → `CrossOriginResult`.**
   `CsrfResult`, `TurnstileResult`, `OriginResult`, and `CrossOriginResult` are now
   `GuardResult` aliases. Most callers only branch on `.ok` (unaffected); if you read the
   failure code, use `.error`. The internal `CopResult` type was renamed `CrossOriginResult`.

8. **KV log persistence no longer stores error stacks by default.**
   `kvLogChannel` strips `stack` from persisted records (7-day KV retention) unless you opt in
   with `persistStack: true`. `consoleChannel` is unchanged (stacks kept for local debugging).
   Wrap any channel with the new `withRedaction(channel, fn)` for custom PII redaction.

Minor: `htmlResponse` now always emits `content-type: text/html; charset=utf-8` (previously
uppercase `UTF-8` when called without a `headers` argument) — only matters if you assert exact
header casing.

### Added

- **`ok()` / `err()` result constructors and the `GuardResult<R>` type** (`@y-core/forge/result`) —
  build result values without ad-hoc object literals; `GuardResult<R> = Result<void, R>` for
  predicate/authorization checks.
- **Bound `Input` and `Textarea`** in `@y-core/forge/ui/controls` (fills the form-field gap
  alongside `Select`/`Slider`/`Switch`/`ToggleGroup`).
- **`cn` / `asClass` / `cva`** ratified as public utilities on `@y-core/forge/ui/core`.
- **Universal DOM attribute pass-through** — all `ui/core` components (`card`, `alert`, `toast`,
  `accordion`, `popover`, `badge`, `spinner`, `separator`, `skeleton`, …) now forward
  `id`/`data-*`/`aria-*`/event attributes; no more re-wrapping to attach `hx-*`/`data-*`.
- **`withRedaction(channel, fn)`** log-channel wrapper and **`persistStack`** option
  (`@y-core/forge/logging`).
- **`trustCfHeaders`** options on `requestId`, `rateLimit`, and `applyMiddlewareChain`.
- **Icon `role="img"`** emitted automatically when `aria-label` is present.
- `validateBindings` / `validateEnv` / `ConfigKey` are now also importable from
  `@y-core/forge/context` (the canonical home); the `@y-core/forge/app` re-exports still work.
- Client `resume()` now `console.warn`s when it encounters a `data-scope` with no registered
  scope (catches a forgotten `import "@y-core/forge/ui/core/client"`).

### Changed

- **Origin-guard tiering:** `originProtection` (recommended combined default) now exempts safe
  methods before the Sec-Fetch-Site check, aligning with `originGuard`; `crossOriginProtection`
  (Sec-Fetch-Site only) and `originGuard` (Origin/Referer only) documented as the lower tiers.
- **JSX renderer:** attribute *names* are now validated (unsafe keys from spreads are skipped);
  enumerated attributes (`draggable`/`spellcheck`/`contenteditable`) emit `="true"`/`="false"`
  instead of a bare name.
- `Button asChild` still throws on a non-element child (ratified as a programming-error
  invariant) — the error message is now more actionable.
- `serveObject` (R2) now catches async backend failures and returns a `500` Response instead of
  leaking an unhandled rejection.
- `ScopeDefinition.on` is now optional (setup-only client scopes no longer write `on: {}`).
- `chrome/client`'s `isDark` is a stable accessor (was a reassigned exported `let`); behavior
  unchanged (reads `false` until resume).

### Fixed

- **Native Invoker Command bridge fired nothing.** `resume()` now listens for `command` in the
  **capture phase** — the platform dispatches `CommandEvent` with `bubbles:false`, so the prior
  bubble-phase delegated listener never saw it and every custom `--action` (button / menu-item
  activation via `commandAttrs`) was dead. Built-in commands (`toggle-popover`, …) are unaffected.
- **Popover panels and toolbar flyouts no longer run off-screen.** `[data-slot="popover-content"]`
  and `[data-slot="toolbar-flyout"]` gain `position-try-fallbacks: flip-block, flip-inline` so an
  anchored panel flips to the opposite side instead of overflowing a viewport edge when its trigger
  sits near the bottom or right of the screen.
- `ui/client/lazy.ts` now `CSS.escape`s interpolated `ref`/`scriptSrc`/`href` in `querySelector`
  strings (a quote no longer breaks the selector).
- `timingSafeEqualBytes` falls back to a constant-time JS comparison when
  `crypto.subtle.timingSafeEqual` is unavailable instead of throwing.
- `htmlResponse` charset casing normalized (see Breaking Changes, minor).

### Internal / Tooling

- **`validate-exports`** now runs reverse passes — every `src/**/mod.ts` must be an export target
  or on a sealed-internal allowlist, and every `files[]` entry must exist on disk — and correctly
  attributes `@public` symbols in single-file export subpaths (e.g. `./ui/chrome/client`).
- Catalog integrity: removed the dead `templates/` `files[]` entry; `crypto` documented as a
  sealed-internal namespace.
- The error-model doctrine, the `result` namespace as a foundational primitive, and the origin
  guard / CF-header trust / `asChild` contracts are ratified across the `.decisions/` docs.
- Duplicated `toError` in `app/forge-app.ts` removed; the shared env-validation throw wrapper
  extracted to `validation/parse-env.ts`.

[0.0.75]: https://github.com/y-core/forge/compare/v0.0.74...v0.0.75
[0.0.74]: https://github.com/y-core/forge/compare/v0.0.73...v0.0.74
[0.0.73]: https://github.com/y-core/forge/compare/v0.0.68...v0.0.73
[0.0.68]: https://github.com/y-core/forge/compare/v0.0.67...v0.0.68
[0.0.67]: https://github.com/y-core/forge/compare/v0.0.66...v0.0.67
[0.0.66]: https://github.com/y-core/forge/compare/v0.0.65...v0.0.66
