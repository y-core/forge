import { contextVar } from "../context/accessor";

const CSRF_FIELD_KEY = "csrfField";
const CSRF_HEADER_KEY = "csrfHeader";

/** Typed accessor for the form field `csrfProtection` took this request's token from. @public */
export const csrfFieldCtx = contextVar<string>(CSRF_FIELD_KEY);
/** Typed accessor for the header name `csrfProtection` checks this request's token on. @public */
export const csrfHeaderCtx = contextVar<string>(CSRF_HEADER_KEY);
