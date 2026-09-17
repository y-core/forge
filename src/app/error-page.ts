import type { AppContext } from "../context/types";
import { safeUrl } from "../http/escape";
import { renderError } from "../http/fragment";
import { html } from "../http/html";
import { htmlResponse } from "../http/response";
import { requestIdCtx } from "../security/request-id";
import type { ErrorPageOptions } from "./types";

/** Builds a styled full-page 500 handler for `createApp({ onError })` and `definePage({ onError })`; the thrown message is printed only under a `DevAllowance` granting `errorDetail`. @public */
export function createErrorPage<Bindings = Record<string, unknown>>(
  options: ErrorPageOptions<Bindings> = {},
): (error: Error, c: AppContext<Bindings>) => Response {
  const title = options.title ?? "Something went wrong";

  return (error, c) => {
    const message = options.dev?.options.errorDetail === true ? error.message : "An unexpected error occurred.";

    let stylesheetHref: string | undefined;
    try {
      stylesheetHref = typeof options.stylesheetHref === "function" ? options.stylesheetHref(c) : options.stylesheetHref;
    } catch {
      // A failing asset resolver must not break the error page itself.
    }

    // Generated nowhere on this path: without the `requestId` middleware there is no id to quote.
    const reference = requestIdCtx.getOptional(c);

    const doc = html`<html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${title}</title>
        ${stylesheetHref ? html`<link rel="stylesheet" href="${safeUrl(stylesheetHref)}" />` : ""}
      </head>
      <body>
        <main class="error-page mx-auto max-w-xl p-8">
          <h1 class="mb-4 text-xl font-semibold">${title}</h1>
          ${renderError(message)} ${reference ? html`<p class="mt-4 text-sm">Reference: ${reference}</p>` : ""}
          ${options.homeHref ? html`<p class="mt-4"><a href="${safeUrl(options.homeHref)}">Back to safety</a></p>` : ""}
        </main>
      </body>
    </html>`;
    return htmlResponse(doc, 500);
  };
}
