import { createApp, createErrorPage } from "../../../src/app/mod";
import { verifyTurnstile } from "../../../src/form/mod";
import { checkCrossOriginProtection, crossOriginProtection, originGuard, originProtection, rateLimit } from "../../../src/security/mod";
import { mapHandler } from "../../../src/testing/mod";

const APP_ORIGIN = "https://app.example";
const TESTING_SECRET = "1x0000000000000000000000000000000AA";

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
    const status = async (app: ReturnType<typeof createApp>, init: RequestInit) => (await app.request("/", init, env)).status;
    const fromPreview = post({ Origin: String(env.PREVIEW_ORIGIN) });
    const token = new FormData();
    token.append("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");

    return Response.json({
      rateLimit: await status(guarded(rateLimit({ limiter: () => undefined })), post()),
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
