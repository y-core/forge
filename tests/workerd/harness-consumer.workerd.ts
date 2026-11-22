import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type CliRun, collect } from "./cli";
import { expect, test } from "./harness.fixture";

const FORGE = fileURLToPath(new URL("../../", import.meta.url));
const CONFIG = fileURLToPath(new URL("../fixtures/workers-form/wrangler.jsonc", import.meta.url));
const NODE_DB_CONSUMER = fileURLToPath(new URL("../fixtures/node-db-consumer/", import.meta.url));
const CSRF_SECRET = /"CSRF_SECRET": "([0-9a-f]+)"/.exec(readFileSync(CONFIG, "utf-8"))?.[1] ?? "";

const MANIFEST = JSON.parse(readFileSync(join(FORGE, "package.json"), "utf-8")) as {
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  exports: Record<string, { import: string; node?: string }>;
  forge: { node: readonly string[] };
};
const NODE_SUBPATHS = MANIFEST.forge.node.map((subpath) => `@y-core/forge${subpath.slice(1)}`);

const STATIC_IMPORT = /^\s*(?:import|export)\b[^;"']*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/** The packages a bundle's static imports name, without `node:` built-ins or relative paths. */
function bareImports(source: string): Set<string> {
  const packages = new Set<string>();
  for (const match of source.matchAll(STATIC_IMPORT)) {
    const specifier = match[1] ?? match[2] ?? "";
    if (specifier.startsWith("node:") || specifier.startsWith(".") || specifier.startsWith("/")) continue;
    packages.add(packageName(specifier));
  }
  return packages;
}

const BUNDLE_IMPORTS = MANIFEST.forge.node.map((subpath) => {
  const target = MANIFEST.exports[subpath];
  const bundle = target?.node ?? target?.import ?? "";
  return { bundle, packages: bareImports(readFileSync(join(FORGE, bundle), "utf-8")) };
});

const ROUND_TRIP = `
const { serveWorker } = await import("@y-core/forge/testing/harness");
const { CSRF_HEADER_DEFAULT, mintTestCsrfToken } = await import("@y-core/forge/testing/form");
const { harness, origin } = await serveWorker({ config: ${JSON.stringify(CONFIG)} });
const post = (headers) =>
  fetch(origin + "/api/contact", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ name: "Jane", email: "jane@example.com", message: "Hello." }).toString(),
  }).then((res) => res.status);
try {
  const token = await mintTestCsrfToken(${JSON.stringify(CSRF_SECRET)}, "/api/contact");
  console.log(JSON.stringify({ minted: await post({ [CSRF_HEADER_DEFAULT]: token }), missing: await post({}) }));
} finally {
  await harness.close();
}
`;

const LIMITED_WORKER = `
import { createApp } from "@y-core/forge/app";
import { rateLimit } from "@y-core/forge/security";
import { mapHandler } from "@y-core/forge/testing";

const app = createApp({
  middleware: (forge) => forge.use("*", rateLimit({ binding: "LIMITER" })),
  routes: (forge) => mapHandler(forge, "ANY", "/", () => new Response("ok")),
});

export default { fetch: (request, env, ctx) => app.fetch(request, env, ctx) };
`;

const ARMING = `
const { serveWorker } = await import("@y-core/forge/testing/harness");
const status = async (dev) => {
  const { harness, origin } = await serveWorker({ config: ${JSON.stringify(CONFIG)}, entry: "./limited.mjs", dev });
  try {
    return (await fetch(origin, { method: "POST" })).status;
  } finally {
    await harness.close();
  }
};
console.log(JSON.stringify({ dev: await status(true), strict: await status(false) }));
`;

const HOST_CONFIG = `import { defineDbConfig, forgeSchema } from "@y-core/forge/tooling/db/host";

export default defineDbConfig({
  schemas: [forgeSchema("auth"), "config/db/schema.sql"],
  migrations: "db/migrations",
});
`;

const POSTS_MIGRATION = "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL);\nCREATE INDEX posts_user ON posts (user_id);\n";

const DEFAULT_OPEN = `
const { openTestD1 } = await import("@y-core/forge/testing/d1");
const db = await openTestD1();
try {
  console.log(JSON.stringify(await db.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'posts'")));
} finally {
  await db.dispose();
}
`;

const EXPLAINED = `
const { explainPlan, openTestD1, scansTable, usesIndex } = await import("@y-core/forge/testing/d1");
const db = await openTestD1();
try {
  const plan = await explainPlan(db, "SELECT id FROM posts WHERE user_id = ?", [1]);
  console.log(JSON.stringify({ indexed: usesIndex(plan, "posts_user"), scanned: scansTable(plan, "posts") }));
} finally {
  await db.dispose();
}
`;

/** A consumer whose `node_modules` holds the tarball `bun pm pack` makes of forge, as the release ships it, with forge's dependencies and every package a `forge.node` bundle imports beside it. */
async function consumerRoot(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "forge-harness-consumer-"));
  const installed = join(root, "node_modules", "@y-core", "forge");
  mkdirSync(installed, { recursive: true });
  const pack = await collect("bun", ["pm", "pack", "--destination", root, "--quiet"], FORGE);
  if (pack.code !== 0) throw new Error(`bun pm pack failed: ${pack.stderr}`);
  const tarball = resolve(root, pack.stdout.trim().split("\n").at(-1) ?? "");
  const extract = await collect("tar", ["-xzf", tarball, "-C", installed, "--strip-components=1"], root);
  if (extract.code !== 0) throw new Error(`tar failed: ${extract.stderr}`);
  const linked = new Set([...Object.keys(MANIFEST.dependencies), ...BUNDLE_IMPORTS.flatMap(({ packages }) => [...packages])]);
  for (const name of linked) {
    const target = join(FORGE, "node_modules", name);
    if (!existsSync(target)) throw new Error(`${name} is not installed under ${join(FORGE, "node_modules")}`);
    mkdirSync(dirname(join(root, "node_modules", name)), { recursive: true });
    symlinkSync(target, join(root, "node_modules", name));
  }
  return root;
}

