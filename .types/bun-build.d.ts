// Minimal ambient declarations for Bun global APIs used in build-time and test code.
// Restricted to APIs actually used in forge; avoids bun-types which overrides DOM fetch.

declare const Bun: {
  write(path: string, data: string | Uint8Array | ArrayBufferLike): Promise<number>;
  file(path: string): BunFile;
};

interface BunFile {
  exists(): Promise<boolean>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
