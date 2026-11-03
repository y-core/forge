import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import { CliError } from "../../cli/errors";
import { dumpRowCounter, meterDump } from "./meter";

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
  it("passes every byte through and measures its size, md5, sha256 and rows", async () => {
    const dump = 'INSERT INTO "t" ("a") VALUES(1);\n';
    const meter = meterDump(new Response(dump).body ?? new ReadableStream(), 1000);
    const passed = new Uint8Array(await new Response(meter.body).arrayBuffer());

    expect(new TextDecoder().decode(passed)).toBe(dump);
    expect(meter.measure()).toEqual({
      size: dump.length,
      md5: createHash("md5").update(dump).digest("hex"),
      sha256: createHash("sha256").update(dump).digest("hex"),
      rows: { t: 1 },
    });
  });

  it("refuses to measure a dump not yet read through", () => {
    expect(() => meterDump(new Response("x").body ?? new ReadableStream(), 1000).measure()).toThrow("before every chunk");
  });

  it("cancels the source when the body is cancelled", async () => {
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({ pull: (controller) => controller.enqueue(encode("x")), cancel: () => void (cancelled = true) });
    const reader = meterDump(source, 1000).body.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelled).toBe(true);
  });

  it("fails a source that sends nothing for `idleMs`, cancelling it", async () => {
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel: () => void (cancelled = true) });
    const error = await new Response(meterDump(source, 5).body).arrayBuffer().catch((thrown: unknown) => thrown);
    expect([error instanceof CliError, (error as CliError).kind, (error as CliError).message, cancelled]).toEqual([
      true,
      "external",
      "the D1 export download sent nothing for 5 ms",
      true,
    ]);
  });
});
