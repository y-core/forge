import { describe, expect, test } from "bun:test";

import { PDFUA_PART, xmpPacket } from "./xmp";

describe("the XMP packet", () => {
  test("opens and closes on the markers a checker scans the file for", () => {
    const packet = xmpPacket("Declaration", false);
    expect(packet.startsWith('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>')).toBe(true);
    expect(packet.endsWith('<?xpacket end="w"?>')).toBe(true);
  });

  test("carries the title as a language alternative, which is the form dc:title takes", () => {
    const packet = xmpPacket("Declaration of interest", false);
    expect(packet).toContain("<dc:title>");
    expect(packet).toContain('<rdf:li xml:lang="x-default">Declaration of interest</rdf:li>');
  });

  test("declares the PDF/UA part only where the document is tagged", () => {
    expect(xmpPacket("Declaration", true)).toContain(`<pdfuaid:part>${PDFUA_PART}</pdfuaid:part>`);
    expect(xmpPacket("Declaration", false)).not.toContain("pdfuaid:part");
  });

  test("carries no title element at all where the document names none", () => {
    expect(xmpPacket(undefined, true)).not.toContain("dc:title");
  });

  test("escapes a title that would otherwise close an element it sits inside", () => {
    expect(xmpPacket("Smith & <Sons>", false)).toContain("Smith &amp; &lt;Sons&gt;");
  });
});
