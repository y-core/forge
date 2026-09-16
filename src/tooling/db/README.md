---
title: D1 Database Management
description: "The `forge db` command tree: migrations composed from declared schema files, applied forward-only with checksums and a schema fingerprint, verified backups, and idempotent seeds."
audience: internal
---

# `@y-core/forge/tooling/db`

Everything `forge db` does to a Cloudflare D1 database: compose a migration from the schema files the host config declares, apply migrations
forward-only and record what was applied, lint the SQL before it runs, write a backup artifact that has been proven to rebuild, and seed a database
idempotently.

Each verb is written once, with the flags that change what it does indented beneath it:

```bash
forge db migrate apply [--dry-run]     # check the history, then apply every pending migration to --target
    --to 0004                          # stop after that migration, reporting the rest as left for a later run
    --allow-drift                      # apply although the schema moved since the last apply certified it
    --rehearse [--artifact <dir>]      # apply to a copy restored from a verified backup first; --artifact implies it
    --no-lint / --allow-warnings       # skip the lint pass, or accept its warnings on a deployed target
forge db migrate compose [name]  [--dry-run] # the next migration, from schema.sql, proven on a replay first
    --custom <name>                    # a hand-written stub, for a data move
    --restamp <name>                   # rewrite a generated migration's stamp to the merged history, body untouched
    --allow-destructive <digest>       # compose the drop set the refusal printed, and no other
    --rename posts:articles            # rename rather than drop and create; repeatable, never inferred
forge db migrate status                # applied, pending, and where the files and the database disagree
    --check                            # the same, exiting non-zero when out of step. For CI
forge db lint [file…]                  # check migrations for SQL that is destructive, unbounded, or refused by D1
    --seeds                            # check the seeds instead: an INSERT that is not safe to run twice, and the destructive rules
    --strict                           # fail on a warning as well as on an error

forge db seed apply                    # run every seed that has not run; a deployed run confirms and bookmarks
    --only <name> [--rerun]            # just this seed, and again although it ran or its file changed
    --allow-pending                    # seed the older schema, over a pending migration
    --allow-drift                      # seed a schema that moved since the last apply certified it
    --allow-warnings / --no-bookmark   # as `migrate apply`
forge db seed status [--check]         # pending, applied, and changed since it ran
forge db seed reset                    # forget the seed history, keeping the rows

forge db schema check                  # the declared schemas, the snapshot and the migrations agree. For CI
    --replay                           # replay the migrations and load the schemas too, not digests alone

forge db backup [--target remote]      # a verified artifact under .forge/backups, from any place
forge db restore --artifact <dir>      # load one artifact into an empty database
forge db reset --expect <database>     # remove a local database's state files

forge db bookmark info                 # capture a Time Travel restore point on a deployed database
forge db bookmark restore --bookmark … # return a deployed database to one
```

Three groups, one shape: `migrate`, `seed` and `schema` each carry their verbs, and the bare group runs the first one — `forge db migrate` is
`migrate apply`, `forge db seed` is `seed apply`, `forge db schema` is `schema check` — taking the same flags.

Every verb takes the same seven flags — `--target`/`-t`, `--db`, `--config`/`-c`, `--env`/`-e`, `--root`, `--json`, `--yes` — plus `--help`/`-h`.
`--json` prints one JSON document and nothing else on stdout, so progress lines go to stderr. A destructive verb asks before it acts, and refuses a
run with no terminal that did not pass `--yes`.

> **Runtime:** node-only, like every `tooling` namespace. It shells out to `wrangler` for every statement it runs, and is never reachable from a
> Worker.

---

## Features

- **Declared schema files, one migration sequence** — a `schema.sql` is what the schema is; `migrate compose` replays the migrations into a
  scratch D1, diffs the result against every declared schema loaded together, proves the emitted SQL on that replay, and writes the next numbered
  file into the app's own directory with a stamp saying so. A drop is refused until `--allow-destructive <digest>` names the plan it printed; a
  rename is `--rename old:new`, never inferred.
- **Forward-only migrations**, with the history forge's own rather than wrangler's: one `_forge_migrations` row per applied migration carrying its
  checksum, when it ran, and the schema fingerprint it certified — written in the same load as the migration body.
- **A lint pass before every apply** — over SQL that is destructive, unbounded, unbackupable, or that D1 refuses, errors aborting any apply and
  warnings aborting a deployed one.
