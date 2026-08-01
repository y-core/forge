/**
 * Shared Tabs wiring — imported by BOTH the SSR `<Tabs>` component (`ui/core`) and the client scope
 * that mounts its keyboard behaviour (`ui/core/client.ts`). Pure data, side-effect-free. Internal:
 * not part of the package's public export surface.
 */

export const TABS_SCOPE = "tabs";

export const TAB_SELECTOR = "[role='tab']";

export const TABLIST_SELECTOR = "[role='tablist']";
