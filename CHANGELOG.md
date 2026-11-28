# Changelog

All notable changes to `@y-core/forge` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **`[Unreleased]` is the only section humans edit.** `bun run release` promotes it into a dated
> version section, with the version and the date computed — never typed. Editing a released
> heading *or its body* by hand is refused by the changelog check: the release records each
> section's digest in `config/changelog-sections.json`, so a later edit no longer matches what
> shipped. Write the change under `[Unreleased]` instead.

> **Pre-1.0 versioning.** Per the project's architectural policy, breaking changes ship
> **without deprecation shims** and consuming apps are updated in the same window. A `0.0.x`
> bump can therefore contain breaking changes — always read the **Breaking Changes** section
> before upgrading.

---

## [Unreleased]

### Breaking Changes

- **`validate-config-files` holds what `config/` holds** (`CONFIG_BASELINE.md` §6): the `*.config.ts` entry points, the `.ts` modules
  they import directly or through one another, and the state files a tool writes there — `stateFiles`, defaulting to `CONFIG_STATE_FILES`,
  the release's `config/changelog-sections.json` and the ratchet's `config/rules-baseline.json` — and the directories a tool writes there,
  `stateDirs`, defaulting to `CONFIG_STATE_DIRS`, `forge db`'s `config/db/`. It fails a test, a module running `import.meta.main`, a module
  nothing imports, any other file and any other subdirectory, and the row now watches `config/**`.
  **Migration:** move a test beside the code it exercises, a script into the namespace whose artifact it writes, and a subdirectory's files
  to the code they serve; declare any other file or directory a tool writes there in `stateFiles` or `stateDirs`.

- **`browserStep`, `crossEngineStep` and `workerdStep` take no `watches`.** A Playwright spec reaches the app through the server it starts,
  so a path list could only skip a run `--affected` should make; their options are `PlaywrightStepOptions`, `StepOptions` without
  `watches`. **Migration:** drop `watches` from those calls.

- **`wardenAppSteps` adds a `warden:check` row to the static tier, and the consumer lint base refuses layer-crossing imports.** A
  controller importing another controller, a service importing a controller or a view, and a view importing a service or a controller now fail
  `lint` under `src/tooling/config/oxlint.base.json`, each message opening with its rule id. `warden:check` runs the register's patterns,
  failing on a `fail`-level hit and warning once per `warn` rule with hits. The `CODE_REVIEW.md` §3b sections hold no commands any more.
  **Migration:** move a cross-layer import to middleware or a service; repoint a golden query that expected `canon:CODE_REVIEW.md#3b` for a
  layer rule at the section that argues the rule, such as `canon:APP_ARCHITECTURE.md#2c`.

- **Every forge lint message opens with its rule id as `[rule-id] `, and names no corpus file.** A message read
  `<detail> (<id> — <corpus path>)`; it now reads `[<id>] <detail>`, and the 9 rules that reported without an id carry one too, among them
  `[forge-sql-in-loop]` and `[forge-type-import-separation]`. No lint message cites a document section (`DOC.md §N`) any more. Internally each
  rule is built with `defineLintRule(id, spec)`, which replaces the `reporter` helper, and `ReportedId` is gone; neither was exported.
  **Migration:** a script or snapshot that matches lint output on the old trailing `(id — path)` matches the leading `[id]` instead.
- **`ModernCssRule` has no `corpus` field**, and no row of `MODERN_CSS_RULES` or `MODERN_CSS_CITED_RULES` carries one. `validate-modern-css`
  findings no longer start with `<id>: ` or end with the corpus path; the id is the finding's `rule`, which `formatFinding` prints as `[id]`.
  **Migration:** drop `corpus` from a hand-built `ModernCssRule`, and read a rule's explanation from `src/ui/design/reference/16-platform.md`.
- **Gate findings name no document section.** The comment-budget and cross-engine-tag findings drop their `§5a`, `§5b`, `§5f` and
  `(docs/TEST_RUNNERS.md §1g)` text and carry the rule id in `rule` instead: `code-rules-comment-budget`, `code-rules-comment-forbidden`,
  `code-rules-field-gloss` and `forge-test-cross-engine-tag`. **Migration:** a match on the `§` text matches the `[id]` prefix instead.
- **`@y-core/forge/tooling/lint` no longer exports `RULE_CORPUS_PATH`, `RULE_ENFORCER`, `lintKeyOf`, `corpusIdOf`, `RuleId` or
  `RuleEnforcer`, and `ModernCssRule` has no `enforcer` field.** Which mechanism detects a rule is now the rule register's, in
  `config/rules.config.ts`, and each plugin rule carries the id it reports under. `validate-design` no longer holds the plugin against a
  register, and `DesignCheckConfig` in `@y-core/forge/warden/checks` drops `oxlintConfig`. **Migration:** read a rule's rationale section
  with `warden rules` instead of `RULE_CORPUS_PATH`, take a lint key from the plugin's own rule names instead of `lintKeyOf`, drop
  `enforcer` from a hand-built `ModernCssRule`, and drop `oxlintConfig` from a `checkDesign` config.

### Added

- **The `merge` skill's `push` stops on a unit that adds structure** — a new root-level file or directory, or a new directory at any depth —
  listing each one and pushing nothing; `--structure-approved` (`PushOptions.structureApproved`) passes it once the user has said yes.

- **`validate-css-sources` takes `quotedClasses`**: files whose class-shaped strings are quoted data, never rendered, each with a reason,
  which pass B skips; an entry naming no file or giving no reason fails.

- **New findings on existing steps.** `validate-packaging` fails a `files` negation naming one file, a script reaching outside the checkout
  through `../`, and an `engines.bun` floor off the Bun `packageManager` pins. `validate-co-location` fails an exemption its filename
  convention already covers. `validate-config-files` takes `markdown`, holding `.oxfmtrc.json` to ignore `**/*.md`, and `nodeSubpaths`,
  holding `playwright.config.ts` to forge's `forge.node` subpaths. `validate-rules` sweeps each rg detector's `examples` and, given
  `sourceReach`, fails an rg rule that reaches no file under a tree unless it is exempted with a reason. `validate-comment-budget` takes
  `coverTracked`, failing a `.ts`, `.tsx` or `.css` file in the git work tree its `sources` leave out.

- **`noBuildStep` and `checkNoBuild`, in `@y-core/forge/tooling/gate`**: the `validate-no-build` row fails any resolved row of a step table
  whose command runs a bundler, the compiler's emit or a `build` script.

- **`warden check`, the `rg` detector kind and `@y-core/forge/warden/sdk`.** A register entry may carry an `rg` pattern with paths, globs,
  a `fail` or `warn` level and a triage note; `warden check [--files|--diff] [--rules] [--json]` matches them in JS, as `rg -n` would, and
  prints each hit with its rule's statement, rationale and triage. The SDK exports `rules`, `corpus`, `check` and `steps` for a script or a
  REPL. The warden MCP server adds `warden_check` and `warden_query`, which runs an async arrow over the same data in a sandbox.

- **`forge verify --json`** prints nothing but the failures, as `{ step, rule, file, line, message }[]` (`GateFailure` in
  `@y-core/forge/tooling/gate`).

- **The `handoff` and `merge` skills ship scripts** that squash, check, rebase with patch ids and prepare a push in one call each, printing the
  `git push` rather than running it. Their logic is `handoff`, `mergeReviewed` and `preparePush` in `@y-core/forge/warden`.

- **A rule register, and the `validate-rules` step in the static tier that holds it to the prose.** Each rule's id, one-sentence statement
  and detectors are declared with `defineRules` from `@y-core/forge/warden`, and `checkRules` fails when a marker, an entry, a lint key, a
  plugin rule's id or a finding's id has nothing on the other side. `warden rules` prints every registered rule with its rationale section
  and statement. `isValidRuleId` in `@y-core/forge/tooling/gate` accepts any lower-case kebab-case id of two or more segments, no longer only
  `forge-ui-` ones.

- **The `warden:ratchet` step in the static tier, holding `config/rules-baseline.json`.** The review-only share of the rule register may not
  rise, and no owned document may grow past its word budget. Its fixer lowers budgets and never raises one; raising a budget is a hand edit to
  the JSON ([`docs/SOURCE_OF_TRUTH.md`](docs/SOURCE_OF_TRUTH.md) §5c).

- **`Finding.rule`, in `@y-core/forge/tooling/gate`**: the id of the rule a finding breaks. `formatFinding` prints it as `[rule] ` before
  the message when it is set, and a finding without one prints as before.

---

## [0.8.0] — 2026-11-26

### Breaking Changes

- **The chain's `session` slot takes only a `SessionMiddleware`, checks that it set a session, and the CSRF `subject` takes `"session"`.**
  `createAnonymousSession` and `sessionMiddleware` return the branded `SessionMiddleware` (exported from `@y-core/forge/session`), and
  `MiddlewareChainOptions.session` and `MiddlewareContribution.session` accept nothing else. A request the slot leaves without a session on
  `sessionCtx` throws, naming the slot. `CsrfPolicyOptions.subject: "session"` binds every token to the chain session's id, and a chain given
  it with no session slot throws at registration; `csrfMintStage` mounted by hand throws on `"session"` and still takes a resolver.
  `SignedCookie` gains a readonly `maxAge`. **Migration:** replace `subject: (c) => sessionCtx.getOptional(c)?.id` on the chain's `csrf`
  with `subject: "session"`. Pass the session slot what `createAnonymousSession` or `sessionMiddleware` returns, never a hand-written
  `Middleware`. A hand-built object typed `SignedCookie` adds `maxAge`.
- **`createUnsignedCookie` moves from `@y-core/forge/session` to `@y-core/forge/http`, with its types.** `UnsignedCookie`,
  `UnsignedCookieOptions` and `CookieAttributes` move with it, and `session` exports none of them. `http` also exports
  `COOKIE_ATTRIBUTES_DEFAULT` (`Path=/`, `SameSite=Lax`, `HttpOnly`, `Secure`), which `createSignedCookie`, `createFlash` and the `d1Sessions`
  bookmark cookie use, so the cookies they set are unchanged. **Migration:** import `createUnsignedCookie`, `UnsignedCookie`,
  `UnsignedCookieOptions` and `CookieAttributes` from `@y-core/forge/http` instead of `@y-core/forge/session`.
- **The app root owns the CSRF policy: `MiddlewareContribution` has no `csrf`.** The policy is `MiddlewareChainOptions.csrf` alone, so a
  contribution that carries one no longer compiles, and one that reaches the chain anyway throws at registration, naming the root `csrf`
  option. The "two sources each supply a csrf policy" throw is gone. **Migration:** move the
  `csrf` a contribution carried to the `csrf` option of `applyMiddlewareChain`, beside `session`. Where two sources each carried one, merge
  them into one policy: its `paths` and `exclude` cover what both did.
- **The auth guards take the services resolver as `services`, not a `sessions` resolver of their own.** `AuthGuardOptions.sessions` is
  gone, so `requireAuth`, `resolveAuth` and `createAuthGuards`' `auth` take `services: AuthRequestServicesResolver`, the resolver
  `authRequestServices` returns, and resolve the session through the one store it builds per request. `requireAuth` and `resolveAuth` built
  without one throw rather than admit every visitor as anonymous. **Migration:** replace `sessions: resolveServices.sessions`, or a resolver
  that built its own `createAuthSessionStore`, with `services: resolveServices`. Set the session bounds once, as `sessionOptions` on
  `authRequestServices`, and drop any second store built only for the guards.
- **`createAuthGuards` returns a `MiddlewareContribution`, and the chain refuses a session cookie that ends before the auth session.** It
  returned `MiddlewareGuardGroup[]`; it now returns `{ guards, sessionMaxAgeAtLeastMs }`, the lifetime read off `auth.services`, which gains
  `absoluteLifetimeMs`: `sessionOptions.absoluteLifetimeMs`, or `AUTH_SESSION_MAX_MS`. `MiddlewareContribution` gains
  `sessionMaxAgeAtLeastMs`, and `applyMiddlewareChain` throws at registration, naming both values, where the largest one contributed exceeds
  the session slot's cookie `maxAge`, where that cookie sets no `maxAge`, or where there is no session slot. An app whose session cookie sets
  no `maxAge` now fails at registration; `createAnonymousSession`'s 365-day default passes. **Migration:** move `guards: createAuthGuards({ … })`
  to `contributions: [createAuthGuards({ … })]`, beside any other contribution, and read `.guards` where the result was used as an array. Give
  the session cookie a `maxAge` of at least the auth session's absolute lifetime in seconds — 604800 for the default 7 days. A hand-built
  `AuthRequestServicesResolver` adds `absoluteLifetimeMs`.
- **`rateLimit` names its binding, and the chain checks the name at registration.** `RateLimitOptions.limiter` is gone; `binding: string`
  names the binding, read from `c.env` per request. `RateLimitBinding` is gone; the binding's type is `RateLimit`, Cloudflare's own shape and
  the name `forge cf gen env` emits. `MiddlewareChainOptions` gains `rateLimits`, the generated `RATELIMITS` table, which the chain publishes
  on every request. `applyMiddlewareChain` throws at registration, naming the group's paths, where a group's binding is declared neither in
  `bindings` nor in a contribution's binding specs, or is not a key of `rateLimits`, and where `bindings` is not a valibot object schema to
  find it in. A route-level `rateLimit` whose binding is missing from a published `rateLimits` throws on the request. A group's `rateLimit`
  also takes an array, run in order, and `RateLimitOptions` gains `methods`, every method by default; a request by any other passes without
  calling the binding. **Migration:** replace `limiter: (c) => c.env.MAIN_LIMITER` with `binding: "MAIN_LIMITER"`, and `RateLimitBinding`
  with `RateLimit`. Run `forge cf gen env` and pass the generated `RATELIMITS` to `applyMiddlewareChain` as `rateLimits`. Declare each
  group's binding in the chain's `bindings`, as a `v.object` entry, or as a contribution's `BindingSpec`: required to fail every path when it
  is absent, optional to answer `503` on its own paths only, and there only for the methods its limit counts. A `bindings` schema that is not a valibot object schema, such as a
  `v.intersect`, moves the rate-limit binding to a contribution's `BindingSpec`.
- **Sign-out destroys the session.** `clearAuthSession` deletes the D1 row, then calls `destroy()`, so the cookie is cleared and the next
  request starts a fresh session: visitor data set before sign-out is gone. A store failure still answers its error and leaves the session
  intact. `AuthWebOptions.signOut: { keepVisitorData: true }` keeps the old behaviour, dropping only the auth keys and rotating the id, and
  `clearAuthSession` takes the same value as its third argument. With `signoutClearsSiteData`, the storage clear a sign-out owes is marked by
  a five-minute `__Host-auth-site-data-owed` cookie instead of a session key, because the session is destroyed; `signoutSiteData` and the next
  sign-in clear it. Under `keepVisitorData` the mark stays on the session.
  **Migration:** move visitor data that must outlive a sign-out into the browser, such as a form draft in `sessionStorage`, or pass
  `signOut: { keepVisitorData: true }` to the auth options. A caller of `clearAuthSession` that writes to the session afterwards passes the
  same option, or writes before the call, because a destroyed session throws on `set`.
- **A step-up refused for a spent attempt budget answers `429`, not `422`.** The verify page and its failure panel re-render as before, at `429`,
  with `Retry-After` set to the factor's `attemptWindowMs` in whole seconds: an emailed code's `guessWindowMs`, an authenticator app's or a
  recovery code's `lockoutMs`. A factor that reports no window answers `429` without it. The primary sign-in keeps `422` for a throttle, the
  same answer as a code that did not match, so the status cannot tell an attacker the address has an account. **Migration:** a client or
  test that read `422` as a step-up throttle reads `429`, and may honour `Retry-After`.
- **`createAuthGuards` recovers a CSRF-refused sign-out itself, takes `onRefuse` for its HTML groups, and its JSON groups answer in
  problem+json.** A sign-out `POST` refused for its token answers a `303` to the confirm page (a `204` with `HX-Redirect` under htmx) on every
  mount, with no hook passed. `createAuthGuards`' `onRefuse` answers its HTML groups' origin, rate-limit, CSRF and `require-admin` refusals,
  and one it declines passes to the chain's. The `ceremony` and `passkeyCeremony` groups answer every origin, rate-limit and CSRF refusal with
  `refuseAsProblem()` whatever is passed. The passkey client reads that `application/problem+json` on a `400`, `403`, `413`, `429` or `503`
  and reports its status as `PasskeyOutcomeDetail.status`. `authCsrfRefusal(paths)` stays exported as a `RefuseHook` that answers only the
  sign-out refusal and declines every other. **Migration:** delete `onForbidden: authCsrfRefusal(paths.auth)` from the CSRF policy and pass no
  hook for sign-out recovery. Pass `createAuthGuards({ …, onRefuse })` only for the refusals your pages render, returning `undefined` for the
  rest. A client of the ceremony endpoints that read a plain-text refusal body reads `application/problem+json`.
- **Every chain guard refuses through one hook, `onRefuse(c, refusal)`, and the per-guard hooks are removed.** The CSRF policy's
  `onForbidden`, `rateLimit`'s `onLimit` and `requireAdmin`'s and `createAuthGuards`' `onForbidden` are gone. `applyMiddlewareChain`, each
  guard group, `originProtection`, `rateLimit` and `requireAdmin` take `onRefuse`, which receives a `Refusal` (exported from
  `@y-core/forge/context`) narrowed by `guard`. A hook returns `Response | undefined`: `undefined` declines, passing the refusal to the next
  hook out — the guard's own, its group's, the chain's — and then to forge's plain-text default, and `Retry-After` is kept whichever answers.
  A CSRF body over `maxBytes` now goes through the hook as `413` reason `too-large`, and a body the policy cannot parse answers `400` reason
  `unreadable-body` where it answered `403` `missing-token`. Every `503` from `rateLimit` — absent binding, failed key, failed binding — goes
  through the hook too. Every refusal is logged as `security.<guard>.refused`, at `warn` for a 4xx and `error` for a 5xx, an absent binding
  in a strict build included, except that a guard writes one line per minute for repeated identical `429`s, and the next line it writes
  carries the count it held back as `collapsed`; the `rate-limit` source's own key and binding failure lines are replaced by it. A
  hand-wired `csrfVerifyStage` takes the answer to refuse with. **Migration:** move `csrf.onForbidden: (c, reason) => …` to `applyMiddlewareChain`'s `onRefuse: (c, refusal) => …`,
  reading `refusal.reason`, or onto the guard group whose paths it served; replace `onLimit: (c) => …` with `onRefuse: (c, refusal) => …`;
  replace `onForbidden` on `requireAdmin` and `createAuthGuards` with `onRefuse`. Return `undefined` from a hook for a refusal it does not
  render, and handle an `undefined` result where code calls a `RefuseHook` itself. A client that branched on `403` for an unparseable CSRF
  body branches on `400`. A log query on `form.refused` or the `rate-limit` source's failure lines reads `security.csrf.refused` and
  `security.rate-limit.refused`.
- **`authNav` mints its sign-out token through the app's CSRF policy, and `csrfMinter`, `CsrfMinterOptions` and `authNav`'s `ring` are
  removed.** `authNav` bound its token to the session id with a ring of its own, so under a policy with any other `subject` its sign-out token
  never verified. It now calls `mintCsrf`, under the policy's ring and subject; on a request the policy does not cover, a signed-in viewer
  gets a link to the sign-out confirm page in place of the form. **Migration:** drop `ring` from `authNav({…})`. Replace
  `csrfMinter({ ring, subject })(c, path)` with `mintCsrf(c, path)` on a request the policy covers, and put a target that was minted with
  `subject: false` in the policy's `unboundPaths`.
- **`testing/d1` no longer re-exports `sql`, and `explainPlan` takes the query's text and parameters** where it took a fragment. A fragment
  is only ever read by the copy of `storage/db` that minted it, so its brand is a private `Symbol()` again. **Migration:** import `sql` from
  `@y-core/forge/storage/db`, and rewrite `explainPlan(db, fragment)` as `explainPlan(db, fragment.text, fragment.params)`.
- **A resolver forge caches per `env` is handed the `env`, not the request context.** `KeyRingResolver` is now `(env: Bindings) => KeyRing |
  Promise<KeyRing>`, and so is every `ring` built on it: `csrfMintStage`, the chain's `csrf` policy, `createAnonymousSession`, `createFlash`,
  `defineApproval`, `signedObjectLink`, `resolveAuthServices` and `createKeyRingResolver`, each resolved once per `env`.
  `createAnonymousSession`'s `kv` is now `(env: Bindings) => SessionKVBinding` as well. The cached value is keyed on `env`, so a
  resolver that read `c.url.host` or the session answered every later request with the first one's result. **Migration:** rewrite
  `ring: (c) => importKeyRing([c.env.SECRET])` as `ring: (bindings) => importKeyRing([bindings.SECRET])` and `kv: (c) => c.env.KV` as
  `kv: (bindings) => bindings.KV`, and drop a `getAppContext(c).env` inside one. Neither a ring nor a session KV binding can differ per host; a
  secret that does must be resolved per request outside it. Drop a `createKeyRingResolver(…)` wrapper around a `ring` and pass the
  `(bindings) => importKeyRing(…)` function itself: a `ring` option now refuses the wrapper in its type and throws at construction when handed
  one. Keep `createKeyRingResolver` only for a ring you resolve yourself inside a handler. A resolver still written over the request
  context now throws on its first request, naming that rewrite, instead of failing on an opaque `TypeError`.
- **A `ring` reads only the bindings it is typed over.** `KeyRingResolver`'s default `Bindings` is `Record<string, unknown>`, where it was
  `any`. `AuthOptions`, `CsrfPolicyOptions` and `MiddlewareCsrfPolicy` take a `Bindings` parameter, and `ring` on `authRequestServices`'
  `auth`, `resolveAuthServices`, `csrfMintStage`, the chain's `csrf` policy and `defineApproval` is typed over the bindings the call names.
  A binding the app's `Bindings` does not declare is a compile error. So is a stale `(c) => configStore.get(c.env)`, which used to compile and
  then answer `500` on its first request. Under the default bindings each binding reads as `unknown`. **Migration:** name the app's bindings
  where the ring is passed: `applyMiddlewareChain<AppEnv>(app, …)`, `authRequestServices<AppEnv>(…)`, `defineApproval<AppEnv>(…)`, or
  `AuthOptions<AppEnv>` on a standalone object. Rewrite a stale ring as `(env) => …configStore.get(env)…`. A value typed as the bare
  `KeyRingResolver` or `AuthOptions` that reads a binding becomes `KeyRingResolver<AppEnv>` or `AuthOptions<AppEnv>`.
- **Trust in Cloudflare headers is declared once, on the chain: `RateLimitOptions.trustCfHeaders` is gone, and `buildGuardChain` is no
  longer exported.** `applyMiddlewareChain`'s `trustCfHeaders` is published on the request, and every rate limit's client-IP key, by default
  or with `keySuffix`, reads it: a guard group's, a route's and an approval's. A guard group's or an approval's limit with no `key` under a
  chain without `trustCfHeaders: true` throws at registration, naming the group's paths. A route-level `rateLimit` with no `key` where no
  chain published trust answers `503` with reason `key-failed` through the refusal hook, logged, instead of throwing at construction.
  `buildGuardChain` leaves `@y-core/forge/app`. **Migration:** delete `trustCfHeaders` from every `rateLimit` and set `trustCfHeaders: true`
  once on `applyMiddlewareChain`; off Cloudflare, or in an app that wires `app.use` without the chain, pass a custom `key`. Move a group
  mounted with `buildGuardChain` to the chain's `guards`. A custom `key` replaces the client-IP key whatever the trust, so to extend the IP
  key pass `keySuffix` instead.
- **An approval's guards are a chain contribution, and `registerApproval` takes no `trustCfHeaders`.** `defineApproval` returns
  `approval.contribution`, which carries the prompt's origin check and rate limit as a guard group; `registerApproval(app, approval)` only
  maps the prompt. A chain group covering the approval's path used to verify the CSRF token before the approval's origin check and rate
  limit ran; both now run first. The approval's limit keys under the chain's `trustCfHeaders`. A prompt whose contribution never reached the
  chain answers 500 rather than serving unguarded. A `trustCfHeaders` on an approval's or a group's `rateLimit` is now a type error.
  **Migration:** replace `registerApproval(app, approval, { trustCfHeaders: true })` with `registerApproval(app, approval)`, add `approval.contribution` to `applyMiddlewareChain`'s `contributions`, and set `trustCfHeaders: true`
  on the chain. Delete `trustCfHeaders` from the approval's `rateLimit`.
- **`createAuthGuards` refuses a `rateLimit` key that names no group, or one no group holds or inherits.** It throws at construction
  instead of dropping the limit silently. A key on the bare `admin` group is held by `admin.users` and `admin.elevate` through inheritance.
  **Migration:** remove a key the error names.
- **`createAuthGuards` gives a keyless group its nearest keyed ancestor's `rateLimit`, keyed per route, and refuses a group with neither.**
  A group with no key of its own takes the options of the nearest ancestor `rateLimit` keys, every limit in an array included, with the
  matched route pattern appended to its key (`routeKeySuffix`, or `${key(c)}:<pattern>` for a custom `key`), so two routes never share a
  budget and a request is charged once; an ancestor keyed `keySuffix: routeKeySuffix` already carries the pattern, so its key is inherited
  unchanged as `<ip>:<pattern>`. `false` mounts a group, and every keyless group under it, with no limit. A group holding routes of
  its own with no keyed ancestor throws at construction, naming every such group, where it mounted with no limit. Omitting `rateLimit`
  altogether still mounts no limits. **Migration:** key each named group, or an ancestor of it, a limit, or set it to `false` to mount it
  without one. A subgroup keyed only to repeat its parent's options can drop its key, which moves it to per-route budgets.
- **`csrfProtection` is removed from `@y-core/forge/form`: an app has one CSRF policy, supplied by the chain.** `applyMiddlewareChain`
  mints it right after the session and verifies a mutation once, after the request's origin check and rate limit, and forge's router
  verifies anything still unchecked after every `app.use` registration. There is no inline verifier, so a route's own `middleware` array
  no longer carries one. `CsrfProtectionOptions` is renamed `CsrfPolicyOptions`. **Migration:** pass its options as `csrf: {…}`, or put a
  route with its own guards in a guard group; rename `CsrfProtectionOptions` to `CsrfPolicyOptions`. An app wiring `app.use` by hand
  mounts `csrfMintStage(options)` where it mounted `csrfProtection`.
- **`applyMiddlewareChain` runs every matching guard group's origin check and rate limit before any group's `guards`.** It registered each
  group whole in turn, so an earlier group's guards ran ahead of a later group's rate limit on a URL both match. **Migration:** a rate-limit
  `key` must not read what a group's guards set; take identity from a `globals` middleware such as `resolveAuth` instead.
- **`createPrimaryNav` takes the app's contributions as a list, and `contribute` is removed.** Call
  `createPrimaryNav<Key, Ctx, State>([homeNav, notebooksNav])` from the app root, where each slice exports its `NavContribution` as a plain
  const; the bar renders in list order. Every bar-level menu and megamenu now carries a required `key`, and menus that share a `key` render as
  one, keeping the first one's position and listing children in list order. A nested submenu is never merged. `createPrimaryNav` throws when:
  - menus sharing a `key` have different `label`s;
  - a joining menu declares `filters` that differ, as a set, from the first one's, or a joining megamenu declares a different `align`;
  - a menu and a megamenu share a `key`;
  - a bar or footer link, at any depth, names a key no contribution gives an href;
  - two contributions carry one `hrefs` key, or an entry is labelled "Menu", as `contribute` did.

  **Migration:** replace each `nav.contribute(x)` with `export const x: NavContribution<…> = …` in the slice, and pass the list of them to
  `createPrimaryNav` in the app root. Give every menu and megamenu a `key`, the same one on menus meant to merge.
- **A caller can no longer change `createPrimaryNav`'s bar or footer after it is built.** `createPrimaryNav` freezes the copies it stores, so
  pushing into a menu's `items`, a megamenu's `groups` or a group's `group` taken from `definition()` throws a `TypeError`. It copies footer
  links too, so changing a footer object the caller kept no longer changes what `footer()` returns. Before, either change reached every later
  request and got around the refusals. `NavDefinition` and the types it holds (`NavSection`, `NavSectionItem`, `NavItem`, `NavLink`,
  `NavMenu`, `NavMegaMenu`, `NavSlot`, `NavGroup`) are now readonly all the way down, so such a write does not compile either.
  **Migration:** build a new definition in place of code that writes into one.
- **`readPdfFontPack` and `readPdfEmbeddedFonts` validate the pack and return a `PdfResult`.** Each takes the parsed JSON as `unknown` and
  refuses a pack whose fields are missing, non-finite, outside the style picklist, with a non-positive `unitsPerEm`, or whose `advances`,
  `glyphs` or `kerning` keys are not code points, as the new `PdfRenderError` kind `"font-pack"`. A code point key is a decimal from `0` to
  `1114111` (U+10FFFF) with no leading zero, so `"065"` is refused rather than read as `65`. The message names the field, cut at the record,
  so no input key reaches it. Before, either reader trusted the caller's cast, so a malformed pack reached the engine unchecked.
  **Migration:** replace `packs.map(readPdfFontPack)` with a map that collects each `ok` result's `data` and refuses on the first `error`,
  and drop the `as PdfFontPackData[]` cast on the parsed `packs.json`.
- **`oxlint.base.json` refuses a global `Bun`, `Buffer` or `process` in Worker source**, through `eslint/no-restricted-globals`, and
  `globalThis.process` too. Through `eslint/no-restricted-imports` it also refuses an import of `node:process`, `process`, `node:buffer` or
  `buffer`, since an imported name is out of the global ban's reach. So an app whose Worker source names or imports one now fails `lint`. Both
  bans are off for `config/`, `scripts/`, `tests/`, `playwright.config.ts`, `*.workerd.ts` and `*.browser.ts`, and a `*.test.ts` keeps only the
  `Bun` ban. To match, `testing/bun` now declares `"bun"`'s `file`, `write` and `spawnSync`, the `bun:test` modifiers and `.each`, and
  `expect`'s statics and asymmetric matchers, and `testing/node` declares `node:buffer`. **Migration:** in Worker source, use `Uint8Array` for
  `Buffer` and the env binding for `process.env`; import `Bun` as `import { file } from "bun"` in a spec; or move the code into build-time
  tooling, where `import process from "node:process"` and `import { Buffer } from "node:buffer"` pass. An app that kept `bun-types` for these
  calls can then remove it.
- **A rate-limit `503` answers `Service Unavailable` by default, not `Service unavailable`**, the spelling `auth/web`'s guards already use.
  **Migration:** a test or client that matched the default `503` body exactly reads `Service Unavailable`.
- **`AuthNav` is removed from `@y-core/forge/auth/web`; `authNav` returns `NavState` from `@y-core/forge/ui/chrome`**, whose slots are typed
  `JSXNode | NavSlotRender`. **Migration:** replace `AuthNav` with `import type { NavState } from "@y-core/forge/ui/chrome"`, and where you
  call the sign-out slot yourself, check `typeof slot === "function"` before calling it.
- **The error boundary's records go through the request logger when one exists, once each, as `Unhandled error`.** A request logger's
  `unhandled error` record is now `Unhandled error`, tagged `data.source: "app"`, and `onError override threw` reaches the chain's
  `logging.channels` too. `createApp({ logger })` takes neither record then, and keeps them only where no request logger is on the context,
  such as a throw before `requestLogger` runs. **Migration:** match `Unhandled error` where a log query or test matched `unhandled error`,
  and drop a `createApp({ logger })` built only to route these records into the app's channels.
- **`createChallengeStore` and `createNonceStore` refuse a `prefix` that holds `||` or ends in `|`**, throwing at the call, because a key under
  it could match another prefix's. **Migration:** choose a prefix without either. The new prefix sees no challenge or spent nonce stored under
  the old one, so a ceremony in flight at the deploy fails, and a single-use token spent just before it can be spent once more within its
  lifetime.
