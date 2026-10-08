/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import type { FC } from "../../../render/jsx/types";
import { SITE_DATA_CSRF_HEADER_ATTR, SITE_DATA_PATH_ATTR, SITE_DATA_SCOPE, SITE_DATA_TOKEN_ATTR } from "../../site-data-contract";
import type { AuthSiteDataProps } from "./types";

/** The inert element that has `@y-core/forge/auth/client` post the storage clear a sign-out left owing. @public */
export const AuthSiteData: FC<AuthSiteDataProps> = ({ path, csrfToken, csrfHeader }) => (
  <div
    hidden
    data-scope={SITE_DATA_SCOPE}
    {...{ [SITE_DATA_PATH_ATTR]: path, [SITE_DATA_TOKEN_ATTR]: csrfToken, [SITE_DATA_CSRF_HEADER_ATTR]: csrfHeader }}
  />
);
