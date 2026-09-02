/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { renderToString } from "../../jsx/render-to-string";
import { Turnstile } from "./turnstile";

describe("Turnstile", () => {
  it("renders the widget container + hidden fallback the controller wires, with the sitekey, the eager default and no auto-render class", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' />));
    expect(html).toBe(
      '<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" data-load="eager" class=""><p data-ref="turnstile-fallback" role="alert" hidden class="text-sm text-destructive">The security challenge couldn&#39;t load. Please disable any ad or script blockers for this site and reload the page.</p></div>',
    );
  });

  it("overrides the fallback message with children and reflects the size prop + a merged class", async () => {
    const html = String(
      await renderToString(
        <Turnstile siteKey='site-123' size='compact' class='mt-4'>
          Please retry.
        </Turnstile>,
      ),
    );
    expect(html).toBe(
      '<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="compact" data-load="eager" class="mt-4"><p data-ref="turnstile-fallback" role="alert" hidden class="text-sm text-destructive">Please retry.</p></div>',
    );
  });

  it("carries the deferred load and the action the token is minted against", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' load='focus' action='contact-form' />));
    expect(html).toBe(
      '<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" data-load="focus" data-action="contact-form" class=""><p data-ref="turnstile-fallback" role="alert" hidden class="text-sm text-destructive">The security challenge couldn&#39;t load. Please disable any ad or script blockers for this site and reload the page.</p></div>',
    );
  });

  it("carries the deferred challenge and the appearance the controller passes to Cloudflare", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' challenge='submit' appearance='interaction-only' />));
    expect(html).toBe(
      '<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" data-load="eager" data-challenge="submit" data-appearance="interaction-only" class=""><p data-ref="turnstile-fallback" role="alert" hidden class="text-sm text-destructive">The security challenge couldn&#39;t load. Please disable any ad or script blockers for this site and reload the page.</p></div>',
    );
  });

  it("stamps neither attribute for the defaults named explicitly, so an opted-out page renders the markup it always did", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' challenge='render' appearance='always' />));
    expect(html).toBe(
      '<div data-slot="turnstile" data-scope="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" data-load="eager" class=""><p data-ref="turnstile-fallback" role="alert" hidden class="text-sm text-destructive">The security challenge couldn&#39;t load. Please disable any ad or script blockers for this site and reload the page.</p></div>',
    );
  });
});
