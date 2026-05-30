// Minimal stub for sharp — only the methods used by src/assets/build/icons.ts.
// sharp is an optional peer dep; projects not using icons need not install it.
declare module "sharp" {
  interface SharpInstance {
    resize(width: number, height: number): SharpInstance;
    png(options?: Record<string, unknown>): SharpInstance;
    toBuffer(): Promise<Uint8Array>;
  }
  export default function sharp(input: Uint8Array, options?: { density?: number }): SharpInstance;
}
