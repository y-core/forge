---
title: Database Management
description: "D1 migrations composed from declared schema files and applied forward-only: the targets and their undo, the companion tables, the lint rules, seeds, the host config, backups."
audience: consumer
---

# Database Management

> Owns what `@y-core/forge/tooling/db` decides on a consumer's behalf through `forge db`: that migrations are forward-only and generated from a
> declared schema, the undo for each place a database can live, the companion tables forge keeps beside the app's own, what the migration linter
> refuses, what makes a seed idempotent, and how a library's declared schema reaches an app without being copied into it.
>
> Defers to: [`SCHEMA_COMPOSITION.md`][sc] for how a declared schema becomes the migration this document applies; [`DATABASE_BACKUPS.md`][db] for
> the backup artifact whole and what a restore and a reset check before they act; [`src/tooling/db/README.md`][db-readme] for the command tree,
> the worked invocations and the exports, with `--help` on each verb for its flags; [`STORAGE_BINDINGS.md`][sb-1] §1 for the runtime D1 client a
> Worker reads the same database through; [`NAMESPACES.md`][namespaces-5g] §5g for why this surface is a `tooling` namespace and never
> Worker-reachable; [`BUILD_TOOLING.md`][bt-1c] §1c for the exit contract every verb reports through.

---

## 0. Quick Reference

- §1 Forward-Only Migrations: why no migration has a Down, and what replaces one
- §2 Targets and Homes: the `place[:database]` grammar, the places, and where each one's state lives
- §2a Standby — a Second Local Database: what it is for, why it is generated, and the one verb that rebuilds it
- §3 The Undo, Per Place: a Time Travel bookmark on a deployed database, reset-and-restore locally, and a backup from any place
- §4 The Companion Tables: the two `_forge_` tables, and that forge owns the migration history outright
- §4a `_forge_migrations` — The Migration History: the columns, the states status reports, and what a NULL fingerprint means
- §4c `_forge_seed_history` — What Has Been Seeded: a seed that already ran, and one that was edited since
- §5 The Migration Lint Rules: what each rule matches and why, and the compose warning that never aborts
- §6 Applying: the `--to` cut, and why only pending files are linted
- §6a The Apply Lock: one apply per home at a time
- §6c `status --check` Exit Conditions: exactly what makes the gate fail
- §6d Check, then Apply: what refuses an apply, how a migration and its history row reach the database together, and naming a refused local load
- §6e Who Else Holds the Database to Its Fingerprint: what each verb does with the drift read, and which verbs stay off the list
- §6f Rehearsing Against Real Rows: the pending migrations applied to a copy restored from a backup, before the target is touched
- §7 The Seed Contract: identity, hashing, variables, places, and the guards a seed run shares with a migrate
- §7a Migration or Seed: add, fill, tighten — and a seed that changes the schema is refused
- §7b A Generated Fixture Seed: rows in memory emitted as SQL, proved against the declared schema
- §8 Every Position Is Declared: the host config names every file forge reads, and nothing else is read
- §9 The CI Gate: the two lines that belong before a deploy, and why neither covers the other
- §9a The Workers Builds Deploy Command: migrate the deployed database, then `wrangler deploy`, joined so a refusal ships nothing
- §9b The Migration Contract: each pending file diffed on a scratch copy of the target's schema, and every drop or rename refused without its line
- §9c Recovering From a Torn Deploy: a failed apply, and a `wrangler deploy` that failed after the migrate

---

## 1. Forward-Only Migrations

**A migration has no Down, and forge ships nothing that would run one.** A migration file is SQL that moves the schema forward; reversing it is a
new migration, numbered above it.

**A migration is generated from the desired state, and never written by hand.** Each declared file states its schema in one `schema.sql`
([`SCHEMA_COMPOSITION.md`][sc-2] §2), and `forge db migrate compose` writes the migration that takes the migrations already on disk to it, proven
on a replay before the file exists. A file compose did not write is refused before anything runs (§9b), and the rows a change needs come from a
seed or the app, never from a migration (§7a).

The reason is that a Down is a claim nothing verifies. It is written against a schema in the author's head and exercised for the first time on the
day the database is already in trouble — where a Down that drops the column it added also drops the rows written into it since. Cloudflare D1
offers a real undo for that case, and it operates on the whole database rather than on one author's guess about one statement (§3).

Consequences a consumer acts on:

- **A migration that has been applied is never edited.** Its bytes are checksummed at apply time, and an edit makes `forge db migrate status`
  report `mismatch` until the file is put back or the database is rebuilt (§4a).
- **A migration is numbered above every migration already applied.** A pending file numbered below an applied one is refused before anything runs,
  naming the file to renumber: it would land after a migration composed against a history that did not include it.
- **Anything destructive is refused until its line approves it** (§9b), and compose writes that line only once `--allow-destructive <digest>`
  says the plan was read (`SCHEMA_COMPOSITION.md` §4).

---

## 2. Targets and Homes

