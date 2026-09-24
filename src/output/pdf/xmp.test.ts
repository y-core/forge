import { describe, expect, test } from "bun:test";

import { infoDictionary } from "./metadata";
import type { PdfInfo } from "./types";
import { PDFUA_PART, xmpPacket } from "./xmp";

describe("the XMP packet", () => {
  test("opens and closes on the markers a checker scans the file for", () => {
    const packet = xmpPacket({ title: "Declaration" }, false);
    expect(packet.startsWith('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>')).toBe(true);
    expect(packet.endsWith('<?xpacket end="w"?>')).toBe(true);
  });

  test("carries the title as a language alternative, which is the form dc:title takes", () => {
    const packet = xmpPacket({ title: "Declaration of interest" }, false);
    expect(packet).toContain("<dc:title>");
    expect(packet).toContain('<rdf:li xml:lang="x-default">Declaration of interest</rdf:li>');
  });

  test("declares the PDF/UA part only where the document is tagged", () => {
    expect(xmpPacket({ title: "Declaration" }, true)).toContain(`<pdfuaid:part>${PDFUA_PART}</pdfuaid:part>`);
    expect(xmpPacket({ title: "Declaration" }, false)).not.toContain("pdfuaid:part");
  });

  test("carries no title element at all where the document names none", () => {
    expect(xmpPacket(undefined, true)).not.toContain("dc:title");
  });

  test("escapes a title that would otherwise close an element it sits inside", () => {
    expect(xmpPacket({ title: "Smith & <Sons>" }, false)).toContain("Smith &amp; &lt;Sons&gt;");
  });
});

describe("what an archival render declares beyond the tagged packet", () => {
  const INFO = {
    title: "Declaration",
    creator: "Meridian Attorneys",
    producer: "@y-core/forge",
    created: new Date(Date.UTC(2026, 8, 21, 9, 30, 0)),
    modified: new Date(Date.UTC(2026, 8, 22, 10, 0, 0)),
  };

  // Driven from the level rather than asserted as a literal, so a part read off anything but the
  // level it belongs to fails here rather than shipping an `a-3b` file that calls itself part 2.
  test("names the part and the conformance letter the level asked for", () => {
    for (const [level, part, letter] of [
      ["a-2b", "2", "B"],
      ["a-2u", "2", "U"],
      ["a-2a", "2", "A"],
    ] as const) {
      const packet = xmpPacket(INFO, true, level);
      expect(packet).toContain(`<pdfaid:part>${part}</pdfaid:part>`);
      expect(packet).toContain(`<pdfaid:conformance>${letter}</pdfaid:conformance>`);
    }
  });

  test("says nothing about PDF/A where no level is asked for", () => {
    expect(xmpPacket(INFO, true)).not.toContain("pdfaid");
  });

  // The packet and the dictionary must agree exactly, so it takes the dates `/Info` takes rather
  // than a clock of its own — which is also what keeps two renders of one document identical.
  test("mirrors the caller's own dates, in XMP's form rather than PDF's", () => {
    const packet = xmpPacket(INFO, true, "a-2b");
    expect(packet).toContain("<xmp:CreateDate>2026-09-21T09:30:00Z</xmp:CreateDate>");
    expect(packet).toContain("<xmp:ModifyDate>2026-09-22T10:00:00Z</xmp:ModifyDate>");
  });

  test("carries the producer and the creator tool from the same info the dictionary reads", () => {
    const packet = xmpPacket(INFO, true, "a-2b");
    expect(packet).toContain("<xmp:CreatorTool>Meridian Attorneys</xmp:CreatorTool>");
    expect(packet).toContain("<pdf:Producer>@y-core/forge</pdf:Producer>");
  });

  // PDF/A admits only its own predefined schemas, so a tagged archival file — the thing this epic
  // exists to produce — is exactly the case that fails without the extension description.
  test("describes the pdfuaid schema where it declares both standards at once", () => {
    expect(xmpPacket(INFO, true, "a-2a")).toContain("<pdfaSchema:prefix>pdfuaid</pdfaSchema:prefix>");
    expect(xmpPacket(INFO, false, "a-2b")).not.toContain("pdfaExtension:schemas");
  });
});

// Typed `Required<PdfInfo>`, so a ninth field added to the interface makes this fixture a compile
// error rather than a value that quietly reaches `/Info` with nothing matching it in the packet.
const EVERY: Required<PdfInfo> = {
  title: "Declaration of interest",
  author: "Annelie du Toit",
  subject: "Financial interests declared under FICA",
  keywords: "fica, declaration, interests",
  creator: "Meridian Attorneys",
  producer: "@y-core/forge",
  created: new Date(Date.UTC(2026, 8, 21, 9, 30, 0)),
  modified: new Date(Date.UTC(2026, 8, 22, 10, 0, 0)),
};

describe("every /Info value has an XMP counterpart, which PDF/A requires of each one", () => {
  const packet = xmpPacket(EVERY, true, "a-2u");
  const dictionary = infoDictionary(EVERY) ?? "";

  test("writes the three Dublin Core and PDF properties in the RDF form each takes", () => {
    expect(packet).toContain("<dc:creator>");
    expect(packet).toContain("<rdf:Seq>");
    expect(packet).toContain("<rdf:li>Annelie du Toit</rdf:li>");
    expect(packet).toContain("<dc:description>");
    expect(packet).toContain('<rdf:li xml:lang="x-default">Financial interests declared under FICA</rdf:li>');
    expect(packet).toContain("<pdf:Keywords>fica, declaration, interests</pdf:Keywords>");
  });

  // Sharing an input is not writing an output for each field, which is what let three of them slip.
  test("no field reaches the dictionary or the packet alone", () => {
    const absent: string[] = [];
    for (const [field, value] of Object.entries(EVERY)) {
      const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
      if (!dictionary.includes(value instanceof Date ? iso.replaceAll("-", "") : iso)) absent.push(`${field} from /Info`);
      if (!packet.includes(iso)) absent.push(`${field} from the XMP packet`);
    }
    expect(absent).toEqual([]);
  });
});
