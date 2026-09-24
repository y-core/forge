import { headingTrail } from "./excerpt";
import { corpusLabel, type Hit } from "./search";

/** What a rendering of a hit may add beyond the hit itself. @public */
export interface HitFormat {
  /** Also print the BM25 score. */
  score?: boolean;
}

/** One hit as a reader is shown it: its id and corpus, its heading trail, and one line to judge it by. @public */
export function renderHit(hit: Hit, format: HitFormat = {}): string {
  const score = format.score === true ? `, bm25 ${hit.score.toFixed(4)}` : "";
  const line = hit.excerpt ?? hit.gloss;
  return [
    `${hit.id}  (${hit.coverage.toFixed(2)}${score}, ${corpusLabel(hit.corpus)})`,
    `  ${headingTrail(hit.headingPath)}`,
    ...(line === "" ? [] : [`  ${line}`]),
  ].join("\n");
}
