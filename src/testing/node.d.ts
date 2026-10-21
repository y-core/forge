// The node surface `testing/snapshot`, `testing/d1` and `testing/harness` reach. Not `@types/node`, which declares node's globals
// into scope so a Worker program typechecks code that cannot run.

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options: { recursive: true }): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: "utf-8"): string;
  export function rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
  export function writeFileSync(path: string, data: string, encoding?: "utf-8"): void;
}

declare module "node:module" {
  export function createRequire(path: string): { resolve(id: string): string };
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function join(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
}

declare module "node:process" {
  export interface StdioStream {
    readonly isTTY?: boolean;
    readonly columns?: number;
    write(data: string): boolean;
  }
  export interface Process {
    readonly env: Record<string, string | undefined>;
    readonly stdin: StdioStream;
    readonly stdout: StdioStream;
    cwd(): string;
    exit(code?: number): never;
    once(event: string, listener: () => void): void;
  }
  const process: Process;
  export default process;
}

declare module "node:url" {
  export function pathToFileURL(path: string): URL;
}
