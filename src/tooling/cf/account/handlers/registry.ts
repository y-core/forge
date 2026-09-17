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
import type { HandlerBuildOptions } from "./types";
import { createVarsHandler } from "./vars";

/** Builds the full handler set for one invocation, binding the `.dev.vars` readers to the config's directory. */
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

/** The handler set for a caller that has not said where its config is, defaulting to the CLI's own `wrangler.jsonc`. */
export const defaultHandlers: ResourceHandler[] = buildHandlers({ configPath: "wrangler.jsonc" });

export function findHandler(type: ResourceType): ResourceHandler | undefined {
  return defaultHandlers.find((h) => h.type === type);
}
