// Every production site that consults a `#relax` module, reached through its barrel and used, so nothing is tree-shaken away.
import { createApp, createErrorPage } from "../../../src/app/mod";
import { verifyTurnstile } from "../../../src/form/mod";
import { crossOriginProtection, deriveAllowedOrigins, originGuard, originProtection, parseUrl, rateLimit } from "../../../src/security/mod";

const app = createApp({
  onError: createErrorPage(),
  middleware: (forge) => {
    forge.use(
      "*",
      crossOriginProtection(),
      originProtection({ allowedOrigins: ["https://example.com"] }),
      originGuard(["https://example.com"]),
      rateLimit({ limiter: () => undefined, trustCfHeaders: true }),
    );
  },
});

export default {
  fetch: async (request: Request, env: Record<string, unknown>, ctx: ExecutionContext): Promise<Response> => {
    const origins = deriveAllowedOrigins(parseUrl(request.url));
    const verdict = await verifyTurnstile(await request.formData(), "secret", { expectedHostname: origins[0] ?? "" });
    return verdict.ok ? app.fetch(request, env, ctx) : new Response(null, { status: 403 });
  },
};
