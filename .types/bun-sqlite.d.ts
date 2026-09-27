// Minimal ambient declarations for `bun:sqlite`, restricted to what the warden index uses.
// Avoids bun-types, which overrides the DOM and Workers globals forge's runtime sources depend on.

declare module "bun:sqlite" {
  type TypedArray =
    | Uint8Array
    | Uint8ClampedArray
    | Uint16Array
    | Uint32Array
    | Int8Array
    | Int16Array
    | Int32Array
    | BigUint64Array
    | BigInt64Array
    | Float32Array
    | Float64Array;

  export type SQLQueryBindings =
    | string
    | bigint
    | TypedArray
    | number
    | boolean
    | null
    | Record<string, string | bigint | TypedArray | number | boolean | null>;

  export interface Changes {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface DatabaseOptions {
    readonly?: boolean;
    create?: boolean;
    readwrite?: boolean;
    safeIntegers?: boolean;
    strict?: boolean;
  }

  export class Statement<ReturnType = unknown, ParamsType extends SQLQueryBindings[] = any[]> {
    all(...params: ParamsType): ReturnType[];
    get(...params: ParamsType): ReturnType | null;
    run(...params: ParamsType): Changes;
    finalize(): void;
  }

  export class Database {
    constructor(filename?: string, options?: number | DatabaseOptions);
    run<ParamsType extends SQLQueryBindings[]>(sql: string, ...bindings: ParamsType[]): Changes;
    exec<ParamsType extends SQLQueryBindings[]>(sql: string, ...bindings: ParamsType[]): Changes;
    query<ReturnType, ParamsType extends SQLQueryBindings | SQLQueryBindings[]>(
      sql: string,
    ): Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]>;
    prepare<ReturnType, ParamsType extends SQLQueryBindings | SQLQueryBindings[]>(
      sql: string,
      params?: ParamsType,
    ): Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]>;
    transaction<A extends any[], T>(
      insideTransaction: (...args: A) => T,
    ): { (...args: A): T; deferred: (...args: A) => T; immediate: (...args: A) => T; exclusive: (...args: A) => T };
    close(throwOnError?: boolean): void;
  }
}
