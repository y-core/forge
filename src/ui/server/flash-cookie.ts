import type { RequestContext } from "@remix-run/fetch-router";
import { setPendingHeader } from "../../context/pending-headers";
import { createSignedCookie } from "../../session/signed";
import type { FlashMessage, FlashType } from "./flash";

export interface FlashCookieOptions {
  secrets: [string, ...string[]];
  name?: string;
  path?: string;
  maxAge?: number;
  sameSite?: "Strict" | "Lax";
}

export interface Flasher {
  // biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant for cookie operations
  set(c: RequestContext<any, any>, messages: FlashMessage[]): Promise<void>;
  // biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
  get(c: RequestContext<any, any>): Promise<FlashMessage[]>;
  // biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
  success(c: RequestContext<any, any>, text: string): Promise<void>;
  // biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
  info(c: RequestContext<any, any>, text: string): Promise<void>;
  // biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
  warning(c: RequestContext<any, any>, text: string): Promise<void>;
  // biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
  error(c: RequestContext<any, any>, text: string): Promise<void>;
}

export function createFlash(options: FlashCookieOptions): Flasher {
  const name = options.name ?? "flash";
  const path = options.path ?? "/";
  const maxAge = options.maxAge ?? 60;
  const sameSite = options.sameSite ?? "Lax";

  const cookie = createSignedCookie(name, { secrets: options.secrets, path, maxAge, sameSite });

  // biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
  async function set(c: RequestContext<any, any>, messages: FlashMessage[]): Promise<void> {
    const serialized = await cookie.serialize(JSON.stringify(messages));
    setPendingHeader(c, "set-cookie", serialized, { append: true });
  }

  // biome-ignore lint/suspicious/noExplicitAny: bindings irrelevant
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
    return (c: RequestContext<any, any>, text: string) => set(c, [{ type, text }]);
  }

  return { set, get, success: convenience("success"), info: convenience("info"), warning: convenience("warning"), error: convenience("error") };
}
