import type { RequestContext } from "@remix-run/fetch-router";

import { contextVar } from "../../context/accessor";
import { pendingCookieValue, replacePendingCookie } from "../../context/pending-headers";
import { getAppContext } from "../../context/types";
import type { KeyRing } from "../../crypto/keyring/types";
import { createSignedCookie } from "../../session/cookie";
import type { SignedCookie } from "../../session/types";
import type { FlashMessage, FlashType } from "./types";
import type { FlashCookieOptions, Flasher } from "./types";

const flashQueue = contextVar<Promise<unknown>>("__flashQueue");

// oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
function inTurn<T>(c: RequestContext<any, any>, step: () => Promise<T>): Promise<T> {
  const run = (flashQueue.getOptional(c) ?? Promise.resolve()).then(step);
  flashQueue.set(
    c,
    run.catch(() => undefined),
  );
  return run;
}

/** Creates a `Flasher` backed by a signed cookie cleared on read. @public */
export function createFlash<Bindings = Record<string, unknown>>(options: FlashCookieOptions<Bindings>): Flasher {
  const name = options.name ?? "flash";
  const path = options.path ?? "/";
  const maxAge = options.maxAge ?? 60;
  const sameSite = options.sameSite ?? "Lax";

  const cookies = new WeakMap<KeyRing, SignedCookie>();

  // oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
  async function cookieFor(c: RequestContext<any, any>): Promise<SignedCookie> {
    const ring = await options.ring(getAppContext<Bindings>(c));
    const known = cookies.get(ring);
    if (known !== undefined) return known;
    const cookie = createSignedCookie(name, { ring, path, maxAge, sameSite });
    cookies.set(ring, cookie);
    return cookie;
  }

  function parseMessages(raw: string | null): FlashMessage[] {
    if (raw === null) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as FlashMessage[]) : [];
    } catch {
      return [];
    }
  }

  // oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
  function set(c: RequestContext<any, any>, messages: FlashMessage[]): Promise<void> {
    return inTurn(c, async () => {
      const cookie = await cookieFor(c);
      const queued = pendingCookieValue(c, name);
      const earlier = queued === null ? [] : parseMessages((await cookie.read(`${name}=${queued}`))?.value ?? null);
      let kept = [...earlier, ...messages];
      for (;;) {
        try {
          replacePendingCookie(c, await cookie.serialize(JSON.stringify(kept)));
          return;
        } catch (error) {
          if (kept.length <= 1) throw error;
          kept = kept.slice(1);
        }
      }
    });
  }

  // oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
  async function get(c: RequestContext<any, any>): Promise<FlashMessage[]> {
    const cookie = await cookieFor(c);
    const reading = await cookie.read(c.request.headers.get("cookie") ?? null);
    // The clear is keyed on the cookie being present, not on its value verifying: one past its expiry
    // reads as `null`, and leaving it uncleared means the browser re-sends and re-fails it forever.
    if (reading === null) return [];
    const clearCookie = await cookie.serialize("", { maxAge: 0, path });
    if (pendingCookieValue(c, name) === null) replacePendingCookie(c, clearCookie);
    return parseMessages(reading.value);
  }

  function convenience(type: FlashType) {
    // oxlint-disable-next-line typescript/no-explicit-any -- bindings irrelevant
    return (c: RequestContext<any, any>, text: string) => set(c, [{ type, text }]);
  }

  return { set, get, success: convenience("success"), info: convenience("info"), warning: convenience("warning"), error: convenience("error") };
}
