---
title: Database Backups
description: "The backup artifact: its four files, the proof both restore routes pass before it exists, what binds it to a schema, the data format and its limits, and what restore and reset check."
audience: consumer
---

# Database Backups

> Owns what `forge db backup`, `forge db restore` and `forge db reset` decide: what an artifact holds, why it is proven before it is written, why
> forge emits the data itself rather than taking wrangler's dump, and what each verb checks before it acts. The places a backup is taken from and
> the undo each place has are [`DATABASE_MANAGEMENT.md`][dm-3] §3's.

---

## 0. Quick Reference

- §1 The Artifact: the directory name, the four files, and which route restores from each
- §2 Proven Before Written: both routes replayed into a scratch and compared row by row, and what a backup holds the lock for
- §3 A Remote Backup Is a Read: no lock, no bookmark, proven into a local scratch
- §4 Self-Contained and Bound: the embedded migrations, the three facts the manifest binds to, and the manifest's own digest
- §5 The Data Format: why forge writes the rows itself, what the format carries, and the limits that follow
- §5a What a Backup Costs: the page size, the spawn per page, the whole-database memory bound, and what `--no-verify` skips
- §6 Restore and Reset: an empty target only, the whole artifact checked first, and what a reset relies on

---

## 1. The Artifact

`forge db backup` writes a directory named `<database>-<YYYYMMDDTHHMMSSZ>` under `.forge/backups` (or `backupsDir`, or `--out`), holding four files.
The name is the second the backup began, so a second backup of the same database in that second is refused rather than written over the first. Every
file and directory forge writes under `.forge/` is created readable by the owner alone (`0600` and `0700`), since an artifact holds every row the
database does.

| File | What it is | Restores by |
| --- | --- | --- |
| `schema.sql` | The schema alone, from `wrangler d1 export --no-data` | Nothing — it is the record of what the data was shaped by |
| `data.sql` | Rows only, for the app's tables and forge's companions — the migration history among them | `--route migrations`: replay `migrations/`, then load this |
| `full.sql` | The schema, then every row `data.sql` carries | `--route full`: load one self-contained file |
| `migrations/` | Every migration the artifact was taken with, under the name the history recorded | `--route migrations` applies exactly these |
| `manifest.json` | What was read, what it hashes to, and what was proven | Read first by every restore |

---

## 2. Proven Before Written

**Both routes are proven before the artifact is written.** Each is replayed into a throwaway database under `.forge/scratch/`, and three things are
compared against the source: every row of every app table, every row of forge's companion tables, and a digest of the restored schema's app objects
— a merge-join on the table's key, not a positional zip. Any of the three diverging fails the backup, before any manifest is written — so a
directory holding one is a directory whose proof passed. The schema comparison covers app objects only, since the `_forge_*` companion **tables**
are created by forge on route `migrations` rather than declared by any migration — their **rows** are restored, and are compared like any others.
`--no-verify` skips the proof and records in the manifest that nothing was proven, which `restore` repeats back on the way in.

**A backup is a snapshot, and says so.** On a local target it holds the apply lock (`.forge/db-apply.lock`) for the whole run, so a concurrent
`migrate` cannot write underneath the read, and a second verb refuses while it is held naming `backup`. `tables[].rows` is the number of rows the
artifact holds; every table is counted again after the reads and the proof, and a count disagreeing with the rows read refuses the backup naming the
table and both numbers — something outside forge wrote during the read. The incomplete directory holds no `manifest.json`, so no verb will read it.

---

## 3. A Remote Backup Is a Read

`--target remote` or `--target preview` takes no lock and no bookmark: the torn-read count above is the only concurrency guard, and a write during
the read is refused the same way. Both routes are still proven, into a scratch under `.forge/scratch/` forced to `local` whatever the target —
nothing in the proof reaches the deployed database. The manifest names the target and carries a warning saying restore is refused for it, which
`restore` repeats on the way in; the artifact restores into `local`, `standby` or a rehearsal scratch ([`DATABASE_MANAGEMENT.md`][dm-6f] §6f). A
local `reset` selects the most recent verified artifact by database name alone, so a remote artifact of the same name can be the one it relies on —
and its rows must still match, or it is refused as stale like any other.

