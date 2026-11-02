import { describe, expect, it } from "bun:test";

import { D1BackupError } from "./errors";
import { callD1Api, databasePath } from "./rest";

const TOKEN = "tkn-Zq9xW2vLp7";

function access(reply: () => Response | Promise<Response>, calls: { url: string; init?: RequestInit }[] = []) {
  return {
    accountId: "acct/1",
    apiToken: TOKEN,
    fetch: async (url: string, init?: RequestInit) => {
      calls.push(init === undefined ? { url } : { url, init });
      return reply();
    },
  };
}

async function failure(run: Promise<unknown>): Promise<D1BackupError> {
  const error = await run.catch((thrown: unknown) => thrown);
  if (!(error instanceof D1BackupError)) throw new Error(`expected a D1BackupError, got ${String(error)}`);
  return error;
}

describe("callD1Api()", () => {
  it("posts a body with the bearer token under the encoded account, and answers the envelope's result", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const result = await callD1Api(
      access(() => Response.json({ success: true, result: { ok: 1 } }), calls),
      "query",
      databasePath("db/1", "query"),
      { sql: "SELECT 1" },
    );

    expect(result).toEqual({ ok: 1 });
    expect(calls[0]?.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct%2F1/d1/database/db%2F1/query");
    expect([calls[0]?.init?.method, new Headers(calls[0]?.init?.headers).get("Authorization")]).toEqual(["POST", `Bearer ${TOKEN}`]);
  });

  it("sends a GET with no body when there is none", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    await callD1Api(
      access(() => Response.json({ success: true, result: [] }), calls),
      "database list",
      "?name=x",
    );
    expect([calls[0]?.init?.method, calls[0]?.init?.body]).toEqual(["GET", undefined]);
  });

  it("classes 401 and 403 as auth, 404 as not-found, others as refused, and a failed envelope or HTML as malformed", async () => {
    for (const [reply, kind] of [
      [() => new Response("{}", { status: 403 }), "auth"],
      [() => new Response("{}", { status: 404 }), "not-found"],
      [() => new Response("{}", { status: 502 }), "refused"],
      [() => Response.json({ success: false, errors: [{ message: TOKEN }] }), "malformed"],
      [() => new Response("<html>"), "malformed"],
      [() => Promise.reject(new Error(`reset ${TOKEN}`)), "refused"],
    ] as const) {
      const error = await failure(callD1Api(access(reply), "import", ""));
      expect([error.kind, error.message.includes(TOKEN)]).toEqual([kind, false]);
    }
  });
});
