/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { renderToString } from "../../jsx/render-to-string";
import { Turnstile } from "./turnstile";

describe("Turnstile", () => {
  it("renders the widget container + hidden fallback the controller wires, with the sitekey and no auto-render class", async () => {
    const html = String(await renderToString(<Turnstile siteKey='site-123' />));
    expect(html).toBe(
      '<div data-slot="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="normal" class=""><p data-ref="turnstile-fallback" role="alert" hidden class="text-sm text-red-600">The security challenge couldn&#39;t load. Please disable any ad or script blockers for this site and reload the page.</p></div>',
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
      '<div data-slot="turnstile" data-ref="turnstile" data-sitekey="site-123" data-size="compact" class="mt-4"><p data-ref="turnstile-fallback" role="alert" hidden class="text-sm text-red-600">Please retry.</p></div>',
    );
  });
});
