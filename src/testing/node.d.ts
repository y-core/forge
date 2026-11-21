// The node surface `testing/snapshot`, `testing/d1` and `testing/harness` reach, and the one a forge app's tests call. Not `@types/node`, which
// declares node's globals into scope so a Worker program typechecks code that cannot run. Every entry is a `declare module`, so none adds a global.

declare module "node:child_process" {
  export interface SpawnSyncTextResult {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly error?: Error;
  }
  export function spawnSync(
    command: string,
    args: readonly string[],
    options: {
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string | undefined>>;
      readonly input?: string;
      readonly encoding: "utf8" | "utf-8";
      readonly maxBuffer?: number;
    },
  ): SpawnSyncTextResult;

  export interface TextReadable {
    setEncoding(encoding: "utf8" | "utf-8"): this;
    on(event: "data", listener: (chunk: string) => void): this;
  }
  export interface ChildProcess {
    readonly pid?: number;
    readonly stdout: TextReadable;
    readonly stderr: TextReadable;
    on(event: "close", listener: (code: number | null) => void): this;
    kill(): boolean;
  }
  export function spawn(
    command: string,
    args: readonly string[],
    options?: { readonly cwd?: string; readonly env?: Readonly<Record<string, string | undefined>> },
  ): ChildProcess;

  export function execFileSync(
    file: string,
    args: readonly string[],
    options: { readonly cwd?: string; readonly encoding: "utf8" | "utf-8"; readonly maxBuffer?: number },
  ): string;
}

declare module "node:crypto" {
  export interface Hash {
    update(data: string | Uint8Array, encoding?: "utf8" | "utf-8"): Hash;
    digest(encoding: "hex" | "base64"): string;
    digest(): Uint8Array;
  }
  export function createHash(algorithm: string): Hash;
}

// Imported for its side effect alone, before any browser connects.
declare module "node:domain" {}

declare module "node:fs" {
  export function existsSync(path: string | URL): boolean;
  export function mkdirSync(path: string | URL, options?: { recursive?: boolean }): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function readdirSync(path: string | URL): string[];
  export function readFileSync(path: string | URL, encoding: "utf8" | "utf-8"): string;
  export function readFileSync(path: string | URL): Uint8Array;
  export function rmSync(path: string | URL, options?: { recursive?: boolean; force?: boolean }): void;
  export function writeFileSync(path: string | URL, data: string | Uint8Array, encoding?: "utf8" | "utf-8"): void;
}

declare module "node:http" {
  export interface IncomingMessage {
    readonly url?: string | undefined;
    setEncoding(encoding: "utf8" | "utf-8"): this;
    on(event: "data", listener: (chunk: string) => void): this;
    on(event: "end", listener: () => void): this;
  }
  export interface ServerResponse {
    writeHead(status: number, headers?: Record<string, string>): this;
    end(body?: string): void;
  }
  export interface Server {
    on(event: "connect", listener: (request: IncomingMessage, socket: import("node:net").Socket) => void): this;
    listen(port: number, host: string, callback: () => void): this;
    address(): import("node:net").AddressInfo | string | null;
    close(callback?: () => void): this;
    closeAllConnections(): void;
  }
  export function createServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Server;
}

declare module "node:module" {
  export function createRequire(path: string): { resolve(id: string): string };
}

declare module "node:net" {
  export interface AddressInfo {
    readonly port: number;
  }
  export interface Socket {
    write(data: string): boolean;
    end(data?: string): void;
    destroy(): void;
    pipe<T>(destination: T): T;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
  }
  export function connect(port: number, host: string, listener: () => void): Socket;
}

declare module "node:os" {
  export interface NetworkInterfaceInfo {
    readonly address: string;
    readonly family: string;
    readonly internal: boolean;
  }
  export function networkInterfaces(): Record<string, readonly NetworkInterfaceInfo[] | undefined>;
  export function tmpdir(): string;
}

declare module "node:path" {
  export function basename(path: string, ext?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
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
    readonly argv: readonly string[];
    readonly execPath: string;
    readonly stdin: StdioStream;
    readonly stdout: StdioStream;
    cwd(): string;
    exit(code?: number): never;
    once(event: string, listener: () => void): void;
  }
  const process: Process;
  export default process;
  export const env: Process["env"];
  export const argv: Process["argv"];
  export const execPath: Process["execPath"];
  export function exit(code?: number): never;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
}
