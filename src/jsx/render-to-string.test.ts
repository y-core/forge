import { describe, expect, it } from "bun:test";
import { cloneElement, createElement as el, Fragment, isValidElement } from "./element";
import { renderPage, renderToString } from "./render-to-string";
import type { ComponentFn } from "./types";

// Helpers to construct trees without JSX syntax so the tsconfig jsxImportSource
// does not interfere with these runtime-level tests.

describe("renderToString — primitives", () => {
  it("renders a string as escaped text", async () => {
    expect(String(await renderToString("hello"))).toBe("hello");
  });

  it("escapes HTML entities in text", async () => {
    expect(String(await renderToString("<b>A&B</b>"))).toBe("&lt;b&gt;A&amp;B&lt;/b&gt;");
  });

  it("escapes apostrophe in text", async () => {
    expect(String(await renderToString("it's"))).toBe("it&#39;s");
  });

  it("renders a number as a string", async () => {
    expect(String(await renderToString(42))).toBe("42");
  });

  it("renders null as empty string", async () => {
    expect(String(await renderToString(null))).toBe("");
  });

  it("renders undefined as empty string", async () => {
    expect(String(await renderToString(undefined))).toBe("");
  });

  it("renders false as empty string", async () => {
    expect(String(await renderToString(false))).toBe("");
  });

  it("renders true as empty string", async () => {
    expect(String(await renderToString(true))).toBe("");
  });

  it("renders an array of nodes", async () => {
    expect(String(await renderToString(["hello ", "world"]))).toBe("hello world");
  });

  it("renders a mixed array", async () => {
    expect(String(await renderToString(["count: ", 3, null, false, "!"]))).toBe("count: 3!");
  });
});

describe("renderToString — HTML elements", () => {
  it("renders a basic div", async () => {
    const node = el("div", { class: "foo" }, undefined);
    node.props.children = "Hello";
    expect(String(await renderToString(node))).toBe('<div class="foo">Hello</div>');
  });

  it("renders void elements without closing tag", async () => {
    expect(String(await renderToString(el("br", null)))).toBe("<br>");
    expect(String(await renderToString(el("input", { type: "text" })))).toBe('<input type="text">');
    expect(String(await renderToString(el("hr", null)))).toBe("<hr>");
    expect(String(await renderToString(el("img", { src: "/logo.png", alt: "logo" })))).toBe('<img src="/logo.png" alt="logo">');
    expect(String(await renderToString(el("meta", { charset: "utf-8" })))).toBe('<meta charset="utf-8">');
    expect(String(await renderToString(el("link", { rel: "stylesheet", href: "/main.css" })))).toBe('<link rel="stylesheet" href="/main.css">');
  });

  it("escapes attribute values", async () => {
    const node = el("a", { href: "/path?a=1&b=2", title: '"quoted"' });
    expect(String(await renderToString(node))).toBe('<a href="/path?a=1&amp;b=2" title="&quot;quoted&quot;"></a>');
  });

  it("omits null attribute values", async () => {
    const node = el("div", { class: null, id: "box" });
    node.props.children = "x";
    expect(String(await renderToString(node))).toBe('<div id="box">x</div>');
  });

  it("omits undefined attribute values", async () => {
    const node = el("div", { class: undefined, id: "box" });
    node.props.children = "x";
    expect(String(await renderToString(node))).toBe('<div id="box">x</div>');
  });

  it("omits false attribute values", async () => {
    const node = el("span", { hidden: false });
    node.props.children = "ok";
    expect(String(await renderToString(node))).toBe("<span>ok</span>");
  });

  it("emits boolean attributes as bare names when true", async () => {
    expect(String(await renderToString(el("input", { type: "checkbox", disabled: true, checked: true })))).toBe(
      '<input type="checkbox" disabled checked>',
    );
  });

  it("emits boolean attributes only when truthy", async () => {
    expect(String(await renderToString(el("input", { type: "text", disabled: false, required: true })))).toBe('<input type="text" required>');
  });

  it("drops the style attribute (CSP forbids inline styles)", async () => {
    const node = el("div", { style: { backgroundColor: "red", fontSize: 14 } });
    node.props.children = "";
    expect(String(await renderToString(node))).toBe("<div></div>");
  });

  it("skips attributes with unsafe names (injection guard)", async () => {
    const node = el("div", { "x onmouseover=alert(1)": "y", id: "box" });
    node.props.children = "";
    expect(String(await renderToString(node))).toBe('<div id="box"></div>');
  });

  it('emits enumerated draggable={true} as draggable="true"', async () => {
    const node = el("div", { draggable: true });
    node.props.children = "";
    expect(String(await renderToString(node))).toBe('<div draggable="true"></div>');
  });

  it('emits enumerated draggable={false} as draggable="false"', async () => {
    const node = el("div", { draggable: false });
    node.props.children = "";
    expect(String(await renderToString(node))).toBe('<div draggable="false"></div>');
  });

  it("renders nonce attribute", async () => {
    const node = el("script", { nonce: "abc123", src: "/main.js", type: "module" });
    expect(String(await renderToString(node))).toBe('<script nonce="abc123" src="/main.js" type="module"></script>');
  });

  it("renders data-* attributes", async () => {
    const node = el("div", { "data-ref": "my-el", "data-state": "open" });
    node.props.children = "";
    expect(String(await renderToString(node))).toBe('<div data-ref="my-el" data-state="open"></div>');
  });

  it("skips the children prop as an attribute", async () => {
    const node = el("div", { children: "hello" });
    expect(String(await renderToString(node))).toBe("<div>hello</div>");
  });

  it("skips the key prop as an attribute", async () => {
    const node = el("li", { key: "item-1" });
    node.props.children = "item";
    expect(String(await renderToString(node))).toBe("<li>item</li>");
  });
});

