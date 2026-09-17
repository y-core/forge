/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { renderToString } from "../../jsx/render-to-string";
import { attrOf, attrsOf, classesOf, variantClasses } from "./core.fixture";
import { Turnstile } from "./turnstile";

const mount = (props: Omit<Parameters<typeof Turnstile>[0], "siteKey"> = {}) =>
  renderToString(<Turnstile siteKey='site-123' {...props} />).then(String);

const MOUNT_ATTRS = {
  "data-slot": "turnstile",
  "data-scope": "turnstile",
  "data-ref": "turnstile",
  "data-sitekey": "site-123",
  "data-size": "normal",
  "data-load": "eager",
};

const messageOf = (html: string, ref: string) => new RegExp(`data-ref="${ref}"[^>]*>([^<]*)<`).exec(html)?.[1];

describe("Turnstile", () => {
  it("renders the whole mount point exactly, both controller messages overridden and escaped", async () => {
    expect(
      await mount({ size: "compact", class: "mt-4", unsupported: `Use Chrome's latest`, children: `Retry & reload <now>`, "data-note": "a&b" }),
    ).toBe(
      '<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="compact" data-load="eager"' +
        ' class="h-35 w-37.5 mt-4" data-note="a&amp;b">' +
        '<p data-ref="turnstile-fallback" role="alert" hidden class="text-sm text-destructive-text">Retry &amp; reload &lt;now&gt;</p>' +
        '<p data-ref="turnstile-unsupported" role="alert" hidden class="text-sm text-destructive-text">Use Chrome&#39;s latest</p></div>',
    );
  });

  it("hands the controller the sitekey and the eager default, and stamps nothing for the other defaults", async () => {
    expect(attrsOf(await mount())).toEqual(MOUNT_ATTRS);
  });

  it("ships a message for each failure mode, because the controller only unhides what the server wrote", async () => {
    const html = await mount();

    expect(messageOf(html, "turnstile-fallback")).toBe(
      "The security challenge couldn&#39;t load. Please disable any ad or script blockers for this site and reload the page.",
    );
    expect(messageOf(html, "turnstile-unsupported")).toBe(
      "This browser cannot run the security challenge. Please try again in a current version of Chrome, Edge, Firefox or Safari.",
    );
  });

  it("reserves the compact widget's published box, so the form does not jump when the widget paints", async () => {
    expect(variantClasses(await mount({ size: "compact" }), await mount())).toEqual({ added: ["h-35", "w-37.5"], dropped: ["h-16.25", "w-75"] });
  });

  it("reserves the flexible widget's box as a full-width band with Cloudflare's floor", async () => {
    expect(variantClasses(await mount({ size: "flexible" }), await mount())).toEqual({ added: ["w-full", "min-w-75"], dropped: ["w-75"] });
  });

  it("reserves nothing for an appearance that shows the widget only when it must, so no permanent hole is left", async () => {
    const html = await mount({ appearance: "interaction-only" });

    expect(classesOf(html)).toEqual([]);
    expect(attrOf(html, "data-appearance")).toBe("interaction-only");
  });

  it("carries the deferred challenge the controller passes to Cloudflare", async () => {
    expect(attrOf(await mount({ challenge: "submit" }), "data-challenge")).toBe("submit");
  });

  it("stamps neither attribute for the defaults named explicitly, so an opted-out page renders the markup it always did", async () => {
    expect(attrsOf(await mount({ challenge: "render", appearance: "always" }))).toEqual(MOUNT_ATTRS);
  });

  it("defers the load to the trigger it was given, so a widget below the fold costs nothing until it is reached", async () => {
    expect(attrOf(await mount({ load: "focus" }), "data-load")).toBe("focus");
  });

  it("carries all three token-scoping attributes, which is what makes expectedAction, expectedCData and a second widget reachable", async () => {
    expect(attrsOf(await mount({ action: "signup", cData: "order-4821", responseFieldName: "signup-token" }))).toEqual({
      ...MOUNT_ATTRS,
      "data-action": "signup",
      "data-cdata": "order-4821",
      "data-response-field-name": "signup-token",
    });
  });

  it("carries the language and the iframe tabindex the controller passes to Cloudflare", async () => {
    expect(attrsOf(await mount({ language: "en-US", tabindex: 3 }))).toEqual({ ...MOUNT_ATTRS, "data-language": "en-US", "data-tabindex": "3" });
  });
});
