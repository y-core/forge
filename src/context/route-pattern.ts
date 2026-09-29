import { contextVar } from "./accessor";

/** Source of the route pattern the request dispatched to, unset when no route matched. @public */
export const matchedRoutePattern = contextVar<string>("routePattern");
