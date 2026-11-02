// `runD1Backup` as `forge cf dev` serves it: the local transport, real miniflare D1 and R2, and workerd's DigestStream.
import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { serveWorker } from "../../src/testing/harness";

const CONFIG = new URL("../fixtures/d1-backup/wrangler.jsonc", import.meta.url).pathname;

test.describe.configure({ timeout: 120_000 });

test("backs a seeded local database up into local R2 under dev, with a sidecar matching the seed and the stored bytes", async () => {
  const { harness, origin } = await serveWorker({ config: CONFIG, dev: true });
  try {
    expect((await fetch(`${origin}/seed`)).status).toBe(204);
    const res = await fetch(`${origin}/backup`);
    const { sidecar, read, dump } = (await res.json()) as { sidecar: Record<string, unknown>; read: unknown; dump: string };

    expect(read).toEqual(sidecar);
    expect(sidecar).toMatchObject({
      bookmark: `local-${Date.parse("2026-11-02T03:00:00Z")}`,
      rows: { _forge_migrations: 1, notes: 4 },
      migrationHead: "0001_notes.sql",
      hazards: [],
      size: Buffer.byteLength(dump),
      md5: createHash("md5").update(dump).digest("hex"),
      sha256: createHash("sha256").update(dump).digest("hex"),
    });
    expect(dump).toContain("replace('two\\nlines','\\n',char(10))");
  } finally {
    await harness.close();
  }
});

test("restores the local dump into a standby binding under dev, matching its sidecar row for row, a lone backslash-n and ANALYZE's statistics included", async () => {
  const { harness, origin } = await serveWorker({ config: CONFIG, dev: true });
  try {
    await fetch(`${origin}/seed`);
    const { sidecar } = (await (await fetch(`${origin}/backup`)).json()) as { sidecar: { key: string } };
    const res = await fetch(`${origin}/restore?key=${encodeURIComponent(sidecar.key)}`);
    const { report, notes } = (await res.json()) as { report: Record<string, unknown>; notes: unknown[] };

    expect(report).toMatchObject({ name: "backup-fixture-standby", key: sidecar.key, bookmark: null, mismatches: [] });
    expect(notes).toEqual([
      { id: 1, body: "one" },
      { id: 2, body: "two\nlines" },
      { id: 3, body: "three" },
      { id: 4, body: "four\\nliteral" },
    ]);

    const again = await fetch(`${origin}/restore?key=${encodeURIComponent(sidecar.key)}`);
    expect([again.status, ((await again.json()) as { kind: string }).kind]).toEqual([422, "target"]);
  } finally {
    await harness.close();
  }
});

test("refuses a local backup without dev, since a production build reaches the export only over REST", async () => {
  const { harness, origin } = await serveWorker({ config: CONFIG });
  try {
    await fetch(`${origin}/seed`);
    const res = await fetch(`${origin}/backup`);
    expect([res.status, await res.json()]).toEqual([422, { kind: "options", message: "accountId, apiToken is empty" }]);
  } finally {
    await harness.close();
  }
});
