---
title: D1 Database Management
description: "The `forge db` command tree: migrations composed from declared schema files, applied forward-only with checksums and a schema fingerprint, D1 backups into R2 and their restore, and idempotent seeds."
audience: internal
---

# `@y-core/forge/tooling/db`

`forge db` is how a D1 database gets from a hand-written `schema.sql` to a running database and back again. You edit the desired state; forge
composes the migration, applies it forward-only, and records what it applied. Seeds, backups and the undo hang off the same run context.

`migrate`, `seed` and `schema` carry verbs, and a bare group runs its first verb with the same flags: `forge db migrate` is
`migrate apply`, `forge db seed` is `seed apply`, `forge db schema` is `schema check`.

**Node-only, like every `tooling` namespace.** It reaches a local database through `wrangler`'s own `getPlatformProxy` and a deployed one through
the D1 REST API, and is never reachable from a Worker. The runtime client a Worker reads the same database through is [`STORAGE_BINDINGS.md`][sb-1]
§1.

---

## Getting started

Standing up a local database is two commands, and a third to see where you are:

```bash
forge db migrate                # apply every pending migration
forge db seed                   # load the development data
forge db migrate status         # applied, pending, and where files and database disagree
```

Every verb takes the same shared flags, and `--help` on any verb lists them with its own. `--env` selects the wrangler config's `env.<name>` block,
and `--json` prints one JSON document on stdout and nothing else.

A destructive verb asks before it acts, through the prompt [`@y-core/forge/tooling/cli`][cli-readme] owns, and refuses a run with no terminal that
did not pass `--yes`.

---

## Choosing which database a command acts on

`--target` is `place[:database]`, the places being `local`, `standby`, `remote` and `preview`. What each place is, and where its state lives, is
[`DATABASE_MANAGEMENT.md`][dm-2] §2; `standby` in particular is generated rather than checked in ([§2a][dm-2a]).

```bash
forge db migrate --target remote --account-id "$ACCOUNT_ID" --api-token "$API_TOKEN"
forge db migrate --target local:analytics   # the d1_databases entry named analytics
forge db migrate --db ANALYTICS             # the same entry, by binding
```

**Name the database when the config declares more than one.** A config with several `d1_databases` entries and a run naming none is refused rather
than resolved to the first. `standby` reads the two parts differently: `:database` names the standby database itself, defaulting to
`<database>-standby`, and `--db` picks the entry it shadows.

---

## Writing a migration

Edit `schema.sql` — the desired state is the only SQL you author — then compose, check and apply:

```bash
forge db migrate compose add_sessions   # writes config/db/migrations/0005_add_sessions.sql and config/db/schema.snapshot.json
forge db lint                           # the stamp, the rules and every drop or rename, against the local database
forge db migrate --dry-run              # the plan and the SQL, writing nothing
forge db migrate                        # run it
forge db schema check                   # file, snapshot and migrations agree
```

**A drop or a rename is refused until you name the plan.** The refusal prints the plan and a digest covering its table, column and view drops and
its renames; `--allow-destructive` accepts that digest alone, so an approval cannot survive the plan changing underneath it. Once it matches,
compose writes one approval line per change directly under the header, and every verb that applies the file refuses a change no line approves
([`DATABASE_MANAGEMENT.md`][dm-9b] §9b):

```sql
-- forge:drops table "legacy_events"
-- forge:drops column "posts"."summary"
-- forge:drops view "post_counts"
-- forge:renames table "users" "accounts"
-- forge:renames column "posts"."body" "content"
```

**A rename is `--rename old:new` or it is a drop** — `table.old:new` for a column, repeatable, and never inferred. When a migration was composed
against a different history than the one now on disk, `--restamp <name>` rewrites its stamp and leaves its body untouched.

Why the emitted SQL alters in place or rebuilds through a copy, and what a rebuild takes with it, is [`SCHEMA_COMPOSITION.md`][sc-4] §4; renames are
[§5][sc-5], and the stamp and snapshot [§6][sc-6].

---

## Applying migrations

```bash
forge db migrate                        # every pending migration
forge db migrate --to 0004              # stop there, reporting the rest as left for a later run
forge db migrate --dry-run              # what would run
```

**Every lint rule is an error and aborts any apply**, and then the analysis refuses a drop or rename the file's own lines do not approve, on every
target ([`DATABASE_MANAGEMENT.md`][dm-9b] §9b). What each rule matches is [§5][dm-5].

