import { describe, expect, it } from "bun:test";

import { isWebSocketUpgrade } from "./upgrade";

describe("isWebSocketUpgrade", () => {
  const withUpgrade = (value: string) => new Request("https://example.com/live", { headers: { Upgrade: value } });

  it("matches the websocket token case-insensitively and within a list", () => {
    expect(isWebSocketUpgrade(withUpgrade("websocket"))).toBe(true);
    expect(isWebSocketUpgrade(withUpgrade("WebSocket"))).toBe(true);
    expect(isWebSocketUpgrade(withUpgrade("h2c, websocket"))).toBe(true);
  });

  it("rejects another protocol and a missing header", () => {
    expect(isWebSocketUpgrade(withUpgrade("h2c"))).toBe(false);
    expect(isWebSocketUpgrade(new Request("https://example.com/live"))).toBe(false);
  });
});
