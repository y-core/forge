/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { renderToString } from "../jsx/render-to-string";
import { type PageMeta, mergeMeta, metaTags } from "./meta";

/** The markup a descriptor renders, as the one string a `<head>` would carry. */
function head(meta: PageMeta, options?: { nonce?: string }): Promise<string> {
  return renderToString(metaTags(meta, options)).then(String);
}

describe("metaTags", () => {
  it("renders the title alone when the title is all a page states", async () => {
    expect(await head({ title: "Home" })).toBe("<title>Home</title>");
  });

  it("escapes every value a page did not write itself", async () => {
    const markup = await head({ title: "Ada & Co <admin>", description: 'He said "no" & left' });
    expect(markup).toBe('<title>Ada &amp; Co &lt;admin&gt;</title><meta name="description" content="He said &quot;no&quot; &amp; left">');
  });

  it("renders each typed field as its own tag, in a fixed order", async () => {
    const markup = await head({ title: "Account", description: "Your account", canonical: "https://example.com/account", robots: "noindex" });
    expect(markup).toBe(
      "<title>Account</title>" +
        '<meta name="description" content="Your account">' +
        '<link rel="canonical" href="https://example.com/account">' +
        '<meta name="robots" content="noindex">',
    );
  });

  it("joins a compound robots directive into the one value the tag carries", async () => {
    expect(await head({ title: "Account", robots: ["noindex", "nofollow", "noarchive"] })).toBe(
      '<title>Account</title><meta name="robots" content="noindex, nofollow, noarchive">',
    );
  });

  it("renders the og and twitter fields under their own attribute", async () => {
    const markup = await head({
      title: "Post",
      og: { title: "Post — Acme", description: "A post", type: "article", image: "https://cdn.example.com/a.png", url: "https://example.com/p" },
      twitter: { card: "summary_large_image", title: "Post — Acme" },
    });
    expect(markup).toBe(
      "<title>Post</title>" +
        '<meta property="og:title" content="Post — Acme">' +
        '<meta property="og:description" content="A post">' +
        '<meta property="og:type" content="article">' +
        '<meta property="og:image" content="https://cdn.example.com/a.png">' +
        '<meta property="og:url" content="https://example.com/p">' +
        '<meta name="twitter:card" content="summary_large_image">' +
        '<meta name="twitter:title" content="Post — Acme">',
    );
  });

  it("appends every extra tag after the typed ones, in the order it was given", async () => {
    const markup = await head({
      title: "Home",
      robots: "index",
      extra: [
        { name: "theme-color", content: "#0b0b0b" },
        { property: "article:author", content: "Ada" },
        { tagName: "link", rel: "manifest", href: "/site.webmanifest" },
      ],
    });
    expect(markup).toBe(
      "<title>Home</title>" +
        '<meta name="robots" content="index">' +
        '<meta name="theme-color" content="#0b0b0b">' +
        '<meta property="article:author" content="Ada">' +
        '<link rel="manifest" href="/site.webmanifest">',
    );
  });

  it("does not deduplicate an extra against the typed tag it repeats — the page said both", async () => {
    const markup = await head({ title: "Home", robots: "noindex", extra: [{ name: "robots", content: "index" }] });
    expect(markup).toBe('<title>Home</title><meta name="robots" content="noindex"><meta name="robots" content="index">');
  });
});

describe("metaTags — structured data", () => {
  it("carries the request nonce on the script, since forge ships `script-src 'self'`", async () => {
    const markup = await head({ title: "Org", jsonLd: { "@type": "Organization", name: "Acme" } }, { nonce: "n0nce" });
    expect(markup).toBe('<title>Org</title><script type="application/ld+json" nonce="n0nce">{"@type":"Organization","name":"Acme"}</script>');
  });

  // Rendering it unnonced would emit a script the CSP refuses, which reads as a rendering bug in the
  // browser console rather than as the missing nonce it is.
  it("renders no script at all when the shell passed no nonce", async () => {
    expect(await head({ title: "Org", jsonLd: { name: "Acme" } })).toBe("<title>Org</title>");
  });

  it("escapes a payload that would otherwise close the script element early", async () => {
    const markup = await head({ title: "Org", jsonLd: { name: "</script><script>alert(1)</script>" } }, { nonce: "n" });
    expect(markup).toBe(
      '<title>Org</title><script type="application/ld+json" nonce="n">' +
        '{"name":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}</script>',
    );
  });
});

describe("mergeMeta", () => {
  const base: PageMeta = {
    title: "Acme",
    description: "The site",
    og: { title: "Acme", type: "website", image: "https://cdn.example.com/og.png" },
    twitter: { card: "summary" },
    extra: [{ name: "theme-color", content: "#0b0b0b" }],
  };

  it("takes the page's field wherever it states one", () => {
    expect(mergeMeta(base, { title: "Your account", robots: "noindex" })).toEqual({ ...base, title: "Your account", robots: "noindex" });
  });

  it("keeps the base's other og fields under a page that states only one", () => {
    const merged = mergeMeta(base, { og: { title: "Your account" } });
    expect(merged.og).toEqual({ title: "Your account", type: "website", image: "https://cdn.example.com/og.png" });
  });

  it("concatenates extras base-first, so the site's own tags come before the page's", () => {
    const merged = mergeMeta(base, { extra: [{ name: "robots", content: "noindex" }] });
    expect(merged.extra).toEqual([
      { name: "theme-color", content: "#0b0b0b" },
      { name: "robots", content: "noindex" },
    ]);
  });

  it("states no og at all when neither side has one, rather than an empty object", () => {
    expect(mergeMeta({ title: "Plain" }, { robots: "noindex" })).toEqual({ title: "Plain", robots: "noindex" });
  });
});
