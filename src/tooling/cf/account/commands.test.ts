import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { StringFlagDef } from "../../cli/types";
import { resolveColorLevel } from "../../term/capability";
import { createColorize, PLAIN } from "../../term/color";
import type { DeploymentTarget } from "../target";
import { RESOURCE_TYPES, type SyncNote, type SyncResult } from "../types";
import {
  createSyncAccountCommand,
  describeUntouchedZone,
  parseResources,
  pendingRows,
  printResults,
  resolveRotation,
  summariseCommit,
} from "./commands";
import { GENERATE_MARKER } from "./handlers/devvars";

// A grid line, by the characters the `single` border draws: a rule corner, a junction, or a
// vertical. Named once so switching border presets is one edit rather than nine.
const isGridLine = (line: string) => /^[┌│├└]/.test(line.trimStart());

/** The note a section prints on the line under its title. */
const noteUnder = (lines: readonly string[], title: string) => lines[lines.indexOf(title) + 1]?.trim();

describe("createSyncAccountCommand()", () => {
  it("returns a command named account — the Cloudflare scope it reconciles", () => {
    const cmd = createSyncAccountCommand();
    expect(cmd.name).toBe("account");
  });

  it("has account-id and api-token flags", () => {
    const cmd = createSyncAccountCommand();
    expect(cmd.flags["account-id"]).toBeDefined();
    expect(cmd.flags["api-token"]).toBeDefined();
  });

  it("has config flag with default", () => {
    const cmd = createSyncAccountCommand();
    expect(cmd.flags.config).toBeDefined();
    expect((cmd.flags.config as StringFlagDef).default).toBe("wrangler.jsonc");
  });

  it("gates every mutation behind --commit", () => {
    const cmd = createSyncAccountCommand();
    expect(cmd.flags.commit).toBeDefined();
    expect(cmd.flags.commit?.description).toMatch(/nothing is written anywhere/);
  });

  it("offers --force only as a modifier on the committing path", () => {
    const cmd = createSyncAccountCommand();
    expect(cmd.flags.force?.description).toMatch(/With --commit/);
  });

  it("says in its description that it is read-only without --commit", () => {
    expect(createSyncAccountCommand().description).toMatch(/Read-only unless --commit/);
  });
});

describe("the command surface is exactly two modes", () => {
  it("offers --commit as the only switch between them", () => {
    // `--dry-run` and a separate `status` command were both spellings of the
    // default. A second way to say "do nothing" is a second thing to keep honest.
    const flags = createSyncAccountCommand().flags as Record<string, unknown>;
    expect(flags["dry-run"]).toBeUndefined();
    expect(flags.commit).toBeDefined();
  });

  it("exposes no second command to keep in step with the first", async () => {
    const mod = (await import("./commands")) as Record<string, unknown>;
    expect(mod.createStatusCommand).toBeUndefined();
    expect(Object.keys(mod).filter((k) => k.startsWith("create"))).toEqual(["createSyncAccountCommand"]);
  });
});

