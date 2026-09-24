import type { RequestContext } from "@remix-run/fetch-router";

/** Options for `createFlash`. @public */
export interface FlashCookieOptions {
  secrets: [string, ...string[]];
  name?: string;
  path?: string;
  maxAge?: number;
  sameSite?: "Strict" | "Lax";
}

/** Reads and writes flash messages on a signed, single-read cookie. @public */
export interface Flasher {
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant for cookie operations
  set(c: RequestContext<any, any>, messages: FlashMessage[]): Promise<void>;
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
  get(c: RequestContext<any, any>): Promise<FlashMessage[]>;
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
  success(c: RequestContext<any, any>, text: string): Promise<void>;
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
  info(c: RequestContext<any, any>, text: string): Promise<void>;
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
  warning(c: RequestContext<any, any>, text: string): Promise<void>;
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
  error(c: RequestContext<any, any>, text: string): Promise<void>;
}

/** The severity of a flash message. @public */
export type FlashType = "success" | "info" | "warning" | "error";

/** One flash message carried across a redirect. @public */
export interface FlashMessage {
  type: FlashType;
  text: string;
  title?: string;
}

/** Props for {@link Resumable}. `children` is injected by `FC`. @public */
export interface ResumableProps {
  /** The scope's registered name — must match the client-side `registerScope`. */
  name: string;
  /** Optional element id on the scope root, so it can serve as a `commandfor` sink. */
  id?: string | undefined;
  /** Serializable initial state, rehydrated into signals on first interaction. */
  state?: Record<string, unknown> | undefined;
  /** Handle the scope's own setup addresses the root by, mapped to `data-ref`. */
  ref?: string | undefined;
  /** Classes for the scope root, which is a real box in its parent's layout. */
  class?: string | undefined;
}
