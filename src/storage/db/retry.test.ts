import { describe, expect, it } from "bun:test";

import { D1_RETRY_POLICY, retryWithBackoff, sleepFor } from "./retry";

const BUSY = new Error("busy");
const POLICY = { attempts: 5, baseDelayMs: 100, maxDelayMs: 300 };

function failing(times: number, error: Error = BUSY) {
  const seen: number[] = [];
  const attempt = (tried: number) => {
    seen.push(tried);
    return seen.length <= times ? Promise.reject(error) : Promise.resolve("answered");
  };
  return { seen, attempt };
}

function recordingClock(random = () => 1) {
  const waits: number[] = [];
  const sleep = (ms: number): Promise<void> => {
    waits.push(ms);
    return Promise.resolve();
  };
  return { waits, clock: { sleep, random } };
}

describe("retryWithBackoff()", () => {
  it("answers on the first try without waiting", async () => {
    const { seen, attempt } = failing(0);
    const { waits, clock } = recordingClock();
    expect(await retryWithBackoff(attempt, () => true, POLICY, clock)).toBe("answered");
    expect([seen, waits]).toEqual([[1], []]);
  });

  it("doubles the ceiling of each wait up to the cap, and stops at the last attempt without sleeping after it", async () => {
    const { seen, attempt } = failing(10);
    const { waits, clock } = recordingClock(() => 0.999_999);
    await expect(retryWithBackoff(attempt, () => true, POLICY, clock)).rejects.toBe(BUSY);
    expect([seen, waits]).toEqual([
      [1, 2, 3, 4, 5],
      [99, 199, 299, 299],
    ]);
  });

  it("waits a random share of the ceiling — full jitter", async () => {
    const { attempt } = failing(2);
    const { waits, clock } = recordingClock(() => 0.5);
    await retryWithBackoff(attempt, () => true, POLICY, clock);
    expect(waits).toEqual([50, 100]);
  });

  it("rethrows an error the predicate refuses on the try that raised it", async () => {
    const other = new Error("no such table: users");
    const { seen, attempt } = failing(1, other);
    const { waits, clock } = recordingClock();
    await expect(retryWithBackoff(attempt, (error) => error === BUSY, POLICY, clock)).rejects.toBe(other);
    expect([seen, waits]).toEqual([[1], []]);
  });

  it("tries once under a policy of one attempt", async () => {
    const { seen, attempt } = failing(1);
    await expect(retryWithBackoff(attempt, () => true, { ...POLICY, attempts: 1 }, recordingClock().clock)).rejects.toBe(BUSY);
    expect(seen).toEqual([1]);
  });

  it("defaults to the policy STORAGE_BINDINGS.md §1g documents", () => {
    expect(D1_RETRY_POLICY).toEqual({ attempts: 5, baseDelayMs: 100, maxDelayMs: 2_000 });
  });
});

describe("sleepFor()", () => {
  it("resolves to nothing once the wait has passed", async () => {
    expect(await sleepFor(0)).toBeUndefined();
  });
});
