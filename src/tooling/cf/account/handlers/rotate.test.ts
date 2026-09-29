import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GENERATE_MARKER, parseDevVars, RING_MARKER } from "./devvars";
import { describeRefusal, planRotation, randomSecret, rotateSecrets } from "./rotate";

const SAMPLE = `${GENERATE_MARKER}
SESSION_SECRET=old-session

STRIPE_KEY=sk_live_x
`;

function makeFile(content = SAMPLE): string {
  const path = join(mkdtempSync(join(tmpdir(), "forge-rotate-")), ".dev.vars");
  writeFileSync(path, content, "utf-8");
  return path;
}

describe("randomSecret()", () => {
  it("is 32 bytes of hex, the shape `openssl rand -hex 32` produces", () => {
    expect(randomSecret()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 50 }, () => randomSecret()));
    expect(seen.size).toBe(50);
  });
});

describe("planRotation()", () => {
  const vars = parseDevVars(SAMPLE);

  it("accepts a marked key", () => {
    expect(planRotation(vars, ["SESSION_SECRET"])).toEqual({ ok: true, data: ["SESSION_SECRET"] });
  });

  it("refuses an unmarked key — a third-party credential cannot be re-obtained", () => {
    expect(planRotation(vars, ["STRIPE_KEY"])).toEqual({ ok: false, error: { unknown: [], unmarked: ["STRIPE_KEY"] } });
  });

  it("accepts a ring-marked key", () => {
    expect(planRotation(parseDevVars(`${RING_MARKER}\nAPP_SEAL_KEY_RING=aa11\n`), ["APP_SEAL_KEY_RING"])).toEqual({
      ok: true,
      data: ["APP_SEAL_KEY_RING"],
    });
  });

  it("refuses a name that is not in the file at all", () => {
    expect(planRotation(vars, ["TYPO"])).toEqual({ ok: false, error: { unknown: ["TYPO"], unmarked: [] } });
  });

  it("refuses the whole batch when one name is unrotatable", () => {
    const plan = planRotation(vars, ["SESSION_SECRET", "STRIPE_KEY"]);
    expect(plan.ok).toBe(false);
  });

  it("keeps the two refusals apart, since they need different fixes", () => {
    const plan = planRotation(vars, ["TYPO", "STRIPE_KEY"]);
    expect(plan).toEqual({ ok: false, error: { unknown: ["TYPO"], unmarked: ["STRIPE_KEY"] } });
  });
});

describe("describeRefusal()", () => {
  it("names the missing key and the file", () => {
    const message = describeRefusal({ unknown: ["TYPO"], unmarked: [] }, "/p/.dev.vars");
    expect(message).toBe("Not defined in /p/.dev.vars: TYPO");
  });

  it("tells the reader what marking a key means before they add one", () => {
    const message = describeRefusal({ unknown: [], unmarked: ["STRIPE_KEY"] }, "/p/.dev.vars");
    expect(message).toContain("Not marked rotatable in /p/.dev.vars: STRIPE_KEY");
    expect(message).toContain(GENERATE_MARKER);
    expect(message).toContain("never for a third-party credential");
  });
});

describe("rotateSecrets()", () => {
  it("replaces the marked value with a fresh one", () => {
    const path = makeFile();
    rotateSecrets(path, ["SESSION_SECRET"]);
    const value = parseDevVars(readFileSync(path, "utf-8")).find((v) => v.name === "SESSION_SECRET")?.value;
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(value).not.toBe("old-session");
  });

  it("leaves every other key, comment and marker untouched", () => {
    const path = makeFile();
    rotateSecrets(path, ["SESSION_SECRET"]);
    const after = readFileSync(path, "utf-8");
    expect(after).toContain("STRIPE_KEY=sk_live_x");
    expect(after).toContain(GENERATE_MARKER);
    expect(parseDevVars(after).map((v) => v.name)).toEqual(["SESSION_SECRET", "STRIPE_KEY"]);
  });

  it("gives each name its own value", () => {
    const path = makeFile(`${GENERATE_MARKER}\nA=1\n${GENERATE_MARKER}\nB=2\n`);
    rotateSecrets(path, ["A", "B"]);
    const [a, b] = parseDevVars(readFileSync(path, "utf-8"));
    expect(a?.value).not.toBe(b?.value);
  });

  it("returns the names it rotated, never the values", () => {
    const path = makeFile();
    expect(rotateSecrets(path, ["SESSION_SECRET"])).toEqual(["SESSION_SECRET"]);
  });
});

describe("rotateSecrets() — a key ring", () => {
  const ringOf = (path: string) => parseDevVars(readFileSync(path, "utf-8")).find((v) => v.name === "APP_SEAL_KEY_RING")?.value ?? "";

  it("prepends a fresh key and keeps every old one, in order", () => {
    const path = makeFile(`${RING_MARKER}\nAPP_SEAL_KEY_RING=bb22,cc33\n`);
    rotateSecrets(path, ["APP_SEAL_KEY_RING"]);
    const [fresh, ...old] = ringOf(path).split(",");
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(old).toEqual(["bb22", "cc33"]);
  });

  it("seeds a ring that has no value yet with one fresh key", () => {
    const path = makeFile(`${RING_MARKER}\nAPP_SEAL_KEY_RING=\n`);
    rotateSecrets(path, ["APP_SEAL_KEY_RING"]);
    expect(ringOf(path)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("still replaces a generate-marked key rotated alongside it", () => {
    const path = makeFile(`${RING_MARKER}\nAPP_SEAL_KEY_RING=bb22\n${GENERATE_MARKER}\nSESSION_SECRET=old-session\n`);
    rotateSecrets(path, ["APP_SEAL_KEY_RING", "SESSION_SECRET"]);
    const session = parseDevVars(readFileSync(path, "utf-8")).find((v) => v.name === "SESSION_SECRET")?.value;
    expect(session).toMatch(/^[0-9a-f]{64}$/);
    expect(ringOf(path).split(",")[1]).toBe("bb22");
  });
});
