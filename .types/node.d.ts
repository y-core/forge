// Minimal ambient declarations for node: built-ins used in forge CLI/pkg/assets modules.
// Avoids pulling in @types/node, which pollutes the global scope and conflicts
// with the Wrangler/workerd-generated Workers runtime types and DOM types.

// Node's Buffer extends Uint8Array; declare minimally so execSync return type resolves.
declare type Buffer = Uint8Array;

declare module "node:process" {
  export const argv: string[];
  export const env: Record<string, string | undefined>;
  export function exit(code?: number): never;
}

declare const process: {
  exit(code?: number): never;
  cwd(): string;
  env: Record<string, string | undefined>;
};

declare module "node:path" {
  export const delimiter: string;
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
  export function basename(path: string, ext?: string): string;
  export function extname(path: string): string;
  export function relative(from: string, to: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:fs" {
  export function readFileSync(path: string): Buffer;
  export function readFileSync(path: string, encoding: "utf-8"): string;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function writeFileSync(path: string, data: string, encoding: "utf-8"): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function copyFileSync(src: string, dest: string): void;
  export function renameSync(oldPath: string, newPath: string): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function unlinkSync(path: string): void;
  export interface Dirent {
    name: string;
    parentPath: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }
  export function readdirSync(path: string, options: { recursive?: boolean; withFileTypes: true }): Dirent[];
  export function readdirSync(path: string, options?: { recursive?: boolean }): string[];
}

declare module "node:child_process" {
  interface ExecSyncOptions {
    cwd?: string;
    encoding?: string;
    stdio?: string | string[];
  }
  export function execSync(command: string, options?: ExecSyncOptions): Buffer | string;
  export function execFileSync(file: string, args?: string[], options?: ExecSyncOptions): Buffer | string;
  interface SpawnSyncOptions {
    cwd?: string;
    stdio?: string | string[];
    env?: Record<string, string | undefined>;
  }
  interface SpawnSyncReturns {
    status: number | null;
  }
  export function spawnSync(command: string, args?: string[], options?: SpawnSyncOptions): SpawnSyncReturns;
}

declare module "node:crypto" {
  interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(encoding: "hex"): string;
    digest(): Uint8Array;
  }
  export function createHash(algorithm: string): Hash;
}

declare module "node:os" {
  export function tmpdir(): string;
}
