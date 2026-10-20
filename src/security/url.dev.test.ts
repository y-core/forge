import { describe, expect, it } from "bun:test";

import { devExtraOrigins, parseExtraOrigin, readDevOrigins } from "./url.dev";

describe("parseExtraOrigin", () => {
  it("returns a normalized https or loopback origin unchanged", () => {
    expect(parseExtraOrigin("https://x.example")).toBe("https://x.example");
    expect(parseExtraOrigin("http://localhost:8787")).toBe("http://localhost:8787");
    expect(parseExtraOrigin("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  });
});

describe("readDevOrigins", () => {
  const cases: { name: string; env: unknown; expected: readonly string[] }[] = [
    { name: "an env without the binding", env: {}, expected: [] },
    { name: "an empty binding", env: { FORGE_DEV_ORIGINS: "" }, expected: [] },
    { name: "a binding of separators and spaces", env: { FORGE_DEV_ORIGINS: " , ,, " }, expected: [] },
    { name: "a binding that is not a string", env: { FORGE_DEV_ORIGINS: ["https://x.example"] }, expected: [] },
    { name: "a null env", env: null, expected: [] },
    { name: "an undefined env", env: undefined, expected: [] },
    { name: "an env that is a string", env: "FORGE_DEV_ORIGINS=https://x.example", expected: [] },
    { name: "a single origin", env: { FORGE_DEV_ORIGINS: "https://x.example" }, expected: ["https://x.example"] },
    {
      name: "a comma-separated list, trimmed, with empty entries dropped",
      env: { FORGE_DEV_ORIGINS: " https://x.example ,, http://localhost:8787,http://127.0.0.1:9000 , " },
      expected: ["https://x.example", "http://localhost:8787", "http://127.0.0.1:9000"],
    },
  ];

  for (const { name, env, expected } of cases) {
    it(`reads ${name}`, () => {
      expect(readDevOrigins(env)).toEqual(expected);
    });
  }

  const refusals: { entry: string; message: string }[] = [
    { entry: "not-a-url", message: "FORGE_DEV_ORIGINS entry is not a normalized origin: not-a-url" },
    { entry: "https://x.example/", message: "FORGE_DEV_ORIGINS entry is not a normalized origin: https://x.example/" },
    { entry: "https://x.example/app", message: "FORGE_DEV_ORIGINS entry is not a normalized origin: https://x.example/app" },
    {
      entry: "ws://localhost:8787",
      message:
        "FORGE_DEV_ORIGINS entry must use https: (http://localhost and http://127.0.0.1 are allowed for local development): ws://localhost:8787",
    },
    {
      entry: "ftp://localhost",
      message: "FORGE_DEV_ORIGINS entry must use https: (http://localhost and http://127.0.0.1 are allowed for local development): ftp://localhost",
    },
    { entry: "https://X.example", message: "FORGE_DEV_ORIGINS entry is not a normalized origin: https://X.example" },
    {
      entry: "http://x.example",
      message:
        "FORGE_DEV_ORIGINS entry must use https: (http://localhost and http://127.0.0.1 are allowed for local development): http://x.example",
    },
  ];

  for (const { entry, message } of refusals) {
    it(`throws on the bad entry \`${entry}\` even beside a good one`, () => {
      expect(() => readDevOrigins({ FORGE_DEV_ORIGINS: `https://ok.example, ${entry}` })).toThrow(new Error(message));
    });
  }
});

describe("devExtraOrigins", () => {
  it("admits no origin the binding names, in a run that does not arm the development build", () => {
    expect(devExtraOrigins({ FORGE_DEV_ORIGINS: "https://x.example" })).toEqual([]);
  });

  it("stays silent on a bad entry it does not read, in a run that does not arm the development build", () => {
    expect(devExtraOrigins({ FORGE_DEV_ORIGINS: "not-a-url" })).toEqual([]);
  });
});
