// Minimal ambient declarations for Bun global APIs used in build-time and test code.
// Restricted to APIs actually used in forge; avoids bun-types which overrides DOM fetch.

declare const Bun: {
  write(path: string, data: string | Uint8Array | ArrayBufferLike): Promise<number>;
  file(path: string): BunFile;
  // The read side of the MCP stdio transport.
  readonly stdin: { stream(): AsyncIterable<Uint8Array> };
};

interface BunFile {
  exists(): Promise<boolean>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
