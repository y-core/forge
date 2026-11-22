import { contextVar } from "./accessor";

/** Source of the matched route's pattern, set before the first `app.use` middleware runs; unset when no route matches the URL and method. @public */
export const matchedRoutePattern = contextVar<string>("routePattern");
