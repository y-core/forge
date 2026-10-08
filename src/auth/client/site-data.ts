import { ownerWindow } from "../../ui/client/dom";
import { SITE_DATA_CSRF_HEADER_ATTR, SITE_DATA_PATH_ATTR, SITE_DATA_TOKEN_ATTR } from "../site-data-contract";

/** Posts the storage clear a scope root declares, once and without waiting on it; a root missing an attribute posts nothing. @internal */
export function mountSiteData(root: HTMLElement): void {
  const path = root.getAttribute(SITE_DATA_PATH_ATTR);
  const token = root.getAttribute(SITE_DATA_TOKEN_ATTR);
  const header = root.getAttribute(SITE_DATA_CSRF_HEADER_ATTR);
  if (path === null || token === null || header === null) return;
  void ownerWindow(root)
    .fetch(path, { method: "POST", keepalive: true, headers: { [header]: token } })
    .catch(() => {});
}
