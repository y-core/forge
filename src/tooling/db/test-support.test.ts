import { describe, expect, it } from "bun:test";
import process from "node:process";
import { createInterface } from "node:readline/promises";

import { cutSqlStatements } from "./backup/split";
import { cfEnvelope, cfRefusal, fakeDbIo, keysetPageReply, minimalWranglerConfig, onStdin, REMOTE_AUTH } from "./db.fixture";
import { SqlReal } from "./literal";
import type { Home } from "./types";

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

  it("splits through splitD1 exactly as the real port cuts, recording no in-process call", async () => {
    const io = fakeDbIo();
    const sql = "INSERT INTO t (a) VALUES ('x;y');\n\nDROP VIEW v;";
    const home: Home = {
      label: "local",
      database: "app-db",
      binding: "DB",
      dir: "/app",
      configPath: "/app/wrangler.jsonc",
      persistTo: "/app/.wrangler/state",
      place: "local",
      env: null,
      databaseId: null,
      auth: null,
      synthesized: false,
    };
    const split = await io.splitD1(home, sql);
    expect(split).toEqual(cutSqlStatements(sql));
    expect(split).toEqual(["INSERT INTO t (a) VALUES ('x;y')", "DROP VIEW v"]);
    expect(io.d1Calls).toEqual([]);
  });

  it("streams a file out in small chunks and back whole, refusing a file it does not hold", async () => {
    const io = fakeDbIo({ "/a.sql": "x".repeat(10_000) });
    const sizes: number[] = [];
    for await (const chunk of io.readStream("/a.sql")) sizes.push((chunk as Uint8Array).byteLength);
    expect(sizes).toEqual([4096, 4096, 1808]);
    await io.writeStream("/b.sql", io.readStream("/a.sql"));
    expect(io.files.get("/b.sql")).toBe("x".repeat(10_000));
    expect(() => io.readStream("/absent.sql")).toThrow("ENOENT: /absent.sql");
  });

  it("collects log lines and defaults the clock and the environment", () => {
    const io = fakeDbIo();
    io.log("copying 0001_init.sql");
    expect(io.logs).toEqual(["copying 0001_init.sql"]);
    expect(io.now().toISOString()).toBe("2026-09-11T10:00:00.000Z");
    expect(io.env).toEqual({});
  });

  it("records each sleep and advances its clock by as much, without waiting", async () => {
    const io = fakeDbIo({}, { now: new Date("2026-09-11T10:00:00Z") });
    await io.sleep(1_000);
    await io.sleep(500);
    expect([io.slept, io.now().toISOString()]).toEqual([[1_000, 500], "2026-09-11T10:00:01.500Z"]);
  });
});

