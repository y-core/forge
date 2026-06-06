import { describe, expect, it } from "bun:test";
import { v } from "../validation/mod";
import { applyMapping, Config, env, optionalGroup } from "./config";

// --- applyMapping ---

describe("applyMapping", () => {
  it("returns a literal string value as-is", () => {
    expect(applyMapping({}, "https://api.example.com")).toBe("https://api.example.com");
  });

  it("returns the env value for a leaf env ref", () => {
    expect(applyMapping({ DB_URL: "postgres://localhost" }, env("DB_URL"))).toBe("postgres://localhost");
  });

  it("returns undefined for an env ref not in env", () => {
    expect(applyMapping({}, env("DB_URL"))).toBeUndefined();
  });

  it("maps a flat object shape", () => {
    const result = applyMapping({ DB_URL: "postgres://localhost", PORT: "5432" }, { dbUrl: env("DB_URL"), port: env("PORT") });
    expect(result).toEqual({ dbUrl: "postgres://localhost", port: "5432" });
  });

  it("maps a nested object shape", () => {
    const result = applyMapping(
      { BASE_URL: "https://example.com", CSRF_SECRET: "abc" },
      { site: { url: env("BASE_URL") }, security: { csrf: { secret: env("CSRF_SECRET") } } },
    );
    expect(result).toEqual({ site: { url: "https://example.com" }, security: { csrf: { secret: "abc" } } });
  });

  it("produces undefined for env vars absent from the binding", () => {
    const result = applyMapping(
      { BASE_URL: "https://example.com" },
      { site: { url: env("BASE_URL") }, services: { email: { apiKey: env("EMAIL_API_KEY") } } },
    );
    expect((result as { services: { email: { apiKey: unknown } } }).services.email.apiKey).toBeUndefined();
  });

  it("handles a deeply nested map without losing keys", () => {
    const result = applyMapping({ A: "1", B: "2", C: "3" }, { x: { y: { z: env("A") } }, p: env("B"), q: env("C") });
    expect(result).toEqual({ x: { y: { z: "1" } }, p: "2", q: "3" });
  });

  it("mixes env refs and literal values in nested maps", () => {
    const result = applyMapping({ API_KEY: "secret" }, { apiKey: env("API_KEY"), apiUrl: "https://api.example.com" });
    expect(result).toEqual({ apiKey: "secret", apiUrl: "https://api.example.com" });
  });
});

// --- optionalGroup ---

const emailEntries = { apiKey: v.string(), apiUrl: v.string(), from: v.string(), senderName: v.string(), to: v.string() };

const emailGroup = optionalGroup(emailEntries, {
  required: ["apiKey", "from", "to"],
  defaults: { apiUrl: "https://api.mailchannels.net/tx/v1/send", senderName: "Default Sender" },
});

const turnstileGroup = optionalGroup({ secretKey: v.string(), siteKey: v.string() }, { required: "all" });

describe("optionalGroup — null when required fields missing", () => {
  it("returns null when all fields are absent", () => {
    const result = v.parse(emailGroup, {});
    expect(result).toBeNull();
  });

  it("returns null when only some required fields are present", () => {
    const result = v.parse(emailGroup, { apiKey: "key" });
    expect(result).toBeNull();
  });

  it("returns null when a required field is an empty string", () => {
    const result = v.parse(emailGroup, { apiKey: "key", from: "", to: "to@example.com" });
    expect(result).toBeNull();
  });

  it("returns null when required: all and any field is missing", () => {
    const result = v.parse(turnstileGroup, { secretKey: "sk" });
    expect(result).toBeNull();
  });

  it("returns null for turnstile when both fields are absent", () => {
    const result = v.parse(turnstileGroup, {});
    expect(result).toBeNull();
  });
});

describe("optionalGroup — returns group when required fields present", () => {
  it("returns the object when all required fields are present", () => {
    const result = v.parse(emailGroup, { apiKey: "key", from: "from@example.com", to: "to@example.com" });
    expect(result).not.toBeNull();
    expect((result as { apiKey: string }).apiKey).toBe("key");
  });

  it("applies defaults for missing optional fields", () => {
    const result = v.parse(emailGroup, { apiKey: "key", from: "from@example.com", to: "to@example.com" }) as {
      apiUrl: string;
      senderName: string;
    } | null;
    expect(result?.apiUrl).toBe("https://api.mailchannels.net/tx/v1/send");
    expect(result?.senderName).toBe("Default Sender");
  });

  it("uses provided value over default when field is present", () => {
    const result = v.parse(emailGroup, { apiKey: "key", apiUrl: "https://custom.api.com", from: "from@example.com", to: "to@example.com" }) as {
      apiUrl: string;
    } | null;
    expect(result?.apiUrl).toBe("https://custom.api.com");
  });

  it("passes through all fields when all are present", () => {
    const result = v.parse(turnstileGroup, { secretKey: "sk", siteKey: "site" });
    expect(result).toEqual({ secretKey: "sk", siteKey: "site" });
  });
});

// --- Config<T> ---

const testDescriptor = { map: { dbUrl: env("DB_URL"), mode: env("MODE") }, schema: v.object({ dbUrl: v.string(), mode: v.optional(v.string()) }) };

describe("Config", () => {
  it("get() resolves and returns typed config", () => {
    const cfg = new Config(testDescriptor.map, testDescriptor.schema);
    const result = cfg.get({ DB_URL: "postgres://singleton" });
    expect(result.dbUrl).toBe("postgres://singleton");
  });

  it("get() returns cached result on second call", () => {
    let parseCount = 0;
    const countingSchema = v.object({
      dbUrl: v.pipe(
        v.string(),
        v.transform((s) => {
          parseCount++;
          return s;
        }),
      ),
    });
    const cfg = new Config({ dbUrl: env("DB_URL") }, countingSchema);

    cfg.get({ DB_URL: "postgres://cached" });
    cfg.get({ DB_URL: "postgres://cached" });

    expect(parseCount).toBe(1);
  });

  it("get() throws on invalid env", () => {
    const cfg = new Config(testDescriptor.map, testDescriptor.schema);
    expect(() => cfg.get({})).toThrow("Invalid environment");
  });

  it("seed() overrides resolution without calling get()", () => {
    const cfg = new Config(testDescriptor.map, testDescriptor.schema);
    cfg.seed({ dbUrl: "seeded://db", mode: undefined });
    expect(cfg.get({ DB_URL: "postgres://other" })).toEqual({ dbUrl: "seeded://db", mode: undefined });
  });

  it("reset() clears cached value, forcing re-resolution on next get()", () => {
    let parseCount = 0;
    const countingSchema = v.object({
      dbUrl: v.pipe(
        v.string(),
        v.transform((s) => {
          parseCount++;
          return s;
        }),
      ),
    });
    const cfg = new Config({ dbUrl: env("DB_URL") }, countingSchema);

    cfg.get({ DB_URL: "postgres://first" });
    cfg.reset();
    cfg.get({ DB_URL: "postgres://second" });

    expect(parseCount).toBe(2);
  });

  it("applies overrides patch when detect returns true", () => {
    const cfg = new Config(testDescriptor.map, testDescriptor.schema, {
      detect: (env) => env.MODE === "dev",
      patch: (config) => ({ ...config, dbUrl: "dev://override" }),
    });

    const result = cfg.get({ DB_URL: "postgres://prod", MODE: "dev" });
    expect(result.dbUrl).toBe("dev://override");
  });
});