describe("parseResources()", () => {
  it("returns undefined when the flag is absent", () => {
    expect(parseResources(undefined)).toBeUndefined();
  });

  it("accepts known types and trims whitespace", () => {
    expect(parseResources(" vars , secrets ")).toEqual(["vars", "secrets"]);
  });

  it("expands a category to the types its section covers", () => {
    expect(parseResources("local")).toEqual(["local_vars"]);
    expect(parseResources("rotate")).toEqual(["rotatable_secrets"]);
    // `commit` spans both halves of `--commit`, which the report shows as two sections. The token
    // predates the split and is in scripts, so it keeps meaning every type it used to.
    expect(parseResources("commit")).toEqual(["secrets", "kv_namespaces", "d1_databases", "r2_buckets", "queues"]);
    expect(parseResources("secrets")).toEqual(["secrets"]);
    expect(parseResources("provision")).toEqual(["kv_namespaces", "d1_databases", "r2_buckets", "queues"]);
  });

  it("resolves the catch-all category to whatever no other section claimed", () => {
    // Derived, not listed: `-r deploy` and the section it names must not be able to
    // disagree about which types they cover.
    const deploy = parseResources("deploy") ?? [];
    expect(deploy).toContain("vars");
    expect(deploy).toContain("ratelimits");
    expect(deploy).not.toContain("secrets");
    expect(deploy).not.toContain("local_vars");
  });

  it("dedupes a category overlapping a type named alongside it", () => {
    // `-r commit,secrets` would otherwise run the secrets handler twice.
    expect(parseResources("commit,secrets")).toEqual(["secrets", "kv_namespaces", "d1_databases", "r2_buckets", "queues"]);
  });

  it("accepts every declared resource type", () => {
    expect(parseResources(RESOURCE_TYPES.join(","))).toEqual([...RESOURCE_TYPES]);
  });

  it("rejects a near-miss rather than silently filtering it away", () => {
    // `ratelimit` (singular) previously produced "No bindings found." — a typo
    // rendered as a fact about the account.
    expect(() => parseResources("ratelimit")).toThrow(/Unknown resource: ratelimit/);
  });

  it("names every unknown type and lists the valid ones", () => {
    expect(() => parseResources("vars,nope,alsonope")).toThrow(/Unknown resources: nope, alsonope/);
    expect(() => parseResources("nope")).toThrow(/Valid categories: local, deploy, secrets, provision, rotate, commit; types: kv_namespaces, /);
  });

  it("rejects an empty list", () => {
    expect(() => parseResources("")).toThrow(/--resources was empty/);
    expect(() => parseResources(" , ")).toThrow(/--resources was empty/);
  });
});

