import type { RequestHandler } from "@remix-run/fetch-router";

import { ConfigKey, getAppContext } from "../context/types";
import { renderError } from "../http/fragment";
import { fragmentResponse } from "../http/response";
import { createLogger } from "../logging/logger";
import { serializeError } from "../logging/serialize-error";
import { toError } from "../result/result";
import type { v } from "../validation/validation";
import { createSubmissionPipeline } from "./pipeline";
import type { ActionDefinition } from "./types";

const logger = createLogger("action");

function genericFailure(): Response {
  return fragmentResponse(renderError("Something went wrong. Please try again."), 500);
}

/** Wires a read → guard → validate → handle pipeline into a POST handler with structured error responses. @public */
export function defineAction<S extends v.GenericSchema, Bindings = Record<string, unknown>, ConfigData = unknown>(
  def: ActionDefinition<S, Bindings, ConfigData>,
): RequestHandler {
  const pipeline = createSubmissionPipeline<S, Bindings, ConfigData>(def);

  return async (context) => {
    const config = context.get(ConfigKey) as ConfigData;
    const c = getAppContext<Bindings>(context);

    try {
      const submission = await pipeline(c, config);
      if (!submission.ok) return submission.error;

      return await def.handle(submission.data, c, config);
    } catch (err) {
      const error = toError(err);
      // The one case this builder rethrows: a gone client gets no fragment and no record, and the
      // boundary answers 499 (`ERROR_HANDLING.md` §5b).
      if (c.request.signal.aborted) throw error;
      if (def.onError) {
        try {
          const recovered = await def.onError(error, c);
          // Warn, not error: the client received a normal response, so nothing failed for them.
          logger.warn("Action threw", { error: serializeError(error) });
          return recovered;
        } catch (hookErr) {
          logger.error("defineAction onError threw", { error: serializeError(hookErr), original: serializeError(error) });
          return genericFailure();
        }
      }
      logger.error("Action threw", { error: serializeError(error) });
      return genericFailure();
    }
  };
}
