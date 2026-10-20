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
