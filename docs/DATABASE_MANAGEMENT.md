---
title: Database Management
description: "D1 migrations composed from declared schema files and applied forward-only: the targets and their undo, the companion tables, the lint rules, seeds, the host config, backups."
audience: consumer
---

# Database Management

> Owns what `@y-core/forge/tooling/db` decides on a consumer's behalf through `forge db`: that migrations are forward-only and generated from a
> declared schema, what the undo is for each of the four places a database can live, the three tables forge keeps beside the app's own, what the
> migration linter refuses, what makes a seed idempotent, how a library's declared schema reaches an app without being copied into it, and what a
> backup artifact must be for a restore to mean anything.
>
> Defers to: [`SCHEMA_COMPOSITION.md`][sc] for how a declared schema becomes the migration this document applies — ownership, what compose emits,
> the stamp and the snapshot; [`src/tooling/db/README.md`][db-readme] for the command tree, every flag and every export;
> [`STORAGE_BINDINGS.md`][sb-1] §1 for the runtime D1 client a Worker reads the same database through; [`NAMESPACES.md`][namespaces-5g] §5g for why
> this surface is a `tooling` namespace and never Worker-reachable; [`BUILD_TOOLING.md`][bt-1c] §1c for the exit contract every verb reports
> through.

---

## 0. Quick Reference

- §1 Forward-Only Migrations: why no migration has a Down, and what replaces one
- §2 Targets and Homes: the `place[:database]` grammar, the four places, and where each one's state lives
- §2a Standby — a Second Local Database: what it is for and why it is generated, not checked in
- §3 The Undo, Per Place: a Time Travel bookmark on a deployed database, reset-and-restore locally, and a backup from any place
- §4 The Companion Tables: the three tables forge keeps, and what each one catches
- §4a forge_migrations — Per-Migration Checksums: an applied migration whose file changed
- §4b forge_schema_meta — Digest and Fingerprint: a schema that moved without a migration
- §4c forge_seed_history — What Has Been Seeded: a seed that already ran, and one that was edited since
- §5 The Migration Lint Rules: the eighteen rules, their levels, when a level aborts, and the compose warning that never does
- §6 Applying: the lock, the `--to` cut, and the status gate
- §6a The Apply Lock: one apply per home at a time
- §6b Every Apply Goes Through a Synthesised Config: why a `--to` cut runs from a generated directory
- §6c `status --check` Exit Conditions: exactly what makes the gate fail
- §6d Repair, then Check: an unrecorded checksum is recorded from the file, then an edited history, a moved fingerprint and a mis-stamped migration
  each refuse the apply
- §6e Rehearsing Against Real Rows: the pending migrations applied to a copy restored from a backup, before the target is touched
- §7 The Seed Contract: keyed by directory and name, hashed over raw text, refused when it changed, off the deployed database without a places line,
  and guarded there like a migrate
- §7a Migration or Seed: where a row belongs
- §8 Every Position Is Declared: the host config names every file forge reads, and nothing else is read
- §9 Backup Artifacts: a pointer to [`DATABASE_BACKUPS.md`][db], which owns the artifact whole
- §10 Consumer Scripts and the CI Gate: the nine scripts, and the two lines that belong before a deploy

---

## 1. Forward-Only Migrations

**A migration has no Down, and forge ships nothing that would run one.** A migration file is SQL that moves the schema forward; reversing it is a
new migration, numbered above it.

**A migration is generated from the desired state, and hand-written only for data.** Each declared file declares what its schema _is_ in one
`schema.sql` ([`SCHEMA_COMPOSITION.md`][sc-2] §2), and `forge db migrate compose` writes the migration that takes the migrations already on disk
to it — replaying them into a real SQLite first, diffing the result, and proving the emitted SQL on that replay before the file exists. A
hand-written migration is for the step compose cannot express, a data move, and is written under `compose --custom` so lint knows it is meant to be
one (`SCHEMA_COMPOSITION.md` §7).

The reason is that a Down is a claim nothing verifies. It is written when the Up is written, against a schema in the author's head, and it is
exercised for the first time on the day the database is already in trouble — where a Down that drops the column it added also drops the rows written
into it since. Cloudflare D1 offers a real undo for the case the Down was for, and it operates on the whole database rather than on one author's
guess about one statement (§3).

Three consequences a consumer acts on:

