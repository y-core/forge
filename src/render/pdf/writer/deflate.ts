import { PDF_ENCODER } from "./objects";

// Binary callers — the cross-reference rows and an object stream's payload — must not be re-encoded:
// UTF-8 would rewrite every byte at or above 0x80 and desynchronize every offset that follows it.
/** One stream deflated, as the bytes a `/FlateDecode` entry then declares. @internal */
export async function deflate(stream: string | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const compressor = new CompressionStream("deflate");
  const written = new Blob([typeof stream === "string" ? PDF_ENCODER.encode(stream) : stream]).stream().pipeThrough(compressor);
  return new Uint8Array(await new Response(written).arrayBuffer());
}