Every verb takes `--target place[:database]`, defaulting to `local`. The optional `:database` names the `d1_databases` entry when the wrangler
config declares more than one. A config declaring several databases and a run naming none is refused rather than resolved to the first entry.

| Place | Which database | Where its state is | Written by |
| --- | --- | --- | --- |
| `local` | The app's own development database | `.wrangler/state` beside the wrangler config | miniflare, on this machine |
| `standby` | A second local database (§2a) | `.forge/standby/<database>/` | miniflare, on this machine |
| `remote` | The deployed database | Cloudflare | D1 |
| `preview` | The deployed preview database | Cloudflare | D1 |

**`remote` and `preview` are refused while the id is not a real one.** A `database_id` (or `preview_database_id` for `preview`) that is missing,
empty, or still a placeholder aborts the run with the command that provisions it — `forge cf sync --commit` for a `database_id`, `wrangler d1
create` for a preview database — rather than letting wrangler create something unasked.

### 2a. Standby — a Second Local Database

`standby` is a second local database with the app's own migrations, reachable without a second checked-in wrangler config: forge generates one under
`.forge/standby/<database>/` and points wrangler at it. It exists so a migration, a restore or a seed can be rehearsed at full size against
something that is not the database the developer is working in — the generated config carries its own `--persist-to`, so nothing a standby run
does can reach the live local state. The generated config is not read by the Worker and is safe to delete; `.forge/` as a whole is scratch.

**`forge db standby reset` is the one verb that builds one**: empty the state directory, apply every migration, apply every seed. It refuses every
place but `standby`, which is why its `--target` defaults there. **The wipe is on the way in, and nothing wipes on the way out**: an exit path can
be skipped — a killed run, an interrupted gate — so determinism never depends on the previous run having cleaned up.

---

## 3. The Undo, Per Place

**The undo is a property of the place, not of the migration.**

**On `remote` and `preview`, the undo is D1 Time Travel.** Before every deployed apply, forge captures a bookmark and prints the
`forge db bookmark restore` command that returns to it — before the first statement runs, and again if the apply throws part-way. `--no-bookmark`
is the only way to run a deployed apply with no undo recorded. A Time Travel restore discards every write since the point it returns to, so it asks
before it acts. Before the bookmark, a `migrate` refuses a database whose schema moved since the last certified fingerprint (§6d).

**The cheapest undo is not needing one:** `forge db migrate --rehearse` makes a migration that only fails on real rows fail on a copy (§6f).

**On `local` and `standby`, the undo is a verified backup and a reset.** Time Travel does not exist off Cloudflare, so the sequence is explicit and
in separate verbs: back up, reset, restore.

`reset` is the only verb that empties a database, and it does so by removing miniflare's state files rather than by deleting rows. It refuses a
database that holds rows and has no verified backup that still describes them ([`DATABASE_BACKUPS.md`][db-6] §6), and it demands the database be
named back to it, so a stale `--target` cannot aim it at the wrong one.

**The undo halves do not cross, and `backup` reads any place.** `forge db backup --target remote` gives a deployed database a verified artifact that
outlives Time Travel's thirty days ([`DATABASE_BACKUPS.md`][db-3] §3). `restore` and `reset` stay refused for `remote` and `preview`, where Time
Travel is the undo, and `bookmark` is refused for `local` and `standby`, which have no Time Travel to read.

---

## 4. The Companion Tables

Forge keeps two tables of its own beside the app's, each `STRICT`, each created on first use.

| Table | Holds | Catches |
| --- | --- | --- |
| `_forge_migrations` | One row per applied migration: its name, its checksum, when it ran, and the schema fingerprint it certified | A migration edited after it was applied, and a schema that changed without one |
| `_forge_seed_history` | One row per applied seed, identified by its directory and name | A seed that already ran, and one edited since it ran |

**The names begin `_forge_`, matching the platform's own `_cf_*`.** A leading underscore is how D1 already marks a table as the platform's rather
than the app's, so a reader needs one convention instead of two. The prefix keeps both tables out of the schema fingerprint (§4a), out of what
compose reads as the app's schema (`SCHEMA_COMPOSITION.md` §3), and out of what a backup treats as an app table ([`DATABASE_BACKUPS.md`][db-4] §4).

**Forge owns the migration history outright.** No verb runs `wrangler d1 migrations apply` or writes wrangler's `d1_migrations` table. `migrate`
and `migrate status` read it, as the table an entry's `migrations_table` names, and only when the database holds it: a migration wrangler recorded
that forge never applied refuses the apply (§6d) and fails `status --check` (§6c). Wrangler remains the transport and nothing more — `d1 execute`,
`d1 export` and `d1 time-travel` are what every verb here spawns.

Past that read, the migration analysis leaves the table out of the scratch copy it diffs against (§9b). Everywhere else it counts as one of the
**app's** own tables: it enters the schema fingerprint, and a backup carries its rows. Drop it before forge's first apply to such a database; after
that apply the fingerprint covers it.

### 4a. `_forge_migrations` — The Migration History

