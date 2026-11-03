---
title: Database Backups
description: "The D1 backup pipeline: D1's own dump in R2 with a sidecar, what a dump cannot carry, the restore ladder, what reset and rehearse rely on, and what an app may expose over HTTP."
audience: consumer
---

# Database Backups

> Owns what a D1 backup is and what each verb that reads one decides: the dump and its sidecar, the census taken before the export, the transport
> the CLI picks per place, the restore ladder and the report it keeps, the dump `reset` and `--rehearse` rely on, and what an app may expose over
> HTTP.
>
> Defers to: [`src/tooling/db/README.md`][db-readme] for the verbs and their flags; [`src/storage/README.md`][storage-readme] for reading dumps
> from a Worker; [`DATABASE_MANAGEMENT.md`][dm-3] §3 for the undo each place has; [`NAMESPACES.md`][namespaces-5g] §5g for why the pipeline is a
> `tooling` module and never Worker-reachable.

---

## 0. Quick Reference

- §1 A Dump and Its Sidecar: D1's own export in R2, the `.json` written beside it that marks it complete, and a copy kept off R2
- §2 What a Dump Cannot Carry: the hazards the census names, the virtual table that refuses the export, and the exact restore that remains
- §3 The CLI Runs the Pipeline, a Transport per Place: REST for a deployed database, the platform proxy's bindings for a local one
- §3a Scheduled Backups Run From CI or Cron: `forge db backup` on a schedule, never a Worker
- §3b A Failed Run Is Run Again: no resumable retries, and what a failed run leaves behind
- §4 The Restore Ladder: Time Travel first, then an import into a new database, then promotion as its own step
- §4a A Restore Never Targets the Live Database: fresh or empty only, and a fresh name D1 would accept
- §4b What a Restore Checks: the schema digest, the rows per table and the migration head, kept as a report in R2
- §5 Reset and Rehearse Rely on a Local Dump: the age and the row counts a reset holds a dump to
- §6 What an App May Expose Over HTTP: reading dumps and sidecars yes; starting a backup or restore, promotion and Time Travel no

---

## 1. A Dump and Its Sidecar

**A backup is D1's own SQL export, stored as one R2 object.** `forge db backup` asks D1 for the export and puts the dump into the bucket at
`<prefix>/<database id>/<ISO instant>-<bookmark>.sql`. Forge never parses the dump into rows and never writes one itself. The name leads with the
instant, so a listing sorts by age without reading anything. It carries the Time Travel bookmark the export was taken at.

**The sidecar is written after the dump, and its presence is what makes the dump complete.** R2 fixes an object's custom metadata when the object
is written, and the checksums are only known once the dump has passed through. So the facts go in `<same name>.json`, beside the dump. A dump with
no sidecar is a run that never finished: `listD1Backups` marks it incomplete, and `latestD1Backup`, a restore, `reset` and `--rehearse` each pass
over it or refuse it. What the sidecar holds is `D1BackupSidecar` in `src/storage/backup/types.ts`.

**The size, md5 and sha256 are computed as the dump passes through to R2.** A download that stalls fails the run. A dump whose measured size is
zero, or differs from the length the download announced, is deleted from the bucket before the run fails, so it never sits there looking whole.
md5 is the etag D1's import takes, so a restore never re-reads the dump to compute it.

**The rows per table are counted from the dump, not from the database.** D1's dumper writes each row as one `INSERT` on one line, escaping a
newline inside a value. It writes every index, trigger and view after the last row. So a line count is exact at the export's bookmark, which a
`COUNT(*)` taken beside the export would not be while the app keeps writing.

**A dump can leave Cloudflare and come back, checked by sha256 both ways.** `forge db backup pull <key>` streams the dump and its sidecar to disk
and keeps neither unless the bytes match the sidecar's size and sha256. `forge db backup push <file>` checks the file against its sidecar the same
way, then uploads both under the dump's own key, refusing a key the bucket already holds. Against a deployed bucket both go through Cloudflare's
REST object endpoint, which takes at most 300 MiB per upload, so a larger dump goes back through R2's S3 API.

---

## 2. What a Dump Cannot Carry

**Some values do not survive D1's dumper, and the census names them before the export.** It reads every table, over D1's REST query for a
deployed database and through the binding for a local one, and counts these per column:

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

## 3. The CLI Runs the Pipeline, a Transport per Place

**`forge db backup` and `forge db restore --from` run the whole pipeline in the CLI's own process, and only the transport differs by place.** The
target's place picks it, and nothing else does:

| Place | The export and import | The census and checks | The bucket |
| --- | --- | --- | --- |
| deployed | D1's REST export and import | D1's REST query | Cloudflare's REST object endpoint |
| local | `PRAGMA miniflare_d1_export` through the binding, and the import as one `batch` into a standby binding | the binding | the local R2 binding |

The local bindings are the ones `wrangler`'s `getPlatformProxy` opens over the app's local state, so no dev session has to be running. Every other
step (the census, the digests, the row count, the sidecar, the validation, the pruning) runs the same code in both places.

**The pipeline lives in `tooling/db`, never in a namespace a Worker imports** ([`NAMESPACES.md`][namespaces-5g] §5g). A backup or restore needs a
token holding D1 Edit on the account. Kept in the CLI, that token lives with the operator or the CI secret store, and never becomes a Worker secret
that a compromised Worker could read. `storage/backup` keeps only what reads a dump: the listing, the sidecar and the types.

**A dump goes into R2 as one put of known length.** Deployed, the download streams straight into the upload under the length its `Content-Length`
announced. A download that announces no length, or more than the REST object endpoint's 300 MiB cap, is refused before any upload. Locally, the
proxy's R2 binding refuses a stream of unknown length, so the dump is read whole first; a local database is dev-sized.