- **An undo per place** — a D1 Time Travel bookmark captured before every deployed apply, and backup-plus-reset locally.
- **Verified backups** — an artifact is replayed by both restore routes into a throwaway database and compared row by row before it is written; a
  deployed database is backed up the same way, read-only, so it has an artifact beyond Time Travel's window.
- **Idempotent seeds** — keyed by directory and name, hashed over the raw file text, with `${VAR:-default}` expanded at apply alone, scoped to
  places with `-- forge:places`, and refused when the file changed after it ran or a migration is still pending.
- **Nothing is discovered** — the host config names every schema file and every seeds directory by path, so an installed package contributes no DDL
  unless the app asked for it. A library publishes desired state and no SQL that runs; `schema.snapshot.json` records a digest per declared file, so
  an upgraded one fails `schema check` by path until its migration has been composed and reviewed, and the names each file declared, so a drop that
  followed the file leaving `config/db.ts` names the file that declared it.
- **One I/O port** — every filesystem touch and every `wrangler` spawn goes through `DbIo`, so a test drives the whole surface against an in-memory
  fake.

The rulings behind all of that — why there is no Down, what each companion table catches, what each lint rule matches — are
[`DATABASE_MANAGEMENT.md`][dm]'s.

---

## Targets — `place[:database]`

`--target` names where the database lives, and optionally which one. The default is `local`.

| Place | What it is |
| --- | --- |
| `local` | The app's own development database, in `.wrangler/state` beside the wrangler config |
| `standby` | A second local database under `.forge/standby/`, for rehearsing against something that is not the one you are working in |
| `remote` | The deployed database |
| `preview` | The deployed preview database |

```bash
forge db migrate --target remote
forge db migrate --target local:analytics     # the entry named analytics
forge db migrate --db ANALYTICS               # the same, by binding
```

`:database` and `--db` pick a `d1_databases` entry by binding or `database_name`, and one of them is required when the config declares more than one
— a config with several entries and a run naming none is refused rather than resolved to the first. `standby` is the exception: its `:database`
names the standby database itself, which defaults to `<database>-standby`, and `--db` picks the entry.

**`standby` is generated, not checked in.** Forge writes a wrangler config for it under `.forge/standby/<database>/` with its own `--persist-to`, so
nothing a standby run does can reach the local database's state. The same mechanism backs compose and the backup verification, which build throwaway
homes under `.forge/scratch/`. `--to` needs none of it: it filters the pending set and the apply runs against the real home.

---

## The undo

**Migrations are forward-only** — no file has a Down, and nothing here runs one. What takes a database back depends on where it lives.

**Deployed (`remote`, `preview`): a Time Travel bookmark.** Every deployed apply captures one before its first statement and prints it as the
command that returns to it:

```bash
$ forge db migrate --target remote
undo: forge db bookmark restore --target remote --bookmark 000000ab-…
applied 2: 0003_add_sessions, 0004_add_index
```

`--no-bookmark` skips the capture. `forge db bookmark info [--timestamp <when>]` captures a point on demand, and a restore asks before discarding
every write since the point it returns to.

**Local (`local`, `standby`): a verified backup, then reset and restore.**

```bash
forge db backup                                    # prove an artifact rebuilds, then keep it
forge db reset --expect my-app-db                  # remove the state files
forge db restore --artifact .forge/backups/my-app-db-20260101T120000Z
```

`reset` is the only verb that empties a database. It refuses one that holds rows unless a verified artifact still describes them — every app table's
count against the manifest's, then every table's digest — taking the most recent verified backup, or the one `--backup <dir>` names, and skipping
the whole check under `--allow-unbacked`. `restore` loads into an empty database only, and checks every file the manifest declares before it touches
the target. `restore` and `reset` are refused for a deployed database, and `bookmark` is refused for a local one.

**A deployed database is backed up too.** `forge db backup --target remote` (or `preview`) reads it with no lock and no bookmark, proves both routes
into a local scratch, and writes a manifest naming the target with a warning that restore is refused there — the artifact restores into `local`,
`standby` or a rehearsal scratch.

---

## The companion tables

Forge keeps two `STRICT` tables of its own, created on first use. They sit outside the schema fingerprint because their names begin `_forge_`,
matching the platform's own `_cf_*`.

| Table | Columns | What it is for |
| --- | --- | --- |
| `_forge_migrations` | `id`, `name`, `sha256`, `applied_at`, `fingerprint` | The migration history: what ran, when, and the schema it certified |
| `_forge_seed_history` | `id`, `source`, `name`, `sha256`, `applied_at` | One row per applied seed, which is what makes a seed run once |

