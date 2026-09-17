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
- §2 Targets and Homes: the `place[:database]` grammar, the four places, and where each one's state lives
- §2a Standby — a Second Local Database: what it is for, why it is generated rather than checked in, and the one verb that rebuilds it
- §3 The Undo, Per Place: a Time Travel bookmark on a deployed database, reset-and-restore locally, and a backup from any place
- §4 The Companion Tables: the two tables forge keeps, why their names begin `_forge_`, and that forge owns the migration history outright
- §4a `_forge_migrations` — The Migration History: what each column holds, the three states status reports, and what a NULL fingerprint means
- §4c `_forge_seed_history` — What Has Been Seeded: a seed that already ran, and one that was edited since
- §5 The Migration Lint Rules: what each rule matches and why, when a level aborts, and the compose warning that never does
- §6 Applying: the lock, the `--to` cut, and the status gate
- §6a The Apply Lock: one apply per home at a time
- §6c `status --check` Exit Conditions: exactly what makes the gate fail
- §6d Check, then Apply: an edited history, a moved fingerprint and a mis-stamped migration each refuse the apply, and how the body and its history
  row reach the database together
- §6e Who Else Holds the Database to Its Fingerprint: the one drift read, what each verb does with it, and why `schema check`, `restore` and `reset`
  are not on the list
- §6f Rehearsing Against Real Rows: the pending migrations applied to a copy restored from a backup, before the target is touched
- §7 The Seed Contract: keyed by directory and name, hashed over raw text, refused when it changed, off the deployed database without a places line,
  and guarded there like a migrate
- §7a Migration or Seed: where a row belongs
- §7b A Generated Fixture Seed: rows in memory emitted as SQL, proved against the declared schema, and what the generator refuses
- §8 Every Position Is Declared: the host config names every file forge reads, and nothing else is read
- §9 The CI Gate: the two lines that belong before a deploy, and why neither covers the other

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

Consequences a consumer acts on:

- **A migration that has been applied is never edited.** Its bytes are checksummed at apply time, and editing the file makes
  `forge db migrate status` report `mismatch` until the file is put back or the database is rebuilt (§4a).
- **A migration is numbered above every migration already applied.** A pending file numbered below an applied one is refused before anything runs,
  naming the file to renumber: applying it would land it after a migration composed against a history that did not include it.
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
fingerprint — `--allow-drift` is the way past that refusal, and the apply then certifies the fingerprint again (§6d).

**The cheapest undo is not needing one:** `forge db migrate --rehearse` applies the pending migrations to a copy restored from a backup artifact
first, so a migration that only fails on real rows fails on the copy (§6f).

**On `local` and `standby`, the undo is a verified backup and a reset.** Time Travel does not exist off Cloudflare, so the sequence is explicit and
in three verbs rather than one: back up, reset, restore. The README spells the invocation.

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

**Forge owns the migration history outright.** No verb runs `wrangler d1 migrations apply`, and wrangler's own `d1_migrations` table is never read,
never written and never special-cased. Wrangler remains the transport and nothing more — `d1 execute`, `d1 export` and `d1 time-travel` are what
every verb here spawns.

That has one consequence worth acting on: a database carrying a `d1_migrations` table reads it as one of the **app's** own tables, because nothing
gives that name special treatment. It enters the schema fingerprint, compose sees an object no declared schema declares and plans a drop for it, and
a backup carries its rows. Drop it before bringing such a database under `forge db`.

### 4a. `_forge_migrations` — The Migration History

Forge writes the history row itself, in the same load as the migration body (§6d), so there is one record of what ran rather than two to reconcile.

| Column | Holds |
| --- | --- |
| `id` | `INTEGER PRIMARY KEY`. Apply order, and the single column a backup's keyset read and `ORDER BY id DESC LIMIT 1` both need |
| `name` | The file name without `.sql`. This is the identity, carried as a unique index rather than as the key |
| `sha256` | SHA-256 of the file's bytes with its `forge:compose` stamp blanked, so a `--restamp` is not an edit |
| `applied_at` | Epoch milliseconds. `STRICT` has no `TIMESTAMP`, so the instant is an `INTEGER` and every reader formats it |
| `fingerprint` | The schema fingerprint this migration left behind, or `NULL` |