**Rehearsing runs the pending migrations against real rows first.** `--rehearse` loads the newest complete local R2 dump into a scratch database,
applies there, and reports, then touches the target. `--dump <key>` rehearses against a dump you name instead. Worth it for a migration that
rebuilds a table ([`DATABASE_MANAGEMENT.md`][dm-6f] §6f).

Lint the SQL on its own at any time:

```bash
forge db lint                   # the migrations the local database does not hold yet
forge db lint --target remote   # the ones the deployed database does not hold yet
forge db lint --seeds           # the seeds instead
```

---

## Seeding a database

A seed is a `.sql` file in a declared seeds directory, keyed by that directory and its file name. A first line of `-- forge:places` restricts it;
without one it runs on `local` and `standby` only, and a deployed run reports it as `excluded`:

```sql
-- forge:places local,standby
INSERT OR IGNORE INTO users (email, role) VALUES ('${ADMIN_EMAIL:-admin@example.com}', 'admin');
```

`${VAR}` and `${VAR:-default}` are substituted at apply time and never when the file is hashed, so the same file on a machine with a different
environment is not a changed seed. A `${VAR}` outside a SQL string literal is accepted only as an identifier-like token or a number — quote the
placeholder when the value is data.

```bash
forge db seed                           # every seed that has not run
forge db seed --only admin --rerun      # just that one, and again although it ran
forge db seed status --check            # exit non-zero while a seed would run or has changed
forge db seed reset                     # forget the history; the rows the seeds wrote stay
```

`--only` takes `<dir>:<name>`, or a bare name no two seeds directories share, and `--dir` runs one directory instead of every one
`config/db.config.ts` names.

**A seed run refuses before anything is written** when a migration is pending (run `forge db migrate` first), when the schema moved since the last
apply certified it (restore the database), on any lint finding (write each `INSERT` as `OR IGNORE` or `ON CONFLICT`), and on a seed that changes
the schema — a `CREATE INDEX`, a `DROP VIEW`, an `ALTER TABLE` — because each pending seed first runs on a copy of the target's schema
([`DATABASE_MANAGEMENT.md`][dm-7a] §7a). No flag passes any of them. A seed whose file changed since it ran is left out and the run exits
non-zero; `--rerun` runs it again, which is a choice about that seed rather than a way past a check. The contract behind them is
[`DATABASE_MANAGEMENT.md`][dm-7] §7, and where a row belongs — migration or seed — is [§7a][dm-7a].

Rows you hold in memory can be emitted as a seed file instead of typed, proved against the declared schema before the file is written
([`DATABASE_MANAGEMENT.md`][dm-7b] §7b).

---

## Undoing an apply

What takes a database back depends on where it lives, and the ruling is [`DATABASE_MANAGEMENT.md`][dm-3] §3. In practice:

**Deployed.** Every deployed apply captures a Time Travel bookmark first and prints the command that returns to it:

```bash
$ forge db migrate --target remote
undo: forge db bookmark restore --target remote --bookmark 000000ab-…
applied 2: 0003_add_sessions, 0004_add_index
```

`--no-bookmark` skips that capture, on a seed run too. `forge db bookmark info` captures a point on demand, `--timestamp <when>` bookmarks an
earlier instant, and `bookmark restore` takes exactly one of `--bookmark` or `--timestamp`. A restore asks before discarding every write since the
point it returns to.

**Every restore prints its own undo.** It reads the current bookmark first, and sends nothing when that read fails. The undo names the bookmark D1
says it left; when D1's reply names none or cannot be read, the undo falls back to the bookmark read first, and the output says it may lose a write
that landed in between:

```bash
$ forge db bookmark restore --target remote --bookmark 000000ab-… --yes
restored, but the reply was unreadable
undo with: forge db bookmark restore --target remote --bookmark 000000aa-…
that bookmark was read just before the restore, so an undo to it loses any write that landed in between
```

A restore whose connection fails once it is sent exits 1 with `may have restored` and the same undo. A rate-limited one exits 1 with `not
restored`, and names when the next is allowed if D1 says. `--json` carries the undo's `from` (`restore` or `pre-read`) and `replyReadable`.

**Local.** Back up, then reset; restore a dump into a standby binding:

```bash
forge db backup
forge db reset --expect my-app-db
forge db restore --from <key> --into standby:<binding>
```

`bookmark` is refused for a local database, and `reset` for a deployed one.

---

## Backing up and restoring

