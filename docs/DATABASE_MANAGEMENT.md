---
title: Database Management
description: "D1 migrations composed from declared schema files and applied forward-only: the targets and their undo, the companion tables, the lint rules, seeds, the host config, backups."
audience: consumer
---

# Database Management

> Owns what `@y-core/forge/tooling/db` decides on a consumer's behalf through `forge db`: that migrations are forward-only and generated from a
> declared schema, what the undo is for each place a database can live, the companion tables forge keeps beside the app's own and the history
> it owns outright, what the migration linter refuses, what makes a seed idempotent, how a library's declared schema reaches an app without being
> copied into it, and what a backup artifact must be for a restore to mean anything.
>
> Defers to: [`SCHEMA_COMPOSITION.md`][sc] for how a declared schema becomes the migration this document applies — ownership, what compose emits,
> the stamp and the snapshot; [`DATABASE_BACKUPS.md`][db] for the artifact whole — what it holds, the proof both routes pass, the data format and
> its limits, and what a restore and a reset check before they act; [`src/tooling/db/README.md`][db-readme] for the command tree, every flag, every
> worked invocation and every export; [`STORAGE_BINDINGS.md`][sb-1] §1 for the runtime D1 client a Worker reads the same database through;
> [`NAMESPACES.md`][namespaces-5g] §5g for why this surface is a `tooling` namespace and never Worker-reachable; [`BUILD_TOOLING.md`][bt-1c] §1c for
> the exit contract every verb reports through.

---

## 0. Quick Reference

- §1 Forward-Only Migrations: why no migration has a Down, and what replaces one
- §2 Targets and Homes: the `place[:database]` grammar, the places, and where each one's state lives
- §2a Standby — a Second Local Database: what it is for, why it is generated rather than checked in, and the one verb that rebuilds it
- §3 The Undo, Per Place: a Time Travel bookmark on a deployed database, reset-and-restore locally, and a backup from any place
- §4 The Companion Tables: the two tables forge keeps, why their names begin `_forge_`, and that forge owns the migration history outright
- §4a `_forge_migrations` — The Migration History: what each column holds, the states status reports, and what a NULL fingerprint means
- §4c `_forge_seed_history` — What Has Been Seeded: a seed that already ran, and one that was edited since
- §5 The Migration Lint Rules: what each rule matches and why, and the compose warning that never aborts
- §6 Applying: the lock, the `--to` cut, and the status gate
- §6a The Apply Lock: one apply per home at a time
- §6c `status --check` Exit Conditions: exactly what makes the gate fail
- §6d Check, then Apply: an edited history, a pending migration compose did not write, a moved fingerprint and a mis-stamped migration each refuse
  the apply, and how the body and its history row reach the database together
- §6e Who Else Holds the Database to Its Fingerprint: the one drift read, what each verb does with it, and why `schema check`, `restore` and `reset`
  are not on the list
- §6f Rehearsing Against Real Rows: the pending migrations applied to a copy restored from a backup, before the target is touched
- §7 The Seed Contract: keyed by directory and name, hashed over raw text, refused when it changed, off the deployed database without a places line,
  and guarded there like a migrate
- §7a Migration or Seed: a migration carries schema only, a change that needs data is add, fill, tighten, and a seed that changes the schema is
  refused
- §7b A Generated Fixture Seed: rows in memory emitted as SQL, proved against the declared schema, and what the generator refuses
- §8 Every Position Is Declared: the host config names every file forge reads, and nothing else is read
- §9 The CI Gate: the two lines that belong before a deploy, and why neither covers the other
- §9a The Deploy Verb: `forge db deploy` checks, applies under a bookmark, then deploys, and what it refuses
- §9b The Migration Contract: each pending file applied to a scratch copy of the target's schema and diffed, every drop or rename refused without
  the line compose wrote for it, and the lint rules that remain
- §9c Recovering From a Torn Deploy: a failed apply, and a deploy that failed after the apply

---

## 1. Forward-Only Migrations

**A migration has no Down, and forge ships nothing that would run one.** A migration file is SQL that moves the schema forward; reversing it is a
new migration, numbered above it.

**A migration is generated from the desired state, and never written by hand.** Each declared file declares what its schema _is_ in one `schema.sql`
([`SCHEMA_COMPOSITION.md`][sc-2] §2), and `forge db migrate compose` writes the migration that takes the migrations already on disk to it —
replaying them into a real SQLite first, diffing the result, and proving the emitted SQL on that replay before the file exists. A file compose did
not write is refused before anything runs (§9b), and the rows a change needs come from a seed or the app, never from a migration (§7a).

The reason is that a Down is a claim nothing verifies. It is written when the Up is written, against a schema in the author's head, and it is
exercised for the first time on the day the database is already in trouble — where a Down that drops the column it added also drops the rows written
into it since. Cloudflare D1 offers a real undo for the case the Down was for, and it operates on the whole database rather than on one author's
guess about one statement (§3).

Consequences a consumer acts on:

- **A migration that has been applied is never edited.** Its bytes are checksummed at apply time, and editing the file makes
  `forge db migrate status` report `mismatch` until the file is put back or the database is rebuilt (§4a).
- **A migration is numbered above every migration already applied.** A pending file numbered below an applied one is refused before anything runs,
  naming the file to renumber: applying it would land it after a migration composed against a history that did not include it.
- **Anything destructive is refused until its line approves it** (§9b): compose writes no drop and no rename until `--allow-destructive <digest>`
  says the plan was read (`SCHEMA_COMPOSITION.md` §4), and every verb that applies the file refuses one its lines do not approve.

---

## 2. Targets and Homes

Every verb takes `--target place[:database]`, and the places are the table below. The default is `local`. The optional `:database` names the
`d1_databases` entry when the wrangler config declares more than one; `--db <binding|database_name>` is the same choice spelled as a flag. A config
declaring several databases and a run naming none is refused rather than resolved to the first entry.

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

