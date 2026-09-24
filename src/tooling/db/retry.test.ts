import { describe, expect, it } from "bun:test";

import { retryWithBackoff, sleepFor } from "./retry";

const BUSY = new Error("busy");
const POLICY = { attempts: 5, firstDelayMs: 100 };

function failing(times: number, error: Error = BUSY) {
  const seen: number[] = [];
  const attempt = (tried: number) => {
    seen.push(tried);
    return seen.length <= times ? Promise.reject(error) : Promise.resolve("answered");
  };
  return { seen, attempt };
}

function recordingSleep() {
  const waits: number[] = [];
  const sleep = (ms: number): Promise<void> => {
    waits.push(ms);
    return Promise.resolve();
  };
  return { waits, sleep };
}

describe("retryWithBackoff()", () => {
  it("answers on the first try without waiting", async () => {
    const { seen, attempt } = failing(0);
    const { waits, sleep } = recordingSleep();
    expect(await retryWithBackoff(attempt, () => true, POLICY, sleep)).toBe("answered");
    expect([seen, waits]).toEqual([[1], []]);
  });

  it("answers after two retryable failures, having waited 100 then 200 ms", async () => {
    const { seen, attempt } = failing(2);
    const { waits, sleep } = recordingSleep();
    expect(await retryWithBackoff(attempt, () => true, POLICY, sleep)).toBe("answered");
    expect([seen, waits]).toEqual([
      [1, 2, 3],
      [100, 200],
    ]);
  });

  it("stops at the ceiling and rethrows the last failure, never sleeping after it", async () => {
    const { seen, attempt } = failing(10);
    const { waits, sleep } = recordingSleep();
    await expect(retryWithBackoff(attempt, () => true, POLICY, sleep)).rejects.toBe(BUSY);
    expect([seen, waits]).toEqual([
      [1, 2, 3, 4, 5],
      [100, 200, 400, 800],
    ]);
  });

  it("rethrows an error the predicate refuses on the try that raised it", async () => {
    const other = new Error("no such table: users");
    const { seen, attempt } = failing(1, other);
    const { waits, sleep } = recordingSleep();
    await expect(retryWithBackoff(attempt, (error) => error === BUSY, POLICY, sleep)).rejects.toBe(other);
    expect([seen, waits]).toEqual([[1], []]);
  });

  it("tries once under a policy of one attempt", async () => {
    const { seen, attempt } = failing(1);
    await expect(retryWithBackoff(attempt, () => true, { attempts: 1, firstDelayMs: 100 }, recordingSleep().sleep)).rejects.toBe(BUSY);
    expect(seen).toEqual([1]);
  });
});

describe("sleepFor()", () => {
  it("resolves to nothing once the wait has passed", async () => {
    expect(await sleepFor(0)).toBeUndefined();
  });
});
