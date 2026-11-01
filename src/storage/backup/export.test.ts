import { describe, expect, it } from "bun:test";

import { exportReply } from "./backup.fixture";
import { D1BackupError } from "./errors";
import { requestD1Export } from "./export";
import type { D1BackupOptions } from "./types";

const TOKEN = "tkn-Zq9xW2vLp7";
const SIGNED = "https://d1-exports.example.com/dump.sql?X-Amz-Signature=deadbeef";

function options(reply: () => Response | Promise<Response>, calls: { url: string; init?: RequestInit }[] = []): D1BackupOptions {
  return {
    accountId: "acct",
    databaseId: "db/1",
    apiToken: TOKEN,
    bucket: {} as D1BackupOptions["bucket"],
    at: new Date("2026-11-01T02:00:00Z"),
    fetch: async (url, init) => {
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

describe("requestD1Export()", () => {
  it("starts a polled export with the bearer token at the encoded database path", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    await requestD1Export(
      options(() => exportReply({ status: "active", at_bookmark: "B" }), calls),
      null,
    );

    expect(calls[0]?.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/d1/database/db%2F1/export");
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ output_format: "polling" });
  });

  it("polls a running export by its bookmark", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    await requestD1Export(
      options(() => exportReply({ status: "active", at_bookmark: "B" }), calls),
      "B",
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ output_format: "polling", current_bookmark: "B" });
  });

  it("reads the three states D1 answers", async () => {
    expect(
      await requestD1Export(
        options(() => exportReply({ status: "active", at_bookmark: "B" })),
        null,
      ),
    ).toEqual({ status: "active", bookmark: "B" });
    expect(
      await requestD1Export(
        options(() => exportReply({ status: "complete", at_bookmark: "B", result: { filename: "d.sql", signed_url: SIGNED } })),
        "B",
      ),
    ).toEqual({ status: "complete", bookmark: "B", signedUrl: SIGNED });
    expect(
      await requestD1Export(
        options(() => exportReply({ status: "error", error: "too big" })),
        "B",
      ),
    ).toEqual({ status: "error", error: "too big" });
  });

  it("classes 401 and 403 as auth, 404 as not-found, and any other refusal as refused", async () => {
    for (const [status, kind] of [
      [401, "auth"],
      [403, "auth"],
      [404, "not-found"],
      [500, "refused"],
    ] as const) {
      const error = await failure(
        requestD1Export(
          options(() => new Response("{}", { status })),
          null,
        ),
      );
      expect([error.kind, error.status]).toEqual([kind, status]);
    }
  });

  it("refuses a reply that is not the documented shape, and a network failure", async () => {
    const kindOf = async (reply: () => Response | Promise<Response>) => (await failure(requestD1Export(options(reply), null))).kind;
    expect(await kindOf(() => exportReply({ status: "pending" }))).toBe("malformed");
    expect(await kindOf(() => new Response("<html>"))).toBe("malformed");
    expect(await kindOf(() => Promise.reject(new Error("reset")))).toBe("refused");
  });

  it("never quotes the token or a signed URL in a refusal", async () => {
    const replies = [
      () => new Response(JSON.stringify({ message: TOKEN }), { status: 403 }),
      () => exportReply({ status: "complete", result: { signed_url: SIGNED } }),
      () => Promise.reject(new Error(`reset ${TOKEN}`)),
    ];
    for (const reply of replies) {
      const error = await failure(requestD1Export(options(reply), null));
      expect(error.message).not.toContain(TOKEN);
      expect(error.message).not.toContain("X-Amz-Signature");
    }
  });
});
