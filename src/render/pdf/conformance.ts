import { pdfTaggingOn } from "./limits";
import type { PdfArchival, PdfConformanceRule, PdfConformanceViolation, PdfPage, PdfRendererOptions } from "./types";

// The schemes PDF/A leaves a reader able to follow. `mailto` is out: a conforming file is one an
// archive can render on its own, and an address only a mail client resolves is not that.
const ARCHIVAL_SCHEMES: readonly string[] = ["http", "https"];

// An sRGB output intent explains a grey, an RGB and an indexed space over either. It cannot explain
// `/DeviceCMYK`, which `image.ts` reaches for any four-component JPEG.
const EXPLAINED = /^\/(DeviceGray|DeviceRGB)$|^\[\s*\/Indexed/;

/** Whether a level requires the full tagging PDF/UA asks for, which only the `a` level does. @internal */
function needsTagging(level: PdfArchival): boolean {
  return level.endsWith("a");
}

// One table read twice: `auditPdf` reports these before a render and `preparePdfRender` refuses on
// them. A prohibition living in only one of the two is what lets a file declare what it is not.
/** Every prohibition an option set and its pages break for the level asked for. @internal */
export function conformanceViolations(
  pages: readonly PdfPage[],
  options: PdfRendererOptions,
  level: PdfArchival,
): readonly PdfConformanceViolation[] {
  const found: PdfConformanceViolation[] = [];
  const say = (rule: PdfConformanceRule, message: string): number => found.push({ rule, message });

  if (options.metadata !== "standard") {
    say("metadata", `PDF/A ${level} needs an XMP packet and an information dictionary — set metadata to "standard"`);
  }
  if (options.info?.created === undefined) {
    say("date", `PDF/A ${level} needs a creation date, and this engine never stamps one of its own — set info.created`);
  }
  if (needsTagging(level) && !pdfTaggingOn(options)) {
    say("tagged", `PDF/A ${level} is the tagged level — set tagged: true, or ask for a-2b or a-2u instead`);
  }

  const faces = options.fonts ?? [];
  const hollow = faces.filter((face) => face.sfnt.length === 0).map((face) => face.name);
  if (hollow.length > 0) {
    say("font-supplied", `PDF/A embeds every face, and ${hollow.join(", ")} carries no sfnt bytes — load the face's file into sfnt`);
  }
  // The base-14 faces are never embedded, so a run set in one is a run whose glyphs the file does
  // not carry — the one prohibition reachable from a document that supplies no fonts at all.
  const base14 = pages.some((page) => page.nodes.some((node) => node.kind === "text" && node.embedded === undefined));
  if (base14) {
    say("font-embedded", `PDF/A embeds every face, and a run is set in the base-14 pair — supply fonts and a defaultFont covering every run`);
  }

  for (const page of pages) {
    for (const link of page.links ?? []) {
      if (!("uri" in link.target)) continue;
      const scheme = /^([A-Za-z][\w+.-]*):/.exec(link.target.uri)?.[1]?.toLowerCase() ?? "";
      if (ARCHIVAL_SCHEMES.includes(scheme)) continue;
      say(
        "link-scheme",
        `PDF/A admits only ${ARCHIVAL_SCHEMES.join(" and ")} links, and \`${link.target.uri}\` is not one — drop it or rewrite it`,
      );
    }
    for (const node of page.nodes) {
      if (node.kind !== "image" || EXPLAINED.test(node.image.colourSpace)) continue;
      say("colour-space", `an sRGB output intent cannot explain ${node.image.colourSpace} — re-save the image as RGB`);
    }
  }
  return found;
}