- **Every prebuilt node bundle is named `<stem>.node.mjs`.** A bundle beside its source as `<stem>.mjs` shadowed it under bun, which
  resolves an extensionless relative import inside `node_modules` to the `.mjs` first. The export map names the new files, so every subpath
  imports as before. Forge's own gate gains a `validate-bundle-shadows` row, which refuses a `.mjs`, `.js` or `.cjs`, or an `index` of one,
  that an extensionless relative import reaches. No preset emits it: a consumer that ships `.mjs` beside `.ts` adds `bundleShadowStep` to its
  own gate. **Migration:** a path that names a bundle file directly, such as
  `node_modules/@y-core/forge/src/tooling/lint/plugin.mjs` in an oxlint `jsPlugins` entry, adds `.node` before `.mjs`. An app extending
  `oxlint.base.json` needs no change.
- **`cloudflareWorkerSteps()` adds `validate-consumer-css-sources` whenever `assetConfig` is set, so an app rendering forge markup without its
  classes fails the gate.** The row fails when no `css[].input` reaches `@import "@y-core/forge/<ns>/sources.css"` for a forge namespace whose
  markup the app's non-test source imports: a value import whose subpath's source entry reaches, through the installed forge's own value
  imports, a module under `<ns>` that declares classes. So `@y-core/forge/logging` and `@y-core/forge/auth` require nothing,
  `logging/viewer` requires `logging/sources.css`, and `app` requires `app/sources.css` and `render/htmx/sources.css`, whose fragment markup
  its error page renders. An entry reaches the import directly or through the relative `@import`s it follows, so a print or email sheet
  without it passes beside a main sheet that has it. The source scanned is `src`, or the `consumerCssSources.sources` the preset is given.
  `consumerCssSourcesStep` and `checkConsumerCssSources` are exported from `@y-core/forge/tooling/gate`. **Migration:** add each `@import`
  the row names to the app's main stylesheet.
- **`cloudflareWorkerSteps()` adds `validate-service-worker` whenever `assetConfig` is set, so a stale built `sw.js` fails before `test`.**
  An asset build with a `js.serviceWorker` writes `sw.inputs.json` beside the generated assets module. It records the worker's entry, the
  SHA-256 of `sw.js` and of its build options, the SHA-256 of every file its bundle read, and of the files that steered resolution:
  `tsconfig.json` and what it extends, each supplying package's `package.json`, the app's own `package.json` or its absence and, with none
  at the root, the nearest one above it, and the nearest `package.json` of every input outside `node_modules`, a symlinked workspace
  package's included. Its paths are relative to the app root, so the row reads the same record from a subdirectory. The row, on `static`
  after `validate-asset-manifest`, rehashes those files without building. It fails on every tier when one changed or is gone, when `sw.js` is
  missing or was rewritten, or when the config builds another entry or with other options, naming the file and the rebuild. With no record,
  it passes `static` and fails above. `serviceWorkerStep`, `checkServiceWorker` and `ServiceWorkerCheckConfig` are exported from
  `@y-core/forge/tooling/gate`. **Migration:** run `build:assets` once after upgrading, since a worker built before has no record.
- **`context.url` is read-only once forge has the request.** Once an `app.use` or route middleware changes its `href` in place, the
  fragment included, or assigns it a new `URL`, forge runs no later middleware or handler: it throws an error naming the resolved and
  rewritten paths, and the error boundary answers `500`. So does a handler that does either and then returns a `405`. An in-place rewrite used to dispatch the original path's route, and a
  reassignment the new one, while the guards and `matchedRoutePattern` judged whichever URL they read. **Migration:** strip a prefix or
  mount a subpath in the Worker's `fetch` export, passing `app.fetch` a `Request` rebuilt on the rewritten URL.

- **A CSRF policy that leaves an auth route or the approval prompt uncovered throws at registration.** `MiddlewareContribution` and
  `MiddlewareGuardGroup` gain `csrfCovers`, sample URLs of the routes an owner mints tokens on: every group `createAuthGuards` returns lists
  one for each route its `routes` maps, so a group spread into another contribution keeps them, and `approval.contribution` lists the
  prompt's `path`. `applyMiddlewareChain` refuses a chain with no `csrf` policy, `paths` that miss one, or an `exclude` entry that matches
  one, naming the URL, the contribution or guard group listing it, and the `paths` or the entry. An `exclude` covering the mount used to
  register and answer `500` on the sign-out confirm page. **Migration:** pass a `csrf` policy whose `paths` cover the auth mount and whose
  `exclude` stays beside it.
### Added

- **`forge release` takes `tagOn: "pushed"`**, for a clone whose push flow may give the release commit a new sha: the run commits and cuts no tag,
  and once the commit is on the publishing branch the next run fetches, checks that the branch's tip carries the gated tree and the subject
  `chore: release <V>`, tags that tip and pushes only the tag, leaving the host `git push && git push --tags`. A mismatch refuses as
  `publishing-mismatch`, and a refused tag push deletes the local tag again as `tag-push-failed`. The gate record is now keyed on the base tree,
  so a release resumed after the push's squash does not rerun its gate, and a record from before reruns it once.
- **`attemptWindowMs` on the factor contract**, the longest a spent attempt budget goes on refusing. `createEmailOtpFactor` reports its
  `guessWindowMs`, and `createTotpAppFactor` and `createRecoveryCodeFactor` their `lockoutMs`; a passkey reports none. The field is
  optional, so a factor written outside forge keeps compiling and sends no `Retry-After`.
- **A rate-limit `429` carries `Retry-After`, the binding's `period` in seconds.** The `rate-limit` `429` `Refusal` gains `retryAfter`, read
  from the `rateLimits` table the chain publishes, and forge sets `Retry-After` on the default answer and on a hook's response unless the hook
  set its own. A `rateLimit` on a request no chain published `rateLimits` for knows no period, so its refusal carries no `retryAfter` and its
  `429` no `Retry-After`. No `RateLimit` or `RateLimit-Policy` header is sent.
- **`defineAction` and `definePage` take `rateLimit`, a limit keyed by identity or a route param.** It takes `RateLimitOptions` or an array
  of them and runs first in the submission pipeline's guard step: after the chain's CSRF verify and the route's own middleware, with
  `c.params` resolved, and ahead of Turnstile and the schema. Each limit spends in order, and a refusal answers through the hook with the
  `429` and `503`s a `rateLimit` middleware answers. `definePage` refuses `rateLimit` without a `schema`, as it refuses the other pipeline
  options. A `GET` page or a route without a `schema` keeps `rateLimit` in its controller `middleware`.

- **`originProtection({ missing: "allow" })`, also a guard group's `origin: { …, missing: "allow" }`**, admits a mutating request carrying
  no `Origin`, `Referer` or `Sec-Fetch-Site`, for an endpoint called by a server or a tool such as an MCP endpoint or a CSP report receiver.
  A disallowed `Origin` or `Referer`, a `cross-site` or `same-site` `Sec-Fetch-Site`, and a WebSocket upgrade without `Origin` are still
  refused. The default stays `"refuse"`.
- **`refuseAsFragment` and `refuseAsProblem` in `@y-core/forge/app`**, the two refusal hooks an app passes as `onRefuse`.
  `refuseAsProblem()` answers RFC 9457 `application/problem+json` (`type` `about:blank`, the status phrase as `title`, the `status`, no
  detail and never the reason). `refuseAsFragment({ target, swap?, render })` answers the panel `render(c, refusal)` returns, marked with
  `ANNOUNCE_FAILURE_ATTR` so the announcer speaks its message, keeping the refusal's status; under htmx it sets `HX-Retarget` and
  `HX-Reswap` (default `innerHTML`), and a plain request gets the same panel as an HTML body.
- **The chain's CSRF policy takes `unboundPaths`: path patterns whose tokens carry no subject, beside `paths` and `exclude`.** The token's
  target path decides, at mint and at verify, so a page can carry an unbound contact token beside a bound sign-out token, and a contact `POST`
  with no session passes. The patterns compile when the chain is built, so a malformed one throws at registration. `csrfMintStage` takes the
  same decision as an optional second argument, `isUnbound(target: URL)`.
- **`tagsOf`, `elementsOf` and `attrValuesOf` in `testing/markup` and `testing` read every match**, in document order, where `tagOf`,
  `elementOf` and `attrOf` read the first. A nested element of the same name is an entry of its own, and `attrValuesOf` skips a matched
  element that does not carry the attribute.
- **`fakeAssetsFetcher` serves bytes and content types, and records requests.** An entry is a string, a `Uint8Array` or
  `{ body, type }`. The content type comes from `type`, or else from the file extension, and every path asked for is listed on `requests`.
- **`forge db standby reset --empty` empties the standby database and stops**, applying no migration and no seed, so `forge db restore` can
  restore into it with `--target standby --into standby:<binding>`. It implies `--no-seed`, and passing both is accepted.
- **`originProtection` takes an `onRefuse(c, refusal)` hook and logs every refusal.** Each refusal records a `security.origin.refused`
  warning through the request logger with its reason (`cross-site`, `same-site`, `disallowed` or `missing`), then answers through the hook,
  falling to the chain's and then a bare `403` when it declines or none is given. A guard group's `origin` option takes the hook too.
- **`rateLimit` takes a `keySuffix` option that extends the client-IP key**, keying by `<ip>:<suffix>` through forge's own
  `CF-Connecting-IP` read, so an absent IP still answers `503`. It keys only under the chain's `trustCfHeaders: true` and excludes `key`;
  `rateLimit` throws at construction when given both.
- **`@y-core/forge/testing/markup` imports under node.** It carries `elementOf`, `innerOf`, `attrOf`, `attrsOf`, `tagOf`, `classesOf` and
  `variantClasses` as a prebuilt bundle, so a Playwright or workerd spec run by node can read one element out of a page without a local copy.
  `@y-core/forge/testing` still exports them.
- **`@y-core/forge/testing/zone` exports `zoneAllows(expression, path)`**, which answers whether a `buildAllowExpression` predicate admits a
  request path, bounded-wildcard clauses included, and throws on syntax it does not evaluate. An app tests its zone allow-list against forge's
  output without a parser of its own. It imports under node.
- **`createHealthChecks(list)` merges the health checks each feature slice exports.** Each slice exports its checks as a plain object, and
  the app root passes the list; the route maps `handler()`, which reports the checks in list order. A name two slices both use throws, and
  the result is frozen.
- **`createContributionSlots<Shape>(list)` gives an app typed, ordered slots**, such as home-page sections, that feature slices fill by
  exporting a plain object of item lists. Each slot holds its items in list order and is frozen; an unfilled slot reads as an empty list, and
  one item object listed twice throws.
- **`applyMiddlewareChain` takes `contributions`, a list of `MiddlewareContribution`**, each carrying `bindings`, a `session`, `globals` and
  `guards` that join the chain after the options' own, in array order. A second session, a binding name contributed twice, or a contribution
  carrying a `csrf` policy throws at registration; the policy comes from the options alone.
- **`matchedRoutePattern` is set before the first `app.use` middleware runs**, so a guard reads the pattern of the route a request matched
  before `next()`. It stays unset when no route matches the URL and method.
- **`routeKeySuffix` keys a rate limit per route rather than per URL.** Passed as `keySuffix`, it keys by `<ip>:<pattern>`, so
  `/admin/users/1` and `/admin/users/2` share the budget of `/admin/users/:id`; every request no route matches shares `<ip>:<unmatched>`.
- **`applyMiddlewareChain` takes `csrf`, the app's one `MiddlewareCsrfPolicy`.** It takes `CsrfPolicyOptions` plus `paths`, which
  defaults to `["*"]`, and `exclude`. The chain mints on
  the policy's paths right after the session, and verifies a mutation once, after every matching guard group's shape, origin check and
  rate limit and before any group's guards; a group with an origin check, a rate limit or guards carries the verify. Forge's router
  verifies anything still unchecked after every `app.use` registration. The `ring` and `subject` are resolved only when a token is minted
  or verified.
- **A guard group takes `shape`**, request-shape guards such as method and content-type checks, which run ahead of its `origin`.
- **`csrfMintStage(options)`** publishes the CSRF minter, field and header, and on a mutation arms the verification forge runs later.
- **`readPdfArtwork(json)`** checks a parsed mark artifact and returns it as `PdfArtwork`, or refuses it with the new `PdfRenderError` kind
  `"artwork"`, naming the malformed field but never its value. Use it in place of `JSON.parse(...) as PdfArtwork`.
- **`@y-core/forge/tooling/assets/types` carries the asset pipeline's config types without Node**, so a Worker app's tests compiled under
  `"types": []` can import `AssetsConfig` and the rest, which the `tooling/assets` barrel's Node-only modules break.
- **`TURNSTILE_TEST_KEYS` carries Cloudflare's Turnstile testing keys**, exported by `@y-core/forge/testing/form` and `@y-core/forge/testing`:
  the `site` keys `pass`, `block`, `invisible` and `interactive`, the `secret` keys `pass`, `fail` and `spent`, and the dummy `token`. A test
  imports them instead of copying the literals.
- **`captureLogs()` in `@y-core/forge/testing` collects log records in memory for a test to assert on.** It returns `{ logger, channel,
  records }`; records are redacted as a production logger's are, and a `child` of the logger writes to the same `records`. Pass `logger` to
  `createTestContext`, or to a constructor that takes one, such as `createD1Client`.
- **`quietChannel()` in `@y-core/forge/testing` returns a `LogChannel` that drops every record**, for a spec that drives the app through its
  composition root and asserts on no log. The app takes its channels as a parameter and the spec passes this one, or `captureLogs().channel`
  to assert; `src/testing/README.md` shows the wiring. Forge has no process-wide channel to swap.
- **`openBunD1()` in `@y-core/forge/testing/d1/bun` opens a migrated D1 on `bun:sqlite` for `bun test`**, with no workerd process. It takes
  `openTestD1`'s options and returns its `TestD1`: migrations apply in wrangler's numeric order, foreign keys are on, a `batch` is one
  transaction that rolls back whole and answers each statement's rows, `first(column)` refuses a missing column as D1 does, and `reset` drops
  every object the app made and migrates again. An app deletes its own `bun:sqlite` adapter.
- **`SecurityEventListView` in `@y-core/forge/auth/web`** renders an account's security events from `AuthSecurityEventStore.listByUser`,
  newest first. Each row names the event and the factor it concerned, dates it, and says "by an administrator" where one made the change;
  it never shows a session or administrator id. It is mounted on no route and does not page. Exported beside it:
  `AUTH_SECURITY_EVENT_LIST_ID` and `SecurityEventListViewProps`.
- **`cors` takes an origins resolver.** `origins` accepts `(env) => readonly string[] | Promise<readonly string[]>` beside a static list. It
  resolves once per `env` object, reuses the compiled matcher until the env changes, and retries after a rejection, so an allowlist read from
  validated config no longer needs a wrapper that rebuilds `cors` on every request. In resolver mode `Vary: Origin` is always sent. A resolved
  `"*"` with `credentials: true` throws at first resolution and answers that request with a `500`.
- **`memoizePerEnv` in `@y-core/forge/context`** wraps `(env) => T` so it runs once per `env` object, and retries after a rejection
  instead of caching it. It hands the computation the `env` alone, so no request can leak into a value every later request shares.
  `createKeyRingResolver` is built on it.
- **`signedObjectLink({ ring, onRefuse? })` in `@y-core/forge/storage/r2`** verifies a signed object URL and exposes the verified key
  through `signedObjectKey`. A bad link gets a bare `403` that does not reveal the reason; the reason is logged, and `onRefuse` can replace
  the answer. An app deletes its hand-written `verifySignedObjectUrl` wrapper.
- **`exclude` on `MiddlewareGuardGroup`, and a `{ middleware, exclude }` entry (`MiddlewareGlobal`) for `globals`** in
  `applyMiddlewareChain`'s options and in contributions, so a guard group or a global skips a subtree such as `/api/*` without testing the
  path inside the middleware. Each group's patterns compile into one matcher that its stages share per request, and a bad pattern throws
  before anything is registered.
- **`createWebhookSigningResolver((env) => options)` in `@y-core/forge/security`** builds a `createWebhookSigning` instance once per
  `env`, so an app-level signer can read its secrets from a Worker secret; a build that throws is retried by the next request. Beside it, `WebhookSecretSchema`
  validates a comma-joined list of `whsec_` secrets, each base64 of at least 32 bytes, and `parseWebhookSecrets` splits that list for
  `createWebhookSigning`'s `secrets`.
- **`NavState` and `resolveNavState(nav, c)` in `@y-core/forge/ui/chrome`.** `resolveNavState` runs every resolver a `createPrimaryNav`
  contribution supplied and merges the results, in registration order, into the `activeFilters` and `slots` a `Navbar` takes. Each filter
  token appears once, and a slot filled by two contributions throws instead of the later one silently winning.
- **`definePage` validates the query string.** A `query` schema is parsed from `c.url.searchParams` before the action and the loader, on every
  method, and the loader receives its output as a typed third argument, `(c, config, query)`; a two-argument loader still compiles. A refused
  query answers `400` naming the failing field, under the page's `cache` and `headers`, and neither the action, the loader nor the view runs.
  `onQueryError` receives the issues and replaces that refusal.
- **`isSafeMethod(method)` in `@y-core/forge/security`** reports whether a method is safe by RFC 9110 — GET, HEAD, OPTIONS or TRACE — in
  any letter case, the same answer as the predicate forge's own pipeline uses. CSRF verification is deliberately narrower: it exempts GET
  and HEAD only, so an OPTIONS or TRACE request an app routes to a handler is still verified.
- **`authRequestServices` in `@y-core/forge/auth/web` builds a request's whole `AuthRequestServices` from one D1 client**, once per request
  however often guards, loaders and actions ask. It hands one `FactorStore` to the registry, `enrolments` and every second factor.
  `secondFactors` declares `passkey` and `"totp-app"` with their `requirement`; any one brings recovery codes. `address` defaults to the
  account's email. `defer`, `notifier` and `confirmUrl` stay yours to supply.
  - **`.sessions(c)`, the guards' path, builds the session store alone**, under one `sessionOptions` lifetime, so a request through
    `resolveAuth`, `requireAuth` or the other guards builds no factor and no flow, and does not ask for the `notifier`, `defer` or `logger`.
    The factors and flows are built when the services are first asked for, once per request.
  - **`prefixes: { challenge, nonce }` names the KV prefixes of its challenge and nonce stores**, `auth:challenge` and `auth:nonce` by
    default. An app moving to it from hand-built stores restates their prefixes: under new ones its in-flight ceremonies are lost, and a
    single-use token spent just before the deploy can be spent once more within its lifetime. A prefix that is not a string, is empty, holds
    `||` or ends in `|` throws at the call.
  - **Its factors and flows log through the request logger**, under `data.source: "auth"`, or to the console without one.
    `logger: (c) => Logger` chooses another.
  - **`AuthPasskeyOffer.rpName` and `AuthTotpAppOffer.issuer` take a function of the request**, as `rpId` and `origin` do, so either can be
    read off `c.env`; a plain string still works, and `AuthTotpAppOffer` gains a `Bindings` parameter. An empty, whitespace-only or non-string
    `rpName` or `issuer`, or an `issuer` holding `:`, is refused, naming the field: a literal throws at the call, and a resolver's value rejects
    `await resolve(c)` and leaves the guards' session store standing. An authenticator splits the `otpauth://` label at the first colon, so
    such an issuer would disagree with its own `issuer=` parameter. `createTotpAppFactor` and `createPasskeyFactor` called directly do not
    check.
- **`attachPrecache(scope, plan)` in the new browser-tier `@y-core/forge/assets/client`** registers a service worker's precache handlers.
  Given `{ urls: PRECACHE_URLS, version: PRECACHE_VERSION, fallback }`, it precaches the shell (and `fallback`) on install under
  `forge-precache {registration.scope} {version}`, fetched with `credentials: "omit"` so no signed-in page outlives sign-out in the cache. On
  activate it drops older precaches of its own scope only, leaving another same-origin worker's and the app's own caches alone. It serves a
  precached URL from the cache, and answers a navigation the network cannot reach with `fallback`. `ServiceWorkerScope` declares only what it
  uses, `registration.scope` included, so the worker typechecks under the app's own `tsconfig`; the `js.serviceWorker` README snippet is now
  one `attachPrecache` call.
- **`fakeCacheStorage()` in `@y-core/forge/testing`** stands in for `caches` under `attachPrecache`. Its `addAll` takes URLs or `Request`s, fetches
  through the `fetch` it is given and stores nothing unless every response is ok.
- **`buildRequest` takes `mode` and `credentials`**, set only when given. Both are Bun-only: a browser's `Request` refuses
  `mode: "navigate"`, and Bun reports `"include"` whatever `credentials` it is given, so `buildRequest` pins the requested value.
- **`docFencesStep` in `@y-core/forge/warden/steps` compiles the `ts` fences of the markdown it lists**, as the `validate-doc-fences` row, so
  a README example written against a removed or reshaped API fails the gate at its line. A fence tagged `ts nocheck` is skipped, for a
  deliberately wrong example. `checkDocFences` is exported from `@y-core/forge/warden/checks`.
- **`forge cf gen env` emits `RATELIMITS`, `{ NAME: { limit, period } }`, from `wrangler.jsonc`'s `ratelimits`**, beside `EnvSchema`, so
  a rate limit's window is the one wrangler declares. A `simple.period` missing or other than 10 or 60 fails generation naming the
  binding, and so does an `env.<name>` that changes a binding's `period`, naming the environment too. An `env.<name>` may set a different
  `limit`; `RATELIMITS` carries the top-level one. `validate-env-schema` fails a committed module whose table no longer matches
  `wrangler.jsonc`.

### Changed

- **The error boundary records every unhandled error, and a `createApp` `onError` override only renders.** The boundary writes its
  `Unhandled error` record, carrying `serializeError(err)`, before it calls the override, where an override's `Response` used to skip the
  record. An app passing `onError: createErrorPage(...)` now gets one error record per unhandled error rather than none. A throwing
  override still adds its own `onError override threw` record, and a disconnected client's `499` is still unlogged. **Migration:** an
  override that logs the error itself drops that line, or every unhandled error is recorded twice.
- **A CSRF refusal is answered by the last-registered matching guard group that verifies and declares `onRefuse`, not by the group whose
  verify stage ran it.** The check still runs once, in the first matching group that verifies. A slice's group on a narrower path, such as
  one passing `refuseAsFragment`, now answers its CSRF refusal where a broader group registered first also covers the path; a group whose
  `exclude` matches, or one with no origin check, rate limit or `guards[]`, takes none. `auth/web`'s groups now answer their own CSRF
  refusals under an app's overlapping `/account/*` group, so a forged passkey-ceremony token gets problem+json, not plain `Forbidden`.
- **The chain publishes its `onRefuse` and `rateLimits` ahead of `before[]`, beside `trustCfHeaders`.** A rate limit in `before[]` now
  answers through the chain's hook, checks its binding name and sets `Retry-After`, as one anywhere else in the chain does.
- **A CSRF token verifies for 24 hours by default, not one, and the policy takes `maxAgeMs`.** `CSRF_MAX_AGE_MS_DEFAULT` (`86_400_000`,
  exported from `@y-core/forge/form`) is the default for the chain's `csrf` policy, `csrfMintStage` and `verifyCsrfToken`, past WCAG
  2.2.1's 20-hour exemption and equal to the auth session's idle bound. `CsrfPolicyOptions.maxAgeMs` sets it per app, and a value that is
  not a whole number of at least one millisecond throws at registration. An app lowering it below 20 hours owes the visitor a warning
  before expiry and a way to extend.
- **`auth/web` throws one message on a request no session middleware ran on**, from its guards, its actions and the approval prompt alike,
  where each threw its own. `AUTH_KV_MIN_TTL_SECONDS` now takes its value from session storage's floor rather than restating it.
- **`forge/exact-markup-assertion` traces markup read with an awaited `.text()`**, or a `.text()` a helper or a `.then` callback returns,
  or a markup helper passed by name to `.then`, `.map` or `.flatMap`, as it traces a `render*` call. It does so in forge's markup trees,
  `src/ui` and `src/auth/web`. `oxlint.base.json` sets the new `responseText: false` option, so in an app the rule reports a `render*`
  call's output in every spec but not a response body, which may be plain text: `expect(await res.text()).toContain("Too many requests")`
  on a `429` passes. An `.includes(` whose slot in a tuple or record `toEqual` / `toStrictEqual` expects `false` counts as an absence claim
  and stays allowed; one expecting `true` is reported.
- **`metaTags` renders no canonical link when `robots` is or includes `noindex`**, where it rendered one whenever `canonical` was set. A site
  canonical merged under a `noindex` page by `mergeMeta` no longer needs stripping in the layout.
- **`request.completed` logs `routePattern` on a request a guard refused**, such as a `429` or a `403`, where it logged `null`.
- **The zone allow-list's over-limit error counts the surface's dynamic routes** and advises splitting the surface across rules that each
  scope to one path prefix. A dynamic route costs about 110 to 160 characters, so one rule holds roughly 25 to 35 of them.
- **`elementOf` in `testing/markup` reads an element through nested children of the same name** to its matching closing tag, where it stopped
  at the first closing tag of that name and returned the outer element cut short.
- **`asyncDialogTrigger` emits `command="show-modal"` and `commandfor` in place of `data-dialog-open`**, so spread on a `<button
  type="button">` it opens the dialog as well as loading its content. Nothing in forge read `data-dialog-open`; an app's CSS or JS keyed on it
  must key on `commandfor` instead.
- **`forge db migrate compose` rewrites `config/db/tables.ts`** with what `forge db types` generates, unless `--dry-run`. It generates the
  row types before writing anything, so a schema whose row types cannot be generated writes no migration, snapshot or `tables.ts`. A `forge curate`
  copy whose `db` regenerates with compose no longer keeps the row types of a dropped feature's tables.
- **With `logging` configured, `definePage`, `defineAction`, the Turnstile screen and `rateLimit` log through the request logger.** Their
  records carry the request's bindings and `data.source`, and reach the app's channels, where each was a bare console line. Without a request
  logger they still write to the console. A test context built by `createTestContext` therefore keeps them quiet.
- **`@y-core/forge/storage/db` imports under node**, through a `node` export condition that loads a prebuilt bundle, while Workers and Bun keep
  loading the source. A node spec can import an app service built on `sql`, `createD1Client` and `createRowLoader` and run it against
  `openTestD1().binding`; a module a node spec imports still reaches forge only through the subpaths `forge.node` lists. Bun now loads
  `@y-core/forge/testing/d1` from source too. Every node bundle is request-free: handed a request, `defineD1Binding`'s monitor and `client`,
  `validateD1Binding`, `d1Sessions` and `resolveD1Client` throw an error named `RequestFreeBundleError` rather than run blind to the
  request's state. A spec that serves a request imports the source ([`TEST_RUNNERS.md`](docs/TEST_RUNNERS.md) §7f).
- `CorsOptions.origins` and `matchOrigin`'s `patterns` take `readonly string[]`. `CorsOptions` and `cors` take a `Bindings` type parameter
  for the resolver.
- `requireFormContentType` passes the safe methods (GET, HEAD, OPTIONS, TRACE) without checking the content type, where it answered
  `415`, so one guard group's `shape` can cover a page and its form POST ahead of the CSRF verify.

### Fixed

- **Forge's auth and approval form actions answer a body over `FORM_MAX_BYTES_DEFAULT` with `413`, whatever the CSRF policy's
  `maxBytes`.** They re-checked the shared parse against the default cap but answered the refusal as a `422` field error, so an app
  raising the policy's cap for one route had sign-in, sign-up, verify, resend, approval and every account form read the larger body
  and answer `422`. They now re-render the page at `413`. The policy still reads the body under its own cap first.
- **A CORS preflight behind a guard group answers `204`, not `403`.** The chain's CSRF policy armed every `OPTIONS`, so a group with an
  `origin`, a `rateLimit` or `guards` refused a preflight before `app.use("/api/*", cors(...))` could answer it. `csrfMintStage` no longer arms
  an `OPTIONS` carrying both `Origin` and `Access-Control-Request-Method`; every other `OPTIONS` still needs a token. `app.use` after
  `applyMiddlewareChain` is `cors`'s one placement.
- **`tagOf`, `tagsOf`, `attrValuesOf`, `attrOf` and `innerOf` in `@y-core/forge/testing/markup` match camelCase tag names.** Tag
  names were matched as lowercase only, so an inline SVG `linearGradient`, `clipPath` or `feGaussianBlur` was skipped and an absence
  assertion over one passed without checking it. Tag names now match as render/jsx accepts them; lowercase ones behave as before.
- **`forge db types` writes a `Tables` map the preset's lint accepts when the schema declares no tables.** It wrote
  `export interface Tables {}`, which `typescript/no-empty-object-type` rejects, so an app with `db` and no tables failed its own lint. It
  now writes `export interface Tables extends Record<never, never> {}`, the same empty type. **Migration:** run `forge db types` again.
- **`@y-core/forge/result`, `@y-core/forge/validation` and `@y-core/forge/ui/contracts` import under node**, through the same `node`
  export condition and prebuilt bundle as `storage/db`, so a node spec can import an app service that returns a `Result`, parses with a
  forge schema or reads a contract constant. Under node they
  failed to load, because node does not strip types under `node_modules`.
- **Forge's D1 and KV records reach the app's channels, and their warnings are written when no `logger` is given.**
  - **A `defineD1Binding` given no `logger` logs its schema monitor and client through the request logger**, with the request's bindings and
    `data.source: "storage/db"`, the client's at `warn` and above; `resolveD1Client` given no `client.logger` does the same, and without a
    request logger both write to the console. `d1.schema.health` went to a console logger fixed at definition, out of reach of the channels
    the composition root takes, so an app wired with `quietChannel()` still printed it.
  - **A binding's `logger` reaches its client too**, where it took only the schema monitor's records; `client.logger` still wins.
  - **A `createD1Client` or `createKVStore` given no `logger` writes `warn` and above to the console.** Each defaulted to a logger with no
    channels, so `d1.request.budget`, a slow `d1.query` and `kv.decode-error` were never written. The per-query `debug` record and `kv.miss`
    stay unwritten unless you pass a `logger`.
- **`applyMiddlewareChain` refuses a malformed `paths` before it registers anything.** A bad pattern in a guard group's or the CSRF policy's
  `paths` threw from inside `app.use`, after the earlier stages had registered, leaving a partial chain on the app.
- **`fakeAssetsFetcher` accepts a string or `URL`, and answers `HEAD` without a body.** It read `req.url`, so a string or `URL` threw, and
  `HEAD` returned the body. `AssetsFetcher.fetch` now takes `(input: RequestInfo | URL, init?: RequestInit)`, as the real binding does.
- **The app canon no longer describes a debug predicate `createApp` does not take.** `APP_ARCHITECTURE.md` §1a's example drops `isDebug`, and
  §1b's first step names config integration only, matching `AppOptions`. `ERROR_HANDLING.md` §3b permits an exception-derived message only in a
  development build, through the relaxation module §1c describes, rather than under a runtime flag.
- **`buildAllowExpression` no longer lets a `:param` match across `/`.** Cloudflare's wildcard `*` matches `/`, so `/admin/users/:id` allowed
  every path under `/admin/users/`. A route with no `*splat` is now paired with a refusal of any path holding more `/` than it, so each `:param`
  matches within one segment and a trailing slash the route does not write is refused. A `*splat` still matches across segments. An empty
  whole-segment param, as in `/admin/users/` or `/admin/users//edit`, is refused too, as is any path holding `//` against a dynamic route; a
  param that is part of a segment, as in `/files/.pdf` for `/files/:name.pdf`, still matches. A route the router cannot parse, such as
  `/x/:a-:b`, is refused with `ZonePatternError` as `"malformed"`. **Migration:** run the zone sync again, and add to `paths` any deeper route
  the old allow-list was letting through by accident.
- **A markdown viewport's dialect `theme` now wins over the viewport's own theme.** CodeMirror let the earlier of two equal-specificity
  rules win, so the viewport's base theme overrode a dialect rule such as a callout's `borderInlineStartColor`. The dialect theme now mounts at
  high precedence.
- **The `types:assets` gate row now passes `--root`.** `cloudflareWorkerSteps` ran `forge assets gen types` without the preset's `root`, so
  an app whose `root` is not the working directory had its asset config and `--out` resolved against the wrong directory. The row now passes
  `--root` with the same `root` the asset-manifest check reads.
