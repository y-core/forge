import type { RelaxMissingFetchMetadata } from "./types";

/** Refuses a request that carries no Fetch Metadata headers. @internal */
export const admitsMissingFetchMetadata: RelaxMissingFetchMetadata = () => false;
