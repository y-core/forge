/** `Set-Cookie` attributes, as defaults at construction or as a per-call override on `serialize`. @public */
export interface CookieAttributes {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  partitioned?: boolean;
  path?: string;
  sameSite?: "Strict" | "Lax" | "None";
  secure?: boolean;
}

/** A cookie whose value is carried verbatim, base64-encoded but unauthenticated. @public */
export interface UnsignedCookie {
  readonly name: string;
  /** Reads this cookie's value out of a `Cookie` header, answering `null` when it is absent or malformed; never throws. */
  parse(header: string | null): Promise<string | null>;
  /** Builds the `Set-Cookie` header value, merging `attributes` over the construction-time defaults. */
  serialize(value: string, attributes?: CookieAttributes): Promise<string>;
}

/** Options for `createUnsignedCookie`. @public */
export interface UnsignedCookieOptions extends CookieAttributes {}

/** Every cookie attribute resolved to the one value a call settled on, `undefined` where neither side named it. @internal */
export type ResolvedAttributes = { [field in keyof Required<CookieAttributes>]: CookieAttributes[field] | undefined };
