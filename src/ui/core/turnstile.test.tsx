/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { renderToString } from "../../jsx/render-to-string";
import { Turnstile } from "./turnstile";

const FALLBACKS =
  '<p data-ref="turnstile-fallback" role="alert" hidden class="text-sm text-destructive-text">The security challenge couldn&#39;t load. Please disable any ad or script blockers for this site and reload the page.</p><p data-ref="turnstile-unsupported" role="alert" hidden class="text-sm text-destructive-text">This browser cannot run the security challenge. Please try again in a current version of Chrome, Edge, Firefox or Safari.</p>';

describe("Turnstile", () => {
  it("renders the widget container + both hidden messages the controller wires, with the sitekey, the eager default and no auto-render class", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' />));
    expect(html).toBe(
      `<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" data-load="eager" class="h-16.25 w-75">${FALLBACKS}</div>`,
    );
  });

  it("overrides both messages by prop and reflects the size prop + a merged class", async () => {
    const html = String(
      await renderToString(
        <Turnstile siteKey='site-123' size='compact' class='mt-4' unsupported='Try another browser.'>
          Please retry.
        </Turnstile>,
      ),
    );
    expect(html).toBe(
      '<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="compact" data-load="eager" class="h-35 w-37.5 mt-4"><p data-ref="turnstile-fallback" role="alert" hidden class="text-sm text-destructive-text">Please retry.</p><p data-ref="turnstile-unsupported" role="alert" hidden class="text-sm text-destructive-text">Try another browser.</p></div>',
    );
  });

  it("reserves the flexible widget's box as a full-width band with Cloudflare's floor", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' size='flexible' />));
    expect(html).toBe(
      `<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="flexible" data-load="eager" class="h-16.25 w-full min-w-75">${FALLBACKS}</div>`,
    );
  });

  it("reserves nothing for an appearance that shows the widget only when it must, so no permanent hole is left", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' appearance='interaction-only' />));
    expect(html).toBe(
      `<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" data-load="eager" data-appearance="interaction-only" class="">${FALLBACKS}</div>`,
    );
  });

  it("carries the deferred load and the action the token is minted against", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' load='focus' action='contact-form' />));
    expect(html).toBe(
      `<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" data-load="focus" data-action="contact-form" class="h-16.25 w-75">${FALLBACKS}</div>`,
    );
  });

  it("carries the customer data the token is minted with, which is what makes the server's expectedCData reachable", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' cData='order-4821' />));
    expect(html).toBe(
      `<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" data-load="eager" data-cdata="order-4821" class="h-16.25 w-75">${FALLBACKS}</div>`,
    );
  });

  it("carries the name the hidden token input takes, so a second widget can share the form", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' responseFieldName='cf-turnstile-signup' />));
    expect(html).toBe(
      `<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" data-load="eager" data-response-field-name="cf-turnstile-signup" class="h-16.25 w-75">${FALLBACKS}</div>`,
    );
  });

  it("stamps the three token-scoping attributes in one markup when all three are named", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' action='signup' cData='order-4821' responseFieldName='signup-token' />));
    expect(html).toBe(
      `<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" data-load="eager" data-action="signup" data-cdata="order-4821" data-response-field-name="signup-token" class="h-16.25 w-75">${FALLBACKS}</div>`,
    );
  });

  it("carries the language and the iframe tabindex the controller passes to Cloudflare", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' language='en-US' tabindex={3} />));
    expect(html).toBe(
      `<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" data-load="eager" data-language="en-US" data-tabindex="3" class="h-16.25 w-75">${FALLBACKS}</div>`,
    );
  });

  it("carries the deferred challenge and the appearance the controller passes to Cloudflare", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' challenge='submit' appearance='interaction-only' />));
    expect(html).toBe(
      `<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" data-load="eager" data-challenge="submit" data-appearance="interaction-only" class="">${FALLBACKS}</div>`,
    );
  });

  it("stamps neither attribute for the defaults named explicitly, so an opted-out page renders the markup it always did", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' challenge='render' appearance='always' />));
    expect(html).toBe(
      `<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" data-load="eager" class="h-16.25 w-75">${FALLBACKS}</div>`,
    );
  });
});