Forge writes the history row itself, in the same load as the migration body (§6d), so there is one record of what ran rather than two to reconcile.
The DDL is `src/tooling/db/migrate/companions.ts`. `id` is apply order; `name` is the file name without `.sql`; `sha256` covers the file with its
`forge:compose` stamp blanked; `applied_at` is epoch milliseconds, since `STRICT` has no `TIMESTAMP`; `fingerprint` may be `NULL`.

**`id` is never `AUTOINCREMENT`.** A backup restores keys from the artifact, and an engine-allocated key would need `sqlite_sequence` carried with
it — the hazard the `autoincrement` lint rule refuses on an app table (§5). Forge's own table does not get to break the rule it enforces.

**The unique index on `name` is what makes a duplicate migration name a hard failure**: two files of the same name fail at apply time on it, as a
raw SQLite unique-constraint error rather than a forge message.

**A `NULL` fingerprint is a fact, not a missing value:** the migration was applied, and no apply has certified the schema since. A run that applied
its last migration and then failed before certifying leaves it behind, and `forge db migrate status` reports it while exiting zero on that clause,
since nothing about the schema is known to be wrong (§6c).

`forge db migrate status` compares this table against the files on disk: `pending` is on disk with no history row, `mismatch` is applied with a
file that now hashes differently, and `drift` is a history row with no file on disk. A `drift` row aborts an apply outright, naming each drifted
migration: forge will not apply over a history it cannot read. A file deleted rather than checked out is the common cause.

**The schema fingerprint rides on the last row.** It is a SHA-256 over the app's own schema objects as `sqlite_master` declares them, sorted, with
every object whose name begins `_forge_`, `sqlite_` or `_cf_` excluded. Databases built from the same migrations fingerprint the same, so a
fingerprint that moved without a migration is DDL someone ran by hand. Only an apply certifies one, with an `UPDATE` on the row `ORDER BY id DESC`
selects — so a database with **no** applied migration can hold no fingerprint at all, and the apply says so rather than reporting a certification
that did not happen.

The fingerprint rules have one home, `src/storage/db/schema.ts`, which `tooling/db` imports. A Worker reads the same clause through
`checkSchemaHealth` ([`STORAGE_BINDINGS.md`][sb-1f] §1f), so the CLI and the runtime cannot judge one schema two ways.

**The migrations digest is computed, never stored.** It is a SHA-256 over the ordered `(name, sha256)` pairs — derived from the rows above and from
the files on disk alike, so no stored rollup can drift from what it summarises. A backup artifact binds itself to it ([`DATABASE_BACKUPS.md`][db-4]
§4), and compose caches a replayed baseline under it (`SCHEMA_COMPOSITION.md` §7).

**Seed history stays a table of its own, rather than a `type` column here.** Migration history is forward-only and is the record that makes an
edited-after-applied file detectable at all; seed history is deliberately deleted by `seed reset` (§4c). Merging them would put that `DELETE` one
`WHERE` clause away from the integrity record.

### 4c. `_forge_seed_history` — What Has Been Seeded

One row per seed: `source`, the directory that declared it, its name, the SHA-256 of its **raw** file text, and when it ran — keyed by `(source,
name)` as a unique index over a synthetic `id`. The contract it enforces is §7's.

`forge db seed reset` deletes every row here and nothing else — the rows the seeds wrote stay where they are, and every seed runs again on the next
apply.

---

## 5. The Migration Lint Rules

`forge db lint` checks the migrations the target does not hold yet (§9b). The same rules run before every apply, and over every migration compose
emits — a finding there is a forge bug and the file is not written. Comments, string literals and quoted identifiers are masked before matching, so
a rule fires on code and never on prose inside a comment or on a column called `"delete from"`; a `CREATE TRIGGER … BEGIN … END;` is one statement,
so the `BEGIN` inside it is not a transaction.

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
| `alter-column-unsupported` | `ALTER COLUMN` in an `ALTER TABLE` | D1's SQLite has no `ALTER COLUMN`; changing a column is a rebuild, which compose emits |
| `pragma-unsupported` | `PRAGMA foreign_keys`, in any form | D1 always enforces foreign keys and ignores the pragma, so the author believes something false; only `defer_foreign_keys` relaxes them, inside a transaction (`SCHEMA_COMPOSITION.md` §4) |
| `pragma-unsupported` | Any `PRAGMA` outside D1's supported set, which `D1_PRAGMAS` in `src/tooling/db/migrate/lint.ts` holds | D1 refuses it with `SQLITE_AUTH`, so the migration fails where it runs |
| `table-too-wide` | A `CREATE TABLE` of more than 100 columns, table constraints not counted | D1 refuses a table that wide (`D1_LIMITS.columns`, `STORAGE_BINDINGS.md` §1h); compose also refuses a declared table that wide, which catches an `ADD COLUMN` |
| `generated-edited` | A file with no `forge:compose` stamp, or one whose stamp's `body` hash differs from the file below it | Compose writes every migration (§9b); edit `schema.sql` and compose again |