**`forge db standby reset` is the one verb that builds one**, and it is these steps in order: empty the state directory, apply every migration,
apply every seed. `--target` defaults to `standby` here rather than the shared `local`, because the verb refuses every other place by name — a
`--target local` is a typo rather than an instruction. `--no-seed` stops after the migrations, `--dir <seeds>` narrows the seeding to one directory,
and `--yes` skips the confirmation a non-interactive run needs.

**The wipe is on the way in, and nothing wipes on the way out.** An exit path can be skipped — a killed run, a crashed server, an interrupted gate —
so a caller whose determinism depended on the previous run having cleaned up is exactly the ambient state this verb ends.

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

Before the bookmark, a `migrate` checks the database against its own record and refuses one whose schema moved since the last apply certified its
fingerprint, and nothing passes that refusal: restore the database (§6d).

**The cheapest undo is not needing one:** `forge db migrate --rehearse` applies the pending migrations to a copy restored from a backup artifact
first, so a migration that only fails on real rows fails on the copy (§6f).

**On `local` and `standby`, the undo is a verified backup and a reset.** Time Travel does not exist off Cloudflare, so the sequence is explicit and
in separate verbs rather than one: back up, reset, restore. The README spells the invocation.

`reset` is the only verb that empties a database, and it does so by removing miniflare's state files rather than by deleting rows. It refuses to run
against a database that holds rows and has no verified backup that still describes those rows ([`DATABASE_BACKUPS.md`][db-6] §6). It also demands
the database be named back to it, so a stale `--target` cannot aim it at the wrong one.

**The undo halves do not cross, and `backup` reads any place.** `forge db backup --target remote` gives a deployed database a verified artifact that
outlives Time Travel's thirty days: it is taken read-only and proven into a local scratch ([`DATABASE_BACKUPS.md`][db-3] §3). `restore` and `reset`
stay refused for `remote` and `preview`, where Time Travel is the undo, and `bookmark` is refused for `local` and `standby`, which have no Time
Travel to read.

---

## 4. The Companion Tables

Forge keeps two tables of its own beside the app's, each `STRICT`, each created on first use.

| Table | Holds | Catches |
| --- | --- | --- |
| `_forge_migrations` | One row per applied migration: its name, its checksum, when it ran, and the schema fingerprint it certified | A migration edited after it was applied, and a schema that changed without one |
| `_forge_seed_history` | One row per applied seed, identified by its directory and name | A seed that already ran, and one edited since it ran |

**The names begin `_forge_`, matching the platform's own `_cf_*`.** A leading underscore is how D1 already marks a table as the platform's rather
than the app's, so forge spells its own the same way and a reader needs one convention instead of two. The prefix is what keeps both tables out of
the schema fingerprint (§4a), out of what compose reads as the app's schema (`SCHEMA_COMPOSITION.md` §3), and out of what a backup treats as an app
table ([`DATABASE_BACKUPS.md`][db-4] §4).

**Forge owns the migration history outright.** No verb runs `wrangler d1 migrations apply` or writes wrangler's `d1_migrations` table, and none
special-cases it. Only `deploy` reads it, as the table an entry's `migrations_table` names, to refuse a migration wrangler recorded that forge never
applied. Wrangler remains the transport and nothing more — `d1 execute`, `d1 export` and `d1 time-travel` are what every verb here spawns.

That has one consequence worth acting on: a database carrying a `d1_migrations` table reads it as one of the **app's** own tables, because nothing
gives that name special treatment. It enters the schema fingerprint, compose sees an object no declared schema declares and plans a drop for it, and
a backup carries its rows. Drop it before bringing such a database under `forge db`.

### 4a. `_forge_migrations` — The Migration History

Forge writes the history row itself, in the same load as the migration body (§6d), so there is one record of what ran rather than two to reconcile.

| Column | Holds |
| --- | --- |
| `id` | `INTEGER PRIMARY KEY`. Apply order, and the column `ORDER BY id DESC LIMIT 1` reads |
| `name` | The file name without `.sql`. This is the identity, carried as a unique index rather than as the key |
| `sha256` | SHA-256 of the file's bytes with its `forge:compose` stamp blanked, so a `--restamp` is not an edit |
| `applied_at` | Epoch milliseconds. `STRICT` has no `TIMESTAMP`, so the instant is an `INTEGER` and every reader formats it |
| `fingerprint` | The schema fingerprint this migration left behind, or `NULL` |

**`id` is never `AUTOINCREMENT`.** A backup restores keys from the artifact, and an engine-allocated key would need `sqlite_sequence` carried with
it — the same hazard the `autoincrement` lint rule refuses on an app table (§5). Forge's own table does not get to break the rule it enforces.

**The identity is `name`, carried as a unique index rather than as the primary key.** The index is what makes a duplicate migration name a hard
failure: two files of the same name fail at apply time on it, as a raw SQLite unique-constraint error rather than a forge message. A compose-time
rule would say it better and there is not one yet.

**A `NULL` fingerprint is a fact, not a missing value:** the migration was applied, and no apply has certified the schema since. It is what a run
that applied its last migration and then failed before certifying leaves behind, and `forge db migrate status` reports it — while still exiting zero
on that clause, since nothing about the schema is known to be wrong (§6c).

`forge db migrate status` compares this table against the files on disk into the states a reader must act on:

| State | Means |
| --- | --- |
| `pending` | On disk, with no history row |
| `mismatch` | Applied, and the file now hashes differently |
| `drift` | A history row with no file on disk |

A `drift` row aborts an apply outright: forge will not apply over a history it cannot read. The refusal names each drifted migration; a file deleted
rather than checked out is the common cause.

**The schema fingerprint rides on the last row.** It is a SHA-256 over the app's own schema objects as `sqlite_master` declares them, sorted, with
every object whose name begins `_forge_`, `sqlite_` or `_cf_` excluded. Databases built from the same migrations fingerprint the same, so a
fingerprint that moved without a migration is DDL someone ran by hand. Only an apply certifies one, with an `UPDATE` on the row `ORDER BY id DESC`
selects — which is why a database with **zero** applied migrations can hold no fingerprint at all: there is no row for the `UPDATE` to land on, and
the apply says so rather than reporting a certification that did not happen.

