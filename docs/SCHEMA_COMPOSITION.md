---
title: Schema Composition
description: "How a declared schema becomes a migration: the desired-state files, ownership, what compose emits, renames, the stamp and snapshot, and the scratch cache."
audience: consumer
---

# Schema Composition

> Owns what `forge db migrate compose` decides on a consumer's behalf: where a desired-state file is looked for, which file declares which
> object, when a change is altered in place and when it is rebuilt through a copy, how a rename is spelled, what a composed file's stamp and the
> checked-in snapshot each hold, what the two file-only checks catch, and what compose refuses to write.
>
> Defers to: `DATABASE_MANAGEMENT.md` for the places a migration is applied to, the companion tables, the lint rules, seeds, backups and the CI
> gate; [`src/tooling/db/README.md`][db-readme] for the command tree, every flag and every export; [`NAMESPACES.md`][namespaces-5g] §5g for why this
> surface is a `tooling` namespace and never Worker-reachable.

---

## 0. Quick Reference

- §1 How a Migration Is Composed: the desired-state files, the one sequence the app composes, and the real SQLite in the loop
- §2 The Desired-State File: where it is looked for, and a directory of files
- §3 Ownership: which file declares which object, what nothing declares, and how a drop names the file that declared it
- §4 What Compose Emits: alter in place, or rebuild through a copy — why a rebuild takes every referencing table with it, a rebuild that depends on
  the rows warned, and a drop approved by digest, not by flag
- §5 Renames: `--rename`, explicit and never inferred
- §6 The Stamp, the Snapshot and the Two Checks: what a composed file carries, what `schema.snapshot.json` holds, how a library upgrade is caught,
  and the merge procedure with `compose --restamp`
- §7 Custom Migrations and the Scratch Cache

---

## 1. How a Migration Is Composed

**Each declared file states its schema once, as DDL, and the app generates every migration from all of them together.** A desired file is the source
of truth a reader opens to learn what the schema is; a migration is the mechanical step from the migrations before it to what those files declare.
`forge db migrate compose` writes the step into the app's own directory — there is one composer, and nothing about it is guessed: the migrations
on disk are replayed through wrangler into a throwaway local D1, the desired file is loaded into another, both are read back through `sqlite_master`
and the `pragma_*` table-valued functions, the two models are diffed, the emitted SQL is applied to the replay and the result must equal the desired
model before the file is written. There is no SQL parser in the loop — a real SQLite decides what every statement means — and the one tokenizer
forge keeps is for masking prose, normalizing DDL text for comparison, and splitting a `CREATE TABLE` body at its commas.

Normalization drops comments, collapses whitespace, upper-cases keywords, spells every identifier one way whatever it was quoted with —
`"Two Words"` and `"two words"` are one name, as SQLite resolves them — and drops `IF NOT EXISTS` and the trailing `;`. A double-quoted token is an
identifier **unless SQLite may read it as a string literal**, in which case it is kept as written: inside a column's `DEFAULT` or `CHECK`, a quoted
token that names no column of that table is a literal, and in a view or trigger body every quoted token is, because the columns it could name belong
to other tables. A quoted keyword — `"unique" TEXT` — is a column, not a constraint.

## 2. The Desired-State File

Every desired-state file is an entry in the host config's `schemas` ([`DATABASE_MANAGEMENT.md`][dm-8] §8), relative to the root and loaded in the
order it is written. A library's is reached the same way as the app's own — by path, into `node_modules` — because a library is a source of DDL like
any other and gets no special resolution.

An entry may be a directory, in which case every `.sql` file inside it is concatenated in name order — one file per table, if that reads better. An
entry whose path is absent is not an error: it declares nothing, and the schema is composed from whatever the others declare. An app that owns no
tables of its own is the ordinary starting point — the declarations are then its libraries' alone. Compose refuses only when _nothing_ declared is
on disk, and says what to write.

**A desired-state file is hand-written, and there is no verb that generates one.** Composition runs one way — declaration to migration — and a
reverse verb would be a second way to author the file that is right only when it is byte-faithful. Adopting a database forge did not build is the
case that seems to want one, and it is the case that least survives it: the declaration a team wants is the schema stated cleanly, not a transcript
of however the accumulated migrations left it. Write the file, add it to `schemas`, and let `compose --dry-run` be the proof — it says "no changes"
exactly when the declaration and the migrations already agree, and prints the difference when they do not.

## 3. Ownership

Ownership decides **which desired file declares which object**, and nothing else — the app composes every file either way. Two declared schemas
holding one name is refused naming both **by path**; an index or trigger belongs with its table — a view names none — so an app index on
`auth_users` is refused naming the file that declares `auth_users`. An app table declaring a name a library's file already declares falls under the
same rule. There is no prefix rule, and no namespace.