`generated-edited` is what holds every migration to compose, and the whole composer rests on it: were DDL able to reach the database without
passing through a declaration, an object the declarations do not describe could exist, and compose could not read an object's absence from
`schema.sql` as a deletion ([`SCHEMA_COMPOSITION.md`][sc-3] §3).

**Every rule is an error and aborts any apply.** No rule warns, so there is no strict mode. A rule that compose's own correct output would trip
cannot be an error and so does not exist: the risk of a rebuild or a new `UNIQUE` index over rows that break it is what `--rehearse` (§6f) is
for, and a drop or a rename is judged by its effect (§9b), never by a rule reading SQL. Seed lint is §7's. Compose's own warnings
(`SCHEMA_COMPOSITION.md` §4) are a separate channel: printed with the plan, never aborting, and carried in the JSON outcome as `warnings`.

---

## 6. Applying

`forge db migrate` applies every pending migration in name order, each as one load (§6d).

**`--to <NNNN|name>` cuts the pending set.** A name matching nothing is refused with the list of what is on disk, and the migrations left over are
reported as left for a later run.

**Only the pending files are linted.** A library migration that has been applied for a year must not newly abort every apply in every consuming app
because a lint rule was added since.

### 6a. The Apply Lock

An apply takes a lock at `<home>/.forge/db-apply.lock` holding the pid that took it and the time, and releases it however the run ends. A second
apply against the same home is refused while the lock is held, naming the pid and the time. A lock older than an hour is taken over as a dead
process's: the taker renames the file aside, which is atomic, and checks that what it renamed is the lock it judged stale before writing its own —
a fresh lock written in between is put back and the taker refuses. Without an OS lock, the moment between that rename and the check is the
only window left. The lock is per checkout, so two machines applying to the same remote database
are not excluded from each other, and it is always the app's own home's — one under `.forge/scratch/` would exclude nothing.

**A seed takes the same lock, for every target including a deployed one.** The runs it excludes are two local processes: a seed whose
pending-migration check passed before a concurrent migration committed would otherwise write rows during that migration's rebuild, and rows
written after the copy and before the drop are lost — with the seed recorded as applied, so a re-run skips it.

### 6c. `status --check` Exit Conditions

`forge db migrate status --check` exits non-zero when any of these holds, and zero otherwise:

- a migration is `pending`;
- a migration is `mismatch` — applied, and its file now hashes differently;
- a migration is `drift` — applied, with no file on disk;
- the entry's wrangler history table records a migration forge never applied (§6d);
- a fingerprint is certified and does not match the schema as it now stands;
- migrations are applied and no fingerprint was ever certified — the `NULL` case of §4a.

**The last clause fails the gate because CI reads the exit code and nothing else**: a line asking for an apply under an exit meaning _nothing to do_
would be read by neither. A database lands there after a restore over the migrations route, and after an apply whose certifying write failed on its
own. One `forge db migrate` clears it, with no flag: with nothing pending the apply certifies the schema as it stands, because no earlier
fingerprint exists for it to contradict, and a fingerprint that does contradict one stays refused (§6d).

A declared file edited and never composed is `forge db schema check`'s to catch, not this check's (`SCHEMA_COMPOSITION.md` §6).

A Worker reads the fingerprint clause as a report, never as an exit code or a refused request ([`STORAGE_BINDINGS.md`][sb-1f] §1f). The repair is
`forge db migrate`.

### 6d. Check, then Apply

`forge db migrate` reads `_forge_migrations` before it plans anything and holds the database against it. Each check is a refusal that names its own
repair, and none has an override:

1. **An edited history.** An applied migration whose file does not hash to the `sha256` its history row recorded (stamp blanked, so a `--restamp`
   is not an edit). Restore the file from version control, or reset the database.
2. **A history wrangler wrote.** A migration the entry's `migrations_table` (or `d1_migrations`) records and `_forge_migrations` does not —
   `wrangler d1 migrations apply` ran against this database. It is checked on every target where the database holds that table. Where forge has
   applied nothing, drop the table before bringing the database under forge (§4); otherwise restore the database to a point before that run —
   `forge db bookmark restore` on a deployed target, `forge db reset` and `forge db restore` on a local one.
3. **A migration compose did not write.** A pending file with no `forge:compose` stamp, or one whose stamp's `body` digest does not match the file
   (§9b). Change `schema.sql` and compose again.
4. **A moved fingerprint.** The newest certified fingerprint — rows a part-applied batch left `NULL` are read past — is not the fingerprint of the
   schema as it now stands. The cause is hand-run DDL or a batch whose body committed without its history row, which at the database look the
   same. Restore the database to the bookmark the last apply printed, or reset and restore it locally. A database where no row ever certified one
   is not refused here (§6c).
5. **A mis-stamped migration.** A pending generated migration whose stamp's baseline is not the digest of the files before it on disk — composed
   against a different history, which a merge of two branches produces (`SCHEMA_COMPOSITION.md` §6). Compose again, or
   `forge db migrate compose --restamp <name>`. One already applied here only warns, and one past the `--to` cut is not checked.
