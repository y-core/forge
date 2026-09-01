import type { RequestContext } from "@remix-run/fetch-router";

import { setPendingHeader } from "../../context/pending-headers";
import { createSignedCookie } from "../../session/signed";
import type { FlashMessage, FlashType } from "./flash";

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

/** Creates a `Flasher` backed by a signed cookie cleared on read. @public */
export function createFlash(options: FlashCookieOptions): Flasher {
  const name = options.name ?? "flash";
  const path = options.path ?? "/";
  const maxAge = options.maxAge ?? 60;
  const sameSite = options.sameSite ?? "Lax";

  const cookie = createSignedCookie(name, { secrets: options.secrets, path, maxAge, sameSite });

  // oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
  async function set(c: RequestContext<any, any>, messages: FlashMessage[]): Promise<void> {
    const serialized = await cookie.serialize(JSON.stringify(messages));
    setPendingHeader(c, "set-cookie", serialized, { append: true });
  }

  // oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
  async function get(c: RequestContext<any, any>): Promise<FlashMessage[]> {
    const raw = await cookie.parse(c.request.headers.get("cookie") ?? null);
    if (raw == null) return [];
    const clearCookie = await cookie.serialize("", { maxAge: 0, path });
    setPendingHeader(c, "set-cookie", clearCookie, { append: true });
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as FlashMessage[]) : [];
    } catch {
      return [];
    }
  }

  function convenience(type: FlashType) {
    // oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
    return (c: RequestContext<any, any>, text: string) => set(c, [{ type, text }]);
  }

  return { set, get, success: convenience("success"), info: convenience("info"), warning: convenience("warning"), error: convenience("error") };
}
