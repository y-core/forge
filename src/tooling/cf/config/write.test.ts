import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { countComments } from "../../cli/jsonc";
import { syncBindings } from "../account/engine";
import { kvHandler } from "../account/handlers/kv";
import type { WranglerConfig } from "../types";
import { loadWranglerConfig, writeWranglerConfig } from "./parse";

const AUTH = { apiToken: "tok", accountId: "acc" };

function project(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "foundry-write-"));
  const path = join(dir, "wrangler.jsonc");
  writeFileSync(path, source, "utf-8");
  return path;
}

/** Stubbed Cloudflare: the namespace does not exist yet, and creating it yields `ns-created`. */
const kvFetch: typeof globalThis.fetch = async (_url, init) => {
  if ((init?.method ?? "GET").toUpperCase() === "POST") {
    return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { id: "ns-created", title: "MY_SITE_MAIN_KV" } }));
  }
  return new Response(
    JSON.stringify({ success: true, errors: [], messages: [], result: [], result_info: { page: 1, per_page: 100, count: 0, total_count: 0 } }),
  );
};

// Real-world shape: a `https://` inside a comment and inside a string value, a
// trailing member comment, and a bare kv_namespaces entry with no id yet.
const INPUT = `{
  "name": "my-site",
  // Production deploys this binding. dev uses the workers config.
  // See https://developers.cloudflare.com/kv/ for the semantics.
  "vars": {
    "BASE_URL": "https://www.example.test" // the canonical origin
  },
  /* The namespace id is filled in by \`foundry sync --commit\`. */
  "kv_namespaces": [
    {
      "binding": "MAIN_KV"
    }
  ]
}
`;

const EXPECTED = `{
  "name": "my-site",
  // Production deploys this binding. dev uses the workers config.
  // See https://developers.cloudflare.com/kv/ for the semantics.
  "vars": {
    "BASE_URL": "https://www.example.test" // the canonical origin
  },
  /* The namespace id is filled in by \`foundry sync --commit\`. */
  "kv_namespaces": [
    {
      "binding": "MAIN_KV",
      "id": "ns-created"
    }
  ]
}
`;

describe("write-back round trip (bug-260825-04)", () => {
  it("inserts the resolved id and leaves every other byte identical", async () => {
    const path = project(INPUT);
    const loaded = loadWranglerConfig(path);

    const out = await syncBindings(loaded.config, { auth: AUTH }, [kvHandler], kvFetch);
    expect(out.results[0]?.action).toBe("created");
    expect(out.configChanged).toBe(true);

    const write = writeWranglerConfig(loaded, out.updatedConfig);
    expect(write.ok).toBe(true);

    // One byte-exact assertion covers every comment and every byte of formatting.
    expect(readFileSync(path, "utf-8")).toBe(EXPECTED);
  });

  it("leaves the file untouched when nothing changed", () => {
    const path = project(INPUT);
    const loaded = loadWranglerConfig(path);
    const write = writeWranglerConfig(loaded, loaded.config);

    expect(write.ok).toBe(true);
    if (!write.ok) return;
    expect(write.data.written).toBe(false);
    expect(readFileSync(path, "utf-8")).toBe(INPUT);
  });

  it("leaves no temp file behind", async () => {
    const path = project(INPUT);
    const loaded = loadWranglerConfig(path);
    const out = await syncBindings(loaded.config, { auth: AUTH }, [kvHandler], kvFetch);
    writeWranglerConfig(loaded, out.updatedConfig);

    const stray = readdirSync(join(path, "..")).filter((f) => f.includes("tmp"));
    expect(stray).toEqual([]);
  });

  it("reports how many values it spliced", async () => {
    const path = project(INPUT);
    const loaded = loadWranglerConfig(path);
    const out = await syncBindings(loaded.config, { auth: AUTH }, [kvHandler], kvFetch);
    const write = writeWranglerConfig(loaded, out.updatedConfig);
    if (!write.ok) throw write.error;
    expect(write.data.edits).toBe(1);
    expect(write.data.written).toBe(true);
  });
});

