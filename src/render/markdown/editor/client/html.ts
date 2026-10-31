import { MARKDOWN_TRUSTED_TYPES_POLICY } from "../../trusted-types";
import type { HtmlSurface } from "./types";

type MarkdownHtmlPolicy = { createHTML(input: string): object };

type MarkdownTrustedTypesWindow = Window & {
  trustedTypes?: { createPolicy(name: string, rules: { createHTML(input: string): string }): MarkdownHtmlPolicy };
};

const HTML_SLOT = "viewport-html";
const LINE_BLOCKS = ":scope > [data-line]";
const REFUSED = "refused";
const TRUSTED_TYPES_FIX = `list "${MARKDOWN_TRUSTED_TYPES_POLICY}" in the CSP's trusted-types directive`;

// Per window, because `createPolicy` refuses a name already created there; a refusal is kept too.
const htmlPolicies = new WeakMap<Window, MarkdownHtmlPolicy | null>();

function markdownHtmlPolicy(win: MarkdownTrustedTypesWindow): MarkdownHtmlPolicy | null {
  const cached = htmlPolicies.get(win);
  if (cached !== undefined) return cached;
  let policy: MarkdownHtmlPolicy | null = null;
  try {
    policy = win.trustedTypes?.createPolicy(MARKDOWN_TRUSTED_TYPES_POLICY, { createHTML: (input) => input }) ?? null;
  } catch (error) {
    console.error(
      `[markdown viewport] could not create the "${MARKDOWN_TRUSTED_TYPES_POLICY}" Trusted Types policy — ${TRUSTED_TYPES_FIX}; the html rendering stays empty`,
      error,
    );
  }
  htmlPolicies.set(win, policy);
  return policy;
}

/** Writes `html` into `container`, through the `forge-markdown` policy where the window has Trusted Types, reporting whether the write held. @internal */
export function writeViewportHtml(container: HTMLElement, html: string): boolean {
  const win = container.ownerDocument.defaultView as MarkdownTrustedTypesWindow | null;
  if (win === null || !win.trustedTypes) {
    container.innerHTML = html;
    return true;
  }
  const policy = markdownHtmlPolicy(win);
  try {
    if (policy !== null) {
      container.innerHTML = policy.createHTML(html) as unknown as string;
      return true;
    }
  } catch (error) {
    console.error(`[markdown viewport] the browser refused HTML through "${MARKDOWN_TRUSTED_TYPES_POLICY}" — ${TRUSTED_TYPES_FIX}`, error);
  }
  container.replaceChildren();
  container.dataset.viewportHtml = REFUSED;
  return false;
}

function lineBlocks(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(LINE_BLOCKS)];
}

/** Appends the `html` rendering's container to `host` and slots it beside the editor in `shadow`, hidden until shown. @internal */
export function createHtmlSurface(
  host: HTMLElement,
  shadow: ShadowRoot,
  html: (markdown: string) => string,
  onHtml: ((container: HTMLElement) => void) | undefined,
): HtmlSurface {
  const doc = host.ownerDocument;
  const slot = doc.createElement("slot");
  slot.name = HTML_SLOT;
  shadow.appendChild(slot);
  const container = doc.createElement("div");
  container.className = "markdown";
  container.slot = HTML_SLOT;
  container.dataset.viewportHtml = "";
  container.hidden = true;
  host.appendChild(container);
  let written: string | null = null;

  const laidOut = (): boolean => container.getClientRects().length > 0;

  return {
    container,
    render: (markdown) => {
      if (markdown === written) return;
      written = markdown;
      if (writeViewportHtml(container, html(markdown))) onHtml?.(container);
    },
    show: (shown) => {
      container.hidden = !shown;
    },
    laidOut,
    topAnchor: (scroller) => {
      const top = scroller.getBoundingClientRect().top;
      const blocks = lineBlocks(container);
      const block = blocks.find((candidate) => candidate.getBoundingClientRect().bottom > top) ?? blocks.at(-1);
      if (block === undefined) return { line: 1, top: container.getBoundingClientRect().top };
      return { line: Number(block.dataset.line), top: block.getBoundingClientRect().top };
    },
    scrollTo: (scroller, anchor) => {
      if (!laidOut()) return;
      const blocks = lineBlocks(container);
      const block = blocks.findLast((candidate) => Number(candidate.dataset.line) <= anchor.line) ?? blocks[0];
      if (block !== undefined) scroller.scrollTop += block.getBoundingClientRect().top - anchor.top;
    },
    destroy: () => {
      slot.remove();
      container.remove();
    },
  };
}
