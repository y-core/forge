import { describe, expect, it } from "bun:test";

import { insertStatement, SqlReal, sqlValueExpression, UnsupportedValue } from "./literal";
import { quoteSqlLiteral } from "./sql";

function capture(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
}

const NUL = String.fromCharCode(0);
const BACKSLASH_N = `${String.fromCharCode(92)}n`;

const REPLACE_CALL = /^replace\((.+),'(~~[NR]\d*~~)',char\((10|13)\)\)$/;

/** SQLite's own reading of what `sqlValueExpression` emits, applied innermost-first as the engine would. */
function evaluateSqlText(expression: string): string {
  const call = REPLACE_CALL.exec(expression);
  if (call !== null) return evaluateSqlText(call[1] ?? "").replaceAll(call[2] ?? "", call[3] === "10" ? "\n" : "\r");
  if (!expression.startsWith("'") || !expression.endsWith("'")) throw new Error(`not a SQL string literal: ${expression}`);
  return expression.slice(1, -1).replaceAll("''", "'");
}

const ROUND_TRIPS: readonly { readonly why: string; readonly value: string }[] = [
  { why: "plain text with newlines", value: "## Resolution\nthe claim raced and lost\n" },
  { why: "text already holding the first token the encoder would pick", value: "a ~~N~~ token\nand a newline" },
  { why: "text already holding both tokens and both line endings", value: "~~N~~ and ~~R~~\nboth\r\nverbatim" },
  { why: "text holding the two characters backslash-n, which is what wrangler rewrites", value: `a${BACKSLASH_N}b\nc` },
  { why: "text holding single quotes, which are the literal's own escape", value: "it's 'quoted'\nand it's still quoted" },
  { why: "text holding a token, a backslash-n, quotes and both line endings at once", value: `~~N~~ '${BACKSLASH_N}' ~~R~~\r\n~~N1~~ 'x'\n\r end` },
];

describe("sqlValueExpression() — the wrangler corruption this replaces", () => {
  it("leaves a backslash verbatim inside the literal, so backslash-n is never an escape", () => {
    expect(sqlValueExpression("details", `C:${BACKSLASH_N}otes`)).toBe(`'C:${BACKSLASH_N}otes'`);
  });

  it("carries a real newline and a literal backslash-n in one value without either becoming the other", () => {
    const value = `a${BACKSLASH_N}b\nc`;

    expect(sqlValueExpression("details", value)).toBe(`replace('a${BACKSLASH_N}b~~N~~c','~~N~~',char(10))`);
    expect(evaluateSqlText(sqlValueExpression("details", value))).toBe(value);
  });

  it("keeps a backslash-n value and the newline it would be mistaken for as different expressions", () => {
    expect(sqlValueExpression("details", BACKSLASH_N) === sqlValueExpression("details", "\n")).toBe(false);
  });
});

describe("sqlValueExpression() — the plain values", () => {
  it("returns exactly the quoted literal for a value with no line ending", () => {
    expect(sqlValueExpression("summary", "claim the next task")).toBe(quoteSqlLiteral("claim the next task"));
    expect(sqlValueExpression("summary", "it's quoted")).toBe(quoteSqlLiteral("it's quoted"));
  });

  it("writes NULL for null, which an empty string must not collide with", () => {
    expect(sqlValueExpression("resolution", null)).toBe("NULL");
    expect(sqlValueExpression("resolution", "")).toBe("''");
  });

  it("writes a byte array as a blob literal, and an empty one as the empty blob", () => {
    expect(sqlValueExpression("id", [1, 2, 3])).toBe("X'010203'");
    expect(sqlValueExpression("id", [0, 255, 16])).toBe("X'00ff10'");
    expect(sqlValueExpression("id", [])).toBe("X''");
    expect(sqlValueExpression("id", new Uint8Array([171, 205]))).toBe("X'abcd'");
  });

  it("writes an integral REAL with its point, so a column with no affinity keeps the storage class", () => {
    expect(sqlValueExpression("weight", new SqlReal(1))).toBe("1.0");
    expect(sqlValueExpression("weight", new SqlReal(-3))).toBe("-3.0");
    expect(sqlValueExpression("weight", new SqlReal(2.5))).toBe("2.5");
    expect(sqlValueExpression("weight", new SqlReal(1e21))).toBe("1e+21");
  });

  it("writes a number unquoted and TEXT quoted, so affinity lands each in the column as it was read", () => {
    expect([sqlValueExpression("seq", 124), sqlValueExpression("ordinal", 0), sqlValueExpression("seq", -1)]).toEqual(["124", "0", "-1"]);
    expect(sqlValueExpression("weight", 1.5)).toBe("1.5");
    expect(sqlValueExpression("ordinal", "0")).toBe("'0'");
  });
});