The fingerprint rules — which objects count, how they sort, what one line spells — have one home, `src/storage/db/schema.ts`, which `tooling/db`
imports. A Worker reads the same clause through `checkSchemaHealth` in `storage/db` ([`STORAGE_BINDINGS.md`][sb-1f] §1f), so the CLI and the runtime
cannot judge one schema two ways.

**The migrations digest is computed, never stored.** It is a SHA-256 over the ordered `(name, sha256)` pairs — derived from the rows above and from
the files on disk alike, so there is no stored rollup that can drift from what it summarises. It is one of the facts a backup artifact binds
itself to ([`DATABASE_BACKUPS.md`][db-4] §4) and the key compose caches a replayed baseline under (`SCHEMA_COMPOSITION.md` §7).

**Seed history stays a table of its own, rather than a `type` column here.** Migration history is forward-only and is the record that makes an
edited-after-applied file detectable at all; seed history is deliberately deleted by `seed reset` (§4c). Merging them would put that `DELETE` one
`WHERE` clause away from the integrity record, to save one table with single-digit rows.

### 4c. `_forge_seed_history` — What Has Been Seeded

One row per seed: `source`, the directory that declared it, its name, the SHA-256 of its **raw** file text, and when it ran — keyed by `(source,
name)` as a unique index over a synthetic `id`. The contract it enforces is §7's, and why it is not merged into the migration history is §4a's.

`forge db seed reset` deletes every row here and nothing else — the rows the seeds themselves wrote stay where they are, and every seed simply runs
again on the next apply.

---

## 5. The Migration Lint Rules

`forge db lint` checks the migrations the target does not hold yet — `local` by default — and takes no file arguments (§9b). The same rules run
before every apply, and over every migration compose emits — a finding there is a forge bug and the file is not written. Comments, string literals
and quoted identifiers are masked before matching, so a rule fires on code and never on prose inside a comment or on a column called
`"delete from"`; a `CREATE TRIGGER … BEGIN … END;` is one statement, so the `BEGIN` inside it is not a transaction.

| Rule | Matches | Why |
| --- | --- | --- |
| `drop-no-if-exists` | `DROP TABLE`, `INDEX`, `VIEW` or `TRIGGER` without `IF EXISTS` — except the `DROP TABLE` of a rebuild that just copied the table into `_forge_new_<name>` | It fails the whole migration when the object is already gone |
| `unbounded-update` | `UPDATE … SET` with no `WHERE` in the statement — an upsert's `DO UPDATE SET` is not one | It rewrites every row in the table |
| `unbounded-delete` | `DELETE FROM` with no `WHERE` in the statement | It empties the table |
| `virtual-table` | `CREATE VIRTUAL TABLE` | `wrangler d1 export` throws on a virtual table, leaving the database unbackupable |
| `autoincrement` | `AUTOINCREMENT` | A backup restores keys from the artifact, and an engine-allocated key needs `sqlite_sequence` carried with it ([`DATABASE_BACKUPS.md`][db-5] §5) |
| `explicit-transaction` | A statement that is `BEGIN`, `COMMIT`, `ROLLBACK` or `END` | The load of a migration is already one transaction (§6d), and a nested one fails |
| `attach-database` | `ATTACH` or `DETACH` | D1 is one database |
| `add-column-not-null-no-default` | `ADD COLUMN … NOT NULL` with no `DEFAULT` | SQLite refuses it outright |
| `add-column-non-constant-default` | `ADD COLUMN` whose `DEFAULT` is `CURRENT_TIME`, `CURRENT_DATE`, `CURRENT_TIMESTAMP` or a parenthesised expression | SQLite refuses it |
| `add-column-constrained` | `ADD COLUMN … PRIMARY KEY` or `… UNIQUE` | SQLite refuses it; a constrained column is a rebuild |
| `alter-column-unsupported` | `ALTER COLUMN` in an `ALTER TABLE` | D1's SQLite has no `ALTER COLUMN`; changing a column is a rebuild, which compose emits. SQLite 3.53's `SET NOT NULL` / `DROP NOT NULL` is the exception once D1 ships it |
| `pragma-unsupported` | `PRAGMA foreign_keys`, in any form | D1 always enforces foreign keys and ignores the pragma, so the author believes something false; only `defer_foreign_keys` relaxes them, inside a transaction (`SCHEMA_COMPOSITION.md` §4) |
| `pragma-unsupported` | Any `PRAGMA` outside D1's supported set: `table_list`, `table_info`, `table_xinfo`, `index_list`, `index_info`, `index_xinfo`, `quick_check`, `foreign_key_check`, `foreign_key_list`, `case_sensitive_like`, `ignore_check_constraints`, `legacy_alter_table`, `recursive_triggers`, `reverse_unordered_selects`, `optimize`, `defer_foreign_keys` | D1 refuses it with `SQLITE_AUTH`, so the migration fails where it runs |
| `table-too-wide` | A `CREATE TABLE` of more than 100 columns, table constraints not counted | D1 refuses a table that wide (`D1_LIMITS.columns`, `STORAGE_BINDINGS.md` §1h); compose also refuses a declared table that wide, which catches an `ADD COLUMN` |
| `generated-edited` | A file with no `forge:compose` stamp, or one whose stamp's `body` hash differs from the file below it | Compose writes every migration (§9b); edit `schema.sql` and compose again |

`generated-edited` is what holds every migration to compose. It is an **error** because the whole composer rests on it: were DDL able to reach the
database without passing through a declaration, an object the declarations do not describe could exist, and compose could not read an object's
absence from `schema.sql` as a deletion ([`SCHEMA_COMPOSITION.md`][sc-3] §3).

**Every rule is an error and aborts any apply.** `forge db lint --seeds` runs `seed-insert-not-idempotent`, `unbounded-update`, `unbounded-delete`
and `attach-database`, every one an error too (§7). Compose's own warnings (`SCHEMA_COMPOSITION.md` §4) are a channel of their own beside the lint
findings: printed with the plan, never aborting, and carried in the JSON outcome as `warnings`.

---

## 6. Applying

`forge db migrate` applies every pending migration in name order, each as one load (§6d). These rulings shape what a run covers:

**`--to <NNNN|name>` cuts the pending set.** It names either a migration's number or its name, and a name matching nothing is refused with the list
of what is on disk. The migrations left over are reported as left for a later run.

**Only the pending files are linted.** A library migration that has been applied for a year must not newly abort every apply in every consuming app
because a lint rule was added since.

### 6a. The Apply Lock

An apply takes a lock at `<home>/.forge/db-apply.lock` holding the pid that took it and the time it was taken, and releases it however the run ends.
A second apply against the same home is refused while the lock is held and names the pid and the time, so a concurrent run cannot interleave
statements with one already in flight. A lock older than an hour is treated as left behind by a dead process and taken over: the taker renames the
file aside, which is atomic, so of two takers only one gets it, and it checks what it renamed is the lock it judged stale before writing its own — a
fresh lock written in between is put back and the taker refuses. Without an OS lock the moment between that rename and the check is the only window
left. The lock is per checkout: two machines applying to the same remote database are not excluded from each other.

The lock is taken against the app's own home, never against a generated one: it keys on the home's directory, and one under `.forge/scratch/` would
exclude nothing.

**A seed takes the same lock, for every target including a deployed one.** The file excludes nothing inside D1, but the runs it excludes are two
local processes: a seed whose pending-migration check passed before a concurrent migration committed would otherwise write rows during that
migration's `CREATE`/`INSERT…SELECT`/`DROP`/`RENAME` rebuild, and rows written after the copy and before the drop are lost — with the seed recorded
as applied, so a re-run skips it.

### 6c. `status --check` Exit Conditions

`forge db migrate status --check` exits non-zero when any of these holds, and zero otherwise:

- a migration is `pending`;
- a migration is `mismatch` — applied, and its file now hashes differently;
- a migration is `drift` — applied, with no file on disk;
- a fingerprint is certified and does not match the schema as it now stands;
- migrations are applied and no fingerprint was ever certified — the `NULL` case of §4a.

**The last clause and the line `status` prints about it say the same thing.** A reader is told that migrations are applied and nothing has certified
a schema over them, and that the next apply certifies one; CI reads the exit code and nothing else, so a line asking for an apply under an exit
meaning _nothing to do_ would be read by neither. It is where a database lands after a restore over the migrations route, and after an apply whose
certifying write failed on its own — one `forge db migrate` clears it, with no flag: with nothing pending the apply certifies the schema as it
stands, because no earlier fingerprint exists for it to contradict, and a fingerprint that does contradict one stays refused (§6d).

A declared file edited and never composed is not this check's to catch — it is `forge db schema check`'s, which reads files, needs no database,
and says which path moved (`SCHEMA_COMPOSITION.md` §6).

A Worker reads the fingerprint clause as a report, never as an exit code or a refused request ([`STORAGE_BINDINGS.md`][sb-1f] §1f). It has no files,
no wrangler, no apply lock and no undo, so it cannot repair what it finds, and refusing to serve over a stray index would turn a warning into an
outage. The repair is `forge db migrate`.

### 6d. Check, then Apply

`forge db migrate` reads `_forge_migrations` before it plans anything and holds the database against it. Each check is a refusal that names its own
repair:

1. **An edited history.** An applied migration whose file does not hash to the `sha256` its history row recorded. The hash covers the file with its
   `forge:compose` stamp blanked, so an edit to the stamp line alone — a `--restamp` — is not an edit. Restore the file from version control, or
   reset the database. There is no override.
2. **A migration compose did not write.** A pending file with no `forge:compose` stamp, or one whose stamp's `body` digest does not match the file,
   is refused before anything is applied, naming each file (§9b). Change `schema.sql` and compose again. There is no override.
3. **A moved fingerprint.** The newest certified fingerprint — the newest row whose `fingerprint` is not `NULL`, so the rows a part-applied batch
   left uncertified are read past — is not the fingerprint of the schema as it now stands. Inspect with `forge db migrate status`; there is no
   override, so restore the database to the bookmark the last apply printed, or reset and restore it locally. A database where no row ever certified
   one is not refused here: `status --check` reports it, and an apply with nothing pending certifies it (§6c).
4. **A mis-stamped migration.** A pending generated migration whose stamp's baseline is not the digest of the files before it on disk — composed
   against a different history, which a merge of two branches produces (`SCHEMA_COMPOSITION.md` §6). Compose again, or
   `forge db migrate compose --restamp <name>`. One already applied here only warns, and one past the `--to` cut is not checked.
5. **An unapproved drop or rename.** The pending files are applied to a scratch copy of the target's schema and every drop or rename is paired with
   its file's lines (§9b); an unpaired one refuses, naming it.

**DDL run by hand is not the only thing that moves a fingerprint.** A batch that part-applied — a migration whose body committed while its history
row did not — leaves the schema ahead of the last row that certified anything, and reads exactly like hand-run DDL, because at the database there is
no difference between them. The refusal names both, and the resume of a part-applied batch is the bookmark it printed (§3), restored before running
again.

**`--dry-run` predicts all of it without writing.** It evaluates every check against the same record the real run reads, the analysis included,
and reports what it would apply — so a dry run's refusal is exactly the real run's.

**A migration's body and its history row reach the database together.** Each migration is staged under `.forge/scratch/migrate/` as one file — the
migration's SQL, then the `INSERT INTO _forge_migrations` that records it — and loaded with `wrangler d1 execute --file`. Locally that file is one
transaction, so the migration and its record commit together or neither does. Seeds take the same path with their own record statement (§7), which
is why there is one apply mechanism here and not two.

**Against `--remote` that file is not one transaction, and this is the one place a deployed apply can tear.** A deployed migration body can commit
without the `INSERT` that records it. The rerun then sees the migration as pending and re-applies a body that has already run, failing on whatever
it already created; the `INSERT` is a plain `INSERT` rather than an `INSERT OR REPLACE`, so nothing papers over the gap quietly. **The recovery is
the bookmark the run printed** (§3): restore to it, then run again. There is no verb that reconstructs the missing row, and there deliberately is
not one — a row written from the file alone would assert that the body ran, which is the very thing in doubt.