describe("fakeDbIo() — the Cloudflare REST API", () => {
  const DB_ID = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
  const QUERY = `https://api.cloudflare.com/client/v4/accounts/acct/d1/database/${DB_ID}/query`;
  const REMOTE: Home = {
    label: "remote",
    database: "app-db",
    binding: "DB",
    dir: "/app",
    configPath: "/app/wrangler.jsonc",
    persistTo: null,
    place: "remote",
    env: null,
    databaseId: DB_ID,
    auth: REMOTE_AUTH,
    synthesized: false,
  };
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: { Authorization: "Bearer tok" }, body: JSON.stringify(body) });

  it("answers from the first matching rest rule and records the request", async () => {
    const io = fakeDbIo();
    io.restRules.push({ match: (url) => url.endsWith("/a"), reply: () => cfEnvelope({ n: 1 }) });
    const response = await io.fetch("https://api.cloudflare.com/a", post({ x: 1 }));
    expect(await response.json()).toEqual({ success: true, errors: [], messages: [], result: { n: 1 } });
    expect(io.restCalls).toEqual([
      { url: "https://api.cloudflare.com/a", method: "POST", headers: { authorization: "Bearer tok" }, body: '{"x":1}' },
    ]);
  });

  it("records a bare GET with no headers and no body", async () => {
    const io = fakeDbIo();
    await io.fetch("https://d1-exports.example.com/dump.sql");
    expect(io.restCalls).toEqual([{ url: "https://d1-exports.example.com/dump.sql", method: "GET", headers: {}, body: null }]);
  });

  it("fails an unmatched request with a 7003 naming its method and path", async () => {
    const response = await fakeDbIo().fetch("https://api.cloudflare.com/client/v4/x?y=1");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      errors: [{ code: 7003, message: "fake cloudflare: no rule matches GET /client/v4/x" }],
      messages: [],
      result: null,
    });
  });

  it("answers each statement of a /query batch through the d1 rules, by the home its database id names", async () => {
    const io = fakeDbIo({}, { homes: [REMOTE] });
    io.d1Rules.push({ match: (statement, home) => home.database === "app-db" && statement === "SELECT 1", reply: [{ n: 1 }] });
    const response = await io.fetch(QUERY, post({ batch: [{ sql: "SELECT 1" }, { sql: "SELECT 2;" }] }));
    expect((await response.json()).result).toEqual([
      { results: [{ n: 1 }], success: true, meta: {} },
      { results: [], success: true, meta: {} },
    ]);
    expect(io.d1Calls).toEqual([]);
  });

  it("answers a single /query body statement by statement", async () => {
    const io = fakeDbIo({}, { homes: [REMOTE] });
    io.d1Rules.push({ match: () => true, reply: (statement) => [{ statement }] });
    const response = await io.fetch(QUERY, post({ sql: "SELECT 1;\nSELECT 'a;b';" }));
    expect((await response.json()).result.map((r: { results: unknown[] }) => r.results)).toEqual([
      [{ statement: "SELECT 1" }],
      [{ statement: "SELECT 'a;b'" }],
    ]);
  });

  it("refuses a /query for a database id no home has", async () => {
    const response = await fakeDbIo().fetch(QUERY, post({ sql: "SELECT 1" }));
    expect((await response.json()).errors).toEqual([{ code: 7003, message: `fake cloudflare: no home has the D1 id ${DB_ID}` }]);
  });

  it("turns a d1 rule that throws into a 7500 carrying its message", async () => {
    const io = fakeDbIo({}, { homes: [REMOTE] });
    io.d1Rules.push({
      match: () => true,
      reply: () => {
        throw new Error("no such table: t: SQLITE_ERROR");
      },
    });
    const response = await io.fetch(QUERY, post({ batch: [{ sql: "SELECT * FROM t" }] }));
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toEqual([{ code: 7500, message: "no such table: t: SQLITE_ERROR" }]);
  });

  it("builds a failure envelope at the status asked for", async () => {
    const response = cfRefusal(10000, "Authentication error", 403);
    expect([response.status, await response.json()]).toEqual([
      403,
      { success: false, errors: [{ code: 10000, message: "Authentication error" }], messages: [], result: null },
    ]);
  });

  it("names the installed wrangler 4.151.2, and carries an empty environment", () => {
    expect(fakeDbIo().wranglerVersion()).toBe("4.151.2");
    expect(fakeDbIo().env).toEqual({});
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
      "database_id": "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
      "migrations_dir": "config/db/migrations"
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
      d1_databases: [
        { binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", migrations_dir: "config/db/migrations" },
      ],
      env: { staging: {} },
    });
  });
});

describe("onStdin()", () => {
  const readLine = async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question("");
    } finally {
      rl.close();
    }
  };

  for (const tty of [true, false]) {
    it(`hands the body a stdin ${tty ? "that is" : "that is not"} a terminal, holding the answer, and returns what it wrote to stdout`, async () => {
      const { prompted, value } = await onStdin(tty, "y", async () => {
        process.stdout.write("Continue? [y/N] ");
        return [process.stdin.isTTY, await readLine()];
      });

      expect([value, prompted]).toEqual([[tty, "y"], "Continue? [y/N] "]);
    });
  }

  it("puts the real streams back after the body, a body that throws included", async () => {
    const [stdin, stdout] = [process.stdin, process.stdout];

    await expect(onStdin(true, "", () => Promise.reject(new Error("body failed")))).rejects.toThrow("body failed");

    expect([process.stdin === stdin, process.stdout === stdout]).toEqual([true, true]);
  });
});
