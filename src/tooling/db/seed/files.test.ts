import { describe, expect, it } from "bun:test";

import { CliError } from "../../cli/errors";
import { sha256 } from "../digest";
import { fakeDbIo } from "../test-support";
import { discoverSeeds, expandSeedEnv, parseSeed, parseSeedPlaces, readSeedFiles, SEED_BARE_VALUE } from "./files";

describe("SEED_BARE_VALUE", () => {
  const cases: { input: string; expected: boolean }[] = [
    { input: "abc", expected: true },
    { input: "a.b", expected: true },
    { input: "_x1", expected: true },
    { input: "42", expected: true },
    { input: "-1.5", expected: true },
    { input: "a-b", expected: false },
    { input: "--", expected: false },
    { input: "1--", expected: false },
    { input: "/*", expected: false },
  ];

  it("accepts an identifier or a number, and nothing that could open a comment or a second token", () => {
    expect(cases.map(({ input }) => [input, SEED_BARE_VALUE.test(input)])).toEqual(cases.map(({ input, expected }) => [input, expected]));
  });
});

describe("expandSeedEnv()", () => {
  it("substitutes a set variable, inside a SQL string literal as well as outside one", () => {
    expect(expandSeedEnv("INSERT INTO t (a, b) VALUES ('${NAME}', ${COUNT});", { NAME: "ada", COUNT: "3" })).toBe(
      "INSERT INTO t (a, b) VALUES ('ada', 3);",
    );
  });

  it("takes the default when the variable is unset, and the value when it is set", () => {
    expect(expandSeedEnv("${HOST:-localhost}", {})).toBe("localhost");
    expect(expandSeedEnv("${HOST:-localhost}", { HOST: "db.internal" })).toBe("db.internal");
    expect(expandSeedEnv("${EMPTY:-}", {})).toBe("");
  });

  it("throws naming the variable when it is unset and has no default", () => {
    expect(() => expandSeedEnv("SELECT '${ADMIN_EMAIL}';", {})).toThrow(
      "ADMIN_EMAIL is not set and the seed gives it no default — export it, or write ${ADMIN_EMAIL:-default} in the file",
    );
    expect(() => expandSeedEnv("SELECT '${ADMIN_EMAIL}';", {})).toThrow(CliError);
  });

  it("leaves `$$` and a bare `$VAR` alone", () => {
    expect(expandSeedEnv("$$body$$ $PLAIN", { PLAIN: "x" })).toBe("$$body$$ $PLAIN");
  });

  it("doubles a quote in a value landing inside a string literal, so it stays one literal", () => {
    expect(expandSeedEnv("INSERT INTO t (a) VALUES ('${WHO}');", { WHO: "O'Hara" })).toBe("INSERT INTO t (a) VALUES ('O''Hara');");
  });

  it("keeps a value that would close the literal and run its own statement inside the literal", () => {
    expect(expandSeedEnv("INSERT INTO t (a) VALUES ('${WHO}');", { WHO: "x'; DROP TABLE t; --" })).toBe(
      "INSERT INTO t (a) VALUES ('x''; DROP TABLE t; --');",
    );
  });

  it("refuses a value outside a literal that is neither identifier-like nor a number, naming the variable", () => {
    expect(() => expandSeedEnv("INSERT INTO t (a) VALUES (${COUNT});", { COUNT: "1); DROP TABLE t; --" })).toThrow(
      "COUNT is substituted outside a SQL string literal, where its value is the SQL itself, and `1); DROP TABLE t; --` is neither an identifier-like token nor a number — quote the placeholder in the seed ('${COUNT}'), or set a value matching [A-Za-z_][A-Za-z0-9_.]* or -?\\d+(\\.\\d+)?",
    );
  });

  it("accepts an identifier-like token and a plain number outside a literal", () => {
    expect(expandSeedEnv("${A} ${B} ${C}", { A: "admin.users_1", B: "-3", C: "2.5" })).toBe("admin.users_1 -3 2.5");
  });

  it("refuses a hyphenated value outside a literal, which must be quoted in the seed", () => {
    expect(() => expandSeedEnv("SELECT ${SLUG};", { SLUG: "blue-green" })).toThrow("SLUG is substituted outside a SQL string literal");
  });

  it("refuses a NUL byte in either context, since no SQL text carries one", () => {
    const nul = String.fromCharCode(0);
    const message = "holds a NUL byte, which no SQL text can carry — a seed will not splice one into a statement";
    expect(() => expandSeedEnv("SELECT '${WHO}';", { WHO: `a${nul}b` })).toThrow(`WHO ${message}`);
    expect(() => expandSeedEnv("SELECT ${WHO};", { WHO: `a${nul}b` })).toThrow(`WHO ${message}`);
  });

  it("reads a comment and an escaped quote as the scanner does, so the context is the SQL's own", () => {
    // The `'` inside the comment opens no literal, so the second placeholder is still outside one.
    expect(expandSeedEnv("-- it's a note\nSELECT ${N};", { N: "7" })).toBe("-- it's a note\nSELECT 7;");
    expect(expandSeedEnv("SELECT 'a''b${WHO}';", { WHO: "c" })).toBe("SELECT 'a''bc';");
  });
});

