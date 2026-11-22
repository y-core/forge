import { setPendingHeader } from "../../context/pending-headers";
import type { AppContext } from "../../context/types";
import { COOKIE_ATTRIBUTES_DEFAULT, createUnsignedCookie } from "../../http/cookie";

const SITE_DATA_OWED_MAX_AGE_SECONDS = 300;

const SITE_DATA_OWED = "1";

// Unsigned on purpose: a forged mark can only make a same-origin page clear its own storage, and the
// `__Host-` prefix keeps a subdomain from planting one.
const siteDataOwedCookie = createUnsignedCookie("__Host-auth-site-data-owed", {
  ...COOKIE_ATTRIBUTES_DEFAULT,
  maxAge: SITE_DATA_OWED_MAX_AGE_SECONDS,
});

/** Whether this request carries the mark a sign-out that destroyed its session left for the storage clear it owes. @internal */
export async function hasSiteDataOwedCookie<Bindings>(c: AppContext<Bindings>): Promise<boolean> {
  return (await siteDataOwedCookie.parse(c.request.headers.get("cookie"))) === SITE_DATA_OWED;
}

/** Queues the mark that carries a destroyed session's owed storage clear to the next auth page. @internal */
export async function markSiteDataOwedCookie<Bindings>(c: AppContext<Bindings>): Promise<void> {
  setPendingHeader(c, "set-cookie", await siteDataOwedCookie.serialize(SITE_DATA_OWED), { append: true });
}

/** Queues removal of the owed-storage mark. @internal */
export async function clearSiteDataOwedCookie<Bindings>(c: AppContext<Bindings>): Promise<void> {
  setPendingHeader(c, "set-cookie", await siteDataOwedCookie.serialize("", { maxAge: 0 }), { append: true });
}