describe("renderToString — SafeHtml child (rawHtml)", () => {
  it("renders a rawHtml child verbatim without escaping", async () => {
    const { rawHtml } = await import("../http/html");
    const node = el("div", null);
    node.props.children = rawHtml("<b>bold</b> &amp; <i>italic</i>");
    expect(String(await renderToString(node))).toBe("<div><b>bold</b> &amp; <i>italic</i></div>");
  });

  it("renders a rawHtml node directly (no element wrapper)", async () => {
    const { rawHtml } = await import("../http/html");
    const raw = rawHtml("<span>raw</span>");
    expect(String(await renderToString(raw))).toBe("<span>raw</span>");
  });

  it("renders rawHtml alongside plain string children in an array", async () => {
    const { rawHtml } = await import("../http/html");
    const parts = ["prefix: ", rawHtml("<em>mid</em>"), " suffix"];
    expect(String(await renderToString(parts))).toBe("prefix: <em>mid</em> suffix");
  });
});

describe("renderToString — nested elements", () => {
  it("renders nested elements", async () => {
    const inner = el("span", { class: "inner" });
    inner.props.children = "hello";
    const outer = el("div", { class: "outer" });
    outer.props.children = inner;
    expect(String(await renderToString(outer))).toBe('<div class="outer"><span class="inner">hello</span></div>');
  });

  it("renders children array", async () => {
    const li1 = el("li", null);
    li1.props.children = "a";
    const li2 = el("li", null);
    li2.props.children = "b";
    const ul = el("ul", null);
    ul.props.children = [li1, li2];
    expect(String(await renderToString(ul))).toBe("<ul><li>a</li><li>b</li></ul>");
  });
});

describe("renderToString — Fragment", () => {
  it("renders a Fragment without a wrapper element", async () => {
    const frag = el(Fragment, { children: ["hello ", "world"] });
    expect(String(await renderToString(frag))).toBe("hello world");
  });

  it("renders nested fragments", async () => {
    const inner = el(Fragment, { children: ["b", "c"] });
    const outer = el(Fragment, { children: ["a", inner] });
    expect(String(await renderToString(outer))).toBe("abc");
  });
});

describe("renderToString — function components", () => {
  it("renders a synchronous function component", async () => {
    function Greeting({ name }: { name: string }) {
      const node = el("p", null);
      node.props.children = `Hello, ${name}!`;
      return node;
    }

    expect(String(await renderToString(el(Greeting as unknown as ComponentFn, { name: "World" })))).toBe("<p>Hello, World!</p>");
  });

  it("renders an async function component", async () => {
    async function AsyncBox({ id }: { id: number }) {
      await Promise.resolve();
      const node = el("div", { "data-id": String(id) });
      node.props.children = String(id);
      return node;
    }

    expect(String(await renderToString(el(AsyncBox as unknown as ComponentFn, { id: 42 })))).toBe('<div data-id="42">42</div>');
  });

  it("renders nested components", async () => {
    function Inner({ text }: { text: string }) {
      const s = el("span", null);
      s.props.children = text;
      return s;
    }

    function Outer({ text }: { text: string }) {
      const d = el("div", null);
      d.props.children = el(Inner as unknown as ComponentFn, { text });
      return d;
    }

    expect(String(await renderToString(el(Outer as unknown as ComponentFn, { text: "hi" })))).toBe("<div><span>hi</span></div>");
  });
});

describe("renderToString — html tagged template", () => {
  it("escapes interpolated strings", async () => {
    const { html } = await import("../http/html");
    const result = html`<div>${"<script>"}</div>`;
    expect(String(result)).toBe("<div>&lt;script&gt;</div>");
  });

  it("allows raw HTML via html.raw``", async () => {
    const { html } = await import("../http/html");
    const raw = "<span>raw</span>";
    const result = html`<div>${html.raw`${raw}`}</div>`;
    expect(String(result)).toBe("<div><span>raw</span></div>");
  });

  it("composes doctype + rendered content via html tag", async () => {
    const { html } = await import("../http/html");
    const node = el("title", null);
    node.props.children = "My Page";
    const rendered = await renderToString(node);
    // html.raw`` must be used inside the html tag function — it marks a value as pre-rendered
    const result = html`<!DOCTYPE html>${html.raw`${rendered}`}`;
    expect(String(result)).toBe("<!DOCTYPE html><title>My Page</title>");
  });
});

