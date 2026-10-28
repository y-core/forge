import { ISLAND_STATE_ATTR, ISLAND_STATE_KEY } from "../contracts/island-contract";
import { SCOPE_EVENTS } from "../contracts/scope-events";
import { isDisabled } from "./composite";
import { asElement, closestAcross, eventTarget, ownerDocument, queryTrees, shadowTrees } from "./dom";
import { createSignal, withOwner } from "./signal";
import type { Signal } from "./types";
import type { ScopeDefinition } from "./types";

const scopes = new Map<string, ScopeDefinition>();
const resumed = new WeakMap<HTMLElement, Record<string, Signal<unknown>>>();
const active = new Map<HTMLElement, () => void>();

/** Registers a scope's setup and action handlers, keyed to a `data-scope` name. @public */
export function registerScope<A extends string = string>(name: string, def: ScopeDefinition<A>): void {
  scopes.set(name, { ...def, on: def.on ?? {} } as ScopeDefinition);
}

type ScopeTree = Element | Document | DocumentFragment;

interface Delegation {
  remove: () => void;
  listenIn: (trees: readonly ScopeTree[]) => void;
  holders: number;
}

const delegated = new WeakMap<Document, Delegation>();

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
  const commanded = new WeakSet<Event>();
  // Chromium flags a shadow-tree `command` composed yet never delivers it to the document, so only
  // the event's identity can say whether another listener already ran it.
  const commandHandler: EventListener = (event) => {
    if (commanded.has(event)) return;
    commanded.add(event);
    dispatchCommand(event);
  };
  // The platform dispatches `command` with `bubbles:false`, so this must listen in the capture
  // phase — a bubble-phase delegated listener never sees it and every custom action goes dead.
  doc.addEventListener("command", commandHandler, { capture: true });
  handlers.push(["command", commandHandler, true]);
  // `aria-disabled` is advisory: the platform still submits, navigates and fires `command` on click,
  // and Enter or Space reach the same click, so it is cancelled before any of them sees it.
  const inertGuard: EventListener = (event) => cancelInertClick(event);
  doc.addEventListener("click", inertGuard, { capture: true });
  handlers.push(["click", inertGuard, true]);

  const lifetime = new AbortController();
  const listened = new WeakSet<ScopeTree>();
  const listenIn = (trees: readonly ScopeTree[]) => {
    for (const tree of trees) {
      if (tree.nodeType !== 11 || listened.has(tree)) continue;
      listened.add(tree);
      for (const type of SCOPE_EVENTS) {
        tree.addEventListener(
          type,
          (event) => {
            if (!event.composed) dispatch(type, event);
          },
          { signal: lifetime.signal },
        );
      }
      tree.addEventListener("command", commandHandler, { capture: true, signal: lifetime.signal });
    }
  };

  const installed: Delegation = {
    holders: 1,
    listenIn,
    remove: () => {
      for (const [type, handler, capture] of handlers) doc.removeEventListener(type, handler, capture);
      lifetime.abort();
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
  const walkRoot = scanRoot(within, doc);
  const trees = shadowTrees(walkRoot as ScopeTree);
  delegation.listenIn(trees);
  sweepDetachedScopes();
  for (const el of findScopes(walkRoot, trees)) {
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
export function findScopes(root: ParentNode, trees: readonly ScopeTree[] = shadowTrees(root as ScopeTree)): HTMLElement[] {
  const self = (root as Partial<HTMLElement>).dataset?.scope !== undefined ? [root as HTMLElement] : [];
  return [...self, ...queryTrees<HTMLElement>(trees, "[data-scope]")];
}

function disposeScope(root: HTMLElement): void {
  try {
    active.get(root)?.();
  } catch (error) {
    console.error("[resume] scope disposer threw", error);
  }
  active.delete(root);
  resumed.delete(root);
}

/** Disposes every scope whose root has left its document. @internal */
export function sweepDetachedScopes(): void {
  for (const root of [...active.keys()]) {
    if (!root.isConnected) disposeScope(root);
  }
}

/** Disposes the scope at `el` and every scope below it, before the DOM removes them. @public */
export function disposeScopesIn(el: HTMLElement): void {
  // The same cast `scanRoot` makes: under the Workers consumer's lib set `HTMLElement.append` is
  // Cloudflare's, whose signature does not structurally satisfy `ParentNode`.
  for (const root of findScopes(el as unknown as ParentNode)) {
    if (active.has(root)) disposeScope(root);
  }
}

function ensureResumed(root: HTMLElement, def: ScopeDefinition): Record<string, Signal<unknown>> {
  let state = resumed.get(root);
  if (!state) {
    const signals = hydrateState(root.dataset[ISLAND_STATE_KEY]);
    state = signals;
    resumed.set(root, signals);
    const lifetime = new AbortController();
    try {
      const owned = withOwner(() => def.setup?.({ root, state: signals, signal: lifetime.signal }));
      const setupDispose = typeof owned.result === "function" ? owned.result : null;
      active.set(root, () => {
        owned.dispose();
        lifetime.abort();
        setupDispose?.();
      });
    } catch (error) {
      lifetime.abort();
      resumed.delete(root);
      throw error;
    }
  }
  return state;
}

/** Resumes a single scope now and returns its signal state, or `undefined` when its `data-scope` names no registered scope. @public */
export function resumeScope(root: HTMLElement): Record<string, Signal<unknown>> | undefined {
  const def = scopes.get(root.dataset.scope ?? "");
  return def ? resumeOnDemand(root, def) : undefined;
}

function resumeOnDemand(root: HTMLElement, def: ScopeDefinition): Record<string, Signal<unknown>> {
  if (!resumed.has(root)) sweepDetachedScopes();
  return ensureResumed(root, def);
}

function runAction(action: string, el: HTMLElement, event: Event, from: Node | null = el): void {
  if (isDisabled(el)) return;
  // `closestAcross`, not `closest`: a trigger inside a shadow root would otherwise never find the
  // scope root that encloses its host.
  let scopeEl = closestAcross<HTMLElement>(from, "[data-scope]");
  while (scopeEl) {
    const def = scopes.get(scopeEl.dataset.scope ?? "");
    if (def) {
      const state = resumeOnDemand(scopeEl, def);
      const handler = def.on?.[action];
      if (handler) {
        handler({ root: scopeEl, el, state }, event);
        return;
      }
    }
    scopeEl = closestAcross<HTMLElement>(scopeEl.parentNode, "[data-scope]");
  }
}

function cancelInertClick(event: Event): void {
  if (!closestAcross(eventTarget(event) as Node | null, '[aria-disabled="true"]')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function dispatch(type: string, event: Event): void {
  // `eventTarget`, not `event.target`: an event that crossed a shadow boundary reports the host.
  const el = closestAcross<HTMLElement>(eventTarget(event) as Node | null, `[data-on-${type}]`);
  if (!el) return;
  const action = el.getAttribute(`data-on-${type}`);
  if (!action) return;
  runAction(action, el, event);
}

function dispatchCommand(event: Event): void {
  const command = (event as CommandEvent).command;
  if (command?.slice(0, 2) !== "--") return;
  const source = (event as CommandEvent).source as HTMLElement | null;
  if (!source) return;
  runAction(command.slice(2), source, event, asElement(eventTarget(event)));
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
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`[resume] ${ISLAND_STATE_ATTR} must be a JSON object, got: ${raw}`);
  }
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    out[k] = createSignal(v);
  }
  return out;
}
