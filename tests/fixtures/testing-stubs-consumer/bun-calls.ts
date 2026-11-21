// The `bun:test` and `bun:sqlite` calls the fleet's tests make.
import { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, setSystemTime, spyOn, test } from "bun:test";

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
});

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
