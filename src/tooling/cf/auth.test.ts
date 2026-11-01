import { describe, expect, it } from "bun:test";

import { CliError } from "../cli/errors";
import { readCfAuth } from "./auth";

const TOKEN_PAGE = "make the token at https://dash.cloudflare.com/profile/api-tokens";

function refusal(flags: Record<string, unknown>): CliError {
  try {
    readCfAuth(flags);
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("readCfAuth did not refuse");
}

describe("readCfAuth", () => {
  it("answers both flags when both are given", () => {
    expect(readCfAuth({ "account-id": "acct", "api-token": "tok" })).toEqual({ accountId: "acct", apiToken: "tok" });
  });

  it("names the account id alone when only it is missing", () => {
    const error = refusal({ "api-token": "tok" });
    expect(error.kind).toBe("invalid-args");
    expect(error.message).toBe(`--account-id is not given. Pass it to a remote command; ${TOKEN_PAGE}`);
  });

  it("names the token alone when only it is missing", () => {
    expect(refusal({ "account-id": "acct" }).message).toBe(`--api-token is not given. Pass it to a remote command; ${TOKEN_PAGE}`);
  });

  it("names both in one message when neither is given", () => {
    expect(refusal({}).message).toBe(`--account-id and --api-token are not given. Pass both to a remote command; ${TOKEN_PAGE}`);
  });

  it("counts an empty string as missing", () => {
    expect(refusal({ "account-id": "", "api-token": "tok" }).message).toStartWith("--account-id is not given.");
    expect(refusal({ "account-id": "", "api-token": "" }).message).toStartWith("--account-id and --api-token are not given.");
  });

  it("reads no environment variable, so an exported credential authenticates nothing", () => {
    const saved = { id: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN };
    process.env.CLOUDFLARE_ACCOUNT_ID = "env-acct";
    process.env.CLOUDFLARE_API_TOKEN = "env-tok";
    try {
      expect(refusal({}).message).toStartWith("--account-id and --api-token are not given.");
    } finally {
      for (const [name, value] of [
        ["CLOUDFLARE_ACCOUNT_ID", saved.id],
        ["CLOUDFLARE_API_TOKEN", saved.token],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
