import { describe, expect, it } from "bun:test";

import { admitsTestingSecret, isTurnstileTestingSecret } from "./turnstile.dev";

const PUBLISHED_TESTING_SECRETS = [
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
];

describe("isTurnstileTestingSecret", () => {
  it("admits each of Cloudflare's published testing secrets", () => {
    for (const secret of PUBLISHED_TESTING_SECRETS) {
      expect(isTurnstileTestingSecret(secret)).toBe(true);
    }
  });

  it("refuses a real secret and a lookalike", () => {
    expect(isTurnstileTestingSecret("0x4AAAAAAA-real-secret")).toBe(false);
    expect(isTurnstileTestingSecret("1x0000000000000000000000000000000AB")).toBe(false);
  });
});

describe("admitsTestingSecret", () => {
  it("refuses every published testing secret in a run that does not arm the development build", () => {
    expect(PUBLISHED_TESTING_SECRETS.map(admitsTestingSecret)).toEqual([false, false, false]);
  });
});