/** Runs `source` as an ES module under node from `root`, where `@y-core/forge` resolves to the installed tarball. */
function runNode(root: string, source: string): Promise<CliRun> {
  writeFileSync(join(root, "spec.mjs"), source);
  return collect("node", ["spec.mjs"], root, { timeoutMs: 120_000 });
}

test.describe("forge installed from its packed tarball", () => {
  let root = "";

  test.beforeAll(async () => {
    root = await consumerRoot();
  });

  test.afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("reads testing/form among the node subpaths from the `forge.node` declaration", () => {
    expect(NODE_SUBPATHS).toContain("@y-core/forge/testing/form");
  });

  test("declares every package a `forge.node` bundle imports as a dependency or a peer dependency", () => {
    const declared = new Set([...Object.keys(MANIFEST.dependencies), ...Object.keys(MANIFEST.peerDependencies)]);
    const undeclared = BUNDLE_IMPORTS.flatMap(({ bundle, packages }) =>
      [...packages].filter((name) => !declared.has(name)).map((name) => `${name} (${bundle})`),
    );

    expect(undeclared, `undeclared bundle imports: ${undeclared.join(", ")}`).toEqual([]);
  });

  for (const subpath of NODE_SUBPATHS) {
    test(`loads ${subpath} under node`, async () => {
      const run = await runNode(root, `console.log(String(Object.keys(await import(${JSON.stringify(subpath)})).length));`);

      expect(run.stderr).not.toContain("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING");
      expect(run.code).toBe(0);
      expect(Number(run.stdout.trim())).toBeGreaterThan(0);
    });
  }

  test("cuts one element out of a page with testing/markup's elementOf under node", async () => {
    const page = '<main><p class="lead">Save &amp; Exit</p><p data-ref="outcome">Done</p></main>';
    const run = await runNode(
      root,
      `const { elementOf } = await import("@y-core/forge/testing/markup"); console.log(JSON.stringify(elementOf(${JSON.stringify(page)}, "p", 'data-ref="outcome"')));`,
    );

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "")).toBe('<p data-ref="outcome">Done</p>');
  });

  test("reads every matching element out of a page with testing/markup's elementsOf under node", async () => {
    const page = '<ul><li data-ref="a">One</li><li data-ref="b">Two</li></ul>';
    const run = await runNode(
      root,
      `const { elementsOf } = await import("@y-core/forge/testing/markup"); console.log(JSON.stringify(elementsOf(${JSON.stringify(page)}, "li", "data-ref")));`,
    );

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "")).toEqual(['<li data-ref="a">One</li>', '<li data-ref="b">Two</li>']);
  });

  test("runs a service returning result's ok, err and captured throws under node", async () => {
    const run = await runNode(
      root,
      `const { err, ok, result } = await import("@y-core/forge/result");
const find = (id) => (id === 1 ? ok({ id }) : err("not-found"));
const thrown = result(() => { throw new Error("disk full"); });
const rejected = await result(Promise.reject("offline"));
console.log(JSON.stringify({ found: find(1), missing: find(2), done: ok(), thrown: [thrown.ok, thrown.error.message], rejected: [rejected.ok, rejected.error instanceof Error, rejected.error.message] }));`,
    );

    expect(run.stderr).not.toContain("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING");
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "")).toEqual({
      found: { ok: true, data: { id: 1 } },
      missing: { ok: false, error: "not-found" },
      done: { ok: true },
      thrown: [false, "disk full"],
      rejected: [false, true, "offline"],
    });
  });

  test("parses a form with validation's field schemas and names a refused field's path under node", async () => {
    const run = await runNode(
      root,
      `const { describeValidationIssue, formDigits, formMultilineText, formText, safeCheck, v } = await import("@y-core/forge/validation");
const schema = v.object({
  contact: v.object({ name: formText(), phone: formDigits(), email: v.pipe(formText(), safeCheck((value) => value.includes("@"), "Enter an email address.")) }),
  message: formMultilineText(),
});
const accepted = v.safeParse(schema, { contact: { name: "  Jane  ", phone: "(555) 010-2030", email: "jane@example.com" }, message: " Hi\\r\\nthere " });
const refused = v.safeParse(schema, { contact: { name: "Jane", phone: "1", email: "jane" }, message: "Hi" });
console.log(JSON.stringify({ accepted: accepted.output, refused: refused.issues.map((issue) => [describeValidationIssue(issue), issue.message]) }));`,
    );

    expect(run.stderr).not.toContain("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING");
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "")).toEqual({
      accepted: { contact: { name: "Jane", phone: "5550102030", email: "jane@example.com" }, message: "Hi\nthere" },
      refused: [["contact.email", "Enter an email address."]],
    });
  });

  test("submits a form through a Worker served by testing/harness with a token minted by testing/form", async () => {
    const run = await runNode(root, ROUND_TRIP);

    expect(run.stderr).not.toContain("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING");
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "")).toEqual({ minted: 200, missing: 403 });
  });

  test("serves a Worker without its rate limiter as `forge cf dev` builds it under dev, and refusing with 503 without", async () => {
    writeFileSync(join(root, "limited.mjs"), LIMITED_WORKER);
    const run = await runNode(root, ARMING);

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "")).toEqual({ dev: 200, strict: 503 });
  });
  test.describe("testing/d1 from a consumer's node spec", () => {
    test.beforeAll(() => {
      writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
      mkdirSync(join(root, "config"), { recursive: true });
      writeFileSync(join(root, "config", "db.config.ts"), HOST_CONFIG);
      mkdirSync(join(root, "db", "migrations"), { recursive: true });
      writeFileSync(join(root, "db", "migrations", "0001_posts.sql"), POSTS_MIGRATION);
    });

    test("opens a database with no options from a config/db.config.ts written as the tooling/db README shows", async () => {
      const run = await runNode(root, DEFAULT_OPEN);

      expect(run.stderr).not.toContain("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING");
      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "")).toEqual([{ name: "posts" }]);
    });

    test("explains a query with testing/d1, importing nothing node cannot load", async () => {
      const run = await runNode(root, EXPLAINED);

      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "")).toEqual({ indexed: true, scanned: false });
    });

    test("runs an app service built on storage/db under node, against openTestD1's binding", async () => {
      for (const file of ["posts-service.ts", "explain-posts.ts"]) writeFileSync(join(root, file), readFileSync(join(NODE_DB_CONSUMER, file)));
      const run = await collect("node", ["explain-posts.ts"], root, { timeoutMs: 120_000 });

      expect(run.stderr).not.toContain("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING");
      expect(run.code, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "")).toEqual({
        indexed: true,
        byUser: [
          { id: 1, user_id: 7 },
          { id: 2, user_id: 7 },
        ],
        post: { id: 3, user_id: 8 },
      });
    });
  });
});
