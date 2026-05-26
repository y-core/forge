import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type BuildState = Record<string, string>;

export function loadState(statePath: string): BuildState {
  if (!existsSync(statePath)) return {};
  try {
    return JSON.parse(readFileSync(statePath, "utf-8")) as BuildState;
  } catch {
    return {};
  }
}

export function saveState(statePath: string, state: BuildState): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function hasChanged(state: BuildState, key: string, currentHash: string): boolean {
  return state[key] !== currentHash;
}

export function markBuilt(state: BuildState, key: string, hash: string): void {
  state[key] = hash;
}
