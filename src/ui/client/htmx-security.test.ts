import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Mock } from "bun:test";

import { HTMX_TRUSTED_TYPES_POLICY } from "../contracts/htmx-contract";
import { registerHtmxSecurity } from "./htmx-security";
import type { HtmxExtensionHost, HtmxSinkPolicy, TrustedTypesWindow } from "./types";

type Extension = Parameters<HtmxExtensionHost["registerExtension"]>[1];

interface FakeHtmx extends HtmxExtensionHost {
  names: string[];
  extension: Extension | null;
  installed: HtmxSinkPolicy[];
}

function fakeHtmx(accepts = true): FakeHtmx {
  const host: FakeHtmx = {
    names: [],
    extension: null,
    installed: [],
    registerExtension(name, extension) {
      host.names.push(name);
      if (!accepts) return false;
      host.extension = extension;
      extension.init({ initSecurity: (policy) => host.installed.push(policy) });
      return undefined;
    },
  };
  return host;
}

type Rules = { createHTML(input: string): string; createScript(input: string): string };

function fakeWindow(createPolicy?: (name: string, rules: Rules) => HtmxSinkPolicy): TrustedTypesWindow {
  return (createPolicy ? { trustedTypes: { createPolicy } } : {}) as TrustedTypesWindow;
}

const ELEMENT = { localName: "button" } as Element;

function configRequest(host: FakeHtmx, action?: string): false | undefined {
  const detail = action === undefined ? { ctx: { request: {} } } : { ctx: { request: { action } } };
  return host.extension?.htmx_config_request(ELEMENT, detail);
}

let errors: Mock<typeof console.error>;

beforeEach(() => {
  errors = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errors.mockRestore();
});

describe("registerHtmxSecurity", () => {
  it("registers the extension under the Trusted Types policy name", () => {
    const host = fakeHtmx();
    registerHtmxSecurity(host, fakeWindow());
    expect(host.names).toEqual([HTMX_TRUSTED_TYPES_POLICY]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("installs no policy where the browser has no Trusted Types", () => {
    const host = fakeHtmx();
    registerHtmxSecurity(host, fakeWindow());
    expect(host.installed).toEqual([]);
  });

  it("creates the named policy and hands htmx a pass-through for both sinks", () => {
    const host = fakeHtmx();
    const created: Array<{ name: string; rules: Rules }> = [];
    const policy: HtmxSinkPolicy = { createHTML: (s) => s, createScript: (s) => s };
    registerHtmxSecurity(
      host,
      fakeWindow((name, rules) => {
        created.push({ name, rules });
        return policy;
      }),
    );
    expect(created.map((entry) => entry.name)).toEqual([HTMX_TRUSTED_TYPES_POLICY]);
    expect(host.installed).toEqual([policy]);
    expect(created[0]?.rules.createHTML("<p>a</p>")).toBe("<p>a</p>");
    expect(created[0]?.rules.createScript("go()")).toBe("go()");
  });

  it("fails closed when the policy is refused: one error naming it, and a policy that refuses both sinks", () => {
    const host = fakeHtmx();
    registerHtmxSecurity(
      host,
      fakeWindow(() => {
        throw new TypeError("Refused to create a TrustedTypePolicy");
      }),
    );
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain(HTMX_TRUSTED_TYPES_POLICY);
    expect(host.installed).toHaveLength(1);
    const refusing = host.installed[0];
    expect(() => refusing?.createHTML("<p>a</p>")).toThrow(TypeError);
    expect(() => refusing?.createScript("go()")).toThrow(TypeError);
  });

  it("reports once when htmx's extensions allowlist refuses the registration", () => {
    registerHtmxSecurity(fakeHtmx(false), fakeWindow());
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain("allowlist");
    expect(String(errors.mock.calls[0]?.[0])).toContain(HTMX_TRUSTED_TYPES_POLICY);
  });
});

describe("the forge-htmx config-request hook", () => {
  for (const action of ["js:x", "javascript:x"]) {
    it(`cancels a request to ${action}, which htmx would evaluate`, () => {
      const host = fakeHtmx();
      registerHtmxSecurity(host, fakeWindow());
      expect(configRequest(host, action)).toBe(false);
      expect(errors).toHaveBeenCalledTimes(1);
    });
  }

  for (const action of ["/p", "https://h/p", "#x", "JavaScript:x"]) {
    it(`lets a request to ${action} through`, () => {
      const host = fakeHtmx();
      registerHtmxSecurity(host, fakeWindow());
      expect(configRequest(host, action)).toBeUndefined();
      expect(errors).not.toHaveBeenCalled();
    });
  }

  it("lets a request with no action through", () => {
    const host = fakeHtmx();
    registerHtmxSecurity(host, fakeWindow());
    expect(configRequest(host)).toBeUndefined();
    expect(host.extension?.htmx_config_request(ELEMENT, {})).toBeUndefined();
  });
});