**Nothing exists in the database that a declaration did not put there, so there is no third category.** Every object the migrations build came from
a composed migration, and a composed migration emits only what a desired file declares — `custom-ddl` is an **error**, so a custom migration carries
data and never a table's shape ([`DATABASE_MANAGEMENT.md`][dm-5] §5). An object in the replay that no desired file declares is therefore a
_deletion_ and nothing else: compose drops it. There is no "unowned" set to exclude from the diff, and no rebuild that could take a stranger with
it.

**An object becomes undeclared two ways, and the second one says so by name.** You delete it from a file the host config still names — or the file
itself leaves the host config's `schemas`: a library dropped from it, a path renamed, a file moved. The second edits no desired file at all, so the
plan would otherwise propose dropping tables nobody touched with nothing saying why. `schema.snapshot.json` therefore remembers which names each
declared file held (§6), and a dropped object whose declaring file has left `schemas` is printed with the plan, naming that file:

```text
posts, posts_user were declared by node_modules/@acme/blog/schema.sql, which config/db.ts no longer declares or whose file is absent — nothing declares them now
```

**The remembered names explain a drop; they never decide one.** The diff and the SQL are what they would be without them. What the reason does
change is the `--allow-destructive` digest, which covers it (§4), so an approval of a deletion does not carry to the same drop arriving from a
departed file. A file the snapshot holds that `schemas` does not name, and that owns none of this compose's drops, is said once, as a `warning:`
line, on the compose that forgets it.

**A declared name in a reserved space is refused at the door.** `_forge_`, `sqlite_` and `_cf_` are forge's, SQLite's and the platform's — a desired
file declaring any of them is refused naming the file and the object, rather than composing to nothing because the model never carries it. There is
no exception for a migrations table any more: forge's history lives under the `_forge_` prefix like everything else it owns
([`DATABASE_MANAGEMENT.md`][dm-4] §4).

The same prefix covers the `_forge_new_` tables a rebuild creates (§4), so one left behind by a rebuild that was interrupted mid-migration is
invisible to the model: compose neither plans a drop for it nor counts it as a stranger. Drop it by hand — nothing here will mention it.

A declared object may be written schema-qualified — `CREATE TABLE main.users` — and is read under its last segment, `users`, which is the name
SQLite itself records. A `REFERENCES` clause takes a bare table name: SQLite rejects a qualified one outright, so none can reach the replay.

## 4. What Compose Emits

A table is **created** from the desired file's own `CREATE TABLE` text, **dropped** with `IF EXISTS`, **altered in place** when every added column
is one SQLite's `ADD COLUMN` accepts (no `PRIMARY KEY` or `UNIQUE`, no `NOT NULL` without a `DEFAULT`, a constant `DEFAULT`, a `REFERENCES` column
defaulting to `NULL`, no `STORED` generated column), every dropped column is one `DROP COLUMN` accepts (not a key, not indexed — a partial index's
`WHERE` counts — not a foreign key, not named by a constraint, a generated column, a trigger or a view), and the added columns come after the
existing ones; and **rebuilt** otherwise, with the reason named in the plan: `column-changed`, `reordered`, `constraints-changed`,
`options-changed`, `add-column-unsupported`, `drop-column-unsupported`. Two tables are equal when their columns are equal in order by normalized
clause, their constraint sets are equal and their `STRICT` / `WITHOUT ROWID` options agree — never by whole text, because `ADD COLUMN` splices a
clause into the stored text in a way a file never writes.

**A rebuild takes every referencing table with it.** The textbook twelve-step rebuild — copy into a new table, drop the old, rename the new — is
wrong on D1 for a table other tables point at. D1 enforces foreign keys and ignores `PRAGMA foreign_keys = OFF`, so `DROP TABLE` on a parent fires
every `ON DELETE CASCADE` into its children and deletes their rows, and a child on `NO ACTION` leaves a deferred violation the transaction cannot
commit through; `defer_foreign_keys` changes neither. Compose therefore rebuilds the closure: the table, every table whose FOREIGN KEY points at it,
and so on transitively. The replacements are created parents first with each `REFERENCES` re-pointed at the replacement of the table it names, rows
are copied over the common non-generated columns, the old tables are dropped **children first** — a table nothing references any more drops without
firing anything — and the replacements are renamed into place parents first, at which point SQLite rewrites every re-pointed `REFERENCES` back to
the real name. Views and triggers are dropped before a rebuild and recreated after it, because the rename into place fails while one names a table
that is momentarily gone. A closure that reaches from a library's table into an app table pointing at it is the ordinary case, not a refusal: the
app owns every file it emits, so the whole closure is inside one migration of its own. No `PRAGMA foreign_key_check` ends the rebuild: D1 runs it,
but the engine refuses to commit a violation at all — a deferred one resets the database to its last good state — so on D1 it can only ever return
nothing (measured on local D1, wrangler 4.129).

