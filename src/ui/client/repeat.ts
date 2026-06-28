import { effect } from "./signal";

export interface RepeatOptions<T> {
  /** Container whose children mirror the list. Mutated via replaceChildren. */
  container: HTMLElement;
  /** Reactive read of the items — called inside an effect, so reading signals here subscribes. */
  each: () => readonly T[];
  /** Stable identity per item; reused keys keep their DOM node (and listeners) across updates. */
  key: (item: T, index: number) => string;
  /** Build the row element for a new key. The caller stamps any data-on-X/data-* contract here. */
  render: (item: T) => HTMLElement;
  /** Optional in-place refresh for a reused key (e.g. renamed group); skipped if omitted. */
  update?: (el: HTMLElement, item: T) => void;
}

/** Reactively reconciles `container`'s children to `each()`, keyed by `key`. Returns a dispose fn. @public */
export function repeat<T>(opts: RepeatOptions<T>): () => void {
  let prev = new Map<string, HTMLElement>();
  return effect(() => {
    const items = opts.each();
    const next = new Map<string, HTMLElement>();
    const ordered: HTMLElement[] = [];
    for (const [i, item] of items.entries()) {
      const k = opts.key(item, i);
      if (next.has(k)) {
        console.warn(`repeat: duplicate key "${k}" — last-wins`);
      }
      const existing = prev.get(k);
      const el = existing !== undefined ? existing : opts.render(item);
      if (existing !== undefined) opts.update?.(el, item);
      next.set(k, el);
      ordered.push(el);
    }
    opts.container.replaceChildren(...ordered);
    prev = next;
  });
}