- **A migration that has been applied is never edited.** Its bytes are checksummed at apply time, and editing the file makes
  `forge db migrate status` report `mismatch` until the file is put back or the database is rebuilt (§4a).
- **A migration is numbered above every migration already applied.** A pending file numbered below an applied one is refused before anything runs,
  because wrangler would apply it out of order.
- **Anything destructive is a lint finding, not a matter of taste** (§5). `DROP COLUMN` in particular is a warning rather than an error only because
  there is a legitimate use of it, and never because the data comes back. Compose refuses to write a drop at all until
  `--allow-destructive <digest>` says the plan was read (`SCHEMA_COMPOSITION.md` §4).

---

## 2. Targets and Homes

Every verb takes `--target place[:database]`, and `place` is one of four. The default is `local`. The optional `:database` names the `d1_databases`
entry when the wrangler config declares more than one; `--db <binding|database_name>` is the same choice spelled as a flag. A config declaring
several databases and a run naming none is refused rather than resolved to the first entry.

| Place | Which database | Where its state is | Written by |
| --- | --- | --- | --- |
| `local` | The app's own development database | `.wrangler/state` beside the wrangler config | miniflare, on this machine |
| `standby` | A second local database (§2a) | `.forge/standby/<database>/` | miniflare, on this machine |
| `remote` | The deployed database | Cloudflare | D1 |
| `preview` | The deployed preview database | Cloudflare | D1 |

**`remote` and `preview` are refused while the id is not a real one.** A `database_id` (or `preview_database_id` for `preview`) that is missing,
empty, or still a placeholder aborts the run with the command that provisions it — `forge cf sync --commit` — rather than letting wrangler create
something unasked.

### 2a. Standby — a Second Local Database

`standby` is a second local database with the app's own migrations, reachable without a second checked-in wrangler config: forge generates one under
`.forge/standby/<database>/` and points wrangler at it. It exists so a migration, a restore or a seed can be rehearsed at full size against
something that is not the database the developer is working in — nothing a standby run does can reach the live local state, because the generated
config carries its own `--persist-to`.

The generated config is marked as generated, is not read by the Worker, and is safe to delete. `.forge/` as a whole is scratch: `standby/`,
`scratch/` and `backups/` all live under it.

---

## 3. The Undo, Per Place

**The undo is a property of the place, not of the migration.**

**On `remote` and `preview`, the undo is D1 Time Travel.** Before every deployed apply, forge captures a bookmark and prints it as the command that
returns to it:

```bash
forge db bookmark restore --target remote --bookmark <bookmark>
```

That line is printed before the first statement runs, and printed again if the apply throws part-way. `forge db bookmark info` captures the same
point on demand — for now, or for `--timestamp <ISO 8601 or Unix timestamp>` — and `--no-bookmark` skips the capture, which is the only way to run a
deployed apply with no undo recorded. A Time Travel restore discards every write since the point it returns to, so it asks before it acts unless
`--yes` says otherwise.

Before the bookmark, a `migrate` checks the database against its own record and refuses one whose schema moved since the last apply recorded its
fingerprint — `--allow-drift` is the way past that refusal, and the apply then re-records the fingerprint (§6d).

**The cheapest undo is not needing one:** `forge db migrate --rehearse` applies the pending migrations to a copy restored from a backup artifact
first, so a migration that only fails on real rows fails on the copy (§6e).

**On `local` and `standby`, the undo is a verified backup and a reset.** Time Travel does not exist off Cloudflare, so the sequence is explicit:

```bash
forge db backup                                   # a verified artifact of the current state
forge db reset --expect <database>                # remove the local state files
forge db restore --artifact .forge/backups/<dir>  # load the artifact into the empty database
```

`reset` is the only verb that empties a database, and it does so by removing miniflare's state files rather than by deleting rows. It refuses to run
against a database that holds rows and has no verified backup that still describes those rows, unless `--allow-unbacked` says the database is
disposable; `--backup <dir>` names the artifact to rely on instead of the most recent verified one ([`DATABASE_BACKUPS.md`][db-6] §6). `--expect` is
required so a stale `--target` cannot aim it at the wrong database.

