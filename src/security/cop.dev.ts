import { isDevBuildArmed, whenArmed } from "../relax/armed";
import { admitsMissingFetchMetadata as refuseMissingFetchMetadata } from "./cop.strict";
import type { RelaxMissingFetchMetadata } from "./types";

/** Admits a request that carries no Fetch Metadata headers. @internal */
export function waiveFetchMetadata(): boolean {
  return true;
}

/** Admits a request without Fetch Metadata headers in a build armed for development, and refuses it otherwise. @internal */
export const admitsMissingFetchMetadata: RelaxMissingFetchMetadata = whenArmed(isDevBuildArmed, waiveFetchMetadata, refuseMissingFetchMetadata);
