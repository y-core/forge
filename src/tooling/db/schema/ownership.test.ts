import { describe, expect, it } from "bun:test";

import { CliError } from "../../cli/errors";
import { assembleSchemaModel } from "./introspect";
import { twoTableRows } from "./introspect.test";
import { assignOwnership, attributeDrops, declaredNamesBySource, ownedNames } from "./ownership";
import { buildSchemaSnapshot } from "./snapshot";
import type { DesiredState } from "./types";

const desired = assembleSchemaModel(twoTableRows());

const LIB = "node_modules/acme/schema.sql";
const APP = "config/schema.sql";

describe("ownedNames()", () => {
  it("is what the file declares, and nothing when it declares none", () => {
    expect([...ownedNames({ source: APP, declared: [{ type: "table", name: "posts" }] })]).toEqual(["posts"]);
    expect([...ownedNames({ source: APP, declared: null })]).toEqual([]);
  });
});

describe("assignOwnership()", () => {
  it("refuses a name two declared schemas both hold, naming both files", () => {
    const claims = [
      { source: LIB, declared: [{ type: "table", name: "users" }] },
      { source: APP, declared: [{ type: "table", name: "users" }] },
    ];
    expect(() => assignOwnership(claims, desired)).toThrow(`\`users\` is declared by both ${LIB} and ${APP}`);
    expect(() => assignOwnership(claims, desired)).toThrow(CliError);
  });

  it("refuses an index or trigger on a table another file declares", () => {
    const claims = [
      { source: LIB, declared: [{ type: "table", name: "posts" }] },
      { source: APP, declared: [{ type: "index", name: "posts_user" }] },
    ];
    expect(() => assignOwnership(claims, desired)).toThrow(`${APP} declares index \`posts_user\` on \`posts\`, which ${LIB} declares`);
  });
});

describe("declaredNamesBySource()", () => {
  it("is each file's names as it writes them, sorted, with a file that declares nothing carried as empty", () => {
    expect(
      declaredNamesBySource([
        {
          source: LIB,
          declared: [
            { type: "index", name: "Posts_User" },
            { type: "table", name: "posts" },
            { type: "table", name: "POSTS" },
          ],
        },
        { source: APP, declared: null },
      ]),
    ).toEqual({ [LIB]: ["POSTS", "Posts_User"], [APP]: [] });
  });
});

describe("attributeDrops()", () => {
  const state = (source: string): DesiredState => ({ source, path: `/app/${source}`, files: [], text: "", digest: "d" });
  const snapshot = (declared: Record<string, string[]>) => buildSchemaSnapshot({ desired: {}, declared, migrationsDigest: "m" });

  it("names a dropped object the departed file declared, and leaves the rest of the drop set unattributed", () => {
    expect(attributeDrops(snapshot({ [LIB]: ["posts_user", "posts"], [APP]: ["users"] }), [state(APP)], ["posts", "posts_user", "users"])).toEqual([
      { source: LIB, objects: ["posts", "posts_user"] },
    ]);
  });

  it("attributes nothing to a file config/db.ts still declares, so an ordinary deletion is unattributed", () => {
    expect(attributeDrops(snapshot({ [APP]: ["users"] }), [state(APP)], ["users"])).toEqual([]);
  });

  it("attributes nothing when the departed file owned none of the drops, and nothing without a snapshot", () => {
    expect(attributeDrops(snapshot({ [LIB]: ["posts"] }), [state(APP)], ["users"])).toEqual([]);
    expect(attributeDrops(null, [state(APP)], ["users"])).toEqual([]);
  });

  it("matches a dropped name against a remembered one the way SQLite resolves a name", () => {
    expect(attributeDrops(snapshot({ [LIB]: ["Posts"] }), [], ["POSTS"])).toEqual([{ source: LIB, objects: ["Posts"] }]);
  });
});