**A rebuild that depends on the rows is warned, not refused.** The proof replays the composed file on an empty database, so it cannot see a rebuild
that copies every row as it is and fails on one: a column that becomes `NOT NULL` (a `DEFAULT` does not fill an existing `NULL` in), a `CHECK` added
to a column or a table, and a table that becomes `STRICT` or changes a column's type under `STRICT`. Compose prints one `warning:` line per such
step, naming the column, after the plan; it is advisory, and the file is written. The proof against real rows is a rehearsal on `standby`
(`DATABASE_MANAGEMENT.md` §2a).

**Identifier case is not a change**: SQLite resolves `Email` and `email` as one name and so does every comparison compose makes, so a schema
differing only in an identifier's case composes nothing. Renaming for real is `--rename` (§5).

Every composed file opens with `PRAGMA defer_foreign_keys = true;`, and every emitted statement is one the linter (`DATABASE_MANAGEMENT.md` §5)
accepts; the rebuild's `DROP TABLE` deliberately has no `IF EXISTS`, since the table was read a statement earlier.

**A drop is refused until it is allowed.** A table drop or a column drop is destructive; compose prints the plan and stops with a twelve-character
digest of the drop set, and `--allow-destructive <digest>` on the next run says that plan, and no other, was read: if the drop set has changed since
— a schema edit, a snapshot change, a library upgrade — the digest does not match and compose refuses again with the current set. The digest covers
the plan _and_ the reason lines §3 prints, so an approval carries to that plan for that cause and no other. A `NOT NULL`
column with no `DEFAULT` on a table that already exists is refused outright, whichever route would add it — give it a default, or write the fill as
a custom migration.

## 5. Renames

A rename is never inferred from a diff; a dropped-and-added pair is exactly that. `--rename old:new` renames a table and `--rename table.old:new` a
column, each repeatable, and each is transient by construction: once the migration is written the old name is gone from the baseline, and a repeat
of the flag is refused with "already renamed — drop the flag". The rename runs on the replay first, so a real SQLite rewrites every index, trigger,
view and `REFERENCES` that names the old name, and the diff is taken from there; the emitted file starts with the `ALTER TABLE … RENAME` statements.
The `rename` lint warning (`DATABASE_MANAGEMENT.md` §5) still fires on it, because a deployed Worker reads the old name between the migrate step and
the deploy step whatever wrote the migration.

## 6. The Stamp, the Snapshot and the Two Checks

A composed migration's first two lines are its provenance:

```sql
-- Generated by `forge db migrate compose`. Do not edit — change schema.sql and compose again.
-- forge:compose {"desired":{"node_modules/@acme/auth/schema.sql":"<sha256>","config/schema.sql":"<sha256>"},"baseline":"<digest of the migrations before this one>","body":"<sha256 of the whole file with this JSON blanked>","forge":"0.1.10"}
```

`body` is what `generated-edited` (`DATABASE_MANAGEMENT.md` §5) holds the file to: the SHA-256 of the whole file with the stamp's JSON blanked —
every byte of it, with the stamp line cut back to a bare `-- forge:compose `, so an edit anywhere, the notice line included, is caught; `desired` is
one digest per declared schema, keyed by the path the host config wrote, and it is provenance a reviewer reads in the migration file: which
declaration this SQL was composed from. Nothing reads it back out of the database.

`schema.snapshot.json`, at the host config's `snapshot` position and checked in, is what the last compose saw, and it holds **only what cannot be
recomputed**: `desired`, a digest per declared schema; `declared`, the object names each of those files held, as written and sorted; and
`migrationsDigest`, a digest of the migrations by name. It carries no model of the schema — both models a check compares are rebuilt from the files
and the migrations on disk, and the readable artifact is the composed migration, which is the SQL about to run. `declared` is read for one purpose,
attribution: naming the file that declared an object a later compose drops, when that file has left `schemas` (§3). Nothing decides a drop from it.
Every compose rewrites the snapshot, a no-change compose included, so the record is always the last compose's and never a backlog.

**Exclude it from the formatter.** It is generated, and `JSON.stringify(…, null, 2)` is not what a formatter that collapses short objects writes —
left in the formatter's path, the two rewrite each other on alternate runs. `"ignorePatterns": ["**/*.snapshot.json"]` in `.oxfmtrc.json` is the
line.