describe("printResults()", () => {
  const WORKER: DeploymentTarget = { kind: "worker", name: "cornellaw" };

  function capture(results: SyncResult[], target: DeploymentTarget = WORKER, prefix = "CORNELLAW", notes: SyncNote[] = []): string[] {
    const written: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => void written.push(String(line ?? ""));
    try {
      printResults(results, target, prefix, notes);
    } finally {
      console.log = original;
    }
    return written.join("\n").split("\n");
  }

  const LOCAL: SyncResult = { resourceType: "local_vars", binding: "LOG_LEVEL", action: "local-only", local: true };
  const VAR: SyncResult = {
    resourceType: "vars",
    binding: "BASE_URL",
    remoteName: "BASE_URL",
    action: "deploy-pushes",
    local: true,
    remote: false,
    detail: "worker script · .dev.vars overrides locally",
  };
  const DECLARED: SyncResult = { resourceType: "ratelimits", binding: "MAIN_LIMITER", action: "deploy-pushes", local: true, remote: false };
  const SECRET: SyncResult = {
    resourceType: "secrets",
    binding: "EMAIL_API_KEY",
    remoteName: "EMAIL_API_KEY",
    action: "would-create",
    local: true,
    remote: false,
  };
  const PROVISIONED: SyncResult = {
    resourceType: "kv_namespaces",
    binding: "SESSIONS",
    remoteName: "CORNELLAW_SESSIONS",
    action: "would-create",
    local: true,
    remote: false,
  };
  const ROTATABLE: SyncResult = {
    resourceType: "rotatable_secrets",
    binding: "SESSION_SECRET",
    remoteName: "SESSION_SECRET",
    action: "would-rotate",
    local: true,
    remote: false,
  };
  const ALL = [LOCAL, VAR, DECLARED, SECRET, PROVISIONED, ROTATABLE];

  const headings = (lines: string[]) => lines.filter((l) => l.length > 0 && !l.startsWith(" "));

  it("says nothing was found when there is nothing to report", () => {
    expect(capture([])).toEqual(["No bindings found."]);
  });

  it("names the surface once, in a banner above the sections", () => {
    const lines = capture(ALL);
    expect(lines[0]).toBe("worker script · cornellaw");
    // Not once per row, which is what the `Detail` column used to do.
    expect(lines.filter((l) => l.includes("worker script"))).toEqual(["worker script · cornellaw"]);
  });

  it("names a pages project as one", () => {
    expect(capture([VAR], { kind: "pages", name: "site" })[0]).toBe("pages project · site");
  });

  it("groups the rows by actor, into five sections", () => {
    // Reversed on the way in: the order is the report's, not the handlers'.
    expect(headings(capture([...ALL].reverse()))).toEqual([
      "worker script · cornellaw",
      "Local Only",
      "Pushed by the Next Deploy",
      "Created by --commit",
      "Provisioned by --commit",
      "Rotated by --commit",
    ]);
  });

  it("puts a var and a declared binding under the same actor", () => {
    const lines = capture([VAR, DECLARED]);
    expect(headings(lines)).toHaveLength(2);
    expect(lines.some((l) => l.includes("BASE_URL") && isGridLine(l))).toBe(true);
    expect(lines.some((l) => l.includes("MAIN_LIMITER"))).toBe(true);
  });

  it("separates a secret from a provisioned binding, which --commit treats differently", () => {
    // A secret is created under its own name and gets no id; a KV namespace is created as
    // `PREFIX_BINDING` and its id is written back. One heading could not state both rules.
    const lines = capture([SECRET, PROVISIONED]);
    expect(headings(lines).slice(1)).toEqual(["Created by --commit", "Provisioned by --commit"]);
    expect(lines.some((l) => l.includes("EMAIL_API_KEY"))).toBe(true);
    expect(lines.some((l) => l.includes("CORNELLAW_SESSIONS"))).toBe(true);
  });

  it("shows no Remote Name or Remote ID column for secrets, which have neither", () => {
    const header = capture([SECRET]).find((l) => l.includes("Binding")) ?? "";
    expect(header).toBe("  │ Binding       │ Local │ Remote │ Action             │");
  });

  it("states each section's rule once, on the line under its heading", () => {
    const lines = capture(ALL);
    const notes = headings(lines)
      .slice(1)
      .map((title) => noteUnder(lines, title));
    expect(notes).toEqual([
      ".dev.vars declared keys with no marker and no matching vars in wrangler.jsonc",
      "wrangler.jsonc declared keys; `deploy` writes them, sync only reports",
      ".dev.vars secrets marked '# foundry:push', created remotely under their own name",
      "Bindings created as CORNELLAW_<BINDING> with the id written back into wrangler.jsonc",
      ".dev.vars keys marked '# foundry:generate'; --commit generates remote secret; --rotate rotates secrets",
    ]);
  });

  it("names the convention without a prefix when there is none", () => {
    const lines = capture([PROVISIONED], WORKER, "");
    expect(noteUnder(lines, "Provisioned by --commit")).toBe("Bindings created as <BINDING> with the id written back into wrangler.jsonc");
  });

  it("spells each action for a reader rather than printing the enum", () => {
    const body = capture(ALL).filter(isGridLine);
    expect(body.some((l) => l.includes("local only"))).toBe(true);
    expect(body.some((l) => l.includes("deploy pushes"))).toBe(true);
    expect(body.some((l) => l.includes("create on --commit"))).toBe(true);
    expect(body.some((l) => l.includes("rotate on --commit"))).toBe(true);
    expect(body.some((l) => l.includes("would-create"))).toBe(false);
  });

  it("borders the cells and rules off each section's headings", () => {
    expect(capture([LOCAL]).slice(-5)).toEqual([
      "  ┌───────────┬────────────┐",
      "  │ Binding   │ Action     │",
      "  ├───────────┼────────────┤",
      "  │ LOG_LEVEL │ local only │",
      "  └───────────┴────────────┘",
    ]);
  });

  it("shows which side each name was found on", () => {
    const orphan: SyncResult = { ...SECRET, binding: "OLD_KEY", remoteName: "OLD_KEY", action: "remote-only", local: false, remote: true };
    const lines = capture([SECRET, orphan]);
    expect(lines.find((l) => l.includes("EMAIL_API_KEY"))).toBe("  │ EMAIL_API_KEY │ yes   │ no     │ create on --commit │");
    expect(lines.find((l) => l.includes("OLD_KEY"))).toBe("  │ OLD_KEY       │ no    │ yes    │ remote only        │");
  });

  it("leaves a presence cell blank for a side that was never queried", () => {
    // A declarative binding knows nothing about the remote; "no" would be a claim,
    // and here the whole Remote column is empty, so it is dropped.
    expect(capture([{ ...DECLARED, remote: undefined }]).slice(-5)).toEqual([
      "  ┌────────────┬──────────────┬───────┬───────────────┐",
      "  │ Type       │ Binding      │ Local │ Action        │",
      "  ├────────────┼──────────────┼───────┼───────────────┤",
      "  │ ratelimits │ MAIN_LIMITER │ yes   │ deploy pushes │",
      "  └────────────┴──────────────┴───────┴───────────────┘",
    ]);
  });

  it("omits the presence columns from Local Only, where they would be constant", () => {
    expect(capture([LOCAL]).at(-4)).toBe("  │ Binding   │ Action     │");
  });

  it("strips the surface prefix from a detail, leaving the rest intact", () => {
    expect(capture([VAR]).at(-2)).toBe("  │ vars │ BASE_URL │ yes   │ no     │ deploy pushes │ .dev.vars overrides locally │");
  });

  it("leaves a detail that does not carry the prefix alone", () => {
    const lines = capture([{ ...DECLARED, detail: "not verified — no read API" }]);
    expect(lines.at(-2)).toBe("  │ ratelimits │ MAIN_LIMITER │ yes   │ no     │ deploy pushes │ not verified — no read API │");
  });

  it("carries a Type column on the two mixed sections only", () => {
    const typed = capture(ALL).filter((l) => l.trimStart().startsWith("│ Type"));
    expect(typed).toHaveLength(2);
    expect(capture([ROTATABLE]).some((l) => l.includes("rotatable_secrets"))).toBe(false);
  });

  it("drops Remote Name from a section where it never differs from Binding", () => {
    expect(capture([VAR, ROTATABLE]).some((l) => l.includes("Remote Name"))).toBe(false);
  });

  it("keeps Remote Name in the section that actually has one", () => {
    const lines = capture([VAR, PROVISIONED]);
    expect(lines.some((l) => l.includes("CORNELLAW_SESSIONS"))).toBe(true);
    // Still absent from the deploy section, whose columns are computed on its own.
    expect(lines.filter((l) => l.includes("Remote Name"))).toHaveLength(1);
  });

  it("renders a note under the section it belongs to, not as a row", () => {
    const lines = capture([SECRET], WORKER, "CORNELLAW", [{ resourceType: "secrets", message: "No .dev.vars at /tmp/.dev.vars." }]);
    expect(lines.at(-1)).toBe("  No .dev.vars at /tmp/.dev.vars.");
    expect(lines.some((l) => l.includes("(none)"))).toBe(false);
  });

  it("prints a section carrying only a note", () => {
    const lines = capture([], WORKER, "", [{ resourceType: "secrets", message: "No .dev.vars at /tmp/.dev.vars." }]);
    expect(
      lines
        .filter((l) => l.length > 0 && !l.startsWith(" "))
        .at(-1)
        ?.startsWith("Created by --commit"),
    ).toBe(true);
    expect(lines.at(-1)).toBe("  No .dev.vars at /tmp/.dev.vars.");
  });

  it("omits a section that has no rows", () => {
    expect(headings(capture([DECLARED]))).toEqual(["worker script · cornellaw", "Pushed by the Next Deploy"]);
  });
});