describe("sqlValueExpression() — the newline encoding", () => {
  it("wraps a newline and a carriage return in the replace() the restore undoes, pinned to the byte", () => {
    expect(sqlValueExpression("details", "a\nb")).toBe("replace('a~~N~~b','~~N~~',char(10))");
    expect(sqlValueExpression("details", "a\rb")).toBe("replace('a~~R~~b','~~R~~',char(13))");
  });

  it("emits both wrappers for a CRLF, char(10) inside char(13)", () => {
    expect(sqlValueExpression("details", "a\r\nb")).toBe("replace(replace('a~~R~~~~N~~b','~~N~~',char(10)),'~~R~~',char(13))");
  });

  it("escalates past every candidate the value contains, not merely the first", () => {
    expect(sqlValueExpression("details", "a~~N~~b\nc")).toBe("replace('a~~N~~b~~N1~~c','~~N1~~',char(10))");
    expect(sqlValueExpression("details", "x~~N~~x~~N1~~x\ny")).toBe("replace('x~~N~~x~~N1~~x~~N2~~y','~~N2~~',char(10))");
  });

  for (const { why, value } of ROUND_TRIPS) {
    it(`round-trips through SQLite's own decode: ${why}`, () => {
      expect(evaluateSqlText(sqlValueExpression("details", value))).toBe(value);
    });
  }

  it("refuses a value that occupies every candidate token rather than corrupting it", () => {
    const tokens = Array.from({ length: 64 }, (_, index) => `x~~N${index === 0 ? "" : index}~~`).join("");
    const error = capture(() => sqlValueExpression("details", `${tokens}\n`)) as UnsupportedValue;

    expect(error.column).toBe("details");
    expect(error.message).toBe("details: no newline token survives a round trip against this value — every candidate occurs in the data");
  });
});

describe("sqlValueExpression() — what it refuses", () => {
  it("refuses a boolean, a value no BLOB could be and an undefined, naming the column", () => {
    expect((capture(() => sqlValueExpression("lane", true)) as UnsupportedValue).message).toBe(
      "lane: a boolean cannot be written as SQL — a BLOB is a Uint8Array or an array of byte values, and this is not one",
    );
    expect((capture(() => sqlValueExpression("payload", [1, "a"])) as UnsupportedValue).message).toBe(
      "payload: a object cannot be written as SQL — a BLOB is a Uint8Array or an array of byte values, and this is not one",
    );
    expect((capture(() => sqlValueExpression("payload", { length: 1 })) as UnsupportedValue).message).toBe(
      "payload: a object cannot be written as SQL — a BLOB is a Uint8Array or an array of byte values, and this is not one",
    );
    expect((capture(() => sqlValueExpression("closed_at", undefined)) as UnsupportedValue).message).toBe(
      "closed_at: a undefined cannot be written as SQL — a BLOB is a Uint8Array or an array of byte values, and this is not one",
    );
  });

  it("refuses an integer past 2^53, a NaN and an Infinity", () => {
    expect((capture(() => sqlValueExpression("seq", Number.MAX_SAFE_INTEGER + 2)) as UnsupportedValue).message).toBe(
      "seq: the integer 9007199254740992 is past 2^53 and cannot round-trip",
    );
    expect((capture(() => sqlValueExpression("weight", Number.NaN)) as UnsupportedValue).message).toBe("weight: NaN has no SQL literal");
    expect((capture(() => sqlValueExpression("weight", Number.POSITIVE_INFINITY)) as UnsupportedValue).message).toBe(
      "weight: Infinity has no SQL literal",
    );
  });

  it("refuses a NUL byte on the plain path and on the token path", () => {
    expect((capture(() => sqlValueExpression("details", `a${NUL}b`)) as Error).message).toBe(
      "details: a NUL byte cannot appear in a SQL string literal",
    );
    expect((capture(() => sqlValueExpression("details", `a${NUL}b\nc`)) as Error).message).toBe(
      "details: a NUL byte cannot appear in a SQL string literal",
    );
  });
});

