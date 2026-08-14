import type { AppContext } from "../context/types";
import { TURNSTILE_FIELD_DEFAULT } from "../form/constants";
import { csrfFieldCtx } from "../form/field-context";
import { isHoneypotFilled } from "../form/honeypot";
import { parseFormData } from "../form/parse-form-data";
import { formToObject } from "../form/to-object";
import { verifyTurnstile } from "../form/turnstile";
import type { ParseFormDataOptions, ReadonlyFormData } from "../form/types";
import { renderError, renderValidationErrors } from "../http/fragment";
import { fragmentResponse } from "../http/response";
import { createLogger } from "../logging/logger";
import type { Result } from "../result/result";
import { err, ok } from "../result/result";
import { describeValidationField, describeValidationIssue } from "../validation/format-issues";
import { v } from "../validation/validation";
import type { ActionDefinition } from "./types";

const logger = createLogger("pipeline");

/** The half of a mutation route's definition the shared submission pipeline consumes. @internal */
export type SubmissionPipelineDefinition<S extends v.GenericSchema, Bindings = Record<string, unknown>, ConfigData = unknown> = Pick<
  ActionDefinition<S, Bindings, ConfigData>,
  "schema" | "honeypot" | "turnstile" | "onBotDetected" | "onValidationError" | "maxBytes"
>;

/** One request through read → drop → guard → validate, resolving to the validated body or the refusal that replaces it. @internal */
export type SubmissionPipeline<S extends v.GenericSchema, Bindings = Record<string, unknown>, ConfigData = unknown> = (
  c: AppContext<Bindings>,
  config: ConfigData,
) => Promise<Result<v.InferOutput<S>, Response>>;

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
  const declaredDrops = [def.honeypot, turnstileField].filter((name): name is string => name !== undefined);
  // `abortEarly` holds a refusal to one issue, so neither issue count nor response length is
  // something a submission can steer.
  const parseConfig: v.Config<v.InferIssue<S>> = { abortEarly: true };
  // A tripped guard must answer in the shape of a validation refusal, naming a field the schema
  // declares and never the decoy, so a bot cannot read the guard off the response.
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

    // The decoy is checked first so a bot that filled it never spends a siteverify call.
    if (def.honeypot !== undefined && isHoneypotFilled(formData, def.honeypot)) {
      return err(def.onBotDetected ? await def.onBotDetected({ guard: "honeypot" }, c) : refuseSubmission([guardRefusalMessage]));
    }

    if (def.turnstile !== undefined && turnstileField !== undefined) {
      const secretKey = await def.turnstile.secretKey(c, config);
      const verification = await verifyTurnstile(formData, secretKey, { ...def.turnstile.verify(c, config), tokenField: turnstileField });
      if (!verification.ok) {
        // An unverifiable CAPTCHA fails closed, but a run of these is an outage rather than an attack.
        if (verification.error === "network-error" || verification.error === "timeout") {
          logger.warn("Turnstile verification unavailable", { reason: verification.error });
        }
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
