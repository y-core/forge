/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { describe, expect, it } from "bun:test";

import type { AppContext, Refusal, RefuseHook } from "../context/types";
import { renderError, renderValidationErrors } from "../render/htmx/fragment";
import { defaultRefusalResponse } from "../security/refusal";
import { createTestContext } from "../testing/context";
import { attrOf } from "../testing/markup";
import { ANNOUNCE_FAILURE_ATTR } from "../ui/contracts/announcer-contract";
import { refuseAsFragment, refuseAsProblem } from "./refusal";
import type { RefusalPanel } from "./types";

const CSRF_REFUSAL: Refusal = { guard: "csrf", status: 403, reason: "missing-token" };

function contextFor(headers: Record<string, string> = {}): AppContext {
  return createTestContext(new Request("http://localhost/contact", { method: "POST", headers }));
}

const HTMX = { "HX-Request": "true" };
const MARKED = { "forge-failure-fragment": "1" };

async function answered(hook: RefuseHook, c: AppContext, refusal: Refusal): Promise<Response> {
  const response = await hook(c, refusal);
  if (response === undefined) throw new Error("the media helper declined a refusal it always answers");
  return response;
}

const expiredPanel = (): RefusalPanel => ({ message: "Your form expired.", panel: <p>Reload the page and send it again.</p> });

async function answer(response: Response) {
  return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
}

describe("refuseAsFragment", () => {
  it("answers an htmx refusal with the panel wrapped for the announcer, retargeted and swapped innerHTML by default", async () => {
    const hook = refuseAsFragment({ target: "#form-errors", render: expiredPanel });

    expect(await answer(await answered(hook, contextFor(HTMX), CSRF_REFUSAL))).toEqual({
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8", "hx-retarget": "#form-errors", "hx-reswap": "innerHTML", ...MARKED },
      body: `<div ${ANNOUNCE_FAILURE_ATTR}="Your form expired."><p>Reload the page and send it again.</p></div>`,
    });
  });

  it("sends the swap it was given as HX-Reswap", async () => {
    const hook = refuseAsFragment({ target: "#notice", swap: "outerHTML", render: expiredPanel });

    const response = await answered(hook, contextFor(HTMX), CSRF_REFUSAL);

    expect({ retarget: response.headers.get("HX-Retarget"), reswap: response.headers.get("HX-Reswap") }).toEqual({
      retarget: "#notice",
      reswap: "outerHTML",
    });
  });

  it("answers a request without HX-Request: true with the same body and no htmx headers", async () => {
    const hook = refuseAsFragment({ target: "#form-errors", render: expiredPanel });

    const cases = [{}, { "HX-Request": "false" }];
    const answers = await Promise.all(cases.map(async (headers) => answer(await answered(hook, contextFor(headers), CSRF_REFUSAL))));

    expect(answers).toEqual(
      cases.map(() => ({
        status: 403,
        headers: { "content-type": "text/html; charset=utf-8", ...MARKED },
        body: `<div ${ANNOUNCE_FAILURE_ATTR}="Your form expired."><p>Reload the page and send it again.</p></div>`,
      })),
    );
  });

  it("attribute-escapes the message so it cannot break out of the announcer attribute", async () => {
    const hook = refuseAsFragment({
      target: "#form-errors",
      // closes the attribute and opens a script element if left unescaped
      render: () => ({ message: `Tom & Jerry's "form"><script>alert(1)</script>`, panel: <p>Try again.</p> }),
    });

    expect(await (await answered(hook, contextFor(HTMX), CSRF_REFUSAL)).text()).toBe(
      `<div ${ANNOUNCE_FAILURE_ATTR}="Tom &amp; Jerry&#39;s &quot;form&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"><p>Try again.</p></div>`,
    );
  });

  it("marks its panel exactly as render/htmx marks a banner, so a swapped refusal and a swapped failure announce alike", async () => {
    const messages = ["Your form expired.", `Tom & Jerry's "form"><script>alert(1)</script>`, "Café — 日本語 🙂", ""];

    const markers = await Promise.all(
      messages.map(async (message) => {
        const hook = refuseAsFragment({ target: "#form-errors", render: () => ({ message, panel: <p>Try again.</p> }) });
        const refused = await (await answered(hook, contextFor(HTMX), CSRF_REFUSAL)).text();
        return { refusal: attrOf(refused, ANNOUNCE_FAILURE_ATTR), banner: attrOf(String(renderError(message)), ANNOUNCE_FAILURE_ATTR) };
      }),
    );

    expect(markers.filter(({ refusal, banner }) => refusal !== banner)).toEqual([]);
    expect(markers.map(({ refusal }) => refusal)).toEqual([
      "Your form expired.",
      "Tom &amp; Jerry&#39;s &quot;form&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
      "Café — 日本語 🙂",
      "",
    ]);
  });

  it("marks its panel under the same attribute name as render/htmx's validation banner", async () => {
    const hook = refuseAsFragment({
      target: "#form-errors",
      render: () => ({ message: "Please correct the following fields.", panel: <p>Try again.</p> }),
    });
    const refused = await (await answered(hook, contextFor(HTMX), CSRF_REFUSAL)).text();

    expect(attrOf(refused, "data-announce-failure")).toBe(attrOf(String(renderValidationErrors(["name"])), "data-announce-failure"));
  });

  it("awaits an async render and hands it the context and the refusal it answers", async () => {
    const seen: Array<{ path: string; refusal: Refusal }> = [];
    const hook = refuseAsFragment({
      target: "#form-errors",
      render: async (c, refusal) => {
        seen.push({ path: new URL(c.request.url).pathname, refusal });
        await Promise.resolve();
        return { message: "Too many attempts.", panel: <p>Wait a minute, then try again.</p> };
      },
    });
    const refusal: Refusal = { guard: "rate-limit", status: 429 };

    const response = await answer(await answered(hook, contextFor(HTMX), refusal));

    expect({ response, seen }).toEqual({
      response: {
        status: 429,
        headers: { "content-type": "text/html; charset=utf-8", "hx-retarget": "#form-errors", "hx-reswap": "innerHTML", ...MARKED },
        body: `<div ${ANNOUNCE_FAILURE_ATTR}="Too many attempts."><p>Wait a minute, then try again.</p></div>`,
      },
      seen: [{ path: "/contact", refusal }],
    });
  });

  it("keeps each refusal's status", async () => {
    const hook = refuseAsFragment({ target: "#form-errors", render: expiredPanel });
    const refusals: Refusal[] = [
      { guard: "csrf", status: 400, reason: "unreadable-body" },
      { guard: "origin", status: 403, reason: "cross-site" },
      { guard: "csrf", status: 413, reason: "too-large" },
      { guard: "rate-limit", status: 429 },
      { guard: "rate-limit", status: 503, reason: "binding-absent" },
    ];

    const statuses = await Promise.all(refusals.map(async (refusal) => (await answered(hook, contextFor(HTMX), refusal)).status));

    expect(statuses).toEqual([400, 403, 413, 429, 503]);
  });

  it("marks every refusal it answers as a failure fragment, under htmx or not, so a 503 panel swaps like a 4xx one", async () => {
    const hook = refuseAsFragment({ target: "#form-errors", render: expiredPanel });
    const refusals: Refusal[] = [
      { guard: "csrf", status: 400, reason: "unreadable-body" },
      { guard: "rate-limit", status: 503, reason: "binding-failed" },
    ];

    const markers = await Promise.all(
      [HTMX, {}].flatMap((headers) =>
        refusals.map(async (refusal) => (await answered(hook, contextFor(headers), refusal)).headers.get("Forge-Failure-Fragment")),
      ),
    );

    expect(markers).toEqual(["1", "1", "1", "1"]);
  });
});

