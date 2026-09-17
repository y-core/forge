# Changelog

All notable changes to `@y-core/forge` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **`[Unreleased]` is the only section humans edit.** `bun run release` promotes it into a dated
> version section, with the version and the date computed — never typed. Editing a released
> heading by hand puts it out of step with the tag and `package.json`, which
> `bun run verify --only validate-changelog` refuses.

> **Pre-1.0 versioning.** Per the project's architectural policy, breaking changes ship
> **without deprecation shims** and consuming apps are updated in the same window. A `0.0.x`
> bump can therefore contain breaking changes — always read the **Breaking Changes** section
> before upgrading.

---

## [Unreleased]

### Upgrading

Every action this version asks of a consuming app, loudest failure last. The entry for each below
carries the reasoning; this is the checklist.

1. **Expect the D1 client and KV store to stop logging** unless you pass `{ logger }` — they
   defaulted to the console channel against their own documented promise. **Fails silently**: query
   and cache-miss records simply stop arriving. Pass a logger where you want them.
2. **Re-key any dashboard or alert matching `requestLogger`'s summary message.** It was the
   interpolated request line (`"GET /thing"`); it is now the static label `"request.completed"`, or
   `"request.failed"` when a throw escaped `next()`. The method and path are still fields.
   **Fails silently**: a query keyed on the old message matches nothing and the panel reads zero.
3. **Re-key anything reading the `error` field of `kv.decode-error` or `d1.schema.health.failed`.**
   Both now carry the serialized `{ name, message, stack? }` object every other forge record uses,
   rather than a string. **Fails silently**, as a field that no longer parses.
4. **Decide whether this app wants `methodMismatch: "advertise"`.** Nothing breaks if you skip
   this — the default preserves the previous answer exactly — but a JSON API probably wants the
   RFC `405`, and opting in is one line.
5. **Expect every signed cookie to stop verifying on deploy** — a cookie configured with `maxAge` or
   `expires` now carries that expiry inside its signature, and a value minted before this version
   carries none. Every signed-in visitor is signed out once, and every flash message in flight is
   dropped. **Fails silently**: the value simply reads as `null`, exactly as a tampered one does, and
   the visitor gets a fresh session. Nothing to change in code — plan the deploy window.
6. **Re-check any route param whose value can carry a `.`** — a dot in a param is now percent-encoded,
   so `/files/report.pdf` is generated as `/files/report%2Epdf`. **Fails silently**: the link still
   resolves, but the emitted markup, canonical URL and cache key all change.
7. **Confirm no address is built from a non-ASCII `email` value** in a schema of your own —
   `v.email()` now refuses characters Unicode case folding previously admitted, so a record that
   used to validate can stop. Forge's own auth fields no longer use it. **Fails at the boundary**,
   as a validation refusal rather than an error.
8. **Expect a signed-in non-administrator's `PATCH`/`DELETE /admin/users/:id` to answer `403`** where
   the write previously landed. Nothing to change unless an app reached those handlers with a
   non-admin identity on purpose. **Fails as the refusal**, with no write attempted.
9. **Re-check any stored object whose `contentType` your app sets from a caller** — an
   `application/atom+xml`, any other `+xml` essence, `text/xsl`, `application/x-javascript`,
   `text/ecmascript` or `application/ecmascript` object now serves as an `attachment` under
   `Content-Security-Policy: sandbox`. **Fails visibly**: an object that rendered inline downloads
   instead. Objects whose type forge inferred are unaffected.
10. **Take a fresh `forge db backup` before the next `forge db reset`** if the newest artifact was
    written by hand — an artifact whose manifest declares no files, or an undeclared `.sql` beside
    the declared ones, is now refused. **Fails as the refusal**, before anything is removed.
11. **Give every `assets` JS bundle an `outdir` naming a directory below the asset root** — `"."`,
    `""`, `".."` and an absolute path are rejected, and `_headers` now stays inside the app root
    when `publicDir` is a single segment. **Fails at config parse**, naming the field.
12. **Configure `AuthWebOptions.bootstrapSecret` if this app uses the first-admin claim** — both
    `GET` and `POST /admin/elevate` answer `404` until one is set, and the form gained a `secret`
    field. **Fails as a 404** on a page that used to render.
13. **Add `storage: "cookie"` to any `createAnonymousSession` call that omits `kv`** — omitting both
    now throws, and so does passing both. **Throws at `app.use(…)` time**, which in a Worker is
    isolate startup rather than a request, so it is caught by the first deploy that runs.
14. **Check any cookie-backed session or flash payload approaching 4 KB** — `serialize` now throws
    over 4096 bytes rather than emitting a header the browser discards. **Throws from the middleware's
    response phase**, so the boundary answers `500` naming the cookie and its measured size.
15. **Pass `createAuthGuards` a `routes` map for every group you declare guards for** — a declared
    group whose map is missing, or which holds no route of its own, now throws instead of being
    skipped in silence. **Throws at `app.use(…)`**, naming the group.
16. **`strictObject(` → `v.strictObject(`**, and drop `strictObject` from the
    `@y-core/forge/validation` import — `tsc`.
17. **Move the third argument of `createHref` and `Route.href` under `searchParams`** — `tsc`.
18. **Give any cookie object of your own a `rotating` field before passing it to `sessionMiddleware`**
    — `{ ...cookie, rotating: false }`, plus a `read` method if it is not one forge built. A correctly
    signed third-party cookie no longer compiles, because the middleware's parameter narrowed from
    `SignedCookie | UnsignedCookie` to `SignedCookie` — `tsc`.
19. **Pass `origin` to `createAuthGuards`** — the field is required, and an untyped consumer who
    omits it gets a throw naming the group at `app.use(…)` rather than a group mounted with no
    cross-origin defence — `tsc`.
20. **Pass `AuthRequestServices.admin` the `AdminUserStore` rather than a built `AdminUserService`**,
    and drop `createAdminUserService` from the `@y-core/forge/auth` import — forge builds the service
    per request now — `tsc`.
21. **Give a hand-rolled `requireAuth` options object `factors` and `stepUpPath`** — the guard now
    enforces an owed step-up itself, so both are required and a session owing one gets a redirect or
    `403` where it previously reached `next()` — `tsc`.
22. **Handle `"refused"` in any exhaustive `switch` over `SyncAction`** — `cf sync` reports a secret
    whose name is also a plaintext `vars` key rather than pushing it, and exits non-zero — `tsc`.
23. **`DEFAULT_PREF` → `DEFAULT_THEME_PREF`** in the `@y-core/forge/ui/chrome` import — the old name
    carried no domain word. Same value, same meaning — `tsc`.

### Breaking Changes

- **The auth mount fails closed on four wirings it previously accepted in silence.** Each was a
  deployment that looked mounted and was not guarded, so each is now a throw or a refusal rather
  than a default:

  | Wiring | Was | Is |
  | --- | --- | --- |
  | `createAuthGuards` with no `origin` | the group mounted with no `Origin`/`Referer` check | `origin` is a required field, and a mutating group without one throws at `app.use(…)` naming the group |
  | `createAuthGuards` with a guarded group whose `routes` map is absent or holds no own leaf | the group was skipped, its routes left unguarded | throws at `app.use(…)`, naming the group and the guards that would have covered nothing |
  | `requireAuth` on its own | an owed step-up was enforced only by the groups that also listed an enrolment guard | the guard resolves the demand itself; `factors` and `stepUpPath` are required, and a session owing a step-up is redirected (`403` on a JSON group, `503` on an unreadable registry) |
  | `POST /admin/elevate` | the first-admin claim was open to whoever posted first | requires `AuthWebOptions.bootstrapSecret`; both the page and the POST answer `404` until one is configured, and `authAdminElevateSchema` gained a `secret` field |
  | `AuthRequestServices.admin` | an `AdminUserService` the consumer built and passed in | the `AdminUserStore`; forge builds the service over it per request, and `createAdminUserService` is no longer exported from `@y-core/forge/auth` |

  **The administrative surface is forge's to build, not the consumer's to supply.** `AdminUserService`
  is the shape the write path is written against — the last-admin guards, the self-lockout refusals
  and the role writes are all its methods — so accepting a ready-made one left a consumer able to
  hand in a surface those refusals had never been checked against. The type stays exported; only the
  factory is withdrawn.

  **`PATCH` and `DELETE /admin/users/:id` also judge the role themselves now**, answering `403` to a
  signed-in non-administrator. The `admin.users` group's `require-admin` runs on the loader the
  handler redirects to — which is after the write commits — so it was never what refused the write.

  **`resolveAuth` is unchanged, and that is the stated limit of the `requireAuth` fix.** A session is
  established when the primary factor lands, so a visitor owing a step-up carries a full identity on
  `authCtx` — which is what the verify page needs in order to tell a step-up from a sign-in. Check
  any route of your own that renders member data behind `resolveAuth` alone: it is not a gate, and
  `requireAuth` is the guard that resolves the demand.

  **Migration:** pass `origin` (and a `routes` map for every guarded group) where you build the
  guard chain; add a `bootstrapSecret` resolver if this app uses the claim page; add `factors` and
  `stepUpPath` to any `requireAuth` you call directly; swap `AuthRequestServices.admin` to the store.
  `tsc` finds all but the claim secret and the `resolveAuth` review.

- **A session cookie's lifetime is now enforced by its signature, cookie storage is a stated choice,
  and `sessionMiddleware` will not take an unsigned cookie.** Five surfaces change, with no shim and
  no legacy wire format (pre-1.0, [`FORGE_STRUCTURE.md`](docs/FORGE_STRUCTURE.md) §7):

  | Surface | Was | Is |
  | --- | --- | --- |
  | `sessionMiddleware(storage, cookie)` | `SignedCookie \| UnsignedCookie` | `SignedCookie` — the unsafe wiring is a type error, not a review note |
  | A signed cookie's wire value | `base64(value) "." base64(hmac)` | `<expEpochSeconds> "." base64(value) "." base64(hmac)` wherever `maxAge` or `expires` is configured, the HMAC covering both segments |
  | `createAnonymousSession(options)` | omitting `kv` fell back to cookie storage | `storage?: "cookie"`; exactly one of it and `kv`, or the factory throws |
  | `SignedCookie` | `rotating`, `parse`, `serialize` | adds `read(header)`, answering `SignedCookieReading \| null` — the verified value alongside whether the current secret signed it |
  | `serialize(value, attributes?)` | any size; `httpOnly`/`secure` relaxable per call | throws over 4096 bytes; both flags re-forced over the override |

  **The expiry is absolute from the last emit, not from login.** It is re-armed on exactly the events
  that re-arm `Max-Age` — a session write, or `reissue: true` — so an active visitor is never cut off
  mid-session. A value carrying no expiry where one is configured parses to `null`, the same answer a
  tampered value or one signed by a retired secret already got. There is no grace window, no
  format-detection branch and no `legacyUntil`.

  **Rotation no longer decides by re-signing and comparing wire bytes.** `read` reports which secret
  verified the incoming value, so `sessionMiddleware` checks that directly. This removes one HMAC per
  request under rotation and makes the detection exact — and it is forced, because an embedded expiry
  makes the re-signed bytes differ every second, which would have meant a `Set-Cookie` on every
  response forever.

  **What this closes.** `maxAge` was a `Set-Cookie` attribute a client decides whether to honour, so a
  session cookie captured once — a shared device, a proxy or CDN access log, a browser profile backup
  — replayed indefinitely. Under cookie storage upstream's `regenerateId()` is a `console.warn` and
  nothing else, so signing out changed nothing server-side and the only revocation was rotating the
  signing secret, which signs out every user. The README's own "Revocation: impossible until cookie
  expiry" row was false, because nothing enforced the expiry. It is true now.

  **What it does not close, stated rather than solved.** Cookie storage still has no per-session
  revocation inside the window — the expiry bounds it, `regenerateId()` does not. Bounding a session
  from the instant it was created is a different guarantee and is not this one: store the login
  instant in the session and check it. And a `Set-Cookie` under 4096 bytes that a *particular*
  browser still refuses, over a per-domain cookie count or a smaller vendor cap, is not something a
  server can measure.

- **`createHref`'s third argument is an options object, and so is `Route.href`'s second.** Search
  params are now one field of it:

  ```ts
  createHref("/search", undefined, { searchParams: { q: "a b&c" } }); // "/search?q=a+b%26c"
  routes.search.href(undefined, { searchParams: { q: "a b&c" } });
  ```

  **Migration:** wrap the existing argument in `{ searchParams: … }` at every call site. `tsc`
  finds all of them, and the accepted value is unchanged — a `URLSearchParams` or a record of
  strings, numbers, `null`, `undefined` or arrays of those. Pre-1.0, so no shim is owed.

  The options object also carries **`baseURL`**, which is new: an absolute URL against which a
  same-origin target is rendered as a path-relative href. It throws `TypeError` when the value is
  not absolute, or when no same-origin target can be resolved from it. Forge's `authPaths` readers
  forward `Parameters<Route["href"]>`, so they take both fields without a signature of their own.

- **A `.` inside a path param is now percent-encoded.** A dot became a pathname delimiter, so a param
  carrying one escapes rather than splitting the segment: `createHref("/files/:name", { name:
  "report.pdf" })` now returns `/files/report%2Epdf` where it returned `/files/report.pdf`. This
  reaches every `Route.href` reader too, `authPaths` included.

  **Migration:** no call site changes, and the link still resolves — but the bytes in the markup do
  not match, so an exact-string assertion, a canonical URL, a sitemap entry or a cache key built from
  one of these hrefs needs re-checking. A param that cannot hold a dot is unaffected.

- **`strictObject` is gone from `@y-core/forge/validation`; use `v.strictObject`.** The forge
  wrapper existed only to work around a valibot defect in `strictObject`, `looseObject` and
  `objectWithRest`, where a key colliding with an `Object.prototype` name was silently dropped
  instead of refused. The pinned valibot fixes it, which left the wrapper an identity function.

  **Migration:** `strictObject(` → `v.strictObject(`, and drop the name from the import. `tsc`
  finds every call site. Behaviour is identical — an undeclared `__proto__`, `constructor` or
  `toString` is refused, nested and under a `v.union` alike, which is what the wrapper already did.

- **`DEFAULT_PREF` is `DEFAULT_THEME_PREF` in `@y-core/forge/ui/chrome`.** The old name carried no
  domain word, so at a call site it read as a default of something the import did not say —
  `canon:CODE_RULES.md` §7 is the rule it failed. The value, the type and the meaning are unchanged;
  only the name moves.

  **Migration:** `DEFAULT_PREF` → `DEFAULT_THEME_PREF` in the import and at every use. `tsc` finds
  them all, and there is no behavioural difference to check afterwards.

- **`requestLogger`'s summary message is a static label, and two records serialize their error.**
  The message was the interpolated request line, which put a caller-supplied path — and any secret
  in its query string — inside a string no redactor can reach. It is now `"request.completed"`, or
  `"request.failed"` when a throw escaped `next()`; `method`, `path` and `status` are unchanged
  fields. Alongside it, `kv.decode-error` and `d1.schema.health.failed` carry `serializeError`'s
  `{ name, message, stack? }` where they carried a bare string.

  **Migration:** re-key any dashboard, alert or log query matching the old message or reading either
  `error` field as a string. Nothing in code changes.

- **`cf sync` refuses a secret whose name is also a plaintext `vars` key.** `src/tooling/cf/README.md`
  has always documented the refusal; the handlers threw the parsed config away and pushed anyway, so
  a name declared on both sides became a `secret_text` shadowing a `plain_text` of the same name.
  `SyncAction` gains `"refused"`, which the run's exit code now counts alongside `"error"`.

  **Migration:** handle `"refused"` in an exhaustive `switch` over `SyncAction` — `tsc` finds it.
  Remove the colliding name from one side or the other before the next `--commit`.

- **An `assets` JS bundle's `outdir` must name a directory below the asset root.** The build cleans
  `outdir` before writing into it, so `"."` or `""` deleted the asset root — this group's output and
  every sibling's. The schema now rejects `"."`, `""`, `".."` and an absolute path; `buildJS` refuses
  the asset root for a caller reaching past the schema; and the clean is scoped to the group's own
  stems. Separately, `_headers` is written through a new `deployRoot` helper, so a single-segment
  `publicDir` no longer puts it outside the app root.

  **Migration:** give any bundle whose `outdir` was `"."` a real directory. An app whose `publicDir`
  is a single segment will find `_headers` inside the root rather than beside it.

- **A backup artifact declaring no files is refused.** `takeBackup` writes `schema.sql` and
  `data.sql` for every backup, unconditionally, so a manifest declaring neither was never one this
  tool wrote — and the verifier, which iterated the manifest, had nothing to check and passed. It
  now works from the files a restore route actually loads, and additionally refuses an undeclared
  `.sql` in the backup directory or in `migrations/`, which `restoreInto` would otherwise execute.
  No `formatVersion` bump: every artifact this tool has written still verifies.

  **Migration:** a `forge db reset` against a hand-written artifact now stops. Take a fresh
  `forge db backup`.

### Added

- **`shadowTrees` and `queryTrees`, exported from `@y-core/forge/ui/client`** — the two halves of
  `queryAcross`, split so a caller on a per-frame path can pay for shadow-root discovery once.
  `shadowTrees(root)` returns `root` and every open shadow root at or below it, each walk costing a
  `querySelectorAll("*")`; `queryTrees(trees, selector)` is one native query per tree over a list the
  caller already holds. `queryAcross` is unchanged and is now their composition, so no call site
  moves. `bindControls` uses the split internally: it discovers at mount and re-walks only when a
  field matches nothing or a form reset lands.

- **`createApp({ methodMismatch })` decides what a URL answers when a pattern matched but no route's
  method did.** fetch-router 0.22 began answering such a request with `405` and an `Allow` header
  instead of falling through to the router's default handler. Forge intercepts that response, because
  which answer is right is a disclosure decision the app owns:

  - **`"notFound"` (default)** renders the `notFound` hook, or forge's hardened `404`. A registered
    URL and an absent one then answer identically, so the pair tells an unauthenticated prober
    nothing. This is the pre-0.22 behaviour, so **no consuming app changes**.
  - **`"advertise"`** returns a hardened plain-text `405` — the constant body `Method Not Allowed`,
    never the method the client sent, carrying the same `nosniff`, `default-src 'none'` and
    `no-referrer` the `404` does — with `Allow` listing every method registered at that URL, `HEAD`
    included wherever `GET` is. This is RFC 9110, section 15.5.6's answer, and what a JSON API
    usually wants.

  Under either mode a `405` a route handler returns for its own reasons is left untouched, and
  forge's global middleware still reaches the response — a `requestId()` guard's header lands on it
  either way. The disclosure `"advertise"` opts into stops at the guard line: a guard registered with
  `app.use` runs before dispatch, so one that answers without calling `next()` means no `405` is
  built. **`"advertise"` governs routed URLs only** — an `ANY` asset catch-all matches the mismatched
  method and answers first, which is inherent to a catch-all rather than a defect.

  `MethodMismatch` is exported as a type from `@y-core/forge/app`.

- **Every matcher forge builds carries a resource budget.** The route matcher and each `use()`
  guard matcher are built with `maxPatternSize` 4096 bytes, `maxMatcherSize` 1 MiB and
  `maxMatchWork` 200,000 — tighter than route-pattern's own 64 KiB / 16 MiB / 1,000,000 defaults.
  Forge builds every matcher itself, so it is the only layer that can set these for a consumer.

  **A route pattern over 4096 bytes throws `MatcherResourceError` at registration**, which is a
  deployment defect surfacing loudly rather than at request time. **A URL that exhausts the
  match-work budget throws during matching**, and forge's error boundary answers `500`. The budget
  is calibrated to sit above real traffic: 500 routes matched against a 32 KB URL — twice what
  Cloudflare will deliver — still matches rather than refusing, so it cannot bite a real request.

  **`MatcherResourceError` is exported from `@y-core/forge/router`**, with `MatcherLimits` and
  `MatcherResourceErrorDetails` as types, so a consumer catches the error forge's docs name without
  importing from `@remix-run/route-pattern` directly.

- **An `iframe`'s `srcdoc` accepts a `SafeHtml` value.** A trusted document is escaped once, which
  the browser's one decoding pass cancels, so it reaches the frame as markup; an untrusted string is
  still escaped twice and reaches it as text. `data-bind-attr` refuses `srcdoc` outright, so this
  was previously no way to put a document in a frame at all.

- **`package.json` declares `engines.bun` `>=1.4.0`.** `workerdStep` runs `bun test --parallel=2`,
  a flag that shipped in Bun 1.3.13, so a consumer building a gate from it now has the floor in a
  form a package manager can read.

### Changed

- **`v.email()` refuses non-ASCII characters that Unicode case folding used to admit**, `v.ulid()`
  refuses a ULID above 128 bits, and `v.url()` is now built on `URL.canParse`. All three arrive
  through the `v` facade with no call-site change. The `email` tightening is the one that can
  change an answer in a schema of your own: a value that validated before can now be refused. It no
  longer reaches forge's own fields — see the auth entry below.

- **Every auth address field validates against the HTML living standard, via `v.rfcEmail()`.**
  `authSigninSchema`, `authSignupSchema` and `authEmailChangeSchema` share one helper, so all three
  move together. The RFC form admits specials the previous regex refused — `o'brien@example.com`
  now validates — and forge pairs it with a dotted-domain check, so a single-label domain such as
  `ada@localhost`, which `v.rfcEmail()` alone accepts, is still refused: an address an OTP cannot be
  delivered to is not an address these forms want.

  **Migration:** nothing to write. An address previously refused for a legal special character now
  gets through; nothing that validated before is refused.

- **`isActiveContentType` recognises the `+xml` family, `text/xsl` and the remaining script
  spellings**, so `serveObject` downloads them as an `attachment` under `Content-Security-Policy:
  sandbox` rather than serving them inline. The previous set was seven literal strings, which left
  `application/atom+xml`, `application/rss+xml`, `application/rdf+xml`, `application/xslt+xml`,
  `application/mathml+xml`, `text/xsl`, `application/x-javascript`, `text/ecmascript` and
  `application/ecmascript` rendering as documents on the serving origin — a browser parses any
  `+xml` essence as one, and an XHTML-namespaced `<script>` in it runs.

  This is reachable only where an app passes a caller-supplied `contentType` to `put`;
  `inferContentType` never emitted any of these. **Migration:** an object that relied on rendering
  inline needs an explicit `contentDisposition: "inline"` on the `serveObject` call.

- **Dependencies upgraded.** `@remix-run/fetch-router` 0.20.1 → 0.22.0, `@remix-run/route-pattern`
  0.23.0 → 0.24.0, `valibot` 1.4.2 → 1.5.0, `wrangler` 4.129.1 → 4.134.0, `esbuild` 0.28.1 →
  0.28.2, `oxlint` 1.82.0 → 1.83.0, `oxfmt` 0.67.0 → 0.68.0, `@playwright/test` 1.62.0 → 1.63.0,
  and the optional `sharp` peer 0.35.2 → 0.35.4. The valibot entries in this section and the
  `strictObject` removal under **Breaking Changes** are the whole of what a consumer sees from these
  upgrades; the rest change nothing forge exposes.

### Fixed

- **The D1 client and KV store log nothing unless you pass `{ logger }`.** `src/storage/README.md`
  has always said query logging is off by default; both built a default logger on the console
  channel, so every statement — text and bound values — went to the log of any app that never
  passed one. Both now default to a silent logger.

- **`schemaHealthMonitor` flushes its logger before its `waitUntil` settles.** The monitor's whole
  product is one record per isolate, and `observe()` resolved before an asynchronous channel had
  written it — so the record was lost when the isolate was torn down.

- **A tab marked `aria-disabled` stays in the roving-focus ring, focusable but inert.**
  `src/ui/README.md` promises the WAI-ARIA split — native `disabled` leaves the ring, `aria-disabled`
  stays in it — and the ring skipped both. This reaches every composite `mountRovingFocus` drives.

- **A signal may no longer be bound to an `hx-on:*` attribute.** `docs/HTMX.md` §7b ratifies
  `hx-on:*` in the renderer, where a developer typed the attribute and its body. On the runtime
  binding path the developer names only the attribute and the signal supplies the body, so the
  script htmx executes would have come from data.

- **`forge/spacing-scale-only` fails loudly when the design system declares no `--spacing`.** An
  absent declaration made the unit `NaN`, every comparison against it false, and the rule silently
  reported nothing with the gate still green.

- **`checkSchema` reports a schema `config/db.ts` declares with no file behind it.** An absent file
  was dropped on the way in, leaving it indistinguishable from declaring nothing — and the check
  answered clean.

- **A `--` terminator ends flag parsing for `--help` too.** `forge <cmd> -- --help` printed help
  instead of passing `--help` to the command as the argument the caller had marked it.

- **A JSONC edit lands on the occurrence the parser reads.** Where a key was duplicated, the editor
  wrote the first and `JSON.parse` and wrangler both read the last — so the edit reported `ok` while
  the effective value never moved.

- **A `Toolbar` action with no `commandTarget` emits no invoker pair**, rather than `commandfor=""`.

- **A `NavLink` marked `current` inside a `Navbar` menu carries `aria-current`**, as one on the bar
  already did.

- **A seed refusal describes an environment value's shape rather than printing its bytes.**

- **The SSR-boundary gate reports a server file importing a published client subpath.** Bare
  specifiers resolve to no file in this tree, and `checkSsrBoundary` collapsed that into "not a
  crossing" — so a server-rendered `.tsx` writing `import … from "@y-core/forge/ui/core/client"`
  passed green, which is the crossing the rule exists to stop. It now consults the manifest for a
  bare specifier, exactly as `checkDevBoundary` already did: `clientSubpaths` collects every
  published subpath whose target is inside a client directory or is a registration entry point, and
  a hit is reported as a crossing. A third party's bare specifier still passes.

- **`loadSpriteGlyphs` reads a sprite once per isolate.** Every call fetched and re-parsed the whole
  sprite, so a handler calling it per request paid a subrequest and a full scan each time for an
  artifact that is immutable per deploy. The promise is now memoized per URL and prefix, which a
  deploy resets. A failure is never memoized — caching the empty map it returns would blank every
  glyph until the isolate was replaced.

- **An emailed one-time code refuses at a constant cost.** A refusal against an absent, expired or
  exhausted row spent a different number of statements and AEAD operations than one against a live
  row, so waiting past the code's lifetime restored the enumeration oracle the decoy branch exists
  to close. Every refusal now spends the same two statements and one AEAD open, and the decoy is
  calibrated against that one profile.

- **A `data.sql` backup artifact is checked against an allowlist.** The scan named four things it
  refused, so `REPLACE INTO`, `UPDATE`, `ATTACH DATABASE`, a non-preamble `PRAGMA`, a `WITH … INSERT`
  and an `INSERT` behind a comment all passed into `wrangler d1 execute --file`. Every statement must
  now be the dump preamble on line 1 or an `INSERT` into an allow-listed table; anything else is a
  fault naming the statement.

- **`fetchURL` refuses a redirect off https.** The scheme was checked on the input URL and `fetch`
  follows a redirect by default, so a host answering `Location: http://…` moved the bytes onto an
  unauthenticated transport. It now walks the chain itself under `redirect: "manual"` and refuses the
  first hop that leaves https — every hop, not just the one the bytes arrived from, because an
  https → http → https bounce reports an https `response.url` having already leaked the request.
  A chain over ten hops is refused as a loop.

- **`data-bind-attr` refuses `style`.** The SSR renderer drops a `style` attribute under the shipped
  `style-src 'self'`, so a binding that wrote one in the browser produced markup the renderer would
  never have emitted. It now warns and binds nothing, as it already did for `on*` and `srcdoc`.

---

## [0.1.17] — 2026-09-17

### Upgrading

Every action this version asks of a consuming app, loudest failure last — the first one is the only
one that fails without saying so. Each entry's own **Migration:** paragraph below carries the
reasoning; this is the checklist.

1. **`sed -i 's/^# foundry:/# forge:/' .dev.vars`**, on every machine and every deployment
   environment holding one. **Fails silently:** the key reads as `local`, `forge sync` stops pushing
   it, and `--rotate` reports no rotatable keys.
2. **Rename any `test-support.ts` importing across a namespace boundary to `*.fixture.ts`** —
   `validate-namespace-graph` goes red.
3. **Rewrite any authored-document sentence that narrates a change** — `validate-docs` goes red.
4. **Drop the `readmeExportsStep(…)` row and its import from `config/steps.ts`** — `tsc` raises
   TS2305, and the gate cannot start.
5. **Replace every `'unsafe-*'` CSP source string with the imported `UNSAFE_*` symbol** — throws at
   startup, naming the directive and the symbol to import.
6. **Stop threading a request-derived nonce into `applySecurityHeaders`** — an empty nonce throws at
   the call.
7. **`redirect` → `createRedirectResponse`** — `tsc`.
8. **Nothing to do** for the `kvLogChannel` key layout, the `browserStep` hint or
   `validate-packaging`, unless a test asserts on the key shape or the hint text.

### Breaking Changes

- **`validate-readme-exports` is retired, and `readmeExportsStep` is removed from
  `@y-core/forge/warden/steps`.** Its only job was holding a README's `### Exports` tables against
  the barrels they documented, and those tables are gone: a table beside a barrel is a second copy
  of the export surface with nothing but a check keeping the two in step. Also removed:
  `checkReadmeExports`, `ReadmeExportsCheckConfig` and `discoverReadmes` from
  `@y-core/forge/warden/checks`, and `ANCHOR_RE`, `parseExportsHeadingLine`,
  `parseExportsTableSymbols`, `parseImportPathAnchors` and `parseTypesProse` from
  `@y-core/forge/tooling/gate`.

  **A consumer wiring `readmeExportsStep` drops the row from its `config/steps.ts`.** Nothing
  replaces it, because nothing was lost: `validate-exports` already proves every `@public` symbol
  reaches its barrel in both directions, which is the property the tables were transcribing by
  hand. Pre-1.0, so no shim is owed.

- **Every unsafe CSP source is refused as a string and admitted only as an imported symbol.** The
  four — `'unsafe-inline'`, `'unsafe-eval'`, `'unsafe-hashes'`, `'wasm-unsafe-eval'` — throw when
  named as a string in any of the eight directive options, case-insensitively, from both
  `createSecurityHeaders` and `applySecurityHeaders`. Previously only `'unsafe-inline'` was refused,
  and `'unsafe-eval'` was accepted.

  **The opt-out is a `unique symbol` per source**, new from `@y-core/forge/security`:
  `UNSAFE_INLINE`, `UNSAFE_EVAL`, `UNSAFE_HASHES` and `WASM_UNSAFE_EVAL`, plus the
  `UnsafeCspSource` union type. Place one where the string would have gone —
  `scriptSrc: ["'self'", NONCE, WASM_UNSAFE_EVAL]` emits
  `script-src 'self' 'nonce-…' 'wasm-unsafe-eval'`. The validator skips non-strings, which is the
  seam `NONCE` already rode.

  **Why the asymmetry:** forge cannot see the application, so denying a capability outright makes
  forge the decision-maker for a policy it does not own. What it can own is that a weakening be
  deliberate — a snippet pasted from a blog post, an env var or a JSON config is string-shaped and
  therefore inert, while the symbol needs an import statement in the diff and `rg 'UNSAFE_'` finds
  every one fleet-wide. This is deliberately not a `DevAllowance` grant: `'wasm-unsafe-eval'` is
  legitimate in production, and the dev token is for relaxations that must never reach it.

  **Migration:** an app naming one of the four as a string gets a startup `Error` that names the
  directive and the symbol to import. The refusal message changed shape for `'unsafe-inline'` too,
  so a test asserting on its exact text needs updating.

  **`UNSAFE_INLINE` is also refused beside a nonce or a hash source in the same directive**, which
  CSP Level 3 has the browser ignore it next to — an opt-out that cannot take effect, previously
  documented as a caveat and now a startup `Error`. Write the directive without the nonce instead:
  `scriptSrc: ["'self'", UNSAFE_INLINE]`. The check runs on resolved sources, so a merge that
  backfills the nonce-bearing `scriptSrc` default throws as well.

  **`mergeSecurityHeaders` is unaffected** and stays a non-throwing data transform that carries a
  symbol through like any other source. Validation runs where it already ran, at the constructor.

- **`applySecurityHeaders` validates the nonce it is handed.** `options.nonce` is spliced into
  `'nonce-…'` in the emitted CSP, and every other source in that header is checked hard — the nonce
  was not. A caller threading a request-influenced value (`request.headers.get("x-render-nonce")`)
  therefore shipped an injection: `abc' 'unsafe-inline` emitted
  `script-src 'self' 'nonce-abc' 'unsafe-inline''`, switching off the mitigation the header exists
  for. A nonce outside the base64/base64url alphabet — `/^[A-Za-z0-9+/_-]+={0,2}$/`, so no quote, no
  whitespace, no `;` or `,` — now throws at the call. `getNonce(c)` and the minted default satisfy it
  unchanged; a caller passing a placeholder such as `"n"` in a test is unaffected, and one passing
  `""` now throws.

- **`redirect` is gone from `@y-core/forge/http`.** It was a second exported name for
  `createRedirectResponse` — one function, two public names, which is the shim pattern pre-1.0 forbids.
  Rename the import and the call; the signature and behaviour are identical.

- **`kvLogChannel` keys drop the `||v2||` segment.** A record is written at
  `${prefix}||${inverted}||${rand}`. Records under the old four-segment layout sit outside the list
  prefix, so `read` and `readEntry` do not answer them — there is no read path to migrate, and every
  record carries `expirationTtl` (7 days by default), so KV reclaims them. A consumer asserting on the
  key shape, or listing the namespace by hand, updates the prefix.

- **`browserStep`'s `chromium` hint names the install command and nothing else** — ``run `bunx
  playwright install chromium` ``. A repository whose containers supply a browser states its own line
  through `options.hint`, which is unchanged. A test asserting the previous two-route string updates.

- **`namespaceGraphStep` no longer counts `test-support.ts` as test source.** Test source is the four
  spec suffixes plus `*.fixture.ts` / `*.fixture.tsx`. A consumer with a `test-support.ts` that imports
  across a namespace boundary now raises an undeclared edge: rename the file `*.fixture.ts`, which is
  the convention forge's own tree follows (`docs/FORGE_STRUCTURE.md` §9).

- **`docsStep` reports historical phrasing in every document a repository authors, against a wider
  list.** It ran on numbered governing documents only, against six phrases; it now runs on every walked
  document — namespace `README.md` files and agent docs included — against a longer list. A cited tree
  is excluded, because a finding there names a line only its home repository can change. **Visible
  break: a consumer's `validate-docs` goes red** on any sentence narrating a change. Two classes are
  deliberately absent from the list and stay safe to write: a live third-party vocabulary (`legacy`,
  `deprecated`, and `superseded` on its own — the two-word `superseded by` is on the list, so a
  red-lined sentence loses the `by` and not the noun), and the pre-1.0 no-shim policy's own words
  (`backward-compatible`, `migration path`).

- **The `.dev.vars` markers are spelled `# forge:`, not `# foundry:`.** `GENERATE_MARKER` is
  `# forge:generate` and `PUSH_MARKER` is `# forge:push`. **This fails quiet, which is what makes it
  worth acting on before upgrading:** an unrecognised comment is just a comment, so a key under the old
  marker parses as `kind: "local"` — `forge sync` stops pushing it to the deployed surface, and
  `--rotate` reports finding no rotatable keys rather than erroring. Nothing throws and no diff shows
  it.

  **Migration:** in every `.dev.vars` in every consuming app,
  `sed -i 's/^# foundry:/# forge:/' .dev.vars`, then confirm with `forge sync` that each secret is
  still listed under the kind it should have. The file is gitignored, so each machine and each
  deployment environment holding one needs the edit.

  The same rename runs through the surrounding surface, none of which a consumer keys on: the
  `[forge]` warning prefix, the `.forge-<pid>.tmp` suffix on the `.dev.vars` and wrangler-config temp
  files, and the config writer's bug message.

### Added

- **`validate-packaging` — the tarball carries no module only a test reaches.** `packagingStep`,
  `checkPackaging`, `fixtureName`, `moduleImports` and `PackagingCheckConfig` are new from
  `@y-core/forge/tooling/gate`. The check walks the source tree, resolves every relative specifier —
  `import(…)` included — from each `exports` entry and each `bin` script, and fails any packed module
  nothing consumable reaches. Its remedy is the file's `*.fixture.ts` spelling, never a `files` entry,
  so a `files` array names classes and stops growing.

- **A `*.fixture.ts` needs no co-located test.** `coLocationStep` excuses the suffix on the terms it
  already excuses `types.ts` and `bin.ts` on, so a fixture no longer needs an `exempt` entry with a
  reason.

### Changed

- **Forge's `files` array excludes by class, not by path.** The tarball drops every `*.fixture.ts` /
  `*.fixture.tsx` and the whole of `src/tooling/dev/`, and carries no per-file exclusion. Thirteen
  test-only modules were renamed to the convention; none was reachable through the `exports` map, so
  no published surface changes.

### Fixed

- **`rateLimit` says why it refused.** A key resolver that throws still fails closed with a 503, and
  the bare `catch` swallowed the message the module writes to explain the misconfiguration. It is now
  logged at `warn` before the refusal.

