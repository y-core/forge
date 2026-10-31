import type { UrlPolicy, UrlPolicyOptions } from "./types";

const URL_TAB_OR_NEWLINE = /[\t\n\r]/g;
const PROTOCOL_RELATIVE = /^[\\/]{2}/;
const URL_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const PROTOCOL_NAME = /^[a-z][a-z0-9+.-]*$/;

function trimControls(url: string): string {
  const units = url.replace(URL_TAB_OR_NEWLINE, "");
  let start = 0;
  let end = units.length;
  while (start < end && units.charCodeAt(start) <= 0x20) start++;
  while (end > start && units.charCodeAt(end - 1) <= 0x20) end--;
  return units.slice(start, end);
}

function hasListedProtocol(url: string, protocols: readonly string[]): boolean {
  const colon = url.indexOf(":");
  const blockers = ["?", "#", "/"].map((char) => url.indexOf(char)).filter((at) => at > -1);
  if (colon < 0 || blockers.some((at) => colon > at)) return true;
  return protocols.some((protocol) => colon === protocol.length && url.startsWith(protocol));
}

/** Creates a URL policy keeping relative URLs and the listed protocols, never a protocol-relative or backslash path or a scheme hidden behind controls. */
export function createUrlPolicy({ linkProtocols, srcProtocols }: UrlPolicyOptions): UrlPolicy {
  for (const protocol of [...linkProtocols, ...srcProtocols]) {
    if (!PROTOCOL_NAME.test(protocol)) throw new Error(`createUrlPolicy: \`${protocol}\` is not a lowercase protocol name without its colon.`);
  }
  const links = [...linkProtocols];
  const byAttribute: ReadonlyMap<string, readonly string[]> = new Map([
    ["href", links],
    ["xlink:href", links],
    ["src", [...srcProtocols]],
  ]);
  return ({ value, attribute }) => {
    const protocols = byAttribute.get(attribute) ?? [];
    if (!hasListedProtocol(value, protocols)) return false;
    const normalised = trimControls(value);
    if (PROTOCOL_RELATIVE.test(normalised)) return false;
    const scheme = URL_SCHEME.exec(normalised)?.[1];
    return scheme === undefined || protocols.includes(scheme.toLowerCase());
  };
}

/** Reports whether a URL may stay on an attribute: relative, or https (and mailto for a link), never protocol-relative or hidden behind controls. */
export const isSafeUrl: UrlPolicy = createUrlPolicy({ linkProtocols: ["https", "mailto"], srcProtocols: ["https"] });
