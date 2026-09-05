import type { ResourceType } from "../../types";
import { d1Handler } from "./d1";
import {
  aiHandler,
  analyticsEngineHandler,
  browserHandler,
  dispatchNamespacesHandler,
  durableObjectsHandler,
  hyperdriveHandler,
  mtlsCertificatesHandler,
  pipelinesHandler,
  sendEmailHandler,
  servicesHandler,
  vectorizeHandler,
  workflowsHandler,
} from "./declarative";
import { kvHandler } from "./kv";
import { createLocalVarsHandler } from "./localvars";
import { queuesHandler } from "./queues";
import { r2Handler } from "./r2";
import { rateLimitsHandler } from "./ratelimits";
import { createRotatableSecretsHandler, createSecretsHandler } from "./secrets";
import type { ResourceHandler } from "./types";
import { createVarsHandler } from "./vars";

export interface HandlerBuildOptions {
  /** Path to the wrangler config, as given on the command line. Secrets look for `.dev.vars` beside it. */
  configPath: string;
}

/**
 * Build the full handler set for one invocation.
 *
 * A factory rather than a constant because four handlers — local vars, vars, and the
 * two kinds of secret — are a function of where the config lives, all reading the
 * `.dev.vars` beside it, and a module-level singleton could only ever guess at that.
 */
export function buildHandlers(opts: HandlerBuildOptions): ResourceHandler[] {
  return [
    kvHandler,
    d1Handler,
    r2Handler,
    queuesHandler,
    createLocalVarsHandler(opts.configPath),
    createVarsHandler(opts.configPath),
    createSecretsHandler(opts.configPath),
    createRotatableSecretsHandler(opts.configPath),
    rateLimitsHandler,
    durableObjectsHandler,
    hyperdriveHandler,
    vectorizeHandler,
    aiHandler,
    browserHandler,
    analyticsEngineHandler,
    servicesHandler,
    sendEmailHandler,
    dispatchNamespacesHandler,
    mtlsCertificatesHandler,
    workflowsHandler,
    pipelinesHandler,
  ];
}

/**
 * The handler set for a caller that has not said where its config is.
 *
 * `"wrangler.jsonc"` is not a placeholder — it is the CLI's own default, and
 * `dirname(resolve("wrangler.jsonc"))` is the current working directory, which is
 * the correct place to look for `.dev.vars`.
 */
export const defaultHandlers: ResourceHandler[] = buildHandlers({ configPath: "wrangler.jsonc" });

export function findHandler(type: ResourceType): ResourceHandler | undefined {
  return defaultHandlers.find((h) => h.type === type);
}