---

## [0.1.16] — 2026-09-16

### Breaking Changes

- **`checkExposure` judges every deployment the worker config describes, not just the top level.**
  Each `env.*` block is now its own deployment, reported under an `env.<name>.` prefix, and owes its
  own `workers_dev`, `preview_urls` and routing key. wrangler's inheritance is deliberately not
  modelled: which keys a named environment inherits is a property of the tool and its version, not of
  the file the check reads, so a block states its three controls or is unstated.

  **Visible break: a consuming app's gate goes red.** An `env.dev` block that states bindings only, so
  `validate-exposure` produces three findings until that block states the three keys.

- **Stating both `routes` and `route` now fails**, at any values, because wrangler accepts exactly
  one. A config carrying both passed before.

- **`warden probe` resolves its golden set from the repository's step table, and raises where it
  cannot.** It read a hardcoded `config/golden.ts` and, on any failure to load it, fell back to the
  shipped `libs`-shaped set *in silence*. A repository that had renamed its set therefore had a bare
  `warden probe --dependency` report 34 bogus golden failures and a negative margin — which reads as
  a corpus regression rather than as a missing file. The default is now the `warden:queries` row of
  `config/steps.ts`, and a table that will not load, exports no step table, or declares no golden row
  is an error naming the fix. With `--golden`, the named module must export `GOLDEN`.

- **`probe()` no longer defaults its `golden` and `negative` options** to the shipped sets. A caller
  supplying neither now measures neither. The CLI always supplies them.

- **`MiddlewareGuardGroup.middleware` is renamed to `guards`.** Rename the key in every guard group
  passed to `applyMiddlewareChain`. **Nothing fails at build or boot** — the field is optional and the
  object stays structurally compatible, so a group still spelling `middleware` type-checks, mounts, and
  silently applies no guards at all on the paths it names. That is the whole danger of this rename: the
  only symptom is defence quietly missing from a route group. Grep for `middleware:` inside `guards:`
  before upgrading.

- **The three passkey ceremony defaults now demand user verification.** A ceremony that only *prefers*
  UV can produce a presence-only assertion the browser happily returns and the verifier then refuses;
  the old defaults let exactly that mismatch ship, so the two ends are now set to agree by default
  (`src/auth/passkey/options.ts` carries the note). Three signatures change:

  | Surface | Option | Was | Is |
  | --- | --- | --- | --- |
  | `verifyPasskeyAuthentication`, `verifyPasskeyRegistration` | `requireUserVerification` | `false` | `true` |
  | `createPasskeyRegistrationOptions` | `userVerification` | `"preferred"` | `"required"` |
  | `createPasskeyRequestOptions` | `userVerification` | `"preferred"` | `"required"` |

  **An app with presence-only credentials already enrolled stops authenticating them.** Pass
  `requireUserVerification: false` on the verify options and `userVerification: "preferred"` on the
  ceremony options to keep the old behaviour, or re-enrol those credentials under the new default.
  Change both ends or neither — matching them is the point.

- **`"unsupported-algorithm"` is a new member of `PasskeyAuthenticationReason`.** An exhaustive
  `switch` over the union goes red; add the arm. It is what an assertion signed with an algorithm
  outside the allowlist now answers with.

### Added

- **`require: "unroutable"` on `ExposureCheckConfig`**, surfaced as `exposure` on
  `CloudflareWorkerStepOptions`. It demands the *value* that keeps the Worker off the public internet
  — `workers_dev: false`, `preview_urls: false`, `routes: []` and no singular `route` — rather than
  mere statedness, for a consumer whose only access control is unreachability. The default stays
  `"stated"`, where any explicit value passes.
- **`ExposurePosture`**, exported from `@y-core/forge/tooling/gate`.
- **`cloudflareWorkerSteps` gains `testSets`, `jsx`, `ssrBoundary` and `contrast`.** `testSets`
  replaces the single `test` row with one labelled row per question a suite answers — unit, seam,
  end-to-end; the other three add their opt-in check rows. `testStep` takes a `label` override, which
  is what lets a suite hold more than one test row: a label is the `--only` token and the name
  reported on failure, and `selectSteps` refuses a duplicate.
- **`buildGuardChain`, exported from `@y-core/forge/app`.** It expands one `MiddlewareGuardGroup` into
  the ordered chain `app.use` takes — origin protection, then rate limit, then the group's own
  `guards` — and is the only supported way to mount a group. `origin` and `rateLimit` are policy data
  that nothing enforces until a chain is built from them, so mounting `guards` alone drops both.
- **`MiddlewareChainOptions.before` and `.globals`**, the two slots a consumer's own global middleware
  goes in: `before` registers ahead of everything including `requestId`, `globals` after the session
  and before the guard groups. Which one a given middleware belongs in is settled by
  [`ROUTING_AND_MIDDLEWARE.md`](docs/ROUTING_AND_MIDDLEWARE.md) §3e.
- **`PasskeyAuthenticationVerifyOptions.algorithms`**, the COSE algorithms an assertion may be signed
  with, defaulting to `AUTH_SUPPORTED_ALGORITHMS`. It is judged off the decoded public key rather than
  the stored `algorithm` column, because the key bytes are what actually verifies the signature — a
  column disagreeing with its own blob is refused along with them.
- **New `@y-core/forge/warden` exports**: `probeSetsOf` — the `warden probe` command's own set
  resolver — with `goldenSetsOf`, `stepsOf`, `GOLDEN_STEP_LABEL` and the `GoldenStep` type for reading
  the golden row back off a repository's step table, plus `libraryDocsDir` and `libraryPrefix`. The
  `CitableDir` type is added to `@y-core/forge/warden/checks`. Both subpaths are published, so all of
  this is public surface.
- **`wardenAppSteps` and `WardenAppStepOptions`, on `@y-core/forge/warden/steps`** — the four gate rows
  every consuming application appends, which `cloudflareWorkerSteps` cannot emit because it lives
  under `src/` and nothing there may import warden. `wardenQueriesStep` now returns the `GoldenStep`
  that carries those sets, widening its declared type from `CheckStep`.
- **`egressProxy`, exported from `@y-core/forge/tooling/gate`** — the proxy settings a headless
  Chromium needs where the environment routes egress through one. Chromium reads no `NO_PROXY`, so the
  bypass list it returns is what keeps the dev server's own loopback origin off the proxy.

### Fixed

- **`Dialog`**: `open` and `openModal` together rendered both, and `showModal()` on an already-open
  dialog throws `InvalidStateError` — a console exception and no dialog. `openModal` now suppresses
  the `open` attribute, and the client runtime checks the live `open` property before opening, so
  hand-written markup cannot throw either.
- **`fakeD1.batch`**: a batch carrying a `requireRowsWritten()` guard now rolls back when the write
  before it reported no row, matching the error a real D1 raises. Such a batch previously passed
  under the fake in exactly the case the guard exists to fail. Supply
  `fakeD1(responder, { rowsWritten })` for a guarded batch that should commit.

### Changed

- **`Timeline.Item`**: the marker circle now carries `data-slot="timeline-marker"`, and the column that
  wraps it and the rule is renamed to `data-slot="timeline-marker-column"`. A selector on
  `timeline-marker` now reaches the circle rather than the column — mirroring `Steps`' `steps-marker`.
- **The singular `route` key settles the routing control**, so a config stating only `route` passes
  where it previously reported `routes` unstated.
- **`checkExposure`'s summary line** gains an ` across N deployments` suffix above one deployment, and
  a new `deployment exposure: unreadable` arm for a worker config whose top level is not a JSON
  object.
- **An admin editing their own account can no longer demote or deactivate themselves.** Either now
  answers with the `"self"` outcome instead of writing, rather than locking the acting admin out of
  the console mid-request. The last-admin guard does not cover this: a deployment with a second admin
  admitted both.

---

## [0.1.15] — 2026-09-16

### Breaking Changes

- **A dev-only allowance is a token now, not a boolean on a production option, and every consumer
  gate gains a row that enforces it.** Four option signatures change, with no shim (pre-1.0,
  [`FORGE_STRUCTURE.md`](docs/FORGE_STRUCTURE.md) §7):

  | Surface | Was | Is |
  | --- | --- | --- |
  | `rateLimit(options)` | `required?: boolean` | `dev?: DevAllowance` — an absent binding is `503` with no opt-out short of a token |
  | `crossOriginProtection` / `checkCrossOriginProtection` | `allowMissingHeader?: boolean` | `dev?: DevAllowance` granting `missingFetchMetadata` |
  | `createApp` and `createErrorPage` | `isDebug?: (c) => boolean` | `dev?: DevAllowance` granting `errorDetail`; `Forge.setIsDebug` is now `setErrorDetail(boolean)` |
  | `verifyTurnstile` | *(new in this window)* | `dev?: DevAllowance` granting `turnstileTestingSecrets`, as the second lock beside the published testing secrets |
  | `deriveAllowedOrigins` | `extraOrigins?: string[]` | the origins ride on the allowance, as `dev?: DevAllowance` |

  **The new subpath is `@y-core/forge/dev`** ([`src/dev/README.md`](src/dev/README.md)). `devAllowance(options)`
  mints a `DevAllowance`, a branded token carrying a `unique symbol` the module does not export — so
  no object literal written elsewhere satisfies the type, and minting one means importing the
  subpath. The *type* is exempt from the boundary below, because it is erased at emit: a production
  option may name `DevAllowance` and still be unable to construct one.

  **`validate-dev-boundary` is the row, and it ships default-on in `cloudflareWorkerSteps()`** at the
  `standard` tier. Three rules: the Worker config's `main` is not a `*.dev.ts` entry; nothing outside
  the test set imports one; and only such an entry imports a dev-only module at value. The forbidden
  specifiers are read from the *installed dependency's* manifest — forge declares
  `"forge": { "devOnly": [...] }` in `package.json` — so the check carries no forge knowledge and a
  consumer needs no configuration. An app whose `src/` imports `@y-core/forge/testing`, whose fakes
  lose every write in a deployed Worker, goes red on upgrade; so does one whose `main` names a
  development entry.

  **What this closes.** `rateLimit({ required: false })` sat on a production option and in a shared
  middleware module reachable from the production entry, so a missing `RATE_LIMITER` binding in
  production disabled rate limiting in silence. The same shape held for the other three. The rule was
  prose in [`SECURITY_HARDENING.md`](docs/SECURITY_HARDENING.md) §2c and canon `WORKERS_PLATFORM.md`
  §4e — that a production bundle "structurally contains none of them" — and no tool read it.

  **What it does not close, stated rather than solved.** `wrangler deploy src/worker.dev.ts` bypasses
  `main` and therefore the first rule; no gate row can see a command nobody ran, and the mitigation
  stays canon §4c's pre-deploy gate. A `{} as DevAllowance` cast defeats the type layer; it is
  greppable, and the boundary still fails the import the cast exists to avoid.

- **Four of forge's `docs/` documents are renamed**, each having shared a filename with a canon
  document — which makes `TESTING.md §2a` name two different rules to the same reader
  (`AGENT_GUIDE.md` §6e). `docs/TESTING.md` → `docs/TEST_RUNNERS.md`, `docs/ERROR_HANDLING.md` →
  `docs/FORGE_ERRORS.md`, `docs/CODE_REVIEW.md` → `docs/FORGE_REVIEW.md`,
  `docs/LIBRARY_ARCHITECTURE.md` → `docs/FORGE_STRUCTURE.md`. `TEST_RUNNERS.md` and `FORGE_ERRORS.md`
  are `audience: consumer`, so a consuming repository's citations of them move too.

- **`cloudflareWorkerSteps()` now emits a `lint:types` row** at the `standard` tier, immediately
  after `format`. An app that installs this version gains a gate step it was not running and needs
  `oxlint-tsgolint` as a devDependency before its gate is green. Any app hand-appending
  `typeAwareLintStep` must drop its local row — `selectSteps` refuses a duplicate label.

- **The `c-review` and `c-unreview` slash commands are gone, and `warden sync` no longer writes
  `.claude/commands`.** A repository's own slash commands are now left alone by a sync, where a sync
  that wrote an empty tree deleted them. The review path is the new `warden-review` skill, which
  fires on the words a user actually types where a command had to be invoked by name.

- **`SyncTree.from` is now `readonly string[]`**, layered in order into one staging directory before
  the single atomic swap. Two sources can therefore land in one destination — which is what
  `.claude/agents` (shared + kind) and `.claude/skills` need.

- **`TOOLS` is now `knowledgeTools(knowledge)`** on `@y-core/forge/warden` — a constant array became a
  function taking the index. A tool list that cannot see the corpus can only describe it in the
  abstract, and `knowledge_search`'s description now ends in a `Covers:` line naming the documents
  actually indexed and the per-corpus counts, built from the `source` table at call time. So the
  description an agent reads answers "is the rule I want even in here?" before it spends a call
  asking. Every caller passes the `Knowledge` it already holds: `TOOLS` → `knowledgeTools(knowledge)`.

- **`canon/{libs,apps}/CODE_RULES.md` are consolidated into `canon/shared/CODE_RULES.md`**, 77% of
  the two files having been byte-identical. Chunk ids are tree-stripped, so `canon:CODE_RULES.md#5c`
  is unchanged and no citation moved; a reference-style link naming the path does.
  `NAMESPACE_DESIGN.md` §4a now defers to `CODE_RULES.md` §1d for the three factory verbs and keeps
  only the value-constructor exception.

- **`PLAIN_LANGUAGE.md` §11 and §12 have moved to `AGENT_WORKFLOW.md` §1a and §4a** — neither was
  about prose. `PLAIN_LANGUAGE.md` drops ~60 lines and governs prose quality alone. The numbering
  gaps at §11/§12 stand; closing them is a separate change.

- **`full.sql` is gone, and `BACKUP_FORMAT_VERSION` goes 6 → 7.** Route `full` now loads `schema.sql`
  and then `data.sql`, which together are byte-for-byte what `full.sql` was. Every existing artifact
  is refused by `forge db restore`, `forge db reset --backup` and `forge db migrate --rehearse`,
  naming `formatVersion` — **retake your backups**. The artifact also halves, because the rows were
  being written twice.
  **The hand path changes too:** `wrangler d1 execute --file full.sql` no longer exists, and the
  equivalent is that command twice, `schema.sql` first. There is no converter and no shim, pre-1.0.
  [`docs/DATABASE_BACKUPS.md`](docs/DATABASE_BACKUPS.md) §1, §6.

- **`executeFileInParts` and `sqlParts` are removed** from `src/tooling/db/wrangler.ts`, along with
  their `EXECUTE_BUDGET`. Nothing loads a `.sql` file as parts any more; `executeFile` carries the
  measured reason in its TSDoc. Both were `@internal` and absent from the barrel.

- **`checkFullArtifact` is replaced by `checkSchemaArtifact`**, which refuses an `INSERT` anywhere in
  `schema.sql` and a schema declaring no table at all — the two faults a dump checker applied to a
  schema file would have passed.

- **`describeTable` keeps its signature and `describeTables` is the one to reach for**, and the
  `test-support` helpers it was shaped for are replaced: `describeTableReply` → `tableInfoAsked` /
  `tableSqlAsked` / `tableSqlReply`, `keyProbeAsks` / `keyProbeReply` → `keyProbeAsked` /
  `keyProbeReply` (now per statement), plus `routedReply` for a fake that answers a `--command` one
  statement at a time. A fake dispatching on the whole payload breaks as soon as a read is batched.

### Added

- **`AGENT_GUIDE.md` §6e — no two governing documents share a filename.** Per-index uniqueness
  rather than global; `canon/libs/X.md` and `canon/apps/X.md` exempt, since a repository takes one
  kind or the other; the specialising side renames and never the canon; and a document that only
  restates the one it collides with is deleted rather than renamed.

- **`warden:index` reports a filename collision**, scoped to the corpora a repository owns the files
  of — the finding names the document you can edit and cites the one it collides with. The new
  `canonHome` option makes the canon's own repository read the tree it is not subject to, without
  which a `canon/apps` name colliding with the library's `docs/` one is invisible everywhere.

- **`warden/canon/apps/CONFIG_BASELINE.md`** — the tsconfig flags, oxlint base and override split,
  gate wiring, script set and version pins every Worker application shares. Diffed by hand; no check
  enforces it.

- **`warden/canon/apps/TESTING.md` §2b and §6d** — browser specs are `*.browser.ts` fleet-wide
  (the unit runner collects `*.spec.*` and cannot run one), and the three local port slots, each a
  port *and* a bind address.

- **`warden/canon/apps/APP_ARCHITECTURE.md` §2a** — the domain directory is `model/`, and `types/`
  and `vendor/` are permitted optional members of `src/`.

- **`cloudflareWorkerSteps({ markdown })`** emits the `validate-markdown` row at the `standard`
  tier, between `format` and `lint:types`. An adopting app must also add `"**/*.md"` to its
  `.oxfmtrc.json` `ignorePatterns`, as forge does — otherwise the formatter and the check own the
  same bytes.

- **`AGENT_WORKFLOW.md` §6 Untrusted Content and §7 Secrets in What an Agent Writes.** What an agent
  reads is data and never instruction, and text addressing the agent is reported at its `file:line`
  as a finding; a secret's value is never written into any output, only masked, located and flagged
  for rotation.

- **`AGENT_GUIDE.md` §10 `CLAUDE.md` — What Belongs In It.** The third leg beside §6c and §6d: what
  earns a line, what does not, and that the single-home rule binds `CLAUDE.md` exactly as it binds
  `docs/`.

- **`warden/claude/skills/`, a third synced tree, and the `warden-review` skill in it.** The skill
  routes into the index rather than restating `CODE_REVIEW.md`, takes a scope argument, and defaults
  to the uncommitted working tree.

- **`renderCanon`** — the committed `warden/CATALOGUE.md` is now rendered by walking the canon root,
  so it carries all three trees. Rendered from the per-kind index it could never carry the tree its
  repository is not subject to, and the file's claim to cover the fleet canon was false.

