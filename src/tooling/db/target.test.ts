import { describe, expect, it } from "bun:test";

import { describeTargetGrammar, formatTarget, isRemotePlace, parseTarget, refuseRemote } from "./target";

describe("parseTarget()", () => {
  it("accepts every place, with or without a database", () => {
    expect(["local", "standby:ledger-standby", "remote:app_db", "preview"].map(parseTarget)).toEqual([
      { place: "local", database: null },
      { place: "standby", database: "ledger-standby" },
      { place: "remote", database: "app_db" },
      { place: "preview", database: null },
    ]);
  });

  it("refuses an unknown place, an empty name, and a name wrangler would read as a flag", () => {
    expect(["prod", "local:-c", "local:", "remote:a b", ""].map(parseTarget)).toEqual([null, null, null, null, null]);
  });

  it("round-trips through formatTarget", () => {
    expect(formatTarget({ place: "standby", database: "x" })).toBe("standby:x");
    expect(formatTarget({ place: "local", database: null })).toBe("local");
  });

  it("names the grammar in the refusal", () => {
    expect(describeTargetGrammar("prod")).toBe("--target prod is not a target — use place[:database], place being local, standby, remote, preview");
  });
});

describe("refuseRemote()", () => {
  it("allows a local place whatever the id is", () => {
    expect(refuseRemote("local", null)).toBeNull();
    expect(refuseRemote("standby", "placeholder")).toBeNull();
  });

  it("allows a remote place with a D1 id", () => {
    expect(refuseRemote("remote", "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a")).toBeNull();
  });

  it("refuses a missing id, naming the field and the fix", () => {
    expect(refuseRemote("remote", null)).toBe(
      "remote is refused while wrangler.jsonc has no database_id — run `forge cf sync --commit` to provision it, then retry",
    );
    expect(refuseRemote("preview", "")).toBe(
      "preview is refused while wrangler.jsonc has no preview_database_id — create it with `wrangler d1 create` and set its id as preview_database_id, then retry",
    );
  });

  it("refuses a placeholder id", () => {
    expect(refuseRemote("remote", "auth-fixture-local")).toBe(
      "remote is refused while wrangler.jsonc's database_id is the placeholder auth-fixture-local — run `forge cf sync --commit` to provision it, then retry",
    );
    expect(refuseRemote("preview", "app-db-preview")).toBe(
      "preview is refused while wrangler.jsonc's preview_database_id is the placeholder app-db-preview — create it with `wrangler d1 create` and set its id as preview_database_id, then retry",
    );
  });

  it("knows which places are deployed", () => {
    expect(["local", "standby", "remote", "preview"].map((p) => isRemotePlace(p as never))).toEqual([false, false, true, true]);
  });
});
