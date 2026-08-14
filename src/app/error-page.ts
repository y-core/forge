import type { AppContext } from "../context/types";
import { renderError } from "../http/fragment";
import { html } from "../http/html";
import { htmlResponse } from "../http/response";

/** Options for `createErrorPage`. @public */
export interface ErrorPageOptions<Bindings = Record<string, unknown>> {
  /** Show the real error message when it returns `true`. */
  isDebug?: (c: AppContext<Bindings>) => boolean;
  /** Page `<title>` and heading. */
  title?: string;
  /** Stylesheet `<link>` href, static or resolved per request. */
  stylesheetHref?: string | ((c: AppContext<Bindings>) => string);
  /** "Back to safety" link rendered under the error banner. */
  homeHref?: string;
}

/** Builds a styled, debug-gated full-page 500 handler for `createApp({ onError })` and `definePage({ onError })`. @public */
export function createErrorPage<Bindings = Record<string, unknown>>(
  options: ErrorPageOptions<Bindings> = {},
): (error: Error, c: AppContext<Bindings>) => Response {
  const title = options.title ?? "Something went wrong";

  return (error, c) => {
    let debug = false;
    try {
      debug = options.isDebug?.(c) ?? false;
    } catch {
      // A broken debug probe must never leak detail — treat as production.
    }
    const message = debug ? error.message : "An unexpected error occurred.";

    let stylesheetHref: string | undefined;
    try {
      stylesheetHref = typeof options.stylesheetHref === "function" ? options.stylesheetHref(c) : options.stylesheetHref;
    } catch {
      // A failing asset resolver must not break the error page itself.
    }

    const doc = html`<html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${title}</title>
        ${stylesheetHref ? html`<link rel="stylesheet" href="${stylesheetHref}" />` : ""}
      </head>
      <body>
        <main class="error-page mx-auto max-w-xl p-8">
          <h1 class="mb-4 text-xl font-semibold">${title}</h1>
          ${renderError(message)}
          ${options.homeHref ? html`<p class="mt-4"><a href="${options.homeHref}">Back to safety</a></p>` : ""}
        </main>
      </body>
    </html>`;
    return htmlResponse(doc, 500);
  };
}