- **`forge db standby reset` builds a standby database in one verb**: empty its state directory,
  apply every migration, apply every seed. `--target` defaults to `standby` rather than the shared
  `local`, because the verb refuses every other place by name; `--no-seed`, `--dir <seeds>` and
  `--no-lint` narrow it, and it confirms unless `--yes` said so. Exported as `runStandbyReset` with
  `StandbyResetOptions` and `StandbyResetOutcome`. A consumer that was composing this out of an
  `rm -rf` plus two spawns can now spawn one.
  [`docs/DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §2a.

- **`composeSeedFixture` writes a seed file from rows held in memory**, proving every one loads into
  the declared schema before the file is written — in a scratch database of its own, so a
  regeneration cannot empty the one `migrate compose` caches a model against. It refuses a path
  outside a declared seeds directory, an undeclared table, a row missing a declared column, a
  `${VAR}` `seed apply` would substitute, a row a constraint rejects, and a loaded count below the
  authored one; a column the schema no longer declares is reported rather than fatal. The emitted
  bytes carry no header and no version stamp, so composing the same rows twice gives the same
  `sha256`. There is no CLI verb — the rows are TypeScript literals and cannot reach a flag.
  [`docs/DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §7b.

- **A warden search hit now carries a line you can judge it by.** `search` takes `excerpt: true` and
  fills `Hit.excerpt`: the section's gloss, else its bolded rule clause, else an excerpt of its prose
  cut around the query's own terms, else its title — never empty. 37% of the searchable corpus has no
  gloss, so until now those hits came back as an id and a heading trail and cost a second call to
  judge. `chunk.rules` is the highest-weighted column in the index and was never shown to anyone.
  Opt-in: the gate and the probe read only ids, and `body` is the largest column in the table. Both
  reader-facing surfaces — `warden search` and `knowledge_search` — now render through one
  `renderHit`, which also drops the `~slug.` prefix from a heading trail and keeps every title.
  Exported from `@y-core/forge/warden/knowledge` as `renderHit`, `excerptOf`, `headingTrail`,
  `HitFormat` and `Excerptable`. **Ranking is untouched** — the excerpt is fetched from the ordinary
  `chunk` table after the slice, so `bm25()` is never re-evaluated and no indexed column changed.

- **The floor's safety margin is guarded rather than printed.** `FLOOR` and the new `MARGIN` are
  exported from the same file, and `warden:queries` warns below 0.05 of room in `standard` and fails
  there in `full`, naming the query behind each figure. The margin had halved — 0.392/0.308 when the
  floor was calibrated, 0.387/0.338 now — with nothing asserting anything about it. The gate also
  measured `thinnest` off results the floor had already filtered, so it could never report a value
  below 0.35: the one region the guard exists to watch. Both it and `warden probe` now measure it
  uncapped, as `loudest` always was.

- **Ten `reference` golden queries measure the namespace READMEs**, 478 of 1,291 searchable chunks
  and previously expected by no query at all. `Dimension` gains `reference` — "what does this export
  do?", Sillito's *building on a focus point* — and the rollup's dimension list is now exhaustive by
  construction, where forgetting to list a new dimension silently dropped it. `warden probe` gains a
  `## rules` block, which is what the render-time screen on `rules` was set from.

- **`cloudflareWorkerSteps()` emits a `validate-exposure` row** whenever `workerConfig` is named —
  the assets half of the coupling is not needed, since only the wrangler config is read. `checkExposure`
  fails on any of `workers_dev`, `preview_urls` or `routes` being **unstated**, each finding naming what
  the default does and both ways to state the intent. A stated value is never judged: `workers_dev: true`
  passes, because public routability is a legitimate choice and an unstated key is the thing that carries
  no intent. `exposureStep`, `checkExposure` and `ExposureCheckConfig` are on the `tooling/gate` barrel.
  Every consumer picks this up on a bump, with no local `scripts/` directory.

- **`@y-core/forge/testing/node`** — a types-only subpath declaring exactly the node surface
  `testing/workerd` reaches: the six `node:*` modules it imports, plus `Buffer` and the `process`
  members it calls. A suite that reaches `startDevServer` writes
  `/// <reference types="@y-core/forge/testing/node" />` at the top of the file and then needs no
  `exclude` and no `node` entry in its `types` array; a type reference directive is resolved per file,
  so the Worker half of the same program still sees nothing of node. This is the supported way to put
  `tests/workerd/**` in a `"types": []` type program ([`docs/TEST_RUNNERS.md`](docs/TEST_RUNNERS.md) §7f).

- **`font-face` is a reserved class-group root**, synthesised from the `font` row's own exceptions
  group the way `text-size` already is from `text`'s. Tailwind compiles nine weight utilities against
  three families, so root `font` is modally *weight* and a consumer's `--font-display` token yielded
  `font-display`, which `cn("font-display", "font-semibold")` silently dropped. Declared as
  `--font-face-display` it merges against `font-sans` and coexists with `font-semibold`. The generated
  table gains exactly one row; no other row moved. The convention is published in the `forge.css`
  header and `src/ui/README.md`, and `validate-css-tokens` already flags the non-conforming spelling in
  any app that names `design.cssDir` ([`docs/UI_CLASS_COMPOSITION.md`](docs/UI_CLASS_COMPOSITION.md) §2f).

---

### Changed

- **Gate execution order is tier-stable.** `selectSteps` sorts by tier after filtering, so within a
  tier the declared order holds and across tiers the cheaper tier runs first. Where a table declares
  a `full` row is no longer where it runs: an appended `standard` row runs ahead of it, and a
  consumer never declines a preset opt-in to get sensible full-run ordering. The sort is stable, so
  every intra-tier constraint a table states survives it.

- **The fleet's linter pins move to `oxlint` 1.82.0 and `oxfmt` 0.67.0**, `oxlint-tsgolint` staying
  at 7.0.2001 (`>=7.0.2001` is oxlint's optional peer range). forge's pin is the fleet's pin.

- **`DATABASE_MANAGEMENT.md` is back under the 600-line target**, at 563. The cuts were restatement,
  per `AGENT_GUIDE.md` §6a's prefer-cutting rule: the local undo's command block and the host
  config's `db.ts` example and field table now live only in `src/tooling/db/README.md`, which
  already carried fuller versions of both, and the `package.json` scripts block moved there too as
  consumer usage (`AGENT_GUIDE.md` §6c). **`§9 Backup Artifacts` is gone** — a signpost nothing
  cited, folded into the document's `Defers to:` line — and **`§10` is renumbered `§9`**; nothing
  outside the CHANGELOG referenced either. `DbHostConfig` is now a `SOURCE_OF_TRUTH.md` §2a row, so
  the fields and their defaults have a named owner rather than a prose copy.

- **`CODE_REVIEW.md` §1b is the six-field finding shape** — impact, where, what, exploit scenario,
  preconditions, fix — with a paired counter-example, and a finding whose exploit scenario cannot be
  written is downgraded. **§5 states the posture ahead of its checks**: the verification pass tries to
  disprove the finding, and the default is reject.

- **Every agent declares a `tools` allowlist**, ends its `description` with what it is not for, and
  states its return contract as a literal skeleton. `AGENT_WORKFLOW.md` §4 now says the split **is**
  declared rather than merely permitted. `cc-tester` moves to `claude/agents/shared/`, the two tree
  copies having been byte-identical.

- **A verified `forge db backup` of 1,407 rows goes from ~180s to 63s, and `forge db restore --route
  full` from ~116s to 20s** — both measured end to end, with `0 divergent` on either route unchanged.
  About 118 `wrangler` spawns down to 45, and 82 down to 15; a spawn was measured at 1.3–1.4s on the
  machine this was cut on, so the whole change is the spawn count. Route `full`'s load drops from ~65
  parts to 2 files, `discoverAppTables` from 7 spawns to 3, and five further read sites that issued a
  spawn per table now issue one batched spawn. `--route migrations` restores in 23s.
  [`docs/DATABASE_BACKUPS.md`](docs/DATABASE_BACKUPS.md) §5a.

- **`queryBatches` takes an optional `budget` and packs statements under it**, spawning as many times
  as it takes and concatenating the result sets in order. The cap is the kernel's `MAX_ARG_STRLEN` on
  one argv string — measured at 131,072 bytes — which fails at spawn with `E2BIG` naming no SQL; the
  budget is half of it. A statement over the budget rides alone.

- **`describeTables` reports faults in two phases** — every structural fault in table order, then
  every key-value fault in table order. The probe statements cannot be written until every describe
  result is in hand, so a later table's composite key now beats an earlier table's NULL key. Within
  each phase the first faulty table still wins.

---

### Fixed

- **Turnstile's published testing secret keys no longer refuse every local submission.**
  `verifyTurnstile` compared `data.hostname` against `options.expectedHostname` unconditionally, and
  under Cloudflare's three dummy secrets — `1x…AA`, `2x…AA`, `3x…AA` — siteverify answers a fixed
  hostname whatever origin the widget ran on. An app pinning its own hostname therefore failed every
  submission in development, and by the §4b refusal shape the failure was byte-identical to a
  validation refusal, visible only in the `warn` log.

  `TurnstileVerifyOptions` gains **`dev?: DevAllowance`**, which — granted `turnstileTestingSecrets` —
  skips the hostname comparison **only when `secretKey` is one of those three published literals**. It
  takes both locks: the token against a real secret does nothing, and a testing secret without the
  token is compared as before. Every other check, including the fail-closed guard on an empty
  `expectedHostname`, is unchanged, and `expectedHostname` stays required.

  **There is no env var, and now no way to write one**: minting the token means importing
  `@y-core/forge/dev`, which `validate-dev-boundary` permits from a `*.dev.ts` entry alone — the
  containment shape of `extraOrigins` and the live-reload CSP hash
  ([`docs/SECURITY_HARDENING.md`](docs/SECURITY_HARDENING.md) §3f), made checkable
  ([`docs/INPUT_VALIDATION.md`](docs/INPUT_VALIDATION.md) §4a).

- **`checkExports` accepts a types-only `.d.ts` export target.** It matched `/\.tsx?$/`, took a
  declaration file for a barrel, and failed trying to import a module that has no runtime. Existence
  and publication are now the whole of such a target's contract.

- **An `icons` block that emits no raster no longer requires `sharp`.** `buildIcons` hoisted its
  `await import("sharp")` above the computation that works out whether any `png` or `ico` output was
  asked for, so a config emitting only `svg` and `manifest` hard-required the optional peer — which
  made the README's claim that consumers without icons never need the package false. The import now
  sits behind the size gate, as `buildRasters`'s empty-list return already did.

  A missing optional peer also fails with a sentence rather than a bare `ERR_MODULE_NOT_FOUND`. One
  internal loader per peer names the config key that demanded it, the package and the install command,
  and raises a `CliError` — which `execute` renders as a single `Error:` line where a plain `Error`
  surfaced as an unformatted crash. `buildJS` reports a missing `esbuild` the same way.

  `sharp` stays an **optional** peer and no consumer's install changes. Its peer range moves from
  `latest` — not a semver range, so nothing could warn on a drifting pin — to `>=0.33.0`, the release
  that landed the `@img/sharp-*` prebuilds and the ESM default export forge calls, matching the house
  `>=` style of the other three peers.

- **An application's root `README.md` no longer enters the project corpus.** `localSources` now takes
  the repository's `kind` and admits the front page only where it is `libs`, so a consuming app's
  index loses one document and `knowledge://catalogue` loses the blank first line of its local
  section — `` - `README.md` — README.md:`` — which described the map's own first entry to nobody. A
  library is unaffected: forge keeps its root README and all 19 namespace ones.

  The branch taken was exclusion, not required frontmatter. The canon asks frontmatter and a
  `## 0. Quick Reference` of a governing document (`AGENT_GUIDE.md` §4, §7), and an app's root README
  is a human-facing entry point that is neither; requiring them would turn every consumer's front page
  into governed prose. A library's READMEs are different in kind — `SOURCE_OF_TRUTH.md` §2f records
  five of forge's own owning their namespace's rulings outright — which is why indexing those stays
  deliberate. A `src/**/README.md` and `warden/README.md` are still indexed in either kind; no consumer
  has one, and a namespace README in an app would be governing prose on the same terms.

## [0.1.14] — 2026-09-14

### Fixed

- **The gate no longer needs `sharp` installed.** Six cases across `rasters.test.ts` and
  `pipeline.test.ts` rasterized for real, so they passed wherever the optional peer happened to be
  present and failed on an x64 CI runner, where the dynamic import threw before any assertion ran.
  They now stub `sharp`, as `icons.test.ts` already did.

  The assertions got stricter rather than weaker. `buildRasters` derives no dimension itself — it
  omits the unset key and lets sharp infer the ratio — so asserting the emitted PNG's pixel
  dimensions tested sharp's arithmetic, and could not distinguish omitting `height` from passing
  `height: undefined`, which are different instructions. The tests now assert the resize forge
  actually requests, and that an empty raster list never loads sharp at all, which is what keeps the
  peer optional. `sharp` stays an optional peer; nothing about a consumer's install changes.

- **`actions/checkout` moved to `v7`**, clearing the Node 20 deprecation warning on the release
  workflow.

---

## [0.1.13] — 2026-09-14

### Added

- **The packed tarball a consumer installs is now published on every `v*` tag.**
  `.github/workflows/release.yml` re-runs the gate, packs the tag with `bun pm pack`, and attaches
  the result to a GitHub Release. `forge release` is unchanged — it still commits and tags without
  pushing, so the tag arriving at the remote is what publishes. A consumer moves from a `codeload`
  URL to the released asset, which matters because `codeload` serves a git snapshot honouring no
  manifest: it ships `tests/`, `config/` and `tsconfig.json` along with everything else, while the
  asset is `bun pm pack` output and `files` in `package.json` alone decides its contents.
  [`src/tooling/release/README.md`](src/tooling/release/README.md).

- **`src/tooling/dev/sync.ts` overwrites a consumer's installed forge with a local checkout.** Run
  from the consumer, it packs the sibling checkout exactly as publishing would and extracts it over
  `node_modules/@y-core/forge`, so working on forge and an application together no longer needs the
  consumer pinned to a `file:` dependency. The result deliberately disagrees with the consumer's
  lockfile, which is why it is never wired to `postinstall`: a plain `bun i` restores the pinned tag.

### Fixed

- **The gate no longer fails on a fresh clone.** `.claude/commands` was gitignored while
  `.gitattributes` recorded that those trees stay committed, so `warden sync --check` found
  `c-review.md` and `c-unreview.md` missing from any checkout other than one whose working tree
  already held them. The ignore rule is removed and the files are tracked, matching
  `.claude/agents/`. Nothing but a clean checkout could surface this, which is why it survived until
  a release workflow ran the gate on one.

---

## [0.1.12] — 2026-09-14

### Breaking Changes

- **Forge owns the migration history outright.** No verb runs `wrangler d1 migrations apply`, and
  wrangler's `d1_migrations` table is never read or written. A migration's body and the row recording
  it are staged into one file under `.forge/scratch/` and loaded with `wrangler d1 execute --file`,
  so locally the two commit together or not at all. The two companion tables are renamed with a
  leading underscore and `_forge_migrations` absorbs what `forge_schema_meta` held:

  ```sql
  CREATE TABLE _forge_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,          -- unique index; the identity
    sha256 TEXT NOT NULL,        -- over stamp-blanked bytes
    applied_at INTEGER NOT NULL, -- epoch milliseconds
    fingerprint TEXT             -- the schema this migration left behind, NULL until an apply certifies it
  ) STRICT;
  ```

  `forge_seed_history` is `_forge_seed_history`, unchanged in shape, and `forge_schema_meta` is
  deleted with its `migrations_digest` and `schema_fingerprint` keys — the fingerprint now rides on
  the migration that produced it, which is what makes "this schema came from this history" one read
  rather than two. The managed-name prefix is `_forge_` rather than `forge_`, so a table an app
  happens to have called `forge_anything` is now the **app's**, and so is a `d1_migrations` table
  left behind by a wrangler-managed past: both are backed up, diffed and fingerprinted as the app's
  own. **There is no upgrade path** — a database written by 0.1.11 reads as having zero applied
  migrations here; re-create a local one, and a deployed database in that state is out of scope.
  [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §4, §4a.
- **`migrations_dir` and `migrations_table` are no longer read from `wrangler.jsonc`.** The
  migrations directory is `DbHostConfig.migrations`, defaulting to `migrations` under the root, and
  the snapshot defaults to `schema.snapshot.json` under the root rather than beside the migrations
  directory. Nothing reads a migrations table name any more, because forge names its own.
  `D1Entry.migrationsDir` and `D1Entry.migrationsTable` are removed, with
  `DEFAULT_MIGRATIONS_DIR`, `DEFAULT_MIGRATIONS_TABLE`, `SynthesizeOptions.migrationsDir` and
  `migrationsHome`.
- **`checkSchemaHealth(db)` and `schemaHealthCheck(binding)` take no options.** The
  `SchemaHealthOptions` type is removed, and `SchemaHealthMonitorOptions` no longer extends it — with
  no wrangler table to exclude from the fingerprint there is nothing left to configure. The states
  are unchanged; `unavailable` now means no `_forge_migrations` table.
- **The repair path is gone.** An apply no longer records migrations that were applied without a
  forge checksum, because nothing can apply one behind forge's back any more. `MigrateOutcome.repaired`,
  `RepairPlan`, `planRepair`, `repairSql`, `recordChecksumSql`, `recordMetaSql`, `recordAppliedSql`
  and `appliedMigrationName` are removed. `ChecksumComparison` goes with them: `compareChecksums`
  returns the mismatched names, since `unrecorded` and `orphaned` described a disagreement between two
  tables that is now one table. `forge db migrate status` drops the `unrecorded` row state and the
  `digest` block of `StatusReport`, and reports a database that has applied migrations but never
  certified a fingerprint.
- **`BACKUP_FORMAT_VERSION` is `6`, and an artifact written by 0.1.11 is refused.** A `data.sql` now
  carries the `_forge_migrations` rows with their original ids, `applied_at` and `fingerprint`, and
  the migrations restore route replays the artifact's own migrations without recording them — the
  history is restored, not rebuilt. `full.sql` no longer carries a separate migrations-table section.
  Take the backups you rely on again. [`DATABASE_BACKUPS.md`](docs/DATABASE_BACKUPS.md).
- **`forge db seed` refuses a schema that moved since the last apply certified it**, as `migrate`
  already did, and takes the same `--allow-drift` past it. A seed writes rows into whatever schema is
  there, so this is checked before the lint, the confirmation and the first load — a refusal leaves
  nothing written rather than stopping halfway through the set. `--allow-drift` certifies nothing, so
  `forge db migrate` goes on refusing until an apply explains the schema.
- **`forge db migrate status --check` exits `1` on a database with applied migrations and no
  certified fingerprint.** It printed a line saying so and exited `0`, which meant CI — which reads
  the code and nothing else — saw nothing to do, while the line asked for an apply. That is where a
  database lands after a restore over the migrations route, and after an apply whose certifying write
  failed on its own; one `forge db migrate` clears it. **A green pipeline can turn red on an unchanged
  database**: run `forge db migrate` against it once.
  [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §6c.
- **`manifest.json` carries `drift`**, one of `match`, `mismatch`, `unrecorded` or `unavailable` —
  the state the source database was in when the backup was taken. `BACKUP_FORMAT_VERSION` stays `6`,
  which is unreleased, so a manifest written by an earlier build of it is refused for the missing
  field rather than misread. `forge db backup` also says so on stderr and carries a warning a restore
  prints back, because every digest in the manifest describes the database **as found**: the proof
  compares a restored copy against the source's own digest, so a drifted source proves clean.

### Added

- **One drift read, shared by every verb that opens the target.** `schemaDrift` compares the newest
  certified fingerprint against the schema as it stands, `readDrift` reads both sides for a verb
  holding neither, and `refuseSchemaDrift` is the one refusal, each verb passing the remedy it
  offers. `migrate` refuses, `seed` refuses, `backup` records — the answer is one rule and what
  differs is what each verb does with it, which follows from what the verb does to the database.
  `SchemaDrift` is exported from `@y-core/forge/tooling/db`.
  [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §6e.

  `forge db schema check` is deliberately not on that list: it reads files and opens no database,
  which is what lets it run in a checkout, in a library repository with no database, and in a
  pre-merge job. Pair it with `forge db migrate status --check` for the answer that needs one.
  `restore` and `reset` are absent too — a restore rebuilds the schema from the artifact and compares
  what it built, and a reset discards the database under a guard stronger than a fingerprint.

- **A dropped object names the file that declared it.** An object becomes undeclared two ways: you
  delete it from a `schema.sql`, or the file itself leaves `config/db.ts` — a library dropped from
  `schemas`, a path renamed, a file moved. The second edits no schema file, so the plan used to
  propose dropping tables nobody touched with nothing saying why. `schema.snapshot.json` now records
  `declared: Record<path, name[]>` beside `desired`, and compose prints one line per departed file
  with the plan, on the success path, under `--dry-run` and in the destructive refusal:

  ```
  posts, posts_user were declared by node_modules/@acme/blog/schema.sql, which config/db.ts no longer declares or whose file is absent — nothing declares them now
  ```

  Those lines are also hashed into the `--allow-destructive` digest, so an approval covers the drops
  **and** the reason for them: the same drop set arriving from a departed file needs its own approval.
  `destructivePlanDigest(diff, causes)` takes them, `droppedObjectNames(diff)` is the drop set they
  are matched against, `declaredNamesBySource` and `attributeDrops` are in `ownership.ts`, and
  `ComposeOutcome` gains `causes: readonly string[]`. A file in the snapshot that `config/db.ts` does
  not name and that owns none of this compose's drops is said once, as a `warning:` line, on the
  compose that forgets it. The names are read for attribution alone — the diff and the SQL are what
  they would be without them. `SCHEMA_SNAPSHOT_VERSION` is `6`.
  [`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §3, §6.

### Fixed

- **A migration or seed whose last statement omits its `;` no longer fails with a syntax error
  naming neither cause.** The body is terminated before the history row is appended to it, rather
  than the record being glued onto an unterminated statement. No lint rule demands the semicolon, and
  the SQL is legal without it.
- **A part-applied batch no longer reports a healthy schema.** `checkSchemaHealth` and the drift
  refusal in `forge db migrate` read the newest fingerprint that was actually certified, skipping the
  rows an interrupted batch left uncertified. Reading the newest row outright returned `NULL` there,
  which reported `unrecorded` — and passed `schemaHealthCheck` — while an earlier certified
  fingerprint no longer matched the live schema.
- Four compose fixture cases asserting an "unowned object" warning the tool does not emit are
  removed; their setup was refused by the `custom-ddl` lint rule, which took the whole
  `tests/workerd/db-compose.test.ts` suite down with it.

---

## [0.1.11] — 2026-09-13

### Breaking Changes

- **`forge db` is three groups of verbs with one shape: `migrate`, `seed` and `schema`.** Each group
  carries its verbs, and the bare group runs the first of them.
  - `forge db migrate apply`, `migrate compose` and `migrate status` replace `forge db migrate`,
    `forge db migrations compose` and `forge db status`; the `migrations` group is gone.
  - `forge db schema check` replaces the `--check` flag (`--replay` stays a flag on it), and the
    document the bare `forge db schema` printed is gone — nothing consumed it, and so is
    `schema snapshot`, since no library keeps a snapshot any more.
  - The bare verb is an alias, not a shim: `forge db migrate` is `migrate apply`, `forge db seed` is
    `seed apply`, `forge db schema` is `schema check`, each taking the same flags.

  Two CI lines change: `forge db status --check` → `forge db migrate status --check`, and
  `forge db schema --check` → `forge db schema check`. `dbSchemaStep` emits the new spelling, so a
  consumer on the shipped gate step needs no edit.
- **Nothing is discovered, and namespaces are gone with the discovery.** `forge db` no longer reads
  a `forge.db` block out of any `package.json` — not a dependency's and not the root's. **Every
  position is declared in the host config**, by path:

  ```ts
  export default {
    schemas: ["node_modules/@acme/auth/schema.sql", "config/schema.sql"],
    seeds: ["config/seeds"],
  } satisfies DbHostConfig;
  ```

  An installed package contributes no DDL to your database because it happens to ship some; it
  contributes because the app asked for it, in a file a reviewer can see. `schemas` is ordered, so a
  file with a FOREIGN KEY comes after the file declaring its target — what used to fall out of rank
  sorting is now stated. With nothing discovered, nothing needs a second name to be discovered *as*:
  `DbHostConfig.namespaces`, `schema` and `seedsDir` become `schemas`, `seeds` and `snapshot`;
  `Namespace`, `NamespaceSource`, `AppNamespaceSource`, `MergedSchema`, `MergeRequest`,
  `NamespaceMigrations`, `resolveNamespaces`, `readDbManifest`, `refuseNamespace`,
  `NAMESPACE_PATTERN`, `APP_NAMESPACE`, `defaultSchemaPath`, `appSchemaPath`, `mergeMigrations`,
  `mergedMigrations`, `runNamespaces`, `resolveSeedsDir` and `schemaSnapshotPath` are removed;
  `DeclaredPath`, `declaredPath`, `declaredSchemas`, `declaredSeeds`, `snapshotPath`, `NO_SCHEMAS`
  and `readMigrations` replace them. A path names itself, and it is the name every refusal, the
  snapshot and `status` use. **No `--namespace` flag survives anywhere**: `forge db schema` and
  `forge db migrate compose` take no selector, `forge db lint` and `forge db seed reset` take
  `--dir`, and `seed --only` takes `<dir>:<name>`.
- **The companion tables carry only what they are the record of.** `forge_migrations` is now
  `(applied_name TEXT PRIMARY KEY, sha256 TEXT NOT NULL)` with no index of its own. Its `namespace`
  column held the literal `"app"` on every row, `name` held the same value as `applied_name` on every
  row, and `applied_at` was written and never read — `status` reads the applied time off
  `d1_migrations`, which is also what makes the pair meaningful: wrangler's table records that a name
  was applied and when, and forge's records the bytes. All three columns were namespace machinery,
  and the unique index over `(namespace, name)` keyed a space `applied_name` already covers.
  `forge_seed_history.namespace` is renamed `source` — it holds the declared seeds directory, which
  is what its only reader already calls it and what `seed reset --dir` filters on. The
  `desired_digest:%` sweep an older forge needed is deleted; pre-1.0 ships no shims.

  Seeds keep a table of their own rather than joining migrations behind a `type` column: migration
  history is forward-only and is the record that makes an edited-after-applied file detectable, while
  seed history is deliberately deleted by `seed reset`. **There is no upgrade path** — a database
  written by an earlier forge carries the old shape, and re-creating it is the answer.
  [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §4a, §4c.
- **`forge db sync` is gone, and a library ships no SQL that runs.** A library publishes a
  `schema.sql` — desired state only. The app composes **one flat migration sequence of its own** from
  every declared schema, against a replay of its own committed migrations, and `migrations_dir` holds
  every file that is ever applied. Nothing is copied into the app and nothing is renamed on the way
  in. `Migration` loses `source: "app" | "lib"`; `LibrarySource`, `SyncPlan`, `conventionSources`,
  `libraryFileName`, `planSync`, `resolveSources`, `runSync`, `createSyncCommands` and
  `SEED_HISTORY_DDL` go with it. [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §8.
- **`config/schema.lock`, `forge db lock`, `forge db adopt` and `forge db eject` are gone**, with
  `--update-lock` on `forge db migrate` and the lock clause of `status --check`. Their whole job was
  giving a *library's migration files* stable identity across machines; with no library files there
  is no allocation to freeze. `SchemaLock`, `LockedNamespace`, `LockedMigration`, `LockedSeed`,
  `lockFilePath`, `readLock`, `writeLock`, `parseLock`, `formatLock`, `compareLocks`,
  `LOCK_VERSION`, `DEFAULT_LOCK_FILE`, `runAdopt`, `runEject`, `createAdoptCommands`,
  `createEjectCommands`, `AdoptOutcome`, `EjectOutcome`, `DbHostConfig.lockFile` and
  `appliedMigrationFileName` are removed. **What replaces the lock is the app's snapshot**:
  `config/schema.snapshot.json` records a desired digest per declared path, so
  `forge db schema --check` fails naming the schema that moved and pointing at
  `forge db migrate compose`. The artifact a reviewer reads on a library upgrade is the composed
  migration — the SQL about to run — not a hash.
  [`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §6.
- **`forge db migrations create` is removed; `forge db migrate compose` replaces it.** There is
  one composer, and it takes no selector: it diffs the whole replay against every declared schema
  loaded together, and an object in the replay that nothing declares is excluded from the diff and
  warned about rather than dropped. A hand-written migration is `compose --custom <name>`, which
  writes the file under a `forge:custom` stamp. `Migration` gains `origin`
  (`generated` | `custom` | `legacy`) and `stamp`; `ComposeOptions` loses `namespace`,
  `OwnershipClaim` keys on `source`, and `assignOwnership` takes the names the last snapshot held as
  a fourth argument. The cross-namespace-rebuild refusal is gone — a rebuild closure reaching from a
  library's table into an app table pointing at it is the ordinary case now, inside one migration the
  app owns.
- **`Migration` loses `namespace`, `appliedName` and `seq`**, which under one directory were three
  names for `name`; `namespaceMigrationsDigest` merges into `migrationsDigest`, `Seed.namespace`
  becomes `Seed.source` (the declaring directory), `StatusRow` loses `namespace`, and
  `DesiredDigestRow.namespace` becomes `source`. `forge_migrations` and `forge_seed_history` keep
  their `namespace` column and their `(namespace, name)` unique index — the column holds `app` and
  the declaring directory — because changing a durable table's shape would cost a companion
  migration for nothing. `forge_migrations` also carries the `applied_name` wrangler recorded. The
  next `forge db migrate` upgrades a pre-namespace table in place, in one batch, deriving each row's
  namespace from its own name; a read path that finds the old shape says to run `migrate`.
- **`custom-ddl` is an error, and the "unowned object" concept is gone with it.** A custom migration
  moves data; every table in the database comes from `schema.sql` and compose. With DDL unable to
  reach the database any other way, an object in the replay that no declared schema declares can only
  be one you deleted from the file — so compose drops it, and there is no third category to warn
  about, refuse rebuilds over, or remember. `Ownership.unowned`, `ManagedSchema`, `managedSchemaModel`
  and `rememberedNames` are removed; `assignOwnership(claims, desired)` keeps only the two refusals
  that were ever about ownership. A migration carrying DDL with no compose stamp now fails the apply.
- **The snapshot is two digests, and an older one is refused until it is recomposed.**
  `SCHEMA_SNAPSHOT_VERSION` is `5` and is its own constant, no longer tied to `SCHEMA_MODEL_VERSION`.
  `SchemaSnapshot` loses `namespace` and `model`: both models a check compares are rebuilt from the
  files and the migrations on disk, so a stored one was a fourth rendering of the schema compared
  against itself. What remains is `desired: Record<path, digest>` keyed as the host config declared
  it, and a non-null `migrationsDigest`. `config/schema.snapshot.json` drops from hundreds of lines
  to eight. `--replay` now compares the replayed migrations against the loaded declarations, which is
  the comparison worth making. `ComposeStamp` carries the same digest map and loses `namespace`. `SchemaCheckEntry[]`
  becomes one `SchemaCheckReport`: the two cases `--check` used to run collapse into one rule — a
  declared schema's digest moved — which covers an edited file of your own and an upgraded library
  alike. Normalization changed with the version: a non-simple identifier is case-folded, a
  double-quoted token inside a column's `DEFAULT` or `CHECK` that names one of the table's own
  columns is an identifier rather than a literal, and every double-quoted token in a view or trigger
  body is kept verbatim. Delete `schema.snapshot.json` and run `forge db migrate compose` once; a
  library that declares a schema and composes nothing keeps no snapshot at all. A checkout holding a
  hand-written DDL migration must compose it from `schema.sql` instead — there is no flag that
  admits one.
  [`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §1.
- **`BACKUP_FORMAT_VERSION` is `5`, and every earlier artifact is refused by name.** Three things
  changed under it, and there is deliberately no converter: an artifact **embeds the migrations it
  was taken with**, so route `migrations` replays `<artifact>/migrations/` and never the checkout and
  an artifact stays restorable from a git checkout years later; the manifest gains `selfDigest` and
  `tables[].rows` now means the number of rows the artifact holds rather than a `COUNT(*)` taken
  after the read; and `manifest.json` is validated field by field on the way in — a migration entry
  whose name is a path, an artifact entry whose file name is not one, a count that is not one — with
  a manifest that is not JSON refused naming the file rather than surfacing the parser's own error.
  The manifest carries no `lock`, because the migrations digest is now the whole story. Take a fresh
  backup before upgrading. New exports `manifestSelfDigest`, `appSchemaDigestInput` and
  `COMPANION_TABLES`; `acquireApplyLock` takes an optional verb label.
  [`DATABASE_BACKUPS.md`](docs/DATABASE_BACKUPS.md).
- **The recorded desired-state digest is gone, and with it `status --check`'s clause on it.**
  `DESIRED_DIGEST_PREFIX`, `desiredDigests`, `DesiredDigestRow`, `StatusReport.desired` and
  `SchemaHealth.desired` are removed, `recordMetaSql` no longer takes `desired`, and the next
  `forge db migrate` deletes every `desired_digest:*` row from `forge_schema_meta`. It recorded the
  stamp of the last composed migration rather than the files, so a comment-only edit to a declared
  schema wedged `status --check` at exit 1 with nothing left to compose. A declared file edited and
  never composed is `forge db schema --check`'s to catch — it reads files, needs no database, and is
  already a gate row. `ComposeStamp.desired` stays: it is provenance in the migration a reviewer
  reads. [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §6c, §10; [`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §6.
- **`forge db schema` is the check, and prints no document.** `Seed` gains `places`.
- **`--allow-destructive` takes the plan digest.** A destructive compose refusal now ends with a
  twelve-character digest of its drop set, and `forge db migrate compose --allow-destructive
  <digest>` approves that set and no other: a drop set that changed since — a schema edit, a
  snapshot change, a library upgrade — is refused again with the current digest. The bare flag is
  refused by the parser. `ComposeOptions.allowDestructive` is the digest or absent, and
  `destructivePlanDigest` is exported. [`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §4.
- **`forge db seed apply --force` is gone.** It meant three overrides at once. `--rerun` runs a
  seed that already ran, including one whose file changed since, and `--only <dir>:<name>` narrows
  it to the one seed; `--allow-pending` seeds a database with a migration pending, onto the older
  schema. Neither implies the other. A seed and its history row now load as one file, so a crash
  cannot leave a seed applied and unrecorded. `runSeedApply` takes `rerun` and `allowPending`, and
  `planSeeds` takes `rerun`. [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §7.
- **The lint rules are renamed, promoted and extended.** `drop-table-no-if-exists` is
  `drop-no-if-exists` and covers `INDEX`, `VIEW` and `TRIGGER`; `virtual-table-fts5` is
  `virtual-table`; `alter-type` is `alter-column-unsupported` and an error; `not-null-no-default`
  is `add-column-not-null-no-default` and an error. The `LintRule` union carries every new name.
  Quoted identifiers are masked before matching, and a `CREATE TRIGGER … BEGIN … END;` is one
  statement. Eleven rules are new: `autoincrement`, `explicit-transaction`, `attach-database`,
  `add-column-non-constant-default`, `add-column-constrained`, `rename`,
  `unique-index-on-existing-table`, `table-rebuild`, `pragma-ignored`, `generated-edited` and
  `custom-ddl`. `splitSqlStatements` and `maskSqlProse` are exported.
  [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §5.
- **`src/auth/schema.sql` is the whole of what forge's auth publishes, and `src/auth/migrations/` is
  gone with the `validate-schema-concat` gate step.** The file is what the schema _is_, and nothing
  is generated beside it — `db:schema` in `full` loads it into a scratch D1 to prove it executes. The
  `forge.db` block in `package.json` is gone with discovery: a consumer names the file in its own
  host config and composes the migration. `schemaConcatStep`, `checkSchemaConcat`, `fixSchemaConcat`
  and `SchemaConcatCheckConfig` are removed from `@y-core/forge/tooling/gate`, and nothing prints
  the old concatenation.
- **`@y-core/forge/tooling/db` publishes one entry point per verb, and nothing beneath it.** The
  barrel keeps `createDbCommands`, `resolveDbContext`, `confirmPrinter`, every `run*`, `prepare*`
  and `execute*` function, `composeMigration`, `checkSchema`, `lintMigration(s)`,
  `lintSeeds`, `readBackupManifest`, `findVerifiedBackup`, the two Time Travel verbs, and the
  option, outcome, plan and host-config types. Everything else — the homes, the I/O port, the SQL
  helpers, the wrangler calls, the schema model and normalizer, the backup reader — is `@internal`
  and reached by file. `@y-core/forge/storage/db` likewise drops `toSchemaMeta`, `toSchemaObjects`,
  `SCHEMA_META_SELECT`, `INVENTORY_SELECT`, `MIGRATIONS_DIGEST_KEY`, `SCHEMA_FINGERPRINT_KEY`,
  `isManagedObject`, `MANAGED_TABLE_PREFIXES` and `schemaFingerprintInput`, which only the CLI read,
  and gains `compareCodePoints`. [`src/tooling/db/README.md`](src/tooling/db/README.md).
- **`config/db.ts` and every `d1_databases` entry are validated at the boundary.** A host config
  with a misspelt key or a `schemas` that is a string, and a wrangler entry whose `migrations_dir`,
  `database_id` or `migrations_table` is not a string, are refused naming the file and the field
  rather than read as if they were what the types said. [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §8.
- **`standbyHome` and `scratchHome` take a migrations directory**, and compose writes the file
  itself, numbering it above every file already in the app's directory.
- **`D1Client.batch` returns `D1BatchResult<T>[]`.** Each statement's outcome carries its rows and
  the write count `execute` would have reported (`rowsWritten`, `lastRowId`), rather than rows
  alone. [`STORAGE_BINDINGS.md`](docs/STORAGE_BINDINGS.md) §1g.
- **`SafeHtml` is a class, not a branded string.** `src/http/html.ts` and `src/http/response.ts` are
  forge's own, and `html` now returns an instance of an exported `SafeHtml` class. Every
  `String.prototype` call a branded string admitted breaks: `.length`, `.includes`, `.slice`, a
  template interpolation's implicit coercion is fine but `typeof value === "string"` is now `false`,
  and `JSON.stringify` serializes `{}` rather than the markup. Read one with `String(value)`, and
  test one with `isSafeHtml`. `html.raw` is gone — `rawHtml(s)` is the only opt-out — and calling
  `html(value)` as a plain function throws a `TypeError` rather than emitting its argument unescaped.
  `createRedirectResponse` (aliased `redirect`) and `htmlResponse` are forge's own with the same
  signatures. The load-bearing detail: `renderToString`
  ([`src/jsx/render-to-string.ts`](src/jsx/render-to-string.ts)) tests `isSafeHtml` **after** its
  `typeof node === "string"` branch, which is only correct because `SafeHtml` stopped being a string.
  [`src/http/README.md`](src/http/README.md).
- **`@remix-run/html-template` and `@remix-run/response` are no longer dependencies.** Both were
  wrapped by `src/http`, which now implements them; an app importing either directly must add it to
  its own `package.json` or move to `@y-core/forge/http`.
- **A primary factor must identify the visitor, and the type enforces it — the discoverable passkey
  sign-in is gone.** A passkey authenticates from nothing: it names no visitor, so it can never be
  the factor that starts a sign-in. `AuthFactorOffer`'s primary variant now takes an
  `AuthIdentifyingFactorService` — a service whose kind is drawn from the new
  `AUTH_IDENTIFYING_FACTORS`, today `["email-otp"]` — so `{ service: passkey, role: "primary" }` is a
  type error, and `createFactorRegistry` refuses it at runtime with `createFactorRegistry: "passkey"
  cannot be a primary factor — a primary factor must identify the visitor, which only "email-otp"
  does`. The rule stops being a capability a service declares about itself: `AuthFactorCapabilities`
  loses `primary` and is `{ stepUp }`.

  **Removed with it:** `AuthPasskeyCeremonyOptions`, `AuthFactorRegistry.ceremony`,
  `createPasskeySigninActions`, `PasskeyFactorRole`, `PasskeyFactorOptions.role`, the
  `POST /auth/passkey/authenticate/begin` and `/finish` routes and their `["auth", "passkey"]` route
  group, and `SigninViewProps.primaryFactor` and `.passkey`. `AuthIdentifyingFactorKind`,
  `AuthIdentifyingFactorService` and the `authIdentifies(kind)` guard are new; `AuthFactorService`,
  `ImplicitFactorService` and `EnrollableFactorService` take an optional kind parameter whose default
  leaves every existing annotation valid.

  **A passkey second factor is untouched.** Enrolment and step-up run through `createPasskeyFactor`
  and the `auth.verify.ceremony` and `auth.enrol.ceremony` endpoints exactly as before — including
  the second half of a sign-in, which now always runs the step-up pair. With no primary role left,
  a passkey ceremony always requires user verification, so `PASSKEY_USER_VERIFICATION`'s `preferred`
  branch is gone; a deployment that had passed `role: "primary"` is strengthened rather than broken.

  **Upgrade:** drop `ceremony` from the passkey's factor offer, drop `role` from
  `createPasskeyFactor`, drop any `auth.passkey` rate-limit key — an unchecked string that would
  otherwise become a silent no-op — and stop passing `primaryFactor` and `passkey` to `SigninView`.
  [`AUTH_FLOWS.md`](docs/AUTH_FLOWS.md) §3b.
- **The transition, for an app on the previous model:** delete `config/schema.lock`, drop `db:lock`,
  `db:adopt` and `db:eject` from `package.json`, write a `config/db.ts` naming every schema file and
  seeds directory by path, then rebuild the database — `forge db reset`,
  `forge db migrate compose`, `forge db migrate` — and commit the composed file. There is no
  shim; pre-1.0 ships none. A **deployed** database is reset-and-restore, or a Time Travel bookmark
  taken before the cut-over.

- **A backup is a snapshot of one instant, and proves the schema it restores.** Pages were read one
  wrangler spawn at a time with nothing excluding a concurrent writer, and `tables[].rows` recorded
  a `COUNT(*)` taken *after* the read — so an artifact torn by a write recorded a count no set of
  rows in it matched, and said nothing. `forge db backup` now holds the apply lock on a local target
  for the whole run (refusing with `Another backup holds …`), records the rows it actually read, and
  refuses the backup naming each table whose post-read count disagrees. The per-route proof also
  compares a digest of the restored schema's app objects and every companion table's rows, where it
  previously compared app rows alone — a restore that rebuilt the wrong schema, or dropped the
  `forge_*` rows `data.sql` carries, passed.
- **`forge db reset` proves the backup still describes the database.** It accepted any verified
  artifact naming the database, so a week-old backup satisfied the guard after a week of writes and
  the reset discarded them. It now compares every app table's row count against the manifest's
  first — refusing immediately, naming the table and both numbers, with no read — and only when
  every count agrees reads the rows and compares each table's digest, which catches an update
  hiding behind an unchanged count. `--backup <dir>` names the artifact to rely on instead of the
  most recent verified one; `--allow-unbacked` still skips all of it.
- **`forge db restore` checks the artifact before it loads it.** `full.sql` / `data.sql` were read
  straight after the manifest, never hashed against `manifest.artifacts[].sha256` and never put back
  through `checkFullArtifact` / `checkDataArtifact` — so a truncated or swapped file was caught only
  after its rows were in the target, where the documented answer is that there is deliberately no
  repair path. Every declared file is now hashed, and the route's own file re-checked, before the
  target is so much as queried. The manifest's `selfDigest` is refused when it no longer hashes: it
  detects truncation, a swapped file and bit rot, and **not** tampering — anyone who edits a
  manifest can recompute it.

- **A seed's `${VAR}` is quoted for the context it lands in.** Expansion was textual everywhere, and
  §7 advertised that it worked "inside a SQL string literal as readily as outside one" — so a value
  holding `'` ended the literal and one holding `';` ran whatever followed. Inside a literal a quote
  is now doubled; outside one, where the value is the SQL itself, only an identifier-like token, a
  number or an empty value is accepted and anything else is refused naming the variable and the
  value. A NUL is refused either way. New export `SEED_BARE_VALUE`.
  [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §7.
- **A text key that collates otherwise than BINARY no longer fails the backup with a message about
  the data.** The keyset read compares by code point, which is BINARY's order alone, so a key
  declared `COLLATE NOCASE` was read in an order the merge did not expect and `forge db backup`
  reported "rows are not ordered by the key" — a tooling limit blamed on the rows. `describeTable`
  now reads the key's collation from the table's own DDL (one batched read, new `tableSqlSelect` and
  `keyCollation`) and orders by `rowid` instead; a `WITHOUT ROWID` table, which has no other column
  to order by, is refused up front naming the column and its collation.
  [`DATABASE_BACKUPS.md`](docs/DATABASE_BACKUPS.md).
- **Compose matches every name the way SQLite resolves one.** `diff.ts` and `emit.ts` keyed their
  maps by exact name while renames compared case-insensitively, so a schema file changing `Email` to
  `email` read as a destructive drop-and-add — and a rebuilt table spelled in another case missed
  its baseline lookup and copied *no* columns into the replacement. Every name now goes through one
  comparison (new `sqlIdentifierKey`), so a case-only change is no change at all.
  [`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §4.
- **Compose refuses a rebuild that would drop an unowned view or trigger, instead of reporting a
  forge bug.** `emit` drops and recreates every view and trigger around a rebuild, but recreates
  only what a declared schema describes, and compose hands it a baseline already filtered to owned
  names — so an object nothing declares survived the drop, SQLite refused the rename into place, and
  the proof reported "this is a forge bug". Compose now names the object and the table it covers and
  stops, with the repair: claim it in a declared `schema.sql`, or drop it first.
  [`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §4.
- **A table with a BLOB primary key can be backed up and restored.** `wrangler d1 execute --json`
  returns a BLOB as a *string* holding the text of a byte array, not as an array, so every
  `auth_*` table — 16-byte UUIDv7 keys — failed its restore proof with
  `cannot store TEXT value in BLOB column`, the value having been written as a TEXT literal. The
  same misread left the keyset cursor holding that string: SQLite ranks BLOB above TEXT, so
  `WHERE "id" > '[90, 10, …]'` matched every row and the cursor never advanced — a table over one
  page (256 rows) read forever. The paged read now projects `typeof(col)` beside each column and
  `hex(col)` in place of a blob's value, so a row arrives typed and a TEXT column holding the
  literal `[1, 2, 3]` can never be mistaken for bytes. New exports `decodeReadRow` and
  `TYPE_ALIAS_PREFIX`.
- **Route `migrations` creates the companion tables before it loads `data.sql`.** The artifact's
  `data.sql` carries the `forge_migrations`, `forge_seed_history` and `forge_schema_meta` rows, and
  `wrangler d1 migrations apply` builds only the app's own tables — so both the restore and the
  proof `forge db backup` runs failed with `no such table: forge_migrations`. It was reached only
  after the BLOB read above stopped failing first.

### Added

- **`forge db migrate compose [name] [--dry-run] [--allow-destructive <digest>] [--rename
  old:new …] [--custom] [--no-cache]`** — the declarative authoring model. Every schema the host
  config declares is one desired state; compose replays the migrations on disk into a throwaway
  local D1 through wrangler, loads the desired files into another, diffs the two models read back
  through `sqlite_master` and the `pragma_*` table functions, and writes the next numbered migration
  only after the emitted SQL has been applied to the replay and proven to produce the desired model.
  Alters in place where SQLite's `ADD COLUMN` / `DROP COLUMN` allow it, and otherwise rebuilds —
  taking every table whose FOREIGN KEY points at the rebuilt one with it, because D1 enforces foreign
  keys, ignores `PRAGMA foreign_keys = OFF`, and would cascade-delete or refuse to commit under the
  textbook rebuild. A drop is refused until `--allow-destructive`; a rename is never inferred.
  [`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §1.
- **`schema.snapshot.json`** — for the app, a desired digest per declared path, the app's own
  migrations digest and the introspected model of the union, written by every compose; for a library,
  its own digest and model — and **`forge db schema --check [--replay]`**, which holds the files, the
  snapshot and the migrations in step by digest (sub-second, no wrangler) or by a real replay.
  `dbSchemaStep()` in `@y-core/forge/tooling/gate` is the pair of gate rows; forge's own gate runs
  them over `tests/fixtures/db-migrate`.
- **Compose warns when a rebuild depends on existing rows.** The proof replays on an empty
  database, so a column that becomes `NOT NULL`, a `CHECK` added to a column or a table, a table
  that becomes `STRICT` or a type change under `STRICT` passed compose and failed mid-migration on
  the real rows. `diffSchemaModels` now reports each such step in `SchemaDiff.dataDependent`, and
  compose prints one `warning:` line per step after the plan — advisory, never aborting — carried in
  `ComposeOutcome.warnings` and in the `--json` document.
  [`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §4.
- **Compose refuses to drop a parent an unowned child still references.** Under foreign-key
  enforcement a `DROP TABLE` cascades into every referencing table, so a child no declared schema
  claims — one a `--custom` migration created — would be emptied or left dangling; compose names it
  and stops. [`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §3.
- **`forge db migrate --rehearse` applies the pending migrations to real rows first.** Every other
  check reads a schema — lint the files, the stamp the history, compose a replay — and a replay
  holds no rows, so a statement that only fails on data passed all of them and failed on the target.
  A rehearsal restores a backup artifact into a throwaway database under `.forge/scratch/rehearse/`,
  applies the pending migrations to it and reports, before the confirmation and before the lock: one
  that fails leaves the target untouched and names the migration it stopped on. `--rehearse` takes
  the most recent verified backup of this database and `--artifact <dir>` names one instead; a
  deployed target is refused, having no local scratch to restore into. New exports
  `rehearseMigrations`, `restoreScratch` and the `RehearsalOutcome` type; `MigrateOptions` gains
  `rehearse` and `artifact`, and `MigrateOutcome` gains `rehearsed`. The `table-rebuild` lint names
  the flag. [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §3, §6e.
- **`forge db backup --target remote|preview` gives a deployed database a verified artifact.** Time
  Travel reaches back thirty days and `wrangler d1 export --remote` is the dumper forge refuses to
  trust; a remote backup now reads the database through the same keyset reader, exports its schema
  with `--remote`, and proves both restore routes into a scratch forced to `local` — nothing in the
  proof reaches the deployed database. It takes no lock and no bookmark, so the torn-read count is
  its only concurrency guard, and it needs no confirmation because it only reads. The manifest names
  the target and carries a warning that `restore` and `reset` are still refused there, which
  `restore` now repeats for every manifest warning on the way in. `exportSql` carries `--remote` or
  `--remote --preview` in place of its refusal, with the place flags after `-c` and `-e`.
  [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §3, [`DATABASE_BACKUPS.md`](docs/DATABASE_BACKUPS.md) §3.
- **`forge db lint --seeds` holds a seed to four of the migration rules, as warnings.**
  `unbounded-update`, `unbounded-delete`, `drop-no-if-exists` and `attach-database` now run over
  every seed at warning level, through the new `lintStatements(file, sql, { rules, level })` export
  that runs a named subset of the migration checks; `SEED_MIGRATION_RULES` names the four. A seed
  that empties a table keeps applying locally with the warning logged, is refused on a deployed
  target until `--allow-warnings`, and fails `lint --seeds --strict`. In passing, `unbounded-update`
  no longer fires on an upsert's `ON CONFLICT … DO UPDATE SET` — the idiom seeds are told to write —
  for migrations either. An apply lints only its pending files, so a library migration applied a
  year ago no longer aborts every apply in every consuming app because a rule was added since.
  [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §5, §7.
- **Seeds scoped to places** with a first line of `-- forge:places local,standby`;
  **`forge db seed status --check`**; and the `seed-insert-not-idempotent` warning, logged by
  `seed apply` and run by `forge db lint --seeds`.
- **`db` on `cloudflareWorkerSteps()`** — an app with a database takes the two
  `forge db schema --check` rows from the preset instead of appending `dbSchemaStep()` itself:
  `db:schema:digests` in `standard`, `db:schema` (a real replay, behind the workerd probe) in
  `full`, ordered before the browser and workerd rows.
  [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §10.
- **`checkSchemaHealth`, `schemaHealthMonitor` and `schemaHealthCheck` in `storage/db`** — a Worker
  reads whether the schema it serves is the one `forge db migrate` recorded, and reports one of
  `match`, `mismatch`, `unrecorded` or `unavailable`. The monitor logs one `d1.schema.health`
  record per isolate at `warn` on a mismatch, handed to `executionCtx.waitUntil` so no request waits
  on it; the predicate fails a `healthCheck` only on `mismatch`. It writes nothing and gates nothing
  — the repair stays `forge db migrate`. The fingerprint rules have one home,
  `src/storage/db/schema.ts`, and `tooling/db` re-exports them, so its surface is unchanged.
  [`STORAGE_BINDINGS.md`](docs/STORAGE_BINDINGS.md) §1f.
- **`requireRowsWritten()`** — a `sql` fragment appended after a write inside `batch`, which aborts
  and rolls back the batch when that write matched no row; the client rewords the overflow it
  raises. [`STORAGE_BINDINGS.md`](docs/STORAGE_BINDINGS.md) §1g.
- **`forge/sql-explicit-transaction`** — an oxlint rule refusing a runtime `sql` fragment whose
  first statement is `BEGIN`, `COMMIT`, `ROLLBACK`, `END`, `SAVEPOINT` or `RELEASE`, since
  `batch()` is the transaction boundary. [`STORAGE_BINDINGS.md`](docs/STORAGE_BINDINGS.md) §1g.
- **`CliErrorKind` gains `"external"`** — a command this tool ran (wrangler, say) failed or answered
  in a shape it cannot read; every user-input refusal in `tooling/db` is now a `CliError`, so each
  prints as one line. [`src/tooling/cli/README.md`](src/tooling/cli/README.md).
- **The printed undo is aimed.** The `forge db bookmark restore …` command a deployed apply or seed
  prints carries `--root`, `--config`, `--db` and `-e`, so it restores the database this run resolved
  from any directory. `--rehearse` binds its artifact to the target by the stripped migration names,
  so an artifact taken from this target is accepted rather than refused as taken elsewhere.
- **`confirmPrinter(run)`** — where a confirmation prints: stderr under `--json`, so stdout stays
  the one JSON document, and stdout otherwise; every confirming verb uses it.
- **`clearLocalState`** in `@y-core/forge/tooling/db`, the one state reset backup verification
  and compose share.

---

### Changed

- **`resolveEnrolPasskey` answers 404 when passkey is not offered**, through `authEnrollable`,
  rather than rendering an enrolment page for a factor the registry does not hold.
- **`DATABASE_BACKUPS.md` holds the backup rulings**, which `DATABASE_MANAGEMENT.md` §9 used to carry
  whole; §9 is now a pointer. Every file forge writes under `.forge/` is created `0600`, and every
  directory `0700`, since a scratch may hold an expanded seed and an artifact holds every row.
- **`SCHEMA_COMPOSITION.md` holds the compose rulings**, which `DATABASE_MANAGEMENT.md` §11 used to
  carry. Nothing about the behaviour changed; the citations did. `§11` is now
  [`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §1, and `§11a`–`§11f` are its §2–§7 in
  order. `DATABASE_MANAGEMENT.md` keeps §1–§10 at the numbers they had — the places and their undo,
  the companion tables, the lint rules, applying, seeds, the host config, backups and the CI gate.

---

### Fixed

- **`forge db schema --check --replay` no longer reports false results.** The check narrowed
  nothing, so an object no declared schema owned read as a difference against the snapshot; it now
  narrows the replay exactly as compose does, and matches names as SQLite resolves them so a
  case-only rename is no difference.
- **A quoted keyword column, a quoted literal in a view, and a `UNIQUE` column drop are read
  right.** `"unique" TEXT` was classed as a constraint and refused; `WHERE role = "admin"` and
  `"Admin"` normalized equal and the view change was never emitted; `DROP COLUMN` of a `UNIQUE`
  column was emitted and refused by SQLite's autoindex — it is now a rebuild, as is adding a
  `NOT NULL DEFAULT NULL` column. [`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §1, §4.
- **A backup no longer fails on a trigger whose body deletes rows, or on two backups in one
  second.** `full.sql` is checked statement by statement, with a `CREATE TRIGGER … END` as one, and
  a second backup whose directory name already exists is refused rather than written over the first.
  A value holding a NUL byte is refused naming the table and the column.
  [`DATABASE_BACKUPS.md`](docs/DATABASE_BACKUPS.md) §1, §5.
- **A REAL that is integral restores as REAL.** `wrangler d1 execute --json` hands a REAL `1.0`
  over as `1`, and the artifact wrote it as `1` — so under a column with no affinity it restored as
  an INTEGER, and the row's canonical form changed with it. The read already projects `typeof`
  beside every value; `decodeReadRow` now wraps a `real` in the new `SqlReal` class, which
  canonicalises as `R:1` (distinct from INTEGER's `I:1`) and is written to the artifact as `1.0`.
  The keyset cursor unwraps it, so a REAL key seeks as a number.
  [`DATABASE_BACKUPS.md`](docs/DATABASE_BACKUPS.md).
- **A seed's `${VAR}` is expanded at apply, and the expanded text does not outlive the load.**
  Seeds were expanded at discovery, so `seed status --check` and `lint --seeds` failed on any
  machine lacking a variable only `seed apply` needs — a CI gate wanted every secret. `Seed.sql` is
  now the file as written; `seed apply` expands every seed in its plan before the first is loaded,
  refusing an unset variable with nothing run, and removes each expanded file from
  `.forge/scratch/seed/` once it has been loaded. `parseSeed` and `discoverSeeds` no longer take an
  `env`. [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §7.
- **`--only` naming a seed the place left out says so**, with the `forge:places` line that would
  include it, rather than "No seed named". [`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §7.
- **The apply lock's release is conditional.** `acquireApplyLock` returned a `release` that removed
  the lock file unconditionally, so a run outliving `APPLY_LOCK_TTL_MS` and taken over as stale
  deleted its *successor's* lock on the way out. Release now re-reads the file and removes it only
  while it still holds the `pid` and `startedAt` this call wrote.
- **Every wrangler forge spawns runs with `FORCE_COLOR=0`.** bun 1.4 colourises a pipe and not only
  a TTY, and `parseJsonOutput` locates a payload by the first line matching `^\s*[[{]` — so a
  colourised `--json` line begins with an escape byte and reads as "printed no JSON".

---

## [0.1.10] — 2026-09-11

### Breaking Changes

- **Removed `createAnonymousSession`'s `secure` option: `Secure` is hardcoded and no longer
  configurable.** The option existed for plain-http development, which
  [`WORKERS_PLATFORM.md`](warden/canon/apps/WORKERS_PLATFORM.md) §4e rules out — development is https
  at every hop, so `Secure` is correct there by construction. An in-process test harness never needed
  it either: `Secure` is enforced by a browser deciding whether to send a cookie back over http, and
  forge's own session suite passes identically with it on. What the option did make reachable was a
  session cookie shipped **without** `Secure` from a mistyped env check —
  `secure: env.ENVIRONMENT !== "production"` — a failure that is silent in every other way: no test
  goes red, nothing is logged, the header is one word shorter, and anyone on the path reads the
  cookie and replays the session. **A consumer passing `secure` deletes the line**; if a local server
  then cannot hold a session, the fix is its dev transport (TLS-terminating proxy, or loopback
  https), not the cookie. `docs/SECURITY_HARDENING.md` §3f now rules on this, where it previously
  deferred.

- **Forge owns its cookie implementation; `@remix-run/cookie` is gone from the dependency tree.**
  **Removed from `@y-core/forge/session`:** `Cookie` (a *value* — a downstream `instanceof Cookie`
  no longer compiles), `CookieOptions`, and `createCookie`. **Added in their place:**
  `createUnsignedCookie` for non-sensitive values, and the `SignedCookie`, `UnsignedCookie`,
  `CookieAttributes` and `UnsignedCookieOptions` types; `SignedCookieOptions` is now written over
  `CookieAttributes` rather than the removed `CookieOptions`. `createSignedCookie` moved from
  `src/session/signed.ts` to `src/session/cookie.ts`, and still hardcodes `httpOnly` and `secure`. **The wire format is unchanged and
  pinned by golden vectors captured from a differential run against the package this replaced**, so
  a cookie already in the wild keeps verifying: `base64(utf8(value))` on the standard alphabet with
  padding retained, `.`, then the padding-stripped base64 HMAC. Two behaviours were deliberately not
  carried over: a custom `encode`/`decode` pair (nothing passed one), and an explicit `undefined` in
  a `serialize` override erasing the construction default (a bug, and unexpressible under
  `exactOptionalPropertyTypes`). A value containing a lone surrogate now throws rather than being
  silently mangled into U+FFFD.

### Added

- **`createUnsignedCookie`, and a `parse` that cannot hand back mojibake.** The decoder is
  `fatal: true`, so a malformed base64 payload or malformed UTF-8 bytes answer `null` instead of
  flowing into `JSON.parse` or the session store as substituted characters. `serialize` takes a
  per-call attribute override merged field by field with `??`, so `maxAge: 0` survives the merge and
  emits `Max-Age=0`. `src/crypto/mod.ts` gained the strict standard-alphabet `base64Encode` /
  `base64DecodeOrNull` the wire format needs — deliberately *not* wrappers over the lenient
  base64url pair, which remaps `-`/`_` and re-pads and would turn a rejection into garbage.

- **`forge db` — a D1 database surface: forward-only migrations, verified backups, idempotent seeds
  and library schema sync.** `forge db migrate` applies every pending migration through wrangler and
  records what it applied: a SHA-256 per file in `forge_migrations`, and the digest of the applied
  set plus a fingerprint of the schema they produced in `forge_schema_meta`. `forge db status`
  compares those three against the files on disk and reports `pending`, `mismatch`, `unrecorded` and
  `drift`; `--check` turns the same measurement into a CI gate. `forge db lint` runs seven rules over
  destructive, unbounded and unbackupable SQL — an error aborts any apply, a warning aborts a
  deployed one unless `--allow-warnings` says otherwise. **Migrations are forward-only and no file
  has a Down**: on a deployed database the undo is a D1 Time Travel bookmark, captured before every
  apply and printed as the command that returns to it (`forge db bookmark info` / `restore`), and
  locally it is `forge db backup`, `forge db reset` and `forge db restore`. A backup artifact is
  proven before it is written — both restore routes are replayed into a throwaway database and
  compared row by row — and forge emits the row data itself rather than taking wrangler's dump,
  because that dumper writes a newline as backslash-`n` and reverses it without escaping the
  backslash. `forge db seed apply` runs name-keyed seeds recorded in `forge_seed_history`, hashed
  over the raw file text with `${VAR:-default}` expansion, refusing a seed whose file changed since
  it ran unless `--force` says so. `forge db sync` copies a library's migrations in as
  `<NNNN>_lib-<name>_<rest>.sql`, never overwriting a conflicting file and never renumbering one.
  Every verb takes `--target place[:database]` over four places — `local`, `standby`, `remote`,
  `preview` — and an optional `config/db.ts` declares `{ sources?, seedsDir?, backupsDir? }`. The
  namespace is **`@y-core/forge/tooling/db`**, whose barrel publishes `createDbCommands` and the
  engine beneath it; the rulings are `DATABASE_MANAGEMENT.md` and the surface is
  `src/tooling/db/README.md`.

- **`confirm` and `ConfirmOptions` in `@y-core/forge/tooling/cli`.** One prompt every destructive
  verb asks through: it prints what is about to happen and why it cannot be taken back, reads
  `Continue? [y/N]`, and throws a `CliError` on anything but `y`. A run with no terminal that did not
  pass `--yes` is **refused rather than assumed**, so a CI job cannot silently take a destructive
  path.

- **The auth schema ships as a migration.** `src/auth/migrations/0001_auth_init.sql` is published in
  the package, so a consumer takes it with `forge db sync` and applies it with `forge db migrate`
  under its own numbering. `src/auth/schema.sql` is that directory concatenated and committed — the
  one-shot `wrangler d1 execute --file` alternative for a database that will never be migrated.

- **`validate-schema-concat`, a new `standard`-tier gate step.** It regenerates `src/auth/schema.sql`
  from `src/auth/migrations/` and fails on any drift, so a table added to a migration and not to the
  concatenation cannot ship. `forge verify --fix` regenerates it; the file is never edited by hand.
- **`sessionMiddleware(storage, cookie, { reissue })` — the declared repair for cookie attribute
  drift.** Tightening `sameSite`, adding `Secure`, or changing `Path`/`maxAge` never reaches a client
  holding a valid unchanged session, and that is undetectable rather than merely undetected: a
  browser echoes `name=value` and never an attribute. `reissue: true` re-issues the cookie on every
  request that carries a parseable, non-empty one, so the new attributes land; it re-arms `Max-Age`
  and makes every such response uncacheable, so it is a deploy-window setting, not a default. A
  request carrying no session cookie still emits nothing. Exported as `SessionCookieOptions`, and
  accepted by `createAnonymousSession` too.
- **`sessionMiddleware(storage, cookie, { rotating })` — set it while the cookie holds more than one
  secret.** It is what moves the suppression check from the payload to the wire bytes, and so what
  completes a rotation; without it the old cookies keep verifying, are never upgraded, and dropping
  the retired secret signs every remaining holder out. It is an option rather than the default
  because HMAC is deterministic: off rotation an unchanged payload cannot re-sign to different bytes,
  so computing the signature to discover that would be pure cost — the steady state stays at the one
  `importKey` + `verify` the incoming `parse` already pays. `createAnonymousSession` derives it from
  the array its `secret` resolver returned, so only a direct `sessionMiddleware` caller passes it.
- **`createAnonymousSession` accepts a rotation array.** Its `secret` resolver may now return
  `[string, ...string[]]` as well as a string — until now it hardcoded `secrets: [secret]`, so an
  anonymous session could not rotate at all. Each element is length-checked individually, and an
  empty `cookieName` is refused rather than emitting an empty `set-cookie:` header.

### Fixed

- **A secret rotation now completes without a flag to remember.** `sessionMiddleware`'s `rotating`
  defaulted to `false` because upstream's `Cookie` kept its `secrets` private, so forge could not ask
  a cookie whether a rotation was in flight: prepend a secret, forget the flag, and the rotation
  silently never completed — dropping the retired secret then signed every holder out.
  `SignedCookie` now reports `rotating` (more than one secret held) and the middleware defaults to
  it. The option survives as an override for an operator keeping a retired secret in the array
  long-term. **The signing key is also cached per secret** — upstream imported one inside every
  `sign` and every `unsign`; forge imports it once per isolate, and a failed import clears its slot
  rather than poisoning it.

- **`sessionMiddleware` no longer re-issues a cookie the client already holds.** 0.1.9's
  dirty-on-`id`-read only exempted a storage whose cookie value *is* the id, so under
  `createCookieSessionStorage` — where the value is `{"i":…,"d":…}` — every request that read
  `session.id` wrote a `Set-Cookie` carrying byte-identical content. The documented CSRF wiring reads
  it on every request, so the cookie slid on every page load. The middleware now compares what it
  would write against the value the request sent and emits nothing when they match, which covers both
  storage shapes. **Sliding expiry is affected:** no `Set-Cookie` means no re-armed `Max-Age`, so a
  session window that must slide needs a real change each request (`session.set(...)`) or the new
  `reissue` option.

  **Under rotation that comparison moves to the wire bytes, which is what makes a secret rotation
  complete.** Suppressing the re-issue also suppressed the upgrade it was silently
  performing: `Cookie.serialize` always signs with `secrets[0]` while `parse` accepts any secret in
  the array, so rotation is designed to happen *by* re-issue — and a payload comparison cannot tell a
  cookie signed with the current secret from one signed with a retired one. A cookie carrying an old
  signature was therefore never upgraded and the old secret could never be dropped; under KV the
  defect predates the suppression guard, since a session that only reads `.id` never reaches `save()`
  at all. While the cookie holds more than one secret the middleware re-signs an unchanged session
  and compares the signed bytes, so a still-old cookie is upgraded on the next request it makes, under either storage, on a
  request that touches nothing. A cookie that fails to parse is never re-signed back into validity,
  either way. `src/session/README.md` documents the rotation as the two deploys it is.

---

## [0.1.9] — 2026-09-11

### Breaking Changes

- **Every forge mountable now renders into one document shell the app registers, and takes no chrome
  options of its own.** `createApp({ shell })` — or `app.setShell(shell)` — names a
  `PageShell`: `(c, content, slot) => JSXNode | Promise<JSXNode>`, resolved per request from the
  request context, exactly as `Config` already is. **Removed:** `ShowcaseOptions.context` and
  `.layout` (and its `Ctx` type parameter); `LogViewerOptions.context` and `.layout` (and its
  `Config`/`Ctx` parameters, plus `loadLogViewer`'s `config` argument — the call is now
  `loadLogViewer(c, options)`); `AuthWebOptions.layout` and `.document`; the `AuthDocument`,
  `AuthLayoutProps` types, `AuthPageOptions.layout`/`.document`, and forge's internal `AuthShell`.
  **A consumer registers its existing layout once** — `createApp({ shell: async (c, content, slot)
  => <Layout ctx={await renderContext(c, config)}>{content}</Layout> })` — and deletes the second
  layout an auth mount previously needed, because the shell holds the app's per-request context in
  its own closure rather than threading a `Ctx` type through forge's option types. For a deployment
  whose whole chrome is a stylesheet, `pageShell({ stylesheet, script, lang })` builds the shell
  instead of a component, which is what `AuthWebOptions.document` bought. `AuthPageOptions` keeps a
  `title` that overrides forge's own copy for one page. **With no shell registered** a mounted page
  renders a bare document — doctype, `<head>`, the slot's title, content in `<body>` — so forgetting
  to register one is an unstyled page rather than a broken one. `renderShell(c, content, slot,
  init?)` is public, so an app's own pages can render through the same shell with a slot they name;
  `slot.mount` is an open string, so a shell that branches on it needs a default arm. A fragment
  never reaches the shell. **The slot carries a typed `PageMeta` rather than a title** — `{ title,
  description?, canonical?, robots?, og?, twitter?, jsonLd?, extra? }` — rendered by `metaTags(meta,
  { nonce })` and merged over a site-wide base by `mergeMeta(base, page)`, so a shell states its
  chrome once and each page states only what differs. A typed shape rather than an array of tag
  descriptors merged by key, because forge has two levels and not a route hierarchy: `og.image` is
  one field, so a second one overrides rather than joining. `extra` is the open escape hatch, in
  React Router's own `{ name, content }` / `{ property, content }` / `{ tagName: "link", rel, href }`
  vocabulary, appended verbatim and never deduplicated. `jsonLd` is a field rather than an `extra`
  entry because the inline script needs the request nonce under `script-src 'self'`; passed none, it
  renders no script. `canonical` and `og.image` must be absolute — forge derives neither, since a
  Worker behind a proxy sees a `c.url` that is not the public one. **Every page forge mounts now
  states `robots: "noindex"`**: an auth page, the log viewer and the showcase each have no business
  in an index, and `renderAuthPage` takes a `meta` override merged over forge's own. The seam and
  the ruling behind it are `ROUTING_AND_MIDDLEWARE.md` §6.

- **The form honeypot is gone from forge: `isHoneypotFilled`, `HONEYPOT_FIELD_DEFAULT`, `Honeypot`,
  the `honeypot` option on `defineAction` and `definePage`, and the `{ guard: "honeypot" }` arm of
  `BotRejection` are all removed.** A hidden-field decoy stops the bots it was designed for and no
  others: a headless browser executes the page, sees an off-screen input with `tabindex="-1"`, and
  leaves it alone, so the guard cost every form a field and bought nothing. Turnstile is the guard
  that does the job, and it stays in full — `turnstile`, `onBotDetected` and `csrfProtection` are
  unchanged. **A consumer moves the same route to `turnstile` on the same option object**, with the
  same `onBotDetected` callback: `BotRejection` keeps its discriminated shape, now the single
  member `{ guard: "turnstile"; reason: TurnstileFailure }`, so a handler that switches on
  `rejection.guard` keeps compiling and a handler that read `reason` only under the turnstile arm
  can now read it unconditionally. Views drop `<Honeypot />`; nothing replaces it in the markup.
  Per `LIBRARY_ARCHITECTURE.md` §7 there is no deprecation shim.

- **Every auth form now accepts a browser submission, which none of them did.** Each auth view
  rendered `<Honeypot />`, putting an empty `__hp_c7` in the body, and `readAuthSubmission` dropped
  only the CSRF field before parsing against a `strictObject` — so the decoy raised a
  `strict_object` issue and the page re-rendered at `422` with the generic refusal. `curl` never
  reproduced it, because a hand-built body carried no decoy. Removing the decoy fixes this by
  construction: there is no extra field left for a strict schema to reject. Sign-in, sign-up,
  verify, email-change and passkey rename all submit exactly the fields their schema declares plus
  `_csrf`, and one new test asserts that set per view, so a field injected into a view can no
  longer go unnoticed.

  **One behaviour change beyond the removal:** the verify-resend action's only body-content guard
  was the decoy check, and its parse-failure arm redirected on a malformed body. Resend now
  redirects without reading the body at all. Rate limiting is what protects that endpoint until
  Turnstile is wired into the auth forms.

- **The auth review of 2026-09-10, in full.** Twenty-one findings, the breaking ones first.

  **The challenge and nonce stores are D1, not KV.** `createChallengeStore` and `createNonceStore`
  take a `D1Client`. KV's read-then-write let two requests take one challenge and two verifications
  each be told a nonce was theirs to spend; each is now one statement — a `DELETE … RETURNING` and an
  `INSERT … ON CONFLICT DO NOTHING`. `schema.sql` gains `auth_challenges` and `auth_nonces`; KV
  expired keys for free and SQLite does not, so every read holds a row against the clock and the new
  **`purgeAuthEphemera(db, at)`** reclaims the dead ones from a scheduled handler. `prefix` still
  namespaces both, now by key text. `AUTH_KV` stays — session storage is still KV.

  **Sessions expire absolutely, at seven days.** `establishAuthSession(session, userId, at)` takes the
  clock and stamps `AUTH_SIGNED_IN_SESSION_KEY`; `resolveAuthIdentity(session, users, at)` takes one
  too and refuses past `AUTH_SESSION_MAX_MS`. A session carrying no stamp — every session issued
  before this release — is over rather than unbounded, so a deployment signs its users out once.
  Removing a passkey, removing the authenticator-app factor and completing an address change now
  raise a revocation barrier (`auth_users.sessions_invalid_before`, `UserStore.revokeSessions`) that
  every other session dies on at its next request; the two factor removals carry the acting session
  over it with the new `renewAuthSession`, and the address change does not.

  **Store contracts.** `UserStore.revokeSessions(id, at)`, `OtpStateStore.discard(userId, token)` and
  `IdentityLinkStore.unlink(id, userId)` are new or newly owner-scoped. `FactorStore.countAttempt` is
  re-keyed from `(id, userId, …)` onto `(userId, kind, …)` and answers the row rather than a boolean,
  which is what merges the `find` and the spend into one statement. `AuthFactor` gains
  `failedAttempts`, `AuthUser` gains `sessionsInvalidBefore`, `AdminUserOutcome` gains `"self"`, and
  `AuthStoreErrorCode` gains `"invalid"` — a CHECK the caller's own value broke, which must not read
  to a client as an outage. `schema.sql` also caps `email` and `email_key` at 254 characters, the
  bound the web schema applies *before* `normalizeEmail` NFKC-expands an address past it.

  **`AUTH_OTP_TTL_MS` is five minutes**, down from ten; the factor's own ceiling is unchanged, so only
  the default moved. **Admin search is prefix-matched** so the unique index on `email_key` answers it —
  a substring in the middle of an address no longer matches. **`authTotpEnrolSchema` caps at eight
  digits**, where the factor's own ceiling is.

  **Refusals that were missing.** `signin.complete` folds `too-many-attempts` and `too-soon` into
  `unrecognised` on the primary path, where the true reason was itself a membership answer — `stepUp`
  keeps it, since there the caller is already identified. A discoverable passkey sign-in now requires
  a `userHandle` when the challenge names no subject, refuses a reported `topOrigin`, and bounds the
  assertion id. The three ceremony JSON endpoints cap the body at 64 KiB and answer 413, and the
  enrolment nickname is held to the same 64-character cap the rename path uses. An administrator can
  no longer deactivate or delete their own account. `importAuthKeyRing` refuses a secret whose bytes
  are all equal or drawn from too small an alphabet — the length floor alone admitted 32 zero bytes.

  **Fixed without a contract change.** The authenticator-app enrol page rotated the secret on every
  render, so a mistyped code offered a *different* secret from the one just stored in the app;
  `beginEnrolment` now re-offers the unconfirmed row's own. A failed mail send left the OTP cooldown
  claimed and the identity holding an undeliverable code. Every auth page carries
  `Cache-Control: no-store`. The sign-out control on the passkey enrol page was a `<Link>` to a
  POST-only route and could not work. The TOTP enrol view hard-coded six digits and thirty seconds
  rather than reading the factor's own. `resolveAuthServices` cached on the env alone, so two
  `AuthOptions` on one env shared one key ring. `resolveServices` is memoised per request, and the
  imported `CryptoKey` is cached rather than re-imported per token operation.

  **One session-namespace change rides along**, because it is the other half of the absolute
  lifetime: `trackSessionId` marked a session dirty the moment anything read `.id`, and the
  documented CSRF wiring reads `.id` on every request — so every request re-wrote an unchanged
  session to KV, and the sliding TTL that produced is what kept a session alive indefinitely. It now
  dirties only when the presented cookie would not already reproduce that id.

### Added

- **Forge's nineteen namespace READMEs now enter a consuming repository's warden index.** Until now
  a consumer was served forge's `docs/` rulings but not the signatures those rulings defer to —
  eleven `docs/` documents carry a `> Defers to:` clause naming `src/<ns>/README.md`, and in a
  consumer every one of those edges resolved to nothing. A question like "which prop sets a button
  variant" now reaches `forge/src/ui/README.md` rather than stopping at the ruling above it. Each
  README is served at its real on-disk path — `forge/src/ui/README.md`, the file under
  `node_modules/@y-core/forge/` — so every path warden prints names something the reader can open
  and `--path forge/src` is a usable scope. Which READMEs are served is declared, not inferred: the
  nineteen published namespaces carry `audience: consumer` in their frontmatter, and
  `src/crypto/README.md` plus the seven `src/tooling/*` READMEs carry `audience: internal` and are
  not served. **`DEPENDENCY_README_WEIGHT`** (0.65) and **`dependencyWeightOf(path)`** are exported
  from `@y-core/forge/warden`; a library README ranks below the consuming repository's own README at
  0.9, and both values were swept against all three consuming repositories' golden sets.
  **`DEPENDENCY_WEIGHT` moves 0.95 → 0.9**, re-calibrated because the corpus it was measured against
  has more than doubled. A README's per-subpath `### Exports` table is indexed but **not searchable**
  in the dependency corpus: it is a bag of every identifier a namespace publishes, so in a consumer
  it competes with every question about any of them at once — it stays readable through
  `knowledge_read` and visible in `knowledge_outline`, and a consumer reaches an export table
  through the package's types. **A citation made from a library document can no longer resolve to
  the consuming repository's own file.** A README cites forge's `docs/` through a relative href, so
  the captured spelling is `docs/ERROR_HANDLING.md` — which matched a consumer's same-named document
  exactly and resolved to it silently, at a `§N` meaning something else. `resolveCitation` now
  restricts a `dependency` citation to the `dependency` and `canon` corpora, and retries once with
  the `docs/` prefix stripped so the library's own copy matches. Finally, a pair involving a
  dependency document is classified before the README class in `warden:duplicates`, so library
  READMEs sort last rather than filling the reporting cap.

- **`resolveAuthView` — an auth page's data and node, for a page you own.** `@y-core/forge/auth/web`
  could serve a whole auth page and nothing smaller: a consumer could replace the markup or wrap it
  in a `layout`, but could not put a sign-in form on a marketing page, could not reach any auth
  markup from a route they own — which forge *requires* for the email-change confirmation
  (`AUTH_FLOWS.md` §5) — and could not put two auth views on one page. Every loader fused resolving
  the props to returning a `Response`. `resolveAuthView(c, options, request)` stops one step short,
  answering `Result<AuthViewResolved<Name>, Response>`: the page's `name`, its resolved `props`, the
  `node` built from them against your `views` override, and the `status` this render carries — or,
  in the failure channel, the exact refusal forge's own route would have given. It is a `Result` and
  not a node because eight of the thirteen pages can answer a redirect, a 404 or a 503 instead of
  props, and a function typed to return a node has nowhere to put a 503. Alongside it ship
  `AUTH_VIEW_GUARDS` — per page name, the guards its data assumes have run — and `AUTH_VIEWS`,
  forge's own markup keyed by name, which deletes the `view` argument from every internal render
  call and makes "this page rendered by another page's view" unsayable. All eleven views now accept
  `AuthViewChrome`: `class`, composed onto the root after the view's own so a host's width wins, and
  `level`, the heading tag read off the view's place in the host document. Both default to exactly
  what forge renders on its own routes. The recipe is `AUTH_MOUNTING.md` §6.

- **`@y-core/forge/testing/workerd` — the `wrangler dev` fixture server, published.** A suite that
  must run code inside the real Workers runtime needed a helper forge kept in its own `tests/`,
  outside the published surface, so every consumer forked it — and a fork misses the fix that kills
  the whole process group, which leaves orphaned `workerd` pairs at PID 1 holding a core each after
  every run. `startDevServer(options)` starts `wrangler dev` over a fixture and resolves once it
  answers, returning `{ origin, siteOrigin, logs, stop }`. `stop()` `SIGKILL`s the **process group**
  — wrangler's workerd and esbuild children included — and removes the temp env file; the same sweep
  is bound to `exit`, `SIGINT`, `SIGTERM` and `SIGHUP`, so an interrupted run cleans up too.
  `DevServerOptions` takes `entry`, `config`, `vars`, `readyPath` and `capture`, all optional.
  `siteOrigin` is `https://127.0.0.1:{port}` and is always injected as `SITE_ORIGIN`, because the
  dev server stamps `https` onto origin-bearing headers before the Worker sees them. **This one
  subpath is node-only and deliberately off the `./testing` barrel** — it reads
  `node:child_process`/`node:fs`/`node:net`, which a Worker-typed test program cannot resolve — and
  `wrangler` is a new **optional peer dependency**, resolved out of the consumer's own tree.
  `TESTING.md` §7f and §1f.

### Added

- **`@y-core/forge/auth` — the identity namespace the charter has named all along.**
  `NAMESPACES.md` §5a, the CLAUDE.md growth table and `BOUNDARIES.md` §2b each route
  authentication, permissions and API-key lifecycle out of `security`; §5h is now the prose rule
  that says where they land. The domain half publishes `resolveAuthServices`
  (per-`env` key-ring resolution with a cached Ed25519 capability probe that **throws** rather than
  advertising an algorithm the runtime cannot verify), `AUTH_SUPPORTED_ALGORITHMS` (`[-7, -257]`,
  a deliberate deviation from SimpleWebAuthn's `[-8, -7, -257]`), `normalizeEmail`, and the one
  `AuthStoreError` class, plus the token codec every emailed credential rides on —
  `encodeAuthToken` / `decodeAuthToken` over AES-256-GCM with a per-purpose HKDF subkey, because an
  email-change confirmation carries the new address in a URL and a signed-but-readable token hands
  that address to browser history, `Referer`, link scanners and proxy logs. `authNonceKey` is
  `HMAC(nonceSubkey, token)` rather than a bare hash, so an observer with read access to the nonce
  store gets no consumed-or-not oracle for a token they merely saw. It also ships the eight store
  contracts — `UserStore` and `AdminUserStore` split so a sign-in service cannot hold the
  capability to delete a user — with SQL adapters for the six durable ones, KV adapters for the two
  ephemeral ones, and `src/auth/schema.sql`, applied with
  `wrangler d1 execute --file` against the installed package rather than imported. On top of the
  stores sit the factor contract and registry — `email-otp` / `passkey` / `totp-app`, closed, with
  TOTP-app step-up-only because an authenticator app proves possession and does not identify — the
  email-OTP factor, the passkey ceremony-options builders, and the client-data and
  authenticator-data verifiers. Over the stores sit the three flows — signup, sign-in with step-up
  and email change, each handing its delivery to the `AuthDeferral` a consumer supplies so the
  response says nothing by its timing — and `createAdminUserService`, whose every refusal is decided
  in the store's own statement rather than in a count-then-write. The namespace produces no
  `Response` and touches no `Session`.

  Four properties are worth naming because they are the ones that go wrong quietly. Email-OTP
  **issues are spaced by a cooldown rather than counted**, because any per-identity ceiling is a
  budget an unauthenticated attacker spends on the victim's behalf — three posts naming an address
  bought a day with no email-OTP — while a cooldown bounds the mail that ceiling existed to bound.
  **A guess is spent by the statement that admits it**, so parallel guesses spend the budget instead
  of each comparing against a count none of them has written yet; that is also why the email code's
  state is a durable table and not KV. An **implicit factor is
  enrolled for everyone the moment it is offered**, so offering email-OTP as a second factor demands
  a step-up whatever its `AuthFactorRequirement` says: there is no unenrolled state for `"optional"`
  to skip over or for `"mandatory"` to owe an enrolment against. A deployment that offers no second
  factor at all resolves `satisfied` rather than refusing at construction. And a ceremony's
  **`origin` is compared as an exact string** while its **`rpIdHash`
  is compared as a hash**, which is what refuses `https://example.com.evil.test` and a credential
  minted for another relying party.
- **`@y-core/forge/auth/web` — the mountable web layer over that domain.** Three route builders —
  `authRoutes`, `accountRoutes` and `adminRoutes` — each omitted by not calling it: sign-in, sign-up
  and verification; the signed-in passkey, authenticator-app and email-change pages; and user
  management with a first-admin bootstrap. `authPaths` derives every href from the route map, so no
  path literal appears in a loader, an action or a view. `AUTH_ROUTE_GROUPS` is the one table both
  `register*` and `createAuthGuards` read — a nested group exists only where its guards or its
  response medium differ from its parent's, which is what turns "these two answer JSON" and "this
  pair is deliberately not admin-gated" into structure rather than a comment. The four guards
  (`requireAuth`, `requireAdmin`, `requireEnrolment`, `requirePendingEnrolment`) treat an owed
  enrolment or step-up as a **page to visit rather than a 4xx**, since needing a second factor is a
  successful outcome of a correct sign-in; a guard that cannot read the factor store answers 503,
  because a redirect on an unknown demand loops. The override story is a hybrid — forge owns the
  response, the consumer owns the markup: `views` replaces one page at a time against the exact
  props forge's own view takes, and every `load*` and `create*Actions` is exported, so `register*`
  is a convenience rather than a gate. The one-way `auth/web → auth` edge is enforced by
  `validateNoMutualValuePairs` in the namespace-graph check, and `auth-federation`'s subpaths will
  inherit it (`NAMESPACES.md` §5h).

  **One derivation of roles, and `AuthSigninFlow.complete` no longer takes a context.** Both
  enrolment guards resolved the factor requirement with no `AuthFactorContext`, so a
  `{mandatoryForRoles}` requirement matched no role and went unenforced — an admin who had never
  enrolled a second factor reached the console, the exact case the requirement exists to prevent. `authFactorContext(subject)` and
  `AUTH_ADMIN_ROLE` are now the single derivation, used by the guards, the verify page and the
  sign-in flow alike. `complete(email, presented, at)` **drops its fourth parameter** — breaking only
  for a consumer implementing `AuthSigninFlow` themselves — because the caller cannot know the
  subject's roles before the call that identifies them, so the flow reads them off the row it loaded.
  `AuthFactorRegistry.resolve(userId, context?)` keeps its context for roles beyond `isAdmin`.

  **`createAuthGuards` takes an `origin` allowlist and stops dropping guard-less groups.** With
  `origin` configured it mounts origin protection on every group carrying a mutating leaf, so
  `POST /auth/signin`, `/auth/signup`, `/auth/verify`, `/auth/verify/resend`, `/auth/signout` and both
  `/auth/passkey/authenticate/*` — identity-less, and previously given nothing by this layer — are
  now checked, while the safe-method exemption keeps their pages reachable. Without an allowlist
  nothing is mounted, since forge cannot pick your origins. Rate limiting and
  `csrfProtection({ subject })` remain the consumer's, stated with the exact paths in the README.

  Passkey account management carries a **token per row, not per page**: a CSRF token is bound to one
  path, so a single page-level token authorised only the row it was minted for and every other
  Remove button was a 403. `PasskeyListView` now takes `PasskeyRow` — a credential and the token
  authorising the writes on it — and `passkeyRename` and `passkeyRemove` share one pathname under
  two methods, so that one token covers both. `PasskeyEditView` gives the rename its own page, which
  `PATCH /passkeys/:id` had no markup to be reached from at all. Three inputs are now bounded at
  their edges: `challengeBytes` **throws** below `AUTH_PASSKEY_CHALLENGE_MIN_BYTES` (16) in both
  ceremony builders rather than minting a 32-bit WebAuthn challenge, a blank passkey label parses to
  `null` instead of writing an empty string into a column the domain models as `string | null`, and
  the nickname the enrolment ceremony posts is finally **stored** — it rides in the passkey factor's
  own opaque payload rather than widening `completeEnrolment` for a field email-OTP and TOTP would
  then carry for nothing.

  Six more inputs are bounded or named at their edges. `createTotpAppFactor` **throws** for a
  `secretBytes` under 16, at construction rather than on the first enrolment that mints the 32-bit
  shared secret; its provisioning URI is percent-encoded rather than form-encoded, so an issuer with
  a space reaches the authenticator as `Forge%20Demo` and not `Forge+Demo`; and re-enrolling over a
  confirmed factor answers the new `already-enrolled` reason rather than `consumed`, which meant
  "code already spent" in every log that carried it. `markAuthStepUp` clamps its mark to no later
  than now and `requireEnrolment` counts a future one for nothing, so an injected or skewed clock
  cannot mint a step-up that satisfies every window until the wall clock catches up. `requireAuth`
  records a return-to only for a `GET` or `HEAD` and answers 303 otherwise, since a mutation's URL
  has no `GET` handler to send the visitor back to. And **a guard now refuses in its group's
  medium**: `AuthGuardOptions` and `AuthEnrolmentGuardOptions` take a `medium`, `createAuthGuards`
  hands each group its own, and an expired session posting to the JSON enrolment ceremony gets
  `401 {"error": …}` instead of an HTML sign-in redirect the browser controller parsed as a ceremony
  response. A ceremony's `ttlSeconds` is bounded too: both builders now **throw** outside
  `AUTH_PASSKEY_TTL_MIN_SECONDS`–`AUTH_PASSKEY_TTL_MAX_SECONDS` (60–600), breaking only for a
  deployment already configuring a lifetime the challenge store would refuse or one that leaves a
  replayable challenge live longer than an emailed code. And `verifyPasskeyAuthentication` answers
  `sign-count-reused` from both places the counter refuses — the pre-check and the conditional write
  losing its race — where the concurrent case previously reported as `unrecognised`, the reason an
  unknown credential gets. `verifyPasskeyRegistration` now holds the browser's own `credential.id`
  against the attested credential id and answers the new `credential-id-mismatch` reason when the two
  disagree, which WebAuthn L3 §7.1 says they never should; `PasskeyRegistrationCredential` carries
  `id` again to make that check possible.
- **`@y-core/forge/auth/client` — the browser half of the passkey ceremony.** A side-effect import
  with no value exports, registering one eager `passkey` scope. It reads the `PASSKEY_*` contract
  off the scope root, checks WebAuthn support **at mount** rather than at the press — an
  unsupported browser gets the fallback line and a disabled trigger — then runs the ceremony against
  the two endpoints with **two path-bound CSRF tokens**, one per endpoint, because `csrfProtection`
  binds a token to one path. The redirect it navigates to is reduced by `safeRedirectPath`
  client-side: an attribute is not a trust boundary a controller may skip.
- **`docs/AUTH_MOUNTING.md` and `docs/AUTH_FLOWS.md`** — mounting the capability: the order the
  middleware goes up in, the route table with each group's guards, and every seam you supply; then
  every flow end to end, and §7's plain list of what this release does not do. `src/auth/README.md` now carries a `> Import path:` anchor per subpath, so
  `validate-readme-exports` holds all three barrels against their tables.
- **`jsonResponse` and `safeRedirectPath` on `@y-core/forge/http`.** `jsonResponse` completes the
  response-builder set §5d already owns, throwing on a caller-supplied `content-type` like its two
  HTML siblings. `safeRedirectPath` reduces an untrusted return-to candidate — a `?next=` value, a
  hidden field — to a same-origin path or a fallback; it takes no origin, so an absolute URL is
  refused even for your own host.
- **Crypto primitives for credential work, all `@internal` behind the sealed `src/crypto/` path.**
  RFC 4648 base32 that refuses a non-alphabet character rather than skipping it; RFC 5869 HKDF
  split into extract and expand, so one root secret yields a pseudorandom key many per-purpose
  subkeys expand from; AES-256-GCM seal/open, where opening a forged or mis-keyed ciphertext
  returns `null`; RFC 4226 HOTP and the RFC 6238 TOTP construction over it, taking the clock
  reading as an argument; and the WebAuthn parsing substrate — a CTAP2-subset CBOR decoder that
  reports where the first item ended, COSE key decoding for ES256/EdDSA/RS256, and DER-to-`r‖s`
  unwrapping.

### Changed

- **An empty `prefix` is refused where a KV store is built.** `createKVStore`
  (`@y-core/forge/storage`) and `createKVSessionStorage` (`@y-core/forge/session`) now throw on
  `prefix: ""`, as do `createChallengeStore` and `createNonceStore`, each naming the factory the
  operator actually called. `""` is not an unprefixed store: it fails the truthiness test the key
  builder makes, so the separator goes with it and every record is written under its bare logical
  key — two stores on one binding then share a keyspace, and `list()` over one enumerates the other.
  Omitting `prefix` still means "no prefix" and is unchanged; `KVListOptions.prefix` is untouched,
  where `""` correctly means "everything".

### Security

- **An auth page no longer reads an identity the guards did not establish.** `resolveAuthViewer`
  read `authCtx` first and fell back to the session when it was unset, so a loader or action mounted
  without `createAuthGuards` resolved a visitor the guards had never judged. Combined with
  `loadAdminUsers`, which calls `services.admin.list` having read no identity at all, an auth view
  reached from an unguarded route served the full user table to an anonymous visitor. Three changes
  close it. The viewer is now read from `authCtx` and nowhere else, so an unguarded mount resolves
  nobody and gets the sign-in redirect. `resolveAuthView` re-checks the two guards that are
  observable at resolve time — `require-auth` against `authCtx`, `require-admin` against the
  `isAdmin` it carries, answering the same 403 `requireAdmin` does — rather than trusting the
  caller. And a guarded page resolved without a `guarded` claim throws, which 500s and leaks
  nothing, rather than rendering.

  **A deployment that mounts `createAuthGuards` is unaffected**: every guarded route sets `authCtx`
  on every request, so the identity, the pages and their rendered bytes are unchanged. A deployment
  running the loaders or actions **without** the guard chain starts refusing — which is the fix, not
  a regression. The two enrolment guards are not observable without a factor-registry round trip per
  render, so for those `guarded` remains a typed claim; `AUTH_MOUNTING.md` §6 states it as a claim
  rather than a formality.

### Fixed

- **Every `/account/passkeys` path answers 404 on a deployment that offers no passkey factor.**
  `passkeyPage` read the credential store — whether this visitor holds a passkey — where the question
  is whether the factor is offered at all, which only the factor registry answers; `totpPage` read
  the registry and was correct. The page was unlinked but reachable, and its `EmptyState` advertised
  an "Add your first passkey" button pointing at a path that 404s. The list, a single row, edit,
  rename and remove now all refuse, exactly as `/account/totp` already did, and the check sits after
  the anonymous redirect and before any store read, so a prober learns nothing about a deployment's
  factor set.

  **404 always, not 404-while-empty.** A deployment that withdraws the passkey factor refuses every
  passkey management path whether the visitor holds credentials or not; the rows a withdrawn factor
  leaves behind are dead and an operator clears them at the store, because forge deletes nobody's
  credentials on a configuration change.

  **One thing a deployment may have to act on:** `AuthWebOptions.settledPath` defaults to the passkey
  list, so a deployment offering no passkey factor and omitting `settledPath` now lands a completed
  sign-in on a 404. Set it — and the enrolment guards' own required `settledPath`, which a mount
  typically points at the same page — to a path the deployment serves; `AUTH_MOUNTING.md` §1 states
  the requirement.

---

## [0.1.8] — 2026-09-08

### Added

- **`@y-core/forge/tooling/gate/chromium` — the spelling a consumer's `playwright.config.ts` can
  actually import.** Playwright loads its config under node, which refuses to strip types from a
  file under `node_modules`, so importing `resolveChromiumPath` from `@y-core/forge/tooling/gate`
  died at config load. The subpath publishes a committed esbuild bundle of the one symbol a config
  needs; `validate-chromium-bundle` re-bundles and fails on any drift, as `validate-lint-plugin`
  already did for the oxlint plugin. Both artifacts are written by `bun run gen:bundles`.

### Changed

- **`browserStep` spawns `playwright test`, not `bunx --bun playwright test`.** The `--bun` was
  there to dodge type stripping; the prebuilt subpath removes the need, and bun was never free — a
  dev server playwright spawns itself binds, under bun, where the browser cannot reach it in a
  sandbox. A consumer whose gate spawns its own server could not run the step at all. `bunx` went
  with it: the runner already prepends `node_modules/.bin` to `PATH`, so the bare name resolves the
  installed binary — whose shebang is node — while `bunx` would fall back to installing from the
  registry when it resolved nothing. Every other command step already resolved this way.
  `bun run test:browser` and forge's own `playwright.config.ts` follow, the config importing the
  committed `.mjs` so forge's gate exercises the exact module a consumer loads.
- **`wardenStep`'s `catalogue` assertion is opt-in.** It defaulted to `warden/CATALOGUE.md` and
  failed `warden:index` in any repository that had no such file. The rendered catalogue is
  canon-scoped and so byte-identical everywhere, which makes it the canon owner's to commit and no
  consumer's; elsewhere the live `knowledge://catalogue` resource is the copy. Forge names the path
  explicitly, so its own gate is unchanged.

- **`checks/lint-plugin.ts` is now `checks/bundle.ts`, generic in its names.** `LintPluginCheckConfig`
  → `BundleCheckConfig`, `bundleLintPlugin` → `bundleSource`, `checkLintPlugin` → `checkBundle`,
  `writeLintPlugin` → `writeBundle`; the config gains a required `fixer` naming the regeneration
  verb each failure reports. `resolveChromiumPath` moves from `checks/browser.ts` to
  `checks/chromium.ts`, which imports nothing but `node:fs` and is therefore bundlable — the public
  symbol is re-exported from the same barrel under the same name. `gen:lint-plugin` becomes
  `gen:bundles`, which writes both artifacts.

### Fixed

- **`warden catalogue --write` no longer writes into `node_modules`.** It resolved the target
  against warden's own installed root, so a consumer following the gate's own remedy silently
  mutated `node_modules/@y-core/forge/warden/CATALOGUE.md`. It now honours `--root`, as documented,
  and refuses outright when the resolved path is inside a dependency.

---

## [0.1.7] — 2026-09-08

### Added

- **A third corpus, `dependency`: the library's own consumer-facing documents, served inside a
  consuming repository.** Forge's `docs/` was reachable only inside forge, so a consuming app asked
  the library nothing and read `node_modules` instead. Fourteen of the twenty-one now enter a
  consumer's index under `dependency:forge/<DOC>.md`, labelled `installed @y-core/forge (advisory)`
  and addressable as `knowledge://dependency/{path}`. **Off by default** — a repository opts in with
  `dependency: true` on its warden gate rows, or `warden <verb> --dependency`.
- **A required `audience: consumer | internal` frontmatter key on forge's `docs/`.** It is what
  decides whether a document is served into a consumer at all, and it is declared rather than
  derived: `knowledge_impact`'s subpath governance was measured as the discriminator and refused —
  four of the consumer-facing documents mint no `governs` edge, `NAMESPACES.md` mints three (one
  from a sentence saying a subpath does *not* exist), because `governs` measures what a document
  talks about and not who should read it. `validateFrontmatter` takes a `requiredFrontmatter` rule
  so a new document fails closed; the default stays exactly `title` and `description`, which is what
  the canon and every consumer's own `docs/` are still held to.
- **`warden probe`.** A read-only command that builds the corpus into a scratch index and prints one
  diffable block: per-corpus counts, every golden query's rank, coverage and verdict, the canon
  documents no query reaches, each negative query's peak pool coverage, the document frequency of
  every negative-set term, the dead alias bridges, and the classified duplicate pairs. The `df` list
  is the load-bearing part — a refused question can only start being answered after one of its terms
  leaves `df 0`, which is the single channel by which enlarging the corpus breaks the floor.
- **`resolveCitation`**, which says whether a cited `DOC.md` named nothing or named several.
  `resolveDoc` answered `undefined` for both and the two are different defects: a typo, against a
  citation that needs a path. The gate now warns on the second in its own words.
- **`docs/` in `package.json`'s `files[]`, with a test asserting all twenty-one are packed.** The
  documents reach a consumer today only because the dependency is a raw codeload tarball that
  ignores `files[]` — the substrate of this feature, and nothing defended it.

### Changed

- **The alias table is scoped by tree.** `SHARED`, `LIBS` and `APPS`, merged by `aliasesFor(kind)`
  and threaded through `coverage()`, `matchExpression()` and `SearchOptions` rather than read at
  module scope. An application consumer was warned about eighteen bridges aimed at a library's
  vocabulary, and could only silence them by committing a trimmed copy of forge's table. Three were
  mis-targeted rather than library-only and were retargeted — `no-PII` to `PII` (the canon spells the
  first only in an unindexed frontmatter line), `script-src` to `csp`, and `origin-guard` to
  `origin`. Forge and its consumers now each report zero dead bridges.
- **The gate is scoped to the corpora a repository owns.** `missingGloss`, `emptyDocuments` and the
  unresolved-citation warning select `canon` and `project` explicitly, independent of how a path is
  spelled: a gate may only fail a repository for a file that repository can edit, and a dependency
  document is named by a path that does not exist in the consumer's tree. `checkWarden` now reports
  per-corpus document counts, which is the only cheap defence against a silently empty corpus.
- **`citationTarget` resolves through the same tiers as everything else.** It used a bare `find`, and
  `discover` puts the canon first, so every filename spelled in two corpora resolved to the canon's
  copy whoever cited it.
- **`--corpus` is validated at all three entry points** — the CLI flag, `knowledge_search`'s
  argument, and `SearchOptions`' type. It reached SQL unvalidated, so `--corpus=cannon` returned
  nothing and the reader was told no rule governed their question.
- **The served catalogue files each corpus under its own heading.** A `corpus === "project" ? … : …`
  put every corpus that was not `project` under the fleet canon's, in the first thing an agent reads.

---

## [0.1.6] — 2026-09-08

### Added

- **An amend-floor preflight in `forge release`.** Before anything is written, the command refuses a
  release whose previous tag is no longer an ancestor of HEAD (`history-rewritten`, no override) —
  published history was rewritten, so the tag names different content than the tarball a consumer
  already holds, with no version change to signal it — and refuses when a reachable remote does not
  carry that tag (`tag-unpushed`), which would otherwise cut a release on a predecessor nobody can
  fetch. An unreachable remote is reported and non-fatal, so a release from a machine with no route
  out still works ([`BUILD_TOOLING.md`](docs/BUILD_TOOLING.md) §2j).
- **A duplication gate step, `warden:duplicates`.** Word-shingle overlap over every searchable chunk
  reports two sections that say the same thing, which the single-home rule forbids and nothing
  measured until now — the last sweep was manual and its record was a doc comment. `checkDuplicates`,
  `DuplicateCheckConfig` and `duplicatesStep` are exported from `@y-core/forge/warden` and
  `@y-core/forge/warden/steps`. Every finding is a warning: a specialisation legitimately restates
  the rule it narrows, so a pair above the threshold is evidence to read, not a build to stop
  ([`AGENT_GUIDE.md`](warden/canon/shared/AGENT_GUIDE.md) §8).
- **A question-type tag on every golden query.** `GoldenQuery.dimension` labels a query `placement`,
  `prohibition`, `procedure`, `rationale` or `boundary`, and `warden:queries` rolls up the worst rank
  and thinnest coverage per dimension. Coverage was measured per document and never per kind of
  question, which left the claim the alias table is built on — that placement is what lexical
  retrieval serves worst — unmeasured. Instrumentation only: no new finding and no new threshold.

- **A workerd test set, `bun run test:workerd`.** Specs under `tests/workerd/` run forge inside the
  real Workers runtime against a fixture in `tests/fixtures/`, closing the blind spot that `bun test`
  has by construction: it drives an app through `app.request` under Bun, whose `Request` is not
  workerd's. `workerdStep` and `hasWorkerd` are exported from `@y-core/forge/tooling/gate`; the step
  is `full`-tier behind a runtime prerequisite, exactly as `browserStep` is behind a browser
  ([`TESTING.md`](docs/TESTING.md) §1f).

### Changed

- **Three gate checks derive from the tree what `config/steps.ts` used to nominate by hand, and hold
  every remaining entry to its claim.** `validate-co-location` exempts a `types.ts` or a `bin.ts` by
  name, then fails one that exports a function, a class, or a const bound to either — the note that
  a listed file was read for a smuggled helper is now enforced rather than written down.
  `validate-exports` derives a subpath under a `client` segment as browser-only, and fails a
  `browserOnly`, `sideEffectOnly` or `sealedInternal` entry that restates a convention or names a
  subpath that is gone, which none of the three had. `validate-readme-exports` discovers the READMEs
  carrying a `> Import path:` anchor instead of being handed them, and still refuses a tree where
  none does. Every allowlist stays accepted as config for a consuming app, and `coLocationStep`'s
  `exempt` is now a `ReadonlyMap<string, string>` of path to reason, a blank one failing
  ([`BUILD_TOOLING.md`](docs/BUILD_TOOLING.md) §2i, [`TESTING.md`](docs/TESTING.md) §2).

- **The shrinking-surface refusal names the `minor:` prefix as the remedy, not as one of three
  peers.** It previously offered "prefix a commit `minor:`, pass an explicit version, or use
  `--allow-semver`" in one `or` chain, where only the first records the shrink anywhere
  `resolveVersion` reads. `--allow-semver` is now described as the deliberate override it is. What
  the guard refuses is unchanged ([`BUILD_TOOLING.md`](docs/BUILD_TOOLING.md) §2j).

- **Seven `docs/` sections stop restating the canon rule they narrow and cite it instead** — the
  whole of what `warden:duplicates` reported on its first run, from 0.290 to 0.625 overlap. Each kept
  only what is local: `ERROR_HANDLING.md` §1b and §5c, `TESTING.md` §3d, `LIBRARY_ARCHITECTURE.md`
  §3d and §4b, `NAMESPACES.md` §4b, and the twin response builders in `src/http/README.md`. Nothing
  was deleted outright — every rule is still one link away, and now has one home
  ([`AGENT_GUIDE.md`](warden/canon/shared/AGENT_GUIDE.md) §8).

- **Every tripped bot guard is logged at `warn`, naming the guard and Turnstile's reason** — not only
  an unreachable siteverify. A tripped guard answers in a validation refusal's clothes by design, so
  the log line was the only thing standing between an operator and a CAPTCHA that cannot pass in a
  given environment reading as every submission getting its first field wrong. The response the
  caller sees is unchanged ([`INPUT_VALIDATION.md`](docs/INPUT_VALIDATION.md) §4c).

- **`schemeCss()` emits the `modern-css-allow: forge-ui-platform-layer` waiver as its first line**,
  byte-identical to the one every scheme file forge ships carries. A scheme copied from the theme
  customiser now passes `validate-modern-css` unedited, and keeps passing after a regeneration.

- **`SECURITY_HARDENING.md` §3f narrows to forge's own half.** The development transport posture it
  used to rule on — https at every hop, the dev server's local protocol, never a scheme-rewriting
  middleware — is now `WORKERS_PLATFORM.md` §4e in the apps canon, where a consuming app can cite it.
  §3f keeps `BASE_URL` as the derivation source for `allowedOrigins` and `extraOrigins` as the sole
  escape hatch, and points at the canon for the rest.

- **The `test` step is scoped to `src/`**, so the fast tier runs the co-located suites alone.

---

## [0.1.5] — 2026-09-08

### Breaking Changes

- **`@y-core/forge/tooling/gate` no longer exports `docsStep`, `readmeExportsStep`, `changelogStep`,
  `designStep`, or the four checks behind them.** They moved to `@y-core/forge/warden/steps` and
  `@y-core/forge/warden/checks`. **No deprecating re-export is possible**: warden sits outside `src/`
  and the import rule runs one way, so a shim in `tooling/gate` would be exactly the edge
  `buildTimeBoundaryStep` forbids. Update the imports in your `config/steps.ts`:

  ```ts
  import { changelogStep, designStep, docsStep, readmeExportsStep } from "@y-core/forge/warden/steps";
  ```

  `cloudflareWorkerSteps()` calls none of them and is unchanged.

- **`forgeChecks()` emits no `validate-docs` or `validate-changelog` row**, and its `docs` and
  `changelog` options are gone with them — for the same reason. Add both rows to your own table from
  `@y-core/forge/warden/steps`. A preset that silently dropped a documentation check would be the
  quiet failure this release is otherwise about closing.

- **`cloudflareWorkerSteps({ governance: true })` is now `{ warden: true }`**, and the step it emits
  runs `warden sync --check` rather than `gov sync --check`. `@y-core/governance` is retired: the
  corpus it carried now ships inside forge, under `warden/`.

### Added

- **`warden` — the fleet's governing corpus, and the machinery that keeps a repository in step with
  it.** A new bin, and six subpaths: `./warden`, `./warden/checks`, `./warden/steps`,
  `./warden/knowledge`, `./warden/mcp`, and `./warden/canon/*.md` for reading a canon document
  directly. `warden sync` writes `.claude/agents/` and `.claude/commands/` and seeds `CLAUDE.md`,
  `AGENTS.md` and `settings.local.json`; **it never copies the canon**, which is read from the
  installed package instead. Its own tree separates payload from code: `canon/`, `claude/` and
  `share/` are what it carries, and every module lives under `warden/src/`.

- **A knowledge layer over both corpora — BM25 across SQLite FTS5, and no new dependency.**
  `warden index`, `search`, `read`, `outline`, `related` and `catalogue` from a terminal;
  `warden serve` is an MCP server over stdio offering `knowledge_search`, `knowledge_read`,
  `knowledge_outline` and `knowledge_related`, plus `knowledge://catalogue` and one resource
  template per corpus. A chunk id is the citation a human already writes —
  `canon/libs:CODE_RULES.md#5c` — so retrieval and prose share one namespace.

  **Coverage ranks as well as admits, and placement questions reach the growth rules.** A hit's rank
  is its BM25 score with 40% of it scaled by coverage — BM25 rewards a rare term wherever it lands,
  so one uncommon word could drag a chunk above the section that answered the whole question. The
  blend was swept against the golden set: BM25 alone and coverage alone both rank worse. Separately,
  the vocabulary a placement question is asked in — put, belongs, goes, lives, home — now bridges to
  the growth rules and the classification sections, which are titled after the namespace rather than
  after the asking. "Where do I put a new CORS middleware" moved from tenth to first.

  **Every hit says which corpus governs it.** A repository specialises a canon document under the
  same filename and the same section numbers, so `canon/libs:CODE_REVIEW.md#3a` and
  `local:docs/CODE_REVIEW.md#3a` come back with identical titles and identical glosses; each is now
  labelled `fleet canon` or `this repository`, on searches and on reads, in the MCP and in the CLI.
  The same ambiguity was silently dropping citations — a `shared` rule citing `libs/ERROR_HANDLING.md`
  matched both corpora and resolved to neither — so resolution now prefers the citing document's own
  tree, then its own corpus, before giving up. Unresolved citations across forge's corpus: 7 to 3,
  and the remaining three name files the corpus does not hold.

  **A heading that only organises its children is addressable, outlined, and unsearchable.** A `## N.`
  with no lead paragraph of its own is still the title a reader scans an outline for and the target
  of every `§N` citation the corpus writes, so it is emitted as a chunk; it stays out of the search
  index, because its title is already carried by every child's heading trail and indexing it would
  add a bodyless competitor that reaches nothing new.

  **A question the corpus does not cover returns nothing.** Each hit carries a coverage figure from
  0 to 1 — the share of the query's information that section actually addresses, weighting each term
  by how rare it is and a term the index has never seen at twice its rarest. Below a calibrated floor
  a hit is not offered, so an empty result is an answer: no rule here governs what was asked. Without
  it BM25 ranks candidates only against each other, and a question about payment-webhook retries
  comes back with ten confident sections about origin guards. The `warden:queries` gate step holds
  the floor to a golden set and a negative set and reports the margin between them on every run.

  **No embeddings, deliberately.** The corpus is ~1,000 chunks of technical identifiers, where
  lexical retrieval is the stronger method; it carries a hand-written per-section gloss a generic
  corpus does not; and an embedding provider would make every fresh clone and CI run depend on an
  egress rule. A curated alias table covers the paraphrase queries that would otherwise be lost.

  The index lives at `.forge/warden/index.sqlite`, gitignored and rebuilt on demand. **An absent
  index is never an error, and a served one is never behind**: every question that reads the corpus
  re-checks it first and refreshes what changed, so an answer reflects the documents as they are
  rather than as they were when the server started — the case that matters, because the agent
  asking is usually the one editing. Only a refresh that fails leaves an advisory, and it still
  answers rather than refusing. The gate builds its own at `.forge/warden/gate.sqlite`, so a working
  index can never change a verdict.

- **Two gate steps, `warden:index` and `warden:queries`.** The first asserts what retrieval depends
  on — every document chunked, no duplicate id, every numbered section glossed, the catalogue in
  step. The second runs a golden query set with a coverage assertion: **every canon document must be
  top-1 for at least one query**, which is what stops the set decaying into a stale fixture. Both
  declare `bun:sqlite` as a prerequisite, so a non-Bun runner reports them skipped below the `full`
  tier and fails them there.

- **`checkStep` is published from `@y-core/forge/tooling/gate`**, so a check living outside that
  namespace builds its step with the same tier and prerequisite handling.

### Fixed

- **`checkDocs` failed silently when its configured `decisionsDir` did not exist.** The other roots
  still filled the file list, so `scannedNothing` never fired and a run passed having validated zero
  governing documents — the exact shape a mistyped `decisionsDir` takes. It is now a hard failure.
  `extraDirs` also walked only one level deep while `decisionsDir` recursed; both recurse now.

- **`checkDocs` gained `citableDirs`** — roots whose sections resolve a citation without the
  documents themselves being validated or index-reconciled. Without it, a citation into a document
  outside `decisionsDir` resolved to no key and was skipped in silence rather than checked.

---

## [0.1.4] — 2026-09-07

### Breaking Changes

- **`StepRequirement.hint` is printed verbatim, so a hint must carry its own verb and backticks.**
  `formatMissingRequirement` used to wrap it as ``run `<hint>` ``, which forced every remedy into a
  single command; it now prints the hint as given. **A caller passing a bare noun-phrase hint gets
  a sentence that reads wrong, and nothing validates it** — the failure is silent and cosmetic, not
  a type error. Migrate a hint like `"pnpm exec playwright install"` to
  ``"run `pnpm exec playwright install`"``. Forge's own hints are unchanged on screen: `tailwindcss`
  and `esbuild` now read ``run `bun add -d tailwindcss` `` and ``run `bun add -d esbuild` `` because
  the hints themselves carry the verb.
- **`StepBase.fullOnly` is gone; a step declares `tier?: GateMode` instead.** A table writing
  `fullOnly: true` must write `tier: "full"`, and `StepOptions.fullOnly` becomes `StepOptions.tier`
  on every builder. This one **is** a type error, so no table breaks silently. See **Changed** for
  the three-mode gate it belongs to.

### Added

- **`cloudflareWorkerSteps` emits browser and design rows.** `browser: true` adds the `full`-tier
  `test:browser` step last in the table. `design: { stylesheet, cssDir?, sources?, deferred? }` adds
  `validate-modern-css`, `validate-class-order`, `validate-class-tokens` and — only when `cssDir` is
  given — `validate-css-tokens`, all before `test`. Both are opt-in: an app that does not use `ui/*`
  gets no rows and needs no `tailwindcss` peer. `design.sources` defaults to `["src/"]` rather than
  the table's top-level `sources`, because `validate-class-order` reads specs, whose class literals
  are deliberately self-conflicting; `deferred` defaults to `[]` rather than forge's own list.
- **`bindingSchema` takes an `optional` flag, and `bindingSetSchema` declares several bindings at
  once.** `optional: true` relaxes presence only — an absent binding passes, a present one of the
  wrong shape still fails — which is the schema-side statement of what `rateLimit`'s
  `required: false` and the optional storage resolvers already do. `BindingSpec` is exported
  alongside.
- **`EmptyState.Title`, `Dialog.Title` and `Drawer.Title` take a `level` prop** (`1`–`6`, default `3`
  on `EmptyState.Title`, `2` on the other two), so a heading's level follows its section's position
  in the document rather than the compound's default. Only the tag changes: the `data-slot` token,
  the class string and — on the dialog and drawer titles — the `id` `aria-labelledby` resolves to are
  byte-identical at every level.

- **`validate-asset-manifest` checks every manifest value exists on disk.** `assetManifestStep` /
  `checkAssetManifest` read the emitted `.forge/assets.ts` and assert that every `DATA` value
  resolves to a file under the assets config's `publicDir` — the class of failure where the manifest
  is ahead of the served tree and SSR renders a `<script src>` the browser 404s. `cloudflareWorkerSteps`
  emits it whenever `assetConfig` is given, immediately after `types:assets`. A types-only artifact
  passes a fast run, since its identity paths deliberately do not exist on a clean checkout, and
  fails a standard or full run naming `forge assets build --minify`.

### Changed

- **The gate has three modes: `fast`, `standard` and `full`.** `GateMode` gains `"standard"` and is
  derived from the new exported `GATE_MODES` tuple, which is the tiers in ascending order. **A bare
  `bun run verify` now means `standard`**, the run a task closes on; `fast` — the inner loop — is
  opt-in via the new `verify:fast` script or `--mode fast`. `--mode <fast|standard|full>` is the
  canonical flag and `--full` is kept as sugar for `--mode full`; passing both is refused, as is an
  unrecognised `--mode` value. The banner names the mode canonically, so `--full` prints
  `verify --mode full`. What an absent prerequisite means is unchanged: only a full run fails on
  one, `fast` and `standard` skip.
- **`StepBase.fullOnly` is replaced by `StepBase.tier?: GateMode`** — the lowest mode a step runs
  in, absent meaning `fast`. Selection is a rank comparison, so `fast ⊆ standard ⊆ full` still holds
  by construction. `StepOptions.fullOnly` becomes `StepOptions.tier` on every builder. Pre-1.0, so
  there is no shim: a table writing `fullOnly: true` must write `tier: "full"`.
  `typeAwareLintStep` now defaults to `"standard"` rather than full-only, `browserStep` and
  `changelogStep` to `"full"`. **Forge's own table moves accordingly**, so a bare `verify` runs
  `lint:types` for the first time; only `validate-changelog` and `test:browser` are held to `full`,
  and `fast` holds `typecheck`, `lint`, `format` and `test` alone.
- **`checkAssetManifest` tolerates the types-only artifact in `fast` alone.** `standard` and `full`
  both fail it — a manifest nothing has built is exactly what a run closing a task has to catch.
- **`CheckStep.run` is handed the run's `GateMode`.** A check whose strictness depends on the mode
  now has one table row rather than two. Existing zero-argument checks are unaffected — a `() => …`
  is assignable to the widened type — so only a hand-written check that wants the mode needs a
  change.
- **A failed binding check now names the binding.** `bindingSchema` builds its predicate with
  `safeCheck`, so the message reads `LOGS_KV must be a KV namespace binding` instead of the bare
  issue type `check`.

### Fixed

- **`browserStep` spawns playwright under bun.** The argv is now
  `["bunx", "--bun", "playwright", "test"]` rather than `["playwright", "test"]`, which the runner
  resolved to the `node_modules/.bin` shim and ran under node. Forge ships raw TypeScript, and node
  refuses to strip types from a file under `node_modules`, so any consumer whose
  `playwright.config.ts` imported a forge subpath — `resolveChromiumPath`, the very symbol forge
  publishes for it — died at config load with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, failing
  `verify --full` before a single spec ran. Forge's own `test:browser` script moves to the same
  command, so the gate row and the script can no longer diverge. The `browser: true` row is itself
  still unreleased, so nothing shipped carried the broken argv.

- **`browserStep`'s prerequisite names both routes to a browser.** The default was
  `bun run test:install`, which assumed every consumer defines that script — forge did, a consuming app
  did not. It now reads ``run `bunx playwright install chromium` ``:
  a direct command needing nothing defined anywhere. Forge's own
  `test:install` script is gone. Anyone who sees the line has no browser downloaded —
  every image there bakes Chromium and sets `CHROME_PATH`, the first thing `hasChromium` resolves, so
  the probe cannot fail in one. A project whose browser arrives some other way passes `hint` itself,
  as it always could. Both the hint and the `browser` row are unreleased, so no shipped surface changes.

- **`forge assets gen types` no longer clobbers a real build artifact.** Both commands write
  `.forge/assets.ts`, and the gate preset runs `gen types` on every `verify` — so a verify after a
  `--minify` build replaced the hashed manifest with unhashed logical names and every asset URL
  404'd, silently killing the client bundle. `gen types` now keeps an existing build artifact when
  it still fits the config, comparing the two modules with every emitted value blanked; it rewrites
  only when the shape has drifted (a bundle or glyph added, a sprite target or prefix renamed).
  `generateAssetsTypes` returns `AssetsTypesOutcome` (`"written" | "kept-build-artifact"`) and the
  command prints which it did. `buildAll` is unchanged — a build always writes.

---

## [0.1.3] — 2026-09-06

### Added

- **`@y-core/forge/tooling/lint/plugin` — the spelling a consumer's `.oxlintrc.json` can actually
  load.** `"jsPlugins": ["@y-core/forge/tooling/lint"]` could not work in any consumer: oxlint loads
  a JS plugin through node, and node refuses to strip types from a file under `node_modules`
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), which is deliberate and has no opt-out flag. The
  new subpath is a committed esbuild bundle of `mod.ts` that resolves nothing at load time. Forge is
  consumed as a git tarball, so there is no publish step that could build it and no `prepare` hook a
  consumer runs — committing the artifact is the only form that reaches a consumer without the
  consumer bundling it themselves. `./tooling/lint` is unchanged and still carries the plugin and the
  two catalogs as TypeScript.
- **`validate-lint-plugin` (`lintPluginStep`) — the drift check that generated file needs.**
  It re-bundles `src/tooling/lint/mod.ts` and fails on any difference from the committed
  `plugin.mjs`, the same contract `validate-design-scale` holds the generated scale to. Regenerate
  with `bun run gen:lint-plugin`. `esbuild` is an optional peer, so a machine without it reports the
  step skipped and `--full` fails.

- **`safeCheck` — a `v.check` whose message an env refusal may show.** Every `v.check` shares the
  single issue type `check`, so the message is the only thing that ever told two of them apart, and
  the env formatter dropped it: a rule with a sentence written for a deployer read as
  `Invalid environment: site.url: check`. `safeCheck(requirement, message)` registers the message
  against the requirement, and `describeEnvIssue` surfaces a registered one verbatim. A plain
  `v.check` still renders as `check`, so a message interpolating the rejected value cannot reach the
  throw — nothing can decide that statically, so the author states it, and the default is the safe
  one. `BaseUrlConfigSchema` is the first adopter.

### Changed

- **`BaseUrlConfigSchema`'s message names the requirement, not an env key.** It read
  `BASE_URL must use https: (…)` and now reads `must use https: (…)`, with the refusal's own
  `<field>:` prefix locating the value — the schema validates a value, and which env key supplies it
  is the consuming app's choice, so the old wording sent an operator whose repo maps `SITE_ORIGIN` to
  a variable that does not exist.

### Fixed

- **`loadDesignSystem` resolves a bare package `@import`, so a consuming app can compile its own
  stylesheet.** Every id that was not `tailwindcss*` was joined against the importing file's
  directory, so an app whose stylesheet opens with `@import "@y-core/forge/ui/assets/css/tailwind.css"`
  — the import forge publishes for exactly that purpose — failed `cssTokensStep` with an `ENOENT` for
  a path inside its own `src/assets/`. A package specifier now resolves through the resolver and a
  relative one against the base, which is one rule rather than a special case for one package name.
- **`forge/exact-markup-assertion` no longer reports an absence claim.**
  `expect(html).not.toContain(secret)` and `expect(html.includes(secret)).toBe(false)` both say a
  string appears nowhere in the document — the one thing an exact match cannot state, and what the
  0.1.2 note already said these checks are for. Adopting the rule in an app produced 16 such reports,
  each of which could only ever be suppressed.
- **`forge/exact-markup-assertion` recognises a list returned by a same-file helper.** A
  `toContain` on `sectionIds(html)` is exact membership, but only a direct `.split()` / `.map()` was
  recognised — a helper call is an `Identifier` callee, so it fell through and was reported. The
  fixpoint that traces markup now also records which bindings yield a list, by return annotation or
  by what their `return` statements produce.
- **`bun run gen:class-groups` and `bun run gen:design-scale` can write again.** Both resolved the
  repository root one directory too high and died with an `ENOENT` on a path outside the repo, so the
  regeneration command each failing gate step tells you to run could not run at all.

---

## [0.1.2] — 2026-09-06

### Added

- **`validate-build-time-boundary` — a runtime module that imports build-time code now fails the
  gate.** The `src/tooling/` restructure made membership in the container _be_ the Web-APIs-only
  exemption, but nothing enforced it: a runtime namespace could import the asset pipeline and the
  only signal was `validate-namespace-graph` asking for a declared edge — which anyone could grant,
  one edge at a time. The step fails any source outside `src/tooling/` or `src/ui/assets/build/`
  that names one of their modules at value, whether by relative path, by directory (`../tooling/assets`
  → its `mod.ts`), or by published subpath (`@y-core/forge/tooling/assets`) — the last of which
  resolves to nothing relative and so was invisible to every existing check. Side-effect and dynamic
  imports count. A **type-only** import is allowed, because it is erased before anything is bundled;
  the layering it still represents stays `validate-namespace-graph`'s to judge. Specs are exempt: a
  `.test.ts` or `.browser.ts` is never in a bundle. The rule is deliberately stronger than the
  reachability `LIBRARY_ARCHITECTURE.md` §1e states — reachability from a published subpath is blind
  to a module no barrel exports yet, and over forge's own tree it computes exactly the set a
  per-file scan already sees.

- **`validate-readme-exports` — a README export table that drifts from its barrel now fails the gate.**
  `src/ui/README.md` listed 8 of `ui/controls`' 13 exports, and the drift was silent in both
  directions: a symbol added to a barrel and not to the table is undocumented for anyone who reads
  the README rather than the source, and a row naming a symbol a rename removed is an import that
  does not resolve. The new step keys on the `> Import path: … → …` line every subpath section
  already opens with, so it covers exactly where the drift was found and any other README opts in by
  adopting the anchor. A **value** export needs a table row; a **type** export needs a row or a
  `**Types:**` mention, which is how sections such as `ui/chrome` already document theirs. Thirteen
  further undocumented exports across `ui/core`, `ui/contracts`, `ui/client`, `ui/server` and
  `ui/chrome` were found by it and documented.

- **`validate-co-location` covers all of `src`, not just `src/ui`.** Sixty-three modules outside
  `src/ui` had no test beside them and nothing said so. Twenty-one carried real behaviour and now
  carry real specs — `Forge` itself, the three `jsx` runtime modules, `cli/term`'s `ansi`/`border`/
  `codes`, the Cloudflare API endpoint builders and error classification, `logging`'s level parsing,
  the `assets` and `site` config schemas, `storage/r2`'s error type, and the `types.ts` modules that
  smuggle a class or a helper. The other 42 are exempt with a stated reason: type declarations,
  constant tables, one generated file, three `bin.ts` entry points and the test fixtures. **A stale
  exempt entry fails the check**, so the list can only shrink.

- **Every gate-check module under `src/cli/pkg/gate/checks/` now has a co-located spec.** Five had
  none — `changelog.ts`, `css-sources.ts`, `design-system.ts`, `exports.ts` and
  `modern-css-rules.ts` — which is the worst failure mode a check body can have: with no spec it
  reports green either way. 87 new tests pin every finding message each one emits, and each spec
  covers the check's refusal to pass vacuously. `design-system.test.ts` skips cleanly on a machine
  without `tailwindcss`. One gap the specs found is **pinned as it behaves, not fixed**:
  `fileURLToPathish` does not percent-decode, so a `node_modules` path containing a space fails with
  `ENOENT`. (The vacuous-match gap these specs also pinned was **not** confined to `checkCssSources`
  and `checkExports`, and the sibling checks did not all have the refusal — it was 7 of 19. See the
  vacuity entry below, which fixes it and rewrites the two specs that pinned it.)

- **`validate-readme-exports` now covers `src/storage/README.md` and `src/testing/README.md`.** Both
  drifted through the September review with nothing reading them: the storage README's three
  export-shaped type tables sat under a `## Types` section _separate_ from the subpath headings, so
  an anchor could never have seen them, and roughly 29 value exports were documented only in prose.
  Each subpath section now carries the `> Import path:` anchor and its own `### Exports` table
  covering the whole barrel — including the six UUID values and two types `storage/db` re-exports
  from the sealed-internal `crypto` namespace, and `storage/r2`'s previously undocumented
  `CONTENT_TYPE_DEFAULT` and `inferContentType`. `src/testing/README.md` gains the anchor and the
  missing `FakeD1Options` row. `ReadmeExportsCheckConfig.readme` becomes **`readmes`**, a list.

- **`validate-class-tokens` — a class that names no utility now fails the gate.** `link.tsx` shipped
  `focus-ring-outset-outset`, which matches no `@utility` and no Tailwind utility, so every `Link`
  rendered `outline-none` with nothing put back and the gate stayed green: nothing in it read class
  tokens for existence. The new step compiles `src/ui/assets/css/tailwind.css` and reports any token
  the design system produces no CSS for. It reads every string literal rather than only class
  positions — that typo lived in a module-level `const` — and names a token only when some
  dash-prefix of it is a declared utility, which is what keeps prose and non-class literals out.
  Skipped, not failed, on a machine without `tailwindcss`; specs are not scanned.

- **`mountCarouselDots` — the `Carousel` dot row now follows the strip.** `Carousel` is a scroll-snap
  strip with no script, so the server's `current` dot was a guess that stopped being true the moment
  the reader pressed a dot or swiped: the slide moved and the highlight stayed on slide one. The new
  controller observes the slides **against the strip** and moves the dot row's own server-rendered
  selected class onto the dot for the most-visible slide — both spellings are read off the rendered
  row, so a theme, a size or a caller class stays the component's business. Exported from
  `@y-core/forge/ui/client` with `CarouselDotsOptions`; the showcase wires it as the `show-carousel`
  scope. **No autoplay** is added, here or anywhere: the strip advances only when the reader moves it.

### Changed

- **`validate-design`'s eleven source detectors became eleven oxlint rules, and the step now checks
  only what a per-file linter cannot.** The detectors read markup out of raw text: a tag-frame walker
  (`endOfOpeningTag`) that tracked quote and brace depth to find where an opening tag ended, an
  `indexOf("</label>")` standing in for an element's body, and a line-at-a-time scan that could not
  tell `<Card>` inside a `<Card.Content>` from `<Card>` after it. Every one of those questions is a
  `JSXOpeningElement`, an attribute list, or a parent walk. **`UI_DESIGN_GUIDANCE.md` §4b is re-cut
  to match**: the split is what a rule has to _read_ — one parsed file, or more than one — not
  markup versus class string, which was only ever a description of what the plugin happened to
  support when the boundary was drawn.

  Three consequences. **The suppression vocabulary changed**: the two live
  `/* design-allow: <id> — <why> */` comments in `src/ui/show/components.tsx` are now
  `{/* oxlint-disable-next-line forge/a11y-live-politeness -- <why> */}`, whose reason
  `forge/suppression-needs-reason` enforces. **Every migrated rule is fixable-eligible**, which a
  `CheckStep` can never be. And **two rules that were scoped by a file-path test inside the detector
  are now scoped by `.oxlintrc.json`** — `catalog-wrong-raw-input` to `src/ui/show/**`,
  `a11y-one-live-region` off for `src/ui/core/toast.tsx` — which is the same scope, stated where a
  reader looks for it.

  **`validate-design` still runs**, holding the corpus against forge's API and both rule registers
  against the plugin: neither is a per-file question. Its `RULE_ENFORCER` register now has no `gate`
  row at all, and a row that claimed one would fail by name. `design-parse.ts` keeps the class-position
  scanner, which `validate-class-order` is the other consumer of — it executes the real `cn()` on each
  literal, so it needs the literals a text scan finds.

  **One coupling had to be broken by hand.** `forge/a11y-aria-beside-data` derived its vocabulary
  from `stateAttrs(EVERY_STATE)`, and `tooling/lint` is a leaf namespace that may not import `ui`.
  The rule hand-lists the six presence flags, and `src/ui/contracts/state-attrs.test.ts` holds the
  two lists together — so a seventh flag fails a test rather than going quietly unenforced.

- **`validate-exact-assertions` became `forge/exact-markup-assertion`, and the gate lost a step.**
  The check ran a fixpoint dataflow approximation over **eight passes** of regular expressions — a
  hand-rolled `statementEnd` that guessed where a statement ended from a line-continuation pattern, a
  `receiverBefore` that guessed backwards from a `.includes(`, and a comment-blanking pass so none of
  it tripped on prose. All of it existed to answer a question about scope, which is exactly what an
  AST gives away. The rule reproduces the check's finding set on `src/ui` **exactly** — the same four
  sites, each of which was already suppressed — and is more precise in one place the regex was blunt:
  `PRODUCES_LIST` matched `.split(` anywhere in a binding's text, where the rule asks what the value
  the binding _is_, including through a `?? []` fallback. The four `/* exact-allow: exact-assertion —
<why> */` comments became `// oxlint-disable-next-line forge/exact-markup-assertion -- <why>`,
  whose reason `forge/suppression-needs-reason` now enforces rather than the check's own parser. The
  `exempt` option is gone with the step: it was empty, and `.oxlintrc.json`'s `overrides` is where a
  file is excused now. **Scope is unchanged** — an `overrides` entry holds the rule to `src/ui`'s
  test and browser files, the tree `config/steps.ts` pointed the step at.

- **The slot-clobber rule moved from `validate-jsx` to `forge/data-slot-before-spread`, and its
  hand-written JSX scanner is gone.** `jsx-parse.ts` was a 195-line character-level tag-frame scanner
  — tracking quote modes, brace depth and a tag stack — written to answer one question the AST
  answers directly: does a literal `data-slot` precede a bare-identifier spread in the same
  `JSXOpeningElement`'s attribute list? The oxlint rule is that question, so the scanner and the
  JSX-text apostrophe class of bug it kept relapsing into are both deleted. Two consequences worth
  knowing: the rule now also reads `data-slot={"card"}`, which the quote-matching scanner could not
  see, and it is **fixable-eligible** — a `CheckStep` can never carry a fixer, an oxlint rule can.
  `.oxlintrc.json` turns it off for `*.test.tsx`, which is exactly the set `validate-jsx` never
  walked. **`validate-jsx` still runs**: its other half is a file-presence check for the two JSX
  pragma lines, which no per-node rule can state.

- **`forge/optional-prop-undefined` enforces the `?: T | undefined` convention, which was asserted as
  universal with no detector.** Every other convention here carries a `detect:` command
  ([`CODE_REVIEW.md`](.decisions/governance/CODE_REVIEW.md) §3b); this one was ~90% applied with
  nothing to notice the next exception, and the exceptions kept arriving. The rule reports an
  optional property signature whose annotation admits no `undefined`, and it found **seven component
  files** the convention had missed — `field.tsx`, `field-stack.tsx`, `timeline.tsx`, `navbar.tsx`
  and the three `ui/controls` group controls — all now widened.

  **It is scoped to `ui/core`, `ui/controls` and `ui/chrome` component files, and that scope is the
  point.** Run repo-wide it reports 836 properties, almost all of them the internal option objects
  `UI_SSR_COMPONENTS.md` §1n explicitly exempts — a syntactic rule cannot tell "a consumer constructs
  a value of this type" from "this is an options bag", so the scope is stated in `.oxlintrc.json`
  rather than guessed at per node. The corpus rule lives in `reference/10-accessibility.md` because
  the reason is an accessibility one: a bare `?:` under `exactOptionalPropertyTypes` forces
  `aria-label` into a spread, and a spread is opaque to `jsx-a11y`.

  **`checkDesign` now reads `overrides[].rules` as well as the top-level block.** It previously
  treated a rule enabled only in an override as disabled and failed the gate for it — which would
  have blocked any path-scoped rule, not just this one.

- **`catalog.md` covers every published component, and a barrel export with no row now fails the
  build.** CLAUDE.md's Growth Rules name `src/ui/design/` as the single home for "which component to
  reach for", and **19 of the 58 published components had no "Job → component" row** — nine
  (`Breadcrumbs`, `Drawer`, `EmptyState`, `FileInput`, `Kbd`, `Stat`, `Status`, `Steps`, `Timeline`)
  appeared nowhere in the corpus at all, and ten more only under `reference/`. The same changeset
  that added them had built two enforcement mechanisms for two _other_ documentation surfaces — the
  README export tables and the showcase coverage contract — while the surface the Growth Rules
  actually point builders at drifted silently behind an 18-component addition. All 19 rows are
  written, and the contract lands with them rather than after them.

  **It is a `bun test` beside `show/coverage.test.tsx`, not a gate check**, because the
  component-vs-utility predicate both existing sweeps use is runtime-only — a capitalised _function_
  on the barrel — and statically `FOUC_SCRIPT` is indistinguishable from a component. Parsing differs
  from the README precedent too: `catalog.md` has no `> Import path:` anchor, no `### Exports`
  heading, and names components in **column 2**, where `parseExportsTableSymbols` hard-codes cell 1 —
  so only `rootIdentifiers` is shared, and it becomes exported for the purpose. The escape hatch is
  `CATALOG_MISSING`, modelled on `COVERAGE_MISSING`: shrink-only, every gap requiring a non-empty
  `owner`, staleness asserted. It ships **empty**.

- **The `data-*` wiring vocabulary is declared once and derived from the constants that already name
  it.** Two independent hand-written allowlists enforced the closed-world sweep — `WIRING_ATTRS` in
  `conformance.test.tsx` (32 entries) and `STRUCTURAL_ATTRS` in `contracts/state-attrs.test.ts` (55) —
  with 31 names maintained in both and no link between them. Worse, 16 of those names were **already
  exported constants** and were being restated as string literals anyway; only `data-island-state` was
  resolved through its declaration. `contracts/wiring-attrs.ts` now declares the union as a name →
  reason record, taking eleven names from their constants directly. The five declared in
  `contracts/theme/` stay literal because `ui/contracts` is a LEAF namespace and
  `validate-namespace-graph` refuses the edge to its own subnamespace — the spec asserts them against
  those constants instead, a test being outside the graph. The table is read by **tests only**, so
  the frozen-hook technique `state-attrs.ts` documents is untouched and emitters keep their literal
  keys.

  **A stale entry now fails, so the list can only shrink** — the guard the co-location and
  exact-assertion lists already had and this one did not. Five names were exempting nothing:
  `data-duration`, `data-nav` and `data-theme` appeared nowhere but the allowlists, and `data-setting`
  and `data-tool` only in `.test.tsx` files the sweep excludes. (`data-duration` traces to
  `toast-contract.ts`'s `TOAST_DURATION_KEY = "duration"`, a dataset key never spelled `data-duration`
  in source.) The assertion belongs to the **source** sweep alone, which reads every non-test file
  under `src/ui` and can tell "unused" from "not rendered here"; the render sweep mounts only
  `ui/core` and `ui/controls` and would call most of the table stale. `data-probe`, the render
  sweep's own forwarded fixture attribute, is declared as its extra. `STATE_ATTRIBUTES.md` §4 now
  describes both sweeps and their scopes rather than one, and states the wiring-versus-enum boundary:
  `data-placement`, `data-position`, `data-decoration` and `data-as` drive `cva` variants and sit in
  wiring, which is recorded rather than left silent.

- **A gate check whose scan set is empty now fails instead of reporting a green summary.** Twelve of
  the nineteen `check*` entry points could pass having walked nothing: `checkCssSources` initialised
  `registered = 0`, and a mistyped `uiDir` made the walk empty and printed
  `0 src/ui directories are @source-scanned or registered` as a **pass** — the check silently disabled
  by a config typo. Guards now cover `jsx`, `ssr-boundary`, `co-location`, `exact-assertions`,
  `namespace-graph`, `css-sources`, `docs`, `exports` and `design`, whose second source walk was
  unguarded so every corpus rule could go unapplied while the summary still counted them. One
  `scannedNothing(what, gate, verb?)` helper carries the wording, with `verb` preserving `contrast`'s
  "measured nothing" rather than forcing one word onto a unit that is a config array.

  **The guard reads the raw walk and returns before any finding accumulates**, both of which are
  load-bearing: guarding `modules.length - exempt.size` would let an all-exempt tree report
  `0 modules` green beside a wall of stale-exemption failures, and guarding late made the refusal
  _discard_ what the check had already found. Where the count is only knowable at the end, the
  refusal is additionally conditioned on there being no findings — a check already red has no green
  to refuse.

  **Three checks stay unguarded and now say why in TSDoc.** `checkClassGroups` and `checkDesignScale`
  are single-artifact diffs with no walk; `checkAssetRoot` passes with no `assets.directory` because
  a Worker with no static assets is a valid project. Two more are guarded on their _config_ instead,
  because reaching zero is supported: `checkReadmeExports`, whose `> Import path:` anchor is opt-in,
  and `checkChangelog`, where a document holding only `[Unreleased]` is a pre-first-release project.
  `ASSET_AND_BUILD_TOOLING.md` §5i is rewritten accordingly: the count in `summary` stays, now stated
  as necessary but not sufficient.

- **`contrast.ts` had an abandoned vacuity guard: `measurements.length === 0 ? findings : findings`,
  both branches identical.** It is removed rather than completed. `measurePairs` emits one
  measurement per pair per mode, so the count is `pairs.length * 2` and reaches zero only when the
  pair list is empty — which the refusal at the top of the function already covers, making any second
  guard unreachable. The dead ternary is replaced by the reasoning, and a spec pins that two rows are
  measured per pair.

- **Three specs and three fixtures were themselves relying on vacuous walks.** `css-sources.test.ts`
  and `exports.test.ts` asserted `ok === true` over a `0 …` summary in as many words ("_no refusal
  branch guards a vacuous scan_"), and `jsx.test.ts` pinned a zero-file walk as a pass; all three are
  rewritten to assert the refusal. Worse, `design.test.ts`'s fixture carried no `.tsx` source at all,
  so once the check refused an empty source walk **all three of its oxlint-config cases would have
  passed without reading a config** — the same defect the epic exists to fix, one level up in the
  specs. New vacuity specs cover `co-location`, `exact-assertions`, `ssr-boundary`, `namespace-graph`,
  `design` and `contrast`; `checkSsrBoundary`'s entry point had no spec of any kind.

- **The eight shape tokens are now held as a set, not counted in prose.** `theme-base.css` declares
  them and a shape file re-declares exactly them, and nothing checked that: a token added to the base
  and missed in `shape-compact.css` leaves that shape silently inheriting the default, and one
  carried only by the shape file is a token no other shape can override. Neither renders as a broken
  page — the value is simply wrong. A co-located spec reads the set off the declaration block's own
  banner comment and asserts equality in both directions, plus that no `theme-*.css` declares one,
  which is the assumption the contrast audit walks on. **It is a `bun test`, deliberately, not a
  `validate-css-tokens` rule**: that step is `requires`-gated on `tailwindcss` and reports _skipped_
  without it, which would hide a pure-CSS invariant behind an optional peer dependency.

- **`?: T | undefined` reaches the types a consumer constructs a value of, not just `*Props`.** Eight
  declarations still carried a bare `?:` — `Indicator.Item`'s `placement`, `Kbd`'s `size`, both
  `Menu` checkable items' `checked`, all six of `ToolbarItemStyling`, and `NavSlot`, `NavMegaMenu`
  and `ToolbarPopover` in `ui/chrome`. Under `exactOptionalPropertyTypes` each one forces a consumer
  into the guard-form spread `{...(x !== undefined ? { … } : {})}` that the convention exists to
  eliminate. The last three are why `UI_SSR_COMPONENTS.md` §1n's test changes from "every `*Props`"
  to **"does a consumer construct a value of this type"**: a definition object handed to a component
  is a consumer input as much as an attribute bag is, and reading the rule off the name let three
  such types drift.

- **A state recipe now travels as one token of the base literal, in every component that uses one.**
  `UI_SSR_COMPONENTS.md` §3h had already ruled this — a recipe painting only under `&[aria-invalid]`
  cannot contend with one that paints unconditionally, so a `cn` argument of its own buys no
  separation — but the rule sat mid-paragraph inside the `signature()` discussion and named only
  `radio-group.tsx` and `checkbox-group.tsx`. Seven files disagreed with it: `input.tsx`,
  `textarea.tsx`, `select.tsx`, `file-input.tsx`, `slider.tsx` and `toggle.tsx` passed
  `state-invalid` as a second argument. It is now a standalone statement in §3h with its own
  admission test, and every call site follows it. **The rendered class strings change token order and
  nothing else**, and each affected spec is re-pinned. What still earns its own argument is a
  base-scope token that genuinely contends: `slider.tsx` and `toggle.tsx` keep `cursor-pointer`
  separate because `state-busy` paints `cursor: progress`, which is a real conflict — `state-invalid`
  had merely been riding along in that argument.

- **`PRESSED_PAINT` moved from `state-classes.ts` into `utils/recipes.ts`,** which is where §3i
  already routes a module-scope class const. The two-line module was split from its only neighbour
  for no reason, and its presence in the co-location exempt list was a second defect: it sat under the
  `contracts/*` block whose stated reason describes `bind-contract` alone. `recipes.ts` now has a
  real spec carrying both former assertions, so the exemption is **removed** rather than re-filed —
  `config/steps.ts:82` says the list may only shrink.

- **`Table` uses the shared vocabulary helpers instead of two hand-written spreads.** A one-off
  `classProp` helper existed to omit an `undefined` class; `renderToString` already skips an
  `undefined` attribute value (§1n), so nine other sites just write `class={cls}` and these four now
  do too. `Table.Row`'s `{...(tone ? { "data-tone": tone } : {})}` becomes
  `presentationAttrs({ tone })`, the declared home for that attribute. Rendered markup is unchanged.

- **A build-time module now has a routing rule: does it drive an external builder, or is it one?**
  `src/assets` exists to shell out — Tailwind, esbuild, a font download, a file copy — and that
  orchestration is the whole warrant for its Node-API exemption, which
  [`LIBRARY_ARCHITECTURE.md`](.decisions/governance/LIBRARY_ARCHITECTURE.md) §1e states as
  reachability rather than as a path glob. Four modules compute their artifact instead of driving a
  tool and so have no reason to sit there: `build/sprites.ts` (197 lines), `build/color.ts` (172),
  `build/cursors.ts` (126) and `build/css-tokens.ts` (91) — ~586 lines behind no external builder.
  The debt is named with a `build/` directory under `src/ui/assets` as its agreed destination; the move is not scheduled,
  but the rule is settled, so no fifth module joins the list by default
  ([`ASSET_AND_BUILD_TOOLING.md`](.decisions/implementation/ASSET_AND_BUILD_TOOLING.md) §2c).

- **The comment budget is enforced everywhere outside `src/ui`.** Ten section banners, 49 TSDoc
  blocks over 400 characters, and 80 runs of three or more consecutive `//` lines were cut to one
  sentence plus a tag, or deleted where the prose restated the code or defended a choice no caller
  can observe ([`CODE_RULES.md`](.decisions/governance/CODE_RULES.md) §5b). Rationale worth keeping
  moved to its single home — the `SyncAction` vocabulary and the `ResolvedFlags` `as const` trap to
  their namespace READMEs, `RE_ANSI`'s never-scan-with-it warning to `src/cli/term/README.md`, the
  log viewer's `data-fill-viewport` requirement to `src/logging/README.md`. Upstream MIT/ISC
  attribution headers are left exactly as written: a licence notice is not prose.

- **`CODE_REVIEW.md` §3b gains a sixth detection command, and the five it had gain the `config/**`
  glob.** No command detected a long run of `//` lines at all, so the cap §5a form 3 puts on an
  inline _why_ — one or two lines — was unenforceable; and only the first command scanned `config/`,
  so `config/steps.ts`, the file with the most `//` runs in the repository, was read by nothing.

- **`src/app`'s markup assertions are exact.** Twenty-eight `toContain` calls on rendered HTML across
  `error-page.test.ts`, `app.test.ts` and `assets.test.ts` passed on the right substring with the
  wrong encoding around it — `toContain("&lt;script&gt;")` says nothing about what follows it. The
  `Forge` boundary's 500 document is short enough to assert whole; the styled error page is not, so
  each test extracts the one fragment carrying the message — `renderError`'s banner, the `<title>`,
  the `<link>`, the `<a>` — and asserts `toBe` on it, rendering once and asserting once
  ([`TESTING.md`](.decisions/governance/TESTING.md) §3b, §3c). The `not.toContain` leak checks stay:
  proving a secret appears **nowhere** in a document is not something an exact match can say.

- **Every gate check walks the filesystem through one module.** Twenty-two `readdirSync` walkers
  across twelve check modules disagreed on three axes — whether findings came back sorted, whether a
  Windows separator was normalised, and which files were excluded — and three of them were duplicated
  verbatim. `source-scan.ts` now exports `collectFiles`, `collectSource`, `listFiles` and
  `listDirectories`, and every check reaches the disk through them. **Finding order is sorted and
  path spelling posix-normalised everywhere**, which changes the order some checks reported in.
  `lineAt` and a `suppressedBy(marker)` factory join them, replacing four copies of the first and
  two character-identical copies of the second. The gate's OKLCh conversion composes its per-channel
  clipping over `assets/build`'s OKLab matrix and sRGB transfer function instead of restating them;
  the clipping behaviour, the strict alpha-rejecting parser and every pinned answer are unchanged.

- **A stale entry in the co-location exempt list now fails the check.** Nothing held an exemption
  against the modules actually walked, and the summary subtracted the list's length regardless — so
  a path left behind by a rename both under-reported the count and silently exempted nothing. The
  list can only shrink now, which is the rule the modern-CSS deferral list already followed.
  `namespace-graph` also stopped reading the 334 test files `buildGraph` immediately discards, and
  the modern-CSS check reads each file once rather than twice.

- **A `cf sync` list that 404s now reports `unavailable`, not `error`.** The four provisioning
  handlers — D1, KV, Queues, R2 — each hand-built the same ten-step ladder and their own list-failure
  row, so a not-found never became `unavailable`, no permission was ever named, and the row never
  said which surface it was compared against. They are now four specs over one
  `createProvisionedHandler`, and every list and create failure goes through the shared
  `failureRows`. **The detail text changes**: it gains the `worker script · ` / `pages project · `
  prefix, and an auth failure names the permission the surface needs.

- **`.dev.vars` values now follow dotenv's rules, which is what wrangler pushes.** An unquoted value
  ends at the first ` #`, so `API_KEY=abc123 # prod key` pushes `abc123` rather than the comment with
  it — the README's own rotation example was mis-parsed. `\n` and `\r` inside double quotes expand;
  single quotes stay literal; a quoted `#` is kept. Everything else is unchanged: the first-`=` split,
  full-line comments, the rotate markers, and the line index. `editDevVars` carries an inline comment
  across a rotation instead of dropping it.

- **`src/ui/chrome/navbar.tsx` is split at the item-tree / shell seam.** 496 lines became
  `navbar-items.tsx` (the config vocabulary and the recursive renderers) and `navbar.tsx` (the shell).
  A pure move: no renames, no signature changes, no change to the emitted markup, and
  `@y-core/forge/ui/chrome`'s exported names and shapes are unchanged. Both halves stay `.tsx`, so the
  conformance sweep over `chrome/*.tsx` keeps covering both. Code importing from the concrete module
  rather than the barrel takes the new path for the item types and for `filterAttrs`.

- **`.decisions/implementation/UI_SSR_COMPONENTS.md` §3h now carries a verdict for all nine `@utility`
  recipes.** `border-field`, `field-chrome`, `otp-cells` and `otp-editor` pass the admission test;
  `focus-ring` and `focus-ring-outset` are near misses on `state-invalid`'s shape. Every signature and
  scope behind those verdicts is pinned in `state-recipes.test.ts`, which is the only place in the
  repo that compiles the design system in a `bun test`.

- **Every optional prop forge accepts is now declared `?: T | undefined`.** Under
  `exactOptionalPropertyTypes`, a bare `?:` forced a consumer to write
  `{...(x !== undefined ? { "aria-label": x } : {})}` instead of `aria-label={x}` — and that spread
  is invisible to `jsx-a11y`, so forty-seven of forge's own attribute sites were unlinted. The
  renderer already treats an absent and an `undefined` attribute identically, so the distinction the
  flag guards does not exist here. Rendered HTML is unchanged. This is `@types/react`'s convention
  for the same reason.

- **The pressed paint shared by `Toggle`, `ToggleGroup.Item` and `Filter.Item` is one const,**
  `PRESSED_PAINT`, rather than the same `has-[:checked]:*` triple written three times. It cannot be
  an `@utility`: the class-group derivation flattens a recipe's nested declarations into a
  base-scope signature, so a paint recipe would subsume — and delete — the resting `bg-transparent`
  and `text-foreground` beside it. Recorded as an admission test in `UI_SSR_COMPONENTS.md` §3h.
  Dead `state-disabled focus-ring` tokens that `buttonVariants` already supplies are dropped from
  `ToggleGroup.Item` and `Filter.Item`; the rendered class sets are unchanged.

- **`Toggle` and `ToggleGroup.Item` take their border width from `border-field` like every other
  control.** Both hand-wrote `border`, which pins 1px and ignores `--border-width` — so a theme that
  moved the token moved four controls and left these two behind.

- **`toneTokens(tone)` returns the tone's declaration directly** instead of rendering the whole solid
  recipe through `cva` and `cn` and then filtering the paint back out by prefix. Same string, every
  tone, and a test now pins that equivalence for all seven rather than for `neutral` alone.

- **The empty `buttonPaint` recipe is gone.** Its twelve variant cells were all `""`; the two compound
  rules it existed for — `neutral/outline` and `neutral/ghost` — are now a two-entry lookup applied
  after `toneVariants`, where the override order they depend on is visible. `buttonVariants` output is
  unchanged, so its six call sites are unaffected.

- **`Dialog.Trigger`, `Dialog.Close`, `Drawer.Trigger` and `Drawer.Close` no longer drop an explicit
  `class=""`.** They tested the caller's class for truthiness, which discards an intentionally empty
  string along with an absent one; the test is now `!== undefined`.

- **`Drawer` slides in from its edge instead of appearing on the frame it opens.** 200ms in, 150ms
  out, with `display` and `overlay` riding the same duration so the panel stays painted for the whole
  exit, and the backdrop cross-fading with it. Behind `prefers-reduced-motion: no-preference`, so a
  reader who asked for less motion still gets the instant open. `<Drawer open>` — the non-modal panel
  in the page — is untouched.

- **`NumberField.Input` aligns its value to the end of the field.** Digits are compared down a column,
  not read left to right, so a number field belongs on the same alignment as a numeric table column.
  `text-end`, not `text-right`, so it mirrors in an RTL page; a caller's own `text-center` still wins
  on merge order.

- **The showcase's `Popover` band puts its triggers on a row of their own, spaced apart.** The
  `side=top` specimen opened over the band's note, which is exactly the thing a reader needs while
  looking at it.

- **The showcase's `Toast` band is one grid instead of three disconnected rows.** It was five loose
  toasts with no container, six position boxes each holding the same meaningless toast, and a
  `duration=600000` specimen nobody was ever going to watch elapse. The six boxes stay and now carry
  a tone each — neutral, success, warning, destructive, a dismissible info — so position and look are
  read in one pass. The sixth box runs the real behaviour: a dismissible `duration=5000` toast that
  the eager `toast` scope removes when it elapses, which the showcase puts back 2000ms later so the
  cycle is watchable. **The re-arm is showcase-only** (`show-toast-cycle`, in `ui/show`); `Toast`
  itself still removes a toast for good. The tone × appearance matrix is unchanged.

### Breaking Changes

- **`src/cli` and the build-time half of `src/assets` are now `src/tooling`, and eight subpaths are
  renamed.** `cli` named an _interface_ — a terminal — where the tree actually holds everything that
  runs on a developer's machine or in CI. The new container's membership _is_ the build-time
  exemption `LIBRARY_ARCHITECTURE.md` §1e states as reachability, so a Worker-reachable module under
  `src/tooling/` is now a visible contradiction rather than an argument to re-litigate per module.
  Pre-1.0, so there are no deprecation shims — update the import.

  | Was                             | Now                                                            |
  | ------------------------------- | -------------------------------------------------------------- |
  | `@y-core/forge/cli`             | `@y-core/forge/tooling/cli`                                    |
  | `@y-core/forge/cli/term`        | `@y-core/forge/tooling/term`                                   |
  | `@y-core/forge/cli/cf`          | `@y-core/forge/tooling/cf`                                     |
  | `@y-core/forge/cli/assets`      | `@y-core/forge/tooling/assets`                                 |
  | `@y-core/forge/assets/build`    | `@y-core/forge/tooling/assets`                                 |
  | `@y-core/forge/cli/pkg`         | `@y-core/forge/tooling/gate` + `@y-core/forge/tooling/release` |
  | `@y-core/forge/cli/pkg/lint`    | `@y-core/forge/tooling/lint`                                   |
  | `@y-core/forge/assets/manifest` | `@y-core/forge/assets`                                         |

- **`@y-core/forge/assets` is now runtime-only, and is the subpath a Worker imports.** Its barrel
  published `loadConfig`, which imports `node:path`, so the name promised Worker-safety the module
  could not keep. It now exports `createManifest` and `createSpriteRegistry` and nothing else; the
  config authoring surface (`defineAssetsConfig`, `loadConfig`, `AssetsConfigSchema` and the config
  types) moved to `@y-core/forge/tooling/assets` beside the pipeline that reads it. The generated
  `.forge/assets.ts` now imports `@y-core/forge/assets`; regenerate it with `forge assets build`.
  `tests/fixtures/workers-consumer/worker.ts` is the new guard — a Node built-in reached through a
  runtime subpath fails to typecheck there.

- **`@y-core/forge/cli/pkg` is split three ways.** One ~200-name barrel fused the verification gate,
  the oxlint plugin and the release workflow, with a real import cycle between the first two. The
  rule catalogs `RULE_CORPUS_PATH` / `RULE_ENFORCER` and `MODERN_CSS_RULES` now live in
  `@y-core/forge/tooling/lint`, which the gate reads one-way; the changelog and semver parsers live
  in `@y-core/forge/tooling/gate`, which `@y-core/forge/tooling/release` builds its workflow on and
  never the reverse.

- **`forgeUiSpriteSources()` moved off `@y-core/forge/ui/assets` to the new
  `@y-core/forge/ui/assets/build`.** It imports `node:path` and `node:url`, and a bundler resolves
  before it tree-shakes, so importing the parent barrel for the glyph names alone failed under
  `esbuild --platform=neutral`. The parent barrel is now runtime-neutral. The same subpath took the
  four compute-not-orchestrate modules `ASSET_AND_BUILD_TOOLING.md` §2c named as debt — the OKLCh
  conversion, the theme-token reader, the cursor baker and the SVG-symbol half of the sprite
  builder. `buildSprites` itself stayed in `tooling/assets`: it fetches, hashes and writes, which is
  orchestration by §2c's own rule.

- **`oklchToSrgb` is no longer exported from `@y-core/forge/assets/build`.** It was a second copy of
  a policy that already had a home: the same 20-iteration chroma-reduction bisection, the same
  `l >= 1` / `l <= 0` short-circuits and the same epsilon as `toSrgbGamut` in
  `ui/contracts/theme/color.ts`, which `THEME_GENERATION.md` §2b names as the owner of the arithmetic.
  It now calls `toSrgbGamut` and converts the mapped coordinate; the private `inGamut` and
  `GAMUT_EPSILON` are gone, and `clip01` stays because `toHex` also uses it. **Every pinned answer in
  `assets/build/color.test.ts` and `ui/contracts/theme/color.test.ts` is unchanged**, including the
  hue sweep that cross-checks the two implementations against each other — that sweep reaches the
  function by deep path, not through the barrel, which is what makes the barrel removal safe and
  keeps it as the proof. **Migration:** no caller exists in the fleet; the two internal callers
  (`parseColor`'s `oklch(…)` branch and `parseColorMix`'s `in oklch` branch) are unaffected. Anyone
  needing the conversion should reach for `toSrgbGamut` plus `oklabToLinearSrgb`, which is what the
  function now is. §2b is corrected accordingly: the chroma reduction was never a second policy, only
  a duplicate. The one genuinely separate policy is the gate's `oklchToPaintedHex`, which clips per
  channel because a browser does.

- **`Pagination` no longer accepts a root `size`; pass it to the children.** The prop was inert: it
  stamped `data-size` on the `<nav>`, which nothing reads — no CSS selector, no controller — while
  every child (`.Item`, `.Previous`, `.Next`) carries its own `size` and defaults to `sm`
  independently. `<Pagination size='lg'>` therefore changed an attribute and painted nothing, and
  `Carousel.Dots` was forwarding it. The root now takes no `size`, the convention `ToggleGroup`
  already sets, and `Carousel.Dots` keeps the per-item `size` — the one that works. **Migration:**
  move `size` from the root onto the items, which is where it always took effect. `.Ellipsis` also
  moves from `h-control-sm w-control-sm` to `size-control-sm`, matching `STEP_MARKER`.

- **`store.serveObject` returns `Promise<Result<Response>>`.** It was the only one of `ObjectStore`'s
  six operations not wrapped in `result()`, against its own interface TSDoc claiming _every_
  operation returns a `Result`: it caught everything and answered a bare `500` with a `null` body and
  nothing logged, so a bucket outage was indistinguishable from a bug. A key rejected by
  `normalizeKey` now carries the same `{ ok: false, error }` the store's other operations do, instead
  of a bare `400`. **No `logger` option is added** — a store reports a fault by returning it. The
  free `serveObject(backend, …)` still returns a bare `Response`: a `404` or a `416` is a rendered
  failure, not an absent value. Callers unwrap: `served.ok ? served.data : …`.

- **`oklabToLinearSrgb` and `srgbGamma` move barrels: `assets/build` → `ui/contracts/theme`.** The
  twelve-coefficient OKLab matrix and the sRGB transfer function were written out three times — in
  `ui/contracts/theme/color.ts`, in `assets/build/color.ts`, and by import in the gate's contrast
  check — which is three places to drift while every test kept passing. `ui/contracts/theme` is LEAF,
  and LEAF constrains outgoing edges only, so it is the one of the three that can hold the shared
  function; the other two import it. Import from `@y-core/forge/ui/contracts` (or the `theme` module
  directly), not from `assets/build`. **Both gamut policies stay:** the generator reduces chroma at
  constant lightness and hue per CSS Color 4, the gate clips per channel because a browser clips.

- **A stream that is not a terminal now gets no colour, whatever `TERM` advertises.**
  `resolveColorLevel` consulted `isTTY` only in its last-but-two rule, so `COLORTERM=truecolor`,
  `WT_SESSION`, kitty/ghostty/wezterm, iTerm and any `-256color` `TERM` all answered above zero for a
  redirected stream — and `cli/core/execute.ts`, which passes `process.stdout.isTTY === true`
  precisely so "the redirected stdout stays clean", got escape sequences written into the file. The
  check now sits between the CI branch and the first advertisement: **CI runners are never TTYs**, so
  a GitHub Actions or CircleCI log keeps its truecolor, and `FORCE_COLOR` still overrides everything.
  A caller that omits `isTTY` is unaffected — the gate is `=== false`, not falsy.

- **`TruncateResult` gains `index`, the offset in the input the cut was made at.** `truncate` already
  computed it and threw it away, and `wrapLines`' hard break had no way to ask: it sliced by
  `text.length`, which includes a reset `truncate` appends whenever the head bears an escape, so a
  styled word broken across lines **lost four visible characters at every break**. Any code
  constructing a `TruncateResult` literal, or asserting one with `toEqual`, adds the field.

- **`stripComments` is removed from the `cli/pkg` barrel and `blankComments` moves to
  `gate/checks/source-scan`.** The two were near-duplicates of `blankSourceComments` that differed
  only in being wrong: `stripComments` collapsed a block comment to one space, destroying the offsets
  its callers computed line numbers from. Call `blankSourceComments` for TS/TSX and `blankComments`
  for CSS, which is block comments only — `//` is not a comment there.

- **A sprite symbol's root presentation attributes are emitted on a wrapping `<g>`, not injected per
  shape.** `svgToSymbol` copied the root `fill`/`stroke`/`stroke-*` onto every shape element, which
  overrode an enclosing `<g>`'s own value — `<svg fill="none"><g fill="red"><path/></g></svg>` emitted
  the path as `fill="none"` — and, because the shape-name alternation had no trailing boundary, also
  rewrote `<linearGradient>` as if it were `<line>`. The attributes now sit once on a wrapper `<g>`
  (sharing the node with the viewBox translate when there is one, and omitted entirely when there is
  neither), so SVG's own inheritance resolves nested overrides. **Emitted sprite and cursor markup
  changes**: an icon with root attributes gains one `<g>` inside its `<symbol>`. Rendering through
  `<use>` is unaffected; CSS selecting descendants of a symbol by element still matches, but a
  selector depending on the attribute being _on the shape_ does not. `propagateRootAttrs` is removed
  (it was never exported from the `assets/build` barrel); `extractRootAttrs` now requires an
  attribute boundary, so a root `data-stroke="…"` no longer contributes a `stroke`.

- **A cursor token that resolves to an unparseable colour now throws instead of baking black.**
  `buildCursors` mapped a `parseColor` failure to `#000000` while a _missing_ token already threw, so
  a malformed value shipped a black cursor with no diagnostic. Both parse-failure paths (the
  `data-cursor-token` signal and `cssvar()`) now throw
  `[forge-assets] cursor "…" token "…" resolved to an unparseable colour: …`. The `#000000` **default**
  for a cursor that declares no `data-cursor-token` at all is unchanged.

- **`JSXElement` is branded with a private symbol, and an unrenderable tag now throws.** The brand was
  `$jsx: true`, a plain JSON value, so any `JSON.parse`'d object satisfied `isValidElement` and
  `renderToString` emitted its `type` verbatim as the tag name — `{ "type": "img src=x onerror=…" }`
  walked past escaping, `safeUrl` and the attribute-name regex. The brand alone does not close it,
  because `createElement` is public and takes an arbitrary tag string, so `renderToString` also tests
  the tag against `/^[A-Za-z][A-Za-z0-9-]*$/` and throws `Invalid JSX tag name: "…"` on a failure (the
  app's error boundary turns that into its own 500). `JSXElement` can no longer be satisfied by an
  object literal — construct elements with `createElement` or the JSX transform. `cloneElement` is
  unchanged: object spread copies enumerable symbol keys.

- **`head` is removed from `@y-core/forge/router`.** `Forge.fetch` rewrites a `HEAD` request into a
  derived `GET` before dispatch and `dispatchMatches` compares `route.method` strictly, so a route
  declared with `head(...)` could never match — the export advertised a shape that does not work.
  Nothing in forge used it. The `HEAD` branches inside `assets.ts` and `csrf.ts` stay: they encode
  HTTP method semantics for a unit that may be composed onto a bare `createRouter`.

- **The derived `GET` is copy-constructed, and the discarded body is cancelled.** `Forge.fetch` built
  the internal GET from url + headers, which dropped `signal`, `cf`, `redirect` and `credentials` —
  a handler could not observe a client disconnect and Cloudflare's request metadata was invisible.
  It is now `new Request(request, { method: "GET" })`, safe because the branch is guarded by `isHead`
  and a HEAD request carries no body. Both HEAD returns also `await res.body?.cancel()` before
  answering, instead of abandoning the stream.

- **A guard group registers each guard once, not once per path — and `Forge.use` accepts an array.**
  `applyMiddlewareChain` looped `for (path of group.paths)` and registered a fresh `originProtection`,
  `rateLimit` and `middleware[]` per path, so a group naming two overlapping patterns (`/api/*` and
  `/api/users`) ran two limiters against one request and halved the effective budget. The group's
  paths now compile into one matcher — a single path keeps today's `createMatcher` fast path, several
  use a `MultiMatcher`, `"*"` stays the catch-all, and an empty array registers nothing. `Forge.use`
  is widened to `(path: string | readonly string[], …)` rather than gaining a private registration
  path, so there stays one documented way to register, and `MiddlewareGuardGroup.paths` is now
  `readonly string[]`. Registration order changes from path-major to guard-major.

- **`PageDefinition` is a schema-gated union, and `definePage`'s `cache` no longer clobbers a
  response's own.** A page could state `honeypot`, `turnstile`, `onBotDetected`, `onValidationError`
  or `maxBytes` without a `schema`: with no schema there is no pipeline, so the options were accepted
  and silently ignored — a declared bot guard that never ran. The type is now `PageBase &
({ schema: S } & PagePipeline | { schema?: never } & { [K in keyof PagePipeline]?: never })`, the
  forbidding arm a mapped type over the same projection, and `definePage` also throws at registration
  naming the stated keys, because the union's own diagnostic is not actionable. The key list lives
  once, as `PIPELINE_ONLY_KEYS` in `pipeline.ts`. Separately, the configured `cache` is now applied
  only to a response carrying no `cache-control` of its own — a redirect or a `no-store` refusal kept
  its own header before being overwritten with the page's, which made a one-off response publicly
  cacheable. `headers` is still applied last and still wins, and the header is computed once at
  definition time rather than per request.

- **`formatValidationIssues` is removed, because it leaked the rejected value into every log.** It
  reproduced `issue.message`, which valibot interpolates the rejected value into — a schema like
  `v.regex(/^sk_live_/)` produced `Expected /^sk_live_/ but received "sk_test_SECRET"`. That string
  was the env validator's throw, so it reached `reqLog.error`, the app logger, the KV log channel
  (whose `toPersistable` strips only `stack`) and the `isDebug` 500 body: a malformed secret written
  verbatim on every request, against `BOUNDARIES` §4a. A published export whose own README said
  "never put its output in a response" was a trap on the public surface. Env validation now renders
  `field: reason` from `issue.type` — `Invalid environment: DATABASE_URL: missing`,
  `Invalid environment: API_KEY: regex` — a closed valibot vocabulary carrying neither the value nor
  the schema's text, and `issue.expected` stays out because it can be a `v.regex` source. Fixing it
  at the renderer fixes all four sinks; `describeValidationIssue` is unchanged.

- **`cors()` marks `Vary: Origin` on refused and no-`Origin` responses too.** Only the allowed branch
  carried it, so a shared cache could store a refusal — no `Access-Control-Allow-Origin`, no `Vary` —
  and replay it to an allowed origin, which is the CORS-defeating direction. The rule is whether the
  middleware's output depends on `Origin`, and it does on both branches. **The cost, stated plainly:**
  a non-wildcard `cors()` now rebuilds every response, where the refused path previously returned the
  downstream response untouched. Conversely, `origins: ["*"]` **without** credentials now emits no
  `Vary` and leaves a downstream one alone: the ACAO header is the constant `"*"`, so marking `Vary`
  only shredded the cache key. The allowlist, the preflight header object and the `join`s are all
  computed once at `cors()` time — `matchOrigin` is now one call into the same compiled matcher — and
  `createSecurityHeaders` renders its CSP from a template computed once, substituting only the nonce.

- **`verifySignedObjectUrl` returns forge's one `Result`.** `SignedUrlOk`/`SignedUrlError` are
  replaced by `SignedUrlFailure` (the three reason codes) and `SignedUrlVerdict =
Result<string, SignedUrlFailure>`, with the object key as `data` directly — a one-field success
  object beside a `data` channel was two wrappers for one value. Read `verdict.data` where you read
  `verdict.key`, and `verdict.error` where you read `verdict.reason`; the storage README example also
  stops echoing the reason code to the client, which `ERROR_HANDLING` §1c already forbids.
  `planRotation` (`@y-core/forge/cli/cf`) likewise returns `Result<string[], RotationRefusal>`, its
  two failure fields collected under `error`, and `parseChangelog`/`promoteUnreleased`
  (`@y-core/forge/cli/pkg`) return `ValidationResult<ChangelogDocument>` and
  `ValidationResult<string>` — the parse's `unreleased`/`versions`/`linkRefs` now sit under `data`
  as the new `ChangelogDocument`, and its `errors` arm is the standard `error`.

- **`bindingSchema(name, methods, label)` is exported from `@y-core/forge/context`.** The KV, D1 and
  R2 binding validators each carried a copy of the same `v.object`/`v.check` shape; each is now one
  line, with the rejection messages byte-identical. `label` carries the article ("an R2 bucket
  binding") rather than being derived from the first letter, which is a bug the day a `Hyperdrive`
  binding is added.

- **`serveObject` owns a range contract, and `ObjectStorageBackend.get` now has a throw contract.**
  A `Range` whose first-byte-pos exceeds `Number.MAX_SAFE_INTEGER` is answered `416` with **no**
  backend call, and an oversized last-byte-pos or suffix clamps to the whole object (RFC 9110): what
  reached `R2GetOptions` before was `Infinity`, which R2 answers with a `TypeError` — a 500 for a
  client's malformed header. A backend that cannot satisfy a range throws the new `@public`
  `UnsatisfiableRangeError` (`@y-core/forge/storage/r2`), which `r2Backend.get` translates the
  platform error into and which `serveObject` catches — **only** that type — spending a `head` on
  that path alone, so a satisfiable ranged read stays one round trip. `serveObject` also now emits
  `Content-Encoding` and `Content-Language` (stored by `r2Backend` and silently dropped before),
  falls back to the object's stored `Content-Disposition` when no option overrides — dropping one
  that carries a non-ASCII byte rather than throwing from `Headers.set` — and sets
  `X-Content-Type-Options: nosniff` unconditionally. Both pre-existing 416 branches now cancel the
  body they abandon.

- **`ObjectStore` listing, prefixes, bodies and prototype keys.** Four defects, one namespace:
  `r2Backend.list` now passes `include: ["httpMetadata", "customMetadata"]`, without which a list is
  silently lossier than a `head` of the same key under the default `r2_list_honor_include` flag
  (`R2ListOptions` gains `include`; `StoreListOptions` deliberately does **not**, since a caller who
  could switch it off would get this bug back). `store.list` strips the store prefix from
  `delimitedPrefixes` too — a page mixed stripped keys with unstripped folders, and a returned prefix
  fed back into `list({ prefix })` double-prefixed. `store.get` re-keys the object by re-declaring
  its getters instead of spreading it: the spread **read** `body` and `bodyUsed`, freezing
  `bodyUsed: false` forever and, on a real `R2ObjectBody`, locking the stream. And `inferContentType`
  guards with `Object.hasOwn`, so `"upload.constructor"` no longer returns the `Object` function —
  which, being non-nullish, skipped the `?? CONTENT_TYPE_DEFAULT` fallback and sent a non-string
  `contentType` to `bucket.put`.

- **The storage fakes now refuse what the platform refuses.** A fake that is green where the real
  binding throws certifies code that fails on deploy. `fakeKV.put` throws below KV's 60-second
  `expirationTtl` floor and accepts an `ArrayBufferView` or a `ReadableStream` (which also widens
  `KVNamespaceLike.put`); `fakeR2.get` throws `UnsatisfiableRangeError` for a range lying wholly
  outside the object, while still clamping an overrun — which is what R2 does; `fakeR2.list` honours
  `delimiter` and `include`; and `fakeD1.first(column)` rejects a column the row does not carry
  instead of returning `undefined` against a declared `T | null`. TTL _expiry_ is still not modelled:
  that would need a clock, and `TESTING` §7b's no-wall-clock rule stands.

- **KV log keys changed format, and the viewer opens on the newest page.** It opened on the
  **oldest**: KV lists lexicographically with no reverse option, and the key led with an ISO
  timestamp. Keys are now `{prefix}||v2||{999999999999999 - ms, padded to 15}||{rand}`, so
  lexicographic order is newest-first. `purge` slices the **tail** accordingly —
  `keys.slice(maxLogs)`, where the old code would have deleted exactly what is worth keeping. The
  list prefix carries `v2` because an old key's third segment starts with `2` and a new one with `9`,
  so under one prefix every legacy record would sort above every new one; **existing entries stop
  listing and expire by their TTL** (7 days by default), which is why there is no migration shim.
  Filtering remains per page — a paging loop would issue unbounded billed `kv.list` subrequests in
  one invocation — but the empty state now says so when a further page exists, instead of claiming
  no matches.

- **KV log metadata is capped in bytes, not UTF-16 units — and `LogRow.level` is `LogLevel`.**
  `JSON.stringify` expands a C0 control character to six bytes, so a 256-character message serialized
  to roughly 1620 bytes, KV rejected the `put`, and the record was **lost**; the test stub did not
  enforce the limit, which is why three 256-character tests could not catch it. The channel now
  measures the serialized metadata and shrinks in a fixed order — message, then prefix (previously
  uncapped), then `requestId` — flooring at `{ level, timestamp }`, and truncates by **code point**
  rather than `String.slice`, which would split a surrogate pair into a lone surrogate costing six
  escaped bytes. The code-point count is binary-searched, so the hostile input this exists for costs
  about nine `stringify` calls rather than 256. Nothing is lost: the full record still goes into the
  KV **value** (25 MiB), so the detail view is unchanged — only the row preview truncates.
  `KvLogMetadata.prefix` and `.message` are now optional (absent only at that floor), and
  `LogRow.level` is `LogLevel`, narrowed once at the trust boundary with the already-present
  `parseLogLevel`; `LEVEL_TONE` is a total `Record<LogLevel, Tone>` and its `?? "info"` is gone.

- **The gate runner can no longer report a skipped step as passed.** `StepSkip` and `Step.skip` are
  removed; a step declares one `StepRequirement` under `requires`, and what its absence means is the
  mode's answer: a fast run prints `○ <label> — skipped (<tool> not found; run \`<hint>\`)`and a`--full`run fails the step with the same hint. That closes two holes at once — the summary counted
a skipped step in`N steps passed`, and `--full`, which `prepublishOnly`runs, honoured`skip`and
so published without the drift checks ever running.`SummaryInput`now carries`passed`, `skipped`and`failedAt: { label, at }`in place of`ran` and a bare label; the failure line states a position
(`step 3 of 7`) rather than a run count, and a run whose every selected step was skipped is red:
`✗ verify — every step skipped (0 of 3 ran, …) — refusing to report a green gate that ran nothing`.
`formatSkipped`is merged into`formatMissingRequirement(label, tool, hint, mode, style?)`,
`listLabel(step, mode)`reads`requires.tool`directly, and`formatFixSummary`takes`{ gate, fixed, unfixable, skipped }`— "skipped" now means _dependency absent_ gate-wide, and a step
with no fixer is counted as having none. The`--full`requirement line is byte-identical to before.`selectSteps`loses its prerequisite refusal, whose invariant is now true by construction, and its`only`parameter narrows to`readonly string[]`.

- **`ContrastCheckConfig.palettePath` is now `() => string`.** Resolved eagerly, it threw while the
  step-table module was being imported on a machine without `tailwindcss` — before any step ran and
  before the skip could be reported. A thunk defers it past that point and keeps
  `import.meta.resolve` in the consumer's `config/steps.ts`, where it finds the consumer's copy.

- **`StepOptions` gains `requires?: StepRequirement | null`**, replacing a step's default dependency
  or, with `null`, dropping it — for a project that vendors the dependency. The four design-system
  steps (`classGroupsStep`, `designScaleStep`, `classTokensStep`, `cssTokensStep`) and `contrastStep`
  now default to a `tailwindcss` requirement rather than a `skip`; `contrastStep` attaches it only
  when it was given a `palettePath`. The `{ hint?: string }` option those builders briefly carried is
  gone with the change — `browserStep` keeps its own.

- **Correction to released entries.** The 0.1.1 notes state that `classGroupsStep`, `cssTokensStep`,
  `designScaleStep` and `classTokensStep` are "`--full` only". They are not, and were not at release:
  each runs in every mode where `tailwindcss` resolves, and is skipped in a fast run without it.
  Released headings are frozen by `validate-changelog`, so the correction is recorded here rather
  than edited into them.

- **`SpeedDial` is removed from `@y-core/forge/ui/core`,** along with `SpeedDialPlacement`. A floating
  action button earns its place only on a screen that has neither a toolbar nor a primary `Button` in
  its header — a shape the primitive set does not target — and its `asChild` action could never close
  the panel, because an invoker `command` is honoured on a `<button>` and silently ignored on an `<a>`.
  A consumer that wants the pattern composes it from `Popover` and `Button` rows, which is the same
  markup `SpeedDial` emitted. The `forge-ui-interaction-fab-one-primary` design rule is withdrawn with it.

- **`HONEYPOT_FIELD_DEFAULT` is now `"__hp_c7"` (was `"__surname"`).** A decoy named `__surname`
  matches the browser's own autofill heuristics, which ignore `autocomplete="off"` for name and
  address fields — the browser filled the decoy for any user with a saved profile and the submission
  was refused as a bot, invisibly and with no way to recover. The new default matches no heuristic.
  An app that hardcoded the old string on either side, rather than importing the constant, updates
  both halves together; an app already passing its own name — as `src/form/README.md` recommends —
  is unaffected.

### Fixed

- **The shape-token count is eight, not seven, everywhere it is stated.** `theme-base.css` declares
  `--radius`, `--radius-field`, `--radius-box`, `--radius-selector`, `--control-h-sm/md/lg` and
  `--border-width`; four places counted the three `--control-h-*` tokens as one and said "seven" —
  `shape-compact.css`'s own header, `src/ui/README.md`, and
  [`THEME_GENERATION.md`](.decisions/implementation/THEME_GENERATION.md) §1d in three places. The
  showcase already said eight, so a reader comparing the two surfaces got a contradiction about the
  one set a consumer re-declares in full.

- **A prerelease tag no longer disables the release guard.** `git tag --sort=-v:refname` puts
  `v1.0.0-rc.1` _above_ `v1.0.0` without `-c versionsort.suffix=-`, and `getLatestTag` returned
  whatever was first. `parseSemVer` rejects it, so the auto path threw an opaque parse error and —
  worse — the explicit path's not-greater guard, written `prev !== null && …`, went **vacuous**: a
  downgrade to `0.9.0` against a tagged `1.0.0` was waved through. `getLatestTag` now returns the
  first listed tag the release scheme accepts, and `resolveVersion` parses the tag once, up front,
  and **fails** on one it cannot read rather than skipping the comparison.

- **The oxlint plugin now judges a class list bound to a module-scope `const` and passed by name.**
  It read only inline literals and bare `cn`/`cva`/`asClass` arguments, so forge's own recipes —
  written once as a constant and passed by identifier — were invisible to every class rule. An
  initializer that is already a class position of its own is still judged only where it is written,
  and a `const` declared inside a function is not resolved. `color-token-only` gained the `--tone*`
  properties as declared, since `tone.ts` sets them with `[--tone:…]` utilities that never reach the
  compiled stylesheet's `@theme` and so cannot appear in the generated scale. **Class lists passed
  by name are now judged**, which can newly fail a file that has always been green.

- **`forge/color-token-only` no longer reports the shadow family as an undeclared colour.** Tailwind
  compiles a bare `shadow-(--shadow-lg)` to `--tw-shadow: var(--shadow-lg)` — the shadow value, not
  a colour — so `shadow`, `inset-shadow`, `drop-shadow` and `text-shadow` are colour positions only
  in their explicit `(color:--x)` spelling, which the rule's pattern does not match. `ring-`,
  `outline-` and `border-` are genuine colour positions and still judged.

- **`forge/spacing-scale-only` suggested the wrong sign for a negative arbitrary length.** It took
  the magnitude of the value and re-used only the utility's own `-` prefix, so `mt-[-16px]` was told
  to become `mt-4` and `-mt-[-16px]` `-mt-4` — both the opposite of what Tailwind compiles. The
  suggestion's sign is the exclusive-or of the two now.

- **`forge/platform-logical-spacing` reported utilities that do not exist.** Its value class stopped
  at `(`, `%` and `)`, so `mr-[calc(100%-1rem)]` was reported as `mr-[calc` → `me-[calc` and
  `border-r-(--w)` as `border-r-` → `border-e-`. The whole arbitrary value is carried through now.

- **`validate-docs` no longer blanks a wrapped citation as if it were code.** Any line indented four
  spaces was treated as an indented code block, with no blank-line-before and no list-context test —
  so a citation wrapped onto a continuation line and a nested `    - …` bullet escaped _every_
  downstream check: section parsing, the rot scan, link-target existence, inter-document citations
  and path resolution. Indentation is read as code where CommonMark says so now: after a blank line,
  outside a list, running on until a line starts back at the margin. `NAMESPACE_DESIGN.md`'s wrapped
  `§5c` citation is checked against its target's sections for the first time.

- **A trailing `// note` in `.oxlintrc.json` no longer fails `validate-design` with "could not be
  read".** Its JSONC strip dropped whole comment lines only, so a comment after a value left
  `JSON.parse` to throw and the step reported the config as unreadable rather than reading it. It
  uses `stripJsonc`, which is what the `cf` config writer already parses JSONC with.

- **`validate-design` now catches a hand-written `data-busy`.** Its state-attribute alternation was
  hand-listed and had never gained `busy`, which `ui/contracts` has declared since the attribute
  shipped. The alternation is derived from `stateAttrs` itself now — a presence flag is what it
  emits with an empty value — over a `Required<StateAttrsProps>` literal, so a state key added to
  the contract without a decision here fails to typecheck rather than going silently unchecked.

- **`focus-visible:ring-0` and `focus-visible:ring-offset-2` no longer count as a replacement focus
  ring.** The rule's first alternative was an unbounded prefix, so any `focus-visible…:ring…`
  satisfied it — including a zero-width ring and an offset that carries no width of its own.

- **`validate-contrast` no longer rounds a ratio before comparing it to the floor.** A pair
  measuring 4.4951:1 passed a 4.5:1 floor in the gate while the theme customiser, which compares the
  raw value, showed it red — the disagreement `THEME_GENERATION.md` §3c exists to forbid. The
  comparison is unrounded; `toFixed(2)` is still what the message prints. **A pair within 0.005 of a
  floor now fails.**

- **Only the first `:root` block of a stylesheet was read.** A second one's declarations were
  invisible to the audit even though the cascade paints them; every top-level `:root` is read now,
  in source order, with a later declaration overwriting an earlier. The block-matching regex also
  escaped only the first `.` of a selector.

- **`.dark-overlay` is no longer read as a `.dark` mode block.** The declaration-site rule keyed on
  `\.dark\b`, which a hyphenated class name satisfies.

- **A `/*` inside a string literal no longer blanks the code up to the next real comment.** Every
  gate parser reached its source through one bare `source.replace(/\/\*[\s\S]*?\*\//g, …)`, which
  cannot tell a comment opener from the same two characters inside a string. `theme-contract.ts`
  opens a string with `"/* Generated by the forge theme customiser.` and closes it seven lines
  later, so `validate-modern-css` had been reading that span as a comment and finding nothing in it.
  `blankComments` and `blankSourceComments` are now one pass that tracks strings and comments
  together, so neither can start inside the other, and `css-parse` and all four of `barrel-parse`'s
  `//` passes route through it — a block-commented `export` no longer counts as live, and a line
  carrying `https://` no longer loses its tail. **Previously-passing files may newly fail**: the
  parsers now see code a string-borne `/*` used to hide.

- **`findThemeTokens` reported the wrong line after a multi-line comment.** Its stripper replaced
  each block comment with a single space, so every line number computed from the stripped text
  shifted by the comment's height. The blanking is space-for-space and line-preserving now, which is
  what makes the reported line the line the token is written on.

- **A JSX-text apostrophe no longer hides every element after it from `findSlotClobbers`.** Its
  `skipQuoted` had neither a newline bail-out nor a fallback, so `<p>Don't close this</p>` scanned
  forward to the next `'` anywhere in the file — and an unterminated string returned the file
  length, silently ending the scan. A `'` or `"` that reaches the line end is now read as data, and
  one is treated as a string opener only inside a tag or an expression container.

- **`cf sync --commit` can write an id into a single-line entry that already ends in a comma.**
  `applyJsoncEdits` appended `, ` unconditionally in that branch, over an offset already past the
  existing comma, so `{ "binding": "CACHE", }` became `,,` — text `writeWranglerConfig`'s round-trip
  check refuses, reporting a bug in the writer. Because the resource is created on Cloudflare before
  the write, every re-run matched it by name and scheduled the same doomed edit; the id never landed
  without hand-editing. The same function's CRLF probe indexed the outer source with an offset into
  the object's interior, so an empty multi-line object in a CRLF file gained an LF — a change no
  round-trip check catches, since the text parses identically.

- **`cf sync` no longer writes `queue_id` into the wrangler config.** wrangler 4.124.0 validates
  `queues.producers` against `binding`, `queue`, `delivery_delay` and `remote`, so every run after a
  queue sync warned `Unexpected fields found in queues.producers[0] field: "queue_id"`. The field is
  still **read** — a config that already carries one resolves by id and a stale id is still named on
  its row — and the remote id still appears in the report; nothing forge writes will carry it again.

- **A `sync zone` phase that was never written no longer reports `updated`.** The commit loop skips
  an in-step phase without ever PUTting it, but a run-scoped `committed` flag was passed to every
  row, so a different drifted phase writing successfully relabelled the untouched one. The write is
  now recorded on the phase it belongs to. The `--json` output was never affected.

- **A rejected secret write no longer reports the secret as absent.** `remote` conflated "the write
  succeeded" with "the name is present remotely", so a failed PUT or PATCH against a secret the
  listing had just returned rendered `Remote: no` while the old value sat untouched on the remote.
  The Pages branch was the worse case: one rejected PATCH marked every batched write at once.

- **`cf gen env` no longer corrupts a comma before a bracket inside a string.** It stripped comments
  with a gen-local copy of `stripJsonc` and then bolted on the string-unaware
  `/,(\s*[}\]])/g` trailing-comma regex the shared parser was rewritten to eliminate, so a
  `CSP_TEMPLATE` containing `, ]` was silently rewritten while `loadWranglerConfig` read it intact.
  `readWranglerConfig` is now the shared `stripJsonc` and the gen-local copy is deleted; it was never
  exported from `mod.ts`.

- **`cf gen env` recognises every `.dev.vars` key the rest of the tool does.** `collectVars` matched
  only `/^[A-Z_][A-Z0-9_]*=/`, so `STRIPE_KEY = x` and `lower_key=1` — both accepted by dotenv, by
  wrangler and by this repo's own `parseDevVars` — were absent from the generated `EnvSchema` and the
  app booted with a var no schema knew about. It now calls `parseDevVars`, and `emit` quotes a name
  that is not a valid identifier so the generated module still parses.

- **`sanitizeSVG` strips an event handler written with whitespace around its `=`.** The `on*` rule
  required `=` to follow the attribute name immediately, so `<circle onclick = "evil()"/>` came back
  unchanged — while the `href` rule one line above already allowed the spacing. The two patterns now
  agree. The gap survived because the tests asserted `not.toContain("onclick")`, which passes against
  markup that still carries `onclick = "evil()"`; every markup assertion in `sprites.test.ts`,
  `cursors.test.ts` and `site.test.ts` is now an exact match on the whole emitted string.

- **Every `currentColor` in an icon source is resolved before rasterising, not just the first.**
  `buildIcons` used a string-pattern `replace` for the bytes it hands `sharp`, so an icon setting both
  `fill="currentColor"` and `stroke="currentColor"` reached sharp with the second unresolved and
  rendered it black. `favicon.svg` was never affected — it goes through the `<style>` injection.

- **`parseColor` accepts 3- and 4-digit hex.** `#fff` parsed as `null`, which mattered because
  Tailwind v4 emits short forms (`--color-white: #fff`) and `buildCursors` mapped the null to black.
  Each nibble is now doubled before the existing parse, so `#abc` reads as `#aabbcc` and `#abcf` as
  `#aabbccff`.

- **The `_headers` cache rule follows `paths.publicPrefix`.** `emitHeaders` wrote a rule for the
  literal `/assets/*` and was never handed the configured prefix, so a build with
  `publicPrefix: "/static"` shipped an immutable-cache rule matching none of the hashed URLs the
  manifest resolves. The rule path is now the prefix, normalised the same way `createManifest`
  normalises it (one trailing slash stripped, so `"/"` degrades to `/*`), which is what keeps the
  build-time rule and the runtime URL from disagreeing. Builds on the default prefix are unaffected.

- **A second CSS entry no longer deletes the first one's emitted file.** `buildCSS` purged _every_
  `.css` in the output directory before each build, and both `buildAll` and the `assets css` CLI
  command loop every `css[]` entry into the same public directory — so `css: [{ output: "styles.css" },
{ output: "print.css" }]` left the manifest naming two hashed files and only `print.<hash>.css` on
  disk, making `assets.path("styles.css")` a production 404. The purge is now restricted to the
  entry's own output stem, the same shape `buildSpriteGroup` already used, and it skips dotfiles.
  **Known limit:** a `.css` left behind by a config entry that has since been _removed_ is no longer
  swept — that is a `clean` command's job, not a per-entry builder's.

- **`Slider` no longer lets the class sorter resolve `cursor-pointer` against `state-busy`.** Both sat
  in one bare string literal, and `state-busy` paints `cursor: progress` conditionally — the exact
  shape [`UI_SSR_COMPONENTS.md`](.decisions/implementation/UI_SSR_COMPONENTS.md) §3h forbids, and
  which `Toggle` already handled correctly. `cursor-pointer` now travels in its own `cn` argument,
  where cross-argument precedence is what §3e guarantees a sorter cannot reach.

- **`Link` renders a focus indicator again.** Its base class was the typo `focus-ring-outset-outset`,
  which matches no `@utility`, so every `Link` in the library had `outline-none` and nothing put back.
  The `validate-design` focus-ring check did not catch it because that check only looks at class
  strings also carrying `cursor-pointer`; its `FOCUS_VISIBLE_RING` pattern additionally rejected the
  legitimate `focus-ring-outset`, and now accepts it while still rejecting an unknown suffix.

- **`<Button asChild loading loadingIcon={…}>` no longer drops every prop.** With a spinner to render,
  Button wrapped its children in a Fragment and merged onto that — and a Fragment carries no
  attributes, so the class, `data-slot`, `aria-busy` and every caller prop vanished silently. The
  spinner is now injected into the cloned child. `cloneAsChild` rejects a Fragment outright, which
  closes the same hole for every `asChild` component and makes its documented error message truthful.

- **`busy` paints on `Switch` and `Toggle`.** Both put `aria-busy` on the inner input and
  `state-busy` on the wrapping label, but the utility only matched the element carrying the attribute
  — so the prop did nothing at all. It now also matches through `:has()`, the shape `state-disabled`
  and `state-invalid` already used.

- **`CheckboxGroup` and `RadioGroup` no longer put `aria-invalid`/`aria-busy` on their `<fieldset>`.**
  Neither attribute is valid on the implicit `group` role; the `data-*` state hooks the CSS reads stay,
  and an `Item` carries the aria on the input, where the role allows it. The state spread also moved
  ahead of the caller's props, so a caller-supplied aria attribute now wins — matching how
  `aria-describedby` already behaved. `RadioGroup`'s fieldset gained the `role="radiogroup"` it was
  missing.

- **A `Filter` chip keeps a visible focus indicator in forced-colors mode.** The chip's `focus-ring` is
  a `box-shadow`, and shadows do not paint under `forced-colors: active`, so a focused chip had no
  indicator at all. §9 of `forge-ui.css` now restores an outline for `filter-item` alongside its
  chosen-state colours. `CheckboxGroup` and `RadioGroup` — the two components §9 was written about —
  gained the forced-colors browser coverage they never had.

- **`isHoneypotFilled` no longer treats a whitespace-only value as a bot signal.** A single space
  left by an extension or an autofill pass tripped the guard and refused a legitimate submission.
  The string case now trims before the length check; a `File` value is still judged on its size, so
  a zero-byte file remains "not filled".

- **`Honeypot` renders `autocomplete="new-password"` instead of `autocomplete="off"`.** `off` is the
  token browsers feel free to ignore on fields their heuristics recognise; `new-password` is the one
  they honour as _never autofill this_. Defence in depth behind the field-name change above.

---

## [0.1.1] — 2026-09-04

### Breaking Changes

- **Eight design rules moved from `validate-design` and `validate-modern-css` to forge's oxlint
  plugin, and their detectors are gone from the public surface.** `findArbitraryValues`,
  `findColorLiterals`, `findTagSizedHeadings`, `findUnguardedAnimations`, `findViewportUnits` and
  `logicalUtility` are no longer exported from `@y-core/forge/cli/pkg`, and nothing replaces them on
  that barrel — the plugin owns the detection now. `RuleId` and `RULE_CORPUS_PATH` moved from
  `gate/checks/design-parse` to `gate/checks/design-rules`, under the same names. A consuming app
  that names steps through `config/steps.ts` adds three steps — `classGroupsStep`, `cssTokensStep`
  and `designScaleStep`, each described under **Added** below — and all three are `--full` only.

- **`forge-ui-viewport-units` is retired.** Two class names are a restriction list rather than a
  rule, and `floor.md`'s prose says the same thing without an id. The guidance stays; the marker,
  the detector and the `MODERN_CSS_CITED_RULES` entry are gone. Per
  `UI_DESIGN_GUIDANCE.md` §3b the id is never reassigned, so a citation that outlived it lands on
  nothing rather than on a different rule.

### Added

- **Eight class-string rules now read the AST instead of the line.** `forge/spacing-scale-only`,
  `forge/color-token-only`, `forge/a11y-heading-size-by-class`, `forge/reduced-motion`,
  `forge/platform-entry-motion`, `forge/platform-logical-spacing`, `forge/platform-text-balance` and
  `forge/platform-text-pretty` live in `@y-core/forge/cli/pkg/lint` and run under the `lint` step.
  Three competing regex extractors became one, anchored to a real class position — a
  `class`/`className` attribute, a `class:` object property, or an argument to `cn`/`cva`/`asClass`
  — which removes a whole class of false positive by construction: `validate-modern-css` no longer
  reads the CSS property names in the generated `class-groups.ts` as class strings, nor the word
  "prose" in an English sentence.

  Four consequences worth knowing before upgrading, each of which can turn a green tree red.

  **The three Tier-B/C rules became blocking.** `validate-modern-css` forced
  `forge/platform-entry-motion` (Tier B), `forge/platform-text-balance` and
  `forge/platform-text-pretty` (Tier C) to `warn`; `lint` runs `--deny-warnings`, so each is now an
  error rather than a warning.

  **Three rules report input the old detectors passed in silence.**
  `forge/platform-text-balance` reads `text-8xl` and `text-9xl` beside the `text-2xl`–`text-7xl` it
  already covered. `forge/platform-logical-spacing` reads a negative inline margin, reporting
  `-ml-4` as `-ms-4` and `hover:-mr-2` as `hover:-me-2`. `forge/color-token-only` reports a palette
  custom property written without its namespace — `bg-(--red-500)` — because the palette is declared
  as `--color-red-500` and only that spelling resolves to a token.

  **`forge-ui-reduced-motion` was enforced twice with different scopes and is now enforced once, as
  the union** — `animate-*` _and_ `transition*`, at `error`, gated on the whole class expression so
  a `motion-reduce:` in a sibling `cn()` argument still counts.

  **The scope widened**: oxlint reads every `.ts`/`.tsx` under `src/` and `config/`, where
  `validate-design` walked only non-test `.tsx` and `validate-modern-css` only `src/ui`.
  Suppression follows the mechanism — a plugin rule takes
  `oxlint-disable-next-line forge/<key> -- <why>`, not `design-allow`, and a `design-allow` marker
  left behind for a migrated rule now suppresses nothing. Entry motion, for one, is
  `// oxlint-disable-next-line forge/platform-entry-motion -- <why>`.

- **`validate-design-scale` and `bun run gen:design-scale`.** `src/cli/pkg/lint/data/design-scale.ts`
  is generated from the compiled stylesheet and holds what the two data-driven rules resolve
  against: the `--spacing` step size, the roots that read it, the steps the scale offers, the
  colour-bearing roots and the theme's colour tokens. That file is the register — read the counts
  there rather than from prose that would drift. `spacing-scale-only` therefore names the
  utility that would replace an arbitrary value — `p-[8px]` reports `p-2` — instead of refusing
  every `px`/`rem` value on a hand-listed set of 31 roots. The step is `--full` only, for the reason
  `validate-class-groups` is: `tailwindcss` is an optional peer.

- **`validate-design` now holds each rule against the mechanism that enforces it.**
  `gate/checks/design-rules.ts` names, per corpus id, whether a check step or the plugin enforces
  it; the gate fails by name when a detector is deleted, when the plugin stops registering a rule,
  or when `.oxlintrc.json` stops enabling one. Without it a `RULE_CORPUS_PATH` row for a migrated
  rule would have asserted nothing.

- **A scale token is namespaced away from colour, and `--text-size-*` is the reserved spelling.**
  Tailwind's `--text-*` namespace carries font size while the `text-*` utility also carries colour,
  so an app's `--text-hero` produced a class indistinguishable from a colour — and `cn` read it as
  one: `cn("text-hero text-red-500")` returned `text-red-500` alone, in the app's markup, with no
  error. Declaring the step `--text-size-hero` instead gives `text-size-hero`, which the conflict
  table now resolves to the font-size group the design system itself states, so it merges against
  `text-2xl` and coexists with `text-red-500`. The convention is published in the `forge.css` header
  and `src/ui/README.md`; the reasoning is `UI_SSR_COMPONENTS.md` §5f. The arbitrary form is
  deliberately narrower and does not merge against the named one: `cn("text-size-hero
text-size-[20px]")` keeps both, because `text-size-hero` sets a line height the arbitrary value
  does not.

  Forge cannot enforce this in a consumer's stylesheet — an app's theme is not in forge's compile —
  so a token that keeps the old spelling behaves exactly as it did. **New gate step
  `validate-css-tokens`** holds forge's own `@theme` tokens to the rule, deriving the overloaded
  namespaces from the compiled design system rather than a hand-kept list. It walks the CSS
  directory recursively and fails rather than passing when the directory matched no stylesheet, so a
  mis-pointed `cssDir` reads as a failure and not as a clean run. Like the other two steps that
  compile it, it is `--full` only, because `tailwindcss` is an optional peer.

- **`@y-core/forge/cli/pkg/lint` — forge's own oxlint plugin, shipped as raw TypeScript.** oxlint's
  `jsPlugins` resolves a package subpath and loads TypeScript source directly, so the plugin needs no
  build step and no new package: it is a concrete-file subpath inside `cli/pkg`, on the
  `./ui/core/client` precedent. A consuming app names it in `.oxlintrc.json`:

  ```json
  { "jsPlugins": ["@y-core/forge/cli/pkg/lint"], "rules": { "forge/suppression-needs-reason": "error" } }
  ```

  The subpath publishes exactly two things — `lintPlugin` and the default export that aliases it,
  which is what `jsPlugins` loads. The rule objects and the oxlint ABI types the plugin is written
  against stay internal to `cli/pkg/lint/`, which has no `mod.ts` and mints no namespace: they are
  structural restatements of oxlint's own types rather than imports, because `oxlint` is a
  devDependency and a published module must not depend on one, and restating an ABI is not a
  contract forge is willing to hold a consumer to.

- **`forge/suppression-needs-reason` — every lint suppression states why.** The rule reads
  `context.sourceCode.getDisableDirectives()` and reports any `oxlint-disable*` whose justification
  is empty, so the mandatory reason is AST-anchored rather than matched by a `(?!\*/)` lookahead over
  raw lines, and it covers **every** rule rather than only `design-allow`. It composes with the
  `--report-unused-disable-directives-severity error` that `lint:types` already passes: that one says
  a suppression must still be needed, this one says it must say why.

- **`validate-class-groups` fails the gate when the committed conflict table drifts.** The step
  recompiles the stylesheet, re-derives the table and compares it to
  `src/ui/core/utils/class-groups.ts` byte for byte, so a `tailwindcss` release or a theme edit that
  moves the ground truth is reported rather than silently corrupting `cn`. It is `--full` only and
  declares `requires: { tool: "tailwindcss" }`: `tailwindcss` is an _optional_ peer, so a fast run
  on a consumer that has not installed it must not fail. `prepublishOnly` runs `verify:full`, which
  makes drift a release gate. Exposed as `classGroupsStep`, `checkClassGroups`,
  `ClassGroupsCheckConfig`, `deriveClassGroups`, `renderClassGroups`, `signature`, `reach` and
  `SHORTHAND_CLOSURE` from `@y-core/forge/cli/pkg`. The stylesheet loader the three compiling steps
  share is exported beside them, from the new `gate/checks/design-system` module: `loadDesignSystem`,
  `hasTailwind`, `canonical`, `fileURLToPathish` and the `DesignSystem` and `CssNode` types.

- **`forge release` prints the evidence for the version it derived.** A `because:` row beside
  `next:` names the commit whose `major:`/`minor:` prefix won the bump — short sha and subject — so
  a reviewer no longer re-scans `git log` to find out what asked for a version jump. Where nothing
  asked, the row says so: `no major:/minor: subject in 7 commits since v1.0.0`. The row prints in a
  real release as well as under `--dry`, and only for an automatic bump — an explicit version, a
  first release and an in-sync run print none. `VersionResult` carries the same fact as an optional
  `evidence` field for a consumer building its own release output.

- **`forge release` refuses a patch release whose public export surface shrank.** The bump is
  derived from commit subject prefixes alone, so a symbol dropped from a barrel under an unprefixed
  subject used to ship as `auto-patch` and break every consumer pinned to a `^` range. The release
  now compares the `<specifier>#<exportName>` set the latest tag published against the working
  tree's, and refuses an `auto-patch` that lost an entry, naming each one. `--allow-semver`
  overrides it. The bar is deliberately `auto-minor`: `auto-minor`, `auto-major`, an explicit
  version and a first release all pass, because a major-version decision is not one a heuristic
  over barrel names should demand. The guard fires under `--dry` too.

  It reads every non-wildcard entry in the exports map, not just the `mod.ts` barrels, so the nine
  concrete-file subpaths — `./cli/pkg/lint`, `./jsx/jsx-runtime`, `./jsx/jsx-dev-runtime`,
  `./jsx/register`, `./ui/assets/glyphs`, `./ui/chrome/client`, `./ui/client/htmx`,
  `./ui/core/client` and `./ui/show/client` — are covered rather than invisible. It also fails
  closed: a ref git cannot resolve raises `ReleaseError` kind `git-error` and a manifest it cannot
  parse raises the new kind `manifest-malformed`, where both used to read as "nothing was
  published" and let the release through. An `export { x as y }` counts as `y` alone, so renaming
  the local binding behind an unchanged public name no longer reads as a removal.

- **A `challenge="submit"` press that ends without a request now tells the page.**
  `TURNSTILE_ABANDONED_EVENT` (`"turnstile:abandoned"`) is dispatched on the **form**, bubbling and
  not cancelable, with a `TurnstileAbandonedDetail` naming the `reason` — `TurnstileAbandonReason`
  is `"timeout" | "interactive-timeout" | "error" | "unsupported" | "superseded"` — and the
  `submitter` the press was made on, re-enabled before the event fires so a handler can focus it.
  The held request is deliberately not carried: reviving it is the tokenless POST the drop exists to
  prevent. `TURNSTILE_INTERACTIVE_TIMEOUT_MS` (60s) is the new ceiling on a press held while an
  interactive challenge is up. All four are exported from `@y-core/forge/ui/contracts`.

### Fixed

- **`cn` no longer drops nine kinds of non-conflicting utility.** `class-groups.ts` merged concerns
  Tailwind keeps separate, so a class an app author wrote vanished from the rendered markup with no
  error and no gate failure: `cn("bg-red-500 bg-blend-multiply")` returned only
  `bg-blend-multiply`, and the same went for `bg-clip-*`, `bg-origin-*`, `text-shadow-*` against a
  text colour, `text-shadow-md` against `text-shadow-<color>`, `ring-offset-2` against
  `ring-offset-<color>`, the logical sides `border-be-*` and `inset-be-*` — added to Tailwind after
  the hand table was written — and `ordinal` against `tabular-nums`. All nine now keep both classes.
  `validate-class-order` could not have caught any of them: it proved class literals were fixed
  points of `cn` using the same table as its oracle, so the check and its subject failed together.

- **Twelve physical spacing utilities and an ungated transition, all of them outside the scope the
  old checks walked.** `logging/show/components.tsx` used `pr-4`, `pl-4` and `text-left` where the
  logical spellings mirror, and its `text-2xl` page heading carried no `text-balance` — invisible
  because `validate-modern-css` scanned `src/ui` alone. `http/fragment.ts`'s default error-list
  class used `pl-5`. The navbar's backdrop scrim transitioned `opacity` and `visibility` with no
  `motion-reduce:` beside it, where the panel it dims already had one.

- **`validate-class-order` refuses a green verdict on a class position it could not read.** A `cn(`
  or `class=` whose span never closes leaves every class literal inside it unjudged, which is not
  the same fact as "the classes are ordered". The step now fails, naming the file and the line, so a
  tree holding such a position fails the gate until the source is fixed rather than passing on a
  check that never ran.

- **A `challenge="submit"` press on a form htmx does not validate no longer leaves with an empty
  token.** The controller bailed on `!form.checkValidity()` without cancelling the event, on the
  assumption that htmx would halt the request — but `checkValidity()` is the static algorithm and
  ignores `novalidate`, which htmx honours, and htmx never validates a button-issued submission at
  all. On such a form the request went out with no token and the server saw a bot. Forge now mirrors
  htmx's own gate (`hx-validate` read off the issuing element only, both spellings; `formnovalidate`
  only when that element is the form), and where htmx would not have validated, the press spends a
  challenge instead — the author declaring `novalidate` has declared constraint validation is not
  the gate.

- **A second press can no longer be answered by the first press's request.** The held request and
  the control it was pressed on were separate module-level slots shared by every submitter in scope,
  so pressing Submit could be answered by the Preview control's request — htmx reads the form's
  `lastButtonClicked` back when it issues. The hold is now one record keyed to its submitter, and
  the last press wins: it displaces the first, re-arms the window, reports the displaced press as
  `superseded`, and rides the challenge already in flight, so one press remains one challenge.

- **An abandoned interactive challenge no longer wedges the form for the page's life.**
  `before-interactive-callback` stood the execute budget down entirely — the normal path under
  `appearance="interaction-only"` — leaving a press held with no ceiling. It now swaps the 15s
  budget for `TURNSTILE_INTERACTIVE_TIMEOUT_MS`, far past a deliberate click and well inside the
  token's ~300s life. A press arriving mid-interaction inherits the same ceiling.

### Changed

- **Elevation is now visible in dark mode.** Every level above a hairline was a Tailwind default
  shadow — black at 5–25% alpha — so on a near-black surface levels 2, 3 and 4 rendered nothing and
  a `Card`, a `Menu.Popup` and a `Dialog` read as coplanar. `theme-base.css` now redefines the whole
  `--shadow-*` family with Tailwind's geometry unchanged and every colour slot pointed at two new
  fixed families in `theme-colors.css`: `--cast-a1` / `-a2` / `-a4`, ink in light and `transparent`
  in dark, and `--rim-a1` / `-a2`, the reverse. In dark a level is carried by a 1px inset rim at 10%
  white plus a soft outer falloff at 5% whose radius is the level — a clean edge transition, not a
  glow. **No component class changes**, and light mode renders as it did with one exception below.
  All seven sizes are defined rather than the five forge renders, so a consumer's `shadow-2xl` is
  not the one elevation that still vanishes in dark.

- **`shadow-2xl` is marginally lighter in light mode.** Tailwind's value uses alpha `0.25`, which is
  off-grid between `--black-a4` (0.2) and `--black-a5` (0.3); it maps to `--cast-a4`. Adding an
  off-ramp alpha step would be the ad-hoc tint `forge-ui-color-scale-no-adhoc-tint` forbids, so the
  shift is taken rather than worked around. Forge itself renders no `shadow-2xl`.

- **`cn`'s conflict table is derived from the design system rather than hand-written.**
  `src/ui/core/utils/class-groups.ts` is now generated from the stylesheet `.oxfmtrc.json` already
  names, `src/ui/assets/css/tailwind.css`, by `bun run gen:class-groups`. A group id is the CSS
  signature a utility writes — its `--tw-*` variables when it sets any, its ordinary properties
  otherwise, which is what keeps `ring-2` and `shadow-md` apart though both write `box-shadow` —
  and `GROUP_OVERRIDES` states which of those signatures a CSS shorthand swallows. `cn`'s algorithm
  is unchanged, `classGroup` and `GROUP_OVERRIDES` keep their shapes, and both stay `@internal`.
  Two facts remain hand-authored, and neither moves when Tailwind ships a minor: the vars-preferred
  signature rule and the CSS shorthand closure, both stated in
  `.decisions/implementation/UI_SSR_COMPONENTS.md` §3f. **No new dependency** — `tailwindcss` is
  already a peer, and the two loader callbacks `@tailwindcss/node` exists to supply are ten lines
  of `node:fs`.

  The generated table covers every utility the stylesheet compiles to, where the hand table covered
  a fraction of them, so a few that used to fall through now resolve — `backdrop-blur`, for one.
  The artifact is correspondingly larger, and remains immaterial against an isolate limit of
  3–10 MB; `src/ui/core/utils/class-groups.ts` is the table itself.

  A root the generator cannot enumerate a scale for is now probed directly with two scale values —
  `getClassList()` reports one for `left` and none for `start` — and a derivation that would put two
  groups with identical reach into an override edge throws rather than emitting a table whose
  override runs both ways. Neither changes `cn`'s input-to-output for any class the old table
  already resolved.

- **`cn` merges four more shorthand families, so a class that survived before is now dropped.**
  Tailwind treats each as one concern and the derived table now says so: a `scroll-p*` / `scroll-m*`
  longhand under its shorthand, `basis-*` under `flex-*`, and `content-*` / `items-*` / `self-*`
  under the matching `place-*`. `cn("scroll-pt-4 scroll-p-2")` returned both and now returns
  `scroll-p-2`; `cn("items-center place-items-start")` returns `place-items-start`. Where an app
  relied on the pair surviving, order the classes so the one that must win comes last, or drop the
  shorthand.

---

## [0.1.0] — 2026-09-03

### Breaking Changes

- **`<Turnstile>` now loads Cloudflare's script eagerly, and its token reset is scoped to the
  form's own submission.** The widget used to wait for the first `focusin` inside its form; it now
  fetches `api.js` and renders at mount, which is what Cloudflare asks for and what gives a real
  submitter a challenge that is already solved when they reach the button. **Every consumer's
  widgets change behaviour on the version bump alone.** The old behaviour is `load='focus'` — give
  it to any form that is incidental to its page (a footer contact form, a demo), because eager
  means a challenge issued to everyone who loads the page, not only to those who submit. The reset
  is the second change: the controller used to reset the widget — and `form.reset()` on success —
  on **any** `htmx:afterRequest` bubbling out of the form, so every htmx request the form triggered
  burned the single-use token. It now tests the element htmx issued the request from: a form
  declaring an `hx-*` verb itself owns only the request issued by the form, and a form carrying no
  verb owns the one issued by a descendant submit control that carries it. A descendant field's own
  request no longer resets anything. An app that worked around the old reset by saving and restoring
  its fields can drop that workaround.

- **`Toolbar` (`ui/chrome`) renders `<div role="toolbar">`, not `<nav role="toolbar">`.** The
  `role` was already replacing the element's navigation landmark, so the `<nav>` bought nothing and
  misled assistive-technology users scanning by landmark. `ToolbarProps` accordingly extends the
  `div` intrinsic attributes instead of `nav`'s — a consumer spreading a nav-only attribute through
  the toolbar no longer typechecks, and selectors targeting `nav[role="toolbar"]` need the tag
  dropped.

- **The gate's `governance` step now invokes `gov sync`, not `governance-sync`.**
  `@y-core/governance` renamed its bin in v0.4.4, so `cloudflareWorkerSteps({ governance: true })`
  emits `["gov", "sync", "--check"]` with `["gov", "sync"]` as its fixer. **The preset version and
  the `@y-core/governance` pin must move together**: a sibling on the new preset with an older pin
  gets a gate invoking a binary it has not installed, and a sibling on the new pin with an older
  preset invokes one that no longer exists. Nothing enforces the pairing. Bump the pin to
  `refs/tags/v0.4.4` or later in the same change, and delete any stale
  `node_modules/.bin/governance-sync` symlink the upgrade leaves behind — it points at a module
  that lost its shebang and fails with `ENOEXEC` rather than "command not found".

- **The gate's `lint` step now runs `oxlint`, and a new `format` step runs `oxfmt`.** Consumers
  building a step table from `@y-core/forge/cli` get one more step and two more required
  devDependencies: `oxlint` (and `oxlint-tsgolint` for the type-aware step) and `oxfmt`.
  `lintStep` emits `oxlint --deny-warnings`; `formatStep` emits `oxfmt --check`, with a bare
  `oxfmt` as its fixer. `lint` is ordered **before** `format` so that under `--fix` the formatter
  writes last and owns the final byte layout. Suppression comments change spelling —
  `// biome-ignore lint/<group>/<rule>: <reason>` becomes
  `// oxlint-disable-next-line <plugin>/<rule> -- <reason>`. The two cannot coexist on one site:
  both linters read only the immediately preceding line, so a directive one line further up is
  inert.

- **Biome is gone; `@biomejs/biome` is no longer a devDependency and `biome.json` is deleted.**
  `oxfmt` replaces it for formatting and import sorting, configured by `.oxfmtrc.json`. Two
  consequences for a consuming project. First, `formatStep`'s argv changes — the label stays
  `format`, so `--only format` is unaffected, but a project that pinned the old `["biome", …]`
  array in its own step table must edit it. Pre-1.0, there is no shim. Second, **oxfmt formats by
  language, not by extension**: where Biome was restricted to `.ts`/`.tsx`, oxfmt also formats
  Markdown, CSS, JSON, YAML and TOML, so pointing it at a directory reformats far more than
  before. forge's own `format` step is now pointed at `.` rather than `src/` and `config/`.
  Import sorting moves from Biome's `organizeImports` to oxfmt's `sortImports`, which uses a
  different algorithm and inserts blank lines between import groups.

### Added

- **`<Turnstile>` takes `cData` and `responseFieldName`, the missing client halves of two server
  options forge already published.** `cData` stamps `data-cdata` and reaches Cloudflare as `cData`;
  it is what `verifyTurnstile({ expectedCData })` compares against, and until now nothing could mint
  a token carrying it, so the option was unusable. It is the only way to tie a challenge to an
  app-side record. `responseFieldName` stamps `data-response-field-name` and reaches Cloudflare as
  `response-field-name`, renaming the hidden token input so two widgets can share one form — pair it
  with the server's existing `tokenField`. A `cData` outside `TURNSTILE_CDATA_PATTERN` (new, beside
  `TURNSTILE_ACTION_PATTERN`) is reported to the console and still forwarded, as `action` already
  is, leaving the server the single enforcement point; `responseFieldName` carries no pattern,
  because it is an HTML form field name. Both props are optional and elide when absent, so existing
  markup is byte-identical. The showcase playground drives both.
- **A Turnstile page in the showcase (`/showcase/ui/turnstile`), replacing the catalog band.** One
  widget a reader reconfigures from a panel that drives every prop `TurnstileProps` declares —
  `siteKey`, `size`, `load`, `challenge`, `appearance`, `action`, `language`, `tabindex` and the
  fallback and unsupported copy — with the `<Turnstile>` call the settings correspond to printed
  beside it. The query string is the whole configuration, as on the theme page, so a setting worth
  reporting is a link. The sizes-and-modes band that used to sit on the Interactive page moves here
  intact and still owns the component's coverage axes; three further bands show the two refusal
  messages the controller reveals, the round trip through `defineAction`, and Cloudflare's dummy
  sitekeys. The panel offers nothing Cloudflare's API has that forge does not expose: an option
  forge has ruled against — `theme`, `retry`, `refreshExpired` — has no dial, because a control for
  a prop the component cannot take would document a component forge does not ship. The sitekey is a
  preset id rather than a free string, so no visitor can have a key of their own rendered under the
  host's name.

- **`registerShowcase` takes an optional `turnstileSecret`, and mounts a `turnstile-verify` action.**
  The playground's form posts to an ordinary `defineAction` route with `honeypot` and `turnstile`
  declared, and its verdict panel reports which guard refused and why — the one place the showcase
  departs from what a real route must do, since an application answers every guard identically so a
  bot cannot read the guard off the response. Without the secret the panel says it was not
  configured rather than claiming a verification that never happened. New exports from
  `@y-core/forge/ui/show`: `TurnstileDemos`, `loadTurnstileOptions`, `turnstileSiteKey`,
  `turnstileSnippet`, `TurnstileVerdictFragment`, `renderTurnstileVerdict`, `TURNSTILE_TEST_KEYS`,
  `TURNSTILE_PASS_KEY`, `TURNSTILE_DEMO_DEFAULTS`, `SHOW_TURNSTILE_VERDICT_ID`, and the types
  `TurnstileDemoOptions`, `TurnstileTestKey` and `TurnstileVerdict`. `ShowcaseData` gains a
  `turnstile` field, so an app calling `ShowcaseContent` directly passes `loadShowcase`'s output
  unchanged and nothing else.

- **`formDigits()` (`validation`) — a form value reduced to its ASCII digits.** The third form-value
  primitive beside `formText()` and `formMultilineText()`, for a control whose separators are
  cosmetic: `v.pipe(formDigits(), v.length(16))` accepts a card number however the user grouped it,
  and the length then counts digits rather than the punctuation a rendering happened to carry. It
  only removes — it never throws, coerces or refuses, so a bad value still earns a `422` from a
  composed `v.length` rather than the `500` a throwing pipe action would produce. It is destructive
  in a way its siblings are not, discarding a leading `+` among other significant characters; a
  field that must keep one stays on `formText()`.

- **`Input` takes `format` — opt-in cosmetic grouping, applied on blur.** `format='#### #### ####
####'` regroups the value when focus leaves the field, and nothing reformats as the user types, so
  the entire class of caret bugs is structurally impossible. The server renders the formatted value
  itself, so a no-JS first paint and a re-render after a failed submit already read grouped and the
  controller's first write is a no-op. **The formatted string is what the form posts** — pair the
  field with `formDigits()` on the server, which is the documented other half of the contract.
  `format` is never validation, and it does not compose with `bind`: a control carrying both is
  refused with one warning. Reach for `inputmode`, `pattern`, `autocomplete` and `maxlength` first —
  they need no script at all — and pair `format` with a `tabular-nums` class of your own.

- **`ui/contracts` exports `INPUT_FORMAT_SCOPE`, `INPUT_FORMAT_ATTR`, `applyFormat` and
  `stripFormat`.** The two pure functions both halves of the format feature share: `#` is a slot and
  every other character a literal, no `RegExp` is ever built from a template, and `applyFormat`
  always strips before it regroups — so it is idempotent, emits `""` rather than a bare skeleton that
  would defeat `required`, grows no trailing separator on a partial value, and returns the bare
  significant characters rather than truncating one that overflows the template.

- **`inputmode` and `enterkeyhint` on every element's JSX attributes.** Both are global HTML
  attributes, so both sit on `HTMLAttributes` — `<textarea inputmode='numeric'>` typechecks, not only
  `<input>`. Each is a closed literal union rather than `string`.

- **`<Turnstile>` takes `language`, `tabindex` and an `unsupported` message slot.** `language`
  pins the widget to a language the page has chosen where the browser's own would differ;
  `tabindex` sets the **widget iframe's** place in the form's tab order, which is an accessibility
  concern rather than a preference. **`tabindex` replaces the container's own `tabindex`** — the
  prop is omitted from the inherited `div` attributes, because Cloudflare's meaning is the one that
  matters on this element. `unsupported` is a second, separately overridable message, shown when
  Turnstile cannot run in the visitor's browser at all; the general fallback's "disable any ad or
  script blockers" is advice that visitor cannot act on. The other Cloudflare render parameters
  (`cData`, `retry`, `refresh-*`, `response-field-name`) stay out.

- **`<Turnstile>` reserves the widget's box, so the eager render stops shifting the page during
  first paint.** The reservation is keyed on `appearance`: `appearance="always"` holds Cloudflare's
  published dimensions, and `execute` / `interaction-only` reserve nothing, since a widget that may
  never appear would otherwise leave a permanent hole. **Consumers see a rendered `class` attribute
  on the container where there was none** — Tailwind sizing utilities, merged ahead of any `class`
  of the caller's, so a caller's own sizing still wins.

- **`mountTurnstile` copies the page's CSP nonce onto the script it injects.** A
  `script-src 'self' 'nonce-…' 'strict-dynamic'` policy now covers Cloudflare's `api.js` and
  everything it loads in turn, with no CDN origin in `script-src`. `frameSrc` and `connectSrc` still
  need `TURNSTILE_CSP` — `strict-dynamic` governs script loading only, and the challenge runs in an
  iframe. The nonce is read off an already-nonced script's **property**, never a `data-` copy: the
  browser empties the `nonce` content attribute precisely to stop the value being read back out
  through a CSS attribute selector. A page that sets no nonce is unaffected.

- **`TURNSTILE_ACTION_PATTERN` is exported from `ui/contracts`** — Cloudflare's
  `^[a-zA-Z0-9_-]{1,32}$` for the `action` prop. The controller reports a value outside it and
  **still forwards it**, so the server's `verifyTurnstile` stays the single enforcement point.

- **`<Turnstile>` takes `challenge` and `appearance`, opting a form into one challenge run at
  submit.** `challenge?: "render" | "submit"` defaults to `"render"`, which is today's behaviour
  unchanged: the challenge runs as the widget mounts and its single-use token starts its 300-second
  life there. `challenge="submit"` renders with Cloudflare's `execution: "execute"` and runs exactly
  one challenge, at the press, from htmx's `htmx:confirm` seam — for a form that takes longer to
  fill than the token lives, where the token can otherwise reach siteverify as
  `timeout-or-duplicate` and cost the reader their submission. The press is held, not gated: the
  submitter is marked `disabled` and `aria-busy` for the window, and the window always ends — on the
  token the request is issued, and on a challenge error or `TURNSTILE_EXECUTE_TIMEOUT_MS` (15 s) the
  fallback alert is revealed, the request is dropped rather than sent tokenless, and the button is
  pressable again. It needs an htmx submission on the form or a descendant; without one the
  controller reports the authoring error and falls back to `"render"`. `appearance?: "always" |
"execute" | "interaction-only"` defaults to `"always"` and is passed to Cloudflare as-is; it is
  independent of `challenge`, and `"interaction-only"` is the documented pairing for
  `challenge="submit"`. Both attributes are stamped only away from their defaults, so an opted-out
  widget renders the markup it always did.

- **`TURNSTILE_EXECUTE_TIMEOUT_MS`** — how long a `challenge="submit"` press is held before it is
  released as a failure, exported from `@y-core/forge/ui/contracts`.

- **`<Turnstile>` takes `load` and `action`.** `load?: "eager" | "focus"` picks when the script is
  fetched, defaulting to `"eager"` (see Breaking Changes). `action?: string` is written to
  `data-action` and passed to `turnstile.render`, which is what makes the server's
  `verifyTurnstile({ expectedAction })` usable: without it a token minted on one form verifies at
  any other endpoint on the same host. There is no app-triggered third load mode.

- **`TURNSTILE_SCRIPT_URL`** — the URL the controller injects, `TURNSTILE_SCRIPT_SRC` plus
  `?render=explicit`, exported from `@y-core/forge/ui/contracts`. The controller renders every
  widget itself, so Cloudflare's implicit document scan ran for nothing. `TURNSTILE_SCRIPT_SRC` is
  unchanged and is now matched as a **prefix**, so a script an app loaded with parameters of its
  own is still found rather than loaded twice.

- **`typeAwareLintStep` — type-aware linting, `fullOnly`.** `oxlint --type-aware` enables
  `no-floating-promises`, `no-misused-promises` and `await-thenable`, which Biome cannot express at
  all and which matter on a Workers isolate that tears down at end-of-response. It builds its own
  TypeScript program, so it stays off the fast loop. It also carries
  `--report-unused-disable-directives-severity error`: this run is a superset of the syntax run, so
  it is the only one that can tell a stale suppression from one a type-aware rule redeems.

- **`rasters` — SVG-to-PNG rasterization for non-square art.** A new assets config block of
  `{ from, to, width?, height? }` entries, rasterized by `buildRasters` into `paths.publicDir`
  during `buildAll` (after `copy`) and reachable alone as `forge assets build rasters`. Setting one
  dimension derives the other from the source's intrinsic ratio, so a lockup is scaled rather than
  squashed; an entry setting neither is rejected by the schema. Outputs are not content-hashed and
  do not enter the manifest — like `copy`, because a URL pasted into a mail client has to stay
  stable. `sharp` stays an optional dynamic import; `currentColor` is not substituted, so give the
  source an explicit fill.

- **`formatStep`** — the formatting half of the old `lintStep`, exported from `@y-core/forge/cli`.

- **Two rules taken from oxlint's `suspicious` category, named individually.**
  `eslint/preserve-caught-error` caught one rethrow that discarded the original stack;
  `eslint/no-shadow` caught locals shadowing an imported or same-module symbol the file also calls
  — `err` from `result` inside a `catch` in `csrf.ts`, and the exported `env()` builder in
  `config.ts`. The category itself stays **off**: enabling it would subscribe forge's published
  gate to oxc's future editorial judgement, and 312 of its 357 findings here come from three rules
  that collide with forge's own design. Reasoning is in `CODE_REVIEW.md` §7.

- **`@y-core/forge/ui/assets/css/tailwind.css` — Tailwind composed with forge, as one import.**
  It is `@import "tailwindcss"` above `forge.css`, and it replaces the two lines an app used to
  write itself. **The two-line form still works and is still correct** for an app that must pass
  Tailwind import options (`source(none)`, a prefix), because an option cannot be added to an import
  nested inside a file the app does not control — which is why `forge.css` still never imports
  Tailwind. Take one path or the other, never both: two Tailwind imports emit preflight twice. The
  value of having the file is that the composition is now stated once, in the package, where the
  app's stylesheet, its Tailwind build and forge's own class sorter all read the same one.

- **A `validate-class-order` gate step, shipped to consuming apps in `forgeChecks`.** It walks every
  class position — a `class` / `className` attribute, and every argument to `cn`, `asClass` and
  `cva` — and fails on any literal two of whose tokens claim the same conflict group, naming the
  file, the literal and the token that would be dropped. Such a literal already contains dead code:
  `cn` drops one of the two at render. Banning it is also what makes sorting a class literal
  provably output-preserving (`UI_SSR_COMPONENTS.md` §3e). The oracle is the real `cn`, imported
  rather than reimplemented. `classOrderStep({ root, sources })` is exported for a bespoke table;
  `!`-prefixed entries exclude a file or subtree, which is how a spec whose fixtures are
  deliberately self-conflicting opts out.

### Fixed

- **`<Turnstile>`'s fallback message is no longer one-way, and no longer the same message for every
  cause.** `showFallback` only ever revealed the alert; nothing took it back down. Under the new
  eager default that stranded _every_ visitor to a page with a transient Turnstile error on "disable
  any ad or script blockers", including the ones whose widget then solved itself on Cloudflare's
  automatic retry. The controller now passes a success `callback` in render mode too — previously
  only submit mode had one — and that callback re-hides the alert. Two consequences for a consumer:
  the widget div gains a second hidden `<p>` (`data-ref="turnstile-unsupported"`), and the
  `error-callback` now takes Cloudflare's error code, reports it once under the `[turnstile]`
  prefix, and **returns a non-falsy value**, which stops Cloudflare logging a warning of its own for
  each of its retries.

- **A `challenge="submit"` press is no longer held for 15 seconds on a widget that cannot answer.**
  The controller now tracks widget health as `unmounted | ready | dead`: a `turnstile.render()` that
  throws — previously swallowed with no report at all — or an `error-callback` before the press
  leaves the widget `dead`, and the next press goes through unheld for `verifyTurnstile` to refuse.
  It used to sit disabled and `aria-busy` for the full `TURNSTILE_EXECUTE_TIMEOUT_MS` with no
  request ever sent.

- **An interactive Turnstile challenge is no longer discarded after 15 seconds while the visitor is
  still solving it.** The execute timeout assumed a non-interactive challenge. When Turnstile
  presents one the visitor must click, 15 seconds is well short of a real person, and their
  submission was silently dropped with the ad-blocker message. The controller now wires
  `before-interactive-callback` — clearing the timer and dropping the busy state, so the button
  stops reading as mid-flight while they are being asked to act — and `after-interactive-callback`,
  which re-arms both. Cloudflare's own `timeout-callback` covers abandonment.

- **The widget re-renders on a theme flip, but only while no token has been issued.** A dark/light
  toggle used to leave the widget in the colours it first rendered in. It now watches
  `documentElement`'s class list and re-renders on a change — and stops doing so the moment a token
  exists, because discarding a solved token to change a colour would cost the visitor a second
  challenge, and in submit mode the one they had just passed.

- **`<Turnstile>` no longer resets the widget on expiry or timeout.** Both `refresh-expired` and
  `refresh-timeout` default to `auto`, and Cloudflare documents the timeout callback as resetting
  the widget itself, so forge's own `reset()` was redundant at best and at worst spent a second
  challenge on top of the one Turnstile had just re-presented. The two callbacks are no longer
  wired at all. **This was settled from Cloudflare's reference documentation, not observed against a
  live test sitekey** — worth one manual confirmation on a real key.

- **A `turnstile.remove()` that throws no longer aborts the rest of the controller's teardown.** It
  was called bare where `render` was wrapped, so a widget id whose container an htmx swap had
  already taken could skip `mounted.delete(container)` and leave a stale WeakMap entry that a later
  mount on the same node would be handed instead of a fresh controller.

- **`<Turnstile>`'s post-render focus guard is now armed on every render, not only on one that had
  a focus to restore.** The restore and the guard were one rule; they are two now, because a
  restore needs somewhere to restore _to_ and the guard does not. Under the new eager default the
  render lands at page entry with `body` focused, so there was no held focus and no guard — and
  Turnstile steals focus a beat after `render` returns, by which time the reader has clicked the
  first field and loses it. The guard ignores a `focusout` originating inside the widget, so
  tabbing between fields is unaffected. The accepted trade: a reader who deliberately clicks into
  the widget within five seconds of the render can have that focus pulled back to the field they
  left.

- **`cn` no longer drops a text colour standing beside `text-wrap` / `text-nowrap` /
  `text-balance` / `text-pretty`, nor a font family beside `font-stretch-*`.** The `text-`
  dispatcher classed the four wrapping modes as colours, so
  `cn("text-sm text-muted-foreground text-pretty")` rendered without the colour, and
  `font-stretch-*` fell to `font-family` the same way. Both are now their own conflict groups. The
  effect is a class kept that used to disappear: **a consumer passing either pair as `class` into a
  forge component gets a rendered `class` attribute one token longer than before**, which is the
  markup they asked for. Nothing that survived before starts being dropped.

- **`buttonVariants`' base now carries `whitespace-nowrap`.** A multi-word label used to break
  across two lines inside its own pill at narrow widths — a button is a control, and a control's
  label is not prose to be reflowed. Every consumer that added the class locally (a consuming app's
  declaration buttons at 320px, for one) can drop it. The class rides the base, so `Button`,
  `ToggleGroup` items and `Toolbar` items all inherit it; a label long enough to need wrapping
  wants a shorter label, not a two-line button.

- **Seven `...(x ?? {})` spreads dropped their useless fallback**, and three `/^…/.test(s)` regexes
  became `s.startsWith(…)`. A dead `_fetchFn` binding in `kv.test.ts` was removed. All were found
  by oxlint rules Biome does not have.

- **`mock.module` is now awaited in the three test files that install a `node:child_process` stub**
  (`cf-env-command.test.ts`, `proc.test.ts`, `git.test.ts`). Each is followed immediately by a
  top-level `await import(...)` of the module under test, so awaiting the registration is what
  guarantees the stub is in place before the import resolves.

### Changed

- **The design gate enforces two accessibility rules it had only published:**
  `forge-ui-a11y-label-association` (a Floor rule, new to `floor.md`) fails a `<label>` that
  neither carries `for` nor wraps its control, and `forge-ui-a11y-live-politeness` (already a
  corpus sentence) fails an `aria-live` that is neither `polite` nor `assertive`, and requires a
  stated reason for `assertive`. Both are suppressible per-site with `design-allow` and its
  mandatory reason. Forge's own tree passes with one suppression, in the showcase's toast-position
  demo. **This is forge's own gate, not a published behaviour change** — an app inherits the rule
  ids as citable corpus, and runs the checks only if it runs forge's design step.

- **The design gate now checks six more of the accessibility rules it publishes**, taking the
  enforced set from two to eight: `forge-ui-a11y-no-aria-readonly-on-button` (the attribute on a
  `<button>` or a `role="button"` element), `-one-live-region` (a live region opened outside
  `Toast.Container`), `-aria-beside-data` (a `data-pressed`/`-checked`/`-selected`/`-disabled`/
  `-invalid` written by hand rather than emitted through `stateAttrs`), `-heading-size-by-class`
  (an `<h1>`–`<h6>` whose quoted class carries no `text-*` size), plus the two Floor ids
  `forge-ui-reduced-motion` (an `animate-*` with no `motion-safe:`/`motion-reduce:` in its variant
  chain) and `forge-ui-focus-ring` (`outline-none`/`outline-hidden` on a `cursor-pointer` target
  with no `focus-visible:` ring beside it). Each is suppressible per-site with `design-allow` and
  its mandatory reason, though on the two Floor ids a suppression is a defect to remove rather than
  an override to accept. Forge's own tree passes all six with no new suppression. The remaining ten
  published a11y ids have no mechanical form and are now recorded as review items with the reason
  each resists one — including `forge-ui-a11y-state-attrs-source`, whose finder is blocked by a
  single site. **This is forge's own gate, not a published behaviour change** — an app inherits the
  rule ids as citable corpus, and runs the checks only if it runs forge's design step.

- **`.oxlintrc.json` enables the `jsx-a11y` plugin**, so all 35 of its rules run under
  `correctness` over forge's own JSX. It is a vocabulary check — misspelled `aria-*` attributes,
  invalid role strings, malformed ARIA values — not a check on composition, which is the design
  gate's. `prefer-tag-over-role` is off (its substitutions change the element's meaning), and
  `control-has-associated-label`, `tabindex-no-positive` and `aria-proptypes` are off for test
  files, which exist to feed adversarial markup. **`.oxlintrc.json` is not published**, so this
  changes no consumer's lint result.

- **`.oxfmtrc.json` enables `sortTailwindcss` over `cn` and `cva` calls**, so forge's class
  literals are held in Tailwind's canonical order. This is forge's own formatting, not a published
  behaviour change: it moved no token between literals, so `cn`'s cross-argument precedence and
  `cva`'s `base → variants → class` layering are untouched, and every rewritten test expectation
  was proved a token permutation before it was touched. Two consequences for an app adopting the
  same config: a class const only reaches the sorter inside a call — forge's own are wrapped as
  `const INPUT_BASE = cn("…")` — and `preserveDuplicates` defaults to `false`, so an exact
  duplicate token is deleted. The sorter is pointed at the shipped
  `ui/assets/css/tailwind.css`, so it resolves forge's own token utilities rather than treating
  each as unknown.

[0.1.17]: https://github.com/y-core/forge/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/y-core/forge/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/y-core/forge/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/y-core/forge/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/y-core/forge/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/y-core/forge/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/y-core/forge/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/y-core/forge/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/y-core/forge/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/y-core/forge/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/y-core/forge/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/y-core/forge/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/y-core/forge/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/y-core/forge/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/y-core/forge/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/y-core/forge/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/y-core/forge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/y-core/forge/compare/v0.0.91...v0.1.0
