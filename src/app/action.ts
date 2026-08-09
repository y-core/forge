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

/**
 * Wires a read → guard → validate → handle pipeline into a POST handler with structured error
 * responses: oversized body → 413 fragment, unparseable body → 400, a tripped bot guard or a failed
 * `schema` → 422 validation-errors fragment, anything that throws → logged 500 fragment.
 *
 * `handle` is reachable only through a passing `v.safeParse` of `schema`, so a browser write cannot
 * arrive at it unchecked. The shared pipeline is what establishes that — `definePage` reaches the
 * same sequence, so the guarantee belongs to the sequence rather than to this builder.
 *
 * **The pipeline runs inside the same `try` as `handle`, deliberately.** Valibot does not catch what
 * a pipe action throws, so a `v.transform` or `v.check` that throws on malformed input would
 * otherwise escape the returned handler entirely — no status, no `onError`, no log. One throw path
 * for the whole handler is what this buys, and it follows that a throwing `onValidationError`,
 * `onBotDetected`, `secretKey` or `verify` lands there too. That is intended: a hook that throws is
 * the same class of route defect as a schema that throws, and answering it differently would mean an
 * app could crash the Worker from the arm meant to render a refusal.
 *
 * @example
 * ```typescript
 * const ContactSchema = strictObject({
 *   name: v.string(),
 *   email: v.pipe(v.string(), v.email()),
 *   phone: v.optional(v.string()),
 *   message: v.string(),
 * });
 *
 * export const contactAction = defineAction<typeof ContactSchema, Bindings, AppConfig>({
 *   schema: ContactSchema,
 *   handle: async (data, c, config) => {
 *     await sendEmail(config.email, data);
 *     return fragmentResponse(renderSuccess("Thanks — we'll be in touch."));
 *   },
 * });
 * ```
 * @public
 */
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
