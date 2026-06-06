import { escapeHtml, safeUrl } from "../http/escape";
import type { SafeHtml } from "../http/html";
import { rawHtml } from "../http/html";
import { Fragment, isValidElement } from "./element";
import type { JSXElement } from "./types";

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

/** Normalizes JSX attribute names to HTML attribute names. */
function normalizeAttrName(name: string): string {
  if (name === "className") return "class";
  if (name === "htmlFor") return "for";
  return name;
}

/** Renders element attributes to a string of `key="value"` pairs. */
function renderAttributes(props: Record<string, unknown>, tag: string): string {
  let attrs = "";
  for (const [key, value] of Object.entries(props)) {
    // Skip non-attribute fields
    if (key === "children" || key === "key" || key === "ref" || key === "dangerouslySetInnerHTML") {
      continue;
    }

    // Skip React-style synthetic event handlers in SSR
    if (key.length > 2 && key[0] === "o" && key[1] === "n") {
      const third = key[2];
      if (third !== undefined && third === third.toUpperCase()) continue;
    }

    if (value === null || value === undefined || value === false) continue;

    const attrName = normalizeAttrName(key);

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

async function renderNode(node: unknown): Promise<string> {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string") return escapeHtml(node);
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    const parts = await Promise.all(node.map(renderNode));
    return parts.join("");
  }

  if (!isValidElement(node)) {
    // Fallback: coerce unknown values to escaped string
    return escapeHtml(String(node));
  }

  const element = node as JSXElement;

  // Fragment: render children without a wrapper
  if (element.type === Fragment) {
    return renderNode(element.props.children);
  }

  // Function component: call it and render the result
  if (typeof element.type === "function") {
    const result = await element.type(element.props);
    return renderNode(result);
  }

  // Intrinsic HTML/SVG element
  const tag = element.type as string;
  const attrs = renderAttributes(element.props, tag);

  if (VOID_ELEMENTS.has(tag.toLowerCase())) {
    return `<${tag}${attrs}>`;
  }

  // dangerouslySetInnerHTML: emit raw, unescaped HTML
  const dih = element.props.dangerouslySetInnerHTML as { __html: string } | null | undefined;
  if (dih != null && typeof dih.__html === "string") {
    return `<${tag}${attrs}>${dih.__html}</${tag}>`;
  }

  const children = await renderNode(element.props.children);
  return `<${tag}${attrs}>${children}</${tag}>`;
}

/** Renders a JSX tree produced by the forge runtime to a `SafeHtml` value. @public */
export async function renderToString(node: unknown): Promise<SafeHtml> {
  return rawHtml(await renderNode(node));
}
