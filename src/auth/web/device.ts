// Ordered: Edge, Opera and Samsung Internet each also carry `Chrome/`, and Chrome carries `Safari/`.
const AUTH_DEVICE_BROWSERS: readonly (readonly [marker: string, label: string])[] = [
  ["Edg", "Edge"],
  ["OPR/", "Opera"],
  ["SamsungBrowser/", "Samsung Internet"],
  ["Firefox/", "Firefox"],
  ["FxiOS/", "Firefox"],
  ["CriOS/", "Chrome"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
];

// Ordered: an iPhone or iPad says `like Mac OS X`, and Android and ChromeOS both say `Linux`.
const AUTH_DEVICE_PLATFORMS: readonly (readonly [marker: string, label: string])[] = [
  ["iPhone", "iOS"],
  ["iPad", "iPadOS"],
  ["Android", "Android"],
  ["CrOS", "ChromeOS"],
  ["Windows", "Windows"],
  ["Macintosh", "macOS"],
  ["Linux", "Linux"],
];

function firstLabel(agent: string, table: readonly (readonly [marker: string, label: string])[]): string | null {
  return table.find(([marker]) => agent.includes(marker))?.[1] ?? null;
}

/** The coarse "Browser on Platform" label a session list names a sign-in by, read off `User-Agent` and never holding it; `null` when neither is recognised. @internal */
export function authDeviceLabel(headers: Headers): string | null {
  const agent = headers.get("user-agent") ?? "";
  const browser = firstLabel(agent, AUTH_DEVICE_BROWSERS);
  const platform = firstLabel(agent, AUTH_DEVICE_PLATFORMS);
  if (browser !== null && platform !== null) return `${browser} on ${platform}`;
  return browser ?? platform;
}