**The fingerprint is certified after the batch, in a statement of its own.** A crash between the last migration and that `UPDATE` leaves the last
history row with a `NULL` fingerprint — reported, not failed (§4a), and certified by the next apply.

### 6e. Who Else Holds the Database to Its Fingerprint

**The fingerprint is not `migrate`'s alone.** The comparison is one rule — read the newest certified fingerprint, hash the schema as it stands, say
whether they agree — and every verb that opens the target reaches it through `schemaDrift`. What differs is what each verb does with the answer,
which follows from what the verb does to the database:

| Verb | On a mismatch | Why that and not the other |
| --- | --- | --- |
| `forge db migrate` | Refuses; nothing passes it | It is the verb that can explain the schema, so it is the one that insists |
| `forge db seed` | Refuses; nothing passes it | A seed writes rows into whatever schema is there, and the check is held early (§7) |
| `forge db backup` | Says so, records the state in `manifest.json`, and takes the backup | An artifact of a drifted database is still worth having ([`DATABASE_BACKUPS.md`][db-4] §4) |

**`forge db schema check` is not on that list, and stays off it.** It reads files and opens no database, which is what lets it run in a checkout, in
a library repository with no database at all, and in a pre-merge job. A pipeline that wants both answers runs `forge db schema check` and
`forge db migrate status --check`; the second is the one that reads a database (§6c).

`restore` and `reset` are also absent, and for a different reason: neither compares against a live schema worth holding. A restore is refused unless
the target holds no rows and rebuilds the schema itself from the artifact's migrations, then compares what it built against the manifest's digests
(`DATABASE_BACKUPS.md` §6); a reset discards the database, under a guard — a verified artifact whose row digests still match — that is strictly
stronger than a fingerprint. A refusal in either would be one nobody could act on.

### 6f. Rehearsing Against Real Rows

**`forge db migrate --rehearse` applies the pending migrations to a copy of real data first.** Every other check reads a schema, and compose's
proof holds only one synthetic row per table ([`SCHEMA_COMPOSITION.md`][sc-4] §4). A statement that fails only on particular values — a `NOT NULL`
over NULLs, a `UNIQUE` over duplicates — passes all of them and fails on the target.
A rehearsal restores a backup artifact into a throwaway database under `.forge/scratch/rehearse/`, applies the pending migrations to it and reports,
**before the confirmation, under the lock** — so one that fails leaves the target untouched, naming the migration it stopped on and what the
database said. `--rehearse` takes the most recent verified backup of this database and `--artifact <dir>` names one instead; a deployed target is
refused, having no local scratch to restore into, and a dry run rehearses nothing. The artifact must have been taken with exactly the migrations
this target has applied — one taken earlier or later is refused, naming the difference — so the rehearsal runs the pending files over the schema
they will meet. Take a backup first.

The scratch starts with the target's own history, because the artifact carries the `_forge_migrations` rows rather than rebuilding them
([`DATABASE_BACKUPS.md`][db-4] §4). The pending migrations are then applied to it and recorded on top, exactly as they would be against the target,
so a rehearsal that fails names the migration it stopped on by reading the same table an apply would.

---

## 7. The Seed Contract

A seed is a `.sql` file in one of the directories the host config's `seeds` names (§8), or in the one `--dir` names instead. These rules make a seed
run safely more than once:

- **The directory and the name are the identity.** They key `_forge_seed_history` together, so two directories may ship one name, and renaming a
  seed — or the directory that declares it — makes it a new seed. `--only` takes `<dir>:<name>`, and refuses a bare name two directories both hold.
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
older schema is either an error or a row in the wrong shape. Run `forge db migrate` first. There is no `-- forge:requires` line naming a migration —
the pending check already knows.

**It refuses a schema that moved without one, too** (§6e). A certified fingerprint that is not the schema as it stands says the rows a seed is about
to write are aimed at a shape nothing described. Both checks run before the lint, the confirmation and the first load, so a refusal leaves nothing
written rather than stopping partway through the set.

**A deployed `seed apply` carries the same guards as `migrate`** (§3, §5): it confirms before the first seed unless `--yes` said so, it captures a
Time Travel bookmark and prints the restore command as the undo (`--no-bookmark` skips it), and it refuses any lint finding, on every place. `local`
and `standby` ask nothing and capture nothing. A seed and its history row are loaded as one file, so a crash cannot leave a seed applied and
unrecorded — and since seeds are idempotent by contract, a re-run is always safe.

`forge db seed status --check` exits non-zero while any seed would run or has changed, which is the gate spelling; an `excluded` seed counts as
neither. There is no `seed apply --dry-run`, because `seed status` is that verb.

Seeds are ordinary SQL, so idempotence within one file is the author's: write `INSERT OR IGNORE`, or `INSERT … ON CONFLICT DO NOTHING`, rather than
relying on the history table to be the only guard. `seed-insert-not-idempotent` names an `INSERT` with none of them, and these migration rules run
over a seed as well — `unbounded-update`, `unbounded-delete` and `attach-database` (§5). Every seed rule is an error: `seed apply` refuses a finding
on every place before anything is loaded, and `forge db lint --seeds` exits non-zero on one. A seed's drop needs no rule of its own, because the
schema check refuses it (§7a).

### 7a. Migration or Seed

**A migration carries schema and nothing else.** Every row the database needs is written by a seed or by the app, so a change that needs data is
these steps in order, each of which the previous Worker survives:

1. **Add.** Compose adds the new shape so the rows already there satisfy it: a new table, or a column that is nullable or carries a constant
   `DEFAULT`. Compose refuses a `NOT NULL` column with no `DEFAULT` on a table that exists, so this step is never skipped.
2. **Fill.** A seed, or the app, writes the data: a backfill is an `UPDATE … WHERE` over the rows still unfilled, and a lookup table the code reads
   is `INSERT OR IGNORE` rows in a seed. A fill that must reach a deployed database names the places on its first line —
   `-- forge:places local,standby,preview,remote` — because a seed with no places line stays off it (§7). `seed apply` refuses while a migration
   is pending, so the fill always lands on the shape the add put there.
