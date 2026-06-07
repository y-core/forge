import { escapeHtml, safeUrl } from "../http/escape";
import type { SafeHtml } from "../http/html";
import { isSafeHtml, rawHtml } from "../http/html";
import { htmlResponse } from "../http/response";
import { Fragment, isValidElement } from "./element";
import type { JSXElement, JSXNode } from "./types";

/** HTML5 void elements — no children, no closing tag. */
const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/** Attributes that are boolean: emitted as bare name when truthy, omitted when falsy. */
const BOOLEAN_ATTRS = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "ismap",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "readonly",
  "required",
  "reversed",
  "selected",
]);

/** Attributes whose values are URLs — scheme-sanitized to block `javascript:`-style injection. */
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster", "cite", "background"]);

/** Renders element attributes to a string of `key="value"` pairs. */
function renderAttributes(props: Record<string, unknown>, tag: string): string {
  let attrs = "";
  for (const [key, value] of Object.entries(props)) {
    // Skip non-attribute fields
    if (key === "children" || key === "key") {
      continue;
    }

    if (value === null || value === undefined || value === false) continue;

    const attrName = key;

    // Inline styles are dropped: the shipped CSP uses `style-src 'self'` (no `'unsafe-inline'`),
    // so any `style="…"` attribute would be blocked by the browser. Keep it out of the HTML
    // entirely rather than ship a silently-blocked attribute. See security/headers.ts (F15).
    if (attrName === "style") continue;

    // Boolean attributes: emit only the attribute name when truthy
    if (BOOLEAN_ATTRS.has(attrName.toLowerCase())) {
      if (value) attrs += ` ${attrName}`;
      continue;
    }

    // true without a boolean entry:
    // - aria-* attributes use string values ("true"/"false" per WAI-ARIA spec)
    // - all other attributes: emit as bare attribute name (e.g. data-active={true})
    if (value === true) {
      if (attrName.startsWith("aria-")) {
        attrs += ` ${attrName}="true"`;
      } else {
        attrs += ` ${attrName}`;
      }
      continue;
    }

    // Regular attribute — URL attributes are scheme-sanitized first, then HTML-escaped.
    const raw = String(value);
    const out = URL_ATTRS.has(attrName.toLowerCase()) ? safeUrl(raw) : raw;
    attrs += ` ${attrName}="${escapeHtml(out)}"`;
  }

  // Void elements never have id="" or similar empty overrides — handled by value checks above.
  void tag;
  return attrs;
}

/** Duck-type thenable check — avoids `instanceof Promise` so custom thenables (e.g. deferred islands) are also awaited. */
function isAsync(value: unknown): value is PromiseLike<unknown> {
  return value != null && typeof (value as Record<string, unknown>).then === "function";
}

/**
 * Renders a node synchronously when possible; returns a Promise only when async components or
 * async children are encountered. Avoids microtask overhead on fully-synchronous subtrees.
 */
function renderNodeSync(node: unknown): string | Promise<string> {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string") return escapeHtml(node);
  if (typeof node === "number") return String(node);

  if (Array.isArray(node)) {
    const parts = node.map(renderNodeSync);
    // Fast path: all children rendered synchronously — join without entering the microtask queue.
    if (parts.every((p): p is string => typeof p === "string")) {
      return parts.join("");
    }
    return Promise.all(parts).then((ps) => ps.join(""));
  }

  if (isSafeHtml(node)) return String(node);

  if (!isValidElement(node)) {
    return escapeHtml(String(node));
  }

  const element = node as JSXElement;

  // Fragment: render children without a wrapper
  if (element.type === Fragment) {
    return renderNodeSync(element.props.children);
  }

  // Function component: await only when the result is thenable
  if (typeof element.type === "function") {
    const fnResult = element.type(element.props);
    if (isAsync(fnResult)) {
      return (fnResult as Promise<unknown>).then(renderNodeSync);
    }
    return renderNodeSync(fnResult);
  }

  // Intrinsic HTML/SVG element
  const tag = element.type as string;
  const attrs = renderAttributes(element.props, tag);

  if (VOID_ELEMENTS.has(tag.toLowerCase())) {
    return `<${tag}${attrs}>`;
  }

  const children = renderNodeSync(element.props.children);
  if (isAsync(children)) {
    return children.then((c) => `<${tag}${attrs}>${c}</${tag}>`);
  }
  return `<${tag}${attrs}>${children}</${tag}>`;
}

/** Renders a JSX tree produced by the forge runtime to a `SafeHtml` value. @public */
export async function renderToString(node: unknown): Promise<SafeHtml> {
  return rawHtml(await renderNodeSync(node));
}

/**
 * Renders a JSX tree to a full-page HTML `Response`, prepending the HTML5 doctype.
 * Equivalent to `htmlResponse("<!DOCTYPE html>" + await renderToString(node), ...)`.
 * Use this in page handlers (`definePage` view functions, 404 handlers, etc.).
 * @public
 */
export async function renderPage(node: JSXNode, init?: { status?: number; headers?: Record<string, string> }): Promise<Response> {
  return htmlResponse(`<!DOCTYPE html>${await renderToString(node)}`, init?.status ?? 200, init?.headers);
}
