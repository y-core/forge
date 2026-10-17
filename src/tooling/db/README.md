---
title: D1 Database Management
description: "The `forge db` command tree: migrations composed from declared schema files, applied forward-only with checksums and a schema fingerprint, verified backups, and idempotent seeds."
audience: internal
---

# `@y-core/forge/tooling/db`

`forge db` is how a D1 database gets from a hand-written `schema.sql` to a running database and back again. You edit the desired state; forge
composes the migration, applies it forward-only, and records what it applied. Seeds, backups and the undo hang off the same run context.

```bash
forge db migrate                # apply every pending migration
forge db migrate compose <name> # write the next migration from the declared schema
forge db seed                   # load development data, once per seed
forge db backup                 # a verified artifact you can restore from
```

`migrate`, `seed` and `schema` carry verbs, and a bare group runs its first verb with the same flags: `forge db migrate` is
`migrate apply`, `forge db seed` is `seed apply`, `forge db schema` is `schema check`.

**Node-only, like every `tooling` namespace.** It reaches a local database through `wrangler`'s own `getPlatformProxy` and a deployed one by running
the CLI, and is never reachable from a Worker. The runtime client a Worker reads the same database through is [`STORAGE_BINDINGS.md`][sb-1] §1.

---

## Getting started

Standing up a local database is two commands, and a third to see where you are:

```bash
forge db migrate                # apply every pending migration
forge db seed                   # load the development data
forge db migrate status         # applied, pending, and where files and database disagree
```

Every verb takes the same flags, plus `--help` / `-h`:

| Flag | Default | What it selects |
| --- | --- | --- |
| `--target` / `-t` | `local` | Which database, as `place[:database]` |
| `--db` | — | The `d1_databases` binding or `database_name`, when the config declares more than one |
| `--config` / `-c` | `wrangler.jsonc` | Path to the wrangler config |
| `--env` / `-e` | — | Wrangler environment, forwarded as `wrangler -e` |
| `--root` | the current directory | Application root |
| `--json` | off | Print one JSON document and nothing else on stdout; progress goes to stderr |
| `--yes` | off | Skip the confirmation a destructive verb asks |

A destructive verb asks before it acts, through the prompt [`@y-core/forge/tooling/cli`][cli-readme] owns, and refuses a run with no terminal that
did not pass `--yes`.

---

## Choosing which database a command acts on

`--target` is `place[:database]`, the places being `local`, `standby`, `remote` and `preview`. What each place is, and where its state lives, is
[`DATABASE_MANAGEMENT.md`][dm-2] §2; `standby` in particular is generated rather than checked in ([§2a][dm-2a]).

