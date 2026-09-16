import { headingTrail } from "./excerpt";
import { corpusLabel, type Hit } from "./search";

/** What a rendering of a hit may add beyond the hit itself. @public */
export interface HitFormat {
  /** Also print the BM25 score, which is comparable within one result set and across none. */
  score?: boolean;
}

/** One hit as a reader is shown it: its id and corpus, its heading trail, and one line to judge it by.
 *
 *  One function for both reader-facing surfaces — `warden search` and `knowledge_search` — because a
 *  reader comparing what the CLI said with what the tool returned is comparing the same corpus, and
 *  two renderers drift into implying two.
 *
 *  The coverage figure is unconditional and so is the corpus label: a hit offered without saying how
 *  much of the question it answers, or which corpus governs it, is the near miss this whole surface
 *  exists to refuse. @public */
export function renderHit(hit: Hit, format: HitFormat = {}): string {
  const score = format.score === true ? `, bm25 ${hit.score.toFixed(4)}` : "";
  const line = hit.excerpt ?? hit.gloss;
  return [
    `${hit.id}  (${hit.coverage.toFixed(2)}${score}, ${corpusLabel(hit.corpus)})`,
    `  ${headingTrail(hit.headingPath)}`,
    ...(line === "" ? [] : [`  ${line}`]),
  ].join("\n");
}
