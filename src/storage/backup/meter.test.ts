import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import { installDigestStream } from "./backup.fixture";
import { dumpRowCounter, meterDump } from "./meter";

installDigestStream();

const encode = (text: string) => new TextEncoder().encode(text);

function count(dump: string, chunk: number): Record<string, number> {
  const counter = dumpRowCounter();
  const bytes = encode(dump);
  for (let start = 0; start < bytes.byteLength; start += chunk) counter.push(bytes.subarray(start, start + chunk));
  return counter.finish();
}

describe("dumpRowCounter()", () => {
  const dump = [
    "PRAGMA defer_foreign_keys=TRUE;",
    'CREATE TABLE "t" (',
    "  a TEXT",
    ");",
    "INSERT INTO \"t\" (\"a\") VALUES(replace('x\\ny','\\n',char(10)));",
    'INSERT INTO "t" ("a") VALUES(\'é\');',
    'INSERT INTO "we""ird" ("b") VALUES(1);',
    "CREATE TRIGGER t_ai AFTER INSERT ON t BEGIN",
    'INSERT INTO "t" ("a") VALUES(1);',
    'INSERT INTO "t" ("a") VALUES(2);',
    "END;",
  ].join("\n");

  it("counts each table's rows, unquoting its name, and none inside a trigger body", () => {
    expect(count(dump, 4096)).toEqual({ t: 2, 'we"ird': 1 });
  });

  it("counts the same when every chunk splits a line or a multi-byte character", () => {
    expect(count(dump, 1)).toEqual(count(dump, 4096));
  });

  it("counts a last row with no trailing newline", () => {
    expect(count('INSERT INTO "t" ("a") VALUES(1);', 7)).toEqual({ t: 1 });
  });
});

describe("meterDump()", () => {
  it("passes every chunk through and measures its size, md5, sha256 and rows", async () => {
    const dump = 'INSERT INTO "t" ("a") VALUES(1);\n';
    const meter = meterDump(new Response(dump).body ?? new ReadableStream(), 1000);
    const passed: number[] = [];
    for await (const chunk of meter.chunks) passed.push(...chunk);

    expect(new TextDecoder().decode(new Uint8Array(passed))).toBe(dump);
    expect(await meter.measure()).toEqual({
      size: dump.length,
      md5: createHash("md5").update(dump).digest("hex"),
      sha256: createHash("sha256").update(dump).digest("hex"),
      rows: { t: 1 },
    });
  });

  it("refuses to measure a dump not yet read through", async () => {
    await expect(meterDump(new Response("x").body ?? new ReadableStream(), 1000).measure()).rejects.toThrow("before every chunk");
  });

  it("cancels the body when the reader stops early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull: (controller) => controller.enqueue(encode("x")), cancel: () => void (cancelled = true) });
    const chunks = meterDump(body, 1000).chunks[Symbol.asyncIterator]();
    await chunks.next();
    await chunks.return?.(undefined);
    expect(cancelled).toBe(true);
  });
});