```bash
forge db backup                                   # export the local database into R2, print the dump and its sidecar
forge db backup --target remote --keep 30         # the deployed database, keeping its 30 newest complete dumps
forge db backup list --target remote              # every dump in R2, newest first, complete or not
forge db restore --from <key> --target remote     # import a dump into a new database, and print every mismatch
forge db promote --target remote --restored <id>  # point the binding at that database once its report is clean
forge db backup pull <key> --out backups/         # copy one dump and its sidecar to disk, checked by sha256
forge db backup push backups/<file>.sql           # upload it and its sidecar back under the dump's own key
```

Each verb runs in the CLI itself, against the deployed database over the Cloudflare API with `--account-id` and `--api-token`, or against the
local one through `wrangler`, with no dev session running. Why it works this way is [`DATABASE_BACKUPS.md`][bk-3] §3. A Worker lists and reads
the same dumps through [`@y-core/forge/storage/backup`][storage-readme].

### Choosing where the dumps go

**Give the dumps a bucket of their own.** A dump holds the whole database, sessions and password hashes included, so it should not share a bucket
whose public access, CORS or lifecycle rules were set for other data such as uploads. Declare it as `BACKUPS`, under each `env.<name>` too,
because wrangler does not inherit R2 bindings:

```jsonc
{ "r2_buckets": [{ "binding": "BACKUPS", "bucket_name": "app-d1-backups" }] }
```

`--bucket` names another binding instead. Without it, a config that binds no `BACKUPS` is refused, even when it binds a single other bucket.
`--prefix` defaults to `d1-backups`. Give `backup`, `list`, `restore`, `promote` and `reset` the same pair, because each finds the dumps by it.

### Taking a backup

**`forge db backup` prints the dump's key, size, bookmark, migration head and rows per table.** Each value the dump will not reproduce is printed
as a warning, and the run still exits zero ([`DATABASE_BACKUPS.md`][bk-2] §2). `--json` prints the sidecar alone.

**`--keep <n>` deletes every dump older than the newest `n` complete ones**, each with its sidecar. Without it every dump is kept; R2's own
lifecycle rule, set with `forge cf sync lifecycle`, ages them out instead.

**To back up on a schedule, run `forge db backup --target remote` from a CI schedule or a cron job**, passing the account id and the token from
that runner's secrets. The token needs `Account → D1 → Edit` and `Account → Workers R2 Storage → Edit`.

**A deployed dump over 300 MiB, or one D1 serves with no stated length, is refused before it is uploaded**, since the dump goes into R2 through
Cloudflare's REST object endpoint.

### Restoring a dump

**`forge db restore --from <key>` never touches the live database.** Pick the target with `--into`:

- **`--into fresh`**, the default, creates `<database>-restore-<epoch ms>`. It is refused before anything is sent when that name would pass D1's
  64-character limit; restore into a standby instead.
- **`--into standby:<id>`** imports into an existing database that holds no table. Locally it is `standby:<binding>`, a second `d1_databases`
  binding, and the only choice, because local D1 cannot create a database.

The run prints each way the result differs from the dump's sidecar, and exits non-zero if it differs at all. Either way it keeps the report in R2,
at `<prefix>/<database id>/restores/<restored id>.json`, where promotion reads it. `--json` prints the report alone.

### Pointing the app at a restored database

**`forge db promote --target remote --restored <id>` rewrites the binding to the database `restore` created**, once the report under `restores/`
shows no mismatch and names a dump of this binding's own database. It asks first, prints the command that swaps back, and leaves the deploy to
you. `--database-id` with `--database-name` points the binding at any database, which is how the swap back runs. Promotion is its own step for the
reason [`DATABASE_BACKUPS.md`][bk-4] §4 gives.

### When a backup or restore fails

**Run the verb again when the failure says to.** Neither verb resumes a failed run. A backup that failed before its sidecar was written leaves no
complete dump, and a failed restore leaves a database that is not the live one, so each says to run it again. A backup whose prune past `--keep`
failed has stored its dump and sidecar: it says so, and the next backup with the same `--keep` prunes again ([`DATABASE_BACKUPS.md`][bk-3b] §3b).

### Copying a dump off Cloudflare

