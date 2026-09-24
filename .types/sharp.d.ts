// Minimal stub for sharp — only the methods used by src/assets/build/icons.ts and rasters.ts.
// sharp is an optional peer dep; projects not using icons or rasters need not install it.
declare module "sharp" {
  interface SharpInstance {
    resize(width: number, height: number): SharpInstance;
    resize(options: { width?: number; height?: number }): SharpInstance;
    png(options?: Record<string, unknown>): SharpInstance;
    toBuffer(): Promise<Uint8Array>;
    toFile(path: string): Promise<{ width: number; height: number }>;
  }
  export default function sharp(input: Uint8Array, options?: { density?: number }): SharpInstance;
}