3. **Tighten or remove.** A later compose makes the column `NOT NULL`, gives it its `CHECK`, or drops what the fill replaced. A tightening is a
   rebuild over rows the fill must already satisfy — compose warns that it depends on them, and `--rehearse` (§6f) proves it on a copy of real rows.
   A removal is a drop, approved by the line compose writes for it (§9b).

**`_forge_seed_history` is what makes a fill run once per database.** Each database records the seeds applied to it, by directory and name, with
the hash of the file's text (§4c). A fill therefore applies once to every target it reaches and is skipped there afterwards, and a fill edited
since it ran is refused rather than run again until `--rerun` says so.

**A row is environment content when it may differ by place**: development users, sample posts, an admin whose address differs by place. It may
be re-run, and it is never what makes the deployed database correct. It is a seed with no places line, or one naming only the places it belongs to.

**A seed changes no schema, and that is checked by effect before the seed reaches the target.** Before `seed apply` or `standby reset` loads a
pending seed, the seed is loaded, expanded as it will be, into the scratch copy of the target's schema that the migration analysis builds (§9b),
and it is refused — naming it and what changed — when the schema after differs from the schema before. The copy holds no rows, so a seed that
only writes data can fail there where the target would not: a `FOREIGN KEY` to a parent row only the target holds, or a value looked up from a
row the copy lacks. **So the check runs the seed one statement at a time, and passes over a statement only when a row constraint stops it and it
writes no schema.** The statements are cut by wrangler's exported `unstable_splitSqlQuery`, the splitter forge's in-process D1 handle already
applies to every local load and the one `wrangler d1 execute --local` cuts a file with, so the copy runs the statements a local target runs. They
run over one handle opened in this process through wrangler's `getPlatformProxy`, each statement its own batch, so no statement costs a process.
A statement the copy refuses with `SQLITE_CONSTRAINT_FOREIGNKEY`, `SQLITE_CONSTRAINT_UNIQUE`, `SQLITE_CONSTRAINT_NOTNULL` or
`SQLITE_CONSTRAINT_CHECK` is passed over only when the program the copy compiles it to, read with `EXPLAIN`, creates, drops or reloads no schema
object and leaves the schema cookie alone, since a statement that only writes rows leaves the schema as it was whether it ran or not. A schema
statement the copy's rows stop is refused, naming it: a `CREATE UNIQUE INDEX` over duplicates the seed wrote fails on the copy, yet runs on a
target where an earlier statement removed them. An `EXPLAIN` that fails, or answers no program, refuses the seed as well. **Any other error on
the copy refuses the seed, naming the statement** — a syntax error first among them, because a statement cut where the target would not cut it
fails there, and passing it over would hide the schema change the target then applies. So a `DROP` later in a seed is never hidden behind an
`INSERT` that failed before it, and a valid seed is never refused for a row only the target holds.

### 7b. A Generated Fixture Seed

**`composeSeedFixture` writes a seed from rows held in memory, and there is no CLI verb for it** — the rows are TypeScript literals in the
consumer's own build script and cannot reach a flag. It exists so a fixture is never hand-typed `INSERT` text: a statement built by concatenation is
indistinguishable at its call site from one built from a literal, and the newline encoding forge's artifact writer owns then has a second home to
drift from.

What it does, in order: reads the declared schema into a scratch database of its own (`fixture`, kept apart from the two `migrate compose` caches so
a regeneration can never empty a database a cached model was built against, and forced to `local` so no target a caller resolved is reachable),
reads each named table's columns in `cid` order, emits one single-line `INSERT OR IGNORE` per row, loads the whole text, and counts what arrived.

It refuses, each naming what to change:

- **A path outside every declared seeds directory (§8), or one not ending `.sql`** — a seed forge does not read is a file nothing applies.
- **A table the declared schema does not create.**
- **A row missing a column the schema declares**, naming the table and the columns. An authored key the schema does not declare is the other way
  round: it is reported in the outcome and not emitted, because nothing has to be edited for a drop.
- **A `${VAR}` or `${VAR:-default}` anywhere in the emitted text.** `seed apply` would substitute it (§7), so a fixture carrying one does not say
  what it appears to say. The scan is for the expander's own pattern rather than for a bare `${`: anything it would not substitute, it would also
  not refuse.
- **A load the schema rejects** — a `CHECK` or a foreign key, named by the constraint that refused the row. Foreign keys are asserted on first,
  since a scratch database with them off would prove nothing.
- **A loaded count below the authored count**, which is a duplicate key `OR IGNORE` swallowed. This is what buys back what `OR IGNORE` costs, and it
  is also the only check that covers a statement the file never emitted.

**The bytes are stable across runs**: no generated-at header and no version stamp, because a stamp would change the file's hash every release and
`seed apply` would report the seed as `changed`. Composing the same rows twice gives the same `sha256`, which is what makes "regenerate, then expect
an empty diff" a usable check in a consumer's gate.

---

## 8. Every Position Is Declared

**The host config — a `db.ts` in the app's `config/` directory — names every file `forge db` reads, and nothing else is read.** An installed package
contributes no DDL to your database because it happens to ship some; it contributes DDL because the app asked for it, by path, in a file a reviewer
can see.

It declares these positions: the desired-state files in load order, the seeds directories in run order, the one migrations directory, where the
composed snapshot lives, and where backups go. The fields, their defaults and a worked `db.ts` are the README's; `DbHostConfig` in
`src/tooling/db/types.ts` is authoritative over both ([`SOURCE_OF_TRUTH.md`][sot] §2a).

**These rulings hold whatever the fields say.** `schemas` is ordered and loaded into one empty database, so a file with a `FOREIGN KEY` comes after
the file declaring the table it points at. And **every path is resolved against the root**, the `migrations` directory included, so they read one
way instead of several — an app that keeps its migrations elsewhere names the directory here. `migrations_table` in a `d1_databases` entry is read
only by `deploy`, which refuses a migration recorded there that forge never applied. A verb refuses an entry whose `migrations_dir` is not forge's
directory, or whose `migrations_pattern` is not that directory's `*.sql`, so `wrangler d1 migrations` and forge never apply two sets of files. A
path starting with `@` is a package specifier, resolved through its package's exports as the app installed it.