**`forge db schema check`** reads files only and takes no wrangler — sub-second, and the `db:schema:digests` gate row. It fails when:

- **a declared schema hashes differently from what the snapshot recorded for it** — "`<path>` moved since the last compose". One rule covers both a
  file of the app's own edited and never composed, and an installed library upgraded under it: a library bump stops the build until the migration it
  implies has been composed and reviewed, and the artifact reviewed is that migration;
- a declared schema the snapshot has never seen, or one in the snapshot the host config does not name, or whose file is gone;
- the migrations hash differently from the snapshot — a file added by hand since;
- there is no snapshot yet, and something declared is on disk alongside a migration.

**`--replay`** adds the one comparison worth making — the replayed migrations against the loaded declarations, both built in a real SQLite — and is
the `db:schema` row in `full`. In a checkout that declares a schema and composes nothing, there is no history to compare, and `--replay` is the
proof that the declarations execute at all.

**`forge db migrate status --check`** is the other half: the database, which it measures against the migrations (`DATABASE_MANAGEMENT.md` §6c). A
declared file edited and never composed is `schema check`'s alone — it is a fact about files, and the database cannot hold it.

**The merge procedure.** Two branches each compose the next number, and after the merge the later file's `baseline` names a history that is not the
one on disk — the files before it include the other branch's. `forge db migrate` refuses it as composed against a different migration history
(`DATABASE_MANAGEMENT.md` §6d). Which repair applies depends on where it has run:

- **Unapplied everywhere:** delete it and compose again. The recompose reads the merged history and proves the result on a replay, which is the only
  proof there is.
- **Already applied on some target:** `forge db migrate compose --restamp <name>`. It rewrites the named migration's stamp line to the history
  now on disk and nothing else. A migration's identity — the checksum `_forge_migrations` holds, the migrations digest, every later baseline and the
  snapshot's digest — is its bytes with the stamp's JSON blanked, so a restamp moves no checksum and cascades to nothing. It makes no wrangler call,
  and it refuses a custom file, a file edited since it was composed, and a name not on disk. `--dry-run` prints what it would restamp and writes
  nothing.

Restamp certifies a file that was proven against a different baseline, and proves nothing about it against this one. It is for the
merged-and-already-applied case only, where the alternative is a history that can never be applied again; anywhere the file has not run, recompose.

## 7. Custom Migrations and the Scratch Cache

`forge db migrate compose --custom <name>` writes the next numbered file with a `forge:custom` stamp and nothing else — for a data move, a
backfill, a step compose cannot express (`DATABASE_MANAGEMENT.md` §7a). Its DDL warns under `custom-ddl`, because a table's shape belongs in
`schema.sql`; a file carrying neither stamp is read as custom too, and warns the same way. There is no verb that writes an empty migration.

Compose runs entirely in `.forge/scratch/compose/`, from a copy of the run's config forced to `local`, so `--target remote` can never aim it at
Cloudflare. Every wrangler spawn costs about a second, so a side is two of them — the load, and the five introspection reads batched into one
`--command` — and the **model** is cached, never the database, under `<side>/cache/<key>/model.json`, keyed on the model version, the wrangler
version and a digest of that side's inputs. A hit is zero spawns, one model is kept per side, the proof's own replay is cached as the next baseline,
and `--no-cache` replays regardless. A cold compose is under ten seconds; a warm `--check --replay` is under two. A baseline whose migrations do not
apply to an empty database, and a desired file that does not execute against one, are each refused naming the file; pending migrations on some
database are not a refusal, because compose reads files and never a database of yours.

**Nothing here is checked against a deployed database, by design for now.** Compose's baseline is always the replay of the checked-in migrations, so
a view or trigger that exists only in a deployed database and in no migration is invisible to it: `refuseUnownedDependents` cannot see it by
construction, and a rebuild's `ALTER TABLE … RENAME TO` would fail mid-migration at apply time against that database. This is accepted and not
pre-checked. The goal being settled first is a consistent dependency → dev → migration cycle locally; a read-only live diff is the shape a later
answer would take, and no task is filed for one until the local cycle is settled.

[db-readme]: ../src/tooling/db/README.md
[dm-4]: ./DATABASE_MANAGEMENT.md#4-the-companion-tables
[dm-5]: ./DATABASE_MANAGEMENT.md#5-the-migration-lint-rules
[dm-8]: ./DATABASE_MANAGEMENT.md#8-every-position-is-declared
[namespaces-5g]: ./NAMESPACES.md#5g-tooling--where-a-developer-facing-tool-belongs
