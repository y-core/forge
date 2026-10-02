import { describe, expect, it } from "bun:test";

import { SqlReal } from "./backup/artifact";
import { argvHas, fakeDbIo, jsonRows, keysetPageReply, minimalWranglerConfig, OK, routedReply } from "./db.fixture";

describe("argvHas()", () => {
  it("finds words in order without requiring them to be adjacent", () => {
    const argv = ["d1", "execute", "app-db", "--local", "--json", "--command", "SELECT 1"];
    expect([
      argvHas(argv, "execute", "--json"),
      argvHas(argv, "d1", "execute", "app-db"),
      argvHas(argv, "--json", "execute"),
      argvHas(argv, "execute", "--remote"),
      argvHas(argv),
    ]).toEqual([true, true, false, false, true]);
  });

  it("needs one occurrence per repeated word", () => {
    expect(argvHas(["-c", "a", "-c", "b"], "-c", "-c")).toBe(true);
    expect(argvHas(["-c", "a"], "-c", "-c")).toBe(false);
  });
});

describe("fakeDbIo()", () => {
  it("reads back what it wrote and reports a missing path as absent", () => {
    const io = fakeDbIo({ "/m/0001_init.sql": "CREATE TABLE t (a);" });
    expect(io.readText("/m/0001_init.sql")).toBe("CREATE TABLE t (a);");
    expect([io.exists("/m/0001_init.sql"), io.exists("/m"), io.exists("/absent")]).toEqual([true, true, false]);
    expect(() => io.readText("/absent")).toThrow("ENOENT: /absent");
  });

  it("lists one level of names, from files and from created directories alike", () => {
    const io = fakeDbIo({ "/m/0002_b.sql": "B", "/m/0001_a.sql": "A", "/m/nested/0003_c.sql": "C" });
    io.mkdir("/m/empty");
    expect(io.readDir("/m")).toEqual(["0001_a.sql", "0002_b.sql", "empty", "nested"]);
    expect(io.readDir("/m/empty")).toEqual([]);
    expect(() => io.readDir("/absent")).toThrow("ENOENT: /absent");
  });

  it("removes a path and everything under it", () => {
    const io = fakeDbIo({ "/a/b/one.sql": "1", "/a/keep.sql": "2" });
    io.mkdir("/a/b/c");
    io.remove("/a/b");
    expect([io.exists("/a/b"), io.exists("/a/b/c"), io.exists("/a/keep.sql")]).toEqual([false, false, true]);
  });

  it("dates a file it holds and nothing else", () => {
    const io = fakeDbIo({ "/a.sql": "x" }, { now: new Date("2026-09-11T10:00:00Z") });
    expect(io.mtime("/a.sql")).toBe(1_789_120_800_000);
    expect(io.mtime("/absent")).toBeNull();
  });

  it("answers a spawn from the first matching rule and records every call", () => {
    const io = fakeDbIo();
    io.rules.push({ match: (args) => argvHas(args, "execute"), reply: (args) => ({ code: 0, stdout: args.join(" "), stderr: "" }) });
    expect(io.spawn("wrangler", ["d1", "execute", "app-db"], { cwd: "/app" })).toEqual({ code: 0, stdout: "d1 execute app-db", stderr: "" });
    expect(io.calls).toEqual([["wrangler", "d1", "execute", "app-db"]]);
  });

  it("fails an unmatched spawn with the command it could not answer", () => {
    const io = fakeDbIo();
    expect(io.spawn("wrangler", ["d1", "export", "app-db"], { cwd: "/app" })).toEqual({
      code: 1,
      stdout: "",
      stderr: "fake wrangler: no rule matches wrangler d1 export app-db",
    });
  });

  it("collects log lines and defaults the clock and the environment", () => {
    const io = fakeDbIo();
    io.log("copying 0001_init.sql");
    expect(io.logs).toEqual(["copying 0001_init.sql"]);
    expect(io.now().toISOString()).toBe("2026-09-11T10:00:00.000Z");
    expect(io.env).toEqual({});
  });
});

describe("jsonRows()", () => {
  it("wraps rows the way `d1 execute --json` prints them", () => {
    expect(jsonRows([{ n: 1 }])).toEqual({ code: 0, stdout: '[{"results":[{"n":1}],"success":true,"meta":{}}]\n', stderr: "" });
  });

  it("is the empty-result shape for no rows", () => {
    expect(jsonRows([]).stdout).toBe('[{"results":[],"success":true,"meta":{}}]\n');
  });
});