describe("summariseCommit()", () => {
  const row = (action: SyncResult["action"]): SyncResult => ({ resourceType: "secrets", binding: "S", action });

  it("names what --commit would do, so the next step is not a guess", () => {
    expect(summariseCommit([row("would-create"), row("would-create"), row("would-rotate")])).toBe(
      "(status only — nothing was written. --commit would create 2 and rotate 1. Re-run with --commit to apply.)",
    );
  });

  it("counts only the pending work, not what a deploy owns", () => {
    expect(summariseCommit([row("would-create"), row("deploy-pushes"), row("drift"), row("remote-only")])).toBe(
      "(status only — nothing was written. --commit would create 1. Re-run with --commit to apply.)",
    );
  });

  it("says so plainly when there is nothing to apply", () => {
    // Previously identical to the footer above — a run with six secrets waiting read
    // exactly like one with nothing to do.
    expect(summariseCommit([row("in-sync"), row("deploy-pushes")])).toBe(
      "(status only — nothing was written, and --commit would change nothing here.)",
    );
  });
});

describe("pendingRows()", () => {
  // Spread rather than a defaulted parameter: passing `undefined` explicitly would
  // trigger the default and silently test the opposite of the "never queried" case.
  const row = (action: SyncResult["action"], remote?: Partial<Pick<SyncResult, "remote">>): SyncResult => ({
    resourceType: "secrets",
    binding: "S",
    action,
    remote: false,
    ...remote,
  });
  const unqueried = (action: SyncResult["action"]): SyncResult => ({ resourceType: "secrets", binding: "S", action });

  it("counts the rows a reader would act on", () => {
    const pending = pendingRows([row("would-create"), row("would-rotate"), row("drift", { remote: true }), row("remote-only", { remote: true })]);
    expect(pending).toHaveLength(4);
  });

  it("settles a row verified equal, deliberately local, or already written", () => {
    const settled = [
      row("in-sync", { remote: true }),
      row("local-only"),
      row("created", { remote: true }),
      row("updated", { remote: true }),
      row("rotated", { remote: true }),
    ];
    expect(pendingRows(settled)).toEqual([]);
  });

  it("settles a row whose remote was never queried", () => {
    // A declarative binding is reported `deploy-pushes` on every run because nothing
    // reads it. "We did not look" is not evidence of drift, and must not fail a check.
    expect(pendingRows([unqueried("deploy-pushes")])).toEqual([]);
    expect(pendingRows([row("deploy-pushes")])).toHaveLength(1);
  });
});

