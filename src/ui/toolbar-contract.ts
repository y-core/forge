/**
 * Shared Toolbar wiring — imported by BOTH the SSR `<Toolbar>` component (`ui/core`) and the client
 * scope that mounts its roving focus (`ui/core/client.ts`). Pure data, side-effect-free: safe to
 * import into either bundle. Internal: not part of the package's public export surface (like
 * `scope-events.ts` and `turnstile-contract.ts`).
 *
 * The two halves run in different bundles and cannot see each other, so a selector written twice
 * would drift silently — the toolbar would simply stop being one tab stop, with nothing to fail.
 */

/** Resumable-scope name the Toolbar root stamps and the client scope registers. */
export const TOOLBAR_SCOPE = "toolbar";

/**
 * Marks an element as a roving-focus stop. Stamped by `Toolbar.Button`, `Toolbar.Link` and
 * `Toolbar.Input`; a `ToggleGroup.Item` nested inside a toolbar opts in by carrying it too.
 *
 * An explicit marker rather than a `[data-slot^='toolbar-']` prefix match: `Toolbar.Group` and
 * `Toolbar.Separator` are toolbar slots and must *not* be focus stops, and a prefix selector cannot
 * express that without listing the exceptions.
 */
export const TOOLBAR_ITEM_ATTR = "data-toolbar-item";

/** Selector form of {@link TOOLBAR_ITEM_ATTR}, for the composite controller. */
export const TOOLBAR_ITEM_SELECTOR = `[${TOOLBAR_ITEM_ATTR}]`;
