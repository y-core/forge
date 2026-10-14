/** What `run` settles to, with the bytes every `DecompressionStream` it opened produced along the way. @internal */
export async function inflatedDuring<T>(run: () => Promise<T>): Promise<{ settled: T; produced: number }> {
  const Real = globalThis.DecompressionStream;
  let produced = 0;
  class CountingDecompressionStream implements DecompressionStream {
    readonly writable: WritableStream<BufferSource>;
    readonly readable: ReadableStream<Uint8Array<ArrayBuffer>>;
    constructor(format: CompressionFormat) {
      const real = new Real(format);
      this.writable = real.writable;
      this.readable = real.readable.pipeThrough(
        new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
          transform(chunk, controller) {
            produced += chunk.length;
            controller.enqueue(chunk);
          },
        }),
      );
    }
  }
  globalThis.DecompressionStream = CountingDecompressionStream;
  try {
    return { settled: await run(), produced };
  } finally {
    globalThis.DecompressionStream = Real;
  }
}
