/** How a spawned command exited, narrowed to what {@link syncForge} reads of it. */
export interface SpawnOutcome {
  readonly status: number | null;
  readonly stderr?: string | undefined;
}

/** Runs a command to completion and answers how it exited — the seam `syncForge` takes instead of reaching for the module. */
export type SpawnCommand = (command: string, args: string[], cwd: string) => SpawnOutcome;

/** The demonstrator checkout the release gate runs, and the spec in it that holds forge's published components to a demonstration. */
export interface ConsumerCoverageOptions {
  readonly checkout: string;
  readonly spec: string;
}

/** What {@link runConsumerCoverage} does to the world, injected so a test substitutes both. */
export interface ConsumerCoverageDeps {
  readonly sync: (root: string) => void;
  readonly runSpec: (cwd: string, spec: string) => number | null;
}
