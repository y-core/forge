/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { csrfMinter } from "../../form/csrf";
import { sessionCtx } from "../../session/session";
import { authCtx } from "./identity";
import type { AuthNav, AuthNavContext, AuthNavOptions } from "./types";
import { AuthSignout } from "./views/signout";

/** The tokens a navbar item lists in `filters` to say who it is for. @public */
export const AUTH_NAV_FILTERS = { anonymous: "anonymous", signedIn: "signedIn", admin: "admin" } as const;

/** The key a `NavSlot` names to take the sign-out control. @public */
export const AUTH_NAV_SIGNOUT_SLOT = "signout";

// An administrator holds both tokens: the ordinary signed-in destinations are theirs too.
/** The tokens this request's viewer holds. */
function navFilters(context: AuthNavContext): string[] {
  const identity = authCtx.getOptional(context);
  if (identity === undefined) return [AUTH_NAV_FILTERS.anonymous];
  return identity.isAdmin ? [AUTH_NAV_FILTERS.signedIn, AUTH_NAV_FILTERS.admin] : [AUTH_NAV_FILTERS.signedIn];
}

// The identity and not the session decides: a session is on every request, so minting off it would
// sign a token on every anonymous page render too.
/** The `activeFilters` and `slots` a `Navbar` needs to show this request's viewer their own destinations. @public */
export function authNav(options: AuthNavOptions): (context: AuthNavContext) => Promise<AuthNav> {
  const slotKey = options.slot ?? AUTH_NAV_SIGNOUT_SLOT;
  const mint = csrfMinter({ secret: options.secret, subject: (context) => sessionCtx.getOptional(context)?.id });

  return async (context: AuthNavContext): Promise<AuthNav> => {
    const activeFilters = navFilters(context);
    if (authCtx.getOptional(context) === undefined) return { activeFilters, slots: {} };

    const csrfToken = await mint(context, options.signoutPath);
    return {
      activeFilters,
      slots: {
        [slotKey]: (
          <AuthSignout
            action={options.signoutPath}
            appearance='ghost'
            class='w-full justify-start'
            csrfToken={csrfToken}
            menuitem
            size='sm'
            {...options.signout}
          />
        ),
      },
    };
  };
}