describe("insertStatement()", () => {
  it("emits one row as an INSERT naming its columns, pinned to the byte", () => {
    expect(insertStatement("tasks", ["uuid", "lane"], { uuid: "t", lane: "todo" })).toBe(
      `INSERT INTO "tasks" ("uuid","lane") VALUES ('t','todo');`,
    );
  });

  it("writes an integral REAL as 1.0, never as the INTEGER 1", () => {
    expect(insertStatement("scores", ["id", "weight"], { id: 1, weight: new SqlReal(1) })).toBe(
      `INSERT INTO "scores" ("id","weight") VALUES (1,1.0);`,
    );
  });

  it("refuses a NUL byte in a value as an UnsupportedValue naming the column", () => {
    const thrown = capture(() => insertStatement("tasks", ["uuid", "lane"], { uuid: "t", lane: "to\0do" }));
    expect(thrown).toBeInstanceOf(UnsupportedValue);
    expect((thrown as UnsupportedValue).column).toBe("lane");
    expect((thrown as Error).message).toBe("lane: a NUL byte cannot appear in a SQL string literal");
    expect(capture(() => insertStatement("tasks", ["uuid"], { uuid: "a\nb\0c" }))).toBeInstanceOf(UnsupportedValue);
  });

  it("writes a null, an integer and a quoted string in one statement", () => {
    expect(insertStatement("events", ["seq", "actor", "summary"], { seq: 124, actor: null, summary: "it's done" })).toBe(
      `INSERT INTO "events" ("seq","actor","summary") VALUES (124,NULL,'it''s done');`,
    );
  });

  it("names the columns in the order given, so the statement does not depend on declaration order", () => {
    const row = { uuid: "e", body: "an epic body", project_uuid: "p" };

    expect(insertStatement("epics", ["uuid", "body", "project_uuid"], row)).toBe(
      `INSERT INTO "epics" ("uuid","body","project_uuid") VALUES ('e','an epic body','p');`,
    );
    expect(insertStatement("epics", ["project_uuid", "uuid", "body"], row)).toBe(
      `INSERT INTO "epics" ("project_uuid","uuid","body") VALUES ('p','e','an epic body');`,
    );
  });

  it("writes the idempotent form under orIgnore, and the bare one for an absent bag or a false flag", () => {
    const row = { uuid: "t", lane: "todo" };
    expect(insertStatement("tasks", ["uuid", "lane"], row, { orIgnore: true })).toBe(
      `INSERT OR IGNORE INTO "tasks" ("uuid","lane") VALUES ('t','todo');`,
    );
    expect(insertStatement("tasks", ["uuid", "lane"], row, { orIgnore: false })).toBe(`INSERT INTO "tasks" ("uuid","lane") VALUES ('t','todo');`);
    expect(insertStatement("tasks", ["uuid", "lane"], row, {})).toBe(`INSERT INTO "tasks" ("uuid","lane") VALUES ('t','todo');`);
  });

  it("quotes a table and column name unconditionally, so a keyword name still loads", () => {
    expect(insertStatement("order", ["key"], { key: "k" })).toBe(`INSERT INTO "order" ("key") VALUES ('k');`);
  });

  it("round-trips a row whose primary key is a 16-byte BLOB", () => {
    const id = [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255];

    expect(insertStatement("auth_users", ["id", "email"], { id, email: "a@b.test" })).toBe(
      `INSERT INTO "auth_users" ("id","email") VALUES (X'00112233445566778899aabbccddeeff','a@b.test');`,
    );
  });

  it("throws when a column is absent from the row rather than silently writing NULL", () => {
    expect((capture(() => insertStatement("tasks", ["uuid", "lane"], { uuid: "t" })) as UnsupportedValue).message).toBe(
      "lane: the column is absent from the row — the read did not return it",
    );
  });

  it("emits a single line even for a row whose value holds newlines and carriage returns", () => {
    const statement = insertStatement("tasks", ["uuid", "details"], { uuid: "t", details: "first\nsecond\r\nthird\r" });

    expect(statement.includes("\n")).toBe(false);
    expect(statement.includes("\r")).toBe(false);
    expect(statement.startsWith(`INSERT INTO "tasks"`)).toBe(true);
  });

  it("round-trips every value it writes through SQLite's own decode", () => {
    for (const { value } of ROUND_TRIPS) {
      const statement = insertStatement("tasks", ["details"], { details: value });

      expect(evaluateSqlText(statement.slice(`INSERT INTO "tasks" ("details") VALUES (`.length, -2))).toBe(value);
    }
  });
});
