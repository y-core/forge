import { describe, expect, it } from "bun:test";

import type { DeploymentTarget } from "../types";
import { classifyCfError, describeCfFailure } from "./errors";
import type { CfApiClientError, CfApiClientErrorKind, CfApiError } from "./types";
import { CfApiClientError as CfError } from "./types";

const WORKER: DeploymentTarget = { kind: "worker", name: "my-worker" };
const PAGES: DeploymentTarget = { kind: "pages", name: "my-site" };

const fail = (kind: CfApiClientErrorKind, message: string, opts?: { statusCode?: number; cfErrors?: CfApiError[] }): CfApiClientError =>
  new CfError(kind, message, opts);

const cf = (...codes: number[]): CfApiError[] => codes.map((code) => ({ code, message: `upstream ${code}` }));

describe("classifyCfError", () => {
  it("classifies a transport failure as network before looking at any code", () => {
    expect(classifyCfError(fail("network", "socket closed", { statusCode: 404, cfErrors: cf(7003) }))).toBe("network");
  });

  for (const code of [7000, 7003, 10009]) {
    it(`classifies envelope code ${code} as not-found`, () => {
      expect(classifyCfError(fail("api", "gone", { statusCode: 200, cfErrors: cf(code) }))).toBe("not-found");
    });
  }

  for (const code of [9106, 9107, 9109, 10000]) {
    it(`classifies envelope code ${code} as auth`, () => {
      expect(classifyCfError(fail("api", "rejected", { statusCode: 400, cfErrors: cf(code) }))).toBe("auth");
    });
  }

  it("prefers not-found when one envelope carries both classes", () => {
    expect(classifyCfError(fail("api", "mixed", { cfErrors: cf(10000, 7003) }))).toBe("not-found");
  });

  it("finds the recognised code behind unrecognised ones", () => {
    expect(classifyCfError(fail("api", "mixed", { cfErrors: cf(1, 2, 9106) }))).toBe("auth");
  });

  for (const [status, expected] of [
    [404, "not-found"],
    [401, "auth"],
    [403, "auth"],
  ] as const) {
    it(`falls back to HTTP ${status} as ${expected} when no code is recognised`, () => {
      expect(classifyCfError(fail("api", "x", { statusCode: status, cfErrors: cf(1234) }))).toBe(expected);
    });
  }

  it("lets a recognised code override the HTTP status, which is the whole reason the status is only a hint", () => {
    expect(classifyCfError(fail("api", "x", { statusCode: 404, cfErrors: cf(10000) }))).toBe("auth");
  });

  for (const status of [400, 429, 500]) {
    it(`classifies an unrecognised failure at HTTP ${status} as other`, () => {
      expect(classifyCfError(fail("api", "x", { statusCode: status, cfErrors: cf(1234) }))).toBe("other");
    });
  }

  it("classifies a parse failure with no status and no codes as other", () => {
    expect(classifyCfError(fail("parse", "bad json"))).toBe("other");
  });

  it("classifies an empty envelope error list as other", () => {
    expect(classifyCfError(fail("api", "x", { cfErrors: [] }))).toBe("other");
  });
});

describe("describeCfFailure — not-found", () => {
  it("names the worker script and the name that was missing", () => {
    expect(describeCfFailure(fail("api", "Could not route", { statusCode: 404, cfErrors: cf(7003) }), WORKER)).toBe(
      "worker script not found: my-worker",
    );
  });

  it("names the pages project and the name that was missing", () => {
    expect(describeCfFailure(fail("api", "Could not route", { statusCode: 404 }), PAGES)).toBe("pages project not found: my-site");
  });

  it("never quotes upstream text, so redaction changes nothing", () => {
    const error = fail("api", "secret=hunter2 was rejected", { statusCode: 404 });
    expect(describeCfFailure(error, WORKER, { redactMessage: true })).toBe("worker script not found: my-worker");
  });
});

