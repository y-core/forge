import { createHash } from "node:crypto";

import { CliError } from "../../cli/errors";
import type { DumpMeter } from "./types";

const INSERT = /^INSERT INTO "((?:[^"]|"")*)" \(/;

const AFTER_DATA = /^CREATE\s+(UNIQUE\s+INDEX|INDEX|TRIGGER|VIEW|TEMP|TEMPORARY)\b/i;

/** Counts each table's `INSERT` statements in a dump fed to it in chunks of any size. @internal */
export function dumpRowCounter(): { push(chunk: Uint8Array): void; finish(): Record<string, number> } {
  const decoder = new TextDecoder();
  const rows: Record<string, number> = {};
  let carry = "";
  let statementStart = true;
  let inData = true;
  const line = (text: string) => {
    // D1's dumper writes one row per line, escaping a newline inside a value, and writes the
    // indexes, triggers and views after every row, so a trigger's body never counts as a row.
    if (statementStart && inData) {
      const insert = INSERT.exec(text);
      if (insert !== null) {
        const table = (insert[1] ?? "").replaceAll('""', '"');
        rows[table] = (rows[table] ?? 0) + 1;
      } else if (AFTER_DATA.test(text)) inData = false;
    }
    statementStart = text.trimEnd().endsWith(";");
  };
  const take = (text: string) => {
    const lines = (carry + text).split("\n");
    carry = lines.pop() ?? "";
    for (const each of lines) line(each);
  };
  return {
    push: (chunk) => take(decoder.decode(chunk, { stream: true })),
    finish: () => {
      take(decoder.decode());
      if (carry !== "") line(carry);
      carry = "";
      return rows;
    },
  };
}

async function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>, idleMs: number): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CliError("external", `the D1 export download sent nothing for ${idleMs} ms`)), idleMs);
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } finally {
    clearTimeout(timer);
  }
}

/** Passes a dump through, hashing it, counting its bytes and rows, and failing it once it stalls for `idleMs`. @internal */
export function meterDump(source: ReadableStream<Uint8Array>, idleMs: number): DumpMeter {
  const md5 = createHash("md5");
  const sha256 = createHash("sha256");
  const counter = dumpRowCounter();
  const reader = source.getReader();
  let size = 0;
  let ended = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await readWithin(reader, idleMs);
      } catch (error) {
        await reader.cancel(error).catch(() => {});
        throw error;
      }
      if (read.done) {
        ended = true;
        controller.close();
        return;
      }
      md5.update(read.value);
      sha256.update(read.value);
      counter.push(read.value);
      size += read.value.byteLength;
      controller.enqueue(read.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return {
    body,
    measure() {
      if (!ended) throw new Error("meterDump: measure() before every chunk was read");
      return { size, md5: md5.digest("hex"), sha256: sha256.digest("hex"), rows: counter.finish() };
    },
  };
}
