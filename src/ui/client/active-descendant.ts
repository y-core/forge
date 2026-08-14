const ARROW_UP = "ArrowUp";
const ARROW_DOWN = "ArrowDown";
const HOME = "Home";
const END = "End";
const ENTER = "Enter";

/** Marks the active option. Read by CSS and by assistive technology alike. */
const ACTIVE_ATTR = "aria-selected";

/** The index reported when the list has no active option. */
const NO_CURRENT = -1;

/** Options for {@link mountActiveDescendant}. */
export interface ActiveDescendantOptions {
  /** The text field that keeps focus. Its `aria-activedescendant` is what this controller writes. */
  input: HTMLElement;
  /** Selector for the options, resolved **live** against the root on every interaction. */
  items: string;
  /** Runs when the user commits the active option with Enter. */
  onActivate?: (item: HTMLElement, index: number) => void;
  /** Wrap from the last option to the first and back. @default true */
  loop?: boolean;
}

let sequence = 0;
/** A stable id for an option, so `aria-activedescendant` has something to point at. */
function ensureId(item: HTMLElement): string {
  if (!item.id) {
    sequence += 1;
    item.id = `forge-option-${sequence}`;
  }
  return item.id;
}

/** Installs active-descendant navigation on `root` and returns a disposer. @public */
export function mountActiveDescendant(root: HTMLElement, options: ActiveDescendantOptions): () => void {
  const { input, items: selector, onActivate, loop = true } = options;

  const listItems = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => el.checkVisibility?.() !== false);

  const activeIndex = (list: HTMLElement[]): number => list.findIndex((el) => el.getAttribute(ACTIVE_ATTR) === "true");

  const setActive = (list: HTMLElement[], index: number): void => {
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      if (item) item.setAttribute(ACTIVE_ATTR, String(i === index));
    }
    const active = list[index];
    if (active) {
      input.setAttribute("aria-activedescendant", ensureId(active));
      // `block: "nearest"` so a list already in view does not scroll, which would otherwise jump on
      // every keystroke of a query that keeps the same first result.
      active.scrollIntoView?.({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  };

  const step = (list: HTMLElement[], from: number, direction: 1 | -1): number => {
    const next = from + direction;
    if (next >= 0 && next < list.length) return next;
    if (!loop) return from;
    return direction === 1 ? 0 : list.length - 1;
  };

  const onKeyDown = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.defaultPrevented) return;
    const { key } = keyEvent;
    if (key !== ARROW_UP && key !== ARROW_DOWN && key !== HOME && key !== END && key !== ENTER) return;
    if (keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.altKey) return;

    const list = listItems();
    // No options means no keys claimed, not even Enter: an empty result set must let Enter through
    // to whatever the field is inside, and must never commit `list[-1]`.
    if (list.length === 0) return;

    const current = activeIndex(list);

    if (key === ENTER) {
      const item = list[current];
      if (!item) return;
      keyEvent.preventDefault();
      onActivate?.(item, current);
      return;
    }

    // Up and Down do not move a caret in a single-line field, so there is nothing to hand back;
    // Left and Right are never claimed.
    keyEvent.preventDefault();
    if (key === HOME) setActive(list, 0);
    else if (key === END) setActive(list, list.length - 1);
    else {
      const direction = key === ARROW_DOWN ? 1 : -1;
      const justOutsideRing = direction === 1 ? -1 : list.length;
      setActive(list, step(list, current === NO_CURRENT ? justOutsideRing : current, direction));
    }
  };

  /** Keeps pointer and keyboard agreeing on which option is current, so Enter runs the row under the pointer. */
  const onPointerMove = (event: Event) => {
    const list = listItems();
    const index = list.findIndex((item) => item.contains(event.target as Node | null));
    if (index !== -1 && index !== activeIndex(list)) setActive(list, index);
  };

  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("pointermove", onPointerMove);

  return () => {
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("pointermove", onPointerMove);
    input.removeAttribute("aria-activedescendant");
  };
}

/** Resets the ring to its first option — what a combobox does when its result set changes. @public */
export function resetActiveDescendant(root: HTMLElement, input: HTMLElement, selector: string): void {
  const list = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => el.checkVisibility?.() !== false);
  for (let i = 0; i < list.length; i += 1) list[i]?.setAttribute(ACTIVE_ATTR, String(i === 0));
  const first = list[0];
  if (first) {
    if (!first.id) {
      sequence += 1;
      first.id = `forge-option-${sequence}`;
    }
    input.setAttribute("aria-activedescendant", first.id);
  } else {
    input.removeAttribute("aria-activedescendant");
  }
}
