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

**Node-only, like every `tooling` namespace.** It shells out to `wrangler` for every statement and is never reachable from a Worker. The runtime
client a Worker reads the same database through is [`STORAGE_BINDINGS.md`][sb-1] §1.

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
forge db migrate compose add_sessions   # writes migrations/0005_add_sessions.sql and schema.snapshot.json
forge db lint --strict                  # before committing it
forge db migrate --dry-run              # the plan and the SQL, writing nothing
forge db migrate                        # run it
forge db schema check                   # file, snapshot and migrations agree
```

| `compose` flag | What it is for |
| --- | --- |
| `--dry-run` | Print the plan and the SQL; write nothing |
| `--custom` | Write a hand-edited stub instead, for a data move compose cannot express. Takes the name positionally, as compose always does |
| `--allow-destructive <digest>` | Approve the drop set whose digest the refusal printed, and no other |
| `--rename old:new` | Rename rather than drop and create; `table.old:new` for a column. Repeatable, never inferred |
| `--restamp <name>` | Rewrite a generated migration's stamp to the history now on disk, body untouched |
| `--no-cache` | Replay into the scratch database even when a cached model matches |

**A drop is refused until you name the plan.** The refusal prints the drop set and a digest of it; `--allow-destructive` accepts that digest alone,
so an approval cannot survive the plan changing underneath it. A rename is `--rename` or it is a drop — nothing here infers one. Why the emitted SQL
alters in place or rebuilds through a copy, and what a rebuild takes with it, is [`SCHEMA_COMPOSITION.md`][sc-4] §4; renames are [§5][sc-5], and the
stamp and snapshot [§6][sc-6].

A migration you filled in by hand after `--custom` is still linted and still stamped, so it joins the same sequence
([`SCHEMA_COMPOSITION.md`][sc-7] §7).

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
| `--no-lint` | Apply without the lint pass |
| `--allow-warnings` | Apply to a deployed database despite lint warnings, which otherwise abort |
| `--allow-drift` | Apply although the schema moved outside the migrations; the apply re-records the fingerprint |
| `--no-bookmark` | Skip the Time Travel bookmark a deployed apply captures |
| `--rehearse` | Apply to a copy restored from a backup first, and report, before touching the target |
| `--artifact <dir>` | The artifact `--rehearse` restores; implies `--rehearse` |

**A lint error aborts any apply; a warning aborts a deployed one.** `--allow-warnings` is what lets a deployed apply proceed past a warning that has
been read. What each rule matches, and why it sits at the level it does, is [`DATABASE_MANAGEMENT.md`][dm-5] §5.

**Rehearsing runs the pending migrations against real rows first.** `--rehearse` restores the most recent verified backup into a scratch database,
applies there, and reports — then touches the target. Worth it for a migration that rebuilds a table ([`DATABASE_MANAGEMENT.md`][dm-6f] §6f).

Lint the SQL on its own at any time:

```bash
forge db lint                    # every migration in the migrations directory
forge db lint migrations/0005_add_sessions.sql
forge db lint --seeds --strict   # the seeds instead, failing on warnings too
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
| `--allow-pending` | Seed although a migration is pending, onto the older schema |
| `--allow-drift` | Seed although the schema moved outside the migrations |
| `--allow-warnings` | Seed a deployed database despite lint warnings |
| `--no-bookmark` | Skip the Time Travel bookmark a deployed seed captures |

**Each thing that refuses a seed run has its own way past.** A file that changed since it ran needs `--rerun`; a pending migration needs
`--allow-pending`; a schema that moved since the last apply certified it needs `--allow-drift`. All are checked before the lint, the
confirmation and the first load, so a refusal leaves nothing written. The contract behind them is [`DATABASE_MANAGEMENT.md`][dm-7] §7, and where a
row belongs — migration or seed — is [§7a][dm-7a].

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

`--target` defaults to `standby` here and the verb refuses every other place. `--dir` seeds one directory, `--no-lint` skips the lint pass. What the
standby database is for, and why nothing it does can reach the local database's state, is [`DATABASE_MANAGEMENT.md`][dm-2a] §2a.

---

## Declaring what forge reads

An optional `config/db.ts` default-exports a `DbHostConfig`. Every field is optional and every one is a path relative to the root:

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

An entry in `schemas` may be a file or a directory of `.sql` files. `migrations` defaults to `migrations` and is both where migrations are read from
and where compose writes; `snapshot` defaults to `schema.snapshot.json` at the root.

**Nothing is read that this file does not name**, a dependency's schema included — [`DATABASE_MANAGEMENT.md`][dm-8] §8. The ownership rules that
follow from it are [`SCHEMA_COMPOSITION.md`][sc-3] §3.

---

## Wiring it into scripts and CI

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

Which lines belong in CI, and why neither covers the other, is [`DATABASE_MANAGEMENT.md`][dm-9] §9:

```bash
forge db schema check                             # the files agree with each other
forge db migrate status --check --target remote   # the database agrees with the files
forge db migrate --target remote --yes            # in the deploy step itself
```

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
touches a filesystem or spawns `wrangler`. `host` supplies the `config/db.ts` that would otherwise be loaded from disk.

To drive one verb without the command layer, resolve a run context first and hand it to the verb. `resolveDbContext` takes a whole
`SharedDbFlags`, so every key is present even where the value is not:

```ts
import { resolveDbContext, runMigrate } from "@y-core/forge/tooling/db";

const run = await resolveDbContext({
  target: "local",
  db: undefined,
  config: "wrangler.jsonc",
  env: undefined,
  root: undefined,
  json: false,
  yes: true,
});
const outcome = await runMigrate(run, { dryRun: true, lint: true, allowWarnings: false, allowDrift: false, bookmark: true, rehearse: false });
```

The barrel publishes one entry point per verb on this pattern — `runMigrate`, `runBackup`, `checkSchema`, `composeMigration`, `runStandbyReset`, the
lint functions, and the `prepare*` / `execute*` pairs that split a destructive verb around its confirmation. The engine beneath them is `@internal`
and reached by file, not from the barrel.

---

## Gotchas

**Forge keeps the migration history, not wrangler.** No verb runs `wrangler d1 migrations apply`, and `d1_migrations` is never read or written. A
`migrations_dir` or `migrations_table` in a `d1_databases` entry is not read at all. The two `_forge_*` tables and what each one catches are
[`DATABASE_MANAGEMENT.md`][dm-4] §4.

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
[sb-1]: ../../../docs/STORAGE_BINDINGS.md#1-storagedb--d1-database-client
[sc]: ../../../docs/SCHEMA_COMPOSITION.md
[sc-3]: ../../../docs/SCHEMA_COMPOSITION.md#3-ownership
[sc-4]: ../../../docs/SCHEMA_COMPOSITION.md#4-what-compose-emits
[sc-5]: ../../../docs/SCHEMA_COMPOSITION.md#5-renames
[sc-6]: ../../../docs/SCHEMA_COMPOSITION.md#6-the-stamp-the-snapshot-and-the-two-checks
[sc-7]: ../../../docs/SCHEMA_COMPOSITION.md#7-custom-migrations-and-the-scratch-cache
