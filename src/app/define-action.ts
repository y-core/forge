import type { Env } from "hono";
import { renderError, renderValidationErrors } from "../html/fragment";
import { htmlResponse } from "../html/response";
import { toError } from "../result/result";
import { toArray } from "../router/register";
import type { RouteModule } from "../router/types";
import type { ActionDefinition } from "./types";

/** Wires a parse → validate → handle pipeline into a Hono POST handler with structured error responses. @public */
export function defineAction<T, E extends Env = Env>(def: ActionDefinition<T, E>): RouteModule<E> {
  const middleware = def.middleware ? toArray(def.middleware) : [];

  return {
    middleware: middleware.length > 0 ? middleware : undefined,
    action: async (c) => {
      let formData: FormData;
      try {
        formData = await c.req.formData();
      } catch {
        return htmlResponse(renderError("Unable to process the form data. Please try again."), 400);
      }

      let parsed: T;
      try {
        parsed = def.parse(formData);
      } catch (err) {
        if (def.onError) return def.onError(toError(err), c);
        return htmlResponse(renderError("Unable to process the form data. Please try again."), 400);
      }

      const validation = def.validate(parsed);
      if (!validation.ok) {
        if (def.onValidationError) return def.onValidationError(validation.errors, c);
        return htmlResponse(renderValidationErrors(validation.errors));
      }

      try {
        return await def.handle(validation.data, c);
      } catch (err) {
        if (def.onError) return def.onError(toError(err), c);
        return htmlResponse(renderError("Something went wrong. Please try again."), 500);
      }
    },
  };
}