**`backup pull` and `backup push` copy a dump between R2 and disk, and keep nothing that does not match its sidecar.** `pull` refuses a dump with
no sidecar and a file already on disk. It deletes the copy if its size or sha256 differs from the sidecar, and exits non-zero. `push` needs the
`.json` sidecar beside the `.sql` file and checks the file against it before uploading anything. It refuses a key the bucket already holds, so it
never replaces a dump. Against a deployed bucket the dump streams through Cloudflare's REST object endpoint, which refuses an upload over 300 MiB;
push a larger one through R2's S3 API instead. Against the local bucket the dump is read whole first, since the local binding needs a body of
known length.

### Resetting a local database

**`--expect` is mandatory on `reset` because a stale `--target` must not be able to aim it.** The name you pass is the name the resolved target must
have. `reset` also refuses a database holding rows unless a dump in the local R2 bucket, under 24 hours old, still holds the same row counts. Take
one with `forge db backup`. `--dump` names which dump to rely on, and `--allow-unbacked` skips the check ([`DATABASE_BACKUPS.md`][bk-5] §5).

---

## Rebuilding the standby database

```bash
forge db standby reset             # empty it, apply every migration, then every seed
forge db standby reset --no-seed   # stop after the migrations
```

`--target` defaults to `standby` here and the verb refuses every other place. `--dir` seeds one directory. What the standby database is for, and
why nothing it does can reach the local database's state, is [`DATABASE_MANAGEMENT.md`][dm-2a] §2a.

---

## Declaring what forge reads

An optional `config/db.config.ts` default-exports `defineDbConfig({...})`, typed by `DbHostConfig`. Every field is optional. Each is a path
relative to the root, or a package specifier such as the one `forgeSchema` returns:

```ts
import { defineDbConfig, forgeSchema } from "@y-core/forge/tooling/db/host";

export default defineDbConfig({
  // Loaded in this order, so a file with a FOREIGN KEY comes after the file declaring its target.
  schemas: [forgeSchema("auth"), "config/db/schema.sql"],
  seeds: ["config/db/seeds"],
});
```

`openTestD1` loads `config/db.config.ts` under node too, and node cannot load this namespace's barrel, so the file imports from `/host`. That
subpath carries only what a host config needs, `defineDbConfig`, `forgeSchema` and their types, and it is published separately for the reason
[`docs/NAMESPACES.md`][ns-3c] §3c gives.

The default layout keeps everything under `config/db/`: `migrations` defaults to `config/db/migrations`, which is both where migrations are read
from and where compose writes, and `snapshot` defaults to `config/db/schema.snapshot.json`. An entry in
`schemas` may be a file or a directory of `.sql` files. Name forge's own schema with `forgeSchema`, never by a `node_modules` path: the
specifier resolves wherever forge is installed, and it is the key the snapshot records, so the snapshot reads the same on every machine.

**Point wrangler at the same directory.** Every `forge db` verb refuses a `d1_databases` entry whose `migrations_dir` is not the directory forge
applies from, and names the key to set. `migrations_dir` is resolved from the wrangler config's directory, so a config outside the root names the
path from there. Wrangler's own default is `migrations`, so under the default layout each entry carries `"migrations_dir": "config/db/migrations"`.
A `migrations_pattern` other than `<migrations_dir>/*.sql` is refused too, since forge applies only the directory's top-level `.sql` files.

**Nothing is read that this file does not name**, a dependency's schema included — [`DATABASE_MANAGEMENT.md`][dm-8] §8. The ownership rules that
follow from it are [`SCHEMA_COMPOSITION.md`][sc-3] §3.

---

## Wiring it into scripts and CI

Every app runs the same lifecycle, so the scripts are the same in each. Copy the ones you use into `package.json`:

| Script | Command | What it does |
| --- | --- | --- |
| `dev` | `forge db migrate && forge cf dev` | Applies pending migrations to the local database before the dev server starts |
| `db:status` | `forge db migrate status` | Which migrations are applied and pending, and where the files and the database disagree |
| `db:lint` | `forge db lint` | Checks the migrations the local database does not hold yet: the stamp, the lint rules, and every drop or rename |
| `db:compose` | `forge db migrate compose` | Writes the next migration from the declared schema |
| `db:schema:check` | `forge db schema check` | Confirms the schema files, the snapshot and the migrations agree |
| `db:migrate` | `forge db migrate` | Applies pending migrations to the local database |
| `db:migrate:remote` | `forge db migrate --target remote` | Applies pending migrations to the deployed database, under a bookmark |
| `deploy` | `forge db migrate --target remote --yes --account-id "$CLOUDFLARE_ACCOUNT_ID" --api-token "$CLOUDFLARE_API_TOKEN" && wrangler deploy` | Applies the deployed database's pending migrations, then deploys the Worker — the Workers Builds deploy command |
| `db:standby` | `forge db standby reset` | Rebuilds the standby database from the migrations and the seeds |
| `db:backup` | `forge db backup` | Exports the local database through D1's own dumper into R2, beside its sidecar |
| `db:backup:list` | `forge db backup list` | Lists the database's dumps in R2, newest first, each marked complete or not |
| `db:restore` | `forge db restore` | Restores the R2 dump `--from` names into the empty standby `--into standby:<binding>` names |
| `db:reset` | `forge db reset` | Removes the local database's state files, so a restore has an empty target |

