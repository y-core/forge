import { TURNSTILE_FIELD_DEFAULT } from "../form/constants";
import { csrfFieldCtx } from "../form/csrf-context";
import { parseFormData } from "../form/parse-form-data";
import { formToObject } from "../form/to-object";
import { verifyTurnstile } from "../form/turnstile";
import type { ParseFormDataOptions, ReadonlyFormData } from "../form/types";
import { renderError, renderValidationErrors } from "../http/fragment";
import { fragmentResponse } from "../http/response";
import { createLogger } from "../logging/logger";
import { err, ok } from "../result/result";
import { describeValidationField, describeValidationIssue } from "../validation/format-issues";
import { v } from "../validation/validation";
import type { SubmissionPipeline, SubmissionPipelineDefinition } from "./types";

const logger = createLogger("pipeline");

/** The pipeline's own option names — the one list both the type and `definePage`'s guard read. @internal */
export const PIPELINE_ONLY_KEYS = ["turnstile", "onBotDetected", "onValidationError", "maxBytes"] as const;

/** The one refusal this pipeline renders for a body it will not accept. */
function refuseSubmission(messages: readonly string[]): Response {
  return fragmentResponse(renderValidationErrors(messages), 422);
}

/** The first field a schema declares, or `undefined` for a schema that declares none. */
function firstDeclaredField(schema: v.GenericSchema): string | undefined {
  const { entries } = schema as { entries?: Record<string, unknown> };
  return entries === undefined ? undefined : Object.keys(entries)[0];
}

/** Builds the read → guard → validate sequence both mutation builders run before their own terminal step. @internal */
export function createSubmissionPipeline<S extends v.GenericSchema, Bindings = Record<string, unknown>, ConfigData = unknown>(
  def: SubmissionPipelineDefinition<S, Bindings, ConfigData>,
): SubmissionPipeline<S, Bindings, ConfigData> {
  const parseOptions: ParseFormDataOptions = def.maxBytes !== undefined ? { maxBytes: def.maxBytes } : {};
  const turnstileField = def.turnstile ? (def.turnstile.tokenField ?? TURNSTILE_FIELD_DEFAULT) : undefined;
  const declaredDrops = turnstileField === undefined ? [] : [turnstileField];
  // `abortEarly` holds a refusal to one issue, so neither issue count nor response length is
  // something a submission can steer.
  const parseConfig: v.Config<v.InferIssue<S>> = { abortEarly: true };
  // A tripped guard must answer in the shape of a validation refusal, naming a field the schema
  // declares, so a bot cannot read the guard off the response.
  const declaredField = firstDeclaredField(def.schema);
  const guardRefusalMessage = describeValidationField(declaredField === undefined ? [] : [declaredField]);

  return async (c, config) => {
    let formData: ReadonlyFormData;
    try {
      formData = await parseFormData(c, parseOptions);
    } catch (thrown) {
      if ((thrown as { status?: number }).status === 413) {
        return err(fragmentResponse(renderError("The submitted form is too large. Please reduce its size and try again."), 413));
      }
      return err(fragmentResponse(renderError("Unable to process the form data. Please try again."), 400));
    }

    if (def.turnstile !== undefined && turnstileField !== undefined) {
      const secretKey = await def.turnstile.secretKey(c, config);
      // Signal first, so a route that resolves its own still wins.
      const verification = await verifyTurnstile(formData, secretKey, {
        signal: c.request.signal,
        ...def.turnstile.verify(c, config),
        tokenField: turnstileField,
      });
      if (!verification.ok) {
        // Logged on every trip, not only on an outage: the refusal a tripped guard renders is
        // deliberately a validation refusal naming the first declared field, so without this line a
        // CAPTCHA that cannot pass in a given environment is indistinguishable — from the outside and
        // from the logs — from a form whose first field is simply wrong.
        logger.warn("Submission refused by a bot guard", { guard: "turnstile", reason: verification.error });
        return err(
          def.onBotDetected
            ? await def.onBotDetected({ guard: "turnstile", reason: verification.error }, c)
            : refuseSubmission([guardRefusalMessage]),
        );
      }
    }

    const csrfField = csrfFieldCtx.getOptional(c);
    const drop = new Set(csrfField === undefined ? declaredDrops : [...declaredDrops, csrfField]);

    const parsed = v.safeParse(def.schema, formToObject(formData, { drop }), parseConfig);
    if (!parsed.success) {
      if (def.onValidationError) return err(await def.onValidationError(parsed.issues, c));
      return err(refuseSubmission(parsed.issues.map(describeValidationIssue)));
    }

    return ok(parsed.output);
  };
}