**The undo halves do not cross, and `backup` reads any place.** `forge db backup --target remote` gives a deployed database a verified artifact that
outlives Time Travel's thirty days: it is taken read-only and proven into a local scratch ([`DATABASE_BACKUPS.md`][db-3] §3). `restore` and `reset`
stay refused for `remote` and `preview`, where Time Travel is the undo, and `bookmark` is refused for `local` and `standby`, which have no Time
Travel to read.

---

## 4. The Companion Tables

Forge keeps three tables of its own beside the app's, each `STRICT`, each created on first use. Their names all begin `forge_`, which is what keeps
them out of the schema fingerprint and marks them as the toolchain's rather than the app's.

| Table | Holds | Catches |
| --- | --- | --- |
| `forge_migrations` | One checksum per applied migration, identified by its name | A migration edited after it was applied, and one applied without forge |
| `forge_schema_meta` | `migrations_digest` and `schema_fingerprint` | A schema that changed without a migration |
| `forge_seed_history` | One row per applied seed, identified by its directory and name | A seed that already ran, and one edited since it ran |

### 4a. forge_migrations — Per-Migration Checksums

Wrangler's own migrations table records that a migration ran. It does not record what ran, so a file edited after the fact still reads as applied.
`forge_migrations` records the SHA-256 of each migration's bytes as it is applied, and `forge db migrate status` compares the three sources — the
migrations table, this table, and the files on disk — into four states a reader must act on:

| State | Means |
| --- | --- |
| `pending` | On disk, not in the migrations table |
| `mismatch` | Applied and recorded, and the file now hashes differently |
| `unrecorded` | In the migrations table with no forge checksum — applied by wrangler directly |
| `drift` | In the migrations table, with no file on disk |

A `drift` row aborts an apply outright: forge will not apply over a history it cannot read. The refusal names each drifted migration; a file deleted
rather than checked out is the common cause.

**It is two columns, `applied_name` and `sha256`, and nothing else.** The applied name wrangler recorded is what joins the two tables and keeps the
database self-describing in a fresh clone or a restored artifact, and it is the primary key, so the table carries no index of its own. Everything
else a bookkeeping row might hold is already recorded by the other half: `d1_migrations` holds the name and the time it was applied, and repeating
either here would be one fact in two places with nothing keeping them equal.

A database written by a forge before this one carries the older five-column shape and has no upgrade path — pre-1.0 ships no shims. Re-create a
local one; a deployed database in that state is out of scope.

### 4b. forge_schema_meta — Digest and Fingerprint

Two keys, written by every apply:

- **`migrations_digest`** — SHA-256 over every applied migration's applied name and bytes, in order. It changes when the set of applied files
  changes, and it is one of the three facts a backup artifact binds itself to ([`DATABASE_BACKUPS.md`][db-4] §4).
- **`schema_fingerprint`** — SHA-256 over the app's own schema objects as `sqlite_master` declares them, sorted, with every object whose name is the
  migrations table or begins `forge_`, `sqlite_` or `_cf_` excluded. Two databases built from the same migrations fingerprint the same, so a
  fingerprint that has moved without a migration is DDL someone ran by hand.

Only the fingerprint is checked by `status`, and only when one has been recorded — a database migrated before forge managed it has no recorded
fingerprint and is reported rather than failed.

The fingerprint rules — which objects count, how they sort, what one line spells — have one home, `src/storage/db/schema.ts`, which `tooling/db`
imports and re-exports. A Worker reads the same clause through `checkSchemaHealth` in `storage/db` ([`STORAGE_BINDINGS.md`][sb-1f] §1f), so the CLI
and the runtime cannot judge one schema two ways.

### 4c. forge_seed_history — What Has Been Seeded

One row per seed: `source`, the directory that declared it, its name, the SHA-256 of its **raw** file text, and when it ran — keyed by `(source,
name)` as a unique index over a synthetic `id`, because a backup's keyset read orders by one column. The contract it enforces is §7's.

**It stays a table of its own, rather than a `type` column on `forge_migrations`.** Migration history is forward-only and is the record that makes
an edited-after-applied file detectable at all; this one is deliberately deleted by `seed reset`. Merging them would put that `DELETE` one `WHERE`
clause away from the integrity record, to save one table with single-digit rows.
`forge db seed reset` deletes every row here and nothing else — the rows the seeds themselves wrote stay where they are, and every seed simply runs
again on the next apply.

---

## 5. The Migration Lint Rules

