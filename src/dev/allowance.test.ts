import { describe, expect, it } from "bun:test";

import { devAllowance } from "./allowance";
import type { DevAllowanceOptions } from "./types";

describe("devAllowance", () => {
  it("carries the options it was minted with, which is all a relaxation reads", () => {
    expect(devAllowance({ rateLimitOptional: true }).options).toEqual({ rateLimitOptional: true });
  });

  it("mints an empty allowance, which grants nothing", () => {
    expect(devAllowance({}).options).toEqual({});
  });

  it("carries every relaxation at once, so one entry mints one token", () => {
    const options: DevAllowanceOptions = {
      rateLimitOptional: true,
      missingFetchMetadata: true,
      errorDetail: true,
      turnstileTestingSecrets: true,
      extraOrigins: ["https://localhost:8787"],
    };

    expect(devAllowance({ ...options }).options).toEqual({ ...options });
  });

  it("copies the options, so a later edit of the caller's object grants nothing more", () => {
    const options: { errorDetail?: true } = {};
    const allowance = devAllowance(options);
    options.errorDetail = true;

    expect(allowance.options.errorDetail).toBeUndefined();
  });
});
