import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { gateFixtureRoot } from "../../../src/tooling/gate/checks/gate.fixture";
import { compileDetector, detectorReaches, globMatcher, rgArgv, sweepRules } from "./check";
import { loadRegister } from "./load";
import type { RegisteredRule, RgDetector } from "./types";

const REPO = resolve(import.meta.dir, "../../..");

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = gateFixtureRoot(files, "warden-check-");
  roots.push(root);
  return root;
}

function rule(id: string, detector: Omit<RgDetector, "kind">): RegisteredRule {
  return {
    id,
    statement: `Never ${id}.`,
    detectors: [{ kind: "rg", ...detector }],
    origin: "repo",
    scope: ["libs"],
    rationale: { corpus: "project", path: "docs/R.md", section: "1", line: 3, chunk: "project:docs/R.md#1" },
    declaredIn: "config/rules.config.ts",
  };
}

describe("globMatcher", () => {
  it("matches a glob without a slash against the basename when including, and against any segment when excluding", () => {
    expect(globMatcher("*.test.ts*", "include")("src/a/b.test.tsx")).toBe(true);
    expect(globMatcher("*.test.ts*", "include")("src/a.test/b.ts")).toBe(false);
    expect(globMatcher("design", "exclude")("src/ui/design/x.md")).toBe(true);
  });

  it("anchors a glob with a slash at the root, `**/` matching zero or more directories", () => {
    expect(globMatcher("src/app/config.ts", "exclude")("src/app/config.ts")).toBe(true);
    expect(globMatcher("src/app/config.ts", "exclude")("lib/src/app/config.ts")).toBe(false);
    expect(globMatcher("**/*.mjs", "exclude")("a.mjs")).toBe(true);
    expect(globMatcher("**/*.mjs", "exclude")("src/x/a.mjs")).toBe(true);
    expect(globMatcher("src/testing/d1/*.ts", "exclude")("src/testing/d1/deep/a.ts")).toBe(false);
  });

  it("excludes everything under a directory an anchored glob names", () => {
    expect(globMatcher("src/client", "exclude")("src/client/a/b.ts")).toBe(true);
    expect(globMatcher("src/client/**", "exclude")("src/client/a.ts")).toBe(true);
  });

  it("reads `[!…]` as a negated class and `{a,b}` as alternatives", () => {
    expect(globMatcher("[!a]*.ts", "include")("b.ts")).toBe(true);
    expect(globMatcher("[!a]*.ts", "include")("a.ts")).toBe(false);
    expect(globMatcher("*.{ts,tsx}", "include")("x.tsx")).toBe(true);
    expect(globMatcher("*.{ts,tsx}", "include")("x.js")).toBe(false);
  });
});

describe("compileDetector", () => {
  it("refuses a lookaround without `pcre`, which rg's default engine rejects", () => {
    const result = compileDetector({ kind: "rg", pattern: "a(?!b)", paths: ["."], level: "fail" });
    expect(result).toEqual({ ok: false, error: "uses lookaround or a backreference without `pcre: true`" });
  });

  it("names the engine's complaint when the pattern does not compile", () => {
    const result = compileDetector({ kind: "rg", pattern: "a(", paths: ["."], level: "fail" });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toStartWith("does not compile — ");
  });

  it("compiles case-insensitively under `ignoreCase`", () => {
    const result = compileDetector({ kind: "rg", pattern: "host", paths: ["."], ignoreCase: true, level: "warn", triage: "t" });
    expect(result.ok && result.data.test("HOST")).toBe(true);
  });
});

