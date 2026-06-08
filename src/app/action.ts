import type { RequestHandler } from "@remix-run/fetch-router";
import { getAppContext } from "../context/types";
import { parseFormData } from "../form/parse-form-data";
import type { ReadonlyFormData } from "../form/types";
import { renderError, renderValidationErrors } from "../http/fragment";
import { fragmentResponse } from "../http/response";
import { createLogger } from "../logging/logger";
import { toError } from "../result/result";
import { ConfigKey } from "./config-middleware";
import type { ActionDefinition } from "./types";

const logger = createLogger("action");

/** Wires a parse → validate → handle pipeline into a POST handler with structured error responses. @public */
export function defineAction<Input, Bindings = Record<string, unknown>, ConfigData = unknown>(
  def: ActionDefinition<Input, Bindings, ConfigData>,
): RequestHandler {
  return async (context) => {
    const config = context.get(ConfigKey) as ConfigData;
    const c = getAppContext<Bindings>(context);

    let formData: ReadonlyFormData;
    try {
      formData = await parseFormData(context);
    } catch (err) {
      // Oversized bodies (Content-Length fast-path or streaming cap) surface a 413; everything
      // else is an unparseable body → 400.
      if ((err as { status?: number }).status === 413) {
        return fragmentResponse(renderError("The submitted form is too large. Please reduce its size and try again."), 413);
      }
      return fragmentResponse(renderError("Unable to process the form data. Please try again."), 400);
    }

    let parsed: Input;
    try {
      parsed = def.parse(formData);
    } catch (err) {
      if (def.onError) return def.onError(toError(err), c);
      return fragmentResponse(renderError("Unable to process the form data. Please try again."), 400);
    }

    const validation = def.validate(parsed);
    if (!validation.ok) {
      if (def.onValidationError) return def.onValidationError(validation.errors, c);
      return fragmentResponse(renderValidationErrors(validation.errors));
    }

    try {
      return await def.handle(validation.data, c, config);
    } catch (err) {
      const error = toError(err);
      logger.error("Action handler threw", { error: error.message });
      if (def.onError) return def.onError(error, c);
      return fragmentResponse(renderError("Something went wrong. Please try again."), 500);
    }
  };
}