describe("routedReply()", () => {
  it("answers a batched command with one result set per statement", () => {
    const seen: string[] = [];
    const answer = (statement: string): Record<string, unknown>[] => {
      seen.push(statement);
      return [{ statement }];
    };

    const batched = routedReply("SELECT 1;\nSELECT 2;", answer);

    expect(seen).toEqual(["SELECT 1", "SELECT 2"]);
    expect(JSON.parse(batched.stdout)).toEqual([
      { results: [{ statement: "SELECT 1" }], success: true, meta: {} },
      { results: [{ statement: "SELECT 2" }], success: true, meta: {} },
    ]);
  });

  it("answers an unbatched read exactly as it answers the same statement inside a batch", () => {
    const answer = (statement: string): Record<string, unknown>[] => [{ statement }];
    expect(routedReply("SELECT 1", answer)).toEqual(routedReply("SELECT 1;", answer));
  });
});

describe("keysetPageReply()", () => {
  const MEMBERS = {
    members: [
      { team: "b", person: "p1" },
      { team: "a", person: "p3" },
      { team: "a", person: "p1" },
      { team: "a", person: "p2" },
    ],
  };
  const people = (page: Record<string, unknown>[] | null) => page?.map((row) => `${String(row.team)}/${String(row.person)}`);

  it("answers the first page ordered by every ORDER BY column, cut at the limit, each cell beside its storage class", () => {
    expect(keysetPageReply('SELECT * FROM "members" AS t ORDER BY t."team", t."person" LIMIT 2', MEMBERS)).toEqual([
      { team: "a", "forge:type:team": "text", person: "p1", "forge:type:person": "text" },
      { team: "a", "forge:type:team": "text", person: "p2", "forge:type:person": "text" },
    ]);
  });

  it("seeks past a row value, so a tie on the first column is broken by the second", () => {
    const page = keysetPageReply(
      `SELECT * FROM "members" AS t WHERE (t."team", t."person") > ('a', 'p2') ORDER BY t."team", t."person" LIMIT 5`,
      MEMBERS,
    );

    expect(people(page)).toEqual(["a/p3", "b/p1"]);
  });

  it("seeks past one column alone when the seek names one, whatever the ORDER BY", () => {
    const page = keysetPageReply(`SELECT * FROM "members" AS t WHERE t."team" > 'a' ORDER BY t."team", t."person" LIMIT 5`, MEMBERS);

    expect(people(page)).toEqual(["b/p1"]);
  });

  it("orders NULL, then numbers numerically, then text by code point, then blobs bytewise", () => {
    const rows = { mixed: [{ k: [0] }, { k: "\u{1F600}" }, { k: "\uFFFD" }, { k: 10 }, { k: new SqlReal(9.5) }, { k: null }] };
    const page = keysetPageReply('SELECT * FROM "mixed" AS t ORDER BY t."k" LIMIT 9', rows);

    expect(page?.map((row) => row.k)).toEqual([null, 9.5, 10, "\uFFFD", "\u{1F600}", "00"]);
  });

  it("reads integer, text with a doubled quote, and blob literals in one row value", () => {
    const rows = {
      keyed: [
        { n: 1, s: "o'k", b: [0, 255] },
        { n: 1, s: "o'k", b: [1] },
        { n: 1, s: "p", b: [0] },
        { n: 2, s: "a", b: [0] },
      ],
    };
    const page = keysetPageReply(
      `SELECT * FROM "keyed" AS t WHERE (t."n", t."s", t."b") > (1, 'o''k', X'00ff') ORDER BY t."n", t."s", t."b" LIMIT 9`,
      rows,
    );

    expect(page?.map((row) => [row.n, row.s, row.b])).toEqual([
      [1, "o'k", "01"],
      [1, "p", "00"],
      [2, "a", "00"],
    ]);
  });

  it("refuses a seek whose keys and literals do not pair up, rather than reading a guess", () => {
    expect(() =>
      keysetPageReply(`SELECT * FROM "members" AS t WHERE (t."team", t."person") > ('a') ORDER BY t."team", t."person" LIMIT 5`, MEMBERS),
    ).toThrow("fake keyset read: 2 key(s) sought past 1 literal(s)");
  });

  it("is null for a statement that is not a keyset read", () => {
    expect(keysetPageReply('SELECT COUNT(*) AS rows FROM "members"', MEMBERS)).toBeNull();
  });
});

describe("OK", () => {
  it("is a success with neither stream written", () => {
    expect(OK).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});

describe("minimalWranglerConfig()", () => {
  it("writes one database under the root, with the id a remote target accepts", () => {
    expect(minimalWranglerConfig("/tmp/root")).toEqual({
      path: "/tmp/root/wrangler.jsonc",
      text: `{
  "name": "app",
  "compatibility_date": "2026-01-01",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "app-db",
      "database_id": "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a"
    }
  ]
}
`,
    });
  });

  it("replaces a key an override names and appends one it does not", () => {
    const { text } = minimalWranglerConfig("/tmp/root", { name: "other", env: { staging: {} } });
    expect(JSON.parse(text)).toEqual({
      name: "other",
      compatibility_date: "2026-01-01",
      d1_databases: [{ binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" }],
      env: { staging: {} },
    });
  });
});
