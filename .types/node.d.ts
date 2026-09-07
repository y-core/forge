// Minimal ambient declarations for node: built-ins used in forge CLI/pkg/assets modules.
// Avoids pulling in @types/node, which pollutes the global scope and conflicts
// with the Wrangler/workerd-generated Workers runtime types and DOM types.

// Node's Buffer extends Uint8Array; declare minimally so execSync return type resolves, plus the
// one method beyond it that forge calls.
declare interface Buffer extends Uint8Array {
  equals(other: Uint8Array): boolean;
}

// A stdin/stdout stream, declared only as far as the prompt in `cli/sync` needs it: whether a
// terminal is attached, and something readline can be handed.
interface NodeStdioStream {
  readonly isTTY?: boolean;
  readonly columns?: number;
  // `warden show` writes a payload with no trailing newline, which `console.log` cannot express.
  write(data: string): boolean;
}

declare module "node:process" {
  export const argv: string[];
  export const env: Record<string, string | undefined>;
  export function exit(code?: number): never;

  // The object form, needed for `process.exitCode = n` — a settable property a named import
  // cannot express, since imported bindings are read-only.
  interface Process {
    argv: string[];
    env: Record<string, string | undefined>;
    exitCode?: number;
    readonly pid: number;
    readonly stdin: NodeStdioStream;
    readonly stdout: NodeStdioStream;
    readonly stderr: NodeStdioStream;
    cwd(): string;
    exit(code?: number): never;
  }
  const process: Process;
  export default process;
}

declare const process: {
  exit(code?: number): never;
  cwd(): string;
  env: Record<string, string | undefined>;
  exitCode?: number;
  readonly pid: number;
  readonly stdin: NodeStdioStream;
  readonly stdout: NodeStdioStream;
  readonly stderr: NodeStdioStream;
};

// The promise-returning readline, used for the one confirmation `forge sync --rotate` asks.
declare module "node:readline/promises" {
  interface Interface {
    question(query: string): Promise<string>;
    close(): void;
  }
  export function createInterface(options: { input: NodeStdioStream; output: NodeStdioStream }): Interface;
}

interface PathApi {
  readonly sep: string;
  readonly delimiter: string;
  resolve(...paths: string[]): string;
  dirname(path: string): string;
  join(...paths: string[]): string;
  basename(path: string, ext?: string): string;
  extname(path: string): string;
  relative(from: string, to: string): string;
  normalize(path: string): string;
}

declare module "node:path" {
  export const delimiter: string;
  export const sep: string;
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
  export function basename(path: string, ext?: string): string;
  export function extname(path: string): string;
  export function relative(from: string, to: string): string;
  /** POSIX-semantics variants, used where a path is a repo-relative identifier rather than a
   *  filesystem location and must resolve the same way on every host. */
  export const posix: PathApi;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): { href: string };
}

declare module "node:fs" {
  export function readFileSync(path: string): Buffer;
  export function readFileSync(path: string, encoding: "utf-8"): string;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function writeFileSync(path: string, data: string, encoding: "utf-8"): void;
  // The options form, for a file that must be created with a restrictive mode.
  export function writeFileSync(path: string, data: string, options: { encoding: "utf-8"; mode: number }): void;
  export function existsSync(path: string | URL): boolean;
  export function chmodSync(path: string, mode: number): void;
  export function utimesSync(path: string, atime: Date | number, mtime: Date | number): void;
  export interface Stats {
    mode: number;
    size: number;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export function statSync(path: string): Stats;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function mkdtempSync(prefix: string): string;
  export function copyFileSync(src: string, dest: string): void;
  export function renameSync(oldPath: string, newPath: string): void;
  export function symlinkSync(target: string, path: string): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function unlinkSync(path: string): void;
  export function openSync(path: string, flags: string): number;
  export function closeSync(fd: number): void;
  export function writeSync(fd: number, data: string): number;
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
    // A numeric entry is a file descriptor the child inherits — `capture` passes the same
    // fd for both stdout and stderr to interleave them the way `cmd > log 2>&1` does.
    stdio?: string | (string | number)[];
    env?: Record<string, string | undefined>;
    encoding?: string;
  }
  interface SpawnSyncReturns {
    status: number | null;
    error?: Error;
    /** Present only when the child's output was captured and decoded — i.e. when `stdio` did not
     *  redirect it away and an `encoding` was given. */
    stdout?: string;
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
  export function homedir(): string;
}
