// Minimal ambient declarations for `bun:sqlite`, restricted to what the warden index uses.
// Avoids bun-types, which overrides the DOM and Workers globals forge's runtime sources depend on.

declare module "bun:sqlite" {
  interface Statement<Row = unknown> {
    all(...params: unknown[]): Row[];
    get(...params: unknown[]): Row | null;
    run(...params: unknown[]): void;
    finalize(): void;
  }

  export class Database {
    constructor(path: string, options?: { create?: boolean; readonly?: boolean; strict?: boolean });
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): void;
    query<Row = unknown>(sql: string): Statement<Row>;
    prepare<Row = unknown>(sql: string): Statement<Row>;
    transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result;
    close(): void;
  }
}
