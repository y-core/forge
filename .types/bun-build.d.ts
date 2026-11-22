// What forge's own program imports from "bun" beyond the shipped `src/testing/bun.d.ts`, as a module so no global `Bun` is declared.

declare module "bun" {
  // The read side of the MCP stdio transport.
  const stdin: { stream(): AsyncIterable<Uint8Array> };
}
