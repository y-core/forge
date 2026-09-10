/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";

import { mapHandler } from "../testing/route";
import { createApp } from "./app";
import { pageShell, renderShell, shellCtx } from "./shell";
import type { PageShell } from "./types";

const SLOT = { mount: "auth", page: "signin", meta: { title: "Sign in" } };

const HEAD = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';

function context(shell?: PageShell): RequestContext {
  const c = new RequestContext(new Request("http://localhost/auth/signin"));
  if (shell) shellCtx.set(c, shell);
  return c;
}

describe("renderShell without a registered shell", () => {
  it("renders a complete document titled from the slot, not a doctype in front of the content", async () => {
    const res = await renderShell(context(), <p>hello</p>, SLOT);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(`<!DOCTYPE html><html lang="en"><head>${HEAD}<title>Sign in</title></head><body><p>hello</p></body></html>`);
  });

  it("escapes a title the mount did not write itself", async () => {
    const res = await renderShell(context(), <p>hello</p>, { ...SLOT, meta: { title: "Ada & Co <admin>" } });
    expect(await res.text()).toContain("<title>Ada &amp; Co &lt;admin&gt;</title>");
  });

  it("carries the status and headers the mount asked for", async () => {
    const res = await renderShell(context(), <p>no</p>, SLOT, { status: 401, headers: { "x-auth-step": "signin" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("x-auth-step")).toBe("signin");
  });
});

describe("pageShell", () => {
  it("links one stylesheet and loads one script from single values", async () => {
    const shell = pageShell({ stylesheet: "/app.css", script: "/app.js" });
    const res = await renderShell(context(shell), <p>hi</p>, SLOT);
    expect(await res.text()).toBe(
      `<!DOCTYPE html><html lang="en"><head>${HEAD}<title>Sign in</title><link rel="stylesheet" href="/app.css"></head>` +
        '<body><p>hi</p><script type="module" src="/app.js"></script></body></html>',
    );
  });

  it("keeps every stylesheet and script of a list, in the order it was given", async () => {
    const shell = pageShell({ stylesheet: ["/a.css", "/b.css"], script: ["/a.js", "/b.js"], lang: "cy" });
    const body = await (await renderShell(context(shell), <p>hi</p>, SLOT)).text();
    expect(body).toBe(
      `<!DOCTYPE html><html lang="cy"><head>${HEAD}<title>Sign in</title>` +
        '<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css"></head>' +
        '<body><p>hi</p><script type="module" src="/a.js"></script><script type="module" src="/b.js"></script></body></html>',
    );
  });

  it("titles each page from its own slot, so one registration serves every mount", async () => {
    const shell = pageShell();
    const signin = await (await renderShell(context(shell), <p>a</p>, SLOT)).text();
    const logs = await (await renderShell(context(shell), <p>b</p>, { mount: "logs", page: "logs", meta: { title: "Logs" } })).text();
    expect(signin).toContain("<title>Sign in</title>");
    expect(logs).toContain("<title>Logs</title>");
  });
});

describe("renderShell with a registered shell", () => {
  it("hands the shell this request, the content and the slot, and renders what it returns", async () => {
    const seen: { c: unknown; slot: unknown }[] = [];
    const shell: PageShell = (c, content, slot) => {
      seen.push({ c, slot });
      return (
        <html lang='en'>
          <body data-app>{content}</body>
        </html>
      );
    };
    const c = context(shell);
    const res = await renderShell(c, <p>hi</p>, SLOT);

    expect(seen).toEqual([{ c, slot: SLOT }]);
    expect(await res.text()).toBe('<!DOCTYPE html><html lang="en"><body data-app><p>hi</p></body></html>');
  });

  it("awaits a shell that resolves its chrome per request", async () => {
    const shell: PageShell = async (_c, content) => {
      const theme = await Promise.resolve("dark");
      return (
        <html lang='en' class={theme}>
          <body>{content}</body>
        </html>
      );
    };
    const res = await renderShell(context(shell), <p>hi</p>, SLOT);
    expect(await res.text()).toBe('<!DOCTYPE html><html lang="en" class="dark"><body><p>hi</p></body></html>');
  });

  // A half-written document is worse than an error page: the status is 200 and the markup is a
  // truncated `<html>`, so the app error boundary has to be what answers.
  it("lets a throwing shell reach the error boundary rather than emitting a partial document", async () => {
    const app = createApp({
      shell: () => {
        throw new Error("shell boom");
      },
      onError: () => new Response("boundary", { status: 500 }),
    });
    mapHandler(app, "GET", "/page", (c) => renderShell(c, <p>hi</p>, SLOT));

    const res = await app.request("/page");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("boundary");
  });
});

describe("createApp shell registration", () => {
  it("provisions the registered shell on every request, without the route asking for it", async () => {
    const app = createApp({
      shell: (_c, content, slot) => (
        <html lang='en'>
          <body data-page={slot.page}>{content}</body>
        </html>
      ),
    });
    mapHandler(app, "GET", "/page", (c) => renderShell(c, <p>hi</p>, SLOT));

    const body = await (await app.request("/page")).text();
    expect(body).toBe('<!DOCTYPE html><html lang="en"><body data-page="signin"><p>hi</p></body></html>');
  });

  it("renders the bare document when the app registered no shell at all", async () => {
    const app = createApp({});
    mapHandler(app, "GET", "/page", (c) => renderShell(c, <p>hi</p>, SLOT));

    const body = await (await app.request("/page")).text();
    expect(body).toBe(`<!DOCTYPE html><html lang="en"><head>${HEAD}<title>Sign in</title></head><body><p>hi</p></body></html>`);
  });

  it("takes the shell `setShell` registered last, so one app has one shell", async () => {
    const app = createApp({ shell: (_c, content) => <html lang='en'>{content}</html> });
    app.setShell((_c, content) => (
      <html lang='cy'>
        <body data-second>{content}</body>
      </html>
    ));
    mapHandler(app, "GET", "/page", (c) => renderShell(c, <p>hi</p>, SLOT));

    const body = await (await app.request("/page")).text();
    expect(body).toBe('<!DOCTYPE html><html lang="cy"><body data-second><p>hi</p></body></html>');
  });
});
