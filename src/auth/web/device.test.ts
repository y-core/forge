import { describe, expect, it } from "bun:test";

import { authDeviceLabel } from "./device";

const AGENTS: readonly (readonly [agent: string, label: string])[] = [
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0", "Firefox on macOS"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Chrome on Windows"],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87",
    "Edge on Windows",
  ],
  ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0", "Opera on Linux"],
  [
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    "Samsung Internet on Android",
  ],
  ["Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", "Chrome on Android"],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Safari on iOS",
  ],
  [
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
    "Chrome on iPadOS",
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
    "Firefox on iOS",
  ],
  ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Chrome on ChromeOS"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "Safari on macOS"],
];

function labelOf(agent: string | null): string | null {
  return authDeviceLabel(new Headers(agent === null ? {} : { "user-agent": agent }));
}

describe("authDeviceLabel", () => {
  it("names each browser family on each platform, never one a browser's borrowed tokens claim", () => {
    expect(AGENTS.map(([agent]) => labelOf(agent))).toEqual(AGENTS.map(([, label]) => label));
  });

  it("names the one half it recognises when the other is unknown", () => {
    expect([labelOf("Mozilla/5.0 (PlayStation 5) Firefox/120.0"), labelOf("Mozilla/5.0 (Windows NT 10.0) Lynx/2.9")]).toEqual([
      "Firefox",
      "Windows",
    ]);
  });

  it("answers null for an agent it recognises nothing in, and for no agent at all", () => {
    expect([labelOf("curl/8.6.0"), labelOf(""), labelOf(null)]).toEqual([null, null, null]);
  });

  it("holds no part of the agent beyond its fixed labels, so even its longest pairing stays inside 64 characters", () => {
    const hostile = `${"x".repeat(500)} Firefox/1 Windows <script>`;
    const longest = labelOf("(X11; CrOS) SamsungBrowser/25.0") ?? "";
    expect({ hostile: labelOf(hostile), longest, withinBound: longest.length <= 64 }).toEqual({
      hostile: "Firefox on Windows",
      longest: "Samsung Internet on ChromeOS",
      withinBound: true,
    });
  });
});
