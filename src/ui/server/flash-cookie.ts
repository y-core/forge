import type { Context } from "hono";
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
  set(c: Context, messages: FlashMessage[]): Promise<void>;
  get(c: Context): Promise<FlashMessage[]>;
  success(c: Context, text: string): Promise<void>;
  info(c: Context, text: string): Promise<void>;
  warning(c: Context, text: string): Promise<void>;
  error(c: Context, text: string): Promise<void>;
}

export function createFlash(options: FlashCookieOptions): Flasher {
  const name = options.name ?? "flash";
  const path = options.path ?? "/";
  const maxAge = options.maxAge ?? 60;
  const sameSite = options.sameSite ?? "Lax";

  const cookie = createSignedCookie(name, { secrets: options.secrets, path, maxAge, sameSite });

  async function set(c: Context, messages: FlashMessage[]): Promise<void> {
    c.header("set-cookie", await cookie.serialize(JSON.stringify(messages)), { append: true });
  }

  async function get(c: Context): Promise<FlashMessage[]> {
    const raw = await cookie.parse(c.req.header("cookie") ?? null);
    if (raw == null) return [];
    c.header("set-cookie", await cookie.serialize("", { maxAge: 0, path }), { append: true });
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as FlashMessage[]) : [];
    } catch {
      return [];
    }
  }

  function convenience(type: FlashType) {
    return (c: Context, text: string) => set(c, [{ type, text }]);
  }

  return {
    set,
    get,
    success: convenience("success"),
    info: convenience("info"),
    warning: convenience("warning"),
    error: convenience("error"),
  };
}
