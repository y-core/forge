---
title: Database Backups
description: "The D1 backup pipeline: D1's own dump in R2 with a sidecar, what a dump cannot carry, the restore ladder, what reset and rehearse rely on, and what an app may expose over HTTP."
audience: consumer
---

# Database Backups

> Owns what a D1 backup is and what each verb that reads one decides: the dump and its sidecar, the census taken before the export, the transports
> the one pipeline runs on, the restore ladder, and the dump `reset` and `--rehearse` rely on. How to wire the Workflows is
> [`src/storage/README.md`][storage-readme]'s; the undo each place has is [`DATABASE_MANAGEMENT.md`][dm-3] §3's.

---

## 0. Quick Reference

- §1 A Dump and Its Sidecar: D1's own export in R2, the `.json` written beside it that marks it complete, and a copy kept off R2
- §2 What a Dump Cannot Carry: the hazards the census names, the virtual table that refuses the export, and the exact restore that remains
- §3 One Pipeline, a Transport per Place: REST for a deployed database, the bindings under `forge cf dev`, and the CLI as a driver
- §4 The Restore Ladder: Time Travel first, then an import into a new database, then promotion as its own step
- §4a A Restore Never Targets the Live Database: fresh or empty only, and an import started once
- §4b What a Restore Checks: the schema digest, the rows per table and the migration head
- §5 Reset and Rehearse Rely on a Local Dump: the age and the row counts a reset holds a dump to
- §6 What an App May Expose Over HTTP: backup, listing and restore into a new database yes; promotion and Time Travel no

---

## 1. A Dump and Its Sidecar

**A backup is D1's own SQL export, stored as one R2 object.** `runD1Backup` asks D1 for the export and streams the dump into the bucket at
`<prefix>/<database id>/<ISO instant>-<bookmark>.sql`. Forge never parses the dump into rows and never writes one itself. The name leads with the
instant, so a listing sorts by age without reading anything. It carries the Time Travel bookmark the export was taken at.

**The sidecar is written after the dump, and its presence is what makes the dump complete.** R2 fixes an object's custom metadata when the object
is written, and the checksums are only known once the stream has ended. So the facts go in `<same name>.json`, beside the dump. A dump with no
sidecar is a run that never finished: `listD1Backups` marks it incomplete, and `latestD1Backup`, a restore, `reset` and `--rehearse` each pass over
it or refuse it. What the sidecar holds is `D1BackupSidecar` in `src/storage/backup/types.ts`.

**The size, md5 and sha256 are computed as the dump streams through.** A download shorter than its `Content-Length` aborts the upload and stores
nothing, and so does one that stalls for `idleTimeoutMs`. md5 is the etag D1's import takes, so a restore never re-reads the dump to compute it.

**The rows per table are counted from the stream, not from the database.** D1's dumper writes each row as one `INSERT` on one line, escaping a
newline inside a value. It writes every index, trigger and view after the last row. So a line count is exact at the export's bookmark, which a
`COUNT(*)` taken beside the export would not be while the app keeps writing.

**A dump can leave Cloudflare and come back, checked by sha256 both ways.** `forge db backup pull <key>` streams the dump and its sidecar to disk
and keeps neither unless the bytes match the sidecar's size and sha256. `forge db backup push <file>` checks the file against its sidecar the same
way, then uploads both under the dump's own key, refusing a key the bucket already holds. Against a deployed bucket both go through Cloudflare's
REST object endpoint, which takes at most 300 MiB per upload, so a larger dump goes back through R2's S3 API.

---

## 2. What a Dump Cannot Carry

**Some values do not survive D1's dumper, and the census names them before the export.** It reads every table through the database's own binding
and counts these per column:

- **A text value holding both a real newline and the two characters `\n`.** The dumper writes the newline as `\n` and wraps the value in
  `replace(…,'\n',char(10))`, which turns the literal `\n` into a newline too.
- **An integer past ±2^53**, which the dumper rounds through a JavaScript number.
- **A whole-number REAL in a column without REAL affinity**, which reads back as INTEGER.

The dump is still stored. The sidecar's `hazards` names each table, column and count, and `forge db backup` prints them as warnings and exits zero.
A table whose scan fails is recorded `unscanned`, never silently clean. The census runs before the export, so a value written in between can escape
it.

**A virtual table refuses the backup before the export starts.** D1's dumper throws on `CREATE VIRTUAL TABLE`, so the census refuses it first,
naming the table.

**No exact backup remains, and this is accepted.** Within Time Travel's window, the dump's bookmark restores the database exactly, hazards
included (§4). Past it, a dump with hazards restores with those values changed, and its sidecar says which.

---

## 3. One Pipeline, a Transport per Place

**Backup and restore are one set of Workflow steps in `storage/backup`, and only the transport differs.** Against a deployed database the transport
is D1's REST export and import. Under `forge cf dev` it is the `#relax/d1-transfer` port ([`NAMESPACES.md`][namespaces-5i] §5i): the export is
miniflare's `PRAGMA miniflare_d1_export` through the database's binding, and the import is one `db.batch` into a standby binding. Every other step
(the census, the digests, the row count, the sidecar, the validation, the pruning) runs the same code locally as it does deployed. A production
bundle carries the REST transport alone.

