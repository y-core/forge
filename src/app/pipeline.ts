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

/**
 * The half of a mutation route's definition that precedes its terminal step — everything the shared
 * pipeline consumes, and nothing about what the route does with the validated data.
 *
 * Projected from `ActionDefinition` rather than restated, so the fields and their documentation have
 * one home even though two builders supply them.
 *
 * @internal
 */
export type SubmissionPipelineDefinition<S extends v.GenericSchema, Bindings = Record<string, unknown>, ConfigData = unknown> = Pick<
  ActionDefinition<S, Bindings, ConfigData>,
  "schema" | "honeypot" | "turnstile" | "onBotDetected" | "onValidationError" | "maxBytes"
>;

/**
 * One request through read → drop → guard → validate, resolving to the validated body or to the
 * refusal that replaces it.
 *
 * The failure channel carries a `Response` the builder returns as it stands: every refusal this
 * pipeline produces is already the whole answer, so a builder never has to decide what a status
 * means. What a builder still owns is the throw path — the pipeline lets a throw escape rather than
 * answering it, because the two builders log and recover differently.
 *
 * @internal
 */
export type SubmissionPipeline<S extends v.GenericSchema, Bindings = Record<string, unknown>, ConfigData = unknown> = (
  c: AppContext<Bindings>,
  config: ConfigData,
) => Promise<Result<v.InferOutput<S>, Response>>;

/**
 * The one refusal this pipeline renders for a body it will not accept.
 *
 * Every path through it supplies exactly one message, so the shape of the answer never says which
 * path produced it. `422` is the status: a well-formed request the server understood and declined.
 */
function refuseSubmission(messages: readonly string[]): Response {
  return fragmentResponse(renderValidationErrors(messages), 422);
}

/**
 * The first field a schema declares, or `undefined` for a schema that declares none.
 *
 * Valibot's object schemas carry their entries bag on the schema object and keep it through
 * `v.pipe`; a union or a primitive has no such bag, and there is nothing to name.
 */
function firstDeclaredField(schema: v.GenericSchema): string | undefined {
  const { entries } = schema as { entries?: Record<string, unknown> };
  return entries === undefined ? undefined : Object.keys(entries)[0];
}

/**
 * Builds the read → guard → validate sequence both mutation builders run before their own terminal
 * step, so neither can reach a side effect around it.
 *
 * The refusals it answers with: oversized body → 413 fragment, unparseable body → 400, a tripped bot
 * guard or a failed `schema` → 422 validation-errors fragment. **A throw is not one of them** — the
 * pipeline lets it escape, so the builder's own recovery arm sees it.
 *
 * **The refusal names the failing field and nothing else.** Validation runs `abortEarly`, and each
 * issue is rendered through `describeValidationIssue`, so the body reproduces neither the submitted
 * value nor the schema's own rule, and its length cannot be steered by what the caller sent.
 *
 * **A guard that consumes a field is what removes it.** The honeypot and the Turnstile token are
 * dropped because this pipeline checked them; the CSRF field is dropped because `csrfProtection`
 * recorded on the request which field it took the token from. Nothing is dropped on a guess — so a
 * form posting a CSRF token to a route with no CSRF middleware fails `strictObject` on an
 * undeclared `_csrf`, naming the missing middleware instead of quietly absorbing its absence.
 *
 * **Only the body parse catches its own failure**, because an oversized or unreadable body is an
 * answer this pipeline knows (413/400) rather than a defect. Everything after it — a `secretKey`
 * lookup, a `verify` call, a `v.transform` that throws on malformed input, a hook that throws
 * instead of rendering — is left to propagate, because valibot does not catch what a pipe action
 * throws and swallowing it here would give each builder a second, quieter error path than the one it
 * already documents.
 *
 * @internal
 */
export function createSubmissionPipeline<S extends v.GenericSchema, Bindings = Record<string, unknown>, ConfigData = unknown>(
  def: SubmissionPipelineDefinition<S, Bindings, ConfigData>,
): SubmissionPipeline<S, Bindings, ConfigData> {
  const parseOptions: ParseFormDataOptions = def.maxBytes !== undefined ? { maxBytes: def.maxBytes } : {};
  const turnstileField = def.turnstile ? (def.turnstile.tokenField ?? TURNSTILE_FIELD_DEFAULT) : undefined;
  // The names this route's own guards consume are settled when the route is defined. The CSRF field
  // is not: only the middleware that ran knows which field it took the token from, so it joins per
  // request.
  const declaredDrops = [def.honeypot, turnstileField].filter((name): name is string => name !== undefined);
  // `abortEarly` is what keeps a refusal from being multiplied: one issue reaches the fragment
  // however many fields a caller chose to break, so neither the issue count nor the response length
  // is something a submission can steer.
  const parseConfig: v.Config<v.InferIssue<S>> = { abortEarly: true };
  // A tripped guard answers in the *shape* of a validation refusal — one `<li>` naming a field the
  // schema declares, never the decoy, whose name only the guard knows — and `abortEarly` holds a
  // real refusal to a single issue too, so status, structure and length carry nothing a bot can read
  // the guard off. What it does not do is hide the guard from a caller who knows its own body is
  // valid: the guard always names the schema's first declared field, so a wholly valid submission
  // answered with a 422 about a field the caller knows it filled correctly distinguishes the two.
  // Closing that would mean naming a plausible field per submission, which trades a residual oracle
  // for a refusal that lies about which field failed. A schema with no entries to name falls back to
  // the same generic wording a path-less issue produces. Static, so it is resolved once per route.
  const declaredField = firstDeclaredField(def.schema);
  const guardRefusalMessage = describeValidationField(declaredField === undefined ? [] : [declaredField]);

  return async (c, config) => {
    let formData: ReadonlyFormData;
    try {
      formData = await parseFormData(c, parseOptions);
    } catch (thrown) {
      // Oversized bodies (Content-Length fast-path or streaming cap) surface a 413; everything
      // else is an unparseable body → 400.
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
        // A siteverify call that never landed says nothing about the caller. Refuse anyway — an
        // unverifiable CAPTCHA fails closed — but log it, because a run of these is an outage.
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