`forge db lint` checks every migration in the migrations directory, or just the files named as arguments. The same rules run before an apply unless
`--no-lint` says otherwise, and over every migration compose emits — a finding there is a forge bug and the file is not written. Comments, string
literals and quoted identifiers are masked before matching, so a rule fires on code and never on prose inside a comment or on a column called
`"delete from"`; a `CREATE TRIGGER … BEGIN … END;` is one statement, so the `BEGIN` inside it is not a transaction.

| Rule | Level | Matches | Why |
| --- | --- | --- | --- |
| `drop-no-if-exists` | error | `DROP TABLE`, `INDEX`, `VIEW` or `TRIGGER` without `IF EXISTS` — except the `DROP TABLE` of a rebuild that just copied the table into `_forge_new_<name>` | It fails the whole migration when the object is already gone |
| `unbounded-update` | error | `UPDATE … SET` with no `WHERE` in the statement — an upsert's `DO UPDATE SET` is not one | It rewrites every row in the table |
| `unbounded-delete` | error | `DELETE FROM` with no `WHERE` in the statement | It empties the table |
| `virtual-table` | error | `CREATE VIRTUAL TABLE` | `wrangler d1 export` throws on a virtual table, leaving the database unbackupable |
| `autoincrement` | error | `AUTOINCREMENT` | A backup restores keys from the artifact, and an engine-allocated key needs `sqlite_sequence` carried with it ([`DATABASE_BACKUPS.md`][db-5] §5) |
| `explicit-transaction` | error | A statement that is `BEGIN`, `COMMIT`, `ROLLBACK` or `END` | wrangler wraps each migration in its own transaction, and a nested one fails |
| `attach-database` | error | `ATTACH` or `DETACH` | D1 is one database |
| `add-column-not-null-no-default` | error | `ADD COLUMN … NOT NULL` with no `DEFAULT` | SQLite refuses it outright |
| `add-column-non-constant-default` | error | `ADD COLUMN` whose `DEFAULT` is `CURRENT_TIME`, `CURRENT_DATE`, `CURRENT_TIMESTAMP` or a parenthesised expression | SQLite refuses it |
| `add-column-constrained` | error | `ADD COLUMN … PRIMARY KEY` or `… UNIQUE` | SQLite refuses it; a constrained column is a rebuild |
| `alter-column-unsupported` | error | `ALTER COLUMN` in an `ALTER TABLE` | D1's SQLite has no `ALTER COLUMN`; changing a column is a rebuild, which compose emits. SQLite 3.53's `SET NOT NULL` / `DROP NOT NULL` is the exception once D1 ships it |
| `drop-column` | warning | `DROP COLUMN` in an `ALTER TABLE` | It discards the column's data, and a migration is forward-only |
| `rename` | warning | `RENAME` in an `ALTER TABLE`, except the rename that puts a `_forge_new_` table into place | A deployed Worker still reads the old name between the migrate step and the deploy step |
| `unique-index-on-existing-table` | warning | `CREATE UNIQUE INDEX` on a table this file did not create from nothing — a rebuilt table counts as existing, since its rows were copied | It fails when two existing rows collide |
| `table-rebuild` | warning | `CREATE TABLE` of a `_forge_new_` table | Every row is copied — rehearse on `standby` first for a large deployed table |
| `pragma-ignored` | warning | Any `PRAGMA` but `defer_foreign_keys` | D1 ignores it, so the author believes something false — `foreign_keys = OFF` in particular does nothing (`SCHEMA_COMPOSITION.md` §4) |
| `generated-edited` | error | A `forge:compose` stamp whose `body` hash differs from the file below it | The file was edited after compose wrote it; edit `schema.sql` and compose again |
| `custom-ddl` | error | `CREATE`, `ALTER` or `DROP TABLE` in a custom migration — one stamped `forge:custom`, or one carrying no stamp at all | Every table in the database comes from `schema.sql` and compose; a custom migration moves data |

A file with neither stamp is a custom migration: there is no third origin, so `custom-ddl` applies to it as it does to a stamped one. It is
an **error** rather than a warning because the whole composer rests on it: were DDL able to reach the database without passing through a
declaration, an object the declarations do not describe could exist, and compose could not read an object's absence from `schema.sql` as a
deletion ([`SCHEMA_COMPOSITION.md`][sc-3] §3).