**A local dump is named `local-<epoch ms>` in place of a bookmark**, since local D1 keeps no Time Travel.

**The CLI drives the Workflows rather than repeating them.** `forge db backup` starts the app's `d1-backup` Workflow and `forge db restore --from`
its `d1-restore` Workflow, then each follows the instance to its end and prints what the run returned. A deployed database is reached through the
Cloudflare API, and a local one through the running `forge cf dev` session.

---

## 4. The Restore Ladder

1. **Within Time Travel's window, restore the dump's bookmark.** `forge db bookmark restore --bookmark <bookmark>` returns the database to exactly
   the state the dump holds, moves no data and prints its own undo ([`DATABASE_MANAGEMENT.md`][dm-3] §3). It is the default whenever it applies.
2. **Past the window, or to check before going live, import the dump into a new database** with `runD1Restore`, through `forge db restore --from`
   or the app's own route (§6). The report names every way the result differs from the sidecar (§4b). A restore reads only from the bucket, so a
   dump kept off R2 is pushed back first with `forge db backup push` (§1).
3. **Promotion is a separate, deliberate step.** Pointing the app's binding at the restored database changes what every request reads, so nothing in
   a restore does it. `forge db promote --instance <id>` reads the restore's report, refuses one with a mismatch, and rewrites the binding's
   `database_id` and `database_name` in the wrangler config once you confirm. It prints the swap-back command, keeps the old database as the
   fallback, and leaves the deploy to you, since forge drives no deploy.

### 4a. A Restore Never Targets the Live Database

**A restore imports into a database it creates, or into an empty standby.** D1's import needs an empty target, and D1 cannot copy one database into
another. So a restore creates `into.fresh`, or takes `into.standby` and refuses it if it already holds a table. A database of the same name that a
lost reply already created is adopted, and it is held to the same emptiness check. A dev session cannot create a database, so locally only a standby
is accepted.

**The import's start runs once.** D1 begins importing at `init` when it already holds a file with the dump's md5, so a retried start could import
the dump twice. The step that starts it has no retries, and a failure fails the run; the target is disposable, so the remedy is a new run into a new
database. Polling an import already started is retried like any read.

### 4b. What a Restore Checks

The restored database is read back and held to the sidecar. Its schema digest is computed over the same objects in the same way
(`schemaDigest` in `src/storage/backup/census.ts`). Each table must hold the rows the dump holds. And the last row of `_forge_migrations` must be
the migration head the census recorded. Each difference is a line in the report's `mismatches`, and `forge db restore` exits non-zero on any.
`num_queries`, the statement count D1's import answers, is reported and never compared, since what it counts is not documented.

---

## 5. Reset and Rehearse Rely on a Local Dump

**`forge db reset` refuses a database holding rows unless a dump still describes them, not merely because a dump exists.** It reads the newest
complete dump in the local R2 bucket (`BACKUPS`, or `--bucket`). The dump must be under 24 hours old, and each table's live row count must equal
the rows its sidecar recorded. Otherwise the reset is refused, naming each table that moved. A count cannot see an update that leaves it unchanged;
that is the price of a dump forge does not read row by row. `--dump <key>` names the dump to rely on, a dump of another database is refused, and
`--allow-unbacked` skips all of it.

**`forge db migrate --rehearse` loads a dump into a scratch database before it applies anything** ([`DATABASE_MANAGEMENT.md`][dm-6f] §6f). The load
is held to the sidecar as a restore is (§4b), and the dump must have been taken at the migration the target is at.

---

## 6. What an App May Expose Over HTTP

`storage/backup` ships functions, not routes. An app may mount these behind its admin guard, with CSRF on each POST
([`AUTH_MOUNTING.md`][am-2] §2), because none of them changes what the live app reads:

- **Starting a backup**: `env.<WORKFLOW>.create()` on the Workflow that calls `runD1Backup`.
- **Listing dumps and reading a sidecar**: `listD1Backups`, `latestD1Backup` and `readD1Backup`.
- **Restoring a dump with `runD1Restore`**, because it only ever imports into a database it creates, or into an empty standby. The live database
  is never its target, so a stolen admin session can at worst create a database.

These stay on an operator's machine, where the CLI asks first and prints its undo:

- **Promotion**, which points the app's binding at a restored database. Once deployed, it changes what every request reads.
- **A Time Travel restore**, which rewrites the live database in place, even though it can be undone.

[am-2]: ./AUTH_MOUNTING.md#2-the-route-groups-and-their-guards
[dm-3]: ./DATABASE_MANAGEMENT.md#3-the-undo-per-place
[dm-6f]: ./DATABASE_MANAGEMENT.md#6f-rehearsing-against-real-rows
[namespaces-5i]: ./NAMESPACES.md#5i-dev-only-relaxations--a-relax-module-never-a-boolean-on-a-production-option
[storage-readme]: ../src/storage/README.md#archiving-a-d1-database-into-r2-on-a-schedule