---

## 4. Self-Contained and Bound

**An artifact is self-contained.** Route `migrations` replays the SQL the artifact embeds, never the checkout: the manifest lists every migration by
name and hash, each of which must read back from `migrations/` hashing to what the manifest declares. The app owns every one of those files, so the
migrations digest the manifest carries is the whole story. This is what makes an artifact restorable from a git checkout years later.

**A replay records nothing, because the history rides in `data.sql`.** Every `_forge_migrations` row is an ordinary row of an ordinary table, so it
is read, written and restored like any other — which makes the restore stricter than a rebuilt history could be. The rows come back with the source
database's own `applied_at`, its certified `fingerprint`, and its explicit `id`, so `ORDER BY id DESC LIMIT 1` picks out the same last row on the
restored database that it picked on the source, and the fingerprint the Worker reads is the one the source certified
([`DATABASE_MANAGEMENT.md`][dm-4a] §4a). A replay that also recorded would collide with every one of those rows on the `name` index; it therefore
applies the bodies and records nothing at all.

The manifest binds the artifact to a schema three ways — the applied migration names, a digest of the app's own schema objects (the same set the
proof compares; the managed tables are created, not restored), and the migrations digest — and a restore reports every one of them that disagrees
with the app as it now stands. Every check a restore or a reset makes — the manifest, the artifact's files against their declared hashes, and a
target that is empty across the app tables and forge's companions alike — runs before the confirmation is asked, so a refused verb never asks. A
restore that ends with a table not matching its declared digest fails, and there is deliberately no repair path: discard the target and retry from
an empty one.

**The manifest records whether the source was the schema its own migrations built.** `drift` holds `match`, `mismatch`, `unrecorded` or
`unavailable` — the state `forge db migrate status` reports, read at the instant the backup was taken. On `mismatch` the run says so on stderr and
the artifact carries a warning a restore prints back, because every digest in the manifest describes the database **as found**: a backup of a
drifted database is still worth having, and is exactly what to take before repairing one. What it may not do is pass that schema off as certified —
the proof compares a restored copy against the source's own digest, so a drifted source proves clean, and `drift` is what says the proof was of the
schema as found ([`DATABASE_MANAGEMENT.md`][dm-6e] §6e).

**The manifest carries a digest of itself.** `selfDigest` is the SHA-256 of the manifest written with that one field blanked, and a restore refuses
one whose bytes do not hash to it. It detects truncation, a swapped file and bit rot. **It does not detect tampering**: anyone who edits a manifest
can recompute the digest. Tamper resistance is a signature, and is out of scope.

---

## 5. The Data Format

**Forge emits the data itself rather than taking wrangler's dump**, because wrangler's dumper is not injective. It writes a newline as a backslash
followed by `n`, and reverses that without escaping the backslash — so a value that already contained those two characters comes back as a newline,
silently. Forge instead writes each row as a single-line `INSERT` naming its columns, with any newline carried on a token that the SQL reverses with
`replace(…, char(10))`; the token is accepted only after decoding it reproduces the input byte for byte. Naming the columns is what lets an artifact
load into a schema whose column order differs. A value holding a NUL byte is refused naming the table and the column, since no SQL text can carry
one.

What the format carries, and the limits that follow from it — each refused up front rather than discovered mid-restore:

- **The value types the format carries** are text, finite numbers, NULL and `BLOB` — a BLOB reads back from `--json` as an array of byte values and
  is written as `X'hex'`, which is what lets a database with 16-byte BLOB keys (forge's own auth schema) be backed up. A REAL that happens to be
  integral is written as `1.0`, since `--json` has already dropped the point and the storage class would otherwise change under a column with no
  affinity; the read carries `typeof` beside every value, which is what tells that `1` from an INTEGER. An integer past 2^53 is refused: it cannot
  round-trip. A stored `±Infinity` arrives from `--json` as `null` under a `real` tag (measured), and is refused for the same reason rather than
  restored as NULL. Text that is not well-formed UTF-8 — only `char()` in hand-run SQL can write it, since a Worker encodes a lone surrogate as
  U+FFFD before D1 sees it — is rendered by `--json` as replacement characters and the read cannot tell; it restores changed.
- **No virtual tables.** `wrangler d1 export` throws on one, which is also why the linter treats `CREATE VIRTUAL TABLE` as an error
  ([`DATABASE_MANAGEMENT.md`][dm-5] §5).
- **No `AUTOINCREMENT` on an app table.** A backup restores keys from the artifact, and an engine-allocated key needs `sqlite_sequence` carried
  alongside it.
- **A key that collates otherwise than BINARY is read by `rowid` instead**, since the read seeks past the last key it saw and compares by code point
  — BINARY's order and no other collation's. A `WITHOUT ROWID` table has no other column to order by and is refused up front, naming the column and
  its collation.
- **A trigger may delete rows.** `full.sql` is checked statement by statement, and a `CREATE TRIGGER … BEGIN … END` is one statement, so a
  `DELETE FROM` inside its body is the trigger's and not a row-removal the dump must never carry.

### 5a. What a Backup Costs, and the Size It Stops Suiting

**This is a documented limit, not a defect.** The reader is shaped for a database a `wrangler` CLI can be driven against, and it is worth knowing
where that stops.

- **One `wrangler d1 execute` spawn per 256 rows.** The page size is a bound on bytes rather than on rows — one page's worst case has to fit in a
  single `--json` result — so a 100k-row table is roughly 400 spawns for one pass over it, and the process spawn dominates the query.
- **The whole database is held in memory at once.** Every table is read whole before anything is written, and each is held twice: the canonical rows
  the artifact is emitted from, and the raw `--json` rows the verification compares against. Peak memory therefore tracks the database's size, not
  the largest table's.
- **A verified backup reads every row again, once per route.** The proof replays `migrations` and `full` into a scratch and compares row by row
  (§2), which is two further passes at the same spawn cost. `--no-verify` skips both — and records in the manifest that nothing about the artifact
  was proven, which is the trade being made.

At tens of thousands of rows this is seconds. At millions it is not the right tool, and Time Travel or a D1 export is.

---

## 6. Restore and Reset

A restore loads into an empty database only: it adds rows and never removes them, so a target holding data is refused with the instruction to
`forge db reset` first. Empty means empty of forge's companion rows too — a target that already holds a migration history cannot take a data-only
load over it.

**A restore checks the whole artifact before it touches the target.** After the manifest is read and before anything is queried, every declared file
is hashed against its `artifacts[].sha256` — a missing one is the same refusal — and the file the route will load is put back through the check that
admitted it at backup time. A damaged artifact is refused with no row loaded, rather than discovered afterwards, where there is deliberately no
repair path.

**An artifact written by an earlier forge is refused by `formatVersion`, not misread.** The field is bumped whenever a manifest field changes
meaning, and the refusal names both numbers and says to take the backup again. An artifact from before forge owned the migration history is one such
— its `data.sql` carries no history rows and its `full.sql` carries wrangler's — and there is no converter, pre-1.0.

`forge db reset` refuses a database holding rows unless a verified artifact still describes them — not "a backup exists". Every app table's count is
compared against the manifest's `tables[].rows` first, refusing immediately and naming the table when one differs; only when every count agrees are
the rows read and each digest compared, which catches an update hiding behind an unchanged count. `--backup <dir>` names the artifact to rely on,
and `--allow-unbacked` skips all of it.

[dm-3]: ./DATABASE_MANAGEMENT.md#3-the-undo-per-place
[dm-4a]: ./DATABASE_MANAGEMENT.md#4a-_forge_migrations--the-migration-history
[dm-5]: ./DATABASE_MANAGEMENT.md#5-the-migration-lint-rules
[dm-6e]: ./DATABASE_MANAGEMENT.md#6e-who-else-holds-the-database-to-its-fingerprint
[dm-6f]: ./DATABASE_MANAGEMENT.md#6f-rehearsing-against-real-rows