**`id` is never `AUTOINCREMENT`.** A backup restores keys from the artifact, and an engine-allocated key would need `sqlite_sequence` carried with
it — the same hazard the `autoincrement` lint rule refuses on an app table (§5). Forge's own table does not get to break the rule it enforces.

**The identity is `name`, and it is a unique index rather than the primary key**, because a backup's keyset read orders by one column and a
composite key offers none. It is also what makes a duplicate migration name a hard failure: two files of the same name fail at apply time on the
index, as a raw SQLite unique-constraint error rather than a forge message. A compose-time rule would say it better and there is not one yet.

**A `NULL` fingerprint is a fact, not a missing value:** the migration was applied, and no apply has certified the schema since. It is what a run
that applied its last migration and then failed before certifying leaves behind, and `forge db migrate status` reports it — while still exiting zero
on that clause, since nothing about the schema is known to be wrong (§6c).

`forge db migrate status` compares this table against the files on disk into three states a reader must act on:

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
name)` as a unique index over a synthetic `id`, because a backup's keyset read orders by one column. The contract it enforces is §7's, and why it is
not merged into the migration history is §4a's.

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
| `explicit-transaction` | error | A statement that is `BEGIN`, `COMMIT`, `ROLLBACK` or `END` | The load of a migration is already one transaction (§6d), and a nested one fails |
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
certifying write failed on its own — one `forge db migrate` clears it.

A declared file edited and never composed is not this check's to catch — it is `forge db schema check`'s, which reads files, needs no database,
and says which path moved (`SCHEMA_COMPOSITION.md` §6).

A Worker reads the fingerprint clause as a report, never as an exit code or a refused request ([`STORAGE_BINDINGS.md`][sb-1f] §1f). It has no files,
no wrangler, no apply lock and no undo, so it cannot repair what it finds, and refusing to serve over a stray index would turn a warning into an
outage. The repair is `forge db migrate`.

### 6d. Check, then Apply

`forge db migrate` reads `_forge_migrations` before it plans anything, and holds the database against it three ways. Each is a refusal that names
its own repair:

1. **An edited history.** An applied migration whose file does not hash to the `sha256` its history row recorded. The hash covers the file with its
   `forge:compose` stamp blanked, so an edit to the stamp line alone — a `--restamp` — is not an edit. Restore the file from version control, or
   reset the database. There is no override.
2. **A moved fingerprint.** The newest certified fingerprint — the newest row whose `fingerprint` is not `NULL`, so the rows a part-applied batch
   left uncertified are read past — is not the fingerprint of the schema as it now stands. Inspect with `forge db migrate status`, then
   `--allow-drift` applies anyway and certifies the fingerprint again — and with nothing pending, certifies it on its own, so `status --check` is
   green again. A database where no row ever certified one is not refused here; `status --check` reports it (§6c).
3. **A mis-stamped migration.** A pending generated migration whose stamp's baseline is not the digest of the files before it on disk — composed
   against a different history, which a merge of two branches produces (`SCHEMA_COMPOSITION.md` §6). Compose again, or
   `forge db migrate compose --restamp <name>`. One already applied here only warns, and one past the `--to` cut is not checked.

**DDL run by hand is not the only thing that moves a fingerprint.** A batch that part-applied — a migration whose body committed while its history
row did not — leaves the schema ahead of the last row that certified anything, and reads exactly like hand-run DDL, because at the database there is
no difference between them. `--allow-drift` therefore carries both cases and the refusal names both: it is the flag for a schema someone changed,
and it is also how a part-applied batch is resumed. Nothing distinguishes the two for you; read `forge db migrate status` and decide.

**`--dry-run` predicts all of it without writing.** It evaluates every check against the same record the real run reads, and reports what it
would apply — so a dry run's refusal is exactly the real run's.

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
whether they agree — and every verb that opens the target reaches it through `readDrift`. What differs is what each verb does with the answer, which
follows from what the verb does to the database:

| Verb | On a mismatch | Why that and not the other |
| --- | --- | --- |
| `forge db migrate` | Refuses; `--allow-drift` applies anyway and certifies the fingerprint again | It is the verb that can explain the schema, so it is the one that insists |
| `forge db seed` | Refuses; `--allow-drift` seeds anyway | A seed writes rows into whatever schema is there. Held before the lint, the confirmation and the first load, so a schema nothing explains stops the run with nothing written rather than halfway through the set — and `--allow-drift` certifies nothing, so `migrate` goes on refusing |
| `forge db backup` | Says so, records the state in `manifest.json`, and takes the backup | An artifact of a drifted database is still worth having ([`DATABASE_BACKUPS.md`][db-4] §4) |

**`forge db schema check` is not on that list, and stays off it.** It reads files and opens no database, which is what lets it run in a checkout, in
a library repository with no database at all, and in a pre-merge job. A pipeline that wants both answers runs `forge db schema check` and
`forge db migrate status --check`; the second is the one that reads a database (§6c).

`restore` and `reset` are also absent, and for a different reason: neither compares against a live schema worth holding. A restore is refused unless
the target holds no rows and rebuilds the schema itself from the artifact's migrations, then compares what it built against the manifest's digests
(`DATABASE_BACKUPS.md` §6); a reset discards the database, under a guard — a verified artifact whose row digests still match — that is strictly
stronger than a fingerprint. A refusal in either would be one nobody could act on.

### 6f. Rehearsing Against Real Rows

**`forge db migrate --rehearse` applies the pending migrations to a copy of real data first.** Every other check reads a schema and a replay holds
no rows, so a statement that only fails on data — a `NOT NULL` over NULLs, a `UNIQUE` over duplicates — passes all of them and fails on the target.
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
older schema is either an error or a row in the wrong shape. Run `forge db migrate` first; `--allow-pending` seeds the older schema anyway. There is
no `-- forge:requires` line naming a migration — the pending check already knows.

**It refuses a schema that moved without one, too** (§6e). A certified fingerprint that is not the schema as it stands says the rows a seed is about
to write are aimed at a shape nothing described; `--allow-drift` seeds it anyway. Both checks run before the lint, the confirmation and the first
load, so a refusal leaves nothing written rather than stopping partway through the set.

**A deployed `seed apply` carries the same guards as `migrate`** (§3, §5): it confirms before the first seed unless `--yes` said so, it
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

It declares five positions: the desired-state files in load order, the seeds directories in run order, the one migrations directory, where the
composed snapshot lives, and where backups go. The fields, their defaults and a worked `db.ts` are the README's; `DbHostConfig` in
`src/tooling/db/types.ts` is authoritative over both ([`SOURCE_OF_TRUTH.md`][sot] §2a).

**These rulings hold whatever the fields say.** `schemas` is ordered and loaded into one empty database, so a file with a `FOREIGN KEY` comes after
the file declaring the table it points at. And **every path is resolved against the root**, the `migrations` directory included, so they read one
way instead of several — an app that keeps its migrations elsewhere names the directory here, and `migrations_dir` and `migrations_table` in a
`d1_databases` entry are not read at all.

The file itself is optional, and an app with none declares nothing: `compose` and `schema check` say so and name what to write.

**There is no namespace.** Nothing is discovered from a `package.json`, so nothing needs a second name to be discovered _as_; a path names itself,
and it is the name a refusal, the snapshot and `status` all use. Files that declare one table name each other by path. The companion tables carry
no namespace column either: `_forge_migrations` is keyed on the migration's file name (§4a), and `_forge_seed_history` records the declaring
directory in `source` (§4c).

**A library publishes a desired state and no SQL that runs.** The app composes one migration sequence of its own from every declared schema
([`SCHEMA_COMPOSITION.md`][sc-1] §1), and nothing is copied in or renamed on the way: what forge records is the file name the app wrote. A
library change that needs a backfill is documented in its CHANGELOG, and the consumer writes it as `forge db migrate compose --custom`.

**`forge db schema check`** is the gate over the declared schemas (`SCHEMA_COMPOSITION.md` §6), and what the bare `forge db schema` runs. There is
no verb that prints the declarations as one document: a file is read by opening it, and a concatenation of files nothing consumes is a fourth
rendering of the schema to keep in step with the other three.

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
a column no migration has applied is the failure they catch, and the build is the last cheap place to catch it. `dbSchemaStep()` from
`@y-core/forge/tooling/gate` is the first line as two gate rows: the digest check in `standard`, and `--replay` — a real replay into a scratch
database — in `full`. An app already on the shared Worker table takes the same pair from `cloudflareWorkerSteps({ db: true })` rather than appending
the builder itself.

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
[sot]: ./SOURCE_OF_TRUTH.md#2a-package-and-configuration-facts
