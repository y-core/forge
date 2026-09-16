// Ambient declarations for the node surface `src/testing/workerd.ts` reaches, shipped so a
// consumer can put its workerd suite in a type program whose `types` array is empty.
//
// Not `@types/node`: that declares the whole runtime into global scope, and a Worker program that
// sees node's globals typechecks code that cannot run in a Worker. What is here is only what the
// dev-server helper spawns with — six `node:*` modules, plus the two globals a module declaration
// cannot express, `Buffer` and `process`.
//
// Reference it from the test-side file that reaches the helper, never from the `types` array:
//   /// <reference types="@y-core/forge/testing/node" />

// Node's Buffer extends Uint8Array; declared only as far as decoding a captured stdout chunk needs.
declare interface Buffer extends Uint8Array {
  toString(encoding?: string): string;
}

declare const process: {
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  kill(pid: number, signal: string): void;
  once(event: string, listener: () => void): void;
};

declare module "node:child_process" {
  interface SpawnOptions {
    stdio?: string | (string | number)[];
    detached?: boolean;
    env?: Record<string, string | undefined>;
  }
  interface Readable {
    on(event: "data", listener: (chunk: Buffer) => void): Readable;
  }
  interface ChildProcess {
    readonly pid?: number;
    readonly killed: boolean;
    readonly stdout: Readable | null;
    readonly stderr: Readable | null;
    unref(): void;
  }
  export function spawn(command: string, args?: string[], options?: SpawnOptions): ChildProcess;
}

declare module "node:fs" {
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function writeFileSync(path: string, data: string, encoding: "utf-8"): void;
}

declare module "node:net" {
  interface AddressInfo {
    port: number;
  }
  interface Server {
    once(event: "error", listener: (error: Error) => void): Server;
    listen(port: number, host: string, listener: () => void): Server;
    address(): AddressInfo | string | null;
    close(listener?: () => void): Server;
  }
  export function createServer(): Server;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