- **`forge db restore`, `backup`, `reset` and `migrate --rehearse` on `--target standby` now open the app's own dump bucket.** They opened it
  through the standby's generated config, which binds no R2 bucket, so every one of them failed naming the missing `BACKUPS` binding. The
  database they read and write is still the standby's.
- **The gate's `importBoundary` row with `features: true` passes a root that has no `config/features.config.ts`**, checking it as an app
  with no features, where it failed. A manifest that exists but is malformed still fails the row.
- **`dev:forge` prints how to undo it**: `bun i` restores the pinned release. `BUILD_TOOLING.md` §2k no longer names a `forge dev sync`
  command, which does not exist, and the app canon's `dev:forge` row in `CONFIG_BASELINE.md` names the undo.
- **A PDF container takes JSX children.** `Stack`, `Row`, `Box`, `KeepTogether`, `Panel` and `Link` typed `children` as `PdfElement[]`, so
  `<Stack><Text>One</Text><Text>Two</Text></Stack>` failed to typecheck under the `render/pdf` JSX source, and a single child failed too. Their
  `children` is now `PdfContent`, lowered through `toPdfElements`, so a nested layout no longer needs `toPdfElements` by hand.
- **A render refuses a malformed letterhead mark instead of writing a corrupt PDF.** A mark with a zero width, a non-finite number, an ink
  outside 0–1 or an unknown op, or a `markWidth` that is not a positive number, wrote `Infinity` or `NaN` into the page. The render now
  refuses it with kind `"artwork"` before writing anything. `svgToMark` now throws on a `stroke-width` with a unit or one that is not a
  number, which it wrote as `null`, on a coordinate that is not a finite number, such as `1e999`, and on a `viewBox`, width or height that is
  not above 0.
- **`@y-core/forge/testing/d1/bun` typechecks in an app without `wrangler`**, as it already ran without it. Its types reached `wrangler`
  through `testing/d1` and `tooling/db`'s `getPlatformProxy` type, so even `import type { TestD1 }` failed with TS2307 where the optional
  peer was not installed. The specifiers are unchanged.
- **The `createErrorPage` example in the `@y-core/forge/app` README** resolves its stylesheet through `assets.path("css/main.css")`, where a
  hardcoded `/assets/css/main.css` broke under hashed asset names.
- **An app without `exactOptionalPropertyTypes` typechecks an import that reaches `@y-core/forge/config`**, directly or through
  `@y-core/forge/auth/web`. `EnvMapping`'s record arm failed there with TS2411 on `__env`, and forge ships raw TypeScript, so `skipLibCheck`
  could not hide it. A record carrying `__env` is still refused. An `undefined` entry in a mapping is now skipped as an absent key.
- **`renderError` and `renderValidationErrors` mark their banner with `ANNOUNCE_FAILURE_ATTR`, so `defineAction`'s failures are announced.**
  `defineAction`'s `422`, `413`, `400` and `500` fragments were swapped in and never spoken. `renderError`'s banner now holds its message
  in the marker, and `renderValidationErrors`' holds its lead, "Please correct the following fields.", so forge's client runtime speaks each
  once on the `failure` channel, as it does `refuseAsFragment`'s panel. The error page's banner is spoken on load. An app that announces
  these failures itself now announces them twice; remove its own call.
- **A `503` panel from `refuseAsFragment` and `defineAction`'s `500` fragment are swapped in and announced under `ui/client/htmx`.** The
  client never swapped a 5xx, so both were dropped and never spoken. Both now carry `FAILURE_FRAGMENT_HEADER` (`Forge-Failure-Fragment`,
  exported from `@y-core/forge/ui/contracts`), and the client swaps a 5xx that carries it: into `HX-Retarget` with `HX-Reswap` when sent,
  else into the request's own target. The panel is announced once on the `failure` channel. `refuseAsFragment` sets the header at every
  status. A 5xx without it still never swaps, even with an `HX-Reswap`, except where the element sets `hx-status:5xx`, which htmx used to
  ignore for a 5xx and now honours.

### Upgrading

Work through [`UPGRADING.md`](docs/UPGRADING.md) from 0.7.7: it orders the breaking changes above into the edits an app makes, with the
symptom of each, and lists which items each consuming app takes.

---

## [0.7.7] — 2026-11-22

### Breaking Changes

- **`warden sync` now owns `.claude/settings.json` and overwrites it**, from `warden/claude/settings.json`, and no longer seeds it under
  `--init`. The fleet policy holds a residual deny list and nothing else: `model`, `effortLevel`, `attribution`, `env`, the allow lists and
  `sandbox` are the user's to set. **Migration:** move any repository-specific setting, such as an extra MCP server, into the untracked
  `.claude/settings.local.json`, then run `bun x warden sync`.
- **`warden sync --check` fails on git hygiene drift**: a `.gitignore` that leaves `.claude/settings.local.json`, `.dev.vars`, `.env*`, `.forge/`,
  `tmp/`, `test-results/`, `playwright-report/`, `coverage/`, `.wrangler/` or `.DS_Store` unignored; one that ignores `.claude/settings.json` or
  `.codex/config.toml.example`; and a tracked `settings.local.json` still on disk — one already deleted is a removal awaiting the commit.
  **Migration:** fix `.gitignore`, and delete a tracked `settings.local.json` or remove it from the index, until `bun x warden sync --check`
  passes.
- **The fleet deny list no longer blocks read-only `git -C`** or the git writes that `.git` mounted read-only already refuses. It denies `git apply`,
  `clean`, `clone`, `init`, `push`, `--git-dir` and `--work-tree`, plainly and behind any leading global option such as `-C <dir>` or `-c k=v`,
  plus `gh`, `wrangler deploy` and `wrangler secret` in every spelling, `rm -rf` and reading `.dev.vars` and `.env*`.
- **`check()` and `sync()`, in `@y-core/forge/warden`, take a `SyncPlan` in place of a `SyncTree` list**, so one argument carries the
  synced trees, the synced files and the slug `{{repo}}` renders as. **Migration:** `check(repo, trees)` becomes
  `check(repo, syncPlan(CLAUDE_ROOT, kind, repo))`, and `sync(repo, trees)` becomes `sync(repo, syncPlan(CLAUDE_ROOT, kind, repo))`.
- **`checkTree()` and `seed()` take a trailing `slug`**, which `{{repo}}` renders as in every file they compare or write. **Migration:** pass
  the plan's `slug`, or `libraryPrefix(repo)`.
- **`SeedFile` is renamed `CorpusFile`**, since it now names a file a sync overwrites as well as one it seeds. **Migration:** rename the
  import; its fields are unchanged.
- **`identical()` is removed from `@y-core/forge/warden`**: a synced file is compared as rendered text, not bytes. **Migration:** compare a
  synced file with `checkFiles()`, or compare two buffers with `.equals()` directly.
- **`copyTree()` is replaced by `writeTree(to, files)`**, which writes a map of relative path to rendered text instead of copying a
  directory. **Migration:** `copyTree(from, to)` becomes `writeTree(to, layerTree([from], slug))`.
- **`cloudflareWorkerSteps()`'s `validate-config-files` row holds `tsconfig.json`, `.oxlintrc.json` and `.oxfmtrc.json` to forge's bases.**
  Each must extend its base — the formatter's copies it, since `bun fmt` ignores `extends` — and a local entry may only add to it: a local rule
  or compiler option naming a base key, a local `plugins`, `jsPlugins` or `categories`, an `exclude` key and a `.jsonc` spelling all fail.
  **Migration:** set `"extends": "./node_modules/@y-core/forge/src/tooling/config/tsconfig.app.json"` — a path, since Bun's runtime ignores a
  package `extends` — and
  `"extends": ["./node_modules/@y-core/forge/src/tooling/config/oxlint.base.json"]`, keep `paths`, `include` and `ignorePatterns` (with
  `.forge/**` and `.types/**`) locally, delete every entry the base now holds, and rename any `.jsonc` to `.json`.
- **The oxlint base turns on `forge/sql-in-loop`, `forge/sql-tag-called-directly`, `typescript/consistent-type-imports`,
  `import/consistent-type-specifier-style` and `import/no-cycle` fleet-wide**, applies the spec override to `*.workerd.ts`, and bans launching a
  local browser under `tests/**`. **Migration:** run `bun run fix` for the type-import rules, and break any import cycle `import/no-cycle` names.
- **`CompatibilityCheckConfig.workerConfig` is replaced by `workerConfigs`**, a list judged in one `validate-compatibility` row, so a second Worker
  config cannot drift off the flags unseen. `cloudflareWorkerSteps()` judges `workerConfig` plus `compatibility.extraWorkerConfigs`.
  **Migration:** a direct `compatibilityStep({ workerConfig: "x.jsonc" })` becomes `compatibilityStep({ workerConfigs: ["x.jsonc"] })`; an app
  with a local Worker beside the deployed one passes `compatibility: { extraWorkerConfigs: ["path/to/wrangler.jsonc"] }`.
- **`validate-comment-budget` and `validate-docs` fail a ledger task id** — `bug-`, `feat-`, `chore-`, `spike-` or `decision-` followed by
  `YYMMDD-NN` — in a comment, a tooling directive included, or in a governing document, `CLAUDE.md` or a README. An id in a string literal passes.
  **Migration:** rewrite each reported comment or line to state the reason itself; where a document shows the id format, spell it
  `feat-YYMMDD-NN`.

### Added

- **`warden sync` writes `.codex/config.toml.example`**, carrying the ledger URL scoped to the repository.
- **`@y-core/forge/tooling/oxlint.base.json`, `oxfmt.base.json` and `tsconfig.app.json`**, the fleet's tool-config bases.
- **`appContrast()`, in `@y-core/forge/tooling/gate`**, builds the `contrast` option from forge's token layer, pairs and floors plus an
  application's own token files, pairs and accepted rows, stated as the exported `AppContrastOptions`.
- **`warden sync` merges a kind's `X.overlay.md` into the shared `X.md`**, filling each `{{slot:name}}` line, through the new `layerTree()`
  and `mergeOverlay()`; the agent definitions are now one shared body each plus a short overlay per kind.
- **`syncPlan()`, `syncFiles()`, `render()` and the `SyncPlan` type, in `@y-core/forge/warden`**, which build what a sync writes into a
  repository and render a corpus file for its slug, and **`checkFiles()`, `checkGit()` and `MUST_IGNORE`**, which back the synced-file and
  git hygiene findings of `warden sync --check`.
- **`checkConfigBaseline()`, `OXLINT_BASE` and `TSCONFIG_BASE`, in `@y-core/forge/tooling/gate`**: the check the `validate-config-files`
  row runs against forge's bases, and the two `extends` paths it requires.
- **`wardenAppSteps()`, in `@y-core/forge/warden/steps`, defaults `citableDirs`** to the installed canon's `shared` and kind trees, through
  `canonCitableDirs()`, new in the same subpath.
- **`@y-core/forge/tooling/playwright`**: `playwrightServers()`, `chromiumProject()`, `crossEngineProjects()`, `workerdProject()` and
  `runsOnlyWorkerd()`, the pieces every app's `playwright.config.ts` shares, published as a prebuilt `.mjs`. `@playwright/test` becomes an
  optional peer.
- **`@y-core/forge/testing/bun`**, a types-only subpath declaring `bun:test` and `bun:sqlite`, and **`@y-core/forge/testing/node` widened** to
  the node calls the fleet's tests make (`node:child_process`, `node:crypto`, `node:http`, `node:net`, more of `node:fs`, `node:os`, `node:path`
  and `node:url`, and named `node:process` exports). Both declare modules only, `node:domain`, `Hash.digest(): Uint8Array` and
  `Statement.columnNames` among them. An app replaces its own `.types/` copies with one `.types/forge.d.ts` referencing the two.

- **`forge release` hands the commit and the tag to the host when `.git` is read-only.** It finds out before the gate, says so in its summary
  as `commit: on the host (.git is read-only)`, `--dry` included, and stops before the commit to print the host's commands with HEAD, the
  version and the blob ids filled in. Each set opens by checking that HEAD and the release files are still what the run saw, and every command
  is safe to repeat.
- **`forge release` re-cuts an untagged release.** A release stays open until its tag exists: a rerun folds new `[Unreleased]` entries and
  entries added to the `[V]` body into the one `[V]` section, writes only the release files that changed, runs the gate over them, and commits
  only what differs from HEAD, tagging HEAD with no commit when nothing does. Work committed between runs, with or without the release files,
  is carried. `[V]` keeps its date unless its content changed.
- **A green release gate is recorded in `.forge/release/<tag>.json`**, so a rerun over the same base commit and the same release files does not
  run the gate again.

### Fixed

- **`forge db` no longer prints workerd's "no such Durable Object class is exported" warning** in an app that binds a Durable Object of its
  own Worker. A local database is now opened through a config holding only the app's D1 and R2 entries, written under `.forge/` and removed
  on close, so the platform proxy no longer boots the app's Durable Objects, queues, services or workflows to read a database. The same
  local state is read as before.

- **`forge release` no longer writes a release twice.** A rerun after a failed commit, or after a commit that was never tagged, refused as
  dirty, and forcing it past with `--allow-dirty` or `--allow-empty-changelog` promoted `[Unreleased]` as a second `[V]` section and committed
  again. It now works out from the repository where V stands and runs only the steps that remain. The failed-commit recovery no longer advises
  `git checkout --`, which needs a writable `.git`.
- **`promoteUnreleased()`, in `@y-core/forge/tooling/gate`, refuses a changelog that already holds the `[V]` heading**, instead of promoting
  a duplicate section under it.
- **`forge release` refuses an edit to what already shipped** as the new `release-partial` `ReleaseErrorKind`: a `package.json` changed beyond
  its version, or a released section other than `[V]`. The refusal's recovery, `git show HEAD:./<file>`, works with `.git` read-only.
- **`forge release` refuses to cut a version over an untagged one** already written or committed, as `version-mismatch`, and names the version
  to finish first.

---

## [0.7.6] — 2026-11-20

### Breaking Changes

- **A signed-in identity is an `auth_sessions` row, not a set of session keys.** Signing in creates a row keyed by the SHA-256 of a random
  token, and the session carries only that token beside its visitor state; an administrator approval stays in the session for every
  visitor. **Every existing session is signed out on upgrade**, and no backfill exists or is needed: an existing session carries no token.
- **Schema: run `forge db migrate compose` after upgrading, and apply the migration before the new Worker deploys.** No schema change
  below has a fill step. `src/auth/schema.sql`'s digest moved, so `db:schema:digests` reports it until you compose.
- **Schema: `auth_sessions` is a new table.** Its columns are `token_hash BLOB PRIMARY KEY`, 32 bytes; `user_id`, referencing `auth_users`
  `ON DELETE CASCADE`; `signed_in_at` and `expires_at`, both `INTEGER NOT NULL`, with `expires_at` later than `signed_in_at`; `step_up_at`
  and `step_up_kind`, both nullable; `id BLOB NOT NULL`, 16 bytes; `last_seen_at INTEGER NOT NULL`; and `device`, nullable and at most 64
  characters. Its indexes are the unique `auth_sessions_id`, `auth_sessions_user_id` and `auth_sessions_expires_at`. **Apply the migration
  that adds it before the new Worker deploys**: without the table, every sign-in answers 503.
- **Schema: `auth_users` drops `sessions_invalid_before`, adds the nullable `email_change_requested_at`, and changes its indexes.** The
  partial index `auth_users_active_admin`, on `auth_users (id) WHERE is_admin = 1 AND deactivated_at IS NULL`, replaces
  `auth_users_is_admin`, and the partial index `auth_users_unverified_created_at` is added. Dropping the column is destructive, so compose
  writes it only under `--allow-destructive <digest>`. The drop is safe once the new Worker is live. Until then the old Worker still writes
  the column: removing a passkey or the authenticator app and an administrator's factor reset answer 503, and a completed address change
  moves the account but answers unavailable without signing anyone out. Composing the drop and the additions into one migration and
  applying it just before the deploy also works, and accepts that short window.
- **Schema: `auth_otp_state` adds `window_started_at` and `binding`, both nullable**, with a CHECK holding `binding` to 32 bytes. A code
  issued before the upgrade carries no binding and never verifies, so its user asks for another.
- **Schema: `auth_security_events` is a new table, with the indexes `auth_security_events_user_id` and `auth_security_events_at`.**
  **Apply the migration that adds it before the new Worker deploys**: without the table, every sign-in, step-up and factor or account
  change answers 503.
- **`AuthGuardOptions.users` is now `sessions`**, a resolver for `Pick<AuthSessionStore, "resolve">`. That covers `requireAuth`,
  `resolveAuth` and the `auth` options of `createAuthGuards`.
- **`AuthRequestServices` requires `sessions: AuthSessionStore`.** Return `createAuthSessionStore(db)` from `resolveServices`.
- **`establishAuthSession`, `markAuthStepUp`, `clearAuthSession` and `resolveAuthIdentity` take the session store and answer an
  `AuthStoreResult`.** They are `establishAuthSession(session, sessions: Pick<AuthSessionStore, "create">, userId, at, now,
  { kind, steppedUp?, device? })`, answering `void`; `markAuthStepUp(session, sessions: Pick<AuthSessionStore, "rotate">, at, now, kind)`,
  answering `boolean`; `clearAuthSession(session, sessions: Pick<AuthSessionStore, "remove">)`, answering `void`; and
  `resolveAuthIdentity(session, sessions: Pick<AuthSessionStore, "resolve">, at)`, answering `AuthIdentity | null`. `kind` is the factor
  the sign-in or step-up verified with. No kind ranks above another: the kind is recorded, and nothing compares it. A step-up moves the
  row onto a new token, so a token read before it no longer resolves.
- **`AuthIdentity` requires `sessionId` and `stepUpKind`.**
- **A session stops resolving once it goes unused for `AUTH_SESSION_IDLE_MS` (24 h)**, as well as once `AUTH_SESSION_MAX_MS` has run from
  sign-in. Pass `createAuthSessionStore` `{ idleTimeoutMs: null }` for no idle bound. Build the guard's store and `resolveServices`' store
  from one helper so both hold the same bounds.
- **Removed:** `renewAuthSession` (use `revokeOtherAuthSessions`), `UserStore.revokeSessions`, `AuthUser.sessionsInvalidBefore`,
  `FakeAuthUser.sessionsInvalidBefore`, `AUTH_SESSION_KEY`, `AUTH_SIGNED_IN_SESSION_KEY`, `AUTH_STEP_UP_SESSION_KEY` and
  `AUTH_SURVIVED_SESSION_KEY`.
- **A custom `UserStore` or `AdminUserStore` must delete the user's sessions where the shipped one does.** `UserStore.changeEmail` deletes
  them in its batch, and so do `AdminUserStore.setDeactivated` when it deactivates, `remove` and `resetFactors`.
- **`storage: "cookie"` is now the recommended session storage alongside auth.** KV is still supported.
- **`defineFeatures` takes `{ features, regenerate? }`, not the feature record itself.** Migrate by wrapping the record:
  `defineFeatures({ features: { … } })`. The new manifest-level `regenerate` runs once after any `forge curate` copy that dropped a
  feature, after the kept features' own, so a file no feature owns — such as the env schema `forge cf gen env` writes — is rebuilt in a
  copy that keeps no feature. `ImportBoundaryCheckConfig.features` takes the manifest's `features`.

- **`OtpStateStore` binds a code to the browser that asked for it, and spends one guess budget per account.** It is
  `issue(userId, state, cooldownMs, binding)`, `countAttempt(userId, maxAttempts, at, windowMs, binding)` and `read(userId, at, binding)`,
  where `binding` is the SHA-256 of the caller's binding. `issue` no longer resets `attempts`, so the budget survives a reissue and reopens
  once `windowMs` has run from the first guess. `discard` retires the named code rather than deleting its row. A custom store moves the
  binding on a reissue and matches it on a count and a read.
- **`AdminUserStore.claimFirstAdmin` and `AdminUserService.claimFirst` take an optional `AuthSessionRotation`**, run in the claim's own
  batch. The shipped admin-claim action always passes one, so the claimant's pre-claim token never ends up elevated.
- **`UserStore` requires `claimEmailChange(id, at, cooldownMs)`.** `AuthEmailChangeFlow.request` claims it before sending, and refuses a
  request inside the cooldown with the new reason `"too-soon"`.
- **`requireFreshStepUp` demands a fresh step-up of every user, including one holding no second factor**, who re-proves with an emailed
  code. A sign-in owing no second factor counts as that proof, through `establishAuthSession`'s `steppedUp`. The verify page no longer
  sends such a user on; `AuthVerifyDemand.owed` loses `"none"`. Arriving there mails nothing: the page offers "Send a code"
  (`VerifyViewProps.codeSent: false`), and the resend action issues the code.
- **`stepUpMaxAgeMs` defaults to `AUTH_STEP_UP_MAX_MS` (24 h) on `requireAuth`, `resolveAuth`, `requireEnrolment` and
  `requirePendingEnrolment`.** Pass `null` for a step-up that lasts the session, which omitting it used to mean. A window above
  `AUTH_SESSION_MAX_MS` now throws, and so does a `freshStepUpMaxAgeMs` above it.
- **An emailed code is bound to the browser that asked for it.** The factor contract takes a trailing `caller: AuthFactorCaller`:
  `createChallenge(userId, at, caller)`, `verifyChallenge(userId, presented, at, caller)` and
  `completeEnrolment(userId, presented, at, caller)`. `AuthSigninFlow.request`, `complete`, `requestStepUp` and `stepUp`, and
  `AuthSignupFlow.request`, take `caller` as their last argument. `createEmailOtpFactor` issues and verifies nothing for a `null`
  binding, and refuses another browser's guess without spending the account's guess budget; a new browser gets no budget of its own.
- **Security-relevant writes record an event in their own batch.** A sign-in, a step-up, a factor added or removed, a recovery-code set
  issued or a code spent, an address change, an administrator grant or revocation, a factor reset, and an account deactivated or
  reactivated each insert one `auth_security_events` row beside the change, and a refused or failed write records none. A custom store
  writes the same row in the same batch. The row holds the type, factor kind, public session id, acting administrator and time, and
  never an address, a client detail, a code or a token.
- **Store writes take where they came from, as `origin: AuthWriteOrigin`:** `FactorStore.confirm(id, userId, at, origin)`,
  `CredentialStore.create(input, at, origin)`, `RecoveryCodeStore.commit(userId, factorId, at, origin)` and
  `RecoveryCodeStore.consume(userId, factorId, hash, at, origin)`. `PasskeyRegistrationInput` requires `origin`.
- **`FactorStore.confirm` confirms only an unconfirmed row and answers `false` for one already confirmed**, so the authenticator-app
  enrolment refuses a second confirmation. Confirming a `passkey` row records no event: the credential the ceremony registers does.
- **`RecoveryCodeStore.commit` answers `boolean`:** `false` when no staged set was there to swap in, which the recovery-code factor
  refuses as `"unrecognised"`.
- **Administrative writes take the acting administrator's id:** `AdminUserStore.setAdmin(id, isAdmin, at, adminId)`,
  `setDeactivated(id, deactivated, at, adminId)` and `resetFactors(id, at, adminId)`, and `AdminUserService.elevate`, `demote`,
  `deactivate`, `reactivate` and `resetFactors` take `adminId` last.
- **`AdminUserStore.setAdmin` and `setDeactivated` match only an account not already in the asked-for state, and answer the new
  `AdminUserOutcome` member `"unchanged"` for one that is.** A repeated deactivation no longer moves `deactivated_at`, and such a write
  records no event. The admin update action answers `"unchanged"` as it answers `"changed"`, and sends no notice for it.
- **`AuthMessage` is a union discriminated by `kind`:** `"otp"` carries `code`, `"email-change"` carries `url`, and the new
  `"security-event"` carries `notice: AuthSecurityNotice` and no expiry. An `AuthNotifier` switches on `kind` before reading a field.
- **`AuthRequestServices` requires `notices: AuthSecurityNotices`.** Return `createSecurityNotices({ notifier, defer })` from
  `resolveServices`. The account actions tell the account's address after a factor, recovery-code, role, factor-reset or account-status
  change, and nothing after a sign-in or a step-up. A completed address change tells the old address.
- **`AuthDeferral` takes `Promise<unknown>`.**
- **Adding a factor, issuing recovery codes and spending one sign every other session out, in the batch of the change.**
  `FactorStore.confirm` for any kind but `passkey`, `CredentialStore.create`, `RecoveryCodeStore.commit` and `consume`, and
  `FactorStore.remove` of a confirmed factor delete every session the user holds except `origin.keep`'s, only where the change's event
  lands, so a refused write signs nobody out. A custom store does the same. Removing the authenticator app no longer revokes in a
  separate call.
- **`accountRoutes` gains `sessions` (`GET /sessions`), `sessionRevoke` (`POST /sessions/revoke`) and `sessionsRevokeOthers`
  (`POST /sessions/revoke-others`).** `registerAccount` mounts them behind the account group's guards, `require-fresh-step-up`
  included. An app mapping `accountRoutes` itself supplies the three handlers: `loadAccountSessions` and `createSessionActions`.
- **`FactorStore.findEnrolled` is replaced by `listConfirmedKinds(userId, kinds)`**, which answers the kinds among `kinds` the user holds
  a confirmed row of, never the row or its sealed secret. A custom `FactorStore` implements it; the factor registry is its caller.
- **`PasskeyListViewProps.backupPrompt` is required.** An app rendering `PasskeyListView` from props of its own passes it; `true` shows the
  prompt to add a backup passkey.
- **`definePage` answers `405` to `OPTIONS` and `TRACE`, running neither `action` nor `loader`.** Both used to reach `action` as a mutation.
  The answer is the app's hardened method-mismatch `405`, and its `Allow` names the methods the page's route serves (`ROUTING_AND_MIDDLEWARE.md`
  §2a).
- **`isActiveContentType` counts a value that does not parse as one RFC 9110 media type as active**, parameters included: a comma list, an empty
  value or a stray quote. `requireFormContentType` answers `415` to such a value where it used to check only the part before the first `;`.
- **The SVG sanitizer can change an existing icon set's output.** Every kept attribute is rewritten double-quoted with `&`, `<`, `>` and `"`
  escaped, and text references are written back decoded and escaped, so sprite and cursor bytes change. An attribute holding an unknown,
  miscased or `;`-less named reference is dropped, so `aria-label="Tom&Jerry"` is lost; write `Tom &amp; Jerry`. So is one that decodes to a
  character XML forbids. `title` and `desc` lose their child elements and keep their text, and an element carrying the same attribute name
  twice, in any case, is dropped with everything inside it.
- **A cursor's `data-cursor-hotspot` must be two non-negative integers.** A hotspot such as `"6"` used to bake as `6 0`; `buildCursors` now
  fails the build on it, and on anything else that is not `"<x> <y>"`, naming the cursor and its file, so a hotspot can no longer write into
  the generated CSS.
- **The account pages and redirects read every factor's state from `AuthRequestServices.enrolments`, so a custom factor service's
  `listEnrolments` is no longer consulted there.** A service whose rows are not in that `FactorStore` shows there as not enrolled: build one
  `FactorStore` and hand it to `createFactorRegistry`, to `enrolments` and to the factors. A row of a kind the deployment no longer offers is
  ignored.
- **`purgeAuthEphemera(db, at, options?)` answers an `AuthEphemeraPurgeReport` where it answered `void`, and deletes more than expired
  challenges and nonces.** It also deletes expired sessions, lapsed security events, and accounts still unverified `unverifiedUserTtlMs`
  after creation, `AUTH_UNVERIFIED_USER_TTL_MS` by default. It deletes in bounded steps, table by table with no transaction spanning them,
  in the order challenges, nonces, sessions, security events, then accounts, and caps the steps each table takes, so a large backlog clears
  over several runs; schedule the purge more often until the report's `complete` reads `true`. A failure's `operation` names the report
  key, as `ephemera.purge.<key>` — `ephemera.purge.signIns` for sessions — where it was `ephemera.purge`.
- **A constraint that refuses a purge step blocks only its table.** A foreign-key, `NOT NULL` or `CHECK` refusal, which only an app key's
  `ON DELETE` action can raise, names the table in the report's `blocked`; its remaining steps are skipped and the other tables still purge,
  where one refusal used to roll back every table's purge on every run. A trigger that fails the delete with one of those errors blocks the
  table the same way. A `UNIQUE` refusal, an outage or anything else stops the run.
- **The migration lint refuses an app's foreign key to an `auth_` table that would block forge's deletes**, as `auth-key-blocks-delete`: one
  that is neither `ON DELETE CASCADE` nor `ON DELETE SET NULL` on columns that can hold `NULL`. A column cannot when it is `NOT NULL`, in a
  primary key, or named in a table `CHECK (col IS NOT NULL)`. A pending migration that passed before can be refused now, and compose refuses to
  write such a key from your `schema.sql`, naming it as yours to change. A key already applied, or a column a trigger keeps from `NULL`, is
  not checked; it shows up as the purge's `blocked` and `AdminUserStore.remove`'s `referenced`. `LintRule` gains
  `"auth-key-blocks-delete"`.

- **The emailed code is the only way in, and each second factor is mandatory or optional on its own.** `AuthFactorsOptions` is
  `{ primary, second? }`: `primary` takes an `AuthIdentifyingFactorService`, now an `ImplicitFactorService` of an identifying kind, and
  `second` an `AuthSecondFactorOffering`, `{ offered, recovery }`. `offered` is a non-empty list of `AuthSecondFactorOffer`,
  `{ service, requirement }`, in the order every page lists them and owed kinds are enrolled in, and `recovery` is the recovery-code factor.
  Migrate
  `{ offered: [{ service: emailOtp, role: "primary" }, { service: totpApp, role: "second", requirement: "mandatory" }, { service: recoveryCodes, role: "second", requirement: "optional" }] }`
  to `{ primary: emailOtp, second: { offered: [{ service: totpApp, requirement: "mandatory" }], recovery: recoveryCodes } }`.
- **`AuthSecondFactorRequirement` replaces `AuthFactorRequirement`, and is `"mandatory" | "optional"` alone.** `{ mandatoryForRoles }` is
  gone with no replacement: a factor is mandatory for everyone or optional. **Removed:** `AuthFactorOffer`, `AuthFactorRequirement`, the
  offer's `role` field, implicit second factors, `AUTH_ADMIN_ROLE`, `AuthFactorContext` and `authFactorContext`. **Added:**
  `AUTH_SECOND_FACTORS`, `AuthSecondFactorKind`, `AuthSecondFactorService`, `AuthSecondFactorOffer` and `AuthSecondFactorOffering` in
  `@y-core/forge/auth`.
- **`AuthFactorRegistry.resolve(userId)` takes no context, and `seconds` holds `AuthSecondFactorService`s rather than offers.** The registry
  gains `recovery`, and `mandatory`, the mandatory kinds in offer order. An `enrolment-required` resolution names the mandatory kinds the
  user does not hold, and its `stepUpKinds` the offered second factors they do hold, with `recovery-code` where they hold codes.
- **`FactorStore.remove(id, userId, at, origin, floor)` and `CredentialStore.removeForUser(id, userId, at, origin, floor)` answer
  `AuthFactorRemoval` — `"changed"`, `"not-found"` or `"second-factor-required"` — where they took `(id, userId)` and answered
  `boolean`.** `origin` is an `AuthWriteOrigin`, and `floor: AuthSecondFactorFloor` is the mandatory kinds, `registry.mandatory`, and empty
  where none is. A custom store refuses a removal that would take the user's last confirmed row of a `floor` kind, deciding it in the batch
  that deletes and writing no event and no session revocation for a refusal. `removeForUser` deletes every session the user holds except
  `origin.keep`'s in its batch, and every session where `origin.keep` is `null`. `AuthSecondFactorFloor` and `AuthFactorRemoval` are
  exported from `@y-core/forge/auth`.
- **Removing the last factor of a mandatory kind answers 409.** `passkeyRemove` and `totpRemove` re-render the page with the reason and send
  no notice. `PasskeyListViewProps.fallbackFactors` is replaced by `mandatory: boolean`, which `TotpEnrolViewProps` also requires and which
  disables the remove control; both props types gain `error?`. The passkey page's lockout warning is gone.
