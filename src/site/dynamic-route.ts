const DYNAMIC_ROUTE = /[:*{}()?\\]/;

/** Whether a route source carries pattern syntax, so it names a family of URLs rather than one. @internal */
export function isDynamicRoute(source: string): boolean {
  return DYNAMIC_ROUTE.test(source);
}
