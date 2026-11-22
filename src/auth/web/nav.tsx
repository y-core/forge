/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { csrfMinterCtx, mintCsrf } from "../../form/csrf";
import type { JSXNode } from "../../render/jsx/types";
import type { NavState } from "../../ui/chrome/types";
import { Button } from "../../ui/core/button";
import { authCtx } from "./identity";
import type { AuthNavContext, AuthNavOptions } from "./types";
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

/** The sign-out link for a page no CSRF policy covers: a GET to the confirm page, which mints the token the POST needs. */
function signoutLink(href: string, inMenu: boolean, props: AuthNavOptions["signout"]): JSXNode {
  return (
    <Button
      asChild
      tone={props?.tone ?? "neutral"}
      appearance={props?.appearance ?? "ghost"}
      size={props?.size ?? "sm"}
      class={props?.class ?? "w-full justify-start"}>
      <a href={href} role={(props?.menuitem ?? inMenu) ? "menuitem" : undefined} data-ref='signout'>
        {props?.label ?? "Sign out"}
      </a>
    </Button>
  );
}

// The identity and not the session decides: a session is on every request, so minting off it would
// sign a token on every anonymous page render too.
/** The `activeFilters` and `slots` a `Navbar` needs to show this request's viewer their own destinations. @public */
export function authNav(options: AuthNavOptions): (context: AuthNavContext) => Promise<NavState> {
  const slotKey = options.slot ?? AUTH_NAV_SIGNOUT_SLOT;

  return async (context: AuthNavContext): Promise<NavState> => {
    const activeFilters = navFilters(context);
    if (authCtx.getOptional(context) === undefined) return { activeFilters, slots: {} };

    if (csrfMinterCtx.getOptional(context) === undefined) {
      return { activeFilters, slots: { [slotKey]: ({ inMenu }) => signoutLink(options.signoutPath, inMenu, options.signout) } };
    }

    const csrfToken = await mintCsrf(context, options.signoutPath);
    return {
      activeFilters,
      slots: {
        [slotKey]: ({ inMenu }) => (
          <AuthSignout
            action={options.signoutPath}
            appearance='ghost'
            class='w-full justify-start'
            csrfToken={csrfToken}
            menuitem={inMenu}
            size='sm'
            {...options.signout}
          />
        ),
      },
    };
  };
}