describe("parseSeed()", () => {
  it("names the seed after the file without `.sql`, keeps the SQL as written, and hashes it", () => {
    const raw = "INSERT INTO t VALUES ('${WHO:-nobody}');";
    const a = parseSeed("app", "001_users.sql", "/s/001_users.sql", raw);
    expect(a.source).toBe("app");
    expect(a.name).toBe("001_users");
    expect(a.sql).toBe(raw);
    expect(a.sha256).toBe(sha256(raw));
  });
});

describe("readSeedFiles()", () => {
  it("reads only `.sql` files, in name order, and treats an absent directory as empty", () => {
    const io = fakeDbIo({ "/s/002_b.sql": "B", "/s/001_a.sql": "A", "/s/README.md": "x" });
    expect(readSeedFiles(io, "/s").map((f) => f.name)).toEqual(["001_a.sql", "002_b.sql"]);
    expect(readSeedFiles(io, "/absent")).toEqual([]);
  });
});

describe("discoverSeeds()", () => {
  it("parses every file in the directory as written, an unset variable included", () => {
    const io = fakeDbIo({ "/s/001_a.sql": "SELECT '${WHO}';", "/s/002_b.sql": "SELECT 2;" });
    expect(discoverSeeds(io, { path: "/s", declared: "node_modules/lib/seeds" }).map((s) => [s.name, s.sql])).toEqual([
      ["001_a", "SELECT '${WHO}';"],
      ["002_b", "SELECT 2;"],
    ]);
  });
});

describe("parseSeedPlaces()", () => {
  it("reads the places a `-- forge:places` first line names, in the order it names them", () => {
    expect(parseSeedPlaces("-- forge:places local,standby\nSELECT 1;", "/s/001_a.sql")).toEqual(["local", "standby"]);
    expect(parseSeedPlaces("--forge:places  remote , preview \nSELECT 1;", "/s/001_a.sql")).toEqual(["remote", "preview"]);
  });

  it("is null when the line is absent, and when it is not the first line", () => {
    expect(parseSeedPlaces("SELECT 1;", "/s/001_a.sql")).toBe(null);
    expect(parseSeedPlaces("SELECT 1;\n-- forge:places local", "/s/001_a.sql")).toBe(null);
  });

  it("throws naming the unknown place and every place there is", () => {
    expect(() => parseSeedPlaces("-- forge:places staging\nSELECT 1;", "/s/001_a.sql")).toThrow(
      "/s/001_a.sql names `staging` in its forge:places line, which is not a place — the places are local, standby, remote, preview",
    );
  });

  it("throws when the line names no place at all", () => {
    expect(() => parseSeedPlaces("-- forge:places ,\nSELECT 1;", "/s/001_a.sql")).toThrow(
      "/s/001_a.sql has a forge:places line naming no place — remove the line, or name one of local, standby, remote, preview",
    );
  });
});

describe("parseSeed() places", () => {
  it("carries the first line's places onto the seed, and null when there is no such line", () => {
    const raw = "-- forge:places local,standby\nINSERT INTO t VALUES (1);";
    expect(parseSeed("app", "001_a.sql", "/s/001_a.sql", raw).places).toEqual(["local", "standby"]);
    expect(parseSeed("app", "002_b.sql", "/s/002_b.sql", "INSERT INTO t VALUES (1);").places).toBe(null);
  });

  it("hashes the raw text including the places line, so editing it is a changed seed", () => {
    const body = "INSERT INTO t VALUES (1);";
    const raw = `-- forge:places local\n${body}`;
    const parsed = parseSeed("app", "001_a.sql", "/s/001_a.sql", raw);
    expect(parsed.sha256).toBe(sha256(raw));
    expect(parsed.sha256).not.toBe(sha256(body));
    expect(parsed.sha256).not.toBe(parseSeed("app", "001_a.sql", "/s/001_a.sql", `-- forge:places standby\n${body}`).sha256);
    expect(parsed.sql).toBe(raw);
  });
});

describe("discoverSeeds() places", () => {
  it("reads each file's places through the directory, and throws on an unknown one", () => {
    const io = fakeDbIo({ "/s/001_a.sql": "-- forge:places local\nSELECT 1;", "/s/002_b.sql": "SELECT 2;" });
    expect(discoverSeeds(io, { path: "/s", declared: "config/seeds" }).map((s) => s.places)).toEqual([["local"], null]);

    const bad = fakeDbIo({ "/s/001_a.sql": "-- forge:places nowhere\nSELECT 1;" });
    expect(() => discoverSeeds(bad, { path: "/s", declared: "config/seeds" })).toThrow("which is not a place");
  });
});
