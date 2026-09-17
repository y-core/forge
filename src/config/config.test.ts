import { describe, expect, it } from "bun:test";

import { v } from "../validation/mod";
import { applyMapping, createConfig, env, optionalGroup, requiredGroup, resolveConfig } from "./config";

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

  it("treats a blank required field as absent, so an unset secret does not switch the feature on", () => {
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

describe("optionalGroup — a falsy required value is present, but a blank one is absent", () => {
  const group = optionalGroup({ count: v.unknown(), flag: v.unknown(), label: v.unknown() }, { required: "all" });

  it("treats the value 0 as present (not absent)", () => {
    const result = v.parse(group, { count: 0, flag: true, label: "x" });
    expect(result).not.toBeNull();
    expect((result as { count: number }).count).toBe(0);
  });

  it("treats an empty string as absent", () => {
    const result = v.parse(group, { count: 1, flag: true, label: "" });
    expect(result).toBeNull();
  });

  it("treats false as present (not absent)", () => {
    const result = v.parse(group, { count: 1, flag: false, label: "x" });
    expect(result).not.toBeNull();
    expect((result as { flag: boolean }).flag).toBe(false);
  });

  it("treats null as absent and returns null", () => {
    const result = v.parse(group, { count: null, flag: true, label: "x" });
    expect(result).toBeNull();
  });

  it("treats undefined as absent and returns null", () => {
    const result = v.parse(group, { count: undefined, flag: true, label: "x" });
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

  it("fills a blank optional field from its default rather than carrying the blank through", () => {
    const result = v.parse(emailGroup, { apiKey: "key", apiUrl: "", from: "from@example.com", to: "to@example.com" }) as { apiUrl: string };
    expect(result.apiUrl).toBe("https://api.mailchannels.net/tx/v1/send");
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

describe("requiredGroup — a missing key is an error, never a silent absence", () => {
  // A bot guard that can vanish is the case the builder exists for: the same entries as
  // `turnstileGroup` above, resolving to a thrown env error instead of `null`.
  const turnstile = requiredGroup({ secretKey: v.string(), siteKey: v.string() });

  it("throws at the config boundary naming the missing key, not just the group", () => {
    const schema = v.object({ turnstile });
    const cfg = createConfig({ turnstile: { secretKey: env("TURNSTILE_SECRET_KEY"), siteKey: env("TURNSTILE_SITE_KEY") } }, schema);
    expect(() => cfg.get({ TURNSTILE_SITE_KEY: "site" })).toThrow(new Error("Invalid environment: turnstile.secretKey: missing"));
  });

  it("names every missing key when more than one is absent", () => {
    const schema = v.object({ turnstile });
    const cfg = createConfig({ turnstile: { secretKey: env("TURNSTILE_SECRET_KEY"), siteKey: env("TURNSTILE_SITE_KEY") } }, schema);
    expect(() => cfg.get({})).toThrow(new Error("Invalid environment: turnstile.secretKey: missing; turnstile.siteKey: missing"));
  });

  it("resolves the group when every key is present", () => {
    expect(v.parse(turnstile, { secretKey: "sk", siteKey: "site" })).toEqual({ secretKey: "sk", siteKey: "site" });
  });

  it("fills a missing key from its default rather than failing", () => {
    const group = requiredGroup({ apiKey: v.string(), apiUrl: v.string() }, { defaults: { apiUrl: "https://api.example.com" } });
    expect(v.parse(group, { apiKey: "key" })).toEqual({ apiKey: "key", apiUrl: "https://api.example.com" });
  });

  it("reports a blank key as missing, by the same message an absent one gets", () => {
    const schema = v.object({ turnstile });
    const cfg = createConfig({ turnstile: { secretKey: env("TURNSTILE_SECRET_KEY"), siteKey: env("TURNSTILE_SITE_KEY") } }, schema);
    expect(() => cfg.get({ TURNSTILE_SECRET_KEY: "", TURNSTILE_SITE_KEY: "site" })).toThrow(
      new Error("Invalid environment: turnstile.secretKey: missing"),
    );
  });

  it("fills a blank key from its default, as it does an absent one", () => {
    const group = requiredGroup({ apiKey: v.string(), apiUrl: v.string() }, { defaults: { apiUrl: "https://api.example.com" } });
    expect(v.parse(group, { apiKey: "key", apiUrl: "" })).toEqual({ apiKey: "key", apiUrl: "https://api.example.com" });
  });

  it("validates each entry against its own schema", () => {
    const result = v.safeParse(requiredGroup({ apiKey: v.string() }), { apiKey: 42 });
    expect(result.success).toBe(false);
    expect(result.issues?.[0]?.message).toBe("Invalid type: Expected string but received 42");
  });

  it("does not resolve to null when the group is absent entirely", () => {
    const result = v.safeParse(turnstile, undefined);
    expect(result.success).toBe(false);
    expect(result.output).not.toBeNull();
  });
});

describe("requiredGroup — the absence boundary matches optionalGroup's", () => {
  const group = requiredGroup({ count: v.unknown(), flag: v.unknown(), label: v.unknown() });

  it("treats the value 0 as present", () => {
    expect(v.parse(group, { count: 0, flag: true, label: "x" })).toEqual({ count: 0, flag: true, label: "x" });
  });

  it("treats an empty string as absent and refuses", () => {
    expect(v.safeParse(group, { count: 1, flag: true, label: "" }).success).toBe(false);
  });

  // `optionalGroup` and `requiredGroup` differ in what absence costs, not in what counts as absent:
  // the same blank input gates the one to null and refuses here.
  it("differs from optionalGroup on a blank required key only in the answer", () => {
    const lenient = optionalGroup({ count: v.unknown(), flag: v.unknown(), label: v.unknown() }, { required: "all" });
    expect(v.parse(lenient, { count: 1, flag: true, label: "" })).toBeNull();
    expect(v.safeParse(group, { count: 1, flag: true, label: "" }).success).toBe(false);
  });

  it("treats false as present", () => {
    expect(v.parse(group, { count: 1, flag: false, label: "x" })).toEqual({ count: 1, flag: false, label: "x" });
  });

  it("treats null as absent and refuses", () => {
    expect(v.safeParse(group, { count: null, flag: true, label: "x" }).success).toBe(false);
  });

  it("treats undefined as absent and refuses", () => {
    expect(v.safeParse(group, { count: undefined, flag: true, label: "x" }).success).toBe(false);
  });

  it("differs visibly from optionalGroup, which gates the same input to null", () => {
    const lenient = optionalGroup({ count: v.unknown(), flag: v.unknown(), label: v.unknown() }, { required: "all" });
    expect(v.parse(lenient, { count: null, flag: true, label: "x" })).toBeNull();
    expect(v.safeParse(group, { count: null, flag: true, label: "x" }).success).toBe(false);
  });
});

describe("optionalGroup — validates each entry against its own schema", () => {
  const group = optionalGroup(
    { apiKey: v.string(), apiUrl: v.string() },
    { required: ["apiKey"], defaults: { apiUrl: "https://api.example.com" } },
  );

  it("rejects a number supplied for an entry declared string", () => {
    const result = v.safeParse(group, { apiKey: 42 });
    expect(result.success).toBe(false);
    expect(result.issues?.[0]?.message).toBe("Invalid type: Expected string but received 42");
  });

  it("rejects a binding object supplied for an entry declared string", () => {
    const result = v.safeParse(group, { apiKey: { get: () => undefined, put: () => undefined } });
    expect(result.success).toBe(false);
    expect(result.issues?.[0]?.message).toBe("Invalid type: Expected string but received Object");
  });

  it("rejects a value filled in from a default that violates its entry schema", () => {
    const badDefault = optionalGroup({ apiKey: v.string(), retries: v.string() }, { required: ["apiKey"], defaults: { retries: 7 } });
    const result = v.safeParse(badDefault, { apiKey: "key" });
    expect(result.success).toBe(false);
    expect(result.issues?.[0]?.message).toBe("Invalid type: Expected string but received 7");
  });

  it("rejects a non-required entry that has neither a default nor an optional schema", () => {
    const strict = optionalGroup({ apiKey: v.string(), region: v.string() }, { required: ["apiKey"] });
    const result = v.safeParse(strict, { apiKey: "key" });
    expect(result.success).toBe(false);
    expect(result.issues?.[0]?.message).toBe('Invalid key: Expected "region" but received undefined');
  });

  it("accepts an absent non-required entry declared with an optional schema", () => {
    const lenient = optionalGroup({ apiKey: v.string(), region: v.optional(v.string()) }, { required: ["apiKey"] });
    expect(v.parse(lenient, { apiKey: "key" })).toEqual({ apiKey: "key" });
  });

  it("returns the validated values when every entry satisfies its schema", () => {
    expect(v.parse(group, { apiKey: "key", apiUrl: "https://custom.example.com" })).toEqual({
      apiKey: "key",
      apiUrl: "https://custom.example.com",
    });
  });

  it("resolves to null when the group is absent entirely", () => {
    expect(v.parse(group, undefined)).toBeNull();
  });

  it("surfaces an invalid group entry as a normalized env error at the config boundary", () => {
    const schema = v.object({ email: optionalGroup({ apiKey: v.string() }, { required: ["apiKey"] }) });
    const cfg = createConfig({ email: { apiKey: env("EMAIL_API_KEY") } }, schema);
    expect(() => cfg.get({ EMAIL_API_KEY: 42 })).toThrow(new Error("Invalid environment: email.apiKey: string"));
  });
});

describe("optionalGroup — keys not declared in entries are stripped", () => {
  const group = optionalGroup({ siteKey: v.string() }, { required: "all" });

  it("drops an undeclared key from the parsed group", () => {
    expect(v.parse(group, { siteKey: "site", LOG_LEVEL: "debug" })).toEqual({ siteKey: "site" });
  });

  it("keeps an undeclared binding object out of the parsed group", () => {
    const result = v.parse(group, { siteKey: "site", DB: { prepare: () => undefined } }) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(["siteKey"]);
  });
});

const testDescriptor = { map: { dbUrl: env("DB_URL"), mode: env("MODE") }, schema: v.object({ dbUrl: v.string(), mode: v.optional(v.string()) }) };

describe("Config", () => {
  it("createConfig() produces a working config holder", () => {
    const cfg = createConfig(testDescriptor.map, testDescriptor.schema);
    const result = cfg.get({ DB_URL: "postgres://factory" });
    expect(result.dbUrl).toBe("postgres://factory");
  });

  it("get() resolves and returns typed config", () => {
    const cfg = createConfig(testDescriptor.map, testDescriptor.schema);
    const result = cfg.get({ DB_URL: "postgres://singleton" });
    expect(result.dbUrl).toBe("postgres://singleton");
  });

  it("get() returns cached result on second call with the same env object", () => {
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
    const cfg = createConfig({ dbUrl: env("DB_URL") }, countingSchema);
    const boundEnv = { DB_URL: "postgres://cached" };

    cfg.get(boundEnv);
    cfg.get(boundEnv);

    expect(parseCount).toBe(1);
  });

  it("get() resolves independently for two different env objects without reset()", () => {
    const cfg = createConfig(testDescriptor.map, testDescriptor.schema);

    const first = cfg.get({ DB_URL: "postgres://first-env" });
    const second = cfg.get({ DB_URL: "postgres://second-env" });

    expect(first.dbUrl).toBe("postgres://first-env");
    expect(second.dbUrl).toBe("postgres://second-env");
  });

  it("get() throws the exact normalized message on invalid env", () => {
    const cfg = createConfig(testDescriptor.map, testDescriptor.schema);
    expect(() => cfg.get({})).toThrow(new Error("Invalid environment: dbUrl: missing"));
  });

  it("seed() overrides resolution without calling get()", () => {
    const cfg = createConfig(testDescriptor.map, testDescriptor.schema);
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
    const cfg = createConfig({ dbUrl: env("DB_URL") }, countingSchema);
    const boundEnv = { DB_URL: "postgres://same" };

    cfg.get(boundEnv);
    cfg.reset();
    cfg.get(boundEnv);

    expect(parseCount).toBe(2);
  });

  it("applies overrides patch when detect returns true", () => {
    const cfg = createConfig(testDescriptor.map, testDescriptor.schema, {
      detect: (vars) => vars.MODE === "dev",
      patch: (config) => ({ ...config, dbUrl: "dev://override" }),
    });

    const result = cfg.get({ DB_URL: "postgres://prod", MODE: "dev" });
    expect(result.dbUrl).toBe("dev://override");
  });
});

describe("resolveConfig", () => {
  it("returns the store's resolved config when a store is given", () => {
    const cfg = createConfig(testDescriptor.map, testDescriptor.schema);
    const resolved = resolveConfig(cfg, { DB_URL: "postgres://resolved" });
    expect(resolved).toEqual({ dbUrl: "postgres://resolved", mode: undefined });
  });

  it("returns an empty object when no store is registered", () => {
    expect(resolveConfig(undefined, { ANY: "thing" })).toEqual({});
  });
});
