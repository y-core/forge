import { describe, expect, it } from "bun:test";

import { createLogger } from "../../logging/logger";
import type { LogRecord } from "../../logging/types";
import { err, ok } from "../../result/result";
import { AuthStoreError } from "../errors";
import type { AuthMessage, AuthNotifier, AuthSecurityNotice } from "../types";
import { createSecurityNotices } from "./security-notices";

const NOTICE: AuthSecurityNotice = { type: "factor-added", factorKind: "passkey", at: 9_000 };

function capturingLogger() {
  const records: { level: string; message: string; data: Record<string, unknown> | undefined }[] = [];
  const logger = createLogger("auth/flows", {
    channels: [{ write: (record: LogRecord) => void records.push({ level: record.level, message: record.message, data: record.data }) }],
  });
  return { logger, records };
}

function scene(send: AuthNotifier["send"]) {
  const deferred: Promise<unknown>[] = [];
  const captured = capturingLogger();
  const notices = createSecurityNotices({ notifier: { send }, defer: (work) => void deferred.push(work), logger: captured.logger });
  return { notices, deferred, records: captured.records };
}

describe("createSecurityNotices", () => {
  it("hands the notifier one security-event message to the address given, with a live abort signal", async () => {
    const sent: { message: AuthMessage; aborted: boolean }[] = [];
    const built = scene(async (message, signal) => (sent.push({ message, aborted: signal.aborted }), ok()));
    built.notices.send("ada@example.com", NOTICE);
    await Promise.all(built.deferred);
    expect(sent).toEqual([{ message: { to: "ada@example.com", kind: "security-event", notice: NOTICE }, aborted: false }]);
  });

  it("defers the delivery and returns before it runs, so a slow notifier holds no response", () => {
    let called = false;
    const built = scene(async () => ((called = true), ok()));
    built.notices.send("ada@example.com", NOTICE);
    expect({ deferred: built.deferred.length, called }).toEqual({ deferred: 1, called: false });
  });

  it("logs a notifier that refuses, rejects or throws as `auth.security-notice.failed`, never naming the address and never throwing", async () => {
    const refusal = new AuthStoreError("unavailable", "notifier.send");
    const outage = new Error("SMTP relay refused the connection");
    const senders: AuthNotifier["send"][] = [
      async () => err(refusal),
      () => Promise.reject(outage),
      () => {
        throw outage;
      },
    ];
    const records = [];
    for (const send of senders) {
      const built = scene(send);
      expect(() => built.notices.send("ada@example.com", NOTICE)).not.toThrow();
      await Promise.all(built.deferred);
      records.push(...built.records);
    }
    expect({
      messages: records.map((record) => [record.level, record.message, record.data?.type]),
      addressed: JSON.stringify(records).includes("ada@example.com"),
    }).toEqual({
      messages: [
        ["error", "auth.security-notice.failed", "factor-added"],
        ["error", "auth.security-notice.failed", "factor-added"],
        ["error", "auth.security-notice.failed", "factor-added"],
      ],
      addressed: false,
    });
  });

  it("logs nothing when the notice is delivered", async () => {
    const built = scene(async () => ok());
    built.notices.send("ada@example.com", NOTICE);
    await Promise.all(built.deferred);
    expect(built.records).toEqual([]);
  });
});
