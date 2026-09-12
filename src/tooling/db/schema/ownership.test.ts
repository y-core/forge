import { describe, expect, it } from "bun:test";

import { CliError } from "../../cli/errors";
import { assembleSchemaModel } from "./introspect";
import { twoTableRows } from "./introspect.test";
import { assignOwnership, ownedNames } from "./ownership";

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
