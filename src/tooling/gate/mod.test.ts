import { afterAll, describe, expect, it } from "bun:test";

import { createConsumerInstall, entrySource, OPTIONAL_PEERS, peerSource, TYPECHECK_TIMEOUT } from "../assets/consumer.fixture";

const consumer = createConsumerInstall("forge-gate-consumer");

afterAll(() => {
  consumer.dispose();
});

describe("the tooling/gate entry, type-checked by a consumer with no optional peer installed", () => {
  it(
    "cannot resolve any optional peer, so a clean check is not one the peers made",
    () => {
      const { status, output } = consumer.typecheck(peerSource(OPTIONAL_PEERS));
      expect(status).not.toBe(0);
      for (const peer of OPTIONAL_PEERS) expect(output).toContain(`Cannot find module '${peer}'`);
    },
    TYPECHECK_TIMEOUT,
  );

  it(
    "type-checks clean",
    () => {
      const { status, output } = consumer.typecheck(entrySource("tooling/gate"));
      expect(output).not.toContain("error TS");
      expect(status).toBe(0);
    },
    TYPECHECK_TIMEOUT,
  );
});
