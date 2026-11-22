import { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, setSystemTime, spyOn, test } from "bun:test";
import { Buffer } from "node:buffer";

// The `bun`, `bun:test` and `bun:sqlite` calls the fleet's tests make.
import { file, spawnSync, write } from "bun";

beforeAll(() => setSystemTime(new Date("2026-01-01")));
afterAll(() => setSystemTime());
beforeEach(() => mock.restore());
afterEach(() => undefined);

describe("stubs", () => {
  it("accepts an any-typed actual", async () => {
    const response = new Response("{}");
    expect(await response.json()).toEqual({});
  });
  it.skipIf(true)("skips", () => undefined);
  it.todo("is pending");
  test("mocks", async () => {
    const fetcher = mock(async (input: string) => new Response(input));
    fetcher.mockResolvedValueOnce(new Response("x"));
    await fetcher("y");
    expect(fetcher.mock.calls[0]).toEqual(["y"]);
    const spy = spyOn(console, "log").mockImplementation(() => undefined);
    spy.mockRestore();
    await mock.module("./x", () => ({}));
  });
  it("matches asymmetrically", () => {
    expect.assertions(2);
    expect.hasAssertions();
    expect({ id: 1, name: "a", tags: ["x"], at: 0.1 }).toEqual({
      id: expect.any(Number),
      name: expect.stringContaining("a"),
      tags: expect.arrayContaining(["x"]),
      at: expect.closeTo(0.1, 2),
      rest: expect.anything(),
      shape: expect.objectContaining({}),
      slug: expect.stringMatching(/a/),
    });
    expect("a").toEqual(expect.not.stringContaining("b"));
    if (Number.isNaN(0)) expect.unreachable("not a number");
  });
  it("reads and writes files through bun", async () => {
    const bytes = new Uint8Array(await file("a.bin").arrayBuffer());
    await write("b.bin", bytes);
    const exists: boolean = await file(new URL("file:///b.bin")).exists();
    const encoded: string = Buffer.from(bytes).toString("base64");
    const listed: string = spawnSync(["git", "ls-files"], { cwd: "." }).stdout.toString();
    expect([exists, encoded, listed]).toHaveLength(3);
  });
  it.each([[1, 2, 3]])("adds %p and %p", (a, b, sum) => {
    const total: number = a + b;
    expect(total).toBe(sum);
  });
  it.each([{ name: "a" }])("reads $name", (row) => expect(row.name).toBe("a"));
  const table = it.each;
  // @ts-expect-error -- bun-types declares no tagged-template `each`, so the stub declares none either
  table`a | b ${1} | ${2}`("tagged", () => undefined);
  it.only("runs alone", () => undefined);
  it.skip("is skipped", () => undefined);
  it.skip("is skipped without a body");
  it.failing("fails", () => undefined);
  it.if(true)("runs when the condition holds", () => undefined);
  it.skipIf(false)("runs unless the condition holds", () => undefined);
  it.todo("is pending without a body");
  test.todo("is pending with a body", () => undefined);
});

describe.each([["a", 1]])("table %s", (label, count) => {
  it("reads its row", () => expect(`${label}${count.toFixed(0)}`).toBe("a1"));
});
describe.each(["a"])("value %s", (label) => {
  it("reads its value", () => expect(label.length).toBe(1));
});
describe.only("runs alone", () => undefined);
describe.skip("is skipped", () => undefined);
describe.todo("is pending");
describe.if(true)("runs when the condition holds", () => undefined);
describe.skipIf(false)("runs unless the condition holds", () => undefined);

const db = new Database(":memory:", { strict: true });
db.exec("create table t (id integer primary key, name text)");
db.run("insert into t (name) values (?)", ["a"]);
const rows = db.query<{ id: number; name: string }, [string]>("select * from t where name = ?").all("a");
const one = db.prepare<{ id: number }, []>("select id from t").get();
const named = db.query<{ id: number }, [string]>("select id from t where name = ?");
const namedRows: { id: number }[] = named.all("a");
const columns: string[] = named.columnNames;
const insert = db.transaction((name: string) => db.run("insert into t (name) values (?)", [name]));
insert.immediate("b");
const copy = Database.deserialize(db.serialize(), { strict: true });
copy.close();
db.close();

export const used = [rows, one, namedRows, columns];