describe("rgArgv", () => {
  it("spells the detector as the rg command it stands for", () => {
    const detector: RgDetector = {
      kind: "rg",
      pattern: "x(?=y)",
      paths: ["src/"],
      include: ["*.ts"],
      exclude: ["src/a/**"],
      pcre: true,
      ignoreCase: true,
      level: "fail",
    };
    expect(rgArgv(detector)).toEqual(["rg", "-n", "-P", "-i", "-e", "x(?=y)", "src/", "--glob", "*.ts", "--glob", "!src/a/**"]);
  });

  it("passes a pattern that opens with a dash as the pattern, never as a flag", () => {
    const root = fixture({ "src/a.ts": "// x -- see the note\nconst y = 1;\n" });
    const detector: RgDetector = { kind: "rg", pattern: String.raw`--\s*see`, paths: ["src/"], level: "warn" };
    const [, ...args] = rgArgv(detector);
    const rg = spawnSync("rg", ["--no-heading", "--with-filename", ...args], { cwd: root, encoding: "utf-8" });
    expect([rg.status, rg.stdout.trim()]).toEqual([0, "src/a.ts:1:// x -- see the note"]);
  });
});

describe("detectorReaches", () => {
  it("needs a path, any include and no exclude to match", () => {
    const detector: RgDetector = { kind: "rg", pattern: "x", paths: ["src/"], include: ["*.ts"], exclude: ["src/gen/**"], level: "fail" };
    expect(detectorReaches(detector, "src/a.ts")).toBe(true);
    expect(detectorReaches(detector, "srcs/a.ts")).toBe(false);
    expect(detectorReaches(detector, "src/a.md")).toBe(false);
    expect(detectorReaches(detector, "src/gen/a.ts")).toBe(false);
  });

  it("anchors a path at the repository root, so warden's source needs its own path", () => {
    const detector: RgDetector = { kind: "rg", pattern: "x", paths: ["src/"], level: "warn" };
    expect(detectorReaches(detector, "warden/src/rules/check.ts")).toBe(false);
    expect(detectorReaches({ ...detector, paths: ["src/", "warden/src/"] }, "warden/src/rules/check.ts")).toBe(true);
  });
});

