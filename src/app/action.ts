import type { RequestHandler } from "@remix-run/fetch-router";
import { ConfigKey, getAppContext } from "../context/types";
import { renderError } from "../http/fragment";
import { fragmentResponse } from "../http/response";
import { createLogger } from "../logging/logger";
import { toError } from "../result/result";
import type { v } from "../validation/validation";
import { createSubmissionPipeline } from "./pipeline";
import type { ActionDefinition } from "./types";

const logger = createLogger("action");

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
      logger.error("Action threw", { error: error.message });
      if (def.onError) return def.onError(error, c);
      return fragmentResponse(renderError("Something went wrong. Please try again."), 500);
    }
  };
}