**An error aborts any apply. A warning aborts a deployed apply only**, and `--allow-warnings` lets one through after it has been read; against a
local database a warning is logged and the apply proceeds. `forge db lint --strict` fails on a warning too, which is the spelling for a gate.
`forge db lint --seeds` runs the seed rule and, at warning level, `unbounded-update`, `unbounded-delete`, `drop-no-if-exists` and `attach-database`
(§7). Compose's own warnings (`SCHEMA_COMPOSITION.md` §4) are a fourth channel beside errors, warnings and `--strict`: printed with the plan, never
aborting, and carried in the JSON outcome as `warnings`.

---

## 6. Applying

### 6a. The Apply Lock

An apply takes a lock at `<home>/.forge/db-apply.lock` holding the pid that took it and the time it was taken, and releases it however the run ends.
A second apply against the same home is refused while the lock is held and names the pid and the time, so a concurrent run cannot interleave
statements with one already in flight. A lock older than an hour is treated as left behind by a dead process and taken over: the taker renames the
file aside, which is atomic, so of two takers only one gets it, and it checks what it renamed is the lock it judged stale before writing its own — a
fresh lock written in between is put back and the taker refuses. Without an OS lock the moment between that rename and the check is the only window
left. The lock is per checkout: two machines applying to the same remote database are not excluded from each other.

### 6b. Every Apply Goes Through a Synthesised Config

**Every apply goes through a synthesised config, not just a cut one.** `--to` cuts the pending set, and wrangler applies whole directories. So an
apply writes the pending set into `.forge/scratch/migrate/migrations/`, each file under the name it is applied as, alongside a generated wrangler
config whose `--persist-to` — or `database_id`, for a deployed place — still points at the real database. Nothing about the app's checked-in config
or its own migrations directory is touched, and no file is renamed on the way through.

The apply lock (§6a) is still taken against the app's own home, never the synthesised one: the lock keys on the home's directory, and one under
`.forge/scratch/` would exclude nothing.

`--to <NNNN|name>` is then a filter on that list — it names either a migration's number or its name, and a name matching nothing is refused with the
list of what is on disk. The migrations left over are reported as left for a later run.

**Only the pending files are linted.** A library migration that has been applied for a year must not newly abort every apply in every consuming app
because a lint rule was added since.

### 6c. `status --check` Exit Conditions

`forge db migrate status --check` exits non-zero when any of these holds, and zero otherwise:

- a migration is `pending`;
- any checksum comparison is non-empty — `mismatch`, `unrecorded` (applied without a forge checksum — the next `forge db migrate` records it from
  the file), or `orphaned` (recorded by forge and absent from the migrations table);
- a migration is `drift` — applied, with no file on disk;
- a `schema_fingerprint` is recorded and does not match the schema as it now stands.

A database with no recorded fingerprint passes on that clause, which is what lets a database forge did not migrate be brought under the gate without
first rebuilding it.

A declared file edited and never composed is not this check's to catch — it is `forge db schema check`'s, which reads files, needs no database,
and says which path moved (`SCHEMA_COMPOSITION.md` §6).

A Worker reads the fingerprint clause as a report, never as an exit code or a refused request ([`STORAGE_BINDINGS.md`][sb-1f] §1f). It has no files,
no wrangler, no apply lock and no undo, so it cannot repair what it finds, and refusing to serve over a stray index would turn a warning into an
outage. The repair is `forge db migrate`.

### 6d. Repair, then Check

`forge db migrate` reads the database's own record before it plans anything, and acts on it in two moves.

**The repair.** A migration the migrations table says was applied, with no `forge_migrations` row and a file on disk, is recorded from that file —
one `INSERT OR REPLACE` per migration and the `migrations_digest` beside them, in one write, after the lock is taken. This is what a run that
crashed between wrangler's apply and forge's record leaves behind, and what a database migrated before forge kept checksums looks like. The file's
hash is the only evidence there is for what ran, and it is taken as such; the `schema_fingerprint` is never written by the repair, because only an
apply can certify it — writing it here would make the next check pass on the rerun that should fail. An applied name with no file stays `drift` and
is refused as before. The run reports `recorded N: …`, and a refusal after the repair leaves those rows in place: they are true facts.

**The three checks**, each against the record as repaired, each a refusal that names its repair:

