/** Resumability-lite client runtime: one delegated listener resumes a `[data-scope]` on the first interaction with any descendant. @public */

import { ISLAND_STATE_ATTR, ISLAND_STATE_KEY } from "../contracts/island-contract";
import { SCOPE_EVENTS } from "../contracts/scope-events";
import { closestAcross, eventTarget, ownerDocument } from "./dom";
import { createSignal, withOwner } from "./signal";
import type { Signal } from "./types";
import type { ScopeDefinition } from "./types";

const scopes = new Map<string, ScopeDefinition>();
const resumed = new WeakMap<HTMLElement, Record<string, Signal<unknown>>>();
/** Every currently-resumed scope root, mapped to the disposer for its effects and its `setup` return. */
const active = new Map<HTMLElement, () => void>();

/** Registers a scope's setup and action handlers, keyed to a `data-scope` name. @public */
export function registerScope<A extends string = string>(name: string, def: ScopeDefinition<A>): void {
  scopes.set(name, { ...def, on: def.on ?? {} } as ScopeDefinition);
}

/** One delegated-listener installation per document, refcounted by the live `resume()` calls holding it open. */
interface Delegation {
  remove: () => void;
  holders: number;
}

const delegated = new WeakMap<Document, Delegation>();

/** Installs the delegated listeners on `doc`, or takes a share of the ones already there. */
function delegate(doc: Document): Delegation {
  const existing = delegated.get(doc);
  if (existing) {
    existing.holders += 1;
    return existing;
  }
  const handlers: Array<[string, EventListener, boolean]> = [];
  for (const type of SCOPE_EVENTS) {
    const handler: EventListener = (event) => dispatch(type, event);
    doc.addEventListener(type, handler);
    handlers.push([type, handler, false]);
  }
  // The platform dispatches `command` with `bubbles:false`, so this must listen in the capture
  // phase — a bubble-phase delegated listener never sees it and every custom action goes dead.
  const commandHandler: EventListener = (event) => dispatchCommand(event);
  doc.addEventListener("command", commandHandler, { capture: true });
  handlers.push(["command", commandHandler, true]);

  const installed: Delegation = {
    holders: 1,
    remove: () => {
      for (const [type, handler, capture] of handlers) doc.removeEventListener(type, handler, capture);
      delegated.delete(doc);
    },
  };
  delegated.set(doc, installed);
  return installed;
}

/** Resumes every eager scope under `within` and returns a disposer for the scopes this call resumed. @public */
export function resume(within?: Node): () => void {
  const doc = ownerDocument(within);
  const delegation = delegate(doc);

  const mine: HTMLElement[] = [];
  const warnedUnknown = new Set<string>();
  for (const el of findScopes(scanRoot(within, doc))) {
    const name = el.dataset.scope ?? "";
    const def = scopes.get(name);
    if (!def) {
      if (!warnedUnknown.has(name)) {
        warnedUnknown.add(name);
        console.warn(
          `[resume] no scope registered for data-scope="${name}" — side-effect-import the client module that registers it (e.g. "ui/core/client") before calling resume().`,
        );
      }
      continue;
    }
    if (!def.eager) continue;
    // Contained per scope, so one throwing `setup` leaves every later scope resumable.
    try {
      if (!resumed.has(el)) mine.push(el);
      ensureResumed(el, def);
    } catch (error) {
      console.error(`[resume] scope "${name}" failed to set up; the rest of the page continues`, error);
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const root of mine) disposeScope(root);
    delegation.holders -= 1;
    if (delegation.holders > 0) return;
    // The last holder removes the listeners, so a lazily-resumed scope — in no call's `mine` — would
    // have no reachable disposer left.
    for (const root of [...active.keys()]) {
      if (ownerDocument(root) === doc) disposeScope(root);
    }
    delegation.remove();
  };
}

/** The tree the eager pass scans: a document fragment or document is honoured as the walk root, anything else scans the whole document. @internal */
export function scanRoot(within: Node | undefined, doc: Document): ParentNode {
  const nodeType = within?.nodeType;
  return nodeType === 11 || nodeType === 9 ? (within as unknown as ParentNode) : doc;
}

/** Every `[data-scope]` at or below `root`, descending into open shadow roots. @internal */
export function findScopes(root: ParentNode): HTMLElement[] {
  const found: HTMLElement[] = [];
  // Breadth-first over a growing list rather than recursion — a shadow root nested inside a shadow
  // root is just another tree to visit, at any depth.
  const trees: ParentNode[] = [root];
  for (let i = 0; i < trees.length; i += 1) {
    const tree = trees[i];
    if (!tree) continue;
    // `querySelectorAll` reports descendants only, so a walk root carrying `data-scope` itself has
    // to be checked separately.
    const self = tree as Partial<HTMLElement>;
    if (self.dataset?.scope !== undefined) found.push(tree as HTMLElement);
    // One native query rather than an `el.dataset.scope` per element, which materialises a
    // `DOMStringMap` for every node in the tree. The `*` walk survives only for shadow discovery.
    for (const el of tree.querySelectorAll<HTMLElement>("[data-scope]")) found.push(el);
    for (const el of tree.querySelectorAll<HTMLElement>("*")) {
      if (el.shadowRoot) trees.push(el.shadowRoot);
    }
  }
  return found;
}

