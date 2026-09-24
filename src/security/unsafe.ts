/** CSP opt-out placeholder for `'unsafe-inline'` — makes the per-request nonce decorative. @public */
export const UNSAFE_INLINE: unique symbol = Symbol("@y-core/forge/csp-unsafe-inline");

/** CSP opt-out placeholder for `'unsafe-eval'` — re-enables `new Function` and `eval`. @public */
export const UNSAFE_EVAL: unique symbol = Symbol("@y-core/forge/csp-unsafe-eval");

/** CSP opt-out placeholder for `'unsafe-hashes'` — admits hashed inline event handlers. @public */
export const UNSAFE_HASHES: unique symbol = Symbol("@y-core/forge/csp-unsafe-hashes");

/** CSP opt-out placeholder for `'wasm-unsafe-eval'` — WebAssembly compilation only. @public */
export const WASM_UNSAFE_EVAL: unique symbol = Symbol("@y-core/forge/csp-wasm-unsafe-eval");

// The one table: the string spelling the validator refuses, and the export name its message names.
export const UNSAFE_CSP_SOURCES = [
  { placeholder: UNSAFE_INLINE, token: "'unsafe-inline'", exportName: "UNSAFE_INLINE" },
  { placeholder: UNSAFE_EVAL, token: "'unsafe-eval'", exportName: "UNSAFE_EVAL" },
  { placeholder: UNSAFE_HASHES, token: "'unsafe-hashes'", exportName: "UNSAFE_HASHES" },
  { placeholder: WASM_UNSAFE_EVAL, token: "'wasm-unsafe-eval'", exportName: "WASM_UNSAFE_EVAL" },
] as const satisfies readonly { placeholder: symbol; token: string; exportName: string }[];
