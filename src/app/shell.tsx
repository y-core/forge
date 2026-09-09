/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { RequestContext } from "@remix-run/fetch-router";

import { contextVar } from "../context/accessor";
import type { AppContext } from "../context/types";
import { renderPage } from "../jsx/render-to-string";
import type { JSXNode } from "../jsx/types";
import { type PageMeta, metaTags } from "./meta";

// Open on purpose: a closed union of mount names would make every mountable forge adds later a
// breaking change for every shell a consumer has already written.
/** Which mount and page a shell is wrapping, so one shell can vary its chrome. @public */
export interface ShellSlot {
  /** The mountable rendering this page — `auth`, `showcase`, `logs`, or a consumer's own. */
  readonly mount: string;
  /** Which page of that mount, in the mount's own vocabulary. */
  readonly page: string;
  /** What this page says about itself in `<head>`, the mount's own copy resolved. */
  readonly meta: PageMeta;
}

/** The app's document shell, registered once and resolved per request. @public */
export type PageShell<Bindings = Record<string, unknown>> = (
  c: AppContext<Bindings>,
  content: JSXNode,
  slot: ShellSlot,
) => JSXNode | Promise<JSXNode>;

// `setShell` is the only writer, so absence means the app registered none — read with `getOptional`.
/** This request's shell. @internal */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings are the app's, not this slot's
export const shellCtx = contextVar<PageShell<any>>("pageShell");

/** The chrome `pageShell` renders around a mount's content. @public */
export interface ShellDocument {
  /** Stylesheets to link; without one the page renders unstyled, since forge ships no URL it could guess. */
  readonly stylesheet?: string | readonly string[];
  /** Scripts to load as modules at the end of `<body>`. */
  readonly script?: string | readonly string[];
  /** `<html lang>`. Defaults to `en`. */
  readonly lang?: string;
}

/** One entry of a `string | readonly string[]` option as a list, so a single value needs no array. */
function hrefs(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : value;
}

/** Builds a shell for a deployment whose whole chrome is a stylesheet and a script. @public */
export function pageShell<Bindings = Record<string, unknown>>(document: ShellDocument = {}): PageShell<Bindings> {
  return (_c, content, slot) => (
    <html lang={document.lang ?? "en"}>
      <head>
        <meta charset='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
        {metaTags(slot.meta)}
        {hrefs(document.stylesheet).map((href) => (
          <link rel='stylesheet' href={href} />
        ))}
      </head>
      <body>
        {content}
        {hrefs(document.script).map((src) => (
          <script type='module' src={src} />
        ))}
      </body>
    </html>
  );
}

// The floor, not a placeholder: content handed straight to `renderPage` puts a doctype in front of a
// `<div>`, leaving an unregistered app no `<head>`, and so no title and no stylesheet.
/** The document an app that registered no shell renders. */
const BARE_SHELL = pageShell();

/** Renders content as a full document through the app's shell — the one place `<html>` is written. @public */
export async function renderShell(
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings and params are the mount's, not this seam's
  c: RequestContext<any, any>,
  content: JSXNode,
  slot: ShellSlot,
  init?: { status?: number; headers?: Record<string, string> },
): Promise<Response> {
  const shell = shellCtx.getOptional(c) ?? BARE_SHELL;
  // A mount only renders from a routed handler, where `env` and `config` are already on the context,
  // so the narrowing is the router's promise rather than a check this seam repeats — and a unit test
  // that renders one page directly is trusted with the same claim instead of building a whole app.
  return renderPage(await shell(c as unknown as AppContext<never>, content, slot), init);
}