**`_forge_migrations` is the whole history — there is no wrangler half.** No verb runs
`wrangler d1 migrations apply`, and `d1_migrations` is never read or written. `name` is the identity,
carried as a unique index rather than as the key, because a backup's keyset read orders by one column;
`applied_at` is epoch milliseconds, since `STRICT` has no `TIMESTAMP`; and `fingerprint` is `NULL`
until an apply certifies one. The `id` is a plain `INTEGER PRIMARY KEY` and never `AUTOINCREMENT`.

**`_forge_seed_history` keys on the declared seeds directory and the file name**, carried as a unique
index over `source` and `name` for the same keyset reason. `source` is what `seed reset --dir` filters
on.

What each one catches, the three states `db migrate status` reports, and why seed history is not a
column on the migration history are [`DATABASE_MANAGEMENT.md`][dm-4] §4.

---

## Usage

### Standing a database up

```bash
forge db migrate                       # apply every pending migration
forge db seed                          # load the development data
forge db migrate status                # confirm
```

### Writing a migration

Edit `schema.sql` — the desired state, hand-written and the only thing you author — then:

```bash
forge db migrate compose add_sessions  # writes migrations/0005_add_sessions.sql and schema.snapshot.json
forge db lint --strict                 # before committing it
forge db migrate --dry-run             # what would run
forge db migrate                       # run it
forge db schema check                  # the file, the snapshot and the migrations agree
```

`--dry-run` prints the plan and the SQL and writes nothing. A change that drops a table or a column is refused with the plan and a digest of the
drop set until `--allow-destructive <digest>` names that plan and no other; a rename is `--rename posts:articles` or `--rename posts.body:content`,
repeatable. A data move is `compose --custom <name>`, a stub to fill in by hand.

### Deploying

```bash
forge db migrate status --check --target remote  # in CI, before the deploy step
forge db migrate --target remote --yes           # in the deploy step
```

`--allow-warnings` is what lets a deployed apply proceed past a lint warning, after the warning has been read. A lint error aborts any apply,
`--no-lint` skips the pass entirely, and `--to <NNNN|name>` stops at a named migration and reports the rest as left for a later run.

### Seeds

A seed is a `.sql` file in `seeds/`, keyed by its file name and hashed over its raw text, so the same file on a machine with a different environment
is not a changed seed. A first line of `-- forge:places` keeps it to the places named; without one it runs on `local` and `standby` only, and a
deployed run lists it as `excluded`:

```sql
-- forge:places local,standby
INSERT OR IGNORE INTO users (email, role) VALUES ('${ADMIN_EMAIL:-admin@example.com}', 'admin');
```

```bash
forge db seed                          # every seed that has not run
    --only admin [--rerun]             # just this one, and again whether its file changed or not
    --allow-pending                    # seed the older schema, over a pending migration
    --allow-drift                      # seed a schema that moved since the last apply certified it
forge db seed status --check           # exit 1 while a seed would run or has changed
```

A seed whose file changed since it ran is reported and refused, and so is a database with a migration pending, and so is one whose schema moved
since the last apply certified it. `--rerun` is the way past the first, `--allow-pending` the second, `--allow-drift` the third. All three are
checked before the lint, the confirmation and the first load, so a refusal leaves nothing written. A deployed `seed apply` confirms, captures a Time
Travel bookmark, and refuses lint warnings without `--allow-warnings`, as `migrate` does. `forge db seed reset` clears the history table and touches
no row a seed wrote.

### Host config

An optional `config/db.ts` default-exports a `DbHostConfig`, and every field is optional:

```ts
import type { DbHostConfig } from "@y-core/forge/tooling/db";

export default {
  // Loaded in this order, so a file with a FOREIGN KEY comes after the file declaring its target.
  schemas: ["node_modules/@acme/auth/schema.sql", "config/schema.sql"],
  seeds: ["config/seeds"],
  migrations: "migrations",
  snapshot: "config/schema.snapshot.json",
  backupsDir: ".forge/backups",
} satisfies DbHostConfig;
```

Every field is optional and every one is a path relative to the root — `migrations` included, which defaults to `migrations` and is the one
directory every migration is read from and composed into. An entry in `schemas` may be a file or a directory of `.sql` files; nothing is read that
is not named here, including a library's. `snapshot` defaults to `schema.snapshot.json` at the root. `migrations_dir` and `migrations_table` in a
`d1_databases` entry are not read at all.

### Naming the verbs once

The verbs are long enough to be worth a script apiece:

```json
{
  "scripts": {
    "db:migrate": "forge db migrate",
    "db:migrate:remote": "forge db migrate --target remote",
    "db:status": "forge db migrate status",
    "db:backup": "forge db backup",
    "db:restore": "forge db restore",
    "db:reset": "forge db reset",
    "db:lint": "forge db lint --strict",
    "db:compose": "forge db migrate compose",
    "db:schema:check": "forge db schema check"
  }
}
```

Which two lines belong in CI, and why neither covers the other, is [`DATABASE_MANAGEMENT.md`][dm-9] §9.

### Driving it from your own CLI

`createDbCommands()` returns the whole subtree, ready to attach:

```ts
import { addCommand, createCommand, execute } from "@y-core/forge/tooling/cli";
import { createDbCommands } from "@y-core/forge/tooling/db";

const root = createCommand({ name: "forge" });
addCommand(root, createDbCommands());
await execute(root);
```

It takes a `DbContextOverrides` — `{ io?, host? }` — which is the seam every test in this namespace drives: pass a `DbIo` and no command touches a
filesystem or spawns `wrangler`.

---

## Exports

> Import path: `@y-core/forge/tooling/db` → `src/tooling/db/mod.ts`

The barrel publishes the command factory, the run context, and one entry point per verb, in the order the table follows: `bookmark`, `commands`,
`context`, then `migrate/`, `backup/`, `seed/`, `standby` and `schema/`. The engine beneath them — `home`, `io`, `sql`, `target`, `wrangler` and the
rest of each directory — is `@internal`: the gate and the tests reach it by file, and a consumer drives a verb through its `run*`, `prepare*` or
`execute*` function with the run context `resolveDbContext` resolves. The inventory read, the last-fingerprint read and the fingerprint rules are
`@y-core/forge/storage/db`'s, so a Worker judges a schema by the same spelling the CLI does.

### Exports

| Export | Signature | Purpose |
| --- | --- | --- |
| `timeTravelInfo` | `timeTravelInfo(io: DbIo, home: Home, timestamp?: string, config?: DbConfig): Bookmark` | Captures the bookmark for now or for `--timestamp`, and the command that restores to it. |
| `timeTravelRestore` | `timeTravelRestore(io: DbIo, home: Home, point: { bookmark: string } \| { timestamp: string }): string` | Restores the deployed database to a bookmark or a timestamp. The confirmation is the caller's. |
| `createDbCommands` | `createDbCommands(overrides: DbContextOverrides = {}): CommandBase` | The `forge db` command tree: migrate, lint, schema, backup, restore, reset, seed, standby and bookmark. |
| `resolveDbContext` | `resolveDbContext(flags: SharedDbFlags, ctx?: CliContext, overrides: DbContextOverrides = {}): Promise<DbRunContext>` | Resolves the shared flags into a run context. |
| `confirmPrinter` | `confirmPrinter(run: DbRunContext): (line: string) => void` | Where a confirmation prints: stderr under `--json`, so stdout stays the one JSON document, and stdout otherwise. |
| `runMigrate` | `runMigrate(run: DbRunContext, options: MigrateOptions): Promise<MigrateOutcome>` | Checks the history against what forge recorded and applies every pending migration under a lock, each with its own history row. |
| `lintMigration` | `lintMigration(file: string, sql: string): LintFinding[]` | Checks one migration's SQL against every rule, reporting the line each finding sits on. |
| `lintMigrations` | `lintMigrations(migrations: readonly Migration[]): LintFinding[]` | Checks every discovered migration, naming each finding by the file it came from. |
| `runBackup` | `runBackup(run: DbRunContext, options: BackupOptions): BackupOutcome` | Writes a verified backup artifact directory, proving by both restore routes unless `verify` is false. |
| `findVerifiedBackup` | `findVerifiedBackup(run: DbRunContext, database: string): string \| null` | The most recent artifact naming this database whose own run proved it rebuilds. |
| `prepareReset` | `prepareReset(run: DbRunContext, options: ResetOptions): ResetPlan` | Everything a reset checks before it asks: the target, the state directory, its rows, and the artifact that proves them recoverable. |
| `executeReset` | `executeReset(run: DbRunContext, plan: ResetPlan): ResetOutcome` | Removes the state directory a prepared reset named, if any, and reports. |
| `readBackupManifest` | `readBackupManifest(run: DbRunContext, artifact: string): BackupManifest` | Reads and validates the artifact's manifest, refusing one this tool did not write. |
| `prepareRestore` | `prepareRestore(run: DbRunContext, options: RestoreOptions): RestorePlan` | Everything a restore checks before it asks: the manifest, the artifact whole, its embedded migrations, and an empty target. |
| `executeRestore` | `executeRestore(run: DbRunContext, plan: RestorePlan): RestoreOutcome` | Loads a prepared restore into the target and checks the result against the manifest's own digests. |
| `readSeeds` | `readSeeds(run: DbRunContext, dir?: string \| undefined): readonly Seed[]` | Every seed on disk: each declared directory's, in the order `config/db.ts` names them, with `--dir` overriding the lot. |
| `composeSeedFixture` | `composeSeedFixture(run: DbRunContext, options: SeedFixtureOptions): SeedFixtureOutcome` | Composes a seed file from rows in memory, proving every one loads into the declared schema before the file is written. |
| `lintSeeds` | `lintSeeds(seeds: readonly Seed[]): LintFinding[]` | Checks every seed, naming each finding by the file it came from. |
| `runStandbyReset` | `runStandbyReset(run: DbRunContext, options: StandbyResetOptions): Promise<StandbyResetOutcome>` | Empties a standby database, applies every migration, then applies every seed, so what it holds depends on nothing a previous run left. |
| `checkSchema` | `checkSchema(run: DbRunContext, options: { replay: boolean; cache: boolean }): SchemaCheckReport` | Holds every declared schema and the migrations against the snapshot: by digest always, by replay when asked. |
| `composeMigration` | `composeMigration(run: DbRunContext, options: ComposeOptions): ComposeOutcome` | Composes the next migration from every declared schema, proving it against a replay of the migrations before writing it; a rebuild that depends on the rows already there is warned in `warnings`, and a drop whose declaring file `config/db.ts` no longer names is attributed in `causes`. |

