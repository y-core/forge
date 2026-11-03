import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";

import { listD1Backups, sidecarKey } from "../../../storage/backup/list";
import { parseSidecar, readSidecarValue } from "../../../storage/backup/sidecar";
import type { D1BackupRecord, D1BackupSidecar } from "../../../storage/backup/types";
import { CliError } from "../../cli/errors";
import { sha256 } from "../digest";
import type { DbRunContext } from "../types";
import { openDumpBucket } from "./dumps";
import type { DumpCopy, DumpSource } from "./types";

/** `body` passed through unchanged, and the sha256 and byte count of what passed once it has ended. */
function measured(body: ReadableStream<Uint8Array>): { body: ReadableStream<Uint8Array>; measure(): { sha256: string; size: number } } {
  const hash = createHash("sha256");
  let size = 0;
  const counted = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        hash.update(chunk);
        size += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }),
  );
  return { body: counted, measure: () => ({ sha256: hash.digest("hex"), size }) };
}

function mismatch(sidecar: D1BackupSidecar, got: { sha256: string; size: number }): string | null {
  if (got.size !== sidecar.size) return `${got.size} bytes where its sidecar records ${sidecar.size}`;
  if (got.sha256 !== sidecar.sha256) return `sha256 ${got.sha256} where its sidecar records ${sidecar.sha256}`;
  return null;
}

/** Every dump of the run's database in the bucket, newest first, each marked by whether its sidecar was written. @internal */
export async function listDumps(run: DbRunContext, source: DumpSource): Promise<D1BackupRecord[]> {
  return listD1Backups(await openDumpBucket(run, source), { databaseId: source.databaseId, prefix: source.prefix });
}

/** Streams the dump at `key` into `out`, hashing it as it lands, and writes its sidecar beside it once the bytes match. @internal */
export async function pullDump(run: DbRunContext, source: DumpSource, key: string, out: string): Promise<DumpCopy> {
  const bucket = await openDumpBucket(run, source);
  const dir = resolve(out);
  const path = join(dir, basename(key));
  const sidecarPath = join(dir, basename(sidecarKey(key)));
  for (const target of [path, sidecarPath]) if (run.io.exists(target)) throw new CliError("invalid-args", `${target} already exists`);

  const sidecarObject = await bucket.get(sidecarKey(key));
  if (sidecarObject === null) throw new CliError("invalid-args", `${key} has no sidecar in ${source.binding}, so its backup never finished`);
  const sidecarText = await sidecarObject.text();
  const sidecar = parseSidecar(sidecarText, key);
  const object = await bucket.get(key);
  if (object === null) throw new CliError("invalid-args", `${key} is gone from ${source.binding}, though its sidecar is there`);

  run.io.mkdir(dir);
  const passing = measured(object.body);
  try {
    await run.io.writeStream(path, passing.body);
  } catch (error) {
    run.io.remove(path);
    throw error;
  }
  const differs = mismatch(sidecar, passing.measure());
  if (differs !== null) {
    run.io.remove(path);
    throw new CliError("external", `${key} arrived as ${differs} — nothing was kept`);
  }
  run.io.writeText(sidecarPath, sidecarText);
  return { key, path, sidecar: sidecarPath, size: sidecar.size, sha256: sidecar.sha256 };
}

/** The sidecar beside a dump file on disk, refused unless it is one `forge db backup` wrote for a dump of that file's name. */
function readSidecarBeside(run: DbRunContext, path: string): { sidecar: D1BackupSidecar; text: string; path: string } {
  if (!path.endsWith(".sql")) throw new CliError("invalid-args", `${path} is not a dump — a dump's file name ends in .sql`);
  const sidecarPath = join(dirname(path), basename(sidecarKey(path)));
  if (!run.io.exists(path)) throw new CliError("invalid-args", `${path} does not exist`);
  if (!run.io.exists(sidecarPath)) throw new CliError("invalid-args", `${path} has no sidecar beside it — push needs ${sidecarPath}`);
  const text = run.io.readText(sidecarPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const sidecar = readSidecarValue(parsed);
  if (sidecar === null) throw new CliError("invalid-args", `${sidecarPath} is not a sidecar forge db backup wrote`);
  if (basename(sidecar.key) !== basename(path)) {
    throw new CliError("invalid-args", `${sidecarPath} is the sidecar of ${sidecar.key}, not of ${basename(path)}`);
  }
  return { sidecar, text, path: sidecarPath };
}

/** Refuses a sidecar recording another database's dump, or a key outside the run's database prefix. */
function assertDumpBelongs(source: DumpSource, sidecar: D1BackupSidecar, sidecarPath: string): void {
  if (sidecar.databaseId !== source.databaseId) {
    throw new CliError(
      "invalid-args",
      `${sidecarPath} records a dump of database ${sidecar.databaseId}, not of ${source.databaseId} — nothing was uploaded`,
    );
  }
  const under = `${source.prefix}/${source.databaseId}/`;
  if (!sidecar.key.startsWith(under)) {
    throw new CliError("invalid-args", `${sidecarPath} records the key ${sidecar.key}, which is not under ${under} — nothing was uploaded`);
  }
}

/** Uploads a dump file under the key its sidecar records, reading it once, and writes the sidecar only once the bytes match it. @internal */
export async function pushDump(run: DbRunContext, source: DumpSource, file: string): Promise<DumpCopy> {
  const path = resolve(file);
  const beside = readSidecarBeside(run, path);
  const { sidecar } = beside;
  assertDumpBelongs(source, sidecar, beside.path);

  const bucket = await openDumpBucket(run, source);
  for (const key of [sidecar.key, sidecarKey(sidecar.key)]) {
    const held = await bucket.get(key);
    if (held === null) continue;
    await held.body.cancel();
    throw new CliError("invalid-args", `${source.binding} already holds ${key} — push never replaces an object`);
  }

  // The dev session's binding needs a body of known length, and a local database is dev-sized.
  if (run.home.persistTo !== null) {
    const bytes = await new Response(run.io.readStream(path)).bytes();
    const differs = mismatch(sidecar, { sha256: sha256(bytes), size: bytes.byteLength });
    if (differs !== null) throw new CliError("invalid-args", `${path} is ${differs} — nothing was uploaded`);
    await bucket.put(sidecar.key, bytes);
  } else {
    const passing = measured(run.io.readStream(path));
    await bucket.put(sidecar.key, passing.body, { contentLength: sidecar.size });
    const differs = mismatch(sidecar, passing.measure());
    if (differs !== null) {
      await bucket.delete(sidecar.key);
      throw new CliError("invalid-args", `${path} is ${differs} — nothing was kept`);
    }
  }
  await bucket.put(sidecarKey(sidecar.key), beside.text, { httpMetadata: { contentType: "application/json" } });
  return { key: sidecar.key, path, sidecar: beside.path, size: sidecar.size, sha256: sidecar.sha256 };
}