- **`AuthEnrolmentGuardOptions.enrolmentPaths` is an `AuthEnrolmentPaths`, `{ kinds }`**, where it was a record by kind, and
  `authEnrolmentPaths(paths.auth)` builds it. An enrolment owed in several kinds goes to the first one's page in offer order, and to the next
  once it is confirmed.
- **`VerifyChoice` is renamed `AuthFactorChoice`.**
- **`SignupViewProps.enrols` is replaced by `addsSecondFactor: boolean`**, set where any offered second factor is mandatory.
- **A failed D1 read answers 503 everywhere in auth.** `requireAuth` and `resolveAuth` answer 503 on a session-store failure, keeping the
  session token, where they treated the visitor as signed out. The redirect after a sign-in, step-up or enrolment answers 503 where it could not read where the user stands, and so do the
  passkey and authenticator-app pages when the user's enrolments cannot be read. A sign-up or sign-in whose deferred account lookup
  returns a store failure logs it as `auth.signup.issue.failed` or `auth.signin.issue.failed`, where only a throw was logged.
- **`purgeStaleTotpSecrets` takes `factors: { offered, mandatory }` in place of `requirement`, and answers `TotpSecretPurgeReport`,
  `{ purged, kept }`, where it answered a count.** `factors` is plain values, so a scheduled handler builds it without factor services. It
  throws unless `totp-app` is offered and mandatory, and on a kind listed twice or one that is not a second factor.
  It keeps the stale row of a user holding no other confirmed second factor and no unused recovery code.
  `TotpSecretPurgeReport` is exported from `@y-core/forge/auth`.
- **The auth pages' wording changes.** "Sign-in methods" is "Factors", and the authenticator app and the passkey are described as second
  factors rather than ways to sign in. The reset note and confirmation read "Remove every second factor and recovery code…", the
  recovery-code note reads "Each code works once, in place of a second factor you can't reach.", and a passkey step-up says "Passkey
  accepted." A test or a translation matching the old strings needs updating.
- **`TotpAppFactorOptions.challenges: ChallengeStore` is required.** It holds a replacement secret until a code from it confirms the swap;
  pass `createChallengeStore(db)`.
- **`FactorStore.recordVerification` takes `(id, userId, counter, at, frame, resealed?)`.** `frame` is the sealed secret the code was
  checked against, and the write must also require `secret = frame`, so a code checked against a secret a replacement has since swapped
  out matches no row. `resealed` replaces the optional `secret` argument.
- **A custom `FactorStore` must implement `replaceSecret(id, userId, secret, counter, at, origin)`.** In one batch it updates a confirmed
  `totp-app` row of that user in place, records `factor-replaced` and deletes the user's sessions but `origin.keep`, each only where the
  update landed, and answers `false` where no row matched. It and `recordVerification` are the only writers of `last_verified_at`.
- **`AuthSecurityEventType` and `AuthNotifiedEventType` gain `"factor-replaced"`.** A notifier rendering every notice type must render
  `{ type: "factor-replaced", factorKind: "totp-app", at }`.
- **`TotpEnrolState` gains `"replacing"`.** A custom authenticator-app view that switches on `state.status` exhaustively must handle it;
  it carries the same `secret` and `uri` as `"enrolling"`.

### Added

- **Replacing an authenticator app in place.** `createTotpAppFactor` returns the new `TotpReplaceableFactorService`, with
  `beginReplacement` and `completeReplacement`. `accountRoutes` gains `totpReplace` (`GET /totp/replace`) and `totpReplaceConfirm`
  (`POST /totp/replace`); `registerAccount` mounts both, and an app mapping `accountRoutes` itself supplies `loadTotpReplace` and
  `createTotpManageActions`' `totpReplaceConfirm`. The page renders under the view name `accountTotpReplace`, `TotpEnrolState` gains
  `"replacing"`, and `TotpEnrolViewProps` gains `replacePath`. The page and the `POST` demand a fresh step-up; the old secret keeps
  working until a code from the new one commits the swap, which signs every other session out. Replacing is not a removal, so it is open
  where the app is mandatory and cannot be removed.

- **A session list in `@y-core/forge/auth/web`.** `loadAccountSessions` renders `SessionListView` under the new view name
  `accountSessions`: each live session's device, sign-in and last activity, the factor it stepped up with, a mark on the current one, and
  a sign-out on every other row. `createSessionActions` answers the row's sign-out and "Sign out everywhere else". A row's form names its
  session in a field, so one CSRF token serves every row. Exported beside them: `AUTH_SESSION_LIST_ID`, `authSessionRevokeSchema` and
  `SessionListViewProps`.
- **`createSecurityEventStore` and `AuthSecurityEventStore` in `@y-core/forge/auth`**, which list an account's security events newest
  first, with `AuthSecurityEvent`, `AuthSecurityEventType` and `AuthWriteOrigin`.
- **`createSecurityNotices`, `AuthSecurityNotices`, `AuthSecurityNoticesOptions`, `AuthSecurityNotice` and `AuthNotifiedEventType` in
  `@y-core/forge/auth`.** A notice is delivered after the response through the deployment's `AuthNotifier`, and a failed delivery is
  logged as `auth.security-notice.failed` and never thrown.
- **`AUTH_SECURITY_EVENT_TTL_MS` (365 days) and `AuthEphemeraPurgeOptions.securityEventTtlMs` in `@y-core/forge/auth`.**
  `purgeAuthEphemera` deletes security events older than that, with a floor of 30 days. An account's events go with the account and stay
  through a factor reset.

- **`EmailOtpOptions.logger`.** The email-OTP factor logs every store and delivery failure at `error`, carrying the error, as
  `auth.email-otp.<step>.failed` — `auth.email-otp.deliver.failed` for a code that could not be delivered. Omit it for the console.
- **`AuthFactorCaller` in `@y-core/forge/auth`**, what the requesting browser contributes to a factor call.
- **`AUTH_SESSION_IDLE_MS`, `AUTH_STEP_UP_MAX_MS` and `AuthSessionStoreOptions` in `@y-core/forge/auth`.**
  `AuthSessionStoreOptions.absoluteLifetimeMs` shortens the absolute session lifetime, from five minutes up to `AUTH_SESSION_MAX_MS`.
  `idleTimeoutMs` runs from five minutes up to that lifetime, and defaults to the lifetime when it is shorter than 24 h.

- **`AUTH_OTP_GUESS_WINDOW_MS`, `AUTH_EMAIL_CHANGE_COOLDOWN_MS` and `AUTH_UNVERIFIED_USER_TTL_MS` in `@y-core/forge/auth`**, with the
  matching knobs `EmailOtpOptions.guessWindowMs`, `AuthEmailChangeOptions.cooldownMs` and `AuthEphemeraPurgeOptions.unverifiedUserTtlMs`.
- **`createAuthSessionStore(db, options?)` and `AuthSessionStore` in `@y-core/forge/auth`**, the signed-in sessions keyed by token hash.
  `AuthSessionStore` is `create(input, replaces)`, `resolve(tokenHash, at)`, `rotate(replaces, tokenHash, stepUp?)`, `remove(tokenHash)`,
  `listByUser(userId, at)`, `revoke(userId, sessionId, at, origin)` and `revokeOthers(userId, at, origin)`. `create` mints the row's `id`,
  sets `expires_at` to `signedInAt` plus the store's absolute lifetime and `last_seen_at` to `signedInAt`, and records `signed-in`.
  `resolve` answers a live session joined to its active owner, and writes `last_seen_at` at most once per interval, only when the row it
  read shows the interval has passed. `rotate` moves the row onto a new token with one in-place `UPDATE`, so every column carries over,
  and records a step-up where one is given. `listByUser` answers the user's live sessions under the same bounds, newest sign-in first.
  `revoke` deletes the one session the id names when the user holds it and it is not `origin.keep`'s; `revokeOthers` deletes every other
  session, or every session where `origin.keep` is `null`, and answers how many went. Each records `sessions-revoked` in its batch where a
  session went. A custom store does the same.
- **`AuthSessionInput`, `AuthSessionRecord`, `AuthSessionResolved`, `AuthSessionUser`, `AuthSessionStepUp` and `AuthSessionRotation` in
  `@y-core/forge/auth`.** `AuthSessionInput` is `{ tokenHash, userId, signedInAt, signedInWith, stepUp?, device? }`. `AuthSessionRecord`
  is `{ id, signedInAt, expiresAt, lastSeenAt, stepUpAt, stepUpKind, device }`, where `id` is the public handle a session list or an event
  names the session by. `AuthSessionResolved` is `{ session, user }`, with `user` an `AuthSessionUser`,
  `Pick<AuthUser, "id" | "email" | "isAdmin">`, the only owner columns a signed-in request reads. `AuthSessionStepUp` is `{ at, kind }`,
  and `AuthSessionRotation` is `{ replaces, tokenHash }`. `device` is a coarse browser-and-platform label of at most 64 characters, such as
  "Firefox on macOS", which the verify action reads off `User-Agent`; neither the user agent nor an IP address is stored.
- **`revokeOtherAuthSessions(session, sessions: Pick<AuthSessionStore, "revokeOthers">, userId, at)` in `@y-core/forge/auth/web`**, which
  deletes every session the user holds except the one `session` names and answers how many went.
- **The passkey page prompts for a backup passkey** while the visitor holds exactly one, linking to passkey enrolment.
- **`AuthEphemeraPurgeReport` and `AuthEphemeraPurgeOptions` in `@y-core/forge/auth`.** The report is `{ deleted, complete, blocked }`.
  `deleted` counts each table's own rows, not the rows a deleted account cascades to, under the keys `challenges`, `nonces`, `signIns`,
  `securityEvents` and `users`; `signIns` counts sessions. `complete` is `false` while lapsed rows remain, and `blocked` lists, in run
  order, the keys of the tables a constraint refused, such as `"signIns"`. The sessions key is not `sessions` because the default log
  redaction masks any key containing `session`, which would hide the count in a logged report.

### Fixed

- **`forge db reset` accepts a dump taken after `ANALYZE`.** The dump's sidecar counts `sqlite_stat1`, which the live count leaves out,
  so every such dump was refused as stale and `--allow-unbacked` was the only way through. A sidecar already written is covered too.
- **The gate's `types:cf-runtime` step creates `.types/` before running `wrangler types`**, which exits 1 when the directory is absent.
  A fresh clone whose `.types/` holds no tracked file no longer fails the step.
- **`forge-ui-platform-view-transition` names `@view-transition { navigation: auto; }` as the fix for a cross-document navigation**,
  and only that rule in a scanned stylesheet silences it. It no longer prescribes `startViewTransition()`, which cannot animate a
  navigation, and a `startViewTransition` string in the file no longer silences it.
- **`Steps.Step` and `Timeline.Item` recolour their marker when the client changes `data-state`.** The tone was fixed at server
  render. A trail nested inside another item takes no tone from the outer item.
- **R2 serving fails closed on a stored type it cannot parse.** `serveObject` sends such a type as `application/octet-stream` under
  `Content-Security-Policy: sandbox` and, unless the caller passes a `contentDisposition`, as an attachment. The outgoing `Content-Type` is the
  normalised type rather than the stored string, and `put` infers the type from the key when `contentType` is empty.
- **The build-time SVG sanitizer is an allowlist.** `sanitizeSVG` keeps only known graphics elements and drops every other element, a prefixed
  name included, with everything inside it. It keeps a few prefixed attributes and only the root's SVG and XLink namespace declarations, keeps an
  `href` only as a same-document `#fragment`, and drops any attribute whose `url()` reaches outside the document. `svgToSymbol` and
  `splitSvgRoot` run the same pass, root attributes included. An unclosed element that is dropped takes everything up to the end of its parent,
  an unclosed `script` or `style` takes the rest of the file, and kept elements are always closed, so the output is well-formed XML.
- **A sprite declares the XLink namespace on its root**, and a baked cursor binds it around markup that uses `xlink:href`, so an icon written
  with `xlink:href` no longer leaves the standalone sprite or the cursor's data URI unparseable.
- **Removing the last passkey drops its factor row, and the recovery codes nothing else holds.** `CredentialStore.removeForUser` now does in its
  batch what `FactorStore.remove` does.
- **KV logs no longer carry a key or a stored value.** `kv.miss` records no key, and `kv.decode-error` records no key and only the error's name
  as `error`, in place of the serialized error whose message could quote the value.
- **An unconfirmed authenticator-app secret is re-offered for 15 minutes at most**, counted from when it was minted. Starting enrolment after
  that replaces it with a new secret.
- **The account pages read factor state with one `auth_factors` read per page**, where they read each offered factor's rows in turn.
- **`RecoveryCodeStore.stage` inserts up to 20 codes per statement**, so staging 10 codes is 2 statements where it was 11.
- **`UserStore.setWebAuthnIdIfAbsent` writes and reads back the handle in one batch**, one round trip where it took two.
- **`AdminUserStore.remove` deletes the user row alone and leaves the children to the schema's `ON DELETE CASCADE`**, where it deleted each
  child table first.
- **`AdminUserStore.remove` answers `referenced` when an app key's `ON DELETE SET NULL` on a column that cannot hold `NULL` refuses the
  delete**, a `NOT NULL` or `CHECK` refusal, as it does for a foreign-key one; it answered an `AuthStoreError`. A custom `AdminUserStore`
  answers the same.
- **`fakeAuthD1` answers `AdminUserStore.remove` as D1 does:** `"changed"` for a removable account, which then no longer reads back and whose
  sessions and security events go, `"last-admin-delete"` for the last active admin, and `"not-found"` for an unknown id. It answered
  `"not-found"` for every account.

---

## [0.7.5] — 2026-11-18

### Breaking Changes

- **Under `--report`, a browser row runs Playwright's `failures` reporter beside `json`, in place of `list`, and needs `@playwright/test`
  1.65.** A green row's log now holds only the summary. `failures` is new in 1.65, and devctl's Playwright servers refuse any other
  major.minor, so pin `"@playwright/test": "~1.65.1"`: a caret lets `bun update` resolve a 1.66 the server answers with a 428.
- **The optional `wrangler` peer floor rises from `>=4.151.2` to `>=4.164.0`**, the version the gate runs. That wrangler needs Node 22.12.0
  or later.
- **`dbSteps` adds a `runtime` row, `db:types`, running `forge db types --check`.** An app that declares `schemas` fails it until it runs
  `forge db types` and commits the file.
- **A second session middleware on one request throws, and so does a swapped session.** `sessionMiddleware`, and `createAnonymousSession`
  with it, throws on entry when `sessionCtx` already holds a session, so two mounts whose paths both match a request (`*` and `/admin/*`)
  no longer let the second replace the first. After the handler it throws, saving nothing, when `sessionCtx` holds a different session from
  the one it set. Mount one session middleware per request, and keep separate state as separate keys of the one session.
- **`definePage` and `defineAction` take their route first, and come only from `createHandlerFactory`.** `@y-core/forge/app` no longer
  exports them, and `c.params` in every hook is now typed from the route's pattern, so a handler mapped to a route whose params differ fails
  to compile. To migrate:
  1. Add one `handlers.ts` exporting `const { definePage, defineAction } = createHandlerFactory<Bindings, AppConfig>();`, and import the
     builders from it instead of from `@y-core/forge/app`.
  2. Pass the route first and drop the type arguments: `definePage<Bindings, AppConfig>({ … })` becomes `definePage(routes.task, { … })`.
     The loader data, the action data and the schema are inferred.
  3. Drop the `?? ""` fallback on a param the pattern always captures. A param inside an optional segment stays `string | undefined`.
  4. Type a helper that receives a handler's context as `AppContext<Bindings, RouteParams<typeof routes.task>>`, importing `RouteParams` from
     `@y-core/forge/router`.
- **`AppContext` and `getAppContext` default `Params` to `Record<string, string | undefined>`**, where it was `Record<string, string>`, so
  a context from a route with an optional segment fits every API typed `AppContext<Bindings>`. Code that names no params type — middleware,
  a plain handler, a helper typed `AppContext<Bindings>` — now sees each `c.params` value as `string | undefined`. Name the params where a
  `string` is needed: `AppContext<Bindings, RouteParams<typeof routes.task>>` for a route, or `getAppContext<Bindings, { id: string }>(c)`
  where middleware knows its route.
- **`Middleware`, `RequestHandler`, `RequestContext` and `createContextKey` are no longer exported from `@y-core/forge/router`.** Import
  them from `@y-core/forge/context`, which exports all four unchanged.
- **`@y-core/forge/router` no longer re-exports `RouterTypes`, `RouterOptions`, `RouteEntry`, `MatchData`, `MiddlewareContext`,
  `BuildRoute`, `RouteDef`, `RouteDefs`, `RoutePatternCapture`, `RoutePatternJSON`, `getRoutePatternCaptures` or `MatcherLimits`.**

### Added

- **`createRowLoader(db, { select, keyOf })` in `@y-core/forge/storage/db`** answers every `load(key)` made in one microtask tick from
  one `query`, binding the distinct keys as one JSON array for `json_each`.
- **A client from `resolveD1Client` or `defineD1Binding` counts its request's calls** and logs `d1.request.budget` at `warn` on the 11th
  run of one statement and at the 900th call; `queryBudget: { repeats, queries }` in the client options moves either threshold.
- **Lint rules `forge/sql-in-loop`** (a `.query`, `.queryOne` or `.execute` awaited in a loop or run in a `.map`/`.flatMap`/`.forEach`
  callback) **and `forge/sql-tag-called-directly`** (`sql(…)` called as a function).