describe("write-back refusals", () => {
  const commented: WranglerConfig = { name: "w", kv_namespaces: [{ binding: "A" }] };

  function loadedFrom(source: string) {
    return loadWranglerConfig(project(source));
  }

  it("refuses an inexpressible change and names the path", () => {
    const loaded = loadedFrom(`{\n  // a comment\n  "name": "w"\n}\n`);
    // Adding a whole array is not a splice this writer can make.
    const write = writeWranglerConfig(loaded, { ...loaded.config, kv_namespaces: [{ binding: "A" }] });

    expect(write.ok).toBe(false);
    if (write.ok) return;
    expect(write.error.message).toMatch(/Refusing to write/);
    expect(write.error.message).toMatch(/kv_namespaces \(added array value\)/);
  });

  it("counts the comments at risk in the refusal", () => {
    const loaded = loadedFrom(`{\n  // one\n  // two\n  "name": "w"\n}\n`);
    const write = writeWranglerConfig(loaded, { ...loaded.config, extra: { nested: 1 } });
    if (write.ok) throw new Error("expected refusal");
    expect(write.error.message).toMatch(/2 comments in that file would be lost/);
    expect(write.error.message).toMatch(/--commit --force/);
  });

  it("does not write the file when it refuses", () => {
    const source = `{\n  // keep\n  "name": "w"\n}\n`;
    const path = project(source);
    const loaded = loadWranglerConfig(path);
    writeWranglerConfig(loaded, { ...loaded.config, kv_namespaces: [{ binding: "A" }] });
    expect(readFileSync(path, "utf-8")).toBe(source);
  });

  it("--force rewrites as plain JSON and reports what it destroyed", () => {
    const path = project(`{\n  // this note is about to die\n  "name": "w"\n}\n`);
    const loaded = loadWranglerConfig(path);
    const write = writeWranglerConfig(loaded, { ...loaded.config, kv_namespaces: [{ binding: "A" }] }, { force: true });

    if (!write.ok) throw write.error;
    expect(write.data.written).toBe(true);
    expect(write.data.lost?.comments).toBe(1);
    expect(write.data.lost?.unsupported).toEqual(["kv_namespaces (added array value)"]);

    const after = readFileSync(path, "utf-8");
    expect(after).not.toMatch(/this note is about to die/);
    expect(JSON.parse(after)).toEqual({ name: "w", kv_namespaces: [{ binding: "A" }] });
  });

  it("treats a removed key as inexpressible rather than dropping it", () => {
    const loaded = loadedFrom(`{\n  "name": "w",\n  "gone": 1\n}\n`);
    const { gone: _gone, ...without } = loaded.config as Record<string, unknown>;
    const write = writeWranglerConfig(loaded, without as unknown as WranglerConfig);
    if (write.ok) throw new Error("expected refusal");
    expect(write.error.message).toMatch(/gone \(key removed\)/);
  });

  it("still splices when the file carries no comments at all", () => {
    const path = project(`{\n  "name": "w",\n  "kv_namespaces": [\n    {\n      "binding": "A"\n    }\n  ]\n}\n`);
    const loaded = loadWranglerConfig(path);
    const updated = JSON.parse(JSON.stringify(loaded.config)) as typeof commented;
    updated.kv_namespaces![0]!.id = "x";
    const write = writeWranglerConfig(loaded, updated);
    if (!write.ok) throw write.error;
    expect(readFileSync(path, "utf-8")).toContain(`      "binding": "A",\n      "id": "x"\n`);
  });
});

describe("against a real-world config", () => {
  // cornellaw's worker config carries a `https://` inside a comment and another
  // inside a string value — the two cases a naive comment stripper conflates.
  const REAL = join(import.meta.dir, "../../../../../cornellaw/wrangler.workers.jsonc");

  it.skipIf(!existsSync(REAL))("round-trips it byte-for-byte when nothing changes", () => {
    const source = readFileSync(REAL, "utf-8");
    const path = project(source);
    const loaded = loadWranglerConfig(path);

    const write = writeWranglerConfig(loaded, loaded.config);
    if (!write.ok) throw write.error;
    expect(write.data.written).toBe(false);
    expect(readFileSync(path, "utf-8")).toBe(source);
  });

  it.skipIf(!existsSync(REAL))("keeps a https:// inside a string while dropping one inside a comment", () => {
    const loaded = loadWranglerConfig(REAL);
    expect(loaded.config.name).toBe("cornellaw");
    // The string value survives intact...
    expect(loaded.config.vars?.BASE_URL).toBe("https://127.0.0.1:8787");
    // ...while the prose that merely mentions a URL does not become config.
    expect(JSON.stringify(loaded.config)).not.toContain("load-bearing");
    expect(countComments(loaded.source)).toBeGreaterThan(5);
  });

  it.skipIf(!existsSync(REAL))("splices an id into it without disturbing the commentary", () => {
    const path = project(readFileSync(REAL, "utf-8"));
    const loaded = loadWranglerConfig(path);

    const updated = JSON.parse(JSON.stringify(loaded.config)) as WranglerConfig;
    (updated.ratelimits as { namespace_id: string }[])[0]!.namespace_id = "2002";

    const write = writeWranglerConfig(loaded, updated);
    if (!write.ok) throw write.error;

    const after = readFileSync(path, "utf-8");
    const before = readFileSync(REAL, "utf-8");
    expect(after).toBe(before.replace(`"namespace_id": "1001"`, `"namespace_id": "2002"`));
  });
});