describe("--check and --json", () => {
  const cmd = createSyncAccountCommand();

  it("declares both flags", () => {
    expect(cmd.flags.check).toBeDefined();
    expect(cmd.flags.json).toBeDefined();
    expect(cmd.flags.yes).toBeDefined();
  });

  it("rejects --check alongside --commit rather than picking one", () => {
    type Flags = Parameters<NonNullable<typeof cmd.run>>[1];
    expect(cmd.run?.([], { check: true, commit: true } as Flags)).rejects.toThrow(/--check asks whether anything is pending; --commit applies it/);
  });

  it("says --check is for CI in its own help", () => {
    expect(cmd.flags.check?.description).toMatch(/Exit non-zero/);
  });

  it("promises --json is the only thing on stdout", () => {
    expect(cmd.flags.json?.description).toMatch(/only thing written to stdout/);
  });

  // FORCE_COLOR=3 defeats isTTY, NO_COLOR and CI detection alike, so asserting under it is the
  // only way these guarantees are not passing by accident.
  describe("under FORCE_COLOR=3", () => {
    const results: SyncResult[] = [
      { resourceType: "vars", binding: "BASE_URL", remoteName: "BASE_URL", action: "deploy-pushes", local: true, remote: false },
    ];

    it("resolves a real colour level, so the guard below is doing the work", () => {
      expect(resolveColorLevel({ env: { FORCE_COLOR: "3", NO_COLOR: "1", CI: "1" }, isTTY: false })).toBe(3);
    });

    it("writes the document and nothing else, byte for byte", () => {
      const report = { target: "worker", results, pending: pendingRows(results).length };
      expect(JSON.stringify(report, null, 2)).toBe(createColorize(3).strip(JSON.stringify(report, null, 2)));
    });

    it("emits no escape sequence from the table renderer PLAIN selects", () => {
      const written: string[] = [];
      const original = console.log;
      console.log = (line?: unknown) => void written.push(String(line ?? ""));
      try {
        printResults(results, { kind: "worker", name: "proj" }, "PROJ", [], { style: PLAIN });
      } finally {
        console.log = original;
      }
      expect(written.join("\n")).toBe(createColorize(3).strip(written.join("\n")));
    });

    it("would have emitted one had a styler been passed instead", () => {
      const written: string[] = [];
      const original = console.log;
      console.log = (line?: unknown) => void written.push(String(line ?? ""));
      try {
        printResults(results, { kind: "worker", name: "proj" }, "PROJ", [], { style: createColorize(3) });
      } finally {
        console.log = original;
      }
      expect(written.join("\n")).not.toBe(createColorize(3).strip(written.join("\n")));
    });
  });
});

