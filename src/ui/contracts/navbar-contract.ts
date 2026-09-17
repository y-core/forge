/** Resumable-scope name `Navbar` stamps and the chrome client scope registers. Eager. @public */
export const NAVBAR_SCOPE = "navbar";

// Any script on the page can dispatch this, and that is not a hole: `filters` decides which of the
// already-delivered items are painted, never what a viewer may reach. Route guards do that.
/** Document event the navbar scope listens for to re-sync its visibility filters. @public */
export const NAVBAR_FILTERS_EVENT = "navbar:filters";

/** Attribute a `collapsedAs="drawer"` bar stamps on its disclosure, so the client scope finds it. @public */
export const NAVBAR_DRAWER_ATTR = "data-navbar-drawer";
