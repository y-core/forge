/**
 * Active-descendant controller — the keyboard behaviour a **combobox** needs, which roving focus
 * cannot supply.
 *
 * A composite like a toolbar moves *real* focus between its items. A combobox must not: the user is
 * typing, so focus stays in the text field for the whole interaction and the "current" option is
 * named by `aria-activedescendant` instead. That is not a variation on roving focus, it is the other
 * half of the ARIA composite model, and `mountRovingFocus` is disqualified from the job by three
 * independent properties of its implementation:
 *
 * - `belongsToTextField` hands every arrow key back to the caret whenever the caret can still move,
 *   which for a query mid-word is always — so ArrowDown never reaches the ring at all;
 * - it calls `item.focus()`, taking focus **out** of the field a combobox is defined by keeping it
 *   in, which also closes the on-screen keyboard on touch and interrupts screen-reader typing echo;
 * - its typeahead is gated off for native inputs, correctly — a combobox's "typeahead" is the query
 *   itself, and a second one over the same keystrokes would fight it.
 *
 * So this is a sibling controller rather than an option on that one. What it does *not* do is own the
 * list's contents: items are resolved **live** on every interaction, so a list rebuilt between
 * keystrokes — which is what a live query produces — needs no re-registration.
 */

const ARROW_UP = "ArrowUp";
const ARROW_DOWN = "ArrowDown";
const HOME = "Home";
const END = "End";
const ENTER = "Enter";

/** Marks the active option. Read by CSS and by assistive technology alike. */
const ACTIVE_ATTR = "aria-selected";

/** Options for {@link mountActiveDescendant}. */
export interface ActiveDescendantOptions {
  /** The text field that keeps focus. Its `aria-activedescendant` is what this controller writes. */
  input: HTMLElement;
  /** Selector for the options, resolved **live** against the root on every interaction. */
  items: string;
  /**
   * Run when the user commits the active option with Enter.
   *
   * Not called when there is no active option — an empty result set must not commit anything, which
   * is the guard that also stops Enter running `items[-1]`.
   */
  onActivate?: (item: HTMLElement, index: number) => void;
  /** Wrap from the last option to the first and back. @default true */
  loop?: boolean;
}

/**
 * A stable id for an option, so `aria-activedescendant` has something to point at.
 *
 * Generated only when the consumer did not supply one. A combobox's options are frequently
 * client-built from a live query, and requiring the consumer to mint ids would push a bookkeeping
 * problem onto exactly the code least able to solve it — the ids have to be unique per document, not
 * per list.
 */
let sequence = 0;
function ensureId(item: HTMLElement): string {
  if (!item.id) {
    sequence += 1;
    item.id = `forge-option-${sequence}`;
  }
  return item.id;
}

/**
 * Install active-descendant navigation on `root` and return a disposer.
 *
 * The disposer is a **contract, not a convenience**: `resume()` already returns a teardown that
 * removes every listener it installed, and a controller that cannot be disposed leaks a `keydown`
 * listener on every re-resume.
 *
 * ```ts
 * mountActiveDescendant(dialog, {
 *   input: dialog.querySelector("input")!,
 *   items: "[role='option']",
 *   onActivate: (item) => run(Number(item.dataset.command)),
 * });
 * ```
 * @public
 */
export function mountActiveDescendant(root: HTMLElement, options: ActiveDescendantOptions): () => void {
  const { input, items: selector, onActivate, loop = true } = options;

  /**
   * The option ring, resolved live and filtered to what is actually rendered.
   *
   * `checkVisibility()` is the platform's own answer to "would this render", covering `display`,
   * `visibility`, `content-visibility` and the `hidden` attribute together; `!== false` keeps the
   * ring intact on a node that has no such method.
   */
  const listItems = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => el.checkVisibility?.() !== false);

  const activeIndex = (list: HTMLElement[]): number => list.findIndex((el) => el.getAttribute(ACTIVE_ATTR) === "true");

  /**
   * Mark one option active and point the field at it.
   *
   * **Both halves, always.** `aria-selected` is what CSS styles and what a `listbox`'s options are
   * required to carry; `aria-activedescendant` is what tells assistive technology which one the
   * focused field is currently on. Writing only the first is a highlight a screen-reader user cannot
   * see; writing only the second is a pointer at an option that does not look selected.
   */
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
    // **No options means no keys claimed** — not even Enter. A combobox with an empty result set must
    // let Enter through to whatever the field is inside, and must never commit `list[-1]`.
    if (list.length === 0) return;

    const current = activeIndex(list);

    if (key === ENTER) {
      const item = list[current];
      if (!item) return;
      keyEvent.preventDefault();
      onActivate?.(item, current);
      return;
    }

    // **Arrow keys are taken from the caret here, deliberately, and that is the whole difference from
    // roving focus.** Up and Down do not move a caret in a single-line field, so there is nothing to
    // hand back; Left and Right are never claimed, so the caret keeps them.
    keyEvent.preventDefault();
    if (key === HOME) setActive(list, 0);
    else if (key === END) setActive(list, list.length - 1);
    else setActive(list, step(list, current === -1 ? (key === ARROW_DOWN ? -1 : list.length) : current, key === ARROW_DOWN ? 1 : -1));
  };

  /**
   * Pointer and keyboard agree on which option is current.
   *
   * Without this, hovering a row highlights it visually (a `:hover` rule) while the keyboard's idea
   * of "current" stays where it was — so Enter runs a different option than the one under the
   * pointer, which is the same class of mistake as clamping a stale highlight index.
   */
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

/**
 * Reset the ring to its first option — what a combobox does when its result set changes.
 *
 * **Reset, never clamp**, and the distinction is the reason this is published rather than left to the
 * consumer. Clamping keeps the highlight on whatever option now occupies the old index, which after a
 * new query is a *different* command than the one the user was looking at — and Enter would run it.
 *
 * Exported separately from the controller because only the consumer knows when its list changed: the
 * controller reads items live and deliberately has no opinion about who replaced them.
 * @public
 */
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
