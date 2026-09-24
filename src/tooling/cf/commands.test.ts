import { describe, expect, it } from "bun:test";

import type { CommandBase } from "../cli/types";
import { SYNC_ACCOUNT_DESCRIPTION, syncAccountFlags } from "./account/commands";
import { createCfCommands } from "./commands";

const child = (parent: CommandBase, name: string): CommandBase => {
  const found = parent.commands.find((c) => c.name === name);
  if (!found) throw new Error(`no subcommand "${name}" under "${parent.name}"`);
  return found;
};

describe("createCfCommands", () => {
  it("is named cf and says what it covers", () => {
    const cf = createCfCommands();
    expect([cf.name, cf.description]).toEqual([
      "cf",
      "Reconcile and generate against Cloudflare — account bindings, zone rules, and the env schema",
    ]);
  });

  it("groups everything under sync and gen, in that order", () => {
    expect(createCfCommands().commands.map((c) => c.name)).toEqual(["sync", "gen"]);
  });

  it("takes no arguments of its own and declares no flags", () => {
    const cf = createCfCommands();
    expect([cf.args, cf.flags]).toEqual([{ kind: "none" }, {}]);
  });

  it("builds a fresh tree per call, so one caller cannot mutate another's", () => {
    expect(createCfCommands()).not.toBe(createCfCommands());
  });
});

describe("createCfCommands — sync", () => {
  it("scopes to account and zone, in that order", () => {
    expect(child(createCfCommands(), "sync").commands.map((c) => c.name)).toEqual(["account", "zone"]);
  });

  it("describes itself as the account scope with a scope name available", () => {
    expect(child(createCfCommands(), "sync").description).toBe(
      `${SYNC_ACCOUNT_DESCRIPTION}. Defaults to the account scope; name a scope to be explicit`,
    );
  });

  it("is runnable bare, which is what makes `cf sync` mean `cf sync account`", () => {
    expect(typeof (child(createCfCommands(), "sync") as { run?: unknown }).run).toBe("function");
  });

  it("shares the account flag table rather than copying it", () => {
    const sync = child(createCfCommands(), "sync");
    expect(sync.flags).toBe(syncAccountFlags);
  });

  it("gives the account subcommand that same table, so the bare form and the explicit one cannot drift", () => {
    const sync = child(createCfCommands(), "sync");
    expect(child(sync, "account").flags).toBe(sync.flags);
  });

  it("gives the account subcommand the undecorated description", () => {
    expect(child(child(createCfCommands(), "sync"), "account").description).toBe(SYNC_ACCOUNT_DESCRIPTION);
  });

  it("gives the zone subcommand its own flags and its own runner", () => {
    const zone = child(child(createCfCommands(), "sync"), "zone");
    expect([zone.flags === syncAccountFlags, typeof (zone as { run?: unknown }).run]).toEqual([false, "function"]);
  });
});

describe("createCfCommands — gen", () => {
  it("carries only the env generator", () => {
    expect(child(createCfCommands(), "gen").commands.map((c) => c.name)).toEqual(["env"]);
  });

  it("describes itself as the generator group and is not runnable bare", () => {
    const gen = child(createCfCommands(), "gen");
    expect([gen.description, (gen as { run?: unknown }).run]).toEqual(["Generate a typed module from Cloudflare configuration", undefined]);
  });
});

describe("createCfCommands — the tree is linked both ways", () => {
  it("links every child back to its parent", () => {
    const cf = createCfCommands();
    const sync = child(cf, "sync");
    const gen = child(cf, "gen");
    expect([sync.parent, gen.parent, child(sync, "account").parent, child(sync, "zone").parent, child(gen, "env").parent]).toEqual([
      cf,
      cf,
      sync,
      sync,
      gen,
    ]);
  });

  it("leaves the root with no parent", () => {
    expect(createCfCommands().parent).toBeUndefined();
  });
});
