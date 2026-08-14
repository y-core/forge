import { contextVar } from "../context/accessor";

const CSRF_FIELD_KEY = "csrfField";

/** Typed accessor for the form field `csrfProtection` took this request's token from. @public */
export const csrfFieldCtx = contextVar<string>(CSRF_FIELD_KEY);
