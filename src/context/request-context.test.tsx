import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { html } from "hono/html";
import { createRequestContext } from "./request-context";

async function render(element: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(html`${element}`));
  const res = await app.request("/");
  return res.text();
}

describe("createRequestContext", () => {
  it("provides the typed value to child components via context", async () => {
    const { Provider, use } = createRequestContext<{ greeting: string }>("Greeting");

    function Consumer() {
      return <span>{use().greeting}</span>;
    }

    const out = await render(
      <Provider value={{ greeting: "hello world" }}>
        <Consumer />
      </Provider>,
    );
    expect(out).toBe("<span>hello world</span>");
  });

  it("throws when use() is called outside the Provider", () => {
    const { use } = createRequestContext<{ greeting: string }>("Greeting");
    expect(use).toThrow("useGreeting() used outside its Provider");
  });
});