describe("printResults() — colour and width", () => {
  const WORKER_T: DeploymentTarget = { kind: "worker", name: "proj" };

  function capture(results: SyncResult[], options: Parameters<typeof printResults>[4]): string {
    const written: string[] = [];
    const original = console.log;
    console.log = (line?: unknown) => void written.push(String(line ?? ""));
    try {
      printResults(results, WORKER_T, "PROJ", [], options);
    } finally {
      console.log = original;
    }
    return written.join("\n");
  }

  const row = (action: SyncResult["action"]): SyncResult => ({ resourceType: "vars", binding: "B", action, local: true, remote: false });
  const style = createColorize(1);

  it("greens an outcome that is settled", () => {
    expect(capture([row("in-sync")], { style })).toContain(style.green("in sync"));
  });

  it("cyans work that is waiting on --commit", () => {
    expect(capture([row("would-create")], { style })).toContain(style.cyan("create on --commit"));
  });

  it("yellows an outcome that wants a look", () => {
    expect(capture([row("drift")], { style })).toContain(style.yellow("drift"));
  });

  it("reds a failure", () => {
    expect(capture([row("error")], { style })).toContain(style.red("error"));
  });

  it("dims the rows that ask nothing of the reader", () => {
    expect(capture([row("deploy-pushes")], { style })).toContain(style.dim("deploy pushes"));
  });

  it("emits no escape sequence at all by default", () => {
    const out = capture([row("error")], {});
    expect(out).toBe(style.strip(out));
  });

  it("pads a coloured cell by its visible width, so the closing verticals still line up", () => {
    const lines = capture([row("in-sync"), row("would-create")], { style })
      .split("\n")
      .filter(isGridLine);
    expect(new Set(lines.map((l) => style.strip(l).length)).size).toBe(1);
  });

  it("puts the note grey on the line under the bold heading, at different weights on purpose", () => {
    // Asserts the shape, not the prose: what a note *says* is settled once, in the wording tests
    // above, and repeating it here only means rewording one note breaks two tests.
    const lines = capture([row("in-sync")], { style }).split("\n");
    const heading = lines.indexOf(style.bold("Pushed by the Next Deploy"));
    expect(heading).toBeGreaterThan(-1);
    const note = lines[heading + 1] ?? "";
    expect(note).toBe(`  ${style.gray(style.strip(note).trim())}`);
  });

  it("wraps the section note to the width instead of running off the window", () => {
    const first = capture([row("in-sync")], { width: 60 })
      .split("\n")
      .filter((l) => l !== "" && !isGridLine(l));
    expect(first.every((line) => line.length <= 60)).toBe(true);
  });
});

