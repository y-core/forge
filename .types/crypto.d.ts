interface SubtleCrypto {
  timingSafeEqual?(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
}

interface Crypto {
  readonly DigestStream?: new (
    algorithm: "MD5" | "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512",
  ) => WritableStream<ArrayBufferView> & { readonly digest: Promise<ArrayBuffer> };
}