**A local dump is named `local-<epoch ms>` in place of a bookmark**, since local D1 keeps no Time Travel.

### 3a. Scheduled Backups Run From CI or Cron

**A backup on a schedule is `forge db backup --target remote` run by a CI schedule or a cron job,** with the account id and the API token
passed as flags from that runner's secrets. No Worker starts a backup, and nothing in the app's own wrangler config is involved. Age
dumps out with `--keep`, or with an R2 lifecycle rule set by `forge cf sync lifecycle`, which R2 applies on its own.

### 3b. A Failed Run Is Run Again

**Neither verb resumes or retries a run.** A run either finishes or fails, and the failure says to run the verb again. What a failed run leaves is
safe to leave:

- **A failed backup** leaves nothing, or a dump with no sidecar. Listing marks that dump incomplete, and nothing that reads dumps relies on it.
- **A failed restore** leaves a database that is not the live one (§4a), so the next run goes into a new or empty database.

A refusal of the request itself, such as a bad flag or a dump too large to upload, is not a failed run, and says what to change instead. Nor is a
backup whose prune past `--keep` fails: its dump and sidecar are stored, so it exits 1 saying so, and the next backup with the same `--keep`
prunes again rather than this one being repeated.

---

## 4. The Restore Ladder

1. **Within Time Travel's window, restore the dump's bookmark.** `forge db bookmark restore --bookmark <bookmark>` returns the database to exactly
   the state the dump holds, moves no data and prints its own undo ([`DATABASE_MANAGEMENT.md`][dm-3] §3). It is the default whenever it applies.
2. **Past the window, or to check before going live, import the dump into a new database** with `forge db restore --from`. The report names every
   way the result differs from the sidecar (§4b). A restore reads only from the bucket, so a dump kept off R2 is pushed back first with
   `forge db backup push` (§1).
3. **Promotion is a separate, deliberate step.** Pointing the app's binding at the restored database changes what every request reads, so nothing in
   a restore does it. `forge db promote --restored <database id>` reads the restore's report from R2, refuses one with a mismatch or one restored
   from another database's dump, and rewrites the binding's `database_id` and `database_name` in the wrangler config once you confirm. It prints the
   swap-back command, keeps the old database as the fallback, and leaves the deploy to you, since forge drives no deploy.

### 4a. A Restore Never Targets the Live Database

**A restore imports into a database it creates, or into an empty standby.** D1's import needs an empty target, and D1 cannot copy one database into
another. So `--into fresh` creates a database, and `--into standby:<id>` takes an existing one and refuses it if it already holds a table. A
database of the same name that a lost reply already created is adopted, and it is held to the same emptiness check. Local D1 cannot create a
database, so locally only a standby binding is accepted.

**A fresh database is named `<database>-restore-<epoch ms>`, and a name D1 would refuse is refused before anything is sent.** D1 caps a database
name at 64 characters, and promotion refuses a name past it. So restore builds the name first and refuses it while nothing has been created; the
standby route has no such limit.

**A restore is never retried in place** (§3b). D1 begins importing at `init` when it already holds a file with the dump's md5, so a second start
against the same target could import the dump twice. The target is disposable, so the remedy for a failed restore is a new run into a new or
empty database.

### 4b. What a Restore Checks

The restored database is read back and held to the sidecar. Its schema digest is computed over the same objects in the same way
(`schemaDigest` in `src/tooling/db/backup/census.ts`). Each table must hold the rows the dump holds. And the last row of `_forge_migrations` must be
the migration head the census recorded. Each difference is a line in the report's `mismatches`, and `forge db restore` exits non-zero on any.
`num_queries`, the statement count D1's import answers, is reported and never compared, since what it counts is not documented.

**The report is kept in R2, match or not, at `<prefix>/<database id>/restores/<restored id>.json`.** It is filed beside the dumps of the database
the run targeted, under the id of the database it restored into. Promotion reads it from there, so the refusal of a mismatch does not depend on
the operator's terminal scrollback. A listing of dumps reads only `<instant>-<bookmark>.sql` directly under the database's prefix, so a report is
never listed or pruned as a dump.

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

**An app may expose reading, and only reading.** `storage/backup` ships `listD1Backups`, `latestD1Backup` and `readD1Backup`, and an app may
mount them behind its admin guard ([`AUTH_MOUNTING.md`][am-2] §2). None of them changes anything, so a listing page or a health check that alerts
on a stale dump is safe to serve.

**Starting a backup or a restore is operator-only.** Each runs from `forge db` on an operator's machine or a CI runner, never from a request,
because the token each needs stays out of the Worker (§3). A scheduled backup is the CI or cron job of §3a.

These stay on an operator's machine too, where the CLI asks first and prints its undo:

- **Promotion**, which points the app's binding at a restored database. Once deployed, it changes what every request reads.
- **A Time Travel restore**, which rewrites the live database in place, even though it can be undone.

[am-2]: ./AUTH_MOUNTING.md#2-the-route-groups-and-their-guards
[db-readme]: ../src/tooling/db/README.md#backing-up-and-restoring
[dm-3]: ./DATABASE_MANAGEMENT.md#3-the-undo-per-place
[dm-6f]: ./DATABASE_MANAGEMENT.md#6f-rehearsing-against-real-rows
[namespaces-5g]: ./NAMESPACES.md#5g-tooling--where-a-developer-facing-tool-belongs
[storage-readme]: ../src/storage/README.md#listing-backups-from-an-admin-page
