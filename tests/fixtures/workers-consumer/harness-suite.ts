/// <reference path="../../../src/testing/node.d.ts" />
import { serveWorker, type ServeWorkerOptions } from "@y-core/forge/testing/harness";

export const serve = (options: ServeWorkerOptions) => serveWorker(options);