6. **An unapproved drop or rename.** Every drop or rename the pending files make to a scratch copy of the target's schema is paired with its file's
   lines (§9b); an unpaired one refuses, naming it.

**`--dry-run` predicts all of it without writing**, evaluating every check against the same record the real run reads, the analysis included — so a
dry run's refusal is exactly the real run's.

**A migration's body and its history row reach the database together.** Each migration is staged under `.forge/scratch/migrate/` as one file — the
migration's SQL, then the `INSERT INTO _forge_migrations` that records it. Locally that file is loaded in process as one call, which is one
transaction, so the migration and its record commit together or neither does; a deployed target loads it with `wrangler d1 execute --file`.
Seeds take the same path with their own record statement (§7), so there is one apply mechanism here and not two.

**A local load refused at commit is replayed once, to name the row that broke it.** A deferred foreign key is checked at commit, and miniflare
reports that refusal as `internal error; reference = <id>` or as a bare `FOREIGN KEY constraint failed`, neither naming a table. Forge then runs
the same statements again under a foreign-key watch, and the refusal names the child table, the parent it lacks a match in, and the statement
that first left it so. The replay is local only: a deployed database is never replayed against. It never commits, because it is one batch ending
in a statement that always fails; it runs only after the original load was rolled back, and a migrate still holds the apply lock (§6a). Naming a
refused very large load, such as a restore's rows, takes longer, and that cost is accepted rather than capped.

**Against `--remote` that file is not one transaction, and this is the one place a deployed apply can tear.** A deployed migration body can commit
without the `INSERT` that records it; the rerun then re-applies a body that has already run and fails on whatever it created. The `INSERT` is a
plain `INSERT` rather than an `INSERT OR REPLACE`, so nothing papers over the gap. **The recovery is the bookmark the run printed** (§3). There is
deliberately no verb that reconstructs the missing row: a row written from the file alone would assert that the body ran, which is the very thing
in doubt.

**The fingerprint is certified after the batch, in a statement of its own.** A crash before that `UPDATE` leaves the last history row with a `NULL`
fingerprint — reported, not failed (§4a), and certified by the next apply.

### 6e. Who Else Holds the Database to Its Fingerprint

**The fingerprint is not `migrate`'s alone.** The comparison is one rule — read the newest certified fingerprint, hash the schema as it stands, say
whether they agree — and every verb that opens the target reaches it through `schemaDrift`. What differs is what each verb does with the answer:

| Verb | On a mismatch | Why that and not the other |
| --- | --- | --- |
| `forge db migrate` | Refuses; nothing passes it | It is the verb that can explain the schema, so it is the one that insists |
| `forge db seed` | Refuses; nothing passes it | A seed writes rows into whatever schema is there, and the check is held early (§7) |
| `forge db backup` | Says so, records the state in `manifest.json`, and takes the backup | An artifact of a drifted database is still worth having ([`DATABASE_BACKUPS.md`][db-4] §4) |

**`forge db schema check` is not on that list, and stays off it.** It reads files and opens no database, which is what lets it run in a library
repository with no database at all and in a pre-merge job. A pipeline that wants both answers runs it and `forge db migrate status --check` (§9).

`restore` and `reset` are also absent, because neither holds a live schema worth comparing: a restore needs an empty target and checks what it
built against the manifest (`DATABASE_BACKUPS.md` §6), and a reset's guard — a verified artifact whose row digests still match — is strictly
stronger than a fingerprint.

### 6f. Rehearsing Against Real Rows

**`forge db migrate --rehearse` applies the pending migrations to a copy of real data first.** Every other check reads a schema, and compose's
proof holds one synthetic row per table ([`SCHEMA_COMPOSITION.md`][sc-4] §4). A statement that fails only on particular values — a `NOT NULL` over
NULLs, a `UNIQUE` over duplicates — passes all of them and fails on the target.

A rehearsal restores a backup artifact into a throwaway database under `.forge/scratch/rehearse/`, with the target's own history carried in its
rows ([`DATABASE_BACKUPS.md`][db-4] §4), and applies and records the pending migrations there **before the confirmation, under the lock** — so one
that fails leaves the target untouched, naming the migration it stopped on and what the database said. A deployed target is refused, having no
local scratch, and a dry run rehearses nothing. **The artifact must have been taken with exactly the migrations this target has applied** — one
taken earlier or later is refused, naming the difference — so the pending files run over the schema they will meet.

---

## 7. The Seed Contract

A seed is a `.sql` file in one of the directories the host config's `seeds` names (§8), or in the one `--dir` names instead. These rules make a seed
run safely more than once:

- **The directory and the name are the identity.** They key `_forge_seed_history` together, so two directories may ship one name, and renaming a
  seed — or its directory — makes it a new seed. `--only` takes `<dir>:<name>`, and refuses a bare name two directories both hold.
- **The hash is over the raw file text**, before any variable is expanded, so the same seed on a machine whose environment differs is not a changed
  seed.
