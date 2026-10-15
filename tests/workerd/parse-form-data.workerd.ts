// Bun's `Request` parses bodies workerd may not, so a suite driven through `app.request` cannot see a
// divergence between the two; these run the same chain inside workerd, where a deployed app reads forms.
import { expect, harnessTest } from "./harness.fixture";

const test = harnessTest({ config: new URL("../fixtures/workers-form/wrangler.jsonc", import.meta.url).pathname });
const VALID = { name: "Jane", email: "jane@example.com", message: "Hello." };

/** A CSRF token minted for `path`, which the guard binds to that path alone. */
function token(origin: string, path: string): Promise<string> {
  return fetch(`${origin}${path}`).then((res) => res.text());
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

for (const [encoding, build] of ENCODINGS) {
  test.describe(`a form POST under workerd, ${encoding}`, () => {
    const post = async (origin: string, fields: Record<string, string>): Promise<Response> =>
      fetch(`${origin}/api/contact`, build(fields, await token(origin, "/api/contact")));

    test("accepts a valid submission and renders the success fragment", async ({ served }) => {
      const res = await post(served.origin, VALID);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<p>Thanks, Jane.</p>");
    });

    // The assertion the reported defect turns on: an always-`name` refusal names the first field the
    // schema declares, not the one the submission got wrong, and is what an empty parsed body looks like.
    test("names the field that failed, not the first the schema declares", async ({ served }) => {
      const res = await post(served.origin, { ...VALID, email: "not-an-email" });
      expect(res.status).toBe(422);
      expect(refusedFields(await res.text())).toEqual(["email"]);
    });

    test("names the first declared field when the body carries none of them", async ({ served }) => {
      const res = await post(served.origin, { unrelated: "x" });
      expect(res.status).toBe(422);
      expect(refusedFields(await res.text())).toEqual(["name"]);
    });

    test("refuses a body over the cap with 413, so the streaming meter still runs", async ({ served }) => {
      const res = await post(served.origin, { ...VALID, message: "x".repeat(8192) });
      expect(res.status).toBe(413);
    });
  });
}

test("reads the CSRF token from the body field, where the guard parses the body before the pipeline does", async ({ served }) => {
  const res = await fetch(`${served.origin}/api/contact`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...VALID, _csrf: await token(served.origin, "/api/contact") }).toString(),
  });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("<p>Thanks, Jane.</p>");
});

// A tripped bot guard answers as a validation refusal naming the first declared field, so from the
// outside it is indistinguishable from a lost body; the log line `pipeline.test.ts` asserts tells them apart.
test.describe("a tripped bot guard under workerd", () => {
  test("refuses every submission alike, naming the first declared field", async ({ served }) => {
    for (const fields of [VALID, { ...VALID, email: "not-an-email" }, { unrelated: "x" }]) {
      const res = await fetch(`${served.origin}/api/guarded`, urlencoded(fields, await token(served.origin, "/api/guarded")));
      expect(res.status).toBe(422);
      expect(refusedFields(await res.text())).toEqual(["name"]);
    }
  });
});
