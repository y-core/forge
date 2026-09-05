import { elementById, ownerWindow } from "./dom";

/** `Node.DOCUMENT_POSITION_FOLLOWING`, spelled out rather than read off a bare `Node` global. */
const POSITION_FOLLOWING = 4;

const NOOP = (): void => {};

/** One fragment link and the element it points at. @internal */
export interface FragmentEntry {
  link: Element;
  target: Element;
}

/** Links paired with their targets, deduplicated and ordered by the targets' document position
 *  rather than by the nav's markup order, which is free to differ. @internal */
export function resolveFragmentEntries(root: Element, selector: string): FragmentEntry[] {
  const entries: FragmentEntry[] = [];
  const seen = new Set<Element>();

  for (const link of root.querySelectorAll(selector)) {
    const href = link.getAttribute("href") ?? "";
    if (!href.startsWith("#")) continue;
    const target = elementById(link, href.slice(1));
    if (!target || seen.has(target)) continue;
    seen.add(target);
    entries.push({ link, target });
  }

  return entries.sort((a, b) => ((a.target.compareDocumentPosition(b.target) & POSITION_FOLLOWING) !== 0 ? -1 : 1));
}

/** What a controller does once the guards have passed: watch these boxes, this way. @internal */
export interface FragmentObserverPlan {
  init: IntersectionObserverInit;
  onRecords(records: readonly IntersectionObserverEntry[]): void;
  /** Teardown beyond disconnecting, run before the mount record is dropped. */
  cleanup?(): void;
}

/** What {@link mountFragmentObserver} needs to stand one controller up. @internal */
export interface FragmentObserverConfig {
  root: Element;
  selector: string;
  /** The mounting function's own name, for the `root` error. */
  fn: string;
  /** The log prefix, and what the caller should have passed as `root`. */
  label: string;
  requires: string;
  /** What is lost when the guard trips, completing "…; <degraded>". */
  emptyTarget: string;
  degraded: string;
  mounted: WeakMap<Element, () => void>;
  /** Returns the plan, or `null` after warning about markup it cannot drive. */
  plan(entries: FragmentEntry[]): FragmentObserverPlan | null;
}

/** The mount scaffold both fragment-driven controllers share: the idempotence guard, the three
 *  refusals and the disposer. Returns the mount's disposer, or a noop when a guard tripped. @internal */
export function mountFragmentObserver(config: FragmentObserverConfig): () => void {
  const { root, selector, mounted } = config;
  // Deterministic for a given call site and impossible to discover later, so it throws.
  if (!root) throw new Error(`${config.fn}: \`root\` is required — ${config.requires}`);

  const existing = mounted.get(root);
  if (existing) return existing;

  const entries = resolveFragmentEntries(root, selector);
  // A property of the page's markup, not of the call. Reported so a mis-typed selector is not
  // mistaken for a nav that legitimately has nothing to drive yet.
  if (entries.length === 0) {
    console.warn(`[${config.label}] no links matching "${selector}" resolve to ${config.emptyTarget} in this document; nothing to mark`);
    return NOOP;
  }

  const observerCtor = (ownerWindow(root) as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  if (typeof observerCtor !== "function") {
    console.warn(`[${config.label}] IntersectionObserver is unavailable in this realm; ${config.degraded}`);
    return NOOP;
  }

  const plan = config.plan(entries);
  if (!plan) return NOOP;

  const observer = new observerCtor((records) => plan.onRecords(records), plan.init);
  for (const entry of entries) observer.observe(entry.target);

  const dispose = () => {
    observer.disconnect();
    plan.cleanup?.();
    mounted.delete(root);
  };

  mounted.set(root, dispose);
  return dispose;
}
