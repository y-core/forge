import type { PdfArchival, PdfInfo } from "./types";

/** The PDF/UA part this engine's tagged output declares conformance with. @internal */
export const PDFUA_PART = 1;

function escaped(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A date as XMP's own ISO 8601 form, where `/Info` writes the same instant as `D:…`. @internal */
export function xmpDate(at: Date): string {
  return `${at.toISOString().slice(0, 19)}Z`;
}

function element(name: string, value: string | undefined): string {
  return value === undefined ? "" : `\n      <${name}>${escaped(value)}</${name}>`;
}

// `dc:title` and `dc:description` are language alternatives and `dc:creator` an ordered sequence:
// PDF/A checks the RDF form as well as the value, so a simple element for either is a refusal.
function alternative(name: string, value: string | undefined): string {
  if (value === undefined) return "";
  return `\n      <${name}>\n        <rdf:Alt>\n          <rdf:li xml:lang="x-default">${escaped(value)}</rdf:li>\n        </rdf:Alt>\n      </${name}>`;
}

function sequence(name: string, value: string | undefined): string {
  if (value === undefined) return "";
  return `\n      <${name}>\n        <rdf:Seq>\n          <rdf:li>${escaped(value)}</rdf:li>\n        </rdf:Seq>\n      </${name}>`;
}

// PDF/A admits only its predefined schemas, so declaring `pdfuaid` beside `pdfaid` needs the
// extension description below — which makes a tagged archival file the case that would fail without it.
const UA_EXTENSION = [
  "\n      <pdfaExtension:schemas>",
  "        <rdf:Bag>",
  "          <rdf:li rdf:parseType='Resource'>",
  "            <pdfaSchema:namespaceURI>http://www.aiim.org/pdfua/ns/id/</pdfaSchema:namespaceURI>",
  "            <pdfaSchema:prefix>pdfuaid</pdfaSchema:prefix>",
  "            <pdfaSchema:schema>PDF/UA identification</pdfaSchema:schema>",
  "            <pdfaSchema:property>",
  "              <rdf:Seq>",
  "                <rdf:li rdf:parseType='Resource'>",
  "                  <pdfaProperty:category>internal</pdfaProperty:category>",
  "                  <pdfaProperty:description>Part of ISO 14289 conformed to</pdfaProperty:description>",
  "                  <pdfaProperty:name>part</pdfaProperty:name>",
  "                  <pdfaProperty:valueType>Integer</pdfaProperty:valueType>",
  "                </rdf:li>",
  "              </rdf:Seq>",
  "            </pdfaSchema:property>",
  "          </rdf:li>",
  "        </rdf:Bag>",
  "      </pdfaExtension:schemas>",
].join("\n");

const COMMON = [
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:pdf="http://ns.adobe.com/pdf/1.3/"',
  'xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
];

const ARCHIVAL_NAMESPACES = [
  'xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"',
  'xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#"',
  'xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"',
  'xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"',
];

// Declared from what the packet actually says: a namespace bound for a standard the file does not
// claim reads as a claim it does not make, and is the kind of noise a checker has to discount.
function namespaces(tagged: boolean, archival: PdfArchival | undefined): string {
  return [
    ...COMMON,
    ...(archival === undefined ? [] : ARCHIVAL_NAMESPACES),
    ...(tagged ? ['xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"'] : []),
  ].join(" ");
}

// Both halves are read out of the level, because the level is where both facts are: a part written
// as a literal would keep saying 2 the day an `a-3b` is admitted, and say it silently.
function archivalIdentification(archival: PdfArchival): string {
  const [, part = "", letter = ""] = /-(\d+)([a-z])$/.exec(archival) ?? [];
  return `\n      <pdfaid:part>${part}</pdfaid:part>\n      <pdfaid:conformance>${letter.toUpperCase()}</pdfaid:conformance>`;
}

// Every value comes from the same `info` the dictionary takes, because two metadata blocks
// disagreeing is the ordinary way an otherwise correct file fails a conformance check.
/** The XMP packet a document carries beside its information dictionary. @internal */
export function xmpPacket(info: PdfInfo | undefined, tagged: boolean, archival?: PdfArchival): string {
  const named = alternative("dc:title", info?.title);
  const ua = tagged ? `\n      <pdfuaid:part>${PDFUA_PART}</pdfuaid:part>` : "";
  const created = info?.created ?? info?.modified;
  const modified = info?.modified ?? info?.created;
  const level = archival === undefined ? "" : archivalIdentification(archival);
  return [
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `    <rdf:Description rdf:about="" ${namespaces(tagged, archival)}>` +
      named +
      sequence("dc:creator", info?.author) +
      alternative("dc:description", info?.subject) +
      ua +
      level +
      element("xmp:CreateDate", created === undefined ? undefined : xmpDate(created)) +
      element("xmp:ModifyDate", modified === undefined ? undefined : xmpDate(modified)) +
      element("xmp:CreatorTool", info?.creator) +
      element("pdf:Producer", info?.producer) +
      element("pdf:Keywords", info?.keywords) +
      (archival !== undefined && tagged ? UA_EXTENSION : ""),
    "    </rdf:Description>",
    "  </rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("\n");
}
