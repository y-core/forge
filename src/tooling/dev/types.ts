/** How a spawned command exited, narrowed to what {@link syncForge} reads of it. */
export interface SpawnOutcome {
  readonly status: number | null;
  readonly stderr?: string | undefined;
}

/** Runs a command to completion and answers how it exited — the seam `syncForge` takes instead of reaching for the module. */
export type SpawnCommand = (command: string, args: string[], cwd: string) => SpawnOutcome;
