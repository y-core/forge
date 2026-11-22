import { admitsMissingFetchMetadata } from "#relax/cop";
import { disclosedErrorMessage } from "#relax/error-page";
import { devExtraOrigins } from "#relax/origin";
import { admitsAbsentLimiter } from "#relax/rate-limit";
import { admitsTestingSecret } from "#relax/turnstile";

import { TURNSTILE_TEST_KEYS } from "../../../src/form/turnstile-keys";

export default {
  fetch: async (_request: Request, env: Record<string, unknown>): Promise<Response> =>
    Response.json({
      absentLimiter: admitsAbsentLimiter(),
      missingFetchMetadata: admitsMissingFetchMetadata(),
      extraOrigins: devExtraOrigins(env),
      testingSecret: admitsTestingSecret(TURNSTILE_TEST_KEYS.secret.pass),
      disclosed: disclosedErrorMessage(new Error("refused")) ?? null,
    }),
};