/** Runs a scope's disposer and forgets that it was ever resumed. */
function disposeScope(root: HTMLElement): void {
  // Teardown is the one place a throw must not propagate: the loops above iterate every live scope,
  // and one failing disposer would silently skip the rest.
  try {
    active.get(root)?.();
  } catch (error) {
    console.error("[resume] scope disposer threw", error);
  }
  active.delete(root);
  // Forgetting is half the job: a root left in `resumed` is skipped as already-resumed on a later
  // resume, and comes back inert.
  resumed.delete(root);
}

/** Disposes every scope whose root has left its document. */
function sweepDetached(): void {
  // An htmx swap detaches a scope's markup with no notice, so nothing else would ever run those
  // disposers; sweeping as the replacement resumes bounds the collection to live scopes.
  for (const root of [...active.keys()]) {
    if (!root.isConnected) disposeScope(root);
  }
}

// htmx's per-element `cleanUpElement` hook, because `sweepDetached` runs only as something else
// resumes: a swap that removes scoped markup and introduces none would leak `active`'s listeners.
/** Disposes the scope at `el` and every scope below it, before the DOM removes them. @public */
export function disposeScopesIn(el: HTMLElement): void {
  // The same cast `scanRoot` makes: under the Workers consumer's lib set `HTMLElement.append` is
  // Cloudflare's, whose signature does not structurally satisfy `ParentNode`.
  for (const root of findScopes(el as unknown as ParentNode)) {
    if (active.has(root)) disposeScope(root);
  }
}

/** Hydrates a scope's state into signals and runs its `setup` exactly once. */
function ensureResumed(root: HTMLElement, def: ScopeDefinition): Record<string, Signal<unknown>> {
  sweepDetached();
  let state = resumed.get(root);
  if (!state) {
    const signals = hydrateState(root.dataset[ISLAND_STATE_KEY]);
    state = signals;
    resumed.set(root, signals);
    try {
      const owned = withOwner(() => def.setup?.({ root, state: signals }));
      const setupDispose = typeof owned.result === "function" ? owned.result : null;
      // Effects first: no reactive computation may still be alive while the author's teardown
      // mutates DOM or removes the listener that feeds it.
      active.set(root, () => {
        owned.dispose();
        setupDispose?.();
      });
    } catch (error) {
      // `resumed` is set before `setup` runs, so a throw would otherwise leave this root marked
      // resumed with no entry in `active` — unreachable by every disposer and inert on re-resume.
      resumed.delete(root);
      throw error;
    }
  }
  return state;
}

/** Resumes a single scope now and returns its signal state, or `undefined` when its `data-scope` names no registered scope. @public */
export function resumeScope(root: HTMLElement): Record<string, Signal<unknown>> | undefined {
  const def = scopes.get(root.dataset.scope ?? "");
  return def ? ensureResumed(root, def) : undefined;
}

/** Walks up from `el` through `[data-scope]` ancestors and invokes the first scope whose `on` table owns `action`, resuming it on the way. */
function runAction(action: string, el: HTMLElement, event: Event): void {
  // `closestAcross`, not `closest`: a trigger inside a shadow root would otherwise never find the
  // scope root that encloses its host.
  let scopeEl = closestAcross<HTMLElement>(el, "[data-scope]");
  while (scopeEl) {
    const def = scopes.get(scopeEl.dataset.scope ?? "");
    if (def) {
      const state = ensureResumed(scopeEl, def);
      const handler = def.on?.[action];
      if (handler) {
        handler({ root: scopeEl, el, state }, event);
        return;
      }
    }
    scopeEl = closestAcross<HTMLElement>(scopeEl.parentNode, "[data-scope]");
  }
}

function dispatch(type: string, event: Event): void {
  // `eventTarget`, not `event.target`: an event that crossed a shadow boundary reports the host.
  const el = closestAcross<HTMLElement>(eventTarget(event) as Node | null, `[data-on-${type}]`);
  if (!el) return;
  const action = el.getAttribute(`data-on-${type}`);
  if (!action) return;
  runAction(action, el, event);
}

/** Bridges a native `CommandEvent` to the scope handler table, routing only custom `--action` commands. */
function dispatchCommand(event: Event): void {
  const command = (event as CommandEvent).command;
  if (command?.slice(0, 2) !== "--") return;
  const source = (event as CommandEvent).source as HTMLElement | null;
  if (!source) return;
  runAction(command.slice(2), source, event);
}

/** Rebuilds `data-island-state` into signals, throwing unless the payload is a JSON object. @internal */
export function hydrateState(raw: string | undefined): Record<string, Signal<unknown>> {
  const out: Record<string, Signal<unknown>> = {};
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`[resume] ${ISLAND_STATE_ATTR} is not valid JSON: ${raw}`, { cause: error });
  }
  // `"5"` and `"null"` both parse cleanly and yield nothing, which is the same
  // silent-empty failure by another route.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`[resume] ${ISLAND_STATE_ATTR} must be a JSON object, got: ${raw}`);
  }
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    out[k] = createSignal(v);
  }
  return out;
}