1. **An edited history.** An applied migration whose file does not hash to what `forge_migrations` recorded. The hash covers the file with its
   `forge:compose` stamp blanked, so an edit to the stamp line alone — a `--restamp` — is not an edit. Restore the file from version control, or
   reset the database. There is no override.
2. **A moved fingerprint.** A recorded `schema_fingerprint` that is not the fingerprint of the schema as it now stands — DDL run by hand since the
   last apply. Inspect with `forge db migrate status`, then `--allow-drift` applies anyway and re-records the fingerprint — and with nothing
   pending, re-records it on its own, so `status --check` is green again. A database with no recorded fingerprint passes, as under
   `status --check`. A run that records a repair does not refuse the moved fingerprint — the repaired migrations are its explanation — and
   re-records it, so a batch that failed part way is not refused forever on the rerun.
3. **A mis-stamped migration.** A pending generated migration whose stamp's baseline is not the digest of the files before it on disk — composed
   against a different history, which a merge of two branches produces (`SCHEMA_COMPOSITION.md` §6). Compose again, or
   `forge db migrate compose --restamp <name>`. One already applied here only warns, and one past the `--to` cut is not checked.

**`--dry-run` predicts all of it without writing.** It computes the repair and prints it as `would record`, evaluates the three checks against the
would-be-repaired record, and reports what it would apply — so a dry run's refusal is exactly the real run's.

**One write after the apply.** The checksums and both schema facts land in one `executeSql`, so a crash cannot leave the checksums recorded and the
digest stale, or the reverse. It rests on wrangler sending a multi-statement `--command` as one batch — measured on local D1, unverified against
`--remote`. A torn write there fails closed either way: missing rows are what the repair above rebuilds, and a stale fingerprint is the refusal that
names `--allow-drift`.

### 6e. Rehearsing Against Real Rows

**`forge db migrate --rehearse` applies the pending migrations to a copy of real data first.** Every other check reads a schema and a replay holds
no rows, so a statement that only fails on data — a `NOT NULL` over NULLs, a `UNIQUE` over duplicates — passes all of them and fails on the target.
A rehearsal restores a backup artifact into a throwaway database under `.forge/scratch/rehearse/`, applies the pending migrations to it and reports,
**before the confirmation, under the lock** — so one that fails leaves the target untouched, naming the migration it stopped on and what the
database said. `--rehearse` takes the most recent verified backup of this database and `--artifact <dir>` names one instead; a deployed target is
refused, having no local scratch to restore into, and a dry run rehearses nothing. The artifact must have been taken with exactly the migrations
this target has applied — one taken earlier or later is refused, naming the difference — so the rehearsal runs the pending files over the schema
they will meet. Take a backup first.

---

## 7. The Seed Contract

A seed is a `.sql` file in one of the directories the host config's `seeds` names (§8), or in the one `--dir` names instead. Five rules make a seed
run safely more than once:

- **The directory and the name are the identity.** They key `forge_seed_history` together, so two directories may ship one name, and renaming a seed
  — or the directory that declares it — makes it a new seed. `--only` takes `<dir>:<name>`, and refuses a bare name two directories both hold.
  `forge db seed reset --dir <dir>` forgets one directory's rows.
- **The hash is over the raw file text**, before any variable is expanded. Running the same seed on a machine whose environment differs is therefore
  not a changed seed.
- **`${VAR}` and `${VAR:-default}` are expanded by `seed apply` alone**, everywhere in the file, quoted for the context the value lands in: **inside
  a SQL string literal** a quote in the value is doubled, so it stays one literal; **outside one** the value is the SQL itself, so only an
  identifier-like token (`[A-Za-z_][A-Za-z0-9_.]*`), a number or an empty value is accepted, and anything else aborts naming the variable and the
  value — quote the placeholder in the seed. A NUL is refused either way. `seed status`, `lint --seeds` and the hash read the file as written, so
  none of them needs a variable set; an unset one refuses the apply before any seed is loaded. The expanded seed is written under
  `.forge/scratch/seed/` with mode `0600` and removed as soon as its load has run, so it never outlives the apply.
- **A seed whose file changed since it ran is refused.** `forge db seed apply` reports it as `changed`, applies nothing for it, and exits non-zero.
  `--rerun` alone re-applies every recorded seed, changed or not; `--only <dir>:<name>` narrows a run to one seed, and `--rerun --only` runs just
  the changed one again. `--only` naming a seed the place left out is refused with the `forge:places` line that would include it.