- **`${VAR}` and `${VAR:-default}` are expanded by `seed apply` alone**, quoted for the context the value lands in: **inside a SQL string literal**
  a quote in the value is doubled, so it stays one literal; **outside one** the value is the SQL itself, so only an identifier-like token
  (`[A-Za-z_][A-Za-z0-9_.]*`), a number or an empty value is accepted, and anything else aborts naming the variable and the value. A NUL is refused
  either way. `seed status`, `lint --seeds` and the hash read the file as written, so none needs a variable set; an unset one refuses the apply
  before any seed is loaded. The expanded seed is written under `.forge/scratch/seed/` with mode `0600` and removed as soon as its load has run.
- **A seed whose file changed since it ran is refused**: `seed apply` reports it as `changed`, applies nothing for it, and exits non-zero.
  `--rerun` alone re-applies every recorded seed, changed or not, and `--rerun --only` narrows that to the seed it names.
- **A seed may name the places it belongs to, and one that does not stays off the deployed database.** A first line of
  `-- forge:places local,standby` keeps the seed out of a run against any other place — it is in neither column of that run's plan. A seed with no
  such line runs on `local` and `standby` only; a deployed run lists each one it left out as `excluded`, with the line that includes it, and
  `--only` naming one is refused with that line. A place suffix in the file name would instead make a second seed with its own history row.

**Order is name order within a directory, directories in the order the host config names them.** Number a seed that depends on another
(`0010_users.sql`, `0020_posts.sql`); nothing enforces it, because renaming a seed changes its history key and re-runs it everywhere.

**`seed apply` refuses a database with a migration pending**, since a seed is written against the schema the migrations describe. Run
`forge db migrate` first; no `-- forge:requires` line exists, because the pending check already knows. **It refuses a schema that moved without a
migration, too** (§6e), since the rows would be aimed at a shape nothing described. Both checks run before the lint, the confirmation and the first
load, so a refusal leaves nothing written.

**A deployed `seed apply` carries the same guards as `migrate`** (§3): it confirms first and captures a Time Travel bookmark as the undo; `local`
and `standby` ask nothing and capture nothing. A seed and its history row are loaded as one file (§6d), so a crash cannot leave a seed applied and
unrecorded. `seed status` is the dry run, and `--check` exits non-zero while any seed would run or has changed — an `excluded` seed is neither.

**Idempotence within one file is the author's**: write `INSERT OR IGNORE` or `INSERT … ON CONFLICT DO NOTHING` rather than relying on the history
table as the only guard. Seed lint holds a seed to `seed-insert-not-idempotent`, which names an `INSERT` with neither, and to `unbounded-update`,
`unbounded-delete` and `attach-database` (§5). Every seed rule is an error, refused on every place before anything is loaded. A seed's drop needs no
rule of its own, because the schema check refuses it (§7a).

### 7a. Migration or Seed

**A migration carries schema and nothing else.** Every row the database needs is written by a seed or by the app, so a change that needs data is
these steps in order, each of which the previous Worker survives:

1. **Add.** Compose adds the new shape so the rows already there satisfy it: a new table, or a column that is nullable or carries a constant
   `DEFAULT`. Compose refuses a `NOT NULL` column with no `DEFAULT` on a table that exists, so this step is never skipped.
2. **Fill.** A seed, or the app, writes the data: a backfill is an `UPDATE … WHERE` over the rows still unfilled, and a lookup table the code reads
   is `INSERT OR IGNORE` rows in a seed. A fill that must reach a deployed database names the places on its first line —
   `-- forge:places local,standby,preview,remote` — because a seed with no places line stays off it (§7). `seed apply` refuses while a migration
   is pending, so the fill lands on the shape the add put there, and `_forge_seed_history` (§4c) keeps it from running twice on one database.
3. **Tighten or remove.** A later compose makes the column `NOT NULL`, gives it its `CHECK`, or drops what the fill replaced. A tightening is a
   rebuild over rows the fill must already satisfy — compose warns that it depends on them, and `--rehearse` (§6f) proves it on a copy of real rows.
   A removal is a drop, approved by the line compose writes for it (§9b).

**A row is environment content when it may differ by place**: development users, sample posts, an admin whose address differs by place. It may
be re-run, and it is never what makes the deployed database correct. It is a seed with no places line, or one naming only the places it belongs to.

**A seed changes no schema, and that is checked by effect before the seed reaches the target.** Before `seed apply` or `standby reset` loads a
pending seed, the seed is run, expanded, on the scratch copy of the target's schema the migration analysis builds (§9b), split into statements the
way `wrangler d1 execute --local` splits a file, and refused — naming it and what changed — when the schema after differs from the schema before.

