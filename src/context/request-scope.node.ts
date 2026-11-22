import type { RequestScope } from "./types";

/** Thrown when a node bundle of forge is handed a request, which only the TypeScript source can serve. @internal */
export class RequestFreeBundleError extends Error {
  override name = "RequestFreeBundleError";

  constructor() {
    super(
      "forge's `node` export condition loads a request-free bundle, which holds no request state of its own — serve requests through the TypeScript source (docs/TEST_RUNNERS.md §7f)",
    );
  }
}

/** Refuses every read and write of a request's context, so a bundle-built middleware cannot split state from the source. @internal */
export const requestScope: RequestScope = {
  read: () => {
    throw new RequestFreeBundleError();
  },
  write: () => {
    throw new RequestFreeBundleError();
  },
};
