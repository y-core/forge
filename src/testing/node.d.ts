// The node surface `src/testing/snapshot.ts` reaches. Not `@types/node`, which declares node's globals
// into scope so a Worker program typechecks code that cannot run.

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options: { recursive: true }): string | undefined;
  export function readFileSync(path: string, encoding: "utf-8"): string;
  export function writeFileSync(path: string, data: string, encoding: "utf-8"): void;
}

declare module "node:path" {
  export function dirname(path: string): string;
}
