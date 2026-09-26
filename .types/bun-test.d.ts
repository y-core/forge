// A stub rather than bun-types: its `expect(actual?: never)` overload beats an any-typed value, so
// `expect(await response.json()).toEqual(…)` resolves to `Matchers<undefined>` and fails to typecheck.

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
  export function beforeAll(fn: TestFn, timeout?: number): void;
  export function afterAll(fn: TestFn, timeout?: number): void;
  export function beforeEach(fn: TestFn, timeout?: number): void;
  export function afterEach(fn: TestFn, timeout?: number): void;
}
