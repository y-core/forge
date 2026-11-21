// Module declarations rather than bun-types, which puts `Bun` and node's globals into scope over the Workers ones, and whose
// `expect(actual?: never)` overload beats an any-typed value, so `expect(await response.json()).toEqual(…)` fails to typecheck.

declare module "bun:test" {
  type AnyFn = (...args: any[]) => any;

  export interface Mock<T extends AnyFn = AnyFn> {
    (...args: Parameters<T>): ReturnType<T>;
    mock: { calls: Parameters<T>[]; results: { type: "return" | "throw"; value: ReturnType<T> }[] };
    mockImplementation(fn: T): this;
    mockReturnValue(value: ReturnType<T>): this;
    mockReturnValueOnce(value: ReturnType<T>): this;
    mockResolvedValue(value: Awaited<ReturnType<T>>): this;
    mockResolvedValueOnce(value: Awaited<ReturnType<T>>): this;
    mockClear(): this;
    mockReset(): this;
    mockRestore(): this;
  }

  export const mock: { <T extends AnyFn>(fn?: T): Mock<T>; module(id: string, factory: () => any): void | Promise<void>; restore(): void };

  export function spyOn<T extends object, K extends keyof T>(object: T, method: K): Mock<T[K] extends AnyFn ? T[K] : AnyFn>;

  export function expect(value?: any): any;

  type TestFn = () => void | Promise<void>;
  interface TestCase {
    (name: string, fn: TestFn, timeout?: number): void;
    /** Skips the case when the condition holds. */
    skipIf(condition: boolean): (name: string, fn: TestFn, timeout?: number) => void;
    todo(name: string, fn?: TestFn, timeout?: number): void;
  }
  export function describe(name: string, fn: () => void): void;
  export const it: TestCase;
  export const test: typeof it;
  export function setSystemTime(time?: Date | number): void;
  export function beforeAll(fn: TestFn, timeout?: number): void;
  export function afterAll(fn: TestFn, timeout?: number): void;
  export function beforeEach(fn: TestFn, timeout?: number): void;
  export function afterEach(fn: TestFn, timeout?: number): void;
}

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
    readonly columnNames: string[];
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
    serialize(): Uint8Array;
    static deserialize(data: Uint8Array, options?: { readonly?: boolean; strict?: boolean }): Database;
    close(throwOnError?: boolean): void;
  }
}
