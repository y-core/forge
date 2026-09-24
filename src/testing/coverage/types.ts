/** A barrel whose components a consumer's coverage manifest must demonstrate. @public */
export type CoverageBarrel = "chrome" | "controls" | "core" | "server";

/** One published component, named the way a coverage failure reports it. @public */
export interface CoverageComponent {
  readonly barrel: CoverageBarrel;
  readonly component: string;
  readonly key: `${CoverageBarrel}/${string}`;
}
