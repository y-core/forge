import { disclosedErrorMessage } from "#relax/error-page";

import type { AppContext } from "../context/types";
import { escapeHtml, safeUrl } from "../html/escape";
import { html } from "../html/html";
import { htmlResponse } from "../http/response";
import { renderError } from "../render/htmx/fragment";
import { requestIdCtx } from "../security/request-id";
import type { ErrorPageOptions, RelaxErrorDisclosure } from "./types";

const FIXED_MESSAGE = "An unexpected error occurred.";

/** Builds a styled full-page 500 handler for `createApp({ onError })` and `definePage({ onError })`; only a development build discloses the thrown message. @public */
export function createErrorPage<Bindings = Record<string, unknown>>(
  options: ErrorPageOptions<Bindings> = {},
): (error: Error, c: AppContext<Bindings>) => Response {
  return createErrorPageWith(options, disclosedErrorMessage);
}

/** `createErrorPage` with the message disclosure passed in. @internal */
export function createErrorPageWith<Bindings = Record<string, unknown>>(
  options: ErrorPageOptions<Bindings>,
  disclose: RelaxErrorDisclosure,
): (error: Error, c: AppContext<Bindings>) => Response {
  const title = options.title ?? "Something went wrong";

  return (error, c) => {
    const message = disclose(error) ?? FIXED_MESSAGE;

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

/** The error boundary's fallback 500 document, disclosing what `disclose` returns for `error` and quoting `reference`. @internal */
export function fallbackErrorDocument(error: Error, reference: string | undefined, disclose: RelaxErrorDisclosure): string {
  const detail = `<p>${escapeHtml(disclose(error) ?? FIXED_MESSAGE)}</p>`;
  const quote = reference ? `<p>Reference: ${escapeHtml(reference)}</p>` : "";
  return `<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1>${detail}${quote}</body></html>`;
}