```bash
forge db migrate --target remote
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

| `compose` flag | What it is for |
| --- | --- |
| `--dry-run` | Print the plan and the SQL; write nothing |
| `--allow-destructive <digest>` | Approve the plan whose digest the refusal printed — its drops and renames — and no other |
| `--rename old:new` | Rename rather than drop and create; `table.old:new` for a column. Repeatable, never inferred |
| `--restamp <name>` | Rewrite a generated migration's stamp to the history now on disk, body untouched |
| `--no-cache` | Replay into the scratch database even when a cached model matches |

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

A rename is `--rename` or it is a drop — nothing here infers one. Why the emitted SQL
alters in place or rebuilds through a copy, and what a rebuild takes with it, is [`SCHEMA_COMPOSITION.md`][sc-4] §4; renames are [§5][sc-5], and the
stamp and snapshot [§6][sc-6].

---

## Applying migrations

```bash
forge db migrate                        # every pending migration
forge db migrate --to 0004              # stop there, reporting the rest as left for a later run
forge db migrate --dry-run              # what would run
```

| `apply` flag | What it is for |
| --- | --- |
| `--dry-run` | Report what would be applied and change nothing |
| `--to <NNNN\|name>` | Stop after that migration |
| `--no-bookmark` | Skip the Time Travel bookmark a deployed apply captures |
| `--rehearse` | Apply to a copy restored from a backup first, and report, before touching the target |
| `--artifact <dir>` | The artifact `--rehearse` restores; implies `--rehearse` |

**Every lint rule is an error and aborts any apply**, and then the analysis refuses a drop or rename the file's own lines do not approve, on every
target ([`DATABASE_MANAGEMENT.md`][dm-9b] §9b). What each rule matches is [§5][dm-5].

**Rehearsing runs the pending migrations against real rows first.** `--rehearse` restores the most recent verified backup into a scratch database,
applies there, and reports — then touches the target. Worth it for a migration that rebuilds a table ([`DATABASE_MANAGEMENT.md`][dm-6f] §6f).

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

| `seed apply` flag | What it is for |
| --- | --- |
| `--dir <path>` | Run just this directory, instead of every one `config/db.ts` names |
| `--only <name>` | Run one seed, as `<dir>:<name>` or a name no two directories share |
| `--rerun` | Run a seed that already ran, including one whose file changed since |
| `--no-bookmark` | Skip the Time Travel bookmark a deployed seed captures |

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

`forge db bookmark info` captures a point on demand, `--timestamp <when>` bookmarks an earlier instant, and `bookmark restore` takes exactly one of
`--bookmark` or `--timestamp`. A restore asks before discarding every write since the point it returns to.

**Local.** Back up, reset, restore:

```bash
forge db backup
forge db reset --expect my-app-db
forge db restore --artifact .forge/backups/my-app-db-20260101T120000Z
```

`bookmark` is refused for a local database, and `restore` and `reset` for a deployed one.

---

## Backing up and restoring

```bash
forge db backup                          # verified artifact under .forge/backups
forge db backup --target remote --label "before 0005"
forge db restore --artifact <dir>        # into an empty database
forge db reset --expect my-app-db        # remove a local database's state files
```

| Verb | Flags |
| --- | --- |
| `backup` | `--out <dir>`, `--no-verify`, `--label <note>` |
| `restore` | `--artifact <dir>` (required), `--route full\|migrations` (default `migrations`), `--expect <database>` |
| `reset` | `--expect <database>` (required), `--backup <dir>`, `--allow-unbacked` |

**`--expect` is mandatory on `reset` because a stale `--target` must not be able to aim it.** The name you pass is the name the resolved target must
have. `reset` also refuses a database holding rows unless a verified artifact still describes them; `--backup` names which artifact to rely on, and
`--allow-unbacked` skips the check.

**`--route` picks how a restore rebuilds the schema**: `migrations` applies the migrations directory then loads the data, `full` loads the
artifact's own schema then its rows. A backup proves both routes before it is written, which is why `--no-verify` is a flag and not the default —
what it costs and when it is worth skipping is [`DATABASE_BACKUPS.md`][bk-5a] §5a. The artifact layout is [§1][bk-1], and what restore and reset
check before they act is [§6][bk-6].

A deployed backup is a read: no lock, no bookmark, proven into a local scratch, and its manifest warns that restore is refused on a deployed target
([`DATABASE_BACKUPS.md`][bk-3] §3).

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

An optional `config/db.ts` default-exports a `DbHostConfig`. Every field is optional. Each is a path relative to the root, or a package
specifier such as the one `forgeSchema` returns:

```ts
import { forgeSchema, type DbHostConfig } from "@y-core/forge/tooling/db";