describe("renderToString — mixed sync/async arrays and components", () => {
  it("renders a mixed array of sync and async elements preserving order", async () => {
    async function AsyncSpan({ text }: { text: string }) {
      await Promise.resolve();
      const s = el("span", null);
      s.props.children = text;
      return s;
    }
    const syncNode = el("em", null);
    syncNode.props.children = "sync";
    const asyncNode = el(AsyncSpan as unknown as ComponentFn, { text: "async" });
    expect(String(await renderToString([syncNode, asyncNode]))).toBe("<em>sync</em><span>async</span>");
  });

  it("renders sync children under an async parent component", async () => {
    async function Wrapper({ children }: { children?: unknown }) {
      await Promise.resolve();
      const d = el("div", null);
      d.props.children = children;
      return d;
    }
    const inner = el("span", null);
    inner.props.children = "inner";
    const node = el(Wrapper as unknown as ComponentFn, { children: inner });
    expect(String(await renderToString(node))).toBe("<div><span>inner</span></div>");
  });

  it("renders a fully-sync array without going through Promise.all", async () => {
    const li1 = el("li", null);
    li1.props.children = "a";
    const li2 = el("li", null);
    li2.props.children = "b";
    const li3 = el("li", null);
    li3.props.children = "c";
    expect(String(await renderToString([li1, li2, li3]))).toBe("<li>a</li><li>b</li><li>c</li>");
  });
});

describe("renderToString — URL attribute sanitization", () => {
  it("neutralizes a javascript: href to '#'", async () => {
    const node = el("a", { href: "javascript:alert(1)", children: "click" });
    expect(String(await renderToString(node))).toBe('<a href="#">click</a>');
  });

  it("neutralizes a javascript: src to '#'", async () => {
    expect(String(await renderToString(el("img", { src: "javascript:alert(1)" })))).toBe('<img src="#">');
  });

  it("neutralizes a javascript: formaction to '#'", async () => {
    const node = el("button", { formaction: "javascript:alert(1)", children: "go" });
    expect(String(await renderToString(node))).toBe('<button formaction="#">go</button>');
  });

  it("leaves a safe relative href unchanged", async () => {
    const node = el("a", { href: "/safe/path?a=1&b=2", children: "x" });
    expect(String(await renderToString(node))).toBe('<a href="/safe/path?a=1&amp;b=2">x</a>');
  });

  it("leaves an https href unchanged", async () => {
    const node = el("a", { href: "https://example.com", children: "x" });
    expect(String(await renderToString(node))).toBe('<a href="https://example.com">x</a>');
  });

  it("does not sanitize non-URL attributes", async () => {
    // `id` is not a URL attribute, so a colon value passes through (escaped only).
    const node = el("div", { id: "javascript:notaurl" });
    expect(String(await renderToString(node))).toBe('<div id="javascript:notaurl"></div>');
  });

  it("neutralizes xlink:href with javascript: scheme to '#'", async () => {
    const node = el("a", { "xlink:href": "javascript:alert(1)", children: "icon" });
    expect(String(await renderToString(node))).toBe('<a xlink:href="#">icon</a>');
  });

  it("passes a benign xlink:href fragment reference unchanged", async () => {
    const node = el("a", { "xlink:href": "#icon", children: "x" });
    expect(String(await renderToString(node))).toBe('<a xlink:href="#icon">x</a>');
  });

  it("neutralizes xml:base with javascript: scheme to '#'", async () => {
    const node = el("image", { "xml:base": "javascript:void(0)" });
    expect(String(await renderToString(node))).toBe('<image xml:base="#"></image>');
  });

  it("passes a safe xml:base URL unchanged", async () => {
    const node = el("image", { "xml:base": "https://cdn.example.com" });
    expect(String(await renderToString(node))).toBe('<image xml:base="https://cdn.example.com"></image>');
  });
});

describe("renderPage", () => {
  it("returns a full-page Response with a leading doctype and html content-type", async () => {
    const res = await renderPage(el("main", { children: "hi" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    expect(await res.text()).toBe("<!DOCTYPE html><main>hi</main>");
  });

  it("applies a custom status and headers", async () => {
    const res = await renderPage(el("p", { children: "gone" }), { status: 410, headers: { "cache-control": "no-store" } });
    expect(res.status).toBe(410);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("isValidElement / cloneElement", () => {
  it("isValidElement accepts elements and rejects plain values", () => {
    expect(isValidElement(el("div", {}))).toBe(true);
    expect(isValidElement("div")).toBe(false);
    expect(isValidElement({})).toBe(false);
    expect(isValidElement(null)).toBe(false);
  });

  it("cloneElement merges props and renders the merged result", async () => {
    const base = el("button", { type: "button", children: "Go" });
    const cloned = cloneElement(base, { "data-ref": "b1" });
    expect(String(await renderToString(cloned))).toBe('<button type="button" data-ref="b1">Go</button>');
    // Original is untouched:
    expect(String(await renderToString(base))).toBe('<button type="button">Go</button>');
  });
});