- **A seed may name the places it belongs to, and one that does not stays off the deployed database.** A first line of
  `-- forge:places local,standby` keeps the seed out of a run against any other place — the file is simply not in that run's plan, neither pending
  nor applied. A seed with no `-- forge:places` line runs on `local` and `standby` only; a deployed run lists each such seed it left out as
  `excluded`, with the line that includes it. One file keeps one history identity; a place suffix in the file name would make a second seed with its
  own row.

**Order is name order within a directory, directories in the order the host config names them** — the same order the migrations take. Number a seed
that depends on another (`0010_users.sql`, `0020_posts.sql`); nothing enforces it, because renaming a seed changes its history key and re-runs it
everywhere.

**`seed apply` refuses a database with a migration pending.** A seed is written against the schema the migrations describe, and one landing on an
older schema is either an error or a row in the wrong shape. Run `forge db migrate` first; `--allow-pending` seeds the older schema anyway. There is
no `-- forge:requires` line naming a migration — the pending check already knows.

**A deployed `seed apply` carries the same three guards as `migrate`** (§3, §5): it confirms before the first seed unless `--yes` said so, it
captures a Time Travel bookmark and prints the restore command as the undo (`--no-bookmark` skips it), and it refuses a lint warning until
`--allow-warnings` says the warning was read. `local` and `standby` ask nothing and capture nothing. A seed and its history row are loaded as one
file, so a crash cannot leave a seed applied and unrecorded — and since seeds are idempotent by contract, a re-run is always safe.

`forge db seed status --check` exits non-zero while any seed would run or has changed, which is the gate spelling; an `excluded` seed counts as
neither. There is no `seed apply --dry-run`, because `seed status` is that verb.

Seeds are ordinary SQL, so idempotence within one file is the author's: write `INSERT OR IGNORE`, or `INSERT … ON CONFLICT DO NOTHING`, rather than
relying on the history table to be the only guard. `seed-insert-not-idempotent` (a warning) names an `INSERT` with none of them — `seed apply` logs
it, and `forge db lint --seeds` fails on it under `--strict`. Four of the migration rules run over a seed as well — `unbounded-update`,
`unbounded-delete`, `drop-no-if-exists` and `attach-database` (§5) — as warnings rather than the errors they are for a migration, so an existing
seed keeps applying locally with the warning logged, and a deployed target refuses it until `--allow-warnings` says it was read.

### 7a. Migration or Seed

**A row goes in a migration when `forge db migrate --target remote` would be _incorrect_ without it**: a lookup table the code reads, a backfill a
new column needs, a move a DDL change requires. It is part of the schema's meaning, it is applied once and checksummed, and it is written under
`forge db migrate compose --custom <name>` (`SCHEMA_COMPOSITION.md` §7).

**A row goes in a seed when it is environment content**: development users, sample posts, an admin whose address differs by place. It may differ by
place, it may be re-run, and it is never what makes the deployed database correct.

---

## 8. Every Position Is Declared

**The host config — a `db.ts` in the app's `config/` directory — names every file `forge db` reads, and nothing else is read.** An installed package
contributes no DDL to your database because it happens to ship some; it contributes DDL because the app asked for it, by path, in a file a reviewer
can see.

```ts
import type { DbHostConfig } from "@y-core/forge/tooling/db";

export default {
  // Loaded in this order into one empty database, so a file with a FOREIGN KEY comes after the
  // file that declares the table it points at.
  schemas: ["node_modules/@acme/auth/schema.sql", "config/schema.sql"],
  seeds: ["config/seeds"],
} satisfies DbHostConfig;
```

| Field | What it names | Default |
| --- | --- | --- |
| `schemas` | Every desired-state file or directory, in load order | `[]` — nothing is implicit |
| `seeds` | Every seeds directory, in run order | `[]` |
| `snapshot` | Where the composed snapshot lives | `schema.snapshot.json` beside `migrations_dir` |
| `backupsDir` | Where backups go | `.forge/backups` |

The file itself is optional, and an app with none declares nothing: `compose` and `schema check` say so and name what to write. `migrations_dir`
is not here — `wrangler.jsonc` owns it, and it is the one directory every migration runs from.