export default {
  // Loaded in this order, so a file with a FOREIGN KEY comes after the file declaring its target.
  schemas: [forgeSchema("auth"), "config/db/schema.sql"],
  seeds: ["config/db/seeds"],
} satisfies DbHostConfig;
```

The default layout keeps everything under `config/db/`: `migrations` defaults to `config/db/migrations`, which is both where migrations are read
from and where compose writes, and `snapshot` defaults to `config/db/schema.snapshot.json`. `backupsDir` defaults to `.forge/backups`. An entry in
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
| `dev` | `forge db migrate && wrangler dev` | Applies pending migrations to the local database before the dev server starts |
| `db:status` | `forge db migrate status` | Which migrations are applied and pending, and where the files and the database disagree |
| `db:lint` | `forge db lint` | Checks the migrations the local database does not hold yet: the stamp, the lint rules, and every drop or rename |
| `db:compose` | `forge db migrate compose` | Writes the next migration from the declared schema |
| `db:schema:check` | `forge db schema check` | Confirms the schema files, the snapshot and the migrations agree |
| `db:migrate` | `forge db migrate` | Applies pending migrations to the local database |
| `db:migrate:remote` | `forge db migrate --target remote` | Applies pending migrations to the deployed database, under a bookmark |
| `db:deploy` | `forge db deploy` | Checks the deployed database, applies its pending migrations, then runs `wrangler deploy` |
| `db:standby` | `forge db standby reset` | Rebuilds the standby database from the migrations and the seeds |
| `db:backup` | `forge db backup` | Writes a verified backup of a database |
| `db:restore` | `forge db restore` | Restores a database from a backup |
| `db:reset` | `forge db reset` | Removes the local database's state files, so a restore has an empty target |

Which lines belong in CI, and why neither covers the other, is [`DATABASE_MANAGEMENT.md`][dm-9] §9:

```bash
forge db schema check                             # the files agree with each other
forge db migrate status --check --target remote   # the database agrees with the files
```

The deploy step itself is one verb. Make it the Workers Builds deploy command:

```bash
forge db deploy --yes          # CI has no terminal: --yes confirms the pending migrations
forge db deploy --check-only   # the checks alone; exits 1 while a migration is pending
```

Deploy asks before applying, exactly as `forge db migrate --target remote` does, and a non-interactive run without `--yes` is refused before
anything is applied or deployed.

It refuses a database that moved outside the migrations, a token without `Account → D1 → Edit`, and a pending drop or rename its migration's
lines do not approve. If `wrangler deploy` fails after the apply, it prints the command that restores the schema. Why a migration has to keep
the previous Worker working, and what approves a drop, is [`DATABASE_MANAGEMENT.md`][dm-9b] §9b.

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
touches a filesystem, spawns `wrangler` or opens a database. `host` supplies the `config/db.ts` that would otherwise be loaded from disk.

`DbIo` carries both ways a verb reaches a database: `spawn`, for a deployed one and for `d1 export`, and `d1`/`closeD1`, for a local one —
statements in, rows out, one call being one transaction. The fake records each separately, so a test reads what a run put to a database apart
from what it ran.

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

The barrel publishes one entry point per verb on this pattern — `runMigrate`, `runBackup`, `checkSchema`, `composeMigration`, `runStandbyReset`, the
lint functions, and the `prepare*` / `execute*` pairs that split a destructive verb around its confirmation. The engine beneath them is `@internal`
and reached by file, not from the barrel.

---

## Gotchas

**Forge keeps the migration history, not wrangler.** No verb runs `wrangler d1 migrations apply` or writes wrangler's history table. `deploy` is the
one reader: it reads the table an entry's `migrations_table` names, `d1_migrations` by default, and refuses a migration recorded there that forge
never applied. `migrations_dir` and `migrations_pattern` are read only to check they name forge's files. The two
`_forge_*` tables and what each one catches are [`DATABASE_MANAGEMENT.md`][dm-4] §4.

**A `--target remote` run needs a real `database_id`.** A missing one, or the placeholder, refuses the run and points at
[`forge cf sync --commit`][cf-readme] rather than guessing.

**`--json` owns stdout.** Progress lines, confirmations and warnings go to stderr under it, so the document on stdout is parseable whole.

**Scratch databases live under `.forge/scratch/`.** Compose, rehearsal and backup verification are what build them; `--to` applies against the real
home.

**A drop that followed a file leaving `config/db.ts` names the file that declared it**, so the refusal is attributable rather than unexplained
([`SCHEMA_COMPOSITION.md`][sc-3] §3).

---

## See also

- [`DATABASE_MANAGEMENT.md`][dm] — every ruling this surface implements: forward-only, targets and homes, the undo per place, the companion tables,
  the lint rules, the seed contract, declared positions, and the CI gate
- [`SCHEMA_COMPOSITION.md`][sc] — what `migrate compose` decides: ownership, alter versus rebuild, renames, the stamp and the snapshot
- [`DATABASE_BACKUPS.md`][bk] — the artifact, the proof before it is written, the data format and its limits, and what restore and reset check
- [`@y-core/forge/tooling/cli`][cli-readme] — the command framework, the `confirm` prompt every destructive verb asks through, and the config-module
  loader that reads `config/db.ts`
- [`@y-core/forge/tooling/cf`][cf-readme] — `forge cf sync --commit`, which provisions the `database_id` a `--target remote` run requires
- [`STORAGE_BINDINGS.md`][sb-1] §1 — the typed D1 client a Worker reads the same database through at runtime

[bk]: ../../../docs/DATABASE_BACKUPS.md
[bk-1]: ../../../docs/DATABASE_BACKUPS.md#1-the-artifact
[bk-3]: ../../../docs/DATABASE_BACKUPS.md#3-a-remote-backup-is-a-read
[bk-5a]: ../../../docs/DATABASE_BACKUPS.md#5a-what-a-backup-costs-and-the-size-it-stops-suiting
[bk-6]: ../../../docs/DATABASE_BACKUPS.md#6-restore-and-reset
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
[dm-9b]: ../../../docs/DATABASE_MANAGEMENT.md#9b-the-migration-contract
[sb-1]: ../../../docs/STORAGE_BINDINGS.md#1-storagedb--d1-database-client
[sc]: ../../../docs/SCHEMA_COMPOSITION.md
[sc-3]: ../../../docs/SCHEMA_COMPOSITION.md#3-ownership
[sc-4]: ../../../docs/SCHEMA_COMPOSITION.md#4-what-compose-emits
[sc-5]: ../../../docs/SCHEMA_COMPOSITION.md#5-renames
[sc-6]: ../../../docs/SCHEMA_COMPOSITION.md#6-the-stamp-the-snapshot-and-the-two-checks