The file itself is optional, and an app with none declares nothing: `compose` and `schema check` say so and name what to write.

**There is no namespace.** Nothing is discovered from a `package.json`, so nothing needs a second name to be discovered _as_; a path names itself,
and it is the name a refusal, the snapshot and `status` all use. Files that declare one table name each other by path. The companion tables carry
no namespace column either: `_forge_migrations` is keyed on the migration's file name (§4a), and `_forge_seed_history` records the declaring
directory in `source` (§4c).

**A library publishes a desired state and no SQL that runs.** The app composes one migration sequence of its own from every declared schema
([`SCHEMA_COMPOSITION.md`][sc-1] §1), and nothing is copied in or renamed on the way: what forge records is the file name the app wrote. A
library change that needs data takes the sequence of §7a across its releases: one whose `schema.sql` adds the shape, a CHANGELOG entry naming the
fill the consumer's seed or app writes, and a later one that tightens it.

**`forge db schema check`** is the gate over the declared schemas (`SCHEMA_COMPOSITION.md` §6), and what the bare `forge db schema` runs. There is
no verb that prints the declarations as one document: a file is read by opening it, and a concatenation of files nothing consumes is another
rendering of the schema to keep in step with the rest.

**A library generates nothing beside its `schema.sql`.** A checkout that declares a schema and composes no migration has no snapshot and needs
none: there is no history to remember and nothing to hold in step. `forge db schema check --replay` in that checkout loads the declarations into a
throwaway D1 and fails when the DDL does not execute — which is the whole of what a library can check about itself, and the gate row worth having.

---

## 9. The CI Gate

**These lines belong in CI, before the deploy step:**

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
a column no migration has applied is the failure they catch, and the build is the last cheap place to catch it. `dbSteps()` from
`@y-core/forge/tooling/gate` is the first line as gate rows, with the lint every consumer would otherwise have to remember: the digest check
in `quality`, and `forge db lint` and `--replay` — a real replay into a scratch database — in `full`. An app already on the shared Worker
table takes the same rows from `cloudflareWorkerSteps({ db: true })` rather than appending the builder itself.

### 9a. The Deploy Verb

**`forge db deploy` is the Workers Builds deploy command.** It runs the order the CI lines describe as one verb, so no pipeline can deploy code
ahead of its schema. It resolves the deployed database (`--target remote` by default), then:

1. Refuses, applying and deploying nothing, on a migration applied but missing from disk, one edited since it was applied, a fingerprint that moved
   outside the migrations, a `d1_migrations` row forge never applied (someone ran `wrangler d1 migrations apply`), or a pending migration compose
   did not write (§6d).
2. Refuses a pending migration whose drops and renames its own lines do not approve, one to one (§9b).
3. Applies each pending migration under a Time Travel bookmark, as `forge db migrate --target remote` does — asking first, so a non-interactive
   run passes `--yes` (§9b) — and runs `wrangler deploy` with `-c`/`-e`. A token Cloudflare refuses names `Account → D1 → Edit` and deploys
   nothing; refused at the first write, the error says nothing was applied, and refused later, that the migrations before it may be.

A pending migration is not a refusal. `--check-only` stops after step 2 and exits 1 when anything is pending, for a team that keeps the apply a
human step; `forge cf sync --commit` notes that D1 write access is unverified unless it created a database.

### 9b. The Migration Contract