- **`forge db types` writes `config/db/tables.ts`** (the host config's `types`): one row interface per declared table and a `Tables` map, for
  `db.query<Tables["users"]>(…)`.
- **`exposedHeaders` on `cors()` in `@y-core/forge/security`** sends `Access-Control-Expose-Headers` on allowed actual responses, never on a
  preflight, so a cross-origin script can read `ETag` or a pagination header. A name that is not a header token, and `"*"` with
  `credentials: true`, throw at construction.
- **`Cookie` and `CookieInit` are exported from `@y-core/forge/http`**, for reading a request's `Cookie` header.
- **`CreateHrefOptions` and `CreateHrefSearchParams` are exported from `@y-core/forge/router`**, the types of the options object `href`
  and `createHref` take and of its `searchParams`.

### Changed

- **`d1Sessions`' bookmark `Set-Cookie` lists its attributes in `SetCookie`'s order**, as `d1b=…; HttpOnly; Path=/; SameSite=Lax; Secure`.
  The attributes and their values are unchanged.

### Fixed

- **`serveObject` honours `Range` on `GET` only** (RFC 9110 section 14.2). A `HEAD` or any other method with a `Range` gets the whole
  object's `200`, never a `206` or `416`.
- **`cors` refuses an `allowedHeaders` entry that is not a header-name token at construction**, as it already did for `exposedHeaders`, so
  a comma, space or CR/LF can no longer split or corrupt `Access-Control-Allow-Headers`.
- **`queryOne` appends `LIMIT 1` to a `SELECT` with no top-level `LIMIT` of its own**, so D1 reads and bills one row rather than every
  match. Any other statement, `VALUES` and a write's `RETURNING` included, is sent as written.
- **`Range` and `ContentRange` from `@y-core/forge/http` follow `@remix-run/headers` 1.1.0.** `Range.normalize()` returns only the ranges
  the resource can satisfy, and `ContentRange.from()` returns an empty instance for invalid bounds.
- **`app.use()` after the app's first request throws** instead of registering middleware that never runs. A `map()` after the first
  request still takes effect.
- **`createUnsignedCookie` holds `__Host-` and `__Secure-` names to their prefix**, as `createSignedCookie` does: such a name is `Secure`
  by default, and `secure: false` or a `__Host-` `domain` or non-`/` `path` throws at construction or on `serialize`.
- **`createKVSessionStorage` and KV-backed `createAnonymousSession` throw at construction on a TTL below 60 seconds**, the shortest
  `expirationTtl` Workers KV accepts, instead of failing on every save. Under `createAnonymousSession` that includes a `maxAge` below 60
  where no `ttlSeconds` is given.
- **Signing in under `createAnonymousSession`'s cookie storage no longer logs the old session id.** `regenerateId(true)` made upstream
  `@remix-run/session` `console.warn` it on every sign-in.
- **`serveObject` evaluates preconditions in RFC 9110 order and sends `Last-Modified` from the upload time.** `If-Match` and
  `If-Unmodified-Since` answer `412`, `If-None-Match` compares weakly and answers `304` even beside a `Range`, `If-Modified-Since` is
  honoured, and a stale `If-Range` or a malformed, multi-range or non-`bytes` `Range` serves the whole object with `200` instead of `416`.
  `IfMatch`, `IfNoneMatch` and `IfRange` are exported from `@y-core/forge/http`.

---

## [0.7.4] — 2026-11-03

### Breaking Changes

- **The markdown footnotes label moves down with `headingOffset`.** It was a fixed `<h2>`, so under an offset it outranked the document's own
  headings; at 2 it is now an `<h4>`. `MARKDOWN_ELEMENTS` allows `class` and `id` on `h3` to `h6` for it. A schema of your own that allows them
  only on `h2` must widen the shifted tag when it passes an offset, or the label loses `sr-only` and shows.
- **The log viewer's root is a `<div>`, no longer `<main id="main-content">`.** Inside a shell that wraps its page in `<main>` it nested one
  `main` in another. Your shell supplies the landmark: a skip link that targeted `#main-content` points at the shell's own `<main>` instead, and
  a `<main>` between the body and the viewer is a flex column itself (`flex min-h-0 flex-1 flex-col`) for the table to fill the viewport.
- **`Popover` and `Menu` render their roots and panels as `<div>`, `Menu.Group` as `<div role="group">` and `Menu.Separator` as `<hr>`,
  reversing 0.6.0's `<span>`s.** A panel holds flow content — the navbar megamenu, the chrome toolbar flyout, `authNav`'s sign-out `<form>` —
  which a `<span>` may not. `Tooltip` and `Menu.GroupLabel` stay `<span>`s, since they hold only text. To place one in running text, put only
  the `Popover.Trigger` or `Menu.Trigger` inside the `<p>` and the panel straight after it; `for` and `id` link them and the panel still
  anchors to its trigger. A selector of yours that names the tag, such as `span[data-slot="menu"]`, stops matching; key it on `[data-slot]`.
- **`AuthNav.slots` holds render functions, and the sign-out button is a `menuitem` only inside a navbar menu.** Every copy carried
  `role="menuitem"`, so the bar-level slot and the collapsed disclosure copy exposed a menu item with no menu around it. A `Navbar` slot may now
  be a `NavSlotRender`, called with `{ inMenu }`. Spreading `authNav`'s result onto `Navbar` is unchanged; a layout that places the slot itself
  calls it, as `slots[AUTH_NAV_SIGNOUT_SLOT]?.({ inMenu: false })`.
- **`AuthFactorsView` names its page with an `<h1>`, "Sign-in methods", and defaults to `level` 1 like every other auth view.** Served
  whole it had only two `<h2>`s. Its subsections, the first renamed "Methods offered", move to `<h2>` and the empty state's title to `<h3>`.
  Served as an htmx fragment into the admin edit page it resolves at level 2. A stylesheet or test of yours keyed on `h2` in this view must
  follow the new levels.
- **The `Navbar` slot wrapper is a `<div>`, no longer a `<span>`.** A slot with a `label` or `filters` is wrapped, and `authNav`'s filtered
  sign-out slot put its `<form>` inside a `<span>`. The wrapper's classes and box are unchanged. A selector of yours on
  `span[data-slot~="navbar-slot"]` stops matching; key it on `[data-slot~="navbar-slot"]`.

### Fixed

- **The `forge-ui-platform-display-contents` rule no longer advises `<header>` or `<section>` for a group that is one item of a `grid` or `flex`
  parent.** A `<header>` outside sectioning content is a second `banner` landmark, and invalid inside a `<footer>`. The rule names `<hgroup>`
  for a heading and its intro, and a `modern-css-allow` reason on the `<div>` for any other group.
- **A comment between a `grid` or `flex` parent and its wrapper no longer silences `forge-ui-platform-display-contents`.** Only a
  `modern-css-allow` reason naming the rule, on the wrapper's line or the one above it, clears the wrapper, so a wrapper an unrelated comment
  used to hide is now flagged.
- **`forge-ui-platform-native-dialog` names `show()` for a `role="dialog"` that claims no modal.** It advised `showModal()` for every hit,
  which makes the rest of the page inert behind a non-modal panel; an `aria-modal` hit still gets `showModal()`. Preflight item 78 accepts a
  hit on a `popover` element, as `Popover.Content` is.
- **`forge-ui-platform-native-details` no longer flags `aria-expanded` on a menu button, a combobox, a menu item, a tree item or a row.** An
  element carrying `aria-haspopup` or one of those roles is skipped, since `<summary>` permits no role. The message names the documented
  exception, a trigger and panel that cannot be one subtree.
- **The passkey list's and the admin user list's empty-state titles nest under the view's heading.** They were a fixed `<h2>`, so a view
  placed with `level={3}` gave its empty state a title that outranked it; it is now an `<h4>` there, and still an `<h2>` by default.

---

## [0.7.3] — 2026-11-03

### Breaking Changes

- **`createConfig` refuses an `env("…")` name your `wrangler.jsonc` does not declare, and a binding's name.** The module `forge cf gen env`
  writes now declares the Worker's env to `@y-core/forge/config`, and the check runs once that module is in the program. A var set only in
  the dashboard is declared in `config/env.config.ts` as `optional: new Set(["NAME"])`, which writes it as an optional string. `EnvMapping`'s
  nested-record branch no longer matches an `EnvRef`, which is what let any name through before.
- **A var or required secret that only `env.<name>` declares is now in `EnvSchema` and `Env`, optional**, as `wrangler types` types it.
- **`cloudflareWorkerSteps` adds the default-on row `validate-env-schema`**, which fails a committed env schema that differs from what
  `forge cf gen env` would write now, so a var renamed in `wrangler.jsonc` without a regeneration fails the gate. Commit the module, and run
  `bun run gen:env` or `forge verify --fix`. A worker config must declare `secrets`, listing them in `secrets.required`. An app whose script
  passes `--out` or `--config` sets `envSchema: { out, config }`; `envSchema: false` drops the row.
- **`loadOptions` from `@y-core/forge/tooling/cf` takes the root it resolves the config module against first**, as `loadOptions(root, path)`,
  rather than reading `process.cwd()`.

- **`forge db backup` and `forge db restore` run the pipeline in the CLI, and the D1 backup Workflows are retired.** `runD1Backup`,
  `runD1Restore`, `BackupWorkflowStep`, `BackupStepConfig`, `BackupDuration`, `BackupMultipartUpload`, `BackupUploadedPart`, `CloudflareAccess`,
  `BackupDatabase`, `BackupStatement`, `D1BackupOptions`, `D1RestoreOptions` and `D1RestoreTarget` are removed from
  `@y-core/forge/storage/backup`, which keeps the readers: `listD1Backups`, `latestD1Backup`, `readD1Backup` and their types.
- **`backup` and `restore` drop `--workflow` and `--port`, and gain `--bucket` and `--prefix`; `backup` gains `--keep`.** A local run reaches
  D1 and R2 through the platform proxy and needs no dev session. A remote run uses `--account-id` and `--api-token`, a token holding
  `Account → D1 → Edit` and `Account → Workers R2 Storage → Edit`, since it reads and writes the dump bucket too.
- **`forge db promote --instance` and `--workflow` are replaced by `--restored <database id>`.** `restore` keeps its report in R2 at
  `<prefix>/<database id>/restores/<restored id>.json`, and `promote` reads it there.
- **The `forge db` dump verbs no longer fall back to a config's only R2 bucket.** Without `--bucket` they use the `BACKUPS` binding, and a
  config without one is refused, so a dump never lands beside unrelated data such as user uploads. Declare a `BACKUPS` bucket for the dumps.
- **`restore --into fresh` refuses a database whose name would make the new one longer than D1's 64 characters**, before any request.
- **`new D1BackupError(kind, message)` takes no `status`, `D1BackupFailureKind` is only `"malformed"`, and `BackupBucket` loses
  `createMultipartUpload`.** `isPermanentBackupFailure` and `permanentFailures` are removed.
- **`DbIo` gains `database`**, which answers a local D1 binding. A hand-built `DbIo` must supply it.

### Fixed

- **`verify` no longer refuses the step table once `.types/` holds only gitignored output.** `validate-generated-types` watched `.types/**`,
  which matched nothing git lists after an app deleted the stubs 0.7.1 retires, so every tier and `--list` exited. The row now runs on every
  change, since the wrangler output it looks for is gitignored and no tracked change would run it.
- **The `forge-ui-platform-display-contents` rule and warning name the wrapper that makes its children one item of a `grid` or `flex` parent.**
  Dissolving it puts the parent's gap between them, so name that group with an element such as `<hgroup>` or `<header>`, which the check
  does not flag.
- **`@y-core/forge/tooling/assets` type-checks without `harfbuzzjs`, `sharp` or `esbuild` installed.** Its sources no longer take types from
  the optional peers, so an app can delete any local `declare module` stand-in for them.
- **`@y-core/forge/tooling/gate` type-checks without `esbuild` or `tailwindcss` installed.** Its bundle and design-system checks no longer
  take types from either optional peer.
- **`forge assets build` refuses a `css` entry up front when no `tailwindcss` binary runs**, naming the entry and `@tailwindcss/cli`, the package
  Tailwind v4 ships the binary in. Forge now declares it as an optional peer beside `tailwindcss`.
- **`forge cf gen env` writes a header naming the command that regenerates the file, every non-default flag included**, so a module written
  with `--out` no longer tells you to run a command that writes somewhere else.
- **`forge cf gen env` writes `type Env` before `EnvSchema`**, so the module passes an imports → types → consts layout check and needs no
  exclusion.

### Upgrading

Run your `gen:env` script, or `forge cf gen env` with the flags your module's old path needs, then `bun check`. Each error names an `env()`
key that `wrangler.jsonc` does not declare: declare it there, or list it under `optional` in `config/env.config.ts` if it is set only in the
dashboard. Delete any hand-written check of `env()` names against `Env`, and any layout-check exclusion for the generated module.

An app wired with the old backup Workflows deletes its `D1Backup` and `D1Restore` classes, their `workflows` entries in `wrangler.jsonc`, and
the Worker secret holding the D1 token if nothing else reads it. Schedule `forge db backup --target remote --account-id … --api-token … --keep
<n>` from CI or cron instead, and promote with `forge db promote --restored <database id>`. An app whose dumps went to its only R2 bucket declares a
`BACKUPS` bucket and deletes the `d1-backups/` prefix from the old one once a backup has run.

---

## [0.7.2] — 2026-11-02

### Breaking Changes

- **`ClassGroupsCheckConfig` and `DesignScaleCheckConfig` require `fixer`, the command that regenerates the table.** The generated banner and
  every drift finding name it, and the banner names the table's own file, so neither points at a forge-only script any more. `renderClassGroups`
  and `renderDesignScale` take the table and the fixer as their second argument.

### Fixed

- **`forge cf gen env` writes a one-line header that passes the comment budget**, and names `forge cf gen env` instead of `bun run gen:env`.
- **`forge assets gen types` writes a two-line header that passes the comment budget**, where three `//` lines failed it.

---

## [0.7.1] — 2026-11-02

### Breaking Changes

- **The optional `wrangler` peer floor rises from `>=4.99.0` to `>=4.151.2`**, the version the gate runs.
- **`forge cf gen env` takes secret names from `secrets.required` once `wrangler.jsonc` declares `secrets`, and stops reading `.dev.vars` for
  them**, as `wrangler types` does. After you regenerate, a `.dev.vars` key that isn't in `secrets.required` drops out of `EnvSchema` and `Env`.
- **`forge cf gen env` now types `analytics`, `k2` and `pipelines` bindings, so a regenerated `EnvSchema` requires them on the first request.**
  List a binding that is absent under `wrangler dev` in `optional`. `unsafe` and `logfwdr` stay untyped, and the cf README says what to do instead.
- **`cloudflareWorkerSteps` generates runtime types only: the `types:cf-bindings` row and `.types/worker-configuration.d.ts` are gone.** Delete
  that file and take `Env` from `forge cf gen env`, which types every binding kind but `unsafe` and `logfwdr`. The new
  `validate-generated-types` row fails while wrangler output other than `.types/cloudflare.d.ts` is there.
- **With `workerConfig` set, `types:cf-runtime` passes `--config`**, because runtime types follow the config's compatibility date and flags.
- **`forge db --env <name>` refuses an environment that declares no `d1_databases` instead of using the top level's**, because wrangler gives
  that environment no D1 binding. Restate the entries under `env.<name>.d1_databases`.
- **`validate-dev-boundary`, `validate-dev-bundle` and `validate-asset-root` also judge an `env.*` block's own `main` and `assets`**, so a config
  that passed may now fail.
- **`forge db --target remote` and `--target preview` reach D1 over Cloudflare's REST API and authenticate only from `--account-id` and
  `--api-token`.** `wrangler login` and exported variables no longer authenticate them, and either flag missing is refused before any request. In
  Workers Builds, set both as build secrets and pass them as `--account-id "$CLOUDFLARE_ACCOUNT_ID" --api-token "$CLOUDFLARE_API_TOKEN"`, with a
  token holding `Account → D1 → Edit`.
- **`forge cf sync` reads its credentials from `--account-id` and `--api-token` alone.** `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are
  no longer read.
- **`timeTravelInfo` and `timeTravelRestore` return promises, and `timeTravelRestore` returns the undo `Bookmark` and takes the run's config.**
  `forge db bookmark restore` prints the command that undoes it.
- **`DbIo` gains `fetch` and `wranglerVersion`, and `Home` gains `databaseId`.** A hand-built `DbIo` or `Home` must supply them.
- **`forge db backup` and `forge db restore` drive your app's D1 Workflows, and the backup artifact is retired.** `forge db backup` starts the
  `d1-backup` Workflow, which stores D1's own dump and a sidecar in R2. `forge db restore --from <key>` starts `d1-restore`, which imports a dump
  into a new database. Forge no longer reads rows, writes `.forge/backups` artifacts or downloads an export to disk: `--out`, `--no-verify`,
  `--label`, `--via`, `--export-timeout`, `--artifact`, `--route`, `backupsDir`, `runBackup`, `prepareRestore`, `executeRestore`,
  `readBackupManifest` and the manifest types are removed. Wire the Workflows as the storage README shows, and take a backup with them.
- **`forge db reset` and `forge db migrate --rehearse` rely on R2 dumps instead of backup artifacts.** `reset` refuses a local database holding
  rows unless the newest complete dump in the local R2 bucket is under 24 hours old and matches its row counts (`--dump` names one, `--bucket`
  and `--prefix` say where). `--rehearse` loads the newest dump, or the one `--dump` names, into a scratch, checks it against the sidecar, then
  applies. `reset --backup` and `migrate --artifact` are removed.
- **`DbIo` loses `writeStream` and gains `bucket`**, which answers a local R2 binding. A hand-built `DbIo` must supply it.
- **`EmailOtpOptions.address` returns `AuthStoreResult<string>`, and a failed lookup now sends no code and starts no cooldown.**
  `createChallenge` answers it as `unavailable`. Return `ok(email)` where you returned the address, and
  `err(new AuthStoreError("unavailable", …))` where you returned `""`. The auth README's getting-started builder shows the wiring.
- **Answering an email-change link takes a `GET` and a `POST`: `AuthEmailChangeFlow` gains `inspect`, and your confirm route calls `confirm`
  only from the `POST`.** A link scanner's `GET` used to burn the token and move the account. Render `EmailChangeConfirmView` from the `GET`
  with what `inspect` answers, and call `confirm` from its form's `POST`; an `AuthEmailChangeFlow` you implement yourself needs `inspect` too.
- **`StepBase.narrow` and `StepProbe` are removed, and `StepReach` is `"whole" | "untouched"`.** No forge builder set `narrow`. A step of your
  own that did runs whole when its `watches` or its `widen` reach a pending change, and is untouched otherwise. Delete the `narrow` option and
  drop any `StepProbe` import.
- **`csrfTokenCtx` is removed from `@y-core/forge/form`: `csrfProtection` no longer pre-mints a token on GET.** Render a form that posts back
  to its own page with `await mintCsrf(c, c.url.pathname)`.
- **`validate-class-tokens` and `validate-faded-text` now read the class strings inside a template's `${…}`**, so a typo in a conditional class
  that passed before may now fail. A quote or backtick inside a regex literal also no longer hides the strings after it. `stringLiterals` moves
  from `checks/class-tokens` to `checks/source-scan`, and `@y-core/forge/tooling/gate` still exports it.
- **`forge cf sync` now reads Workers Builds when `package.json` pins `bun@`, so a token that is account-scoped or lacks Workers CI gets an
  `error` row and the run exits 1.** Give the token Workers CI (Read for a status run, Write for `--commit`) and make it user-scoped.
- **`WranglerD1Module` no longer needs `unstable_splitSqlQuery`**: forge cuts every local load with its own statement cutter, and needs only
  `getPlatformProxy` from wrangler.

### Added

- **`@y-core/forge/ui/chrome` composes the primary navbar from contributions.** Call `createPrimaryNav<Key, Ctx, State>()` once, have each
  feature `contribute` its items, `hrefs`, footer links and state resolver, and pass `definition()` and `resolveHref` to `Navbar`. A misspelled
  key fails `bun check`, a duplicate key or a "Menu" label throws at `contribute`, and an unknown key throws instead of linking home.
- **`@y-core/forge/storage/backup` restores a dump into a new database with `runD1Restore`.** As Workflow steps, it creates the database (or
  takes an empty standby), imports the dump through D1's import API, and reports every way the result differs from the dump's sidecar. Under
  `forge cf dev` it imports into a standby binding. `forge db restore --from <key>` starts the app's `d1-restore` Workflow and prints its report,
  exiting non-zero on any mismatch.
- **`forge cf sync lifecycle` keeps an R2 lifecycle rule that ages backups out.** `--bucket`, `--expire-days` and `--ia-days` describe it,
  `--prefix` defaults to `d1-backups`, and `--commit` writes it. It replaces only forge's own rule, by id, and keeps every other rule on the bucket.
- **`forge db promote` points the deployed app's D1 binding at a restored database.** Give it the `d1-restore` instance with `--instance`; it
  refuses a report with a mismatch, rewrites only the binding's `database_id` and `database_name` once you confirm, keeps the old database, and
  prints the command that swaps back. Deploy afterwards to make it live.
- **`forge db backup` runs the app's backup Workflow and prints what it stored.** It starts the instance through the Cloudflare API for a
  deployed database, or through the `forge cf dev` session (`--port`, default 8787) for a local one. It follows the instance to its end and prints
  the dump's key, size, bookmark, migration head, rows and hazards. `--workflow` names another than `d1-backup`.
- **`@y-core/forge/storage/backup` archives a deployed D1 database into R2 from a scheduled Workflow.** Call `runD1Backup(step, options)` from
  your `WorkflowEntrypoint`, passing the database's binding as `database`. It exports through the D1 REST API, streams the dump into R2 by
  multipart upload, and writes a `.json` sidecar beside it: the size, md5, sha256, rows per table, schema digest, migration head, and every
  value the dump will not reproduce. A short or stalled download stores nothing, and a virtual table is refused before the export. It prunes past
  `keep`. `listD1Backups` lists the archives newest first, marking which are complete. `latestD1Backup` answers the newest complete one, and
  `readD1Backup` its sidecar. Under `forge cf dev` the same run backs up the local database into local R2.
- **`requireAdmin` takes `onForbidden`, so a signed-in non-administrator can be answered with a page instead of a plain 403.** Pass the same
  function as `onForbidden` to `createAuthGuards`, and the admin pages and their actions answer with it too. With none, the answer is unchanged.
- **`forge cf sync` sets the Workers Builds `BUN_VERSION` from `package.json` `packageManager`.** It reports drift for each build settings scope
  and writes the exact `bun@X.Y.Z` version on `--commit`, through a user-scoped token with Workers CI.
- **`onForbidden` on `csrfProtection` lets you answer a CSRF refusal yourself**, such as with a fragment an HTMX target can swap. It is called
  with the context and a `CsrfRefusal` reason (`"unbound-subject"` or a `CsrfFailure` code), for routing and logging. Without it the guard still
  answers a bare `403`.
- **`authCsrfRefusal` and a `GET` sign-out confirm page recover a sign-out whose CSRF token expired.** Pass
  `onForbidden: authCsrfRefusal(paths.auth)` to `csrfProtection`, and a sign-out posted from a page open longer than an hour goes to
  `auth.signoutConfirm()` instead of answering 403 with the session still signed in. `authRoutes` gains the `signoutConfirm` leaf, so a map of
  your own must handle it with `loadSignoutConfirm`.
- **`forge db backup list`, `pull <key>` and `push <file>` copy D1 dumps between R2 and disk.** `list` prints each dump with its size, when it was
  taken, and whether its sidecar was written. `pull` and `push` check the bytes against the sidecar's size and sha256, keep or upload nothing
  that differs, and never replace an object. A push to a deployed bucket is capped at 300 MiB, the limit of Cloudflare's REST object endpoint.

### Fixed

- **A KV-backed anonymous session that holds no data no longer writes a record**, so a first view of a page with a session-bound CSRF form, or a
  refused cookie-less POST, costs no KV write. A signed id with no record is restored under the same id, and `csrfProtection` reads the session
  id on a GET only when the handler mints a token.
- **`forge cf gen env` types a service binding as `Fetcher`, as `wrangler types` does, and no longer reads `websearch`, a key wrangler rejects.**
  `Fetcher` is what `Service` already resolved to, so code that reads the binding is unaffected.
- **`validate-exposure` and `validate-compatibility` judge each environment as wrangler builds it.** An `env.*` block that leaves out
  `workers_dev`, `preview_urls`, `route`, `routes` or `compatibility_flags` inherits the top level's value. A finding names an environment only
  for a key it states itself, and both summaries count every deployment.
- **`validate-dev-bundle` no longer refuses `alias` inside an `env.*` block**, since wrangler reads `alias` only at the top level.
- **A synthesized home under `--env` carries that environment's `account_id` and `compatibility_date`.**
- **A local load and `openTestD1` keep `BEGIN TRANSACTION` and `COMMIT;` text inside a literal intact.** Wrangler's splitter deleted the first
  of each anywhere in the text, so such a literal loaded changed, or was refused as holding several transactions.

---

## [0.7.0] — 2026-10-31

### Breaking Changes

- **`changelogStep` belongs in a table's `static` tier, and forge's is there**, so `verify:static` and every commit catch a hand-edited released
  section or a malformed heading rather than the tag. An empty `[Unreleased]` is still refused by `forge release`, not by this row.
- **`workerdStep` runs whole, and `cloudflareWorkerSteps({ workerd: true })` places it in `scheduled`, so a bare `verify` runs no Playwright
  suite.** Its `narrow` and `widen` options are gone, and `cloudflareWorkerSteps({ workerd: true })` no longer traces the Worker or its assets for
  it. A commit now reaches the workerd set only through `verify:scheduled`; a table that passed `narrow` or `widen` to `workerdStep` drops them.
- **Every config module forge loads is `config/<concern>.config.ts`, and forge reads only its default export, a call to that concern's `define*`
  helper.** Rename and wrap each one you have. `config/steps.ts` → `config/steps.config.ts` with `defineSteps` (`tooling/gate`).
  `config/commands.ts` → `config/commands.config.ts` with `defineCommands` (`tooling/cli`). `config/release.ts` → `config/release.config.ts` with
  `defineReleaseConfig` (`tooling/release`). `config/db.ts` → `config/db.config.ts` with `defineDbConfig` (`tooling/db/host`). `config/features.ts`
  → `config/features.config.ts` with `defineFeatures` (`tooling/curate`). `config/site.ts` → `config/site.config.ts` with `defineSiteConfig`
  (`site`). A root `assets.config.ts` → `config/assets.config.ts` with `defineAssetsConfig` (`tooling/assets`). `src/app/env.config.ts`'s named
  `options` → `config/env.config.ts` default-exporting `defineEnvConfig` (`tooling/cf`). A named export beside the default is no longer read, and
  `LoadedConfigModule` has no `exports`. `warden probe --golden` takes a module default-exporting `defineWardenQueries({ golden, negative })`,
  resolved against the repository root.
- **`validate-config-files` holds every `config/*.config.ts` to that shape, and `cloudflareWorkerSteps` and `forgeChecks` emit it in `static`.** It
  fails a named export, a top-level statement other than an import or a `const`, `import.meta.main`, a default that is not a call to an imported
  `define*` helper, and a `config/` holding no `*.config.ts`. A module that only holds data keeps a plain `.ts` name and is not read.
  `configFileStep` and `checkConfigFiles` are its builder and check.
- **A step table declares its tiers.** `config/steps.config.ts` default-exports `defineSteps({ inputs?, tiers: { static, unit, runtime, scheduled }
  })`. Each tier lists its rows in run order, and `tier("unit")` as an entry includes that lower tier's rows in place. Replace `export default
  STEPS` with the tiered table, and `export const GATE_INPUTS` with `inputs`. Nothing sorts a tier, so a tier above `static` leads with `tier()`
  naming the one below. `createGateCommand` takes `tiers` in place of `steps`, and `selectSteps` takes the `data` of `resolveTiers(tiers)`.
  `resolveTiers` refuses a reference to an undeclared or non-lower tier, and a label one tier holds twice. At `runtime` only a row the tier declares
  itself, or one stating `narrow`, narrows; a row reached through `tier()` runs whole.
- **No builder takes a `tier` option, and no step has a `tier` field or a default tier.** A row runs in the tiers that list it. Move each `{ tier:
  "…" }` row into that tier's list.
- **`dbSteps()` returns `{ static, runtime }` rather than an array**: the schema digests, then the lint and the replay. Merge it with `mergeTiers`,
  or spread `.static` and `.runtime` into those tiers.
- **`cloudflareWorkerSteps`, `forgeChecks` and `wardenAppSteps` return a `StepTiers` table rather than an array.** Use a complete preset as `tiers`
  directly, or merge rows onto it with `mergeTiers`. `wardenAppSteps` declares rows only and merges onto a complete preset. Two complete presets
  merged together are refused as a duplicate label.
- **`config/cron.ts` and `verify:cron` are gone: Firefox and WebKit are a `scheduled` row.** Move `crossEngineStep()` into your table's `scheduled`
  tier and delete the `verify:cron` script. `verify:scheduled`, the tag's run and the cron's, then needs the compat Playwright server as well, and
  fails without it. Forge's own `verify:scheduled`, which `prepublishOnly` and `forge release` run, takes Firefox and WebKit.
- **`src/auth/schema.sql`'s header comment names `config/db.config.ts`, so the file's digest moved.** An app that composes the auth schema sees
  `db:schema:digests` report it moved since the last compose. Run `forge db migrate compose` once: it writes no migration and records the new digest
  in the snapshot. Then commit the snapshot.
- **`MarkdownRenderContext.task` is the box's `MarkdownTask` — its `line`, `offset` and `checked` — rather than its checked state**, and a handler
  now sees it on `leave` as well as `enter`. A handler reading it as a boolean reads `task?.checked` instead.
- **`sanitizeSvg` in `render/markdown` answers a `Result`** whose `error` is `"unparseable"`, rather than the drawing or `null`. A caller
  checking `=== null` checks `.ok` instead and reads the drawing from `.data`.
- **The markdown viewport's `"rendered"` rendering is now `"styled"`**, beside the new `"html"`, so `ViewportRendering` is `"raw" | "styled" |
  "html"`. Replace every `"rendered"` passed to `mountMarkdownViewport` or `setRendering` with `"styled"`; nothing else about it changed.
- **The gate type-checks with `bun check` and formats with `bun fmt`, so `cloudflareWorkerSteps` and `forgeChecks` need Bun 1.4.4 or later.**
  `typecheckStep` runs `bun check --no-script --no-pretty` in place of `tsc --noEmit`, and `formatStep` runs `bun fmt --no-script --check` and
  fixes with `bun fmt --no-script`, still configured by `.oxfmtrc.json`. `forge cf gen env` and `validate-design`'s fence compile use the same
  two tools. Set `packageManager` to `bun@1.4.4`, drop the `typescript` and `oxfmt` devDependencies, then run `bun fmt --no-script` once and
  commit it: under `objectWrap: "collapse"`, `bun fmt` writes a multi-line mapped type on one line where oxfmt kept it broken.

### Added

- **The markdown viewport shows your dialect's HTML as a third, read-only rendering.** Give `ViewportDialect` an `html(markdown)` that answers
  `renderMarkdownHtml` output with `lineAnchors: true`, then mount in `"html"` or call `setRendering("html")`. The viewport writes the whole
  document into a light-DOM `<div class="markdown" data-viewport-html>` slotted beside the editor, so your page's CSS and event delegation reach
  it, and it rewrites it on each `replace` while it shows. The rendering is read-only whatever the mode, and a `setMode` call made during it
  applies when you leave it. `topAnchor` and `scrollTo` keep the reader's line across the switch. Without `dialect.html`, both entries into
  `"html"` throw a `TypeError`.
- **`onHtml` on `ViewportOptions` runs with the `html` container after each write**, for wiring the new markup up, such as `htmx.process`.
- **`MARKDOWN_TRUSTED_TYPES_POLICY` in `render/markdown` names the `forge-markdown` policy** that the viewport writes its HTML through. An app
  that shows `"html"` under Trusted Types lists it in `trusted-types`. When the browser refuses it, the viewport logs a `console.error` naming
  the fix, writes nothing, and marks the container `data-viewport-html="refused"`.
- **`afterTransitions` in `ui/client` defers an overlay's teardown past its exit fade.** `afterTransitions(el, fn)` runs `fn` once every
  transition on `el` settles, or at once when none is running, and returns a call that runs `fn` now if it has not run — the open path calls it
  first, so a reopen is not emptied by the close before it.
- **`listTasks` and `setTasks` in `render/markdown` read and toggle GFM task boxes in the source.** `listTasks(document)` answers each
  box's 1-based `line`, source `offset` and `checked` state; `setTasks(source, document, checkedLines)` ticks exactly the given lines,
  rewriting only the character between each box's brackets, and returns a `Result` whose `error` lists any given line that holds no box.
  `MarkdownListItem` gains `box`, the unit-relative offset of its `[`.
- **`headingOffset` on `MarkdownRenderOptions` moves every heading down by 0 to 5 levels**, with a level past six rendering as `h6`; any other value
  throws.
- **`breaks: true` on `MarkdownRenderOptions` writes every soft line break as `<br>`**, the same markup a hard break writes, in paragraphs, list
  items, headings and blockquotes alike.
- **`createUrlPolicy` and a `links.rel` render option in `render/markdown`.** `createUrlPolicy({ linkProtocols, srcProtocols })` returns a policy of
  `isSafeUrl`'s shape for your own schemes, still refusing protocol-relative and backslash paths and schemes hidden behind control characters, and
  `isSafeUrl` is now its default instance. `renderMarkdownHtml(document, { schema, links: { rel } })` writes `rel` on every link the source wrote,
  autolinks included, for a schema whose `a` rule lists `rel`. A GFM `www.` autolink is written as `http://`, so `isSafeUrl` renders it as text.
- **`tasks: { name }` on `MarkdownRenderOptions` renders GFM task boxes as form fields.** Each box is written inside a `<label>` with its text, as
  `<input type="checkbox" name value>` whose `value` is the line `listTasks` reports, so a posted form's ticked lines go straight into `setTasks`;
  `disabled: true` writes `disabled`. Without `tasks` the output is unchanged. Your schema must allow `label`, and `name` and `value` on `input`.
- **`MARKDOWN_ELEMENTS` in `render/markdown` allows every element and attribute the default handlers write**, for spreading into
  `HtmlSchema.elements` beside your own `url` policy: tables with alignment, footnotes, `language-*` classes, `data-line`, the task `label` and
  `input`, and `rel` on links. It sends `href` and `src` through `schema.url`, carries no `patterns`, never allows `style`, and is frozen; replace a
  rule by its key to tighten it.
- **`markdown.css` in `ui/assets/css` styles `renderMarkdownHtml` output inside an element with the `markdown` class**, and nothing outside one:
  headings, lists, code, tables with their alignment, task boxes and their labels, and footnotes with a hidden heading. Every rule has zero
  specificity and sits in no layer, so an unlayered rule of yours with one class wins; colours, code font and radius are `--markdown-*` properties
  falling back to forge's theme. Import it after `tailwind.css`. Classes renamed through `classNames` lose their rules.
- **`continueList`, `wrapSelection` and `toggleTask` in `render/markdown` are editor commands for Enter, Mod-B/I/E/K and task boxes.** Each takes
  the text and selection and answers one `MarkdownEdit` — `from`, `to`, `insert` and `selection` — or `null`. Enter continues a list only at the
  end of an item, numbering on and keeping the bullet or delimiter, any `>` and indentation, and `[ ]` after a task; on an empty item it ends the
  list. Items come from forge's parser over the one block unit being edited, which `createMarkdownDraft` and `reviseMarkdownDraft` keep current, so
  a fence, a `* * *` rule or a `> - x` quote reads as the renderer reads it. `MARKDOWN_WRAP_KEYS` maps each shortcut's letter to its wrap.
- **`mountMarkdownTextarea` in `render/markdown/editor/textarea/client` gives plain textareas markdown keys, with no CodeMirror.** Mounted on a
  form or region, it serves every `textarea[data-markdown]` inside from one listener: Enter continues lists, Mod-B/I/E/K wrap the selection, and
  Mod-Enter calls `onSubmit`. It returns a disposer. Edits go through the browser's editing so undo takes them back, and a key is left alone while
  an input method composes, with Shift or Alt held, in a `readonly` textarea, or after another listener's `preventDefault()`.
- **`DeclaredGraph.modules` narrows a declared edge to named files of its target.** `validate-namespace-graph` fails an import from the source
  namespace, type-only included, that reaches any other file of the target, a narrowing `edges` does not declare, and a named file outside the
  target.
- **The markdown viewport continues lists on Enter and wraps the selection on Mod-B, Mod-I, Mod-E and Mod-K**, through `render/markdown`'s
  `continueList` and `wrapSelection`, so it reads lists and markers as the renderer does. Enter is a plain line break wherever no list continues;
  Mod-I replaces CodeMirror's select-parent-syntax binding. None of these keys edits in view mode or while an input method is composing.

### Changed

- **A task checkbox in the markdown viewport ticks a box only where `render/markdown`'s parser reads one**, through `toggleTask`, rather than
  wherever the text reads `[ ]`.
- **`warden/knowledge` reads a search term of three characters or fewer unstemmed, by prefix**, so `ios` reaches `ios` and no longer `io`. An
  index built by an earlier version is rebuilt on its next open. `documentFrequency` counts a term the way `coverage` reads it; the new
  `bridgeFrequency` counts a bridge term, and `UNSTEMMED_TOKENIZE` is the tokenizer a short term is read through.
- **`warden`'s Zed settings no longer route formatting to an oxfmt language server**, and its native downloads no longer fetch oxfmt or the
  TypeScript compiler.

### Fixed

- **`validate-docs` no longer reads a markdown link written inside a code span as a link**, so `` `[text](url)` `` reports no missing target.

---

## [0.6.2] — 2026-10-30

### Breaking Changes

- **`validate-dev-boundary` fails an app `imports` entry other than `#app/relax` that carries `forge-dev`**, with the finding on `package.json`.
  `cloudflareWorkerSteps` applies it and it cannot be opted out of; `#app/relax/*` counts as a second alias too. Move each relaxation onto the
  `#app/relax` pair, `src/app/relax.dev.ts` and `src/app/relax.strict.ts`, wrapping the dev export in `whenArmed` and annotating it `typeof` its
  strict twin, then delete the old entry.
- **The `release` tier is now `scheduled`, and `--tier release` is refused.** `GATE_TIERS` is `static`, `unit`, `runtime`, `scheduled`;
  `test:browser`, `test:browser:cross-engine`, `validate-dev-bundle` and `validate-changelog` default to `scheduled`. Rename the `verify:release`
  script to `verify:scheduled`, set `--tier scheduled` in `verify:cron`, and replace `{ tier: "release" }` with `{ tier: "scheduled" }`. The
  `forge release` command keeps its name and runs `verify:scheduled` before it tags. task-forge's cron has to look for `verify:scheduled`.

### Changed

- **`validate-dev-boundary` watches `package.json`**, so `--affected` and a `runtime` run re-judge the `imports` map when it changes.

### Changed

- **The radii derived from `--radius` offset it in rem, not px**, so they scale with the root font size as `--radius` does: `--radius-box` is
  `calc(var(--radius) + 0.375rem)`, `--radius-sm` to `--radius-xl` and `shape-compact.css` follow, and `shapeVars` writes the same. Every value
  is unchanged at a 16px root.

### Fixed

- **A generated scheme no longer pins control heights and radii in px.** Since 0.3.1, `schemeCss` appended a shape block whatever the dials, and
  `shapeVars` valued it in px. A scheme is imported after `theme-base.css`, so controls stopped scaling with the reader's root font size, and
  `--radius-field` and `--radius-box` stopped following `--radius`. `schemeCss` now emits the block only when a shape dial differs from the default
  shape, headed by `--radius`, and `shapeVars` writes control heights in rem and each radius as an offset from `--radius`. Regenerate a scheme
  made on any earlier release, and delete its shape block if you never moved a shape dial.
- **An icon-only `Dialog.Close` no longer has to squeeze its icon.** Since 0.6.0, `Dialog.Trigger`, `Dialog.Close`, `Drawer.Trigger`,
  `Drawer.Close`, `Popover.Trigger`, `Menu.Trigger` and a bare `Tooltip.Trigger` render the `sm` button box, whose `px-3` survives a caller's
  `size-*`: a `size-8` close leaves about 6px for a 16px icon. 0.6.0's Breaking Changes did not say so. Each now takes `shape`, as `Button` does,
  except `square`, which would drop the height; replace a `size-8` or `p-0` override with `shape='icon'` for a 32px square with no inline padding.

---

## [0.6.1] — 2026-10-30

### Breaking Changes

- **`validate-features` is gone, with `featuresStep`, `checkFeatures`, `FeaturesCheckConfig` and the preset's `features` option.** It ran the
  whole `unit` gate once per curated skeleton, and could not pass for an app with `design` set, since the skeleton is not a git work tree. To keep
  the import boundary reading `config/features.ts`, move the flag onto it: `importBoundary: { guarded, features: true }`.
- **The `deploy` tier is gone; its rows start at `release`.** `GATE_TIERS` is `static`, `unit`, `runtime`, `release`, and `--tier deploy` is
  refused. `test:browser`, `validate-dev-bundle` and `validate-changelog` now run at `release`. Delete the `verify:deploy` script, and point a
  tag's CI at `verify:release`.
- **Firefox and WebKit are no longer a gate row at any tier.** `browserSteps`, `isBrowserEngine` and `BrowserEngine` are removed, and
  `browserStep` takes no `projects`: it runs Chromium alone. The preset's `browser` option is a boolean; replace `browser: { engines }` with
  `browser: true`. Run the other engines through a cron table: add `config/cron.ts` default-exporting `[crossEngineStep()]` and a
  `"verify:cron": "forge verify --config config/cron.ts --tier release"` script.

### Added

- **`crossEngineStep()` runs Firefox and WebKit as one row, `test:browser:cross-engine`, behind the `playwright-compat` server.** It defaults to
  `release`, runs whole, and its `report.json` entry lists each failing spec with its engine. It belongs in a table other than `config/steps.ts`.
- **Forge's own `config/cron.ts` and `verify:cron`**, which replace the `test:browser:cross-engine` script. task-forge's cron runs
  `verify:release` and then `verify:cron` on each repository that declares both.
- **A table other than `config/steps.ts` leaves the verify receipt alone.** `forge verify --config config/cron.ts` neither records a green run
  nor clears a standing one, so a red cron run never makes `--reuse` re-run the gate. `GateCommandConfig.receipt: false` does the same for a
  table handed to `createGateCommand`.

---

## [0.6.0] — 2026-10-29

### Breaking Changes

- **The browser set leaves the `runtime` tier: `test:browser` runs from `deploy`.** A bare `verify` runs no browser spec; `verify:deploy` is the
  first tier with Chromium, and the other engines stay at `release`. The whole suite was the gate's slowest row, and narrowing it bought almost
  nothing because its reach was the Worker's whole import graph. A broken page is now caught by a nightly `verify:release` rather than at task
  close. No `config/steps.ts` change is needed: `cloudflareWorkerSteps` and `browserSteps` carry the new tier.
- **`browserStep` and `browserSteps` take no `narrow` or `widen`.** Nothing narrows a row that starts at `deploy`. Delete either option from the
  call.
- **`buildScale` and the `Dials` type are no longer exported from `@y-core/forge/ui/contracts/theme`.** `buildScale` measured unfloored chroma,
  so it disagreed by a byte with the hex a scheme file paints. Read `buildTheme(dials)[family][mode].solid` instead.
- **A mounted `Tabs` leaves an unselected panel `hidden="until-found"` with `tabindex="-1"`, not `hidden=""`**, and find-in-page or a fragment
  link into it selects its tab. A disabled tab's panel is `hidden=""`. `forge-ui.css` no longer sets `display: none` on an `until-found` panel,
  which kept find-in-page from revealing it; the panel is positioned out of flow and its padding, border and margin are zeroed instead, so the
  root's `gap` does not count it. Update a test that expects `hidden=""`.
- **`createFlash` takes `ring: KeyRingResolver<Bindings>` in place of a `KeyRing`**, resolved from each request's context as
  `createAnonymousSession`'s is. Build the flasher once at module scope: `createFlash({ ring: createKeyRingResolver<Env>((c) => …) })`, or pass
  `ring: () => ring` to keep a ring imported elsewhere.
- **`isBareSpecifier` is no longer exported from `@y-core/forge/tooling/gate`.** An `@import` id that starts with neither `.` nor `/`
  names a package; test that inline.
- **`createBoundControl` and `createBoundCompound` are no longer exported from `@y-core/forge/ui/controls`.** They were internal factories; the
  bound controls the barrel exports are the whole API.
- **`applyFormat` from `@y-core/forge/ui/contracts` leaves a value with more characters than the template has slots unchanged**, instead of
  returning its bare characters, and a letter or digit literal typed where the template has a slot, such as the `1` of `+1`, is kept as content.
  A separator is still removed wherever it is typed, so `123-4567` under `####-####` regroups as `1234-567`.
- **`Turnstile` reserves the widget's box on an inner `[data-ref="turnstile-frame"]` element**, so a `class` passed to `Turnstile` no longer sizes
  the reserved box.
- **`FormField` takes no `name`.** It never wired anything. Pass the `name` to `FormField.Label`, `.Description` and `.Error` and to the control's
  `field` descriptor, which derive the `id`, `for` and `aria-describedby`, and delete it from the root.
- **The bound `Input` from `@y-core/forge/ui/controls` no longer accepts `format`.** Passing both is a type error; a bound field's value is its
  signal's.
- **`Carousel` takes no `snap`.** It only stamped a `data-snap` that nothing read, so the slides never moved. Pass `snap` to each `Carousel.Item`
  and delete it from the root.
- **A control's `field` descriptor takes the error message as `error`, and no longer accepts `invalid`.** A non-blank `error` emits `aria-invalid`
  and adds the error id to `aria-describedby`; a blank one (`""`, whitespace only, an empty array) marks nothing, so the control never names a
  `FormField.Error` that rendered nothing. Replace `field={{ name, invalid: Boolean(error) }}` with `field={{ name, error }}`. `FormField`'s own
  `invalid` is unchanged.
- **`CheckboxGroup` and `RadioGroup` take the error message as `error`, and no longer accept `invalid`.** A non-blank `error` stamps `data-invalid`
  and adds the error id to the fieldset's `aria-describedby`; a blank one (`""`, whitespace only, an empty array) marks nothing, so the group never
  names a `.Error` that rendered nothing. Replace `invalid={Boolean(error)}` on the root with `error={error}`. An `.Item`'s own `invalid` is
  unchanged.
- **The chrome `Toolbar` no longer adds an `active` class to an action whose `active` is set.** The item is marked by `aria-pressed` and
  `data-pressed`, which forge now paints. Move any `.active` rule of your own to `[data-pressed]`.
- **`Tooltip`, `Popover` and `Menu` render their roots and panels as `<span>`, and `Menu.GroupLabel` as `<span>`, instead of `<div>`**, so one
  placed inside a `<p>` no longer splits the paragraph. A selector of yours that names the tag, such as `div[data-slot="menu"]`, stops matching;
  key it on `[data-slot]` alone.
- **An `alert` `Dialog` closes on Escape alone, and a backdrop click no longer closes it.** It renders `closedby="closerequest"`, following APG's
  alert dialog.
- **`mountTabs` reads the arrow-key axis from the tablist's `aria-orientation`**, and no longer from the root's `data-orientation`. Hand-written
  `Tabs` markup must set `aria-orientation="vertical"` on the `role="tablist"` element for ArrowUp and ArrowDown to move between vertical tabs.
  Markup that `Tabs` renders already does this.
- **`Menu.Group` renders `<span role="group">` and `Menu.Separator` renders `<span role="separator">`, instead of `<fieldset>` and `<hr>`**, so a
  grouped or separated menu inside a `<p>` no longer splits the paragraph. A selector of yours on `fieldset` or `hr` inside a menu stops
  matching; use `[data-slot~="menu-group"]` or `[data-slot~="menu-separator"]`. `MENU_GROUP_SELECTOR` no longer matches `fieldset`.
  `Menu.Group`'s `disabled` still disables its rows: it sets `aria-disabled` on the group and passes `disabled` to each `Menu.Item`,
  `.CheckboxItem`, `.RadioItem` and `.SubmenuTrigger` that leaves its own unset. A `Menu.LinkItem` is not disabled by its group.
- **`bindAttr` and `bindAttrAttr` refuse `hx-vals`, `hx-headers`, `hx-confirm`, `hx-trigger`, `hx-config` and every `hx-status:*` rule**, in
  the `hx-` and `data-hx-` spellings and with a `:inherited` or `:append` suffix, because htmx evaluates their values as script or swap
  configuration. `bindAttrAttr` throws on one and `bindAttr` warns and
  skips it. Write these attributes in markup, or bind a signal to an attribute htmx does not evaluate.
- **A custom `--command` runs the handler of the scope holding its `commandfor` target**, with `el` still the invoker. Before, the handler was
  looked up from the invoker, so an invoker inside one scope that names an element in another now runs the other scope's handler.
- **`splitLightDark` is no longer exported from `@y-core/forge/tooling/gate`.** Import it from `@y-core/forge/ui/contracts/theme`, beside
  `lightDark`, which is now its only home.
- **`FOUC_SCRIPT` has changed.** A CSP that lists its hash in `script-src` must list the new one; compute it from the exported constant.
- **`Dialog.Trigger`, `Dialog.Close`, `Drawer.Trigger`, `Drawer.Close`, `Popover.Trigger`, `Menu.Trigger` and a bare `Tooltip.Trigger`
  render the `sm` button box**: a control height, padding, a transparent border and the focus ring, where they used to render an unstyled button
  24px tall. Your `class` is merged over it, so your padding still wins while the height holds the 28px Floor. A trigger you styled as a link or
  sized below 28px renders taller; restyle it through `class`.
- **A chrome `Toolbar` flyout is built from `Popover`'s parts, and its `data-side` names the side the panel opens on**, no longer the rail's
  edge: a `left` rail's flyout carries `data-side="right"`. A stylesheet of yours keyed on the old value must swap it for its opposite. The flyout
  root is a `<span>` whose `data-slot` also holds `popover`; the panel's holds `popover-content` and the panel carries `data-scope="popover"` and
  `data-align="start"`; the trigger's holds `popover-trigger`. A selector naming `div[data-slot~="toolbar-popover"]` stops matching; key it on
  `[data-slot]` alone.
- **A `Navbar`'s position classes are on its outermost `<div data-scope="navbar">`**; a `class` passed to `Navbar` no longer changes where it
  sticks.
- **`Toolbar.Input` takes a `size` of `sm`, `md` or `lg`** (default `sm`, matching the toolbar's buttons) in place of the native numeric `size`
  attribute; set a width with `class` instead.
- **A Firefox or WebKit row from `browserSteps` probes `PLAYWRIGHT_COMPAT_WS_ENDPOINT`**, devctl's `playwright-compat` server, instead of
  `PW_TEST_CONNECT_WS_ENDPOINT`, and fails naming it when unset or unreachable. An app listing those engines points its `firefox` and `webkit`
  projects there through `use.connectOptions`, as the `tooling/gate` README shows.
- **`browserStep` refuses `projects` that run on different Playwright servers**, such as `["chromium", "firefox"]`. Give each engine its own row
  with `browserSteps`.
- **`data-state` is a state attribute, not a presentational one.** `STATE_ATTRS.state` and `stateAttrs({ state })` replace
  `PRESENTATION_ATTRS.state` and `presentationAttrs({ state })`, and an empty `state` now emits nothing.
- **`RULE_ENFORCER` in `@y-core/forge/tooling/lint` maps each rule to a list of enforcers** instead of one, and `RuleEnforcer` gains
  `"faded-text"`. `forge-ui-contrast-floor` lists `["contrast", "faded-text"]`. Read `RULE_ENFORCER[id].includes("lint")` where you compared
  `RULE_ENFORCER[id] === "lint"`. Its value type excludes `"gate"`, which only a `MODERN_CSS_RULES` row carries, so routing a corpus rule to
  the gate no longer compiles.
- **An unselected `Tabs.Content` renders `hidden="until-found"` instead of a bare `hidden`.** This shipped in 0.5.15, whose section does not
  record it. With no script, a find-in-page match inside an unselected panel reveals it, in an engine that implements `until-found`. A test of
  server-rendered markup that expects `hidden=""` must expect `hidden="until-found"`, except on a `Tabs.Content` given `disabled`.

### Added

- **`validate-modern-css` warns on geometry keyed on `:popover-open` or `[open]`** (`forge-ui-platform-exit-geometry`). Since 0.5.15 an overlay
  stays painted through its exit fade after the open state ends, so a `width`, `inset`, `padding` or `transform` declared there collapses mid-exit.
  Move it to the base selector and key only `opacity`, `overlay` and `display` on the open state. A property the stylesheet transitions is not
  reported.
- **`forge verify --report <dir>`** writes `report.json` — tier, `HEAD`, tree, start time, duration, verdict, and each step's status, duration
  and log — and every step's whole log into `<dir>`, whatever the verdict. A browser row also lists its failing tests by engine, spec, title and
  first error line, read from Playwright's JSON reporter; a run that never reached a test is `setup` rather than `failed`. The types are
  `GateRunReport`, `StepReport`, `StepStatus`, `TestFailure` and `StepResults` from `@y-core/forge/tooling/gate`.
- **`bun run verify:deploy`** in forge's own scripts, the tier the canon names.
- **`RULE_ENFORCER` routes `forge-ui-hit-target` to a new `"browser"` enforcer**, in `@y-core/forge/tooling/lint`, and `RuleId` and
  `RuleEnforcer` gain the matching members. Forge's browser set now measures every published `ui/core` and `ui/chrome` pointer target against the
  absolute 28px Floor, under both the default shape and `shape-compact.css`.
- **`NavbarAction` and `MenuItemAttrs` types in `@y-core/forge/ui/contracts`**; `menuItemAttrs` returns `MenuItemAttrs`.
- **A sticky top `Navbar` reserves its height as `scroll-padding-top`**; `--forge-navbar-height` sizes the bar and the reserve.
- **`toneSurface` in `@y-core/forge/ui/core`** — `toneVariants`' paint without the hover fill, for a static toned panel.
- **`fadedTextStep`, `checkFadedText` and `fadedText` in `@y-core/forge/tooling/gate`.** The `validate-faded-text` row fails a fade below full
  strength — an `opacity-*` or a text colour's `/alpha` modifier on a class string, or either in a stylesheet's `@apply` — unless a disabled state
  or an audited alpha pair holds it. Its config type is `FadedTextCheckConfig`.
- **`crossEngineTagsStep` and `checkCrossEngineTags` in `@y-core/forge/tooling/gate`.** The `validate-cross-engine-tags` row fails an untagged
  top-level browser spec block that reads an engine-computed value, and `@cross-engine` spelled anywhere but a top-level block's
  `{ tag: "@cross-engine" }`. The parts are exported too: `validateCrossEngineTags` judges one spec, `findCrossEngineUnits` and
  `findEngineReaders` read its blocks and engine reads, `resolveFixtureReaders` follows a `*.fixture.ts` import, and the types are
  `CrossEngineTagsCheckConfig` and `CrossEngineUnit`.
- **`Tabs.Content` takes `disabled`**, rendering `hidden=""` so find-in-page cannot reveal a disabled tab's panel before `mountTabs` runs. Pair it
  with the `disabled` on that panel's `Tabs.Tab`.
- **`findStylesheetComments` in `@y-core/forge/tooling/gate`** returns every block comment in a stylesheet with its opening line.
- **`FILTER_SCOPE`, `OTP_INPUT_SCOPE` and `OTP_LENGTH_ATTR` in `@y-core/forge/ui/contracts`**, the scope names `Filter` and `OtpInput` stamp and
  the attribute carrying an OTP field's length.
- **JSX intrinsic elements type 13 more ARIA 1.2 attributes**, among them `aria-roledescription`, `aria-pressed`, `aria-modal` and `aria-sort`,
  so a value of the wrong type is a compile error instead of passing unchecked.
- **`forge/a11y-state-attrs-source` (`forge-ui-a11y-state-attrs-source`) reports a Tailwind variant that styles from an `aria-*` state
  `STATE_ATTRS` gives a `data-*` hook**, such as `aria-selected:` or `aria-[checked]:`. `MENU_ITEM_CLASS` now reserves the checkable row's gutter
  by role.
- **`Drawer` takes `alert` and `described` and has a `.Description`**, as `Dialog` does.
- **JSX types accept `hidden="until-found"`, and the renderer emits it as written on any element**; `hidden={true}` still renders a bare
  `hidden`. Since 0.5.15, unrecorded there.
- **`BrowserEngine`, `isBrowserEngine` and `StepReach` are exported from `@y-core/forge/tooling/gate`.** Since 0.5.15, unrecorded there.
- **`@y-core/forge/relax` arms an app's own development relaxation.** It publishes `isDevBuildArmed` and `whenArmed`, so a dev module is
  `whenArmed(isDevBuildArmed, relaxed, strict)` and no longer redeclares `__FORGE_DEV__`. It resolves under `forge cf dev` and in Bun, and a Worker
  built without `forge-dev` fails to resolve it. Put an app's relaxations on one `#app/relax` pair (`src/app/relax.dev.ts` /
  `src/app/relax.strict.ts`); see `src/relax/README.md`.

### Changed

- **`@y-core/forge/auth/client` imports `@y-core/forge/ui/core/client`**, so the turnstile scope no longer needs a separate import.
- **`forge-ui-a11y-one-live-region` reports an `<output>` that states neither `aria-live` nor `role`**, since it is an implicit `role="status"`
  live region. Give a readout `aria-live="off"`, or speak through `announce()`. **`forge-ui-a11y-live-politeness` accepts `aria-live="off"`**, which
  it used to report.
- **A contrast pair's foreground may carry an `alpha`.** The contrast check measures it composited over the background, using `compositeOver` from
  `@y-core/forge/tooling/gate`, and reports a translucent background as unresolved.
- **`Carousel` and `Carousel.Item` take their `carousel` and `slide` role descriptions from `LABEL_DEFAULTS`** as `carouselRoleDescription` and
  `carouselSlideRoleDescription`, so a catalogue typed `Record<keyof typeof LABEL_DEFAULTS, string>` needs both keys.
- **`Dock` takes a fixed height per `size`** (3rem, 3.5rem, 4.5rem, plus the safe-area inset) instead of growing with its content, so the page can
  reserve exactly that height.
- **`forge-ui-focus-ring` and the other class rules judge a module-scope `*_CLASS` or `*_CLASSES` string where it is declared**, and follow a
  chain of same-file constants to the class list it names. A class constant that suppresses the outline with no ring is reported even when nothing
  in its own file uses it.
- **Hovering a `Toast` or `Alert` dismiss draws a 1px outline in the glyph's colour.** There is no background tint, so the glyph's contrast is the
  same hovered as at rest.
- **The `Navbar` drawer opens and closes on Drawer's `--forge-motion-enter` / `--forge-motion-exit`**, and fades in place under reduced motion
  instead of snapping.
- **`Navbar` renders `data-side` with its placement on its `<details>`.**
- **`NumberField`'s steppers take a `size` and are as tall as an input of that size**: a default stepper is now 40px rather than 32px.
- **`Toggle` and `Toolbar.Input` use `Button`'s padding scale**: padding follows the size (12/16/24px). A `Toggle` label no longer wraps, and its
  colour changes transition.
- **`Stack`'s back layers no longer fade, and the `Navbar` menu chevron paints at full strength.**
- **The comment budget reports a count with up to three words before its noun**, such as "the four shipped schemes", and a comma after the noun no
  longer counts as the start of an enumeration.
- **`forge-ui-platform-accent-color` in `validate-modern-css` reports an `<input type={…}>` whose binding is typed as `"checkbox"` or `"radio"`**,
  such as a component factory's parameter, so a hand-styled checkable built through one is reported like a literal `type="checkbox"`, and a braced
  string literal such as `type={"checkbox"}`.
- **`schemeCss` emits no header comment beyond its `modern-css-allow` waiver**, the form forge's own scheme files take, so a generated scheme
  passes forge's stylesheet comment budget. The dial values a file was made from travel in the `dialQuery` link instead.
- **The default accent is desaturated.** `theme-neutral.css` declares the accent ramp at chroma 0.115 instead of 0.195, so the default
  `--primary` paints `#4b65ab` in light and `#4861a7` in dark instead of `#375bd7` and `#3457d3`, and the accent chroma dial's fallback is 115.
  To keep the old blue, generate a scheme at `accentChroma` 195 or re-declare `--primary`.
- **`mountTabs` hides every panel its selected tab does not name when it mounts.** A panel that a fragment link or find-in-page revealed before
  the controller ran is hidden again, so the server's selection is what shows. Since 0.5.15, unrecorded there.

### Fixed

- **A `watches` glob whose directory exists but holds no matching file yet no longer fails the gate.** A glob is stale only when its literal
  directory is gone, so a markdown source such as `src` with no `.md` in it passes, and a renamed `docs/` is still refused.
- **`buildTheme`'s `solid` hex is the colour its `oklch()` paints, at every dial.** Each step's chroma is cut toward zero to the places
  `schemeCss` prints rather than rounded, and `solid` is measured from that printed coordinate, so the live readout and swatches no longer differ
  from the pasted file by a byte. A generated chroma figure can print up to 0.0001 lower than before; `theme-neutral.css` is unchanged.
- **A `--forge-navbar-height` under 1.75rem no longer shrinks a `Navbar` below the 28px Floor.** The bar's row, its drawer toggle, the
  panel's clearance and the scroll-padding reserve hold at 1.75rem.
- **Every flash call in one request reaches the next page, including calls made together.** `createFlash` merges them into one `Set-Cookie` in call order, dropping the oldest
  messages past 4096 bytes; before, the browser kept only the last.
- **`Input`'s `format` no longer deletes a digit literal's digit from the value.** With `format='+1 (###) ###-####'`, `4155551212` now groups as
  `+1 (415) 555-1212` instead of `+1 (455) 552-2`.
- **A form control under `Tooltip.Trigger asChild` or `Toolbar.Button asChild` keeps its own `type`.** Switch, Toggle, Slider, Input,
  CheckboxGroup.Item and RadioGroup.Item no longer render `type="button"`.
- **`<Button asChild disabled>` or `loading` onto a link component is inert.** A router `Link` carrying an `href` renders `aria-disabled="true"`
  with no `href`, instead of a live `<a href disabled>`.
- **`Turnstile` recognises a form submitted through `hx-action`.** In submit mode the press is held for the challenge, and the widget resets after
  a submission and clears the form after a 2xx, as it does for a verb attribute.
- **A second reveal of `Turnstile`'s fallback message is announced again**, after a retry or a swap, rather than only the first time.
- **A revealed `Turnstile` fallback no longer overlaps the control below the widget.** The messages render below the widget's frame, outside it.
- **`Filter`'s `×` empties the group even when the server checked a chip, and every chip stays reachable by arrow keys**; the clear needs
  `@y-core/forge/ui/core/client`.
- **`OtpInput` accepts a code pasted with spaces or dashes.** It no longer renders `pattern` or `maxlength`. With `ui/core/client` imported, the
  field keeps the first `length` digits as they are typed or pasted, and without it the code posts as typed for `formDigits()` to reduce.
- **`Field` names the control it wraps.** A `Select`, `Slider`, `Switch` or `Input` carrying an `id` or a `field` is labelled by the caption
  through `aria-labelledby`; before, it had no accessible name.
- **A `CheckboxGroup.Item` or `RadioGroup.Item` whose `value` is `error` or `description` renders no `id`**, rather than one equal to the group's
  error or description id.
- **A vertical `FormField` no longer overrides its children's widths.** A `Select class='w-40'` renders 160px wide, and `FormField.Label` is as wide
  as its text.
- **Picking the `"false"` item of a `RadioGroup` or `ToggleGroup` bound to a boolean signal sets the signal `false`**; before, it stayed `true`
  while the screen showed the other choice.
- **`bindControls` repaints every bound control after a form reset the reader clicks, and after resetting a form the root wraps**, so the controls
  and their signals agree; before, only a scripted reset of a form around the root repainted.
- **A bound `Slider`'s `<output>` follows a signal write**, rather than keeping the value it last showed.
- **`bindAttr` writes a boolean bound to an `aria-*` attribute as `"true"` or `"false"`**, rather than removing it or writing `""`, so a bound
  `aria-disabled` now blocks the click it should.
- **`Slider`'s `output` readout is no longer a second live region.** The `<output>` carries `aria-live="off"`, so the value is read from the range
  input and no longer announced on every step beside `<Announcer />`.
- **The `Toast` and `Alert` dismiss buttons paint at full strength.** The × and its focus ring were drawn at half opacity, about 2.5:1 on the light
  soft tones; they now take the panel's own text colour. `Alert`'s dismiss is a 32×32 target, and a dismissible `Alert` reserves `pe-10` to clear
  it.
- **`FormField.Error` renders nothing when its message is blank** (no children, `""`, an empty array or whitespace only) rather than an empty
  paragraph carrying the field's error id. `CheckboxGroup.Error` and `RadioGroup.Error` behave the same.
- **A control focused beneath the `Dock` now scrolls clear of it.** While the bar shows, the page reserves its height as `scroll-padding-bottom` on
  `<html>` and `padding-bottom` on `<body>`, and gives it back above `hideAbove`. A `pb-*` utility on your `<body>` replaces that padding.
- **A caller's `aria-describedby` no longer replaces the ids forge derives.** `Tooltip.Trigger` (plain and `asChild`), the `CheckboxGroup` and
  `RadioGroup` roots and `Dialog` now merge it into one list, the caller's ids first and each id once, so the tooltip, the group's error and the
  dialog's description stay announced. An empty or whitespace-only `aria-describedby` on one of them that leaves nothing behind is omitted rather
  than rendered as `""`. `fieldDescribedBy` and `fieldControlProps` also drop an id the caller repeats, and a field control (`Input`, `Select`,
  `Textarea` and the rest built on `fieldControlProps`) omits a blank `aria-describedby` the same way.
- **A caller's `aria-labelledby` no longer replaces the id forge derives.** `Dialog`, `Drawer`, a triggered `Menu.Popup` and `Tabs.Content` merge
  it the same way, the caller's ids first, so the dialog's title, the menu's trigger and the panel's tab still name them.
- **`asChild` on `Button`, `Link`, `Breadcrumbs`, `Pagination`, `Toolbar` and `Tooltip.Trigger` keeps the child's own `aria-describedby` /
  `aria-labelledby`** and lists the compound's ids after it, instead of replacing it.
- **The selected `Tabs.Tab` is marked by more than colour.** It draws a 2px bottom rule in its own text colour, clearing 3:1 against its fill and
  the page in both themes, and under forced colors that rule is `CanvasText` while an unselected tab draws none. Before, its only cue was a 1.08:1
  fill, and in High Contrast every tab looked the same. Every tab is 2px taller, so selecting one never shifts the row.
- **Without script, revealing another `Tabs.Content` by its fragment or by find-in-page hides the server-selected panel**, and its tab drops the
  selected fill, text colour and bar, under forced colors too; `aria-selected` is unchanged until `mountTabs` runs. A caller's override of the
  selected fill now needs `data-selected:not-tabs-revealed:`, because an `aria-selected:` class no longer replaces `Tabs.Tab`'s own. Each set
  reacts only to its own panels — a `Tabs.Content` directly inside `Tabs`, a `Tabs.Tab` directly inside `Tabs.List` — so revealing a nested set's
  panel no longer hides the outer panel that holds it, and following an outer tab no longer hides the inner set's selected panel.
- **A focused menu row draws forge's focus ring.** `Menu.Item`, `.CheckboxItem`, `.RadioItem`, `.LinkItem`, `.SubmenuTrigger` and any row
  wearing `MENU_ITEM_CLASS` show a 2px ring inside the row. Before, focus was only a 1.1:1 tint.
- **A checked `Menu.CheckboxItem` or `Menu.RadioItem` shows a tick.** Every checkable row keeps room for it, so checking a row never moves its
  label. The tick is drawn in the row's text colour and stays visible under forced colors. Before, checked and unchecked rows looked the same.
- **A pressed `Toolbar.Button` or `Toolbar.Link` draws a 2px bar along its bottom edge in its text colour.** Under forced colors it paints
  `Highlight`, with a `CanvasText` focus outline outside it. Only an item given `pressed` carries the cue. Before, pressed and unpressed items were
  identical.
- **The current link in a `Navbar` dropdown, and any `Menu.LinkItem` with `aria-current`, is set semibold on the accent fill**, as the bar's own
  links are.
- **`Alert.Description` and `Toast.Description` paint at full strength**, clearing 4.5:1 on every soft tone in both themes. At 90% opacity the
  light secondary tone measured about 4.2:1.
- **Opening a `Navbar` drawer always moves focus into the panel.** `mountNavDrawer` timed its wait from the panel, which has no transition, rather
  than from `::details-content`, so focus sometimes stayed on the summary.
- **An arrow key pressed on a control that is not one of a composite's items reaches that control.** A `<select>` or radio inside an open
  `Toolbar` flyout keeps its own arrow keys; before, the toolbar swallowed them and moved focus to a rail button.
- **Disabling the item that holds a composite's tab stop at runtime moves the tab stop to the next enabled item.** Before, Tab skipped the
  composite.
- **A `Menu` whose first item is hidden opens with focus on the first visible item.** Before, focus stayed on the trigger and ArrowDown did
  nothing.
- **A popup opened by `openPopoverAt` is anchored to its trigger again the next time the trigger opens it.** `openPopoverAt` removes the
  `data-coords` it added once the popup has closed, and keeps one set in markup. Before, every later trigger open landed at the viewport's top-left
  corner.
- **A context menu that `flip` or the viewport clamp moved grows from the corner nearest the pointer**, rather than always from its top-left.
- **Selecting a tab leaves a nested `Tabs` alone, and checking a radio row leaves a submenu's radios alone.** Before, the outer set deselected
  every inner tab and hid its panel, and the parent menu unchecked the submenu's choice.
- **A composite revealed after focus moved into it keeps its tab stop on the focused item.** Before, a `Menu` whose `toggle` handler focused a row
  reset the stop to the first row once shown, so the next arrow key started from there.
- **`mountNavDrawer`'s default panel is the first child of the disclosure holding a focusable control**, skipping the `<summary>` and a
  `navbar-backdrop` slot. Before, an unmarked backdrop placed before the panel was taken for it, and Tab cycled on the summary alone. It now warns
  when no panel with a focusable control resolves.
- **A non-modal `open` `Dialog` or `Drawer` stays open on an outside click and on Escape.** Before, clicking a nearby input or pressing Escape
  anywhere closed it; a modal open still light-dismisses.
- **A busy trigger under `Tooltip.Trigger` shows its tooltip on hover**, as a disabled one does. Before, `state-busy` blocked the pointer events
  that open it.
- **An open trigger is highlighted over its own utilities.** A `Toolbar` flyout trigger and a `Menu.SubmenuTrigger` paint the open state while
  their panel is open, where their own transparent fill used to win.
- **A compound root's `type`, `orientation` and `size` now reach its parts.** These props are fill-ins only: a prop set on the part itself
  still wins. The same holds for the bound `ToggleGroup` and `RadioGroup` from `@y-core/forge/ui/controls`.
  - `ToggleGroup type='multiple'` renders checkboxes. Before, it rendered radios.
  - `Tabs orientation='vertical'` renders a vertical `Tabs.List`, and ArrowDown moves the selection. The selected tab draws its cue on the
    inline-end side.
  - A vertical `Toolbar`'s `.Separator` runs across the toolbar. Before, it ran along it.
  - `RadioGroup`'s `size` sizes its items.
- **`CheckboxGroup`'s `size` sizes its items**, and the bound `CheckboxGroup` from `@y-core/forge/ui/controls` does the same. Before, a root
  `size` never reached them.
- **On WebKit, a `Filter` chip or single-select `ToggleGroup` chip reached by an arrow key shows the focus ring.** WebKit does not count that
  focus as `:focus-visible`, so the chip used to show none.
- **On Firefox, closing a `Navbar` drawer with Escape returns focus to its toggle.** Before, focus sometimes landed on `<body>`. A click on the
  backdrop also returns focus to the toggle.
- **A `computed` created in a scope's `setup` is released when the scope is disposed**, as an effect already was, and keeps its last value from
  then on. Before, every swapped-out island left its computeds subscribed to any signal that outlived it.
- **An htmx swap no longer copies a `style` attribute your script wrote onto the new element**, which raised a CSP `style-src-attr` violation on
  every swap. A morph never applies or removes a `style` attribute, so a style your script wrote survives it.
- **`Turnstile` counts `hx-get` and `hx-query` as an htmx submission**, in the plain and `data-hx-` spellings, as htmx 4 does. A form using one
  is held in submit mode and reset after its submission, and no longer warns that it has no htmx submission. A GET form carries the token in its
  URL.
- **An outer `Tabs` drives its own tablist when a nested `Tabs`' tablist comes first in the document.** Before, it mounted on the nested one and
  drove the inner set.
- **A custom `--command` from an invoker outside every scope reaches its target's handler**, so a `Toolbar` action with `dispatch: "command"` placed
  outside the scope it names now runs. Before, it ran nothing.
- **`change`, `submit`, `reset` and a custom `command` fired inside an open shadow root reach the scope's handler.** These events never leave the
  shadow tree, so the document's listener never saw them. `resume()` now also listens inside every open shadow root it finds; call
  `resume(shadowRoot)` for one attached later. `bindControls` likewise reads a `change` and repaints on a `reset` inside the open shadow roots under
  its root when it mounts.
- **`resume()` sweeps detached scopes once per call**, rather than once for every scope it resumes, so boot no longer slows with the square of
  the number of scopes.
- **An effect that reads `isDark` before `resume()` re-runs when a theme scope resumes and whenever the theme changes.** Before, it recorded `false`
  and never ran again.
- **A stored theme other than `light`, `dark` or `system` is read as `system`**, by `FOUC_SCRIPT` and by `ThemeToggle`, so the toggle keeps its icon
  and accessible name. Storage that throws on read or write, or is full, no longer breaks the toggle, and `FOUC_SCRIPT` no longer throws in a
  realm without `matchMedia`.
- **`bindAttr` writes a boolean bound to `draggable`, `contenteditable` or `spellcheck` as `"true"` or `"false"`**, as the renderer does. Before,
  `true` wrote `""`, which leaves `draggable` in its default state rather than on.
- **Security: `bindAttr` removes `hx-action`, `hx-get`, `hx-post`, `hx-put`, `hx-patch`, `hx-delete` or `hx-query` while its bound value is a
  `js:` or `javascript:` URL**, and warns once, so htmx sends nothing; a later safe value writes it back. This covers the `data-hx-` spelling, any
  `:inherited` or `:append` suffix and any case. Before, htmx ran the bound value as script on the next request. Values the renderer emits are
  unchanged.
- **A closed `Menu` adds no document listeners and starts no roving-focus observers.** Both start on the first open, and the document listeners
  are removed on close, so a click no longer costs a query per menu on the page.
- **A popover's open state reaches only the invokers whose `aria-controls` names it**, found by one lookup rather than a scan of every
  `[aria-controls]` on the page.
- **A `ui/core` `Input` given `data-field` by hand and a `format` renders its value raw**, so it no longer regroups and then ungroups as the
  binding mounts. It keeps `data-format`, and the client still warns once that format and bind do not compose.
- **`translate={false}` renders `translate="no"`, and `true` renders `"yes"`; `autocapitalize` takes a boolean as `"on"` or `"off"`.** Before,
  `false` dropped the attribute. `bindAttr` writes both the same way, and both props accept a boolean.
- **`cn` keeps utilities that set different properties.** `space-x-4` with `space-x-reverse`, `border-dashed` with `divide-solid`,
  `outline-offset-2` with `outline-hidden`, and `bg-background` with an arbitrary gradient, `bg-[image:…]`, `bg-[size:…]` or `bg-[position:…]`
  now all survive a merge. A bare integer width that Tailwind accepts but does not list, such as `border-3`, `ring-3`, `outline-3`,
  `decoration-4` or `stroke-4`, replaces the root's width and no longer its colour. Before, `cn` dropped one class of each pair.
- **`buildCursors` bakes a token written `light-dark(a, b)`**, taking `b` for a theme whose stylesheet declares `color-scheme: dark` and `a` for
  every other. Before, it threw. A cursor SVG containing a nested `<svg>` is no longer cut short at the inner `</svg>`.
- **Sprite icons no longer break or recolour one another.** The sprite builder prefixes every id inside an icon with the icon's symbol id and
  rewrites the references to it, so two icons that both declare `id="grad"` keep their own gradients. It also reads the `viewBox` and the
  presentation attributes from the root `<svg>`, in either quote style, rather than from the first match in the file, and keeps the content after
  a nested `</svg>`.
- **Security: the sprite and cursor SVG sanitizer writes a `<`, a `>` or a bare `&` in text as `&lt;`, `&gt;` or `&amp;`**, so a stray `<` beside
  an element it drops can no longer join the following text into a live tag such as `<img onerror>`. This flaw predates this release cycle.
- **`Table`'s `zebra` stripes skip a selected row and a toned row**, so neither is hidden under the stripe. Under `pinRows` the scroll wrapper
  takes its parent's `max-height`, so the header sticks inside a parent of bounded height; before, it scrolled away.
- **`Button shape="square"` renders square**, as wide as its container and as tall as it is wide. Before, it kept the control height.
- **`Meter` paints the region HTML's own `<meter>` reports.** Some combinations change colour: a `value` at `max` with no thresholds is now
  optimum rather than suboptimum, and where `optimum` lies outside `low`..`high`, a `value` on the far threshold is suboptimum, as Chromium and
  WebKit paint it.
- **A disabled `Select` is dimmed once, to half opacity**, matching a disabled `Input`. Before, it was dimmed twice.
- **`Indicator` placements mirror in a right-to-left context.** Before, every placement sat about one item width off.
- **A bare `Switch` in a vertical `FormField` keeps its own width**, so its click target no longer spans the row.
- **A chrome `Toolbar` flyout trigger is the same 40px as the rail's actions**, where it rendered 32px, and the flyout opens 0.375rem from the
  rail. **The flyout's accessible name is its label alone**; a `titleAction` no longer joins it, as in "Layers Add layer". **A toolbar action given
  a `data-slot` in `data` keeps `toolbar-action` beside it**, where the caller's value used to replace it.
- **`Breadcrumbs.Link` is a control-height target**, 32px tall, or 28px under `shape-compact.css`, where it was the 20px text line. A trail row grows
  to match.
- **A small `OtpInput` is a 32px hit target**, or 28px under `shape-compact.css`. The editor now reaches over the frame's border, where it sat
  inside it and lost two border widths at every size.
- **`CheckboxGroup.Item`, `RadioGroup.Item` and `Switch` clear the 28px Floor**: the label is at least the `sm` control height (32px, or 28px
  under `shape-compact.css`), and a Switch with no label text is that wide as well. The track is unchanged. A vertical group's items now sit with
  no gap between their taller rows.
- **`Alert`, `Toast`, `Badge` and a toned `Table` row no longer recolour on hover.** They took the hover fill meant for a toned button, which read as
  a button and, on a light solid primary panel, dropped the dismiss glyph to 4.28:1. `toneVariants` keeps its hover fill.
- **`Navbar` with `placement` `top` or `bottom` now sticks to its edge.**
- **A bottom `Navbar` reserves its height at the foot of the page**, and beside a `Dock` the two reserves add up instead of one replacing the
  other.
- **A `left` or `right` `Navbar` on a phone reserves its height at the edge it pins to**, so a focused control scrolls clear of it. Below `md` it
  sits on the top or bottom edge and is sized from `--forge-navbar-height`; at `md` and up it is a column and reserves nothing.
- **An open `Navbar` drawer's first and last links are clear of its toggle on a phone.** The toggle used to cover the edge of the link nearest the
  bar, so a tap there closed the drawer. The toggle now fills the bar's `--forge-navbar-height` row, and the panel starts below it, or ends above
  it on a bottom bar.
- **A `collapsible="always"` left or right `Navbar` rail opened as a drawer on a phone no longer hides its first link under the toggle.** Below
  `md` the rail's toggle is `--forge-navbar-height` tall, and the open panel starts below it; at `md` and up the toggle is unchanged.
- **`Card`, `Dialog`, `Popover.Content`, `Menu.Popup`, the chrome `Toolbar` flyout, the `NumberField` steppers, `Toolbar.Input` and the
  `CheckboxGroup` / `RadioGroup` boxes follow `--border-width`** instead of staying 1px under a shape that thickens borders. `Toolbar.Input` is the
  toolbar's 32px control height rather than 30px.
- **The testing canon names Chromium as the browser set's engine and Firefox and WebKit as opt-in sign-off.** The apps `TESTING.md` §6e and
  `CONFIG_BASELINE.md` said every spec runs on every engine at release, while `cloudflareWorkerSteps({ browser: true })` emits Chromium alone.
  `CONFIG_BASELINE.md`'s `test:browser` script now matches `browserStep`'s argv.
- **`ToggleGroup`'s first item follows `--border-width` on its leading edge**, where it stayed 1px under a shape that thickens borders.
- **A bottom `Navbar`, a `right` one on a phone, and a `side="bottom"` `Drawer` panel rest on top of a showing `Dock`** instead of under it.
- **An `OtpInput` paints its cell rules on Firefox**, where the frame showed its border and no rule between the cells.
- **`validate-design` compiles a `tsx` fence against the step tsconfig's ambient `*.d.ts` files**, so a fence naming a workerd global such as
  `ExecutionContext` is checked against its declaration, and a compiler diagnostic outside a fence now fails the check instead of being dropped.
- **A busy `CheckboxGroup` or `RadioGroup` root emits `aria-busy="true"` beside `data-busy`, and an invalid `RadioGroup` root emits
  `aria-invalid="true"`**, as ARIA 1.2 allows on those roles. A `CheckboxGroup` root still marks invalidity with `data-invalid` alone, because ARIA
  1.2 deprecates `aria-invalid` on the `group` role.
- **In an engine without `popover="hint"`, a `Tooltip` closes on Escape and on a press outside it, and opening one closes any other open
  tip.** Since 0.5.15, unrecorded there.
- **`Popover`, `Menu` and `Toolbar` flyout panels anchor to their trigger in an engine whose `position-anchor` initial value is `normal`**,
  because the rule now names `position-anchor: auto`. Since 0.5.15, unrecorded there.
- **A focused `focus-ring` element shows an indicator in forced-colors mode.** It draws a transparent 2px outline beside the inset ring, which is
  a box shadow and does not render there. Since 0.5.15, unrecorded there.
- **In forced-colors mode, forge's system-colour rules for `CheckboxGroup`, `RadioGroup`, `Switch`, `Toggle`, `ToggleGroup`, `Filter`, `Slider`
  and `Table.Row` win over those components' own `bg-*` and `outline-none` utilities**, because the rules sit in `@layer utilities`. Since
  0.5.15, unrecorded there.

---

## [0.5.16] — 2026-10-25

### Fixed

- **`forge release` signs its commit under `commit.gpgsign`, as `git commit` did.** In 0.5.15 it was built unsigned whatever the setting, and a signing
  failure now stops the release before `HEAD` moves.
- **`forge release` reports an index the post-commit sync left truncated.** A sync that read `.git/index` as missing used to report success with
  every other tracked file staged for deletion; it is now `index-stale`, naming `git reset -q`.

---

## [0.5.15] — 2026-10-25

### Breaking Changes

- **`zone.allow.paths` is required, and `forge cf sync zone` no longer falls back to the GET-only `pages`.** Pass `routePaths(routes)` across
  every method.
- **`browserStep` requires the Playwright server and never a local browser.** With `PW_TEST_CONNECT_WS_ENDPOINT` unset the step fails instead of
  probing for an installed engine. `browserStep`'s `hint` option, `hasChromium`, `hasBrowserEngine`, `resolveChromiumPath`, `egressProxy` and the
  `@y-core/forge/tooling/gate/chromium` subpath are removed.
- **`forge verify` runs one tier — `static`, `unit`, `runtime`, `deploy` or `release` — chosen with `--tier`; `--mode` and `--full` are
  removed.** A bare `verify` is now `runtime`: it adds the browser, workerd and database rows on their primary engine, narrowed to the pending
  changes, and fails rather than skips a row whose prerequisite is absent. Rename the scripts `verify:quality` to `verify:static` and `verify:full`
  to `verify:release`, and add `verify:unit` and `verify:deploy`. `GateMode` and `GATE_MODES` are `GateTier` and `GATE_TIERS`, `selectSteps`
  takes `tier`, a check's `run` receives one, and a receipt carries `tier` and the `base` commit a `runtime` run read its changes against. A table
  that states `tier: "quality"` or `"standard"` states `"static"` or `"unit"`; a `"full"` row moves to whichever tier `TESTING.md` §6c's lines
  put it in. `browserSteps({ engines })` emits `test:browser` for the primary engine at `runtime` and `test:browser:<engine>` for each other engine
  at `release`, and `cloudflareWorkerSteps({ browser: { engines } })` is built on it. At `runtime`, `browserStep` and `workerdStep` first run
  their narrowed command with `--list` and report the row untouched when it lists no spec, and `StepProbe` is exported for a step of your own.
  A step's new top-level `widen: (cwd) => paths`, taken by `browserStep`, `browserSteps` and `workerdStep`, names paths whose change runs a
  narrowed or untouched row whole, and a `widen` that rejects does too; build one from the new `importClosure` (exported by
  `@y-core/forge/tooling/assets`) and `workerMainClosure` (by `@y-core/forge/tooling/gate`). `cloudflareWorkerSteps` widens its browser and
  workerd rows by the import closure of the wrangler config's `main`, so a change to app source runs them whole and only a spec-only edit narrows,
  and `dbSteps` widens by its `forge` command's source entry. With `assetConfig` set, the browser rows also widen by everything the asset build
  reads, and the workerd row does too when the wrangler config has an `assets` block. Drop `watches` from a Playwright row. `dbSteps` replaces
  its `watches` option with `exercises` and `graph`, which watch the namespaces it runs through the namespace graph; without them it runs on every
  change. A `watches` or `narrow.wide` glob that matches no file fails the gate, naming the row and the glob.
- **`tailwind.css` imports Tailwind with `source(none)`, so a build scans only what an `@source` line names.** An app that relied on automatic
  detection loses the classes of every file no `@source` names. Add `@source` lines for your own source directories to your stylesheet, as the
  `ui` README's “Tell Tailwind which directories to scan” shows; under `cloudflareWorkerSteps` with `design` set, the new `validate-css-coverage`
  row names each uncovered file and the line to add. An app that imports `forge.css` under its own Tailwind import keeps
  `source(none)` there, since the row fails a stylesheet that leaves detection on.
- **An opt-in namespace's classes come from its own `sources.css`, not from a `node_modules` path in your stylesheet.** Replace each
  `@source "…/node_modules/@y-core/forge/src/<namespace>"` line with `@import "@y-core/forge/<namespace>/sources.css";`, for `auth`, `app`,
  `logging` and `render/htmx`. The new files' paths resolve under any install layout, a git dependency included.

### Added

- **`cssCoverageStep` checks an app's `@source` coverage**, as the `validate-css-coverage` row. It fails a stylesheet that leaves automatic
  detection on and each class-declaring source file no `@source` covers, and warns on a scanned directory that declares no class.
  `checkCssCoverage` and `CssCoverageCheckConfig` are exported beside it from `@y-core/forge/tooling/gate`.
- **`assetInputs(root, assetConfigPath, files)` in `@y-core/forge/tooling/assets` lists every repository file an asset build reads**, for a
  `widen` of your own. It rejects on an input that does not resolve.
- **Overlays open and close with motion.** A modal `Dialog`, `Popover`, `Menu`, `Tooltip` and the `Toolbar` flyout fade and scale (150ms in,
  100ms out), and a `Toast` fades in. Popups scale from the side of their anchor, and a context menu from the point that was clicked. Retime
  all of them with `--forge-motion-enter` / `--forge-motion-exit`. On a component whose custom motion leaves `scale` or `opacity` out of
  `transition-property`, set `--forge-motion-scale: 1` or `--forge-motion-opacity: 1`. A caller's `transition-none` still opens one
  instantly.
- **A timed `Toast` pauses while it is hovered, while it holds keyboard focus, or while its page is hidden**, and then runs only the time it
  had left. A toast that arrives on a hidden page waits for it to be shown.
- **A dismissed `Toast` or `Alert` fades out before it is removed.** It is marked `data-dismissing` and `inert` at once, and focus moves to a
  toast that is not fading, or to the region. `STATE_ATTRS` lists `data-dismissing`.
- **Moving from one `Tooltip` to the next opens it at once.** While another tip is open, or for 300ms after one closes, the next one skips its
  delay and fade and carries `data-instant`, which `STATE_ATTRS` now lists.
- **`@y-core/forge/tooling/db/host` carries `forgeSchema` and `DbHostConfig`** for a `config/db.ts` that node loads. **`testing/d1` re-exports
  `sql`**, so a node spec builds the fragment `explainPlan` takes without importing `storage/db`.
- **`crypto/keyring` exports `KeyRingSecretSchema`**, which validates a comma-joined ring of hex secrets from env and, like
  `parseKeyRingSecrets`, ignores surrounding whitespace. `CsrfConfigSchema.secret` is built on it.

### Changed

- **A non-modal `<Drawer open>` docks at its edge** (`position: fixed`, `z-40`, below toasts) instead of flowing in the page, and slides out from that edge
  on `close()`. It still has no backdrop and leaves the page usable.
- **Under `prefers-reduced-motion: reduce`, overlays fade instead of changing instantly.** Only the scale and the Drawer's slide are dropped.
  `forge-ui-reduced-motion` now allows replacing a scale or slide with an opacity fade, and `09-interaction.md` counts changes started
  together on one duration and one easing as one motion moment.

### Fixed

- **`mountTurnstile` under `challenge="submit"` replays a held press in Firefox when Turnstile answers inside `execute()`.** The replay now runs
  on a task of its own instead of inside the submission it replays, which Firefox sent nothing for.
- **Parameterised, wildcard and optional routes are allowed at the edge.** `buildAllowExpression` emits them as `strict wildcard` clauses
  instead of literal paths.
- **`mountNavDrawer` focuses the panel's first control once it becomes focusable after `toggle`.** It retries each frame for the length of
  the panel's transition.
- **`openTestD1()` with no options loads a `config/db.ts` written as the README shows, under node.** An existing `config/db.ts` must import
  `forgeSchema` and `DbHostConfig` from `@y-core/forge/tooling/db/host` instead of `@y-core/forge/tooling/db`.
- **`testing/d1` and `testing/harness` typecheck under `"types": []`** with only `/// <reference types="@y-core/forge/testing/node" />`.
- **The admin user search reads through the `email_key` index instead of scanning every user.**
- **`render/markdown` exports `DEFAULT_MARKDOWN_HANDLERS`**, so a handler override can fall back to the default one. It is frozen, and has no
  `table`, `linkReference`, `imageReference` or `footnoteReference` handler, because those need per-render state.
- **A wrong authenticator-app or recovery code no longer says to ask for a new code.** Only an emailed code is told to ask for another.
- **The `render/pdf` README gives Arimo's licence as SIL OFL 1.1**, not Apache-2.0.
- **A PDF `Table` takes JSX in its `header` and `rows` cells.** It used to fail typecheck and throw a `TypeError` at render.
- **`render/pdf` exports `WIN_ANSI_CHARACTERS`**, the characters WinAnsi encodes, for a font subset's `covering`.
- **A PDF form field placed outside the 12-column row, or given a span that isn't a whole number from 1 to 12, throws a `RangeError` naming
  its label**, instead of rendering clipped or at zero or negative width. A field with no `span` fills the rest of its row.
- **A zone's edge rule allows `/robots.txt` and the sitemap without listing them in `files`.**
- **`buildAllowExpression` refuses a route, file or prefix holding a character a browser would percent-encode**, such as `/café/:id`,
  with a `ZonePatternError`. The edge rule would never have matched it. Write the path percent-encoded instead.
- **The service-worker example in the `tooling/assets` README typechecks**, under the worker's own tsconfig the README now shows.
- **`validate-asset-root` knows about `sw.js`.** With a service worker, a missing `!/sw.js` under `run_worker_first` fails, and a present one
  no longer warns.

- **`forge release` no longer commits an empty tree when `.git/index` reads as missing.** The release commit is built against a private index, and
  a commit that changes a path it never staged, or none, is refused before tagging as the new `commit-mismatch` `ReleaseErrorKind`. An index
  left stale after a correct commit is reported as `index-stale`, and the tag is still cut. The commit no longer runs git hooks.

---

## [0.5.14] — 2026-10-20

### Added

- **`ServeWorkerOptions.dev` serves a harness Worker as `forge cf dev` builds it**, each `#relax/*` import resolved to its development module
  with `__FORGE_DEV__` defined, so a workerd spec driving a relaxation — Cloudflare's Turnstile testing secrets, say — can pass. Without it the
  harness stays strict. Harness starts in one process now run one at a time, because the build conditions are read from the shared process
  environment.

### Fixed

- **The app canon no longer describes the removed development model.** `APP_ARCHITECTURE.md` §1c is now _Development Relaxations Are Modules the
  Build Selects_, in place of the separate dev entry. `WORKERS_PLATFORM.md` §3b is now _An Absent Limiter Fails Closed_: a `503` everywhere but
  `forge cf dev`. `CODE_REVIEW.md` §6 replaces its dev-entry and rate-limit rows to match. `TESTING.md` §2d takes the log store as its optional
  binding, and `BOUNDARIES.md` §5b, in both the app and library canon, names the storage resolver as where `required: false` lives.

---

## [0.5.13] — 2026-10-20

### Breaking Changes

- **Forge owns the Turnstile wiring, so `turnstile: {}` is a complete configuration** on `defineAction`, `definePage`, `AuthWebOptions` and
  `defineApproval`. Each key is read only where it is used, the site key from `TURNSTILE_SITE_KEY` for a widget and the secret from
  `TURNSTILE_SECRET_KEY` for a check, and a missing or blank one throws `Invalid environment: <KEY>: missing`, so the request answers 500
  rather than rendering an unguarded form. The token is pinned to `c.url.hostname`, and `CF-Connecting-IP` is sent as `remoteip` when present.
  `ActionTurnstileOptions.secretKey` and `.verify`, and `AuthTurnstileOptions.keys` and `.verify`, are optional overrides, `verify` merged over
  the defaults; neither carries a relaxation, since Cloudflare's testing secrets are accepted only under `forge cf dev` (see the next entry).
  **Migration:** delete every hand-written `keys`, `secretKey` and `verify` callback that only reads `c.env.TURNSTILE_*`, `c.url.hostname` or
  `CF-Connecting-IP`, leaving `turnstile: {}` or only the constraints that differ. Delete any `dev` passed through `verify`. Name the bindings
  `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`, or keep a `keys`/`secretKey` override for other names. Render a consumer-built widget's site
  key from `readTurnstileKey(c, "siteKey")`.

- **`@y-core/forge/dev` is removed: a development relaxation is a module the build selects, so a deployed Worker holds none of them.**
  `devAllowance`, `DevAllowance` and `DevAllowanceOptions` are gone, with every option that took one — `AppOptions.dev`, `ErrorPageOptions.dev`,
  `RateLimitOptions.dev`, `DeriveAllowedOriginsOptions.dev` and `TurnstileVerifyOptions.dev` — and `CrossOriginProtectionOptions`, so
  `crossOriginProtection()` and `checkCrossOriginProtection(request)` take none. `Forge.setErrorDetail` is removed with no replacement. Each hook
  now imports its relaxation through forge's package `imports` map: the `forge-dev` condition resolves it to a `*.dev.ts` beside the hook, and
  every other resolution to a strict stub, and the `*.dev.ts` relaxes only in a build that defines `__FORGE_DEV__` as `true`. The new
  `forge cf dev` (`createDevCommand` in `@y-core/forge/tooling/cf`) runs `wrangler dev` with both set, in wrangler's process only; wrangler's own
  flags follow `--`. Under it, and under nothing else, an absent rate-limiter binding is skipped with a warning, `crossOriginProtection` accepts a
  request with no Fetch Metadata headers, `originProtection` and `originGuard` admit the origins the `FORGE_DEV_ORIGINS` binding lists, Turnstile
  accepts Cloudflare's published testing secrets, and the fallback 500 and `createErrorPage` disclose the thrown message, escaped. A plain
  `wrangler dev` relaxes none of them. In the gate, the new `validate-dev-bundle` row, on the `full` tier of `cloudflareWorkerSteps`, bundles
  `main` with esbuild and fails when a module from a dev-only directory or a `*.dev.ts` module reaches the output, or when the shell's
  `WRANGLER_BUILD_CONDITIONS` names `forge-dev`. It refuses a Worker config that sets `alias`, `build`, `define` or `rules`, or whose
  `compatibility_flags` carries `nodejs_compat` or `nodejs_compat_v2`, at the top level or in an `env.*` block, since it models none of them.
  `DevBoundaryCheckConfig.devEntries` is removed, `isDevEntry` is renamed `isDevModule(file)`, and rule B of `validate-dev-boundary` now fails
  only a production module importing a `*.dev.ts`, a type import included — a `*.dev.ts` may import another. **Migration:** delete
  `worker.dev.ts`, and any script or Worker config that names it, and delete every `devAllowance` call and `dev` option. In the `dev` script,
  replace `wrangler dev` with `forge cf dev`, keeping the asset build before it. Move `extraOrigins` into `.dev.vars` as `FORGE_DEV_ORIGINS`,
  comma-separated. Call `crossOriginProtection()` bare. Rename each dev-only file of your own to `*.dev.ts` and drop any `devEntries`; dev-only
  code the shared path calls goes behind your own `imports` alias, as `src/tooling/cf/README.md` shows. Run `forge verify --full` once to see
  the bundle row's verdict on your `main`.

- **The gate's import checks follow a `#` specifier through the root `package.json` `imports` map, so `PackagingCheckConfig.imports` is
  removed.** `validate-namespace-graph`, `validate-import-boundary` and `validate-ssr-boundary` judge every target an entry resolves to under any
  condition; rules B and C of `validate-dev-boundary` judge the target the deployed bundle resolves, and rule B also fails each `imports` entry
  whose deploy target is a `*.dev.ts`. The packaging check reads the map itself, and the `PackageImports` type is exported from
  `@y-core/forge/tooling/gate`. **Migration:** delete the `imports` field from every packaging check config.

### Added

- **`readTurnstileKey(c, key, override?)` in `@y-core/forge/app` reads a Turnstile key the way forge reads it.** It answers one key,
  `"siteKey"` or `"secretKey"`, from its own binding alone, or from `override` when one is given, and its error names only that key.

### Fixed

- **`INPUT_VALIDATION.md` §4a said an omitted `expectedHostname` only logs a warning.** `verifyTurnstile` refuses it as `hostname-mismatch`
  without calling siteverify, and the section now says so.

- **The apps canon's `CONFIG_BASELINE.md` names `forge cf dev` as the `dev` script's server.** It still named `wrangler dev`, which runs
  every relaxation strict. The consumer `CLAUDE.md` seed and the scripts table in `src/tooling/db/README.md` say the same now.

- **The changelog check refuses a released section deleted together with its digest.** It reads the `v*` tags in the repository and fails
  on a tagged version with no section, unless it is older than the oldest heading, so only the oldest releases may be trimmed. Without
  readable tags the rule does not run. `ChangelogCheckConfig.tagPrefix` names the prefix, defaulting to `v`.

---

## [0.5.12] — 2026-10-20

### Fixed

- **A resend refused by the Turnstile challenge shows "Verification failed. Please try again."**, the copy the other auth forms give the same
  refusal, rather than the submission copy that told the visitor to fix input they typed correctly. A resend whose body cannot be read keeps the
  submission copy.
- **Erratum for 0.5.11.** Its entry said the `expectedHostname` guard still runs under the testing-secret allowance, which reads as if the
  siteverify `hostname` were still compared. It is not: under the allowance `verifyTurnstile` skips the hostname, action and cdata comparisons,
  as 0.5.10 already did for the hostname. The `success` check and the fail-closed refusal of an empty `expectedHostname` still run. The 0.5.11
  entry also left out these changes:
  - auth forms refused by the Turnstile challenge show "Verification failed. Please try again." instead of the field's own copy, and the verify
    page shows its recovery-code copy only for a submission it could not read;
  - `defineApproval` refuses a wrong code with "Approval failed. Please try again." instead of "That is not a valid administrator code.";
  - a local `forge db` load whose commit is refused replays the file under a foreign-key watch and names the first statement that left a row
    with no parent.

---

## [0.5.11] — 2026-10-20

### Fixed

- **`verifyTurnstile` no longer compares `expectedAction` or `expectedCData` under the testing-secret dev allowance**, so auth's guarded
  forms pass under Cloudflare's testing keys. Siteverify answers those keys with no `action` or `cdata`; the `success` check and the
  `expectedHostname` guard still run.

---

## [0.5.10] — 2026-10-18

### Breaking Changes

- **`config/cf.ts` is no longer read, and `CfHostConfig`, `D1Placement`, `D1Jurisdiction` and `D1LocationHint` are removed** from
  `@y-core/forge/tooling/cf`. `forge cf sync` creates a D1 database with its name alone, and no longer holds its jurisdiction or read replication
  or provisions a `<name>-preview` database. **Migration:** delete `config/cf.ts`. Create a database that needs a jurisdiction or a location hint
  before the first sync, under the name `cf sync` expects (`wrangler d1 create MYAPP_DB --jurisdiction eu`), and `cf sync` adopts it. Turn read
  replication on in the Cloudflare dashboard, and create a preview database with `wrangler d1 create` and set `preview_database_id` yourself.

### Changed

- **`forge db` refusing a `preview` target with no real `preview_database_id` points at `wrangler d1 create`**, since `forge cf sync` no longer
  provisions one.

---

## [0.5.9] — 2026-10-18

### Breaking Changes

- **`CsrfRingResolver` and `AuthRingResolver` are removed** in favour of `KeyRingResolver` from `@y-core/forge/crypto/keyring`, which takes an
  `AppContext<Bindings>`, so a resolver reads `c.env` with no cast. **Migration:** rename the type, then drop any `(c as any).env` cast.

### Added

- **`createKeyRingResolver` and `KeyRingResolver`** in `@y-core/forge/crypto/keyring`. The resolver resolves a ring once per `env` object, so
  the subkeys and imported keys cached on it survive across requests. `defineApproval` now resolves its ring this way.
- **`FrontmatterRule.fileName`** in `@y-core/forge/warden/checks` narrows a `requiredFrontmatter` rule to documents of one file name, such as
  `README.md`.
- **`findSplitRuleMarkers`** in `@y-core/forge/tooling/gate` returns each `<!-- rule:… -->` marker that spans a line break or never closes.

### Fixed

- **A `requiredFrontmatter` rule holds every document it names**, not only numbered ones. A source README with its keys collapsed onto one line
  passed `validate-docs` while the index read a garbage title and no description; it now fails on the missing keys.
- **`validate-design` fails on a rule marker split across lines.** The marker reader works one line at a time, so a reflow that wrapped
  `<!-- rule:… -->` dropped the id from the defined set without a finding. `forge-ui-tell-heading-skip` had been dropped that way.

---

## [0.5.8] — 2026-10-18

### Breaking Changes

- **`forge db deploy` is removed, with `runDeploy`, `DeployOptions` and `DeployOutcome`**, from `@y-core/forge/tooling/db`. Its one check
  `migrate` lacked moves there: `forge db migrate` refuses a migration the entry's wrangler history table (`migrations_table`, else
  `d1_migrations`) records and forge never applied, on every target and under `--dry-run`, and `forge db migrate status --check` exits 1 on
  one, its `--json` report carrying `wranglerHistory`. **Migration:** set the Workers Builds deploy command to
  `forge db migrate --target remote --yes && wrangler deploy`; a `--check-only` step becomes
  `forge db migrate status --check --target remote` ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §9a).

---

## [0.5.7] — 2026-10-18

### Breaking Changes

- **`AuthWebOptions.bootstrapSecret` is removed**, in `@y-core/forge/auth/web`. The first-admin claim is now gated by an administrator approval:
  the `admin.elevate` group in `AUTH_ROUTE_GROUPS`, and `AUTH_VIEW_GUARDS.adminElevate`, end with the new `"require-approval"` guard.
  `createAdminElevateActions(...).submit` and `loadAdminElevate` answer 404 unless `requireApproval` admitted the request, which it records on
  `approvalCtx`, so a route of your own mounting them must run `requireApproval` ahead of them. **Migration:** define the approval with
  `defineApproval`, reading the code you held as the bootstrap secret, with the `rateLimit` you want on the prompt and the key ring your
  `csrfProtection` uses as `ring`, and pass it to `createAuthGuards` as `approval`. Mount its prompt with `registerApproval`. Without an
  approval, both elevate routes send an anonymous visitor to sign-in and answer a signed-in one with 404, as they did with no secret
  ([`AUTH_MOUNTING.md`](docs/AUTH_MOUNTING.md) §3).

- **`authAdminElevateSchema` is `{ confirm: "yes" }` alone, losing `secret`**, and `AdminElevateView` no longer renders a secret field.
  `AdminElevateViewProps.fieldError` is removed. A `views.adminElevate` override that rendered either must drop it.

- **The `forge db lint` rule `pragma-ignored` is renamed `pragma-unsupported`, with no alias.** It is now an error on any `PRAGMA` outside
  D1's supported set, which D1 refuses with `SQLITE_AUTH`, and an error too on `PRAGMA foreign_keys`, which D1 ignores because it always
  enforces foreign keys. `PRAGMA optimize` and the inspection pragmas are no longer flagged. **Migration:** rename any reference to `pragma-ignored`, and
  remove a refused pragma from a migration ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §5).

- **`D1Client` methods fail with a `D1Failure` and carry `meta` on both branches**, in `@y-core/forge/storage/db`: each now returns
  `D1Outcome<T>`, a `Result<T, D1Failure>` with `meta: { attempts }`. `D1Failure` extends `Error`, so `error.message` and `error.cause` still
  read as before, but an error is no longer the thrown D1 error itself — it is that error's `cause`. **Migration:** a test comparing a whole
  outcome with `toEqual` adds `meta`; code matching a D1 message string branches on `error.kind` instead.

- **The default database layout moves under `config/db/`**, in `@y-core/forge/tooling/db`: migrations default to `config/db/migrations` and the
  snapshot to `config/db/schema.snapshot.json`. Every `forge db` verb now refuses a `d1_databases` entry whose `migrations_dir`, resolved from
  the wrangler config's directory, is not that directory, or whose `migrations_pattern` is not that directory's `*.sql`, naming the key to set.
  `forge db standby reset` fails when it finds no seed, unless `--no-seed` is given. **Migration:** either move
  `migrations/` to `config/db/migrations/` and `schema.snapshot.json` to `config/db/`, or set `migrations` and `snapshot` in `config/db.ts` to
  where they are now. Then set `"migrations_dir"` on each `d1_databases` entry to the same directory. Replace a `node_modules/@y-core/forge/…`
  path in `schemas` with `forgeSchema("auth")` and run `forge db migrate compose` once, so the snapshot records the new key
  ([`src/tooling/db/README.md`](src/tooling/db/README.md) section "Declaring what forge reads").

- **`dbSchemaStep` is renamed `dbSteps` and adds `db:lint`**, which runs `forge db lint` against the local database in `full`, behind the
  installed workerd runtime, in `@y-core/forge/tooling/gate`. `cloudflareWorkerSteps({ db: true })` emits all three rows. **Migration:** rename the import
  ([`src/tooling/gate/README.md`](src/tooling/gate/README.md)).

- **`VerifyViewProps.reissueAfterMs` is replaced by `resendWaitMs`**, the time left in the reissue window, and the `resent` redirect now carries
  when the code was asked for (`?resent=<ms>`). A `views.verify` override that read `reissueAfterMs` reads `resendWaitMs` instead, which is
  absent once the window has passed.

- **Backup artifacts are `formatVersion` 8**: the manifest gains `via` (`read` or `export`) and `bookmark`. **Migration:** take each backup
  again; `forge db restore` refuses a version-7 artifact by name.

- **`forge db migrate compose --rename` now needs `--allow-destructive <digest>`**, as a drop does. **Migration:** run the compose, read the
  plan it prints, and pass the digest it names.

- **`forge db lint` judges a target**: it reads the migrations the target (`--target`, `local` by default) does not hold yet, and takes no file
  arguments and no `--strict`. The `drop-column`, `rename`, `table-rebuild` and `unique-index-on-existing-table` rules are removed, and every rule
  is an error. **Migration:** drop file arguments and `--strict` from scripts; a drop or rename is approved by compose
  ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §9b).

- **Every migration must carry a valid compose stamp**, in `@y-core/forge/tooling/db`. `forge db migrate compose --custom`,
  `ComposeOptions.custom`, `MigrationOrigin`, `Migration.origin` and the `custom-ddl` lint rule are removed. `forge db lint`,
  `forge db migrate`, `forge db standby reset` and `forge db deploy` refuse a pending migration with no `forge:compose` stamp, or one edited
  since compose wrote it, before anything is applied. **Migration:** change `schema.sql` and compose. A data step is a seed
  ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §7a).

- **`drop-no-if-exists` no longer runs over a seed**, in `@y-core/forge/tooling/db`; the schema check refuses any drop a seed makes
  ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §7a).

- **No `forge db` flag passes a migration or seed refusal**, in `@y-core/forge/tooling/db`. `--no-lint` (migrate, standby reset),
  `--allow-warnings` (migrate, deploy, seed), `--allow-drift` (migrate, seed) and `--allow-pending` (seed) are removed, and so are
  `MigrateOptions.lint`, `allowWarnings` and `allowDrift`, `DeployOptions.allowWarnings`, `StandbyResetOptions.lint` and the matching
  `runSeedApply` options. Every seed rule is an error on every place, `LintLevel` and `LintFinding.level` are removed, a printed finding loses
  its level prefix, and `forge db lint --json` drops `errors` and `warnings`. A moved fingerprint is refused until the database is restored; a
  fingerprint never certified is still certified by a `forge db migrate` with nothing pending. **Migration:** drop the flags and fields; write a
  seed's `INSERT` as `OR IGNORE` or `ON CONFLICT`; restore a drifted database ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §9b).

- **`DbIo` gains `splitD1`**, the statements a local home's own handle cuts SQL into. **Migration:** a `DbIo` written by hand implements it.

### Added

- **`forge db seed apply` refuses a seed that changes the schema**, judged by running it on a scratch copy of the target's schema one statement
  at a time. A row-constraint failure there is passed over, and any other error refuses the seed, naming the statement. `standby reset`'s seeds
  are held to it too ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §7a).

- **`forge db lint`, `migrate`, `deploy` and `standby reset` refuse a drop or rename its file does not approve**, judged on a scratch copy of the
  target's schema, on every target ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §9b).

- **Compose writes one approval line per drop and rename**, in `@y-core/forge/tooling/db`: `forge db migrate compose --allow-destructive
  <digest>` is asked for whenever the plan drops a table, a column or a view, or renames one, and writes `-- forge:drops` and `-- forge:renames`
  lines under the header, inside the stamp. The analysis pairs each line with what the file does, one to one
  ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §9b).

- **`forge db backup --via export`** has `wrangler d1 export` write the rows of a database too large to read, keeping the artifact layout `forge db
  restore` reads. It records a deployed database's Time Travel bookmark, and refuses a virtual table and each value the export would not reproduce:
  a `\n` or `\r` escape beside its real control character, an integer past ±2^53, and an integral REAL outside REAL affinity. It reads the export
  back a page at a time, checks each table's count taken just before the export, and refuses a schema change between its two exports even under
  `--no-verify`; it never compares the rows' contents with the source, and pays off only for a remote one
  ([`DATABASE_BACKUPS.md`](docs/DATABASE_BACKUPS.md) §5b).

- **`forge db deploy` applies pending migrations, then runs `wrangler deploy`**, as the Workers Builds deploy command. It refuses a deployed
  database with a migration no longer on disk, an edited one, a moved fingerprint or a row forge never applied in wrangler's history table, the entry's `migrations_table` or `d1_migrations`. A token
  Cloudflare refuses names `Account → D1 → Edit`, in `forge db migrate` too, and says whether anything had been applied by then.
  `--check-only` stops after the checks. A failed deploy after an apply prints the bookmark's restore command. With migrations pending it asks
  first, as `forge db migrate --target remote` does; a Workers Builds deploy passes `--yes`. `forge cf sync --commit` notes
  that D1 write access is unverified unless it created a database ([`DATABASE_MANAGEMENT.md`](docs/DATABASE_MANAGEMENT.md) §9a).

- **`forge cf sync` holds each `env.<name>` block's D1 entries to the account**: it reports an environment with no `d1_databases` or missing a
  top-level binding, writes back a `database_id` its `database_name` resolves and a stale `preview_database_id` a `<name>-preview` database
  replaces, and reports an id that resolves to nothing. A handler may now carry `reconcileConfig`, a `ConfigPass` over the whole config
  ([`src/tooling/cf/README.md`](src/tooling/cf/README.md) section "Placing a D1 database").

- **`forge cf sync` places D1 databases**, from a new `config/cf.ts` (`CfHostConfig`, in `@y-core/forge/tooling/cf`). A database is created with
  its declared jurisdiction and location hint; a jurisdiction mismatch is `refused`, a replication mismatch is `drift` and set on `--commit`, and
  `preview: true` provisions `<name>-preview` and writes back `preview_database_id`
  ([`src/tooling/cf/README.md`](src/tooling/cf/README.md) section "Placing a D1 database").

- **`forgeSchema`, `standbyHome` and `standbyStatePath` in `@y-core/forge/tooling/db`.** `forgeSchema("auth")` names forge's schema in
  `DbHostConfig.schemas` by its package specifier. `standbyStatePath(config)` is the directory a standby database persists under, for a script
  that reaches it with wrangler.

- **`d1Sessions` in `@y-core/forge/storage/db` reads your own writes from a D1 replica**: one session per request, `first-primary` for a write
  and, under a `bookmark` carrier, the incoming bookmark or `first-unconstrained` for a read, with the bookmark returned in that header or cookie;
  without a carrier every session starts `first-primary`. It queues the bookmark for
  Forge to merge, so a WebSocket `101` keeps its socket, and sets the cookie only when the bookmark moves, since a cookie makes a `public`
  response `private`. `resolveD1Client` and `defineD1Binding`'s client query through the request's session. `createD1Client` now takes a `D1Queryable` — a binding or a session — and
  `fakeD1` gains `withSession` and records each constraint on `sessions` ([`STORAGE_BINDINGS.md`](docs/STORAGE_BINDINGS.md) §1g).

- **The opt-in lint rule `forge/sql-delete-authorised`** reports a `sql` `DELETE` with no `// row-removal-authorised-by:` comment on the line
  before it ([`src/tooling/lint/README.md`](src/tooling/lint/README.md) section "Scoping a rule to part of the tree").

- **`explainPlan`, `usesIndex` and `scansTable` in `@y-core/forge/testing/d1`** assert a query's plan on the test database, so a query that
  loses its index fails a test ([`src/testing/README.md`](src/testing/README.md) section "Asserting that a query uses its index").

- **`D1Client` reports cost and placement, and logs one `d1.query` record per call**, in `@y-core/forge/storage/db`: `meta.cost`
  (`rowsRead`, `rowsWritten`, `durationMs`) and `meta.servedBy` (`region`, `primary`) where D1 reports them, and a record carrying the SQL text,
  cost and placement but never a bound value, at `warn` past the new `slowQueryMs` option. A batch logs `d1.query` with `op: "batch"` rather than
  `d1.batch` ([`STORAGE_BINDINGS.md`](docs/STORAGE_BINDINGS.md) §1a).

- **`D1Client` refuses a statement over D1's limits before sending it**, in `@y-core/forge/storage/db`: more than 100 bound parameters or
  100,000 bytes of UTF-8 fails with a `limit` `D1Failure` and `meta.attempts` 0, naming the `json_each` idiom, which binds a list as one
  parameter. `D1_LIMITS` holds the limits, and `forge db lint` gains `table-too-wide` for a table of more than 100 columns
  ([`STORAGE_BINDINGS.md`](docs/STORAGE_BINDINGS.md) §1h).

- **`defineD1Binding` in `@y-core/forge/storage/db` wires a D1 binding in one declaration**: its `spec` for the boot binding check, the
  schema-health monitor as `globals`, the `<name>` and `<name>:schema` checks as `health`, and a `client(c)`. `schemaHealthCheck` and
  `schemaHealthMonitor` take `recheckMs` (60 s by default) and read the schema again after it, so drift that starts mid-isolate is seen, and its
  monitor and schema check share one schema read per `recheckMs` window
  ([`src/storage/README.md`](src/storage/README.md) section "Mounting a D1 database").

- **`@y-core/forge/testing/d1`: `openTestD1` runs a test against wrangler's local D1 with every migration applied**, in wrangler's number order,
  from the directory `config/db.ts` names, loaded and refused as `forge db` loads it; `hostConfig` names another module. A handle has its own
  database; `reset()` empties it and re-applies the migrations without restarting. Node-only, off the `testing` barrel
  ([`src/testing/README.md`](src/testing/README.md) section "Running queries against real D1 in tests").

- **Typed D1 failures and retry, in `@y-core/forge/storage/db`.** `classifyD1Error` and `D1Failure` sort a D1 error into `constraint`,
  `transient`, `overloaded`, `limit`, `timeout`, `guard` or `unavailable`. `execute` and `batch` take `{ idempotent: true }`, which retries a
  `transient` failure with jittered backoff and never any other kind ([`STORAGE_BINDINGS.md`](docs/STORAGE_BINDINGS.md) §1g).

- **`forge db compose` ends a migration that creates or changes an index with `PRAGMA optimize;`**, so the planner's statistics follow the new
  index ([`SCHEMA_COMPOSITION.md`](docs/SCHEMA_COMPOSITION.md) §4).

- **Administrator approval in `@y-core/forge/auth/web`: `defineApproval`, `requireApproval` and `registerApproval`.** `requireApproval` holds
  any route until the session has presented a configured code inside the approval's window, and sends it to the prompt `registerApproval`
  mounts. With the code unset, every approved route and the prompt answer 404. The prompt is `ApprovalView` over `approvalSchema`, with types
  `Approval`, `ApprovalOptions` and `ApprovalViewProps`. The window defaults to `APPROVAL_TTL_MS`, exported from `@y-core/forge/auth`.
  `defineApproval` requires `origin`, `rateLimit` and `ring`, and throws without any of them; forge picks no numbers. The session holds a keyed
  digest of the code under `ring`, never the code, so changing the code ends every approval made under the old one. Signing in or out clears
  the approval ([`src/auth/README.md`](src/auth/README.md) section "Requiring administrator approval on a route").

- **A Turnstile challenge on the anonymous auth forms, in `@y-core/forge/auth/web`: `AuthWebOptions.turnstile`.** It covers sign-in, sign-up,
  and the verify page's code and resend forms (`AuthTurnstileFlow`), narrowed by `flows`, with forge naming each form's action in
  `AUTH_TURNSTILE_ACTIONS`. A refused challenge answers `422` with the form re-rendered, the resend form included; only a resend's
  account-dependent outcomes share the `resent` redirect. An unreadable resend body is logged at `warn` as `auth.resend.unreadable`
  ([`AUTH_MOUNTING.md`](docs/AUTH_MOUNTING.md) §8).

### Fixed

- **`forge db restore` and `forge db reset` check a table without holding all its rows in memory.**

- **`forge db backup` refuses a schema change made while it reads the rows, even under `--no-verify`.**

- **The verify page's resend button re-enables once the reissue window has passed.** It was disabled for as long as `?resent` stayed in the
  URL, reloads included; the server now works out the remaining wait from when the resend was asked for, and "You can ask again in" names it.

- **The auth README and `src/auth/schema.sql` no longer call the schema's foreign keys documentation.** D1 always enforces them, so each
  `ON DELETE CASCADE` fires; a workerd test now holds that with no pragma set.

- **`schemaHealthCheck` keeps a newer schema check when an older one settles after it.** A check that finished on a mismatch or an error
  cleared the cache whether or not a later check had replaced it, so the next poll read the schema a third time.

---

## [0.5.6] — 2026-10-16

### Added

- **`@y-core/forge/testing/form`, a node-loadable bundle of what a workerd spec submits a form with.** It carries `mintTestCsrfToken`,
  `CSRF_FIELD_DEFAULT`, `CSRF_HEADER_DEFAULT` and `FORM_MAX_BYTES_DEFAULT`; `mintTestCsrfToken` stays on the `./testing` barrel too.
- **`forge.node` in `package.json` declares every subpath a Node process imports, and the gate holds the export map to it.** The new
  `validate-node-exports` row (`nodeExportsStep`, `checkNodeExports`) fails a listed subpath whose `import` is not a generated `.mjs`, naming it and
  `bun run gen:bundles`, and an `.mjs` export the list leaves out. `nodeBundles` derives each bundle row and its watched files from the list, so
  adding a Node-reached export needs no edit to `config/bundles.ts` ([`BUILD_TOOLING.md`](docs/BUILD_TOOLING.md) §2n).

### Fixed

- **A consumer's workerd spec could load nothing from forge but `serveWorker`.** Every other surface it needed was TypeScript source, which node
  refuses under `node_modules` with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, so the spec never ran. Forge's workerd suite now installs the
  tarball `bun pm pack` makes and loads every `forge.node` subpath under node, so a surface left unbundled fails in forge. **Migration:** import the CSRF
  helpers and the form defaults in a workerd spec from `@y-core/forge/testing/form`, and keep any helper a spec imports free of
  `@y-core/forge/testing`.

### Changed

- **The consumer pin form has one home, `FORGE_CONSUMPTION.md` §4c:** the released tarball by URL. Forge's
  other mentions cite it, and the ones that described a `codeload` tarball are corrected.
- **The bundle drift rows are renamed to `validate-<subpath>-bundle`**, derived from the subpath: `validate-lint-plugin` is
  `validate-tooling-lint-plugin-bundle`, and `validate-chromium-bundle`, `validate-totp-bundle`, `validate-harness-bundle` and
  `validate-wrangler-bundle` gain their full subpath. A `verify --only` naming an old label must use the new one.
- **`./tooling/lint/plugin` and `./tooling/gate/chromium` gain a `types` condition**, the `.ts` entry each bundle is built from; the `import`
  target is unchanged.

---

## [0.5.5] — 2026-10-16

### Added

- **`--elevation`, a ninth shape token.** Every length in `--shadow-2xs` through `--shadow-2xl` is multiplied by it, so a shape file's
  `:root { --elevation: 0; }` flattens every recipe without restating the seven shadows in `@theme inline`. It defaults to `1`, which renders
  exactly as before; the focus ring is an `inset-ring` and is unaffected. An application's own shape file must now declare it too.

### Fixed

- **`Accordion`, `Collapsible`, `CheckboxGroup` and the `Toast` and `Alert` close buttons ignored the shape radius.** They carried bare
  `rounded`, a literal `0.25rem`, so a square shape kept a 4px corner on them. A unit test now refuses any radius utility in a `ui` source
  that does not compile to a shape token.

### Changed

- **Those five corners are now `rounded-sm`, `calc(var(--radius) - 4px)`** — 6px at the default `--radius` rather than 4px.

---

## [0.5.4] — 2026-10-15

### Changed

- **`serveWorker` always serves plain http.** A config's `dev.local_protocol: "https"` made the origin https on a self-signed certificate
  that `fetch` refuses; it is now ignored, so drop any `ignoreHTTPSErrors` a harness test carried for it.
- **`serveWorker` writes a copy of the config beside it, `.wrangler-harness-<uuid>.json`, and `harness.close()` deletes it.** A run killed
  before `close()` leaves one behind: add `.wrangler-harness-*.json` to `.gitignore`.

### Fixed

- **`serveWorker` with `entry` now starts under a config that declares `secrets.required`.** wrangler refused it with `assigned to
  Environment Variable and Secret bindings`, because the inline config kept the declaration while every secret, and `SITE_ORIGIN`, arrived
  as a var.
- **`vars`, `secrets` and `SITE_ORIGIN` now bind over `.dev.vars` under `entry`.** The app's `.dev.vars` was read for the inline config and
  replaced each value of the same name, so a test ran on the developer's local secrets and the served origin was not the Worker's
  `SITE_ORIGIN`.

---

## [0.5.3] — 2026-10-15

### Fixed

- **`@y-core/forge/testing/harness` now loads from a consumer's Playwright `workerd` project.** Node refused to strip types under
  `node_modules`, so the import died with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. The subpath is now a committed bundle,
  `src/testing/harness.mjs`, held to its source by the new `validate-harness-bundle` row.

---

## [0.5.2] — 2026-10-15

### Breaking Changes

- **`AuthNotifier.send` takes a second argument, `signal: AbortSignal`**, in `@y-core/forge/auth`. Forge aborts it once the delivery deadline
  passes; pass it to your mailer's request. A `send` that keeps one parameter still type-checks, but is never told to stop.

- **`PasskeyRealm` requires `requestTimeoutMs`, and `runPasskeyCeremony` takes a fourth argument, `signal?: AbortSignal`**, in
  `@y-core/forge/auth/client`; both are `@internal`. Aborting the signal rejects the ceremony with its reason, and nothing navigates after it.

- **`validateNoMutualValuePairs` is now `validateNoValueCycles`** in `@y-core/forge/tooling/gate`, and fails a cycle of `value` edges of any
  length rather than only a pair. Each finding's `file` reads `edges a → b → a`, starting from the alphabetically first namespace.

- **`@y-core/forge/testing/workerd` is removed, with `startDevServer`, `DevServer` and `DevServerOptions`.** Start a Worker under test with
  `serveWorker` from `@y-core/forge/testing/harness` and run that suite under node; under bun the harness answers no request. `@y-core/forge/testing/node` now
  declares only what `@y-core/forge/testing/snapshot` reaches.

- **`workerdStep` runs `playwright test --project=workerd`** in `@y-core/forge/tooling/gate`, and its `parallel` option is gone. Declare a
  `workerd` project in your `playwright.config.ts`; `sources`, when given, narrow it. `browserStep` now runs `--project=chromium`.

- **The optional `wrangler` peer floor rises from `>=4.0.0` to `>=4.99.0`**, the first release with `createTestHarness`.

### Added

- **`healthCheck(checks, { timeoutMs })` bounds each check** in `@y-core/forge/app`, typed `HealthCheckOptions`. A check still pending after
  `timeoutMs` — 5 s by default — counts as `false`.

- **The signup, signin and email-change flows take a `logger` option** in `@y-core/forge/auth`. Deferred work that throws is logged there as
  `error`, or to the console when it is left out.

- **A scope's `setup` receives a `signal`** in `@y-core/forge/ui/client`, aborted when the scope is disposed. Hand it to `fetch` and to
  `addEventListener` instead of tracking a disposed flag.

- **`captureStreams(cmd, args, opts)` runs a tool with stdout and stderr captured apart** in `@y-core/forge/tooling/cli`, returning a
  `StreamCapture` of `{ code, exited, stdout, stderr }`. `exited` is false on a spawn error or a kill by signal, so a caller can tell a real
  exit 1 from a child that never answered.

- **`run`, `capture` and `captureStreams` take a `timeoutMs` option** in `@y-core/forge/tooling/cli`. A child still running at the deadline is
  killed with `SIGKILL` and reported as a non-zero exit; without the option no deadline applies.

- **`runUnchecked(cmd, args, opts)` runs a tool with inherited stdio and returns how it exited instead of throwing** in
  `@y-core/forge/tooling/cli`, as a `RunOutcome` of `{ code, exited, spawnError? }`. The barrel also exports the `SpawnSync`, `SpawnOptions`
  and `SpawnOutcome` types every spawning helper takes as its seam.

- **`serveWorker(options)` starts a Worker under wrangler's `createTestHarness`** in the new node-only subpath `@y-core/forge/testing/harness`,
  and resolves to `{ harness, origin }` once it answers. `entry` serves a test-only module in place of the config's `main` under the same
  bindings, and the Worker reads `origin` as `SITE_ORIGIN`. It replaces `startDevServer`'s `entry` and `siteOrigin`.

### Changed

- **`engines.bun` stays `>=1.4.0`, and its reason is now the Bun the release gate runs on**, which is `packageManager`'s version. It no longer
  rests on `bun test --parallel`, which `workerdStep` stopped running. The two versions now move together (`BUILD_TOOLING.md` §2m).

### Fixed

- **The apps canon's `TESTING.md` names `createTestHarness` as what takes a per-run server's port.** It still credited a library dev-server
  helper, which forge no longer ships.

- **A gate run no longer leaves its steps' temp files behind.** `createGateCommand` in `@y-core/forge/tooling/gate` runs each spawned step and
  fixer with `TMPDIR` set to a directory of its own and removes it when the step exits. A failed step's full log is still kept.

- **Deferred auth work that throws no longer rejects the promise handed to `defer`.** A store or notifier failure inside a signup, signin or
  email-change deferral is logged and settles as unavailable, and a rejecting `send` in the email-OTP factor gives the cooldown back.

- **A health check that never settles no longer hangs the endpoint**; it answers `503` with that check `false`.

- **`verifyTurnstile` returns `"timeout"` when the siteverify body stalls**, not only when the request does. The deadline now covers reading the
  response.

- **`rateLimit` answers `503` when the rate-limit binding throws**, and logs the failure as `error`, rather than failing the request with an
  unhandled error.

- **A KV log purge deletes every batch when one delete fails**, and the write then rejects naming the keys it could not delete, so the failure
  reaches `onChannelError`. A purge whose listing fails rejects the write too, where it was silently dropped.

- **A passkey request that never answers no longer leaves the button busy.** Each of the ceremony's two requests gives up after 15 s and reports
  the ceremony as failed, and disposing `mountPasskey` mid-ceremony reports nothing and does not navigate.

- **`mountTurnstile`'s disposer removes the script's `load` and `error` listeners**, which stayed attached to the injected script for the life of
  the page.

- **A failed key-ring or stand-in token resolution is retried** on the next request rather than cached, and concurrent cold requests share one
  resolution.

- **A Cloudflare API request that never answers no longer hangs the command.** Each request the `tooling/cf` client makes gives up after 30 s
  and reports a network error, `timed out after 30000ms`.

- **A remote asset download that stalls no longer hangs the build.** `fetchURL` gives the whole download, every redirect and the body included,
  120 s by default, settable with `timeoutMs`, and then fails naming the URL.

- **Waiting for the dev-server startup lock no longer spins or waits forever.** A waiter whose lock file vanished between two reads now sleeps
  before retrying, and a waiter still blocked by a live holder gives up, naming the holder's pid, once the wait outlasts twice the lock's
  staleness window.

---

## [0.5.1] — 2026-10-14

### Added

- **`PdfArchival` admits the PDF/A-3 levels `a-3b`, `a-3u` and `a-3a`** in `@y-core/forge/render/pdf`, for an archive that asks for part 3. A
  part 3 render declares `pdfaid:part` 3, is refused and audited on the same rules as its part 2 level, and is valid with no file attached.

- **`attachments` embeds files in a PDF as associated files** in `@y-core/forge/render/pdf`, each a `PdfAttachment` with a name, a MIME type, its
  bytes, a `PdfAttachmentRelationship` and a modification date. An archival render admits them only at a part 3 level. A render at any level
  refuses a missing name, MIME type or date, or a name used twice, on the new `attachment` error kind; `auditPdf` reports the same faults under
  `attachment`. The `/ID` covers the attached files.

- **`@y-core/forge/render/pdf/attachments` reads the files a PDF embeds** with `readPdfAttachments(bytes, limits)`, returning each as a
  `PdfAttachment`. It runs on Web APIs alone, caps the input size, the object count, each stream's inflated size and the total it decodes,
  stored streams included, under `PdfAttachmentLimits` — 6 MiB for each byte limit and 100,000 objects by default, sized for a Worker's
  isolate — and returns every refusal as a failed `Result`. Entries naming one embedded stream share its bytes. It reads a PDF's attachments
  only, never the rest of the file.

---

## [0.5.0] — 2026-10-08

### Added

- **`parseWranglerConfig` loads under node from `@y-core/forge/tooling/cf/wrangler`**, so a `playwright.config.ts` can read `wrangler.jsonc`
  without running under bun. The subpath is a committed bundle that exports `parseWranglerConfig` alone.

- **`_headers` carries the request-independent security headers on every rule**, so an app can serve its hashed assets and icons without running
  the Worker. `defineAssetsConfig({ securityHeaders })` takes the options the app passes `createSecurityHeaders`, and each rule gains HSTS,
  `nosniff`, `Cross-Origin-Resource-Policy` and a fixed `default-src 'none'; frame-ancestors 'none'; sandbox` CSP. `assetSecurityHeaders` in
  `@y-core/forge/security` returns the same set.

- **`cloudflareWorkerSteps()` emits both import-boundary rows an app used to append by hand.** `ssrBoundary.serverDirs` adds
  `validate-client-boundary`, which fails a module under `clientDirs` importing one of those directories at value. `vendorDir` adds
  `validate-vendor-boundary`, which fails a module in that tree importing a directory or source file beside it under its parent.

- **`derivePseudonym` in `@y-core/forge/crypto/keyring` derives a keyed, non-reversible id under the app's own ring**, so an app stops hand-rolling
  HMAC and hex over WebCrypto. It answers 64 lowercase hex characters, the same for the same ring, purpose and value:
  `await derivePseudonym(ring, { purpose: "notes-store", value: userId })` replaces an `importKey` / `sign` / hex pair. Rotating the ring changes
  every pseudonym; pin `{ ...ring, activeKeyId: oldKeyId }` to keep reading an old one. The result differs from a hand-rolled HMAC of the same id,
  so anything named by the old value is orphaned.

- **`WranglerConfig` types the `assets` block** as `WranglerAssetsConfig`, exported from `@y-core/forge/tooling/cf`.

### Fixed

- **`signoutClearsSiteData` no longer stalls the sign-out navigation about five seconds in Chromium**, which holds any response carrying
  `Clear-Site-Data: "storage"`. The sign-out now sends `"cache"`, and the next auth page posts to the new `auth.signoutSiteData` route for
  `"storage"`, once and without anything waiting on it.

- **A well-formed authenticator-app code that enrolment refuses now reads "That code did not match"**, rather than the message for a malformed
  code, which sent the user to re-check digits that were already the right shape.

- **Removing a user that an app table still references is refused with a message, not a 503.** When a foreign key to `auth_users(id)` refuses
  the delete, `AdminUserStore.remove` answers `referenced`, deletes nothing, and the admin page answers 409 asking for the account's records to
  be removed or transferred first.

- **A failed key derivation or import under a `KeyRing` is retried on the next request instead of failing every one until the isolate
  restarts.** CSRF tokens, R2 signed URLs, signed cookies, `derivePseudonym` and `sealAtRest` all resolve their keys this way.

### Breaking Changes

- **`@y-core/forge/keyring` moves to `@y-core/forge/crypto/keyring`.** Its exports are unchanged; replace `from "@y-core/forge/keyring"` with
  `from "@y-core/forge/crypto/keyring"`. The old subpath is removed with no alias. `crypto` is now a container with no import path of its own,
  like `storage` and `render`.

- **`keyRingSecrets` is renamed `parseKeyRingSecrets`.** It behaves as before; replace each call, and its errors now name `parseKeyRingSecrets`.

- **`AUTH_KEY_ID_LENGTH` is removed from `@y-core/forge/auth`.** A key id is still eight base64url characters, and `importAuthKeyRing` and
  `importKeyRing` derive every one, so an app has no length to check.

- **An icon prefix inside the asset prefix is now refused at build.** `loadConfig` and `buildAll` throw when any icon would be served under
  `paths.publicPrefix`, because each such icon matched both `_headers` rules and Cloudflare comma-joined every security header, voiding its
  `Cross-Origin-Resource-Policy`. Move the icons to a prefix of their own, such as `/static`. A `paths.publicPrefix` of `"/"` covers every path,
  so it is refused beside any icon, a `root: true` one included.

- **`createSignoutActions` returns `signoutSiteData` beside `signout`, and `authRoutes` declares `signoutSiteData: post("/signout/site-data")`.** An
  app that maps the auth routes itself maps the new action too; one using `registerAuth` gets it. **With `signoutClearsSiteData`, the
  `"storage"` half of the clear now needs the auth pages to import `@y-core/forge/auth/client` before `resume()` and to run JavaScript**, because
  that module sends the second request. An app that does not load it, such as one offering email codes and no passkeys, gets no error: sign-out
  still sends `"cache"`, but IndexedDB, `localStorage`, Cache Storage and the service workers survive it. Add the import to the auth pages' bundle.

- **`AuthStoreErrorCode` gains `"reference"` and `AdminUserOutcome` gains `"referenced"`.** A store error from a foreign-key refusal, including an
  insert naming an owner that does not exist, now carries `reference` where it carried `unavailable`. An exhaustive switch over either union
  needs the new case; a custom `AdminUserStore.remove` answers `referenced` when a foreign key refuses the user row.

- **CSRF tokens and R2 signed URLs sign under a `KeyRing` from `@y-core/forge/crypto/keyring`.** `importCsrfKey`, `importCsrfKeyRing`,
  `importSignedUrlKeyRing` and the type `HmacKeyRing` are removed, as is `CsrfTokenOptions.kid`: the token carries the ring's active key id. The
  CSRF resolver option is `ring` on `csrfProtection`, `csrfMinter` and `authNav`, typed `CsrfRingResolver` in place of `CsrfSecretResolver`;
  `createCsrfToken`, `verifyCsrfToken`, `createSignedObjectUrl` and `verifySignedObjectUrl` take the ring instead of a `CryptoKey`. Replace
  `secret: () => importCsrfKey(env.CSRF_SECRET)` with `ring: () => importKeyRing(parseKeyRingSecrets(env.CSRF_SECRET))`, importing both from
  `@y-core/forge/crypto/keyring`. **The existing `CSRF_SECRET` value is accepted unchanged**, and `CsrfConfigSchema` also accepts a
  comma-separated list, newest first, to rotate. **Every CSRF token and signed URL issued before the deploy stops verifying**: a form rendered
  before it is refused once on submit, for at most the token's one-hour life. Tests keep `mintTestCsrfToken(hexSecret, …)` as it is.

- **Signed cookies sign under a `KeyRing`: `createSignedCookie`, `createAnonymousSession` and `createFlash` take `ring` in place of their
  secrets.** Replace `secrets: [env.SESSION_SECRET]` with `ring: await importKeyRing(parseKeyRingSecrets(env.SESSION_SECRET))`, and the anonymous
  session's `secret: (c) => …` with `ring: (c) => importKeyRing(parseKeyRingSecrets(c.env.SESSION_SECRET))`; the flash cookie's `secrets` becomes
  `ring` the same way, and the session's ring serves it. **`SESSION_SECRET` and `FLASH_SECRET` must now be hex of at least 64 characters**,
  comma-joined newest first to rotate. A value already in that form works unchanged; a shorter or non-hex one throws at import. Every app's
  `.dev.vars.example` already documents that format, but an env schema validating `minLength(32)` lets a value through that now throws, so raise
  it to the hex rule. **Every existing
  session, anonymous-session and flash cookie is invalid after the deploy**: each signed-in user signs in once more. The cookie value is
  `<payload>.<kid>.<sig>`, so a test that signs a cookie by hand passes a ring to `createSignedCookie` rather than building the value. Mark
  `SESSION_SECRET` and `CSRF_SECRET` `# forge:ring` in `.dev.vars`, not `# forge:generate`, so `forge cf sync --local --rotate` prepends a key
  rather than replacing the ring.

- **The type `AuthKeyRing` is removed; use `KeyRing` from `@y-core/forge/crypto/keyring`.** It had the same shape. `importAuthKeyRing` returns a
  `KeyRing`, and its key ids and tokens are unchanged, so nothing changes at runtime. Replace `import type { AuthKeyRing } from
  "@y-core/forge/auth"` with `import type { KeyRing } from "@y-core/forge/crypto/keyring"`.

- **`AuthOptions.secret` is renamed `ring`, and its type `AuthSecretResolver` is renamed `AuthRingResolver`**, so every option that takes a key
  ring is named `ring`. Replace `{ secret: (c) => importAuthKeyRing([c.env.AUTH_SECRET]) }` with
  `{ ring: (c) => importAuthKeyRing([c.env.AUTH_SECRET]) }`. The `AUTH_SECRET` value and every token and sealed factor are unchanged.

- **The gate checks and `forge cf gen env` read `wrangler.jsonc` through one loader, which validates it.** A config with no string `name`, or one
  failing the loader's schema another way, now fails `validate-asset-root`, `validate-exposure`, `validate-compatibility` and
  `validate-dev-boundary` as unparseable, and `forge cf gen env` throws on it. A gate test fixture that writes a wrangler config without `name`
  needs one. `readWranglerConfig` is removed from `@y-core/forge/tooling/cf`; use `loadWranglerConfig(path).config`.

- **`lintPluginStep`, `chromiumBundleStep` and `totpBundleStep` are replaced by `bundleStep(label, config)`** in `@y-core/forge/tooling/gate`.
  No consuming app calls them.

[0.8.0]: https://github.com/y-core/forge/compare/v0.7.7...v0.8.0
[0.7.7]: https://github.com/y-core/forge/compare/v0.7.6...v0.7.7
[0.7.6]: https://github.com/y-core/forge/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/y-core/forge/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/y-core/forge/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/y-core/forge/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/y-core/forge/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/y-core/forge/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/y-core/forge/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/y-core/forge/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/y-core/forge/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/y-core/forge/compare/v0.5.16...v0.6.0
[0.5.16]: https://github.com/y-core/forge/compare/v0.5.15...v0.5.16
[0.5.15]: https://github.com/y-core/forge/compare/v0.5.14...v0.5.15
[0.5.14]: https://github.com/y-core/forge/compare/v0.5.13...v0.5.14
[0.5.13]: https://github.com/y-core/forge/compare/v0.5.12...v0.5.13
[0.5.12]: https://github.com/y-core/forge/compare/v0.5.11...v0.5.12
[0.5.11]: https://github.com/y-core/forge/compare/v0.5.10...v0.5.11
[0.5.10]: https://github.com/y-core/forge/compare/v0.5.9...v0.5.10
[0.5.9]: https://github.com/y-core/forge/compare/v0.5.8...v0.5.9
[0.5.8]: https://github.com/y-core/forge/compare/v0.5.7...v0.5.8
[0.5.7]: https://github.com/y-core/forge/compare/v0.5.6...v0.5.7
[0.5.6]: https://github.com/y-core/forge/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/y-core/forge/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/y-core/forge/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/y-core/forge/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/y-core/forge/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/y-core/forge/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/y-core/forge/compare/v0.4.4...v0.5.0
