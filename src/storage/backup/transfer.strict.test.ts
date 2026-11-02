import { describe, expect, it } from "bun:test";

import { restTransfer } from "./export";
import { d1Transfer } from "./transfer.strict";

describe("d1Transfer", () => {
  it("always reaches the export over REST, with the account and token it needs", () => {
    expect([d1Transfer(), d1Transfer().credentials]).toEqual([restTransfer, ["accountId", "apiToken"]]);
  });
});
