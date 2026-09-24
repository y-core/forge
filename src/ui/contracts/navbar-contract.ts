/** Resumable-scope name `Navbar` stamps and the chrome client scope registers. Eager. @public */
export const NAVBAR_SCOPE = "navbar";

// Any script on the page can dispatch this, and that is not a hole: `filters` decides which of the
// already-delivered items are painted, never what a viewer may reach. Route guards do that.
/** Event the navbar scope applies: dispatched on `document` it reaches every bar, on or inside one bar only that bar. @public */
export const NAVBAR_FILTERS_EVENT = "navbar:filters";

/** Attribute a `collapsedAs="drawer"` bar stamps on its disclosure, so the client scope finds it. @public */
export const NAVBAR_DRAWER_ATTR = "data-navbar-drawer";
