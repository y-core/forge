import { contextVar } from "../context/accessor";

const CSRF_FIELD_KEY = "csrfField";

/**
 * Typed accessor for the form field `csrfProtection` took this request's token from.
 *
 * It lives apart from the guard deliberately. A route builder needs only the name of the field the
 * guard already consumed, and importing that from `csrf.ts` would pull the token implementation —
 * and the Web Crypto work behind it — into the module graph of every route that reads it.
 *
 * Absent when no CSRF guard ran, which is the honest answer: nothing consumed the field, so nothing
 * about the request says it should be treated as consumed. @public
 */
export const csrfFieldCtx = contextVar<string>(CSRF_FIELD_KEY);
