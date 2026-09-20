/** The PDF/UA part this engine's tagged output declares conformance with. @internal */
export const PDFUA_PART = 1;

function escaped(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Two metadata blocks disagreeing about a title is the ordinary way an otherwise correct file fails
// a conformance check, so the packet takes the same value `/Info` does rather than a second one.
/** The XMP packet a document carries beside its information dictionary. @internal */
export function xmpPacket(title: string | undefined, tagged: boolean): string {
  const conformance = tagged ? `\n      <pdfuaid:part>${PDFUA_PART}</pdfuaid:part>` : "";
  const named =
    title === undefined
      ? ""
      : `\n      <dc:title>\n        <rdf:Alt>\n          <rdf:li xml:lang="x-default">${escaped(title)}</rdf:li>\n        </rdf:Alt>\n      </dc:title>`;
  return [
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">' +
      `${named}${conformance}`,
    "    </rdf:Description>",
    "  </rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("\n");
}