describe("--rotate and --local", () => {
  const cmd = createSyncAccountCommand();
  type Flags = Parameters<NonNullable<typeof cmd.run>>[1];

  function makeProject(devVars: string): string {
    const dir = mkdtempSync(join(tmpdir(), "foundry-cli-"));
    writeFileSync(join(dir, "wrangler.jsonc"), `{ "name": "proj" }`, "utf-8");
    writeFileSync(join(dir, ".dev.vars"), devVars, "utf-8");
    return join(dir, "wrangler.jsonc");
  }

  function run(flags: Record<string, unknown>): void | Promise<void> {
    return cmd.run?.([], flags as Flags);
  }

  it("declares both flags", () => {
    expect(cmd.flags.rotate).toBeDefined();
    expect(cmd.flags.local).toBeDefined();
  });

  it("points at the marker in the flag's own help", () => {
    expect(cmd.flags.rotate?.description).toContain(GENERATE_MARKER);
  });

  it("rejects --local without --rotate rather than inventing a mode", () => {
    expect(() => run({ local: true })).toThrow(/--local only means something alongside --rotate/);
  });

  it("refuses to rotate a key that is not marked, naming the file", () => {
    const config = makeProject("STRIPE_KEY=sk_live_x\n");
    expect(() => run({ local: true, config, rotate: "STRIPE_KEY" })).toThrow(/Not marked rotatable/);
  });

  it("refuses a name absent from .dev.vars", () => {
    const config = makeProject(`${GENERATE_MARKER}\nSESSION_SECRET=v\n`);
    expect(() => run({ local: true, config, rotate: "TYPO" })).toThrow(/Not defined in/);
  });

  it("rejects an empty --rotate", () => {
    const config = makeProject(`${GENERATE_MARKER}\nSESSION_SECRET=v\n`);
    expect(() => run({ local: true, config, rotate: " , " })).toThrow(/--rotate was empty/);
  });

  it("writes nothing to .dev.vars without --commit", async () => {
    const config = makeProject(`${GENERATE_MARKER}\nSESSION_SECRET=keep-me\n`);
    const devVars = join(dirname(config), ".dev.vars");
    await run({ local: true, config, rotate: "SESSION_SECRET" });
    expect(readFileSync(devVars, "utf-8")).toContain("SESSION_SECRET=keep-me");
  });

  it("expands --rotate all to every rotate-marked key, and only those", () => {
    const config = makeProject(`${GENERATE_MARKER}\nA=1\n# foundry:push\nB=2\nC=3\n${GENERATE_MARKER}\nD=4\n`);
    expect(resolveRotation("all", config)).toEqual(["A", "D"]);
  });

  it("refuses --rotate all when nothing is marked, rather than silently doing nothing", () => {
    const config = makeProject("# foundry:push\nSTRIPE_KEY=v\n");
    expect(() => resolveRotation("all", config)).toThrow(/found no keys marked "# foundry:generate"/);
  });

  it("rotates every marked key when --local --rotate all is given", async () => {
    const config = makeProject(`${GENERATE_MARKER}\nA=old-a\n${GENERATE_MARKER}\nB=old-b\nKEEP=keep-me\n`);
    const devVars = join(dirname(config), ".dev.vars");

    await run({ local: true, commit: true, yes: true, config, rotate: "all" });

    const after = readFileSync(devVars, "utf-8");
    expect(after).not.toContain("old-a");
    expect(after).not.toContain("old-b");
    expect(after).toContain("KEEP=keep-me");
  });

  it("refuses to rotate without a terminal unless --yes says so deliberately", async () => {
    // The marker says a key *may* be regenerated; it does not say this run should.
    // Silence from a pipe is not consent, and the old values cannot be recovered.
    const config = makeProject(`${GENERATE_MARKER}\nSESSION_SECRET=keep-me\n`);
    expect(run({ local: true, commit: true, config, rotate: "SESSION_SECRET" })).rejects.toThrow(
      /Refusing to rotate 1 secret .* without a terminal to confirm at: SESSION_SECRET/s,
    );
  });

  it("leaves the file untouched when it refuses", async () => {
    const config = makeProject(`${GENERATE_MARKER}\nSESSION_SECRET=keep-me\n`);
    const devVars = join(dirname(config), ".dev.vars");
    await Promise.resolve(run({ local: true, commit: true, config, rotate: "SESSION_SECRET" })).catch(() => {});
    expect(readFileSync(devVars, "utf-8")).toContain("SESSION_SECRET=keep-me");
  });

  it("asks nothing when there is nothing to rotate", async () => {
    // A read-only run never reaches the prompt, --yes or not.
    const config = makeProject(`${GENERATE_MARKER}\nSESSION_SECRET=keep-me\n`);
    await run({ local: true, config, rotate: "SESSION_SECRET" });
    expect(readFileSync(join(dirname(config), ".dev.vars"), "utf-8")).toContain("SESSION_SECRET=keep-me");
  });

  it("rotates the local value under --commit, and needs no credentials to do it", async () => {
    // --local touches no API, so it must not go looking for an account id or token.
    const config = makeProject(`${GENERATE_MARKER}\nSESSION_SECRET=old\nSTRIPE_KEY=sk_live_x\n`);
    const devVars = join(dirname(config), ".dev.vars");

    await run({ local: true, commit: true, yes: true, config, rotate: "SESSION_SECRET" });

    const after = readFileSync(devVars, "utf-8");
    expect(after).not.toContain("SESSION_SECRET=old");
    expect(after).toMatch(/SESSION_SECRET=[0-9a-f]{64}\n/);
    expect(after).toContain("STRIPE_KEY=sk_live_x");
  });
});

describe("describeUntouchedZone", () => {
  const withSite = (body: string | null): string => {
    const dir = mkdtempSync(join(tmpdir(), "forge-untouched-"));
    if (body !== null) writeFileSync(join(dir, "site.ts"), body);
    return dir;
  };

  it("names the zone scope a defaulted run left alone", () => {
    const dir = withSite('export default { origin: "https://x.test", zone: { apex: "x.test" } };');
    expect(describeUntouchedZone(dir, "site.ts")).toContain("forge cf sync zone");
    rmSync(dir, { recursive: true, force: true });
  });

  it("is silent when the site config declares no zone — there is nothing to have missed", () => {
    const dir = withSite('export default { origin: "https://x.test" };');
    expect(describeUntouchedZone(dir, "site.ts")).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("is silent when there is no site config at all", () => {
    const dir = withSite(null);
    expect(describeUntouchedZone(dir, "site.ts")).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
