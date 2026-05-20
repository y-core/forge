// Minimal ambient declaration for bun:test.
// The full bun-types package causes overload-resolution conflicts: its
// expect(actual?: never) trap overload beats any-typed values (e.g.
// Response.json() → any → picks Matchers<undefined> → toEqual fails).
// This stub resolves the "Cannot find module 'bun:test'" error while keeping
// test matcher calls unblocked.

declare module "bun:test" {
  type AnyFn = (...args: any[]) => any;

  export interface Mock<T extends AnyFn = AnyFn> {
    (...args: Parameters<T>): ReturnType<T>;
    mock: { calls: Parameters<T>[]; results: { type: "return" | "throw"; value: ReturnType<T> }[] };
    mockImplementation(fn: T): this;
    mockReturnValue(value: ReturnType<T>): this;
    mockClear(): this;
    mockReset(): this;
  }

  export const mock: {
    <T extends AnyFn>(fn?: T): Mock<T>;
    module(id: string, factory: () => any): void | Promise<void>;
    restore(): void;
  };

  export function expect(value?: any): any;

  type TestFn = () => void | Promise<void>;
  export function describe(name: string, fn: () => void): void;
  export const it: (name: string, fn: TestFn, timeout?: number) => void;
  export const test: typeof it;
  export function beforeAll(fn: TestFn, timeout?: number): void;
  export function afterAll(fn: TestFn, timeout?: number): void;
  export function beforeEach(fn: TestFn, timeout?: number): void;
  export function afterEach(fn: TestFn, timeout?: number): void;
}