describe("describeCfFailure — auth", () => {
  it("names the worker permission and the code returned", () => {
    expect(describeCfFailure(fail("api", "Authentication error", { statusCode: 400, cfErrors: cf(10000) }), WORKER)).toBe(
      'auth failed — CLOUDFLARE_API_TOKEN is rejected or lacks "Workers Scripts" (Read to report, Edit to change) · code 10000',
    );
  });

  it("names the pages permission", () => {
    expect(describeCfFailure(fail("api", "Authentication error", { statusCode: 403, cfErrors: cf(9106) }), PAGES)).toBe(
      'auth failed — CLOUDFLARE_API_TOKEN is rejected or lacks "Cloudflare Pages" (Read to report, Edit to change) · code 9106',
    );
  });

  it("drops the code clause when the envelope carried none", () => {
    expect(describeCfFailure(fail("api", "Forbidden", { statusCode: 403 }), WORKER)).toBe(
      'auth failed — CLOUDFLARE_API_TOKEN is rejected or lacks "Workers Scripts" (Read to report, Edit to change)',
    );
  });

  it("quotes the first code when several were returned", () => {
    expect(describeCfFailure(fail("api", "x", { cfErrors: cf(9107, 9109) }), WORKER)).toBe(
      'auth failed — CLOUDFLARE_API_TOKEN is rejected or lacks "Workers Scripts" (Read to report, Edit to change) · code 9107',
    );
  });

  it("never quotes upstream text, so redaction changes nothing", () => {
    const error = fail("api", "token secret=hunter2 is invalid", { statusCode: 401 });
    expect(describeCfFailure(error, WORKER, { redactMessage: true })).toBe(
      'auth failed — CLOUDFLARE_API_TOKEN is rejected or lacks "Workers Scripts" (Read to report, Edit to change)',
    );
  });
});

describe("describeCfFailure — network", () => {
  it("quotes the message, which is the only information a transport failure carries", () => {
    expect(describeCfFailure(fail("network", "fetch failed"), WORKER)).toBe("network error — fetch failed");
  });

  it("withholds the message when the request carried a secret", () => {
    expect(describeCfFailure(fail("network", "POST body secret=hunter2 failed"), WORKER, { redactMessage: true })).toBe("network error");
  });
});

describe("describeCfFailure — other", () => {
  it("returns the upstream message unchanged", () => {
    expect(describeCfFailure(fail("api", "Invalid binding name", { statusCode: 400, cfErrors: cf(1234) }), WORKER)).toBe("Invalid binding name");
  });

  it("returns a parse failure's message unchanged", () => {
    expect(describeCfFailure(fail("parse", "Unexpected token < in JSON"), PAGES)).toBe("Unexpected token < in JSON");
  });

  it("replaces the message with the code and status when redaction is asked for", () => {
    const error = fail("api", "value secret=hunter2 is not permitted", { statusCode: 400, cfErrors: cf(1234) });
    expect(describeCfFailure(error, WORKER, { redactMessage: true })).toBe(
      "request failed — Cloudflare error 1234 — HTTP 400 (message withheld: it can echo the request body)",
    );
  });

  it("names the status alone when the envelope carried no code", () => {
    expect(describeCfFailure(fail("api", "secret=hunter2", { statusCode: 500 }), WORKER, { redactMessage: true })).toBe(
      "request failed — HTTP 500 (message withheld: it can echo the request body)",
    );
  });

  it("names the code alone when there was no status", () => {
    expect(describeCfFailure(fail("api", "secret=hunter2", { cfErrors: cf(1234) }), WORKER, { redactMessage: true })).toBe(
      "request failed — Cloudflare error 1234 (message withheld: it can echo the request body)",
    );
  });

  it("says only that the request failed when it has neither code nor status", () => {
    expect(describeCfFailure(fail("parse", "secret=hunter2"), WORKER, { redactMessage: true })).toBe(
      "request failed (message withheld: it can echo the request body)",
    );
  });

  it("treats an omitted options object as unredacted", () => {
    expect(describeCfFailure(fail("api", "Invalid binding name", { statusCode: 400 }), WORKER)).toBe("Invalid binding name");
  });
});
