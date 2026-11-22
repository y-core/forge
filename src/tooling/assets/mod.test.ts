import { afterAll, describe, expect, it } from "bun:test";

import { createConsumerInstall, entrySource, OPTIONAL_PEERS, peerSource, TYPECHECK_TIMEOUT } from "./consumer.fixture";

const consumer = createConsumerInstall("forge-assets-consumer");

afterAll(() => {
  consumer.dispose();
});

describe("the tooling/assets entry, type-checked by a consumer with no optional peer installed", () => {
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
      const { status, output } = consumer.typecheck(entrySource("tooling/assets"));
      expect(output).not.toContain("error TS");
      expect(status).toBe(0);
    },
    TYPECHECK_TIMEOUT,
  );
});

describe("the tooling/assets/types entry, resolved through the package's exports map", () => {
  it(
    "hands a consumer AssetsConfig by type without the tooling/assets barrel",
    () => {
      const source =
        'import type { AssetsConfig } from "@y-core/forge/tooling/assets/types";\n\nexport const config: AssetsConfig | undefined = undefined;\n';
      const { status, output } = consumer.typecheck(source);
      expect(output).not.toContain("error TS");
      expect(status).toBe(0);
    },
    TYPECHECK_TIMEOUT,
  );

  it(
    "refuses a subpath the map does not declare, so the clean check above is the export's",
    () => {
      const { status, output } = consumer.typecheck(
        'import type * as gone from "@y-core/forge/tooling/assets/absent";\n\nexport type Gone = typeof gone;\n',
      );
      expect(output).toContain("Cannot find module '@y-core/forge/tooling/assets/absent'");
      expect(status).not.toBe(0);
    },
    TYPECHECK_TIMEOUT,
  );
});
