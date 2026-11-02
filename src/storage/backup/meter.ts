import { bytesToHex } from "../../crypto/primitives/mod";
import { D1BackupError } from "./errors";
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

function digester(algorithm: "MD5" | "SHA-256"): { writer: WritableStreamDefaultWriter<ArrayBufferView>; digest: Promise<ArrayBuffer> } {
  const DigestStream = crypto.DigestStream;
  if (DigestStream === undefined) throw new D1BackupError("unsupported", "crypto.DigestStream is missing — run the backup in a Worker");
  const stream = new DigestStream(algorithm);
  return { writer: stream.getWriter(), digest: stream.digest };
}

async function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>, idleMs: number): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new D1BackupError("download", `the D1 export download sent nothing for ${idleMs} ms`)), idleMs);
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } finally {
    clearTimeout(timer);
  }
}

/** Passes a dump through, hashing it, counting its bytes and rows, and failing it once it stalls for `idleMs`. @internal */
export function meterDump(body: ReadableStream<Uint8Array>, idleMs: number): DumpMeter {
  const md5 = digester("MD5");
  const sha256 = digester("SHA-256");
  const counter = dumpRowCounter();
  let size = 0;
  let ended = false;
  async function* chunks(): AsyncGenerator<Uint8Array> {
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await readWithin(reader, idleMs);
        if (done) break;
        await Promise.all([md5.writer.write(value), sha256.writer.write(value)]);
        counter.push(value);
        size += value.byteLength;
        yield value;
      }
      ended = true;
    } finally {
      if (!ended) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  return {
    chunks: chunks(),
    async measure() {
      if (!ended) throw new Error("meterDump: measure() before every chunk was read");
      await Promise.all([md5.writer.close(), sha256.writer.close()]);
      const [md5Hex, sha256Hex] = (await Promise.all([md5.digest, sha256.digest])).map((buffer) => bytesToHex(new Uint8Array(buffer)));
      return { size, md5: md5Hex ?? "", sha256: sha256Hex ?? "", rows: counter.finish() };
    },
  };
}
