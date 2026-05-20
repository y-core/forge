// Minimal ambient declarations for node: built-ins used in forge CLI/pkg modules.
// Avoids pulling in @types/node, which pollutes the global scope and conflicts
// with @cloudflare/workers-types and DOM types.

// Node's Buffer extends Uint8Array; declare minimally so execSync return type resolves.
declare type Buffer = Uint8Array;

declare module "node:process" {
  export const argv: string[];
  export const env: Record<string, string | undefined>;
  export function exit(code?: number): never;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf-8"): string;
  export function writeFileSync(path: string, data: string, encoding: "utf-8"): void;
  export function existsSync(path: string): boolean;
}

declare module "node:child_process" {
  interface ExecSyncOptions {
    cwd?: string;
    encoding?: string;
    stdio?: string | string[];
  }
  export function execSync(command: string, options?: ExecSyncOptions): Buffer | string;
}