The copy holds no rows, so a seed that only writes data can fail there where the target would not. **So the check runs the seed one statement at a
time, and passes over a statement only when a row constraint stops it and it writes no schema**: a `FOREIGN KEY`, `UNIQUE`, `NOT NULL` or `CHECK`
refusal is passed over only when the statement's `EXPLAIN` program touches no schema object and leaves the schema cookie alone. A schema statement
the copy's rows stop is refused, and so is a failed `EXPLAIN` or **any other error on the copy** — a syntax error first among them, since passing it
over could hide a schema change the target then applies. So a `DROP` later in a seed is never hidden behind an `INSERT` that failed before it, and
a valid seed is never refused for a row only the target holds.

### 7b. A Generated Fixture Seed

**`composeSeedFixture` writes a seed from rows held in memory, and there is no CLI verb for it** — the rows are TypeScript literals in the
consumer's build script. It exists so a fixture is never hand-typed `INSERT` text, which would give forge's newline encoding a second home. It
emits one `INSERT OR IGNORE` per row and loads the result into a scratch database of its own — forced to `local`, and apart from the compose
caches so a regeneration never empties a database a cached model was built against. It refuses, each naming what to change:

- **A path outside every declared seeds directory (§8), or one not ending `.sql`** — a seed forge does not read is a file nothing applies.
- **A table the declared schema does not create.**
- **A row missing a column the schema declares.** An authored key the schema does not declare is reported in the outcome and not emitted, because
  nothing has to be edited for a drop.
- **A `${VAR}` or `${VAR:-default}` anywhere in the emitted text**, which `seed apply` would substitute (§7). The scan is for the expander's own
  pattern rather than a bare `${`: anything it would not substitute, it would also not refuse.
- **A load the schema rejects** — a `CHECK` or a foreign key, named by the constraint. Foreign keys are on, since a scratch database with them off
  would prove nothing.
- **A loaded count below the authored count**, which is a duplicate key `OR IGNORE` swallowed. This is what buys back what `OR IGNORE` costs.

**The bytes are stable across runs**: no generated-at header and no version stamp, which would make `seed apply` report the seed `changed` every
release. The same rows give the same `sha256`, so "regenerate, then expect an empty diff" is a usable gate check.

---

## 8. Every Position Is Declared

**The host config — a `db.ts` in the app's `config/` directory — names every file `forge db` reads, and nothing else is read.** An installed package
contributes no DDL to your database because it happens to ship some; it contributes DDL because the app asked for it, by path, in a file a reviewer
can see.

It declares the desired-state files in load order, the seeds directories in run order, the one migrations directory, where the composed snapshot
lives, and where backups go. The fields, their defaults and a worked `db.ts` are the README's; `DbHostConfig` in `src/tooling/db/types.ts` is
authoritative over both ([`SOURCE_OF_TRUTH.md`][sot] §2a).

**These rulings hold whatever the fields say.** `schemas` is ordered and loaded into one empty database, so a file with a `FOREIGN KEY` comes after
the file declaring the table it points at. **Every path is resolved against the root**, the `migrations` directory included. A verb refuses a
`d1_databases` entry whose `migrations_dir` is not forge's directory, or whose `migrations_pattern` is not that directory's `*.sql`, so
`wrangler d1 migrations` and forge never apply two sets of files. A path starting with `@` is a package specifier, resolved through its package's
exports as the app installed it. The file itself is optional: with none, `compose` and `schema check` say so and name what to write.

**There is no namespace.** Nothing is discovered from a `package.json`, so a path names itself, and it is the name a refusal, the snapshot,
`status` and the companion tables all use (§4a, §4c).

**A library publishes a desired state and no SQL that runs.** The app composes one migration sequence of its own from every declared schema
([`SCHEMA_COMPOSITION.md`][sc-1] §1), and nothing is copied in or renamed on the way. A library change that needs data takes §7a's sequence across
releases: one adds the shape, a CHANGELOG entry names the fill the consumer writes, and a later one tightens it. A library checkout composes no
migration and keeps no snapshot; `forge db schema check --replay` (`SCHEMA_COMPOSITION.md` §6) loading its declarations into a throwaway D1 is the
whole of what it can check about itself. No verb prints the declarations as one document, which would be another rendering to keep in step.

---

## 9. The CI Gate

**These lines belong in CI, before the deploy step:**

```bash
forge db schema check                    # schema.sql, its snapshot and the migrations agree
forge db migrate status --check --target remote    # the deployed database agrees with the migrations
```

**Both lines are needed, and neither covers the other**: the first asks, from files alone, whether the migrations say what the declarations say
(`SCHEMA_COMPOSITION.md` §6); the second asks whether the database has had them applied (§6c). Together they catch a deploy shipping code that
expects a column no migration has applied, at the last cheap place to catch it.

`dbSteps()` from `@y-core/forge/tooling/gate` is the first line as gate rows, with the lint every consumer would otherwise have to remember: the
digest check in `static`, and `forge db lint` and `--replay` in `runtime`. An app on the shared Worker table takes the same rows from
`cloudflareWorkerSteps({ db: true })`.

### 9a. The Workers Builds Deploy Command

**Set the Workers Builds deploy command to:**

```bash
forge db migrate --target remote --yes && wrangler deploy
```