describe("the failure-fragment marker", () => {
  it("is absent from the guards' default plain-text answers, 503 included", () => {
    const defaults: Refusal[] = [
      { guard: "csrf", status: 403, reason: "missing-token" },
      { guard: "rate-limit", status: 503, reason: "binding-absent" },
    ];

    expect(defaults.map((refusal) => defaultRefusalResponse(refusal).headers.has("Forge-Failure-Fragment"))).toEqual([false, false]);
  });

  it("is absent from refuseAsProblem's 503", async () => {
    const response = await answered(refuseAsProblem(), contextFor(HTMX), { guard: "rate-limit", status: 503, reason: "key-failed" });

    expect(response.headers.has("Forge-Failure-Fragment")).toBe(false);
  });
});

describe("refuseAsProblem", () => {
  const cases: Array<{ refusal: Refusal; expected: { status: number; title: string } }> = [
    { refusal: { guard: "csrf", status: 400, reason: "unreadable-body" }, expected: { status: 400, title: "Bad Request" } },
    { refusal: { guard: "csrf", status: 403, reason: "missing-token" }, expected: { status: 403, title: "Forbidden" } },
    { refusal: { guard: "origin", status: 403, reason: "disallowed" }, expected: { status: 403, title: "Forbidden" } },
    { refusal: { guard: "admin", status: 403 }, expected: { status: 403, title: "Forbidden" } },
    { refusal: { guard: "csrf", status: 413, reason: "too-large" }, expected: { status: 413, title: "Content Too Large" } },
    { refusal: { guard: "rate-limit", status: 429 }, expected: { status: 429, title: "Too Many Requests" } },
    { refusal: { guard: "rate-limit", status: 503, reason: "key-failed" }, expected: { status: 503, title: "Service Unavailable" } },
  ];

  for (const { refusal, expected } of cases) {
    it(`answers a ${refusal.guard} ${refusal.status} as about:blank problem+json titled "${expected.title}", with no reason`, async () => {
      const response = await answered(refuseAsProblem(), contextFor(), refusal);

      expect({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.json() }).toEqual({
        status: expected.status,
        headers: { "content-type": "application/problem+json; charset=utf-8" },
        body: { type: "about:blank", title: expected.title, status: expected.status },
      });
    });
  }
});
