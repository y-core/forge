/** The methods RFC 9110 §9.2.1 defines as safe. @internal */
export const SAFE_HTTP_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

/** True when `method`, in any case, is one of {@link SAFE_HTTP_METHODS}. @internal */
export function isSafeHttpMethod(method: string): boolean {
  return SAFE_HTTP_METHODS.has(method.toUpperCase());
}
