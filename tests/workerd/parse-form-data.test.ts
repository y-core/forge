// Bun's `Request` parses bodies workerd may not, so a suite driven through `app.request` cannot see a
// divergence between the two at all. These cases run the same chain inside workerd, which is where a
// deployed app reads its forms.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { type DevServer, startDevServer } from "./dev-server";

const CONFIG = new URL("../fixtures/workers-form/wrangler.jsonc", import.meta.url).pathname;
const VALID = { name: "Jane", email: "jane@example.com", message: "Hello." };

let server: DevServer;

beforeAll(async () => {
  server = await startDevServer(CONFIG);
}, 200_000);

afterAll(() => {
  server?.stop();
});

/** A CSRF token minted for `path`, which the guard binds to that path alone. */
function token(path: string): Promise<string> {
  return fetch(`${server.origin}${path}`).then((res) => res.text());
}

/** The field names the 422 fragment lists, which `abortEarly` holds to one. */
function refusedFields(body: string): string[] {
  return [...body.matchAll(/<li>([^<]*)<\/li>/g)].map(([, field]) => field ?? "");
}

function urlencoded(fields: Record<string, string>, csrf: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "X-CSRF-Token": csrf },
    body: new URLSearchParams(fields).toString(),
  };
}

function multipart(fields: Record<string, string>, csrf: string): RequestInit {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return { method: "POST", headers: { "X-CSRF-Token": csrf }, body: form };
}

const ENCODINGS = [
  ["application/x-www-form-urlencoded", urlencoded],
  ["multipart/form-data", multipart],
] as const;

describe.each(ENCODINGS)("a form POST under workerd, %s", (_encoding, build) => {
  const post = async (fields: Record<string, string>): Promise<Response> =>
    fetch(`${server.origin}/api/contact`, build(fields, await token("/api/contact")));

  it("accepts a valid submission and renders the success fragment", async () => {
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<p>Thanks, Jane.</p>");
  });

  // The assertion the reported defect turns on: an always-`name` refusal names the first field the
  // schema declares, not the one the submission got wrong, and is what an empty parsed body looks like.
  it("names the field that failed, not the first the schema declares", async () => {
    const res = await post({ ...VALID, email: "not-an-email" });
    expect(res.status).toBe(422);
    expect(refusedFields(await res.text())).toEqual(["email"]);
  });

  it("names the first declared field when the body carries none of them", async () => {
    const res = await post({ unrelated: "x" });
    expect(res.status).toBe(422);
    expect(refusedFields(await res.text())).toEqual(["name"]);
  });

  it("refuses a body over the cap with 413, so the streaming meter still runs", async () => {
    const res = await post({ ...VALID, message: "x".repeat(8192) });
    expect(res.status).toBe(413);
  });
});

it("reads the CSRF token from the body field, where the guard parses the body before the pipeline does", async () => {
  const res = await fetch(`${server.origin}/api/contact`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...VALID, _csrf: await token("/api/contact") }).toString(),
  });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("<p>Thanks, Jane.</p>");
});

// This is the shape the `wrangler dev` report was actually seeing. A tripped bot guard answers in a
// validation refusal's clothes, naming the first declared field whatever the body said, so a guard
// that cannot pass in development is indistinguishable from a body that never arrived — from the
// outside. The log line asserted in `pipeline.test.ts` is what tells the two apart.
describe("a tripped bot guard under workerd", () => {
  const post = async (fields: Record<string, string>): Promise<Response> =>
    fetch(`${server.origin}/api/guarded`, urlencoded(fields, await token("/api/guarded")));

  it("refuses every submission alike, naming the first declared field", async () => {
    for (const fields of [VALID, { ...VALID, email: "not-an-email" }, { unrelated: "x" }]) {
      const res = await post(fields);
      expect(res.status).toBe(422);
      expect(refusedFields(await res.text())).toEqual(["name"]);
    }
  });
});