**Types:** the run — `Place`, `DbTarget`, `D1Entry`, `DbConfig`, `DbHostConfig`, `DbContextOverrides`, `DbRunContext`, `Home`, `Spawned`, `DbIo`,
`SharedDbFlags`, `Bookmark`.

**Types:** migrations — `Migration`, `MigrationOrigin`, `ComposeStamp`, `ApplyPlan`, `MigrateOptions`, `MigrateOutcome`, `RehearsalOutcome`,
`LintRule`, `LintLevel`, `LintFinding`, `SchemaObject`, `SchemaFacts`, `SchemaDrift`.

**Types:** backup, restore and reset — `BackupManifest`, `BackupOptions`, `BackupOutcome`, `RestoreRoute`, `RestoreOptions`, `RestoreOutcome`,
`RestorePlan`, `RestoreTargetState`, `ResetOptions`, `ResetOutcome`, `ResetPlan`.

**Types:** seeds and the declared schema — `Seed`, `SeedPlan`, `SeedOutcome`, `SeedFixtureOptions`, `SeedFixtureOutcome`, `ComposeOptions`,
`ComposeOutcome`, `SchemaCheckReport`.

**Types:** the standby database — `StandbyResetOptions`, `StandbyResetOutcome`.

---

## See also

- [`DATABASE_MANAGEMENT.md`][dm] — every ruling this surface implements: the forward-only policy, the undo per place, the companion tables, the lint
  rules, the seed contract, the host config, backup artifacts, and the CI gate line.
- [`SCHEMA_COMPOSITION.md`][sc] — the rulings `migrate compose` implements: ownership, what is altered in place and what is rebuilt, renames, the
  stamp, the snapshot, and the two file-only checks.
- [`@y-core/forge/tooling/cli`][cli-readme] — the command framework, the `confirm` prompt every destructive verb asks through, and the config-module
  loader `config/db.ts` is read by.
- [`@y-core/forge/tooling/cf`][cf-readme] — `forge cf sync --commit`, which provisions the `database_id` a `--target remote` run requires.
- [`STORAGE_BINDINGS.md`][sb-1] §1 — the typed D1 client a Worker reads the same database through at runtime.

[cf-readme]: ../cf/README.md
[cli-readme]: ../cli/README.md
[dm]: ../../../docs/DATABASE_MANAGEMENT.md
[dm-4]: ../../../docs/DATABASE_MANAGEMENT.md#4-the-companion-tables
[dm-9]: ../../../docs/DATABASE_MANAGEMENT.md#9-the-ci-gate
[sb-1]: ../../../docs/STORAGE_BINDINGS.md#1-storagedb--d1-database-client
[sc]: ../../../docs/SCHEMA_COMPOSITION.md