**`&&` is what stops the deploy, so no build ships code ahead of its schema.** Every refusal of §6d and §9b exits non-zero having applied
nothing, and a failed apply exits non-zero too, so either way the build deploys nothing and the previous Worker keeps serving. With nothing pending
the migrate exits 0 and the build deploys.

**`--yes` is required.** A deployed migrate asks before it applies (§9b) and a build has no terminal to ask at, so without `--yes` the migrate is
refused and the build ships nothing. `--yes` confirms the apply; it passes no refusal.

**The build's token needs `Account → D1 → Edit`.** A token Cloudflare refuses names that permission, and says whether anything was applied by
then: nothing, or the migrations before the refused one. `forge cf sync --commit` notes that D1 write access is unverified unless it created a
database.

A team that keeps the apply a human step makes `forge db migrate status --check --target remote` the first half instead: it exits 1 while
anything is pending (§6c).

### 9b. The Migration Contract

**A migration is judged by what it does to the target's schema, never by reading its SQL.** The analysis is Atlas's
[`migrate lint`](https://atlasgo.io/versioned/lint): apply the pending files to a scratch copy of the target's schema, diff the schema after each
file, and refuse any drop or rename compose did not write an approval line for. No flag or option passes any of these rules:

- **The target is the only reference.** `lint`, `migrate` and `standby reset` each compare against the schema of the database the run resolved,
  read from that database. A run that cannot resolve or read its target refuses; no replay of the history stands in for it, and compose's own
  replay ([`SCHEMA_COMPOSITION.md`][sc-1] §1) proves a property of the file, never that it is safe to land on a database.
- **Compose writes every migration.** A pending file with no compose stamp, or one whose stamp's body digest fails, is refused before anything
  runs. A hand edit passes only when it is exactly what compose wrote.
- **Lint judges exactly the files the target does not hold yet**, the ones absent from its `_forge_migrations`, and takes no file arguments. On an
  empty local database every file is pending; a file the target already holds is held by its recorded checksum instead (§6d).

**The scratch copy is built from the target's own `sqlite_master`**, recreated on a fresh local D1 under `.forge/scratch/` from each object's
stored SQL, tables first. It leaves out an index with no SQL (the table's own SQL recreates it), every `sqlite_*`, `_cf_*` and `_forge_*` object,
and the wrangler history table the entry's `migrations_table` names. Both sides of every diff are read from the copy, by one SQLite in one way. A
file that does not apply to the copy is refused before the target is touched, and so is a target holding a virtual table, which no model describes.

**One diff per file is enough, once the file's renames are applied to its before side.** A rename is the only way compose moves rows from one
name to another, and a rebuild's `INSERT … SELECT` names every column the table keeps, so a file loses no data its own diff cannot see.

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

A virtual column and a view hold no rows, so dropping one destroys nothing; a running Worker may still read either, so it is incompatible.
**Every finding refuses on every target until its line approves it** — `local` and `standby` as much as `remote` and `preview`.

**Each `forge:renames` line renames its object in the before model, in line order, and then the diff runs** — in the model rather than on a second
copy, because every finding depends only on an object's name, its table and its `hidden`. A rename is a finding because its line names it; nothing
pairs a drop with an add, and a line whose old name is absent or whose new name exists refuses. **So a rename that reuses the old name yields one
rename finding and no drop**: renaming `users` to `accounts` and creating a new `users` finds `users` created, and a column dropped from a table the
same file renames is a destructive finding of its own.

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

Every name is a double-quoted SQL identifier with any `"` inside it doubled, and a renamed column's new name is the column alone, since it keeps
its table. A `forge:renames` line names its objects as they stand once the lines above it have run, and a `forge:drops` line names them as they
stood before the file. Names match as SQLite resolves them, without regard to ASCII case. **Lines and findings match one to one**: a finding with
no line refuses, and so does a `forge:drops` line with no finding. A line added or changed by hand fails the stamp digest. Atlas's own approval,
`-- atlas:nolint`, annotates a statement or a file; forge's is per object, because the analysis diffs whole files and has no statement to point at.

**Applying anywhere but `local` asks first**, listing the pending files with every (already approved) finding; a non-interactive run passes `--yes`.

**Nothing bypasses the contract.** There is no hand-written migration, no baseline verb or exemption list, and no flag or option field that skips
lint, accepts drift, seeds onto pending migrations or approves a drop outside its file. `--allow-unbacked` on `forge db reset` stays: reset applies
no migration and writes no schema, it runs only on `local` and `standby`, and the flag is the developer's statement that a database is disposable,
which no analysis could make for them.

### 9c. Recovering From a Torn Deploy

**A failed apply** stops the command at the migrate, so nothing was deployed (§9a): restore to the run's `undo:` bookmark with
`forge db bookmark restore`, fix the cause, and run the command again. **A `wrangler deploy` that fails after the migrate succeeded** leaves the
new schema under the previous Worker, which §9b keeps safe: fix the deploy and run the command again — the migrate finds nothing pending and exits
0, so only the deploy runs.

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
