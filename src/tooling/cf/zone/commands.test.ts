import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { accountRoutes, adminRoutes } from "../../../auth/web/routes";
import { routePaths } from "../../../router/filter";
import { resolveSiteConfig } from "../../../site/config";
import type { SiteConfig, ZoneRule } from "../../../site/types";
import { ZonePatternError } from "../../../site/zone";
import { CliError } from "../../cli/errors";
import { createSyncZoneCommand, phaseAction, planZoneRules, rulesInSync } from "./commands";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const base: SiteConfig = {
  origin: "https://example.com",
  pages: ["/", "/fica"],
  robots: { rules: [{ userAgent: "*" }] },
  zone: {
    apex: "example.com",
    redirect: { from: ["www.example.com"] },
    allow: { action: "managed_challenge", paths: ["/", "/fica"], prefixes: ["/assets/"], files: ["/favicon.ico"] },
  },
};

const plan = (config: SiteConfig) => planZoneRules(resolveSiteConfig(config));

describe("planZoneRules", () => {
  it("plans the firewall phase before the redirect phase, one rule each", () => {
    const plans = plan(base);
    expect(plans.map((p) => [p.phase, p.desired.length])).toEqual([
      ["http_request_firewall_custom", 1],
      ["http_request_dynamic_redirect", 1],
    ]);
  });

  it("refuses an allow block that names no paths", () => {
    const config = { ...base, zone: { ...base.zone, allow: { action: "block" } } } as unknown as SiteConfig;
    expect(() => plan(config)).toThrow(/paths/);
  });

  it("emits the explicit allow.paths, not the GET-only page list", () => {
    const zone = { ...base.zone, allow: { ...base.zone?.allow, action: "block" as const, paths: ["/", "/api/contact"] } };
    const [firewall] = plan({ ...base, zone: { apex: "example.com", ...zone } });
    expect(firewall?.desired[0]?.expression).toContain('"/" "/api/contact" "/favicon.ico"');
    expect(firewall?.desired[0]?.expression).not.toContain('"/fica"');
    expect(firewall?.desired[0]?.action).toBe("block");
  });

  it("allows robots.txt and the sitemap on a zone that names no files", () => {
    const [firewall] = plan({ ...base, zone: { apex: "example.com", allow: { action: "block", paths: ["/"] } } });
    expect(firewall?.desired[0]?.expression).toContain('{"/" "/robots.txt" "/sitemap.xml"}');
  });

  it("plans the auth route maps with no literal param", () => {
    const paths = [...routePaths(accountRoutes("/account")), ...routePaths(adminRoutes("/admin"))];
    const [firewall] = plan({ ...base, zone: { ...base.zone, allow: { action: "block", paths } } });
    const expression = firewall?.desired[0]?.expression ?? "";
    for (const clause of expression.split(" or ")) {
      expect(clause).not.toContain(":");
      expect(clause).not.toMatch(/\*[A-Za-z_$]/);
    }
    expect(expression).toContain('strict wildcard "/admin/users/*/edit"');
    expect(expression).toContain('strict wildcard "/account/passkeys/*"');
  });

  it("refuses a catch-all route with the ZonePatternError the CLI prints", () => {
    const allow = { action: "block" as const, paths: ["/:slug"] };
    const refusal = (() => {
      try {
        plan({ ...base, zone: { ...base.zone, apex: "example.com", allow } });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(refusal instanceof ZonePatternError && refusal.reason).toBe("catch-all");
  });

  it("plans an empty rule list for a phase the config says nothing about", () => {
    const plans = plan({ ...base, zone: { apex: "example.com" } });
    expect(plans.map((p) => p.desired.length)).toEqual([0, 0]);
  });

  it("refuses a config with no zone block rather than silently clearing both phases", () => {
    expect(() => plan({ ...base, zone: undefined })).toThrow(/no `zone` block/);
  });
});

describe("rulesInSync", () => {
  const rule: ZoneRule = { action: "block", expression: "(true)", description: "d", enabled: true };

  it("ignores the id and version fields a remote rule carries besides", () => {
    const remote = { ...rule, id: "abc123", version: "7", last_updated: "2026-08-29" } as ZoneRule;
    expect(rulesInSync([rule], [remote])).toBe(true);
  });

  it("reports drift on a changed expression", () => {
    expect(rulesInSync([rule], [{ ...rule, expression: "(false)" }])).toBe(false);
  });

  it("reports drift on a changed action, which is the managed_challenge-to-block flip", () => {
    expect(rulesInSync([{ ...rule, action: "managed_challenge" }], [rule])).toBe(false);
  });

  it("reports drift on a differing rule count", () => {
    expect(rulesInSync([rule], [rule, rule])).toBe(false);
    expect(rulesInSync([], [rule])).toBe(false);
  });

  it("treats an unreadable phase as out of sync rather than as matching", () => {
    expect(rulesInSync([], null)).toBe(false);
  });

  it("treats two empty lists as in sync, so a phase neither side uses is not written every run", () => {
    expect(rulesInSync([], [])).toBe(true);
  });

  it("ignores the key order a server serialised action_parameters in", () => {
    const mine: ZoneRule = {
      ...rule,
      action: "redirect",
      action_parameters: { from_value: { status_code: 301, target_url: { expression: "x" }, preserve_query_string: true } },
    };
    const returned: ZoneRule = {
      ...rule,
      action: "redirect",
      action_parameters: { from_value: { preserve_query_string: true, status_code: 301, target_url: { expression: "x" } } },
    };
    expect(rulesInSync([mine], [returned])).toBe(true);
  });

  it("compares action_parameters, so a changed redirect target is drift", () => {
    const redirect: ZoneRule = { ...rule, action: "redirect", action_parameters: { from_value: { status_code: 301 } } };
    expect(rulesInSync([redirect], [{ ...redirect, action_parameters: { from_value: { status_code: 308 } } }])).toBe(false);
  });
});

describe("phaseAction", () => {
  const rule: ZoneRule = { action: "block", expression: "(true)", description: "d", enabled: true };
  const firewall = { name: "firewall", phase: "http_request_firewall_custom" };

  it("reports a phase this run wrote as updated", () => {
    expect(phaseAction({ ...firewall, desired: [rule], remote: [rule], written: true })).toBe("updated");
  });

  it("reports a phase the commit loop skipped as in-sync, whatever another phase did", () => {
    expect(phaseAction({ ...firewall, desired: [rule], remote: [rule] })).toBe("in-sync");
  });

  it("reports an unwritten difference as drift", () => {
    expect(phaseAction({ ...firewall, desired: [rule], remote: [] })).toBe("drift");
  });

  it("reports a phase that failed as error, written or not", () => {
    expect(phaseAction({ ...firewall, desired: [rule], remote: null, error: "auth failed" })).toBe("error");
  });
});

describe("sync zone — the site config module", () => {
  it("refuses a module with no default export, naming its path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-zone-"));
    roots.push(dir);
    const config = join(dir, "site.config.ts");
    writeFileSync(config, `export const site = ${JSON.stringify(base)};\n`, "utf-8");

    const cmd = createSyncZoneCommand();
    const flags = { config, json: true, "zone-id": "zone", "api-token": "token" };
    const run = cmd.run?.([], flags as Parameters<NonNullable<typeof cmd.run>>[1]);

    await expect(run).rejects.toBeInstanceOf(CliError);
    await expect(run).rejects.toThrow(`Could not load site config \`${config}\``);
  });
});

describe("sync zone --commit", () => {
  it("describes each written ruleset as managed by `forge cf sync zone`, naming the config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-zone-"));
    roots.push(dir);
    const config = join(dir, "site.ts");
    writeFileSync(config, `export default ${JSON.stringify(base)};\n`, "utf-8");

    const puts: unknown[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") puts.push(JSON.parse(String(init.body)));
      return Response.json({ success: true, errors: [], messages: [], result: { rules: [] } });
    }) as unknown as typeof globalThis.fetch;
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const cmd = createSyncZoneCommand();
      const flags = { config, commit: true, json: true, "zone-id": "zone", "api-token": "token" };
      await cmd.run?.([], flags as Parameters<NonNullable<typeof cmd.run>>[1]);
    } finally {
      globalThis.fetch = original;
      log.mockRestore();
    }

    expect(puts.length).toBe(2);
    for (const body of puts) expect(body).toMatchObject({ description: `Managed by forge cf sync zone from ${config}` });
  });
});
