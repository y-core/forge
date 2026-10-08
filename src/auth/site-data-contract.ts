/** `data-scope` an auth page stamps while its session owes the storage half of a sign-out's `Clear-Site-Data`. @public */
export const SITE_DATA_SCOPE = "auth-site-data";

/** Endpoint the scope posts to, supplied by `authPaths`. @public */
export const SITE_DATA_PATH_ATTR = "data-site-data-path";

/** CSRF token minted for `SITE_DATA_PATH_ATTR`, and valid at no other path. @public */
export const SITE_DATA_TOKEN_ATTR = "data-site-data-token";

/** Header the token is sent on, as the app's `csrfProtection` names it. @public */
export const SITE_DATA_CSRF_HEADER_ATTR = "data-site-data-csrf-header";
