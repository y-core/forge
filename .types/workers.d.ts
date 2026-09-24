// Minimal ambient declarations for Cloudflare Workers runtime globals.
// Avoids pulling in @cloudflare/workers-types which conflicts with DOM types.

/** Cloudflare Workers execution context — provides `waitUntil` and `passThroughOnException`. */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
