import { createHandlerFactory } from "@y-core/forge/app";

import type { AppConfig } from "./config";
import type { Bindings } from "./types";

export const { definePage, defineAction } = createHandlerFactory<Bindings, AppConfig>();
