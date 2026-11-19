import { createLogger } from "../../logging/logger";
import { serializeError } from "../../logging/serialize-error";
import { AUTH_NOTIFY_TIMEOUT_MS } from "../config";
import type { AuthSecurityNotice } from "../types";
import type { AuthSecurityNotices, AuthSecurityNoticesOptions } from "./types";

/** Defers delivery of one security notice to `to`, logging a failed one as `auth.security-notice.failed` and never throwing. @internal */
export function deliverAuthSecurityNotice(options: AuthSecurityNoticesOptions, to: string, notice: AuthSecurityNotice): void {
  const logger = options.logger ?? createLogger("auth/flows");
  const failed = (error: unknown): void => logger.error("auth.security-notice.failed", { type: notice.type, error: serializeError(error) });
  const delivered = Promise.resolve()
    .then(() => options.notifier.send({ to, kind: "security-event", notice }, AbortSignal.timeout(AUTH_NOTIFY_TIMEOUT_MS)))
    .then((sent) => (sent.ok ? undefined : failed(sent.error)), failed);
  options.defer(delivered);
}

/** Builds the security-notice hook, delivering through the deployment's `AuthNotifier` after the response. @public */
export function createSecurityNotices(options: AuthSecurityNoticesOptions): AuthSecurityNotices {
  return { send: (to, notice) => deliverAuthSecurityNotice(options, to, notice) };
}
