import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

import { createWebhookSigning } from "@y-core/forge/security";
import { openBunD1 } from "@y-core/forge/testing/d1/bun";
import type { TestD1 } from "@y-core/forge/testing/d1/bun";

import { createWorker } from "../src/worker";
import { testEnv } from "./env";

const SECRET = "whsec_D4OBlKb/KikxwRXNc+REMrm/aXhxLvx/WgDtMlLryKE=";
const FULFILMENT_URL = "https://fulfil.example/orders";

let d1: TestD1;
let forwarded: { url: string; body: unknown }[];

beforeEach(async () => {
  d1 = await openBunD1();
  forwarded = [];
  spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = input instanceof Request ? await input.text() : String(init?.body ?? "");
    forwarded.push({ url, body: JSON.parse(body) });
    return new Response(null, { status: 202 });
  }) as typeof fetch);
});

afterEach(async () => {
  mock.restore();
  await d1.dispose();
});

const env = () => ({ ...testEnv(d1), WEBHOOK_SECRETS: SECRET, FULFILMENT_URL });
const app = () => createWorker({ scriptSrc: ["'self'"] });

async function deliver(order: unknown, signWith: string): Promise<Response> {
  const body = JSON.stringify(order);
  const headers = await createWebhookSigning({ secrets: [signWith] }).sign({ id: "msg_accept", body });
  return app().request("/webhooks/orders", { method: "POST", body, headers: { ...headers, "content-type": "application/json" } }, env());
}

describe("the order webhook, from outside", () => {
  it("answers 204 to a signed order and forwards it to fulfilment", async () => {
    const res = await deliver({ orderId: "o-42", totalCents: 999 }, SECRET);

    expect(res.status).toBe(204);
    expect(forwarded.map((call) => call.url)).toEqual([FULFILMENT_URL]);
    expect((forwarded[0]?.body as { orderId?: unknown } | undefined)?.orderId).toBe("o-42");
  });

  it("answers 401 to an order signed with another secret, forwarding nothing", async () => {
    const res = await deliver({ orderId: "o-42", totalCents: 999 }, "whsec_rFjh21qHhEA/BZihe0taYGjqDSlQfr7fqZIjAn3Qptw=");

    expect(res.status).toBe(401);
    expect(forwarded).toEqual([]);
  });
});

describe("the status API, from outside", () => {
  it("answers the partner origin's cross-origin read", async () => {
    const res = await app().request("/api/status", { headers: { Origin: "https://partner.example" } }, env());

    expect([res.status, res.headers.get("access-control-allow-origin"), await res.json()]).toEqual([
      200,
      "https://partner.example",
      { status: "ok" },
    ]);
  });
});
