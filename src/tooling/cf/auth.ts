import { CliError } from "../cli/errors";
import type { CfAuth } from "./types";

const TOKEN_PAGE = "https://dash.cloudflare.com/profile/api-tokens";

/** The flags a remote command takes its Cloudflare credentials from, spelled once. @internal */
export const cfAuthFlags = {
  "account-id": { type: "string" as const, description: "Cloudflare account ID. Required for a command that reaches Cloudflare" },
  "api-token": {
    type: "string" as const,
    description:
      'Cloudflare API token. Required for a command that reaches Cloudflare; pass it as `--api-token "$VAR"` to keep it out of shell history',
  },
};

/** The Cloudflare credentials a remote command runs with, read from `--account-id` and `--api-token` alone. @internal */
export function readCfAuth(flags: { readonly "account-id"?: unknown; readonly "api-token"?: unknown }): CfAuth {
  const accountId = typeof flags["account-id"] === "string" ? flags["account-id"] : "";
  const apiToken = typeof flags["api-token"] === "string" ? flags["api-token"] : "";
  const missing = [accountId === "" ? "--account-id" : null, apiToken === "" ? "--api-token" : null].filter(
    (name): name is string => name !== null,
  );
  if (missing.length === 2) {
    throw new CliError(
      "invalid-args",
      `--account-id and --api-token are not given. Pass both to a remote command; make the token at ${TOKEN_PAGE}`,
    );
  }
  if (missing.length === 1) {
    throw new CliError("invalid-args", `${missing[0]} is not given. Pass it to a remote command; make the token at ${TOKEN_PAGE}`);
  }
  return { accountId, apiToken };
}