Which lines belong in CI, and why neither covers the other, is [`DATABASE_MANAGEMENT.md`][dm-9] §9:

```bash
forge db schema check                             # the files agree with each other
forge db migrate status --check --target remote   # the database agrees with the files
```

Make the `deploy` row the Workers Builds deploy command. The build has no terminal, so `--yes` confirms the apply; `&&` deploys only when the
migrate exits 0, so a refusal or a failed apply ships nothing. What the migrate refuses, and how to recover when the deploy fails after it, is
[`DATABASE_MANAGEMENT.md`][dm-9a] §9a and §9c.

`schema check --replay` goes further than digests: it replays the migrations and loads every declared schema, then compares both to the snapshot.
Exactly what makes `status --check` fail is [§6c][dm-6c].

---

## Driving it from your own CLI

`createDbCommands()` returns the whole subtree, ready to attach:

```ts
import { addCommand, createCommand, execute } from "@y-core/forge/tooling/cli";
import { createDbCommands } from "@y-core/forge/tooling/db";

const root = createCommand({ name: "forge" });
addCommand(root, createDbCommands());
await execute(root);
```

It takes a `DbContextOverrides` — `io` and `host`, both optional. `io` is the seam every test in this namespace drives: pass a `DbIo` and no command
touches a filesystem, calls Cloudflare or opens a database. `host` supplies the `config/db.config.ts` that would otherwise be
loaded from disk.

A fake `DbIo` records what a run put to a local database apart from what it sent to Cloudflare, so a test can assert on each.

To drive one verb without the command layer, run it inside `withDbRun`, which resolves the context and releases what the verb opened. It takes a
whole `SharedDbFlags`, so every key is present even where the value is not:

```ts
import { runMigrate, withDbRun } from "@y-core/forge/tooling/db";

const outcome = await withDbRun(
  { target: "local", db: undefined, config: "wrangler.jsonc", env: undefined, root: undefined, json: false, yes: true },
  undefined,
  {},
  (run) => runMigrate(run, { dryRun: true, bookmark: true, rehearse: false }),
);
```

A local verb reaches its database in process, through a binding that holds a workerd child open for as long as the run does. `withDbRun` releases it
on the way out; a caller that resolves a context itself with `resolveDbContext` owns that release, and a process that skips it never exits.

The barrel publishes one entry point per verb on this pattern, a destructive verb split into a `prepare*` / `execute*` pair around its confirmation.
The engine beneath them is `@internal` and reached by file, not from the barrel.

---

## Gotchas

**Forge keeps the migration history, not wrangler.** No verb runs `wrangler d1 migrations apply` or writes wrangler's history table. `migrate` and
`migrate status` are its readers: they read the table an entry's `migrations_table` names, `d1_migrations` by default, and refuse and report a
migration recorded there that forge never applied. `migrations_dir` and `migrations_pattern` are read only to check they name forge's files. The two
`_forge_*` tables and what each one catches are [`DATABASE_MANAGEMENT.md`][dm-4] §4.

**A `--target remote` run needs a real `database_id`, and both `--account-id` and `--api-token`.** A missing id, or the placeholder, refuses the
run and points at [`forge cf sync --commit`][cf-readme] rather than guessing. Nothing else authenticates it — not `wrangler login`, not an exported
`CLOUDFLARE_*` variable; either flag missing refuses before any request. Pass the token as `--api-token "$VAR"` so it stays out of shell history.
The undo command a remote verb prints names neither flag, so add both when you run it.

**`--env` reads the environment as wrangler builds it.** An `env.<name>` block with no `d1_databases` gets none from the top level, so `--env`
refuses and names the key to restate. An undeclared name is always refused, even when the config has no `env` table and wrangler would fall back to
the top level. Forge refuses so that a mistyped name never reaches the top-level database.

