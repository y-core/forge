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
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster", "cite", "background", "xlink:href", "xml:base"]);

/** Attributes whose boolean value renders as `="true"`/`="false"`, per HTML's enumerated semantics. */
const ENUMERATED_ATTRS = new Set(["draggable", "spellcheck", "contenteditable"]);

/** Valid HTML attribute name: starts with a letter/`_`/`:`, then letters, digits, `_`, `.`, `:`, `-`. */
const VALID_ATTR_NAME = /^[A-Za-z_:][\w.:-]*$/;

/** Renders element attributes to a string of `key="value"` pairs. */
function renderAttributes(props: Record<string, unknown>, tag: string): string {
  let attrs = "";
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "key") {
      continue;
    }

    if (value === null || value === undefined) continue;

    const attrName = key;

    // Values are escaped but the name is emitted verbatim, so an untrusted spread key
    // (e.g. ` onmouseover=…`) would otherwise inject attributes.
    if (!VALID_ATTR_NAME.test(attrName)) continue;

    // The shipped CSP is `style-src 'self'` with no `'unsafe-inline'`, so a `style="…"` attribute
    // would be blocked by the browser anyway.
    if (attrName === "style") continue;

    if (ENUMERATED_ATTRS.has(attrName.toLowerCase())) {
      if (value === true) {
        attrs += ` ${attrName}="true"`;
        continue;
      }
      if (value === false) {
        attrs += ` ${attrName}="false"`;
        continue;
      }
    }

    // WAI-ARIA is string-valued, so `false` is serialized rather than dropped: an absent
    // `aria-expanded` means "not expandable at all", not "collapsed".
    if (typeof value === "boolean" && attrName.startsWith("aria-")) {
      attrs += ` ${attrName}="${value ? "true" : "false"}"`;
      continue;
    }

    if (value === false) continue;

    if (BOOLEAN_ATTRS.has(attrName.toLowerCase())) {
      if (value) attrs += ` ${attrName}`;
      continue;
    }

    if (value === true) {
      attrs += ` ${attrName}`;
      continue;
    }

    const raw = String(value);
    const out = URL_ATTRS.has(attrName.toLowerCase()) ? safeUrl(raw) : raw;
    attrs += ` ${attrName}="${escapeHtml(out)}"`;
  }

  void tag;
  return attrs;
}

/** Duck-type thenable check, so custom thenables are awaited too. */
function isAsync(value: unknown): value is PromiseLike<unknown> {
  return value != null && typeof (value as Record<string, unknown>).then === "function";
}

/** Renders a node synchronously, returning a Promise only when an async component is encountered. */
function renderNodeSync(node: unknown): string | Promise<string> {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string") return escapeHtml(node);
  if (typeof node === "number") return String(node);

  if (Array.isArray(node)) {
    const parts = node.map(renderNodeSync);
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

  if (element.type === Fragment) {
    return renderNodeSync(element.props.children);
  }

  if (typeof element.type === "function") {
    const fnResult = element.type(element.props);
    if (isAsync(fnResult)) {
      return (fnResult as Promise<unknown>).then(renderNodeSync);
    }
    return renderNodeSync(fnResult);
  }

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

/** Renders a JSX tree to a full-page HTML `Response`, prepending the HTML5 doctype. @public */
export async function renderPage(node: JSXNode, init?: { status?: number; headers?: Record<string, string> }): Promise<Response> {
  return htmlResponse(`<!DOCTYPE html>${await renderToString(node)}`, init?.status ?? 200, init?.headers);
}