**There is no namespace.** Nothing is discovered from a `package.json`, so nothing needs a second name to be discovered _as_; a path names itself,
and it is the name a refusal, the snapshot and `status` all use. Two files declaring one table name each other by path. The companion tables carry
no namespace column either: `forge_migrations` is two columns and neither is one (§4a), and `forge_seed_history` records the declaring directory in
`source` (§4c).

**A library publishes a desired state and no SQL that runs.** The app composes one migration sequence of its own from every declared schema
([`SCHEMA_COMPOSITION.md`][sc-1] §1), and nothing is copied in or renamed on the way: what wrangler records is the file name the app wrote. A
library change that needs a backfill is documented in its CHANGELOG, and the consumer writes it as `forge db migrate compose --custom`.

**`forge db schema check`** is the gate over the declared schemas (`SCHEMA_COMPOSITION.md` §6), and what the bare `forge db schema` runs. There is
no verb that prints the declarations as one document: a file is read by opening it, and a concatenation of files nothing consumes is a fourth
rendering of the schema to keep in step with the other three.

**A library generates nothing beside its `schema.sql`.** A checkout that declares a schema and composes no migration has no snapshot and needs
none: there is no history to remember and nothing to hold in step. `forge db schema check --replay` in that checkout loads the declarations into a
throwaway D1 and fails when the DDL does not execute — which is the whole of what a library can check about itself, and the gate row worth having.

---

## 9. Backup Artifacts

Moved whole to [`DATABASE_BACKUPS.md`][db]: the four files, the proof both routes pass before the artifact exists, the data format and its limits,
and what a restore and a reset check before they act.

---

## 10. Consumer Scripts and the CI Gate

The verbs are long enough to be worth naming once in `package.json`:

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

**Two lines belong in CI, before the deploy step:**

```bash
forge db schema check                    # schema.sql, its snapshot and the migrations agree
forge db migrate status --check --target remote    # the deployed database agrees with the migrations
```

**Both lines are needed, and neither covers the other**: the first is about files and the second is about a database, so one asks whether the
migrations on disk say what the declarations say, and the other whether the database has had them applied. A checkout can be internally consistent
and deployed over a database that is three migrations behind, and a database can be perfectly in step with migrations whose `schema.sql` hashes to
something other than what they were composed from.

The first fails the build when a `schema.sql` was edited and never composed, or a migration was added by hand after the last compose
(`SCHEMA_COMPOSITION.md` §6); it reads files only and takes no wrangler. The second fails it when the deployed database is not in step with the
migrations about to be deployed over it — a pending migration, an edited one, a schema that moved by hand (§6c). A deploy that ships code expecting
a column no migration has applied is the failure they catch, and the build is the last cheap place to catch it. `dbSchemaStep()` from
`@y-core/forge/tooling/gate` is the first line as two gate rows: the digest check in `standard`, and `--replay` — a real replay into a scratch
database — in `full`. An app already on the shared Worker table takes the same pair from `cloudflareWorkerSteps({ db: true })` rather than appending
the builder itself.

A destructive verb asks before it acts, so any of them in a non-interactive run needs `--yes`, and a run without a terminal that did not pass it is
refused rather than assumed.

[bt-1c]: ./BUILD_TOOLING.md#1c-errors-carry-a-kind-not-an-exit-code
[db]: ./DATABASE_BACKUPS.md
[db-3]: ./DATABASE_BACKUPS.md#3-a-remote-backup-is-a-read
[db-4]: ./DATABASE_BACKUPS.md#4-self-contained-and-bound
[db-5]: ./DATABASE_BACKUPS.md#5-the-data-format
[db-6]: ./DATABASE_BACKUPS.md#6-restore-and-reset
[db-readme]: ../src/tooling/db/README.md
[namespaces-5g]: ./NAMESPACES.md#5g-tooling--where-a-developer-facing-tool-belongs
[sb-1]: ./STORAGE_BINDINGS.md#1-storagedb--d1-database-client
[sb-1f]: ./STORAGE_BINDINGS.md#1f-schema-health
[sc]: ./SCHEMA_COMPOSITION.md
[sc-1]: ./SCHEMA_COMPOSITION.md#1-how-a-migration-is-composed
[sc-2]: ./SCHEMA_COMPOSITION.md#2-the-desired-state-file
[sc-3]: ./SCHEMA_COMPOSITION.md#3-ownership