describe("sweepRules", () => {
  const FILES = {
    "src/a.ts": "const k = c.env.API_KEY;\nconst db = c.env.DB;\nok\n",
    "src/app/config.ts": "const k = c.env.API_KEY;\n",
    "src/blob.bin": "c.env.X\0",
  };
  const RAW_ENV = rule("raw-env", {
    pattern: String.raw`c\.env\.[A-Z_]+`,
    paths: ["src/"],
    exclude: ["src/app/config.ts"],
    level: "warn",
    triage: "a binding is fine",
  });
  const NEVER = rule("never-ok", { pattern: "^ok$", paths: ["src/"], level: "fail" });

  it("reports each matching line with its rule, level and match, and each named rule once with its triage", () => {
    const result = sweepRules({ root: fixture(FILES), rules: [RAW_ENV, NEVER] });
    expect(result).toEqual({
      ok: true,
      data: {
        findings: [
          { rule: "raw-env", level: "warn", file: "src/a.ts", line: 1, match: "const k = c.env.API_KEY;" },
          { rule: "raw-env", level: "warn", file: "src/a.ts", line: 2, match: "const db = c.env.DB;" },
          { rule: "never-ok", level: "fail", file: "src/a.ts", line: 3, match: "ok" },
        ],
        rules: [
          { id: "raw-env", statement: "Never raw-env.", rationale: "project:docs/R.md#1", triage: "a binding is fine" },
          { id: "never-ok", statement: "Never never-ok.", rationale: "project:docs/R.md#1" },
        ],
        scanned: 2,
      },
    });
  });

  it("checks only the named files, rules and level", () => {
    const root = fixture(FILES);
    const byFile = sweepRules({ root, rules: [RAW_ENV, NEVER], files: ["src/app/config.ts"] });
    expect(byFile.ok && byFile.data.findings).toEqual([]);
    const byRule = sweepRules({ root, rules: [RAW_ENV, NEVER], ids: ["never-ok"] });
    expect(byRule.ok && byRule.data.findings.map((finding) => finding.rule)).toEqual(["never-ok"]);
    const byLevel = sweepRules({ root, rules: [RAW_ENV, NEVER], level: "fail" });
    expect(byLevel.ok && byLevel.data.findings.map((finding) => finding.rule)).toEqual(["never-ok"]);
  });

  it("refuses a rule id the register does not hold", () => {
    expect(sweepRules({ root: fixture(FILES), rules: [RAW_ENV], ids: ["nope"] })).toEqual({
      ok: false,
      error: "no registered rule is named `nope`",
    });
  });

  it("refuses a detector whose pattern does not compile, naming its rule", () => {
    const broken = rule("broken", { pattern: "a(?=b)", paths: ["."], level: "fail" });
    expect(sweepRules({ root: fixture(FILES), rules: [broken] })).toEqual({
      ok: false,
      error: "rule `broken`'s pattern uses lookaround or a backreference without `pcre: true`",
    });
  });

  it("checks only files changed against a git ref, untracked ones included, under --diff", () => {
    const root = fixture({ "src/old.ts": "ok\n", "src/edited.ts": "fine\n" });
    const run = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf-8" });
    run("init", "-q");
    run("add", ".");
    run("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
    writeFileSync(resolve(root, "src/edited.ts"), "ok\n");
    writeFileSync(resolve(root, "src/new.ts"), "ok\n");

    const result = sweepRules({ root, rules: [NEVER], diff: "HEAD" });
    expect(result.ok && result.data.findings.map((finding) => finding.file)).toEqual(["src/edited.ts", "src/new.ts"]);
    expect(sweepRules({ root, rules: [NEVER], diff: "no-such-ref" }).ok).toBe(false);
  });

  it("checks a diff from a root below the repository's top level, naming files from that root", () => {
    const top = fixture({ "app/src/old.ts": "fine\n", "other/src/x.ts": "fine\n" });
    const run = (...args: string[]) => spawnSync("git", args, { cwd: top, encoding: "utf-8" });
    run("init", "-q");
    run("add", ".");
    run("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
    writeFileSync(resolve(top, "app/src/old.ts"), "ok\n");
    writeFileSync(resolve(top, "other/src/x.ts"), "ok\n");

    const result = sweepRules({ root: resolve(top, "app"), rules: [NEVER], diff: "HEAD" });
    expect(result.ok && result.data.findings.map((finding) => finding.file)).toEqual(["src/old.ts"]);
  });
});

// One line that every registered pattern should find, and the decoys beside them a pattern must not.
const PLANTS = [
  "const key = c.env.API_KEY;",
  "const db = c.env.DB;",
  'const res = await fetch("https://api.example.com");',
  'import { mount } from "@y-core/forge/ui/client";',
  'import { x } from "./client.ts";',
  "<script>alert(1)</script>",
  "<script nonce={nonce}>boot()</script>",
  'expect(html).toContain("<p>");',
  "expect(list.includes(3)).toBe(true);",
  'const origin = request.headers.get("X-Forwarded-Host");',
  'const next = url.searchParams.get("next");',
  'const method = form.get("_method");',
  'const cls = "focus-visible:ring-2 disabled:opacity-50";',
  'import * as v from "valibot";',
  "import { object } from 'valibot';",
  'import { Headers } from "../http/mod";',
  'import { v } from "../validation/mod";',
  'const file = Bun.file("x");',
  'import { readFileSync } from "node:fs";',
  "const handle = setTimeout(tick, 10);",
  "  icon: ForgeIcon<string>;",
  "  icon?: ForgeIcon;",
  '  icon: ForgeIcon<"chevron-down">;',
  'authenticatorSelection: { userVerification: "preferred" },',
  "if (results.prf.enabled) return true;",
  'headers.set("Content-Disposition", "attachment");',
  'logger.info("request", { cookie: request.headers.get("Cookie") });',
  "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
  "return { ok: true, data };",
  "const text = issues[0].message;",
  "const secretKey = root.dataset.secret;",
  "const secrets = parseKeyRingSecrets(c.env.CSRF_SECRET);",
  'import { MatcherResourceError } from "@remix-run/route-pattern/match";',
  "const field = csrfFieldCtx.get(c);",
  'const user = c.get("user");',
  "<a href={safeUrl(next)}>Continue</a>",
  '  fontSrc: ["\'self\'", "https://fonts.gstatic.com"],',
  'app.use("*", cors(options));',
  "rateLimits: { LOGIN: { limit: 5, period: 60 } },",
  ") STRICT, WITHOUT ROWID;",
  "const store = createKVStore(env.LOGS);",
  'const ring = await importKeyRing(["3e8f0241998536b82050a9b2cdb21c47ee4215e1bd4ec7a04ec2ad348757f370"]);',
  "const db = c.env.DB as unknown as D1Database;",
  'if (failure.message.includes("UNIQUE")) return err("taken");',
  "See [the source](../../src/a.ts) for the rule.",
  'bun test && echo "EXIT:$?"',
  "let current = null;",
  "export function makeClient() {}",
  "// oxlint-disable-next-line no-shadow -- see the note above",
  'logger.info("signed in", { email: user.email });',
  "logger.error(`failed for ${id}`);",
  "const store = resolveKVStore(c, { required: false });",
  'headers.set("Cache-Control", "public, max-age=60");',
  "return { ok: true, data };",
  'import { x } from "../node_modules/pkg/x.js";',
  "export function createWidget(config: WidgetConfig) {}",
  'import { expect } from "vitest";',
  '"bun-types": "1.0.0",',
  '"happy-dom": "1.0.0",',
  "expect(spy).toHaveBeenCalled();",
  'describe("a suite", () => {});',
  '"sinon": "1.0.0",',
  "steps.push(typeAwareLintStep({ sources }));",
  'import { x } from "@y-core/forge/src/http/mod";',
  '"forge": "https://codeload.github.com/y/forge/tar.gz/v1",',
  'expect(res.headers.get("x-frame-options")).toContain("DENY");',
  "expect(res.status).toBeLessThan(500);",
  'it.skip("slow", () => {});',
  'const origin = "http://localhost:8788";',
  '"port": 8788,',
  "  port: 8788,",
  "  retries: 2,",
  'const key = "AKIAIOSFODNN7EXAMPLE";',
  '"deploy": "wrangler deploy --force",',
  "return c.env.ASSETS.fetch(request);",
  'const wasm = "node_modules/harfbuzzjs/dist/hb.wasm";',
  'const skip = (name: string) => name.endsWith(".test.ts");',
  'import type { Plugin } from "oxlint";',
  'const url = git(["remote", "get-url", "origin"]);',
  "return { ok: false, findings, summary };",
  'import { icons } from "@assets";',
  '"devDependencies": { "bun-types": "1.1.0" },',
  'preload = ["@happy-dom/global-registrator"]',
  'const track = getComputedStyle(el, "::-webkit-slider-runnable-track");',
  '/// <reference types="@cloudflare/workers-types" />',
  'spyOn(fakeKV(), "put");',
  'import type { TestD1 } from "./mod";',
  '<div data-selected="true">',
  "<div data-state={JSON.stringify(state)}>",
  '<span data-tone="primary">',
  "const name = STATE_ATTRS[key];",
  'class={cn("field-chrome", "state-invalid", cls)}',
  '<div class={cn("p-4", "flex")} />',
  "class={cn(buttonVariants({ tone }), cls)}",
  'class={cn(cls, "p-4")}',
  "window.turnstile.ready(render);",
  "openPopoverAt(popup, x, y, { afterPointerUp: true });",
  "announce(text, { channel: ANNOUNCE_TOAST_CHANNEL });",
  'document.addEventListener("htmx:finally:request", cancel);',
  'root.addEventListener("command", onCommand);',
  '<script src="https://unpkg.com/htmx.org@2"></script>',
  'document.body.addEventListener("htmx:error", cancel);',
  "<!-- rule:design-wrong-prefix -->",
  "<!-- rule:forge-ui-misplaced -->",
  '[data-slot="button"] { gap: 0; }',
  'Turnstile({ siteKey: "0x4AAAAAAA" });',
  'const FRAME = "inline-flex overflow-x-hidden";',
  "const parts = value.split(/\\s+/);",
  'import { Drawer } from "../core/drawer";',
  '<button data-on-click="toggle">',
  '<Dialog.Trigger shape="icon" class="size-8">',
  '<nav role="menubar">',
  '<main class="h-screen">',
  '<span class="text-sm leading-snug font-medium">',
  '"@radix-ui/colors": "3.0.0",',
  '<form data-scope="passkey" data-passkey-mode="registration">',
  "sql`UPDATE auth_factors SET failed_attempts = 0, last_verified_at = ${at}`",
  "const webhooks = createWebhookSigning({ secrets });",
  "const storage = createMemorySessionStorage();",
  "await Bun.sleep(1100);",
  '"./storage": "./src/storage/mod.ts",',
  'expect(href).toBe("/assets/main.3f9a2b1c.css");',
  'import { Resumable } from "../server/mod";',
].join("\n");

function materialise(glob: string): string {
  return glob
    .replace(/^\//, "")
    .replaceAll("**", "deep/er")
    .replaceAll("*", "x")
    .replace(/\{([^,}]*)[^}]*\}/g, "$1")
    .replace(/\/$/, "/x.ts");
}

function parityTree(detectors: readonly RgDetector[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const detector of detectors) {
    for (const path of detector.paths) {
      // A path naming a file, such as `package.json`, is planted as that file, so another detector's glob can place it too.
      if (/^[^/]*\.[a-z]+$/.test(path)) {
        files[path] = PLANTS;
        continue;
      }
      const dir = path === "." ? "" : `${path.replace(/\/$/, "")}/`;
      for (const name of ["plant.ts", "nested/plant.tsx", "plant.test.ts", "plant.test.tsx", "plant.md", "plant.mjs", "plant.browser.ts"])
        files[`${dir}${name}`] = PLANTS;
    }
    for (const glob of [...(detector.include ?? []), ...(detector.exclude ?? [])]) {
      const path = materialise(glob);
      const placed = path.includes("/") ? path : `${detector.paths[0]?.replace(/^\.$/, "") ?? ""}/${path}`.replace(/^\//, "");
      files[placed.endsWith("/x") ? `${placed}.ts` : placed] = PLANTS;
    }
  }
  return files;
}

describe("parity with rg", () => {
  const register = loadRegister({ root: REPO, kind: "libs", trees: ["shared", "libs", "apps"] });
  const rules = register.ok ? register.data.filter((entry) => entry.detectors.some((detector) => detector.kind === "rg")) : [];

  it("finds the registered patterns to compare", () => {
    expect(register.ok).toBe(true);
    expect(rules.length).toBeGreaterThanOrEqual(15);
  });

  it("finds, for every registered rg detector, exactly the lines rg finds over the same tree", () => {
    const detectors = rules.flatMap((entry) => entry.detectors.filter((detector): detector is RgDetector => detector.kind === "rg"));
    const root = fixture(parityTree(detectors));
    mkdirSync(dirname(resolve(root, "src/bin/x")), { recursive: true });
    writeFileSync(resolve(root, "src/bin/blob.ts"), `${PLANTS}\0`);

    const mismatches: string[] = [];
    let compared = 0;
    for (const entry of rules) {
      for (const detector of entry.detectors) {
        if (detector.kind !== "rg") continue;
        const [, ...args] = rgArgv(detector);
        const rg = spawnSync("rg", ["--no-heading", "--with-filename", ...args], { cwd: root, encoding: "utf-8" });
        expect(rg.error).toBeUndefined();
        const expected = rg.stdout
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => line.split(":").slice(0, 2).join(":").replace(/^\.\//, "").replaceAll("//", "/"))
          .sort();
        const swept = sweepRules({ root, rules: [entry] });
        const actual = swept.ok ? swept.data.findings.map((finding) => `${finding.file}:${finding.line}`).sort() : [];
        if (expected.length === 0) mismatches.push(`${entry.id}: the fixture plants nothing rg finds, so parity proves nothing`);
        compared += expected.length;
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          mismatches.push(`${entry.id}: rg ${JSON.stringify(expected)} vs warden ${JSON.stringify(actual)}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBeGreaterThan(0);
  });
});
