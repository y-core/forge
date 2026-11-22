import { createApp, createErrorPage } from "../../../src/app/mod";
import type { Forge } from "../../../src/app/mod";
import { verifyTurnstile } from "../../../src/form/mod";
import { TURNSTILE_TEST_KEYS } from "../../../src/form/turnstile-keys";
import { checkCrossOriginProtection, crossOriginProtection, originGuard, originProtection, rateLimit } from "../../../src/security/mod";
import { mapHandler } from "../../../src/testing/mod";

const APP_ORIGIN = "https://app.example";
const TESTING_SECRET = TURNSTILE_TEST_KEYS.secret.pass;

function guarded(middleware: ReturnType<typeof crossOriginProtection>) {
  return createApp({
    middleware: (forge) => forge.use("*", middleware),
    routes: (forge) => mapHandler(forge, "ANY", "/", () => new Response("ok")),
  });
}

function throwing(onError?: ReturnType<typeof createErrorPage>) {
  return createApp({
    ...(onError === undefined ? {} : { onError }),
    routes: (forge) =>
      mapHandler(forge, "GET", "/", () => {
        throw new Error("refused");
      }),
  });
}

export default {
  fetch: async (_request: Request, env: Record<string, unknown>): Promise<Response> => {
    const post = (headers: Record<string, string> = {}): RequestInit => ({ method: "POST", headers });
    const status = async (app: Forge, init: RequestInit) => (await app.request("/", init, env)).status;
    const fromPreview = post({ Origin: String(env.PREVIEW_ORIGIN) });
    const token = new FormData();
    token.append("cf-turnstile-response", TURNSTILE_TEST_KEYS.token);

    return Response.json({
      rateLimit: await status(guarded(rateLimit({ binding: "LIMITER" })), post()),
      checkCrossOriginProtection: checkCrossOriginProtection(new Request(APP_ORIGIN, post())).ok,
      crossOriginProtection: await status(guarded(crossOriginProtection()), post()),
      originGuard: await status(guarded(originGuard([APP_ORIGIN])), fromPreview),
      originProtection: await status(guarded(originProtection({ allowedOrigins: [APP_ORIGIN] })), fromPreview),
      verifyTurnstile: (await verifyTurnstile(token, TESTING_SECRET, { expectedHostname: new URL(APP_ORIGIN).hostname })).ok,
      createErrorPage: await (await throwing(createErrorPage()).request("/", {}, env)).text(),
      fallback: await (await throwing().request("/", {}, env)).text(),
    });
  },
};