**A migration is judged by what it does to the target's schema, never by reading its SQL.** The analysis is Atlas's
[`migrate lint`](https://atlasgo.io/versioned/lint): apply the pending files to a scratch copy of the target's schema, diff the schema after each
file, and refuse any drop or rename compose did not write an approval line for. These rules govern it, and no flag or option passes any of them:

- **The target is the only reference.** `lint`, `migrate`, `deploy` and `standby reset` each compare against the schema of the database the run
  resolved, read from that database. A run that cannot resolve its target, or cannot read it, refuses; no replay of the history stands in for it.
- **Compose writes every migration.** A pending file with no compose stamp, or one whose stamp's body digest fails, is refused before anything
  runs, naming the file to compose. A hand edit passes only when it is exactly what compose wrote.
- **No override sidesteps a refusal.** The developer resolves it — by composing again, by approving the drop in compose, or by restoring the
  database.
- **Lint judges exactly the files the target does not hold yet**, the ones absent from its `_forge_migrations`.

**The scratch copy is built from the target's own `sqlite_master`.** The analysis reaches the target the way every verb does — the persisted state
of `local` and `standby`, wrangler against `database_id` for `remote` and `preview_database_id` for `preview` — and recreates its schema on a fresh
local D1 under `.forge/scratch/`, from each object's stored SQL: tables first, then indexes, views and triggers. It skips an index with no SQL,
which SQLite made for a `UNIQUE` or `PRIMARY KEY` and the table's own SQL recreates; every `sqlite_*`, `_cf_*` and `_forge_*` object; and the
wrangler history table the entry's `migrations_table` names. The before model is read from the copy rather than from the target, so both sides of
every diff are read by one SQLite in one way. An empty local database is a valid target with nothing to copy. A target that cannot be resolved or
read refuses, and so does one holding a virtual table, which no model describes.

**Compose's replay of the history is not a second reference.** `forge db migrate compose` opens no target: it writes a file, and replaying the
files on disk ([`SCHEMA_COMPOSITION.md`][sc-1] §1) proves that the file takes that history to the declared schema, which is a property of the file.
Whether the file is safe to land is asked of each database it lands on, by this analysis, against that database's schema.

**One diff per file is enough, once the file's renames are applied to its before side.** A rename is the only way compose moves rows from one
name to another, and with each `forge:renames` line applied first, every name the diff compares holds on both sides the rows it held on the
target; a rebuild's `INSERT … SELECT` names every column the table keeps. So a file loses no data its own before-and-after diff cannot see.
The views, triggers and indexes compose drops and recreates around a rebuild hold no rows, and one present on both sides of the file is not
dropped.

**What the diff finds**, following Atlas's [analyzers](https://atlasgo.io/lint/analyzers): a destructive finding loses rows, and an incompatible
one breaks the previous Worker, which keeps serving between the migrate step and the deploy step.

| The diff shows | Finding | Atlas |
| --- | --- | --- |
| A table present before the file and absent after it | destructive | DS102 |
| A column absent after the file whose `hidden` is not `2` — an ordinary column or a `STORED` generated one — whether the table was altered or rebuilt | destructive | DS103 |
| A `VIRTUAL` generated column (`hidden` `2`) absent after the file | incompatible | — |
| A view absent after the file | incompatible | — |
| A table or a column a `forge:renames` line renames | incompatible | BC101, BC102 |
| An index or a trigger absent after the file | none | — |

A virtual column and a view hold no rows, so dropping one destroys nothing and is not destructive; a running Worker may still read either, so it is
incompatible. **Every finding refuses on every target until its line approves it** — `local` and `standby` as much as `remote` and `preview`.

**The analysis applies a file's renames to its before side, then diffs**, as compose applied `--rename` to its replayed baseline before diffing
against the declared schema. Each `forge:renames` line renames its table or column in the before model, in the order the lines appear, and the model
is diffed against the one read after the file runs on the copy. The rename is made in the model rather than on a second copy because every finding
depends only on an object's name, the table a column belongs to and the column's `hidden`, which a rename in the model carries exactly. A rename is
a finding because its line names it, and nothing pairs a drop with an add. A line whose old name is not there, or whose new name already is,
refuses, naming the line.

**So a rename that reuses the old name yields one rename finding and no drop.** A file that renames `users` to `accounts` and creates a new
`users` diffs `accounts` against `accounts` and finds `users` created; the column form — `posts.body` renamed to `content`, and a new `body` —
finds `body` added. Every other drop is judged against the renamed model, so a column dropped from a table the same file renames is a destructive
finding of its own.

**The approval is a line compose writes, inside the body its stamp digest covers.** `--allow-destructive <digest>` on compose is the only
approval: compose asks for it whenever its plan holds a finding of either kind, the digest covers the plan with its renames, and once it matches,
compose writes one line per finding directly under the header:

```sql
-- forge:drops table "legacy_events"
-- forge:drops column "posts"."summary"
-- forge:drops view "post_counts"
-- forge:renames table "users" "accounts"
-- forge:renames column "posts"."body" "content"
```

A `forge:drops` line names its kind as `table`, `column` or `view`; a `forge:renames` line names `table` or `column`, then the old name and the
new. Every name is a double-quoted SQL identifier with any `"` inside it doubled, a column is `"table"."column"`, and a renamed column's new name
is the column alone, since it keeps its table. A `forge:renames` line names its objects as they stand once the lines above it have run, and a
`forge:drops` line names them as they stood before the file. Names match as SQLite resolves them, without regard to ASCII case. **Lines
and findings match one to one**: a finding with no line refuses, and so does a `forge:drops` line with no finding. A line added or changed by
hand fails the stamp digest and is refused as an unstamped file is. Atlas's own approval, `-- atlas:nolint`, annotates a statement or a file;
forge's is per object, because the analysis diffs whole files and has no statement to point at.

**`forge db lint` needs a target like every other verb**, `local` by default, and judges exactly the files absent from that target's history: the
stamp, the rules below, and the analysis. It takes no file arguments. On an empty local database every file is pending, and a file the target
already holds is held by its recorded checksum instead (§6d).

**Every lint rule is an error, in migration lint and seed lint alike.** Compose refuses its own output on any lint error, so a rule that compose's
correct output trips cannot become an error and is deleted instead: `table-rebuild` and `unique-index-on-existing-table`, whose risk — a rebuild or
a new `UNIQUE` index over rows that break it — is what `--rehearse` (§6f) is for. `drop-column` and `rename` are deleted because the analysis judges
both by effect, and the rule against tables in a hand-written migration because compose writes every one. The `PRAGMA foreign_keys` form of
`pragma-unsupported` is an error like the rest of its rule. The migration rules kept are `generated-edited`, which refuses a file with no compose
stamp as well as an edited one, `drop-no-if-exists`, `unbounded-update`, `unbounded-delete`, `virtual-table`, `autoincrement`,
`explicit-transaction`, `attach-database`, `add-column-not-null-no-default`, `add-column-non-constant-default`, `add-column-constrained`,
`alter-column-unsupported`, `pragma-unsupported` and `table-too-wide`. A seed is held to `seed-insert-not-idempotent`, `unbounded-update`,
`unbounded-delete` and `attach-database`; `drop-no-if-exists` leaves the seed set, because a seed that drops anything is refused by the schema check
(§7a). With no warning left, `lint --strict` has nothing to add and does not exist.

**Applying anywhere but `local` asks first**, and the prompt lists the pending files with every finding in them — each already approved by its
line, or the run would have refused. A non-interactive run passes `--yes` or is refused; `deploy` asks exactly as `migrate` does. `--yes`
confirms what the contract allows and passes no refusal.

**Nothing reads migration SQL to find a drop, and nothing bypasses the contract.** There is no text classifier in `deploy` and no lint-warning
arithmetic standing in for an approval, no hand-written migration, and no flag or option field that skips lint, passes a warning, accepts drift,
seeds onto pending migrations or approves a drop outside its file. `--allow-unbacked` on `forge db reset` stays: reset applies no migration and
writes no schema, it runs only on `local` and `standby`, and the flag is the developer's statement that a database is disposable, which no analysis
could make for them.

**There is no pre-contract history to bring under it**: the contract holds every migration file from the release that ships it, with no baseline
verb, no legacy origin and no exemption list, because no app holds a history it would refuse.

### 9c. Recovering From a Torn Deploy

**A failed apply** (§6d): restore to its `undo:` bookmark with `forge db bookmark restore`, fix the cause, deploy again. **A failed deploy after
the apply** leaves the new schema under the old Worker, which §9b keeps safe: fix the deploy and rerun it, which only deploys.

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
[sc-4]: ./SCHEMA_COMPOSITION.md#4-what-compose-emits
[sot]: ./SOURCE_OF_TRUTH.md#2a-package-and-configuration-facts
