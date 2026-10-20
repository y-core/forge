import { admitsMissingFetchMetadata } from "#relax/cop";
import { disclosedErrorMessage } from "#relax/error-page";
import { devExtraOrigins } from "#relax/origin";
import { admitsAbsentLimiter } from "#relax/rate-limit";
import { admitsTestingSecret } from "#relax/turnstile";

export default {
  fetch: async (_request: Request, env: Record<string, unknown>): Promise<Response> =>
    Response.json({
      absentLimiter: admitsAbsentLimiter(),
      missingFetchMetadata: admitsMissingFetchMetadata(),
      extraOrigins: devExtraOrigins(env),
      testingSecret: admitsTestingSecret("1x0000000000000000000000000000000AA"),
      disclosed: disclosedErrorMessage(new Error("refused")) ?? null,
    }),
};
