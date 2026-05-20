import type { MiddlewareHandler } from "hono";
import { requireFormContentType } from "./content-type";
import { crossOriginProtection } from "./cop";
import { csrfProtection } from "./csrf";
import { requireHxRequest } from "./hx-request";
import { originGuard } from "./origin";
import type { SecurityConfig } from "./types";

export function defineSecurity(config: SecurityConfig): MiddlewareHandler[] {
  const middleware: MiddlewareHandler[] = [];

  if (config.origin) {
    middleware.push(originGuard(config.origin.allowed));
  }

  if (config.cop) {
    middleware.push(crossOriginProtection());
  }

  if (config.hxRequest) {
    middleware.push(requireHxRequest());
  }

  if (config.contentType) {
    middleware.push(requireFormContentType());
  }

  if (config.csrf) {
    middleware.push(csrfProtection(config.csrf));
  }

  return middleware;
}