**`--json` owns stdout.** Progress lines, confirmations and warnings go to stderr under it, so the document on stdout is parseable whole.

**Scratch databases live under `.forge/scratch/`.** Compose and rehearsal are what build them; `--to` applies against the real
home.

**A drop that followed a file leaving `config/db.config.ts` names the file that declared it**, so the refusal is attributable rather than
unexplained ([`SCHEMA_COMPOSITION.md`][sc-3] §3).

---

## See also

- [`DATABASE_MANAGEMENT.md`][dm] — every ruling this surface implements
- [`SCHEMA_COMPOSITION.md`][sc] — what `migrate compose` decides
- [`DATABASE_BACKUPS.md`][bk] — the dump and its sidecar, the restore ladder, and what reset checks
- [`@y-core/forge/tooling/cli`][cli-readme] — the command framework and the `confirm` prompt every destructive verb asks through
- [`@y-core/forge/tooling/cf`][cf-readme] — `forge cf sync --commit`, which provisions the `database_id` a `--target remote` run requires
- [`STORAGE_BINDINGS.md`][sb-1] §1 — the typed D1 client a Worker reads the same database through at runtime

[bk]: ../../../docs/DATABASE_BACKUPS.md
[bk-2]: ../../../docs/DATABASE_BACKUPS.md#2-what-a-dump-cannot-carry
[bk-3]: ../../../docs/DATABASE_BACKUPS.md#3-the-cli-runs-the-pipeline-a-transport-per-place
[bk-3b]: ../../../docs/DATABASE_BACKUPS.md#3b-a-failed-run-is-run-again
[bk-4]: ../../../docs/DATABASE_BACKUPS.md#4-the-restore-ladder
[bk-5]: ../../../docs/DATABASE_BACKUPS.md#5-reset-and-rehearse-rely-on-a-local-dump
[cf-readme]: ../cf/README.md
[cli-readme]: ../cli/README.md
[dm]: ../../../docs/DATABASE_MANAGEMENT.md
[dm-2]: ../../../docs/DATABASE_MANAGEMENT.md#2-targets-and-homes
[dm-2a]: ../../../docs/DATABASE_MANAGEMENT.md#2a-standby--a-second-local-database
[dm-3]: ../../../docs/DATABASE_MANAGEMENT.md#3-the-undo-per-place
[dm-4]: ../../../docs/DATABASE_MANAGEMENT.md#4-the-companion-tables
[dm-5]: ../../../docs/DATABASE_MANAGEMENT.md#5-the-migration-lint-rules
[dm-6c]: ../../../docs/DATABASE_MANAGEMENT.md#6c-status---check-exit-conditions
[dm-6f]: ../../../docs/DATABASE_MANAGEMENT.md#6f-rehearsing-against-real-rows
[dm-7]: ../../../docs/DATABASE_MANAGEMENT.md#7-the-seed-contract
[dm-7a]: ../../../docs/DATABASE_MANAGEMENT.md#7a-migration-or-seed
[dm-7b]: ../../../docs/DATABASE_MANAGEMENT.md#7b-a-generated-fixture-seed
[dm-8]: ../../../docs/DATABASE_MANAGEMENT.md#8-every-position-is-declared
[dm-9]: ../../../docs/DATABASE_MANAGEMENT.md#9-the-ci-gate
[dm-9a]: ../../../docs/DATABASE_MANAGEMENT.md#9a-the-workers-builds-deploy-command
[dm-9b]: ../../../docs/DATABASE_MANAGEMENT.md#9b-the-migration-contract
[ns-3c]: ../../../docs/NAMESPACES.md#3c-a-surface-node-loads-is-published-prebuilt
[sb-1]: ../../../docs/STORAGE_BINDINGS.md#1-storagedb--d1-database-client
[sc]: ../../../docs/SCHEMA_COMPOSITION.md
[sc-3]: ../../../docs/SCHEMA_COMPOSITION.md#3-ownership
[sc-4]: ../../../docs/SCHEMA_COMPOSITION.md#4-what-compose-emits
[sc-5]: ../../../docs/SCHEMA_COMPOSITION.md#5-renames
[sc-6]: ../../../docs/SCHEMA_COMPOSITION.md#6-the-stamp-the-snapshot-and-the-two-checks
[storage-readme]: ../../storage/README.md#listing-backups-from-an-admin-page
