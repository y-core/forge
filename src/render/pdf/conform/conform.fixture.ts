import { parsePdfObjects } from "./parse.fixture";
import type { PdfConformFinding, PdfConformRule, PdfParsedFile, PdfStructElement } from "./types.fixture";

const decoder = new TextDecoder("latin1");

const HEADING = /^H(\d)$/;

function referenced(from: string, key: string): number | undefined {
  const found = new RegExp(`/${key} (\\d+) 0 R`).exec(from)?.[1];
  return found === undefined ? undefined : Number(found);
}

/** One `/StructElem` dictionary read back into the parts a rule asks about. @internal */
export function structElement(id: number, dict: string): PdfStructElement | undefined {
  const type = /\/S \/(\w+)/.exec(dict)?.[1];
  if (type === undefined) return undefined;
  const kids = /\/K \[([^\]]*)\]/.exec(dict)?.[1] ?? "";
  // `/K 3` and `/K [3 << /OBJR … >>]` both mark content; `/K [n 0 R …]` names children. The first
  // number of a bracket is a marked-content id only where no `0 R` follows it.
  const marked = /\/K (\d+)/.exec(dict)?.[1] ?? /^\s*(\d+)\s+<</.exec(kids)?.[1] ?? undefined;
  return {
    id,
    type,
    children: marked === undefined ? [...kids.matchAll(/(\d+) 0 R/g)].map((found) => Number(found[1])) : [],
    ...(marked === undefined ? {} : { mcid: Number(marked) }),
    ...(/\/Alt \(/.test(dict) || /\/Alt </.test(dict) ? { alt: true } : {}),
    ...(referenced(dict, "Pg") === undefined ? {} : { page: referenced(dict, "Pg") }),
  };
}

function finding(rule: PdfConformRule, detail: string): PdfConformFinding {
  return { rule, detail };
}

/** Every element of a tagged file, by the number the tree refers to it with. @internal */
function elementsOf(file: PdfParsedFile): Map<number, PdfStructElement> {
  const out = new Map<number, PdfStructElement>();
  for (const [id, object] of file.objects) {
    if (!object.dict.includes("/Type /StructElem")) continue;
    const element = structElement(id, object.dict);
    if (element !== undefined) out.set(id, element);
  }
  return out;
}

/** The leaves of the tree in reading order, which is the order a document is announced in. @internal */
function leavesOf(elements: ReadonlyMap<number, PdfStructElement>, from: readonly number[]): PdfStructElement[] {
  return from.flatMap((id) => {
    const element = elements.get(id);
    if (element === undefined) return [];
    return element.children.length === 0 ? [element] : leavesOf(elements, element.children);
  });
}

const CHILDREN: Readonly<Record<string, readonly string[]>> = { L: ["LI"], LI: ["Lbl", "LBody"], TR: ["TD", "TH"], Table: ["TR"] };

/** Every way the emitted bytes fall short of PDF/UA-1's structural requirements. @internal */
export async function conformPdf(bytes: Uint8Array<ArrayBuffer>): Promise<PdfConformFinding[]> {
  const file = await parsePdfObjects(bytes);
  const findings: PdfConformFinding[] = [];
  const catalog = [...file.objects.values()].find((object) => object.dict.includes("/Type /Catalog"))?.dict ?? "";
  const rootId = referenced(catalog, "StructTreeRoot");
  if (rootId === undefined) return [finding("document-root", "the catalogue names no /StructTreeRoot, so the file declares no structure at all")];

  const root = file.objects.get(rootId)?.dict ?? "";
  const elements = elementsOf(file);
  const rootKids = [...(/\/K \[([^\]]*)\]/.exec(root)?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((found) => Number(found[1]));
  const document = rootKids.length === 1 ? elements.get(rootKids[0] ?? 0) : undefined;
  if (document?.type !== "Document") {
    findings.push(finding("document-root", `the root must list exactly one /Document, and lists ${rootKids.length} kid(s)`));
  }

  for (const element of elements.values()) {
    const allowed = CHILDREN[element.type];
    if (allowed === undefined) continue;
    for (const child of element.children) {
      const type = elements.get(child)?.type ?? "?";
      if (allowed.includes(type)) continue;
      const rule: PdfConformRule = element.type === "L" || element.type === "LI" ? "list-shape" : "table-shape";
      findings.push(finding(rule, `a /${element.type} may hold only ${allowed.join(" or ")}, and holds a /${type}`));
    }
  }

  const leaves = leavesOf(elements, rootKids);
  for (const leaf of leaves) {
    if (leaf.type === "Figure" && leaf.alt !== true) {
      findings.push(finding("figure-alt", `a /Figure with no /Alt announces nothing; give element ${leaf.id} its alternate text`));
    }
  }

  let last = 0;
  for (const leaf of leaves) {
    const level = Number(HEADING.exec(leaf.type)?.[1] ?? 0);
    if (level === 0) continue;
    if (last !== 0 && level > last + 1) findings.push(finding("heading-skip", `an /H${level} follows an /H${last}, which skips a level`));
    last = level;
  }

  findings.push(...unresolvedMarks(file, elements));
  findings.push(...annotationFindings(file, elements, parentTree(file).annots));
  findings.push(...archivalFindings(file));
  findings.push(...metadataFindings(file));
  return findings;
}

/** The catalogue's `/StructTreeRoot` dictionary, which every tree-wide rule starts from. @internal */
function rootOf(file: PdfParsedFile): string {
  const catalog = [...file.objects.values()].find((object) => object.dict.includes("/Type /Catalog"))?.dict ?? "";
  return file.objects.get(referenced(catalog, "StructTreeRoot") ?? 0)?.dict ?? "";
}

// Two shapes in one `/Nums`: a page's key holds an array of elements indexed by marked-content id,
// and an annotation's key holds exactly one reference. Reading them apart is the whole distinction.
/** The parent tree as its two kinds of entry, by key. @internal */
function parentTree(file: PdfParsedFile): { pages: Map<number, number[]>; annots: Map<number, number> } {
  const nums = /\/Nums \[([\S\s]*?)\] >>/.exec(file.objects.get(referenced(rootOf(file), "ParentTree") ?? 0)?.dict ?? "")?.[1] ?? "";
  const pages = new Map(
    [...nums.matchAll(/(\d+) \[([^\]]*)\]/g)].map((found) => [
      Number(found[1]),
      [...(found[2] ?? "").matchAll(/(\d+) 0 R/g)].map((listed) => Number(listed[1])),
    ]),
  );
  // The array entries are removed before the scalars are read: two scalars in a row share the `R`
  // that separates them, and a pattern consuming it matches only every other one.
  const scalars = nums.replaceAll(/\d+ \[[^\]]*\]/g, "");
  const annots = new Map([...scalars.matchAll(/(\d+) (\d+) 0 R/g)].map((found) => [Number(found[1]), Number(found[2])]));
  return { pages, annots };
}

/** Every marked run whose id does not resolve back through its page's key to the element owning it. @internal */
function unresolvedMarks(file: PdfParsedFile, elements: ReadonlyMap<number, PdfStructElement>): PdfConformFinding[] {
  const findings: PdfConformFinding[] = [];
  const byKey = parentTree(file).pages;

  for (const [id, object] of file.objects) {
    if (!object.dict.startsWith("<< /Type /Page ")) continue;
    const key = Number(/\/StructParents (\d+)/.exec(object.dict)?.[1] ?? -1);
    const stream = decoder.decode(file.objects.get(referenced(object.dict, "Contents") ?? 0)?.stream);
    const opened = [...stream.matchAll(/\/MCID (\d+) >> BDC/g)].map((found) => Number(found[1]));
    const listed = byKey.get(key) ?? [];
    for (const mcid of opened) {
      const owner = elements.get(listed[mcid] ?? 0);
      if (owner?.mcid === mcid && owner.page === id) continue;
      findings.push(finding("mcid-unresolved", `page ${id} opens /MCID ${mcid}, which no element at offset ${mcid} of key ${key} owns`));
    }
    if (opened.length !== listed.length) {
      findings.push(
        finding("mcid-unresolved", `page ${id} opens ${opened.length} marked run(s) against ${listed.length} element(s) at key ${key}`),
      );
    }
  }
  return findings;
}

/** The words a page's content stream paints inside one marked run, which is what a reader hears. @internal */
function wordsOfMark(stream: string, mcid: number): string {
  const opened = new RegExp(String.raw`<< /MCID ${mcid} >> BDC\n([\S\s]*?)\nEMC`).exec(stream)?.[1] ?? "";
  return [...opened.matchAll(/\(((?:\\.|[^()\\])*)\) Tj/g)].map((found) => found[1] ?? "").join(" ");
}

// The gap this closes was not theoretical: with no annotation rule, `bug-260921-65`'s "no annotation
// finding" clause passed against a checker that had nothing whatever to say about one.
/** Every way a file's link annotations fail to reach, or agree with, the elements that own them. @internal */
export function annotationFindings(
  file: PdfParsedFile,
  elements: ReadonlyMap<number, PdfStructElement>,
  byKey: ReadonlyMap<number, number>,
): PdfConformFinding[] {
  const findings: PdfConformFinding[] = [];
  const seen = new Set<number>();
  const streams = new Map<number, string>();
  for (const [id, object] of file.objects) {
    if (!object.dict.startsWith("<< /Type /Page ")) continue;
    if (!object.dict.includes("/Tabs /S"))
      findings.push(finding("page-tabs", `page ${id} carries no /Tabs /S, so tab order follows /Annots and not the tree`));
    streams.set(id, decoder.decode(file.objects.get(referenced(object.dict, "Contents") ?? 0)?.stream));
  }

  for (const [id, object] of file.objects) {
    if (!object.dict.includes("/Subtype /Link")) continue;
    if (!/\/F 4\b/.test(object.dict))
      findings.push(finding("annot-flags", `annotation ${id} does not set /F 4, so Print is unset or NoView is not cleared`));
    const key = Number(/\/StructParent (\d+)/.exec(object.dict)?.[1] ?? -1);
    if (key < 0) {
      findings.push(
        finding("annot-parent", `annotation ${id} carries no /StructParent, so a reader who tabbed to it cannot walk back to the tree`),
      );
      continue;
    }
    if (seen.has(key))
      findings.push(finding("annot-key", `key ${key} is claimed by more than one annotation, so one of them resolves to the other's element`));
    seen.add(key);
    const owner = elements.get(byKey.get(key) ?? 0);
    if (owner === undefined || owner.type !== "Link") {
      findings.push(finding("annot-parent", `annotation ${id} names key ${key}, which resolves to no /Link element`));
      continue;
    }
    const declared = /\/Contents \(((?:\\.|[^()\\])*)\)/.exec(object.dict)?.[1];
    const painted = owner.page === undefined || owner.mcid === undefined ? "" : wordsOfMark(streams.get(owner.page) ?? "", owner.mcid);
    if (declared !== undefined && declared !== painted) {
      findings.push(
        finding("annot-contents", `annotation ${id} is described as ${declared}, but the element it owns paints ${painted || "nothing"}`),
      );
    }
  }

  const next = Number(/\/ParentTreeNextKey (\d+)/.exec(rootOf(file))?.[1] ?? -1);
  const issued = [
    ...seen,
    ...[...file.objects.values()].flatMap((object) => [...object.dict.matchAll(/\/StructParents (\d+)/g)].map((found) => Number(found[1]))),
  ];
  for (const key of issued) {
    if (key >= next)
      findings.push(finding("parent-tree-next-key", `key ${key} was issued but /ParentTreeNextKey is ${next}, so the next update would reuse it`));
  }
  return findings;
}

// Read out of the emitted bytes rather than off the options, so a file declaring a level it does
// not meet is caught where a reader would meet it — which is the whole point of a second pass.
/** Every way a file declaring PDF/A falls short of what that declaration promises. @internal */
export function archivalFindings(file: PdfParsedFile): PdfConformFinding[] {
  const findings: PdfConformFinding[] = [];
  const packet = decoder.decode([...file.objects.values()].find((object) => object.dict.includes("/Type /Metadata"))?.stream);
  const level = /<pdfaid:conformance>([BUA])<\/pdfaid:conformance>/.exec(packet)?.[1];
  if (level === undefined) return findings;
  if (!packet.includes("<pdfaid:part>2</pdfaid:part>")) {
    findings.push(finding("pdfa-declaration", "the packet names a conformance letter but no part, so it declares half a level"));
  }
  // Both standards in one packet needs the extension schema, which is the case this epic produces.
  if (packet.includes("pdfuaid:part") && !packet.includes("pdfaExtension:schemas")) {
    findings.push(finding("pdfa-declaration", "the packet declares PDF/UA beside PDF/A without describing the pdfuaid schema PDF/A requires"));
  }

  const catalog = [...file.objects.values()].find((object) => object.dict.includes("/Type /Catalog"))?.dict ?? "";
  const intents = [...catalog.matchAll(/\/Type \/OutputIntent/g)];
  if (intents.length !== 1) {
    findings.push(finding("output-intent", `a PDF/A file declares exactly one output intent, and this one declares ${intents.length}`));
  } else {
    const profile = file.objects.get(referenced(catalog, "DestOutputProfile") ?? 0);
    const device = profile?.stream === undefined ? "" : String.fromCharCode(...profile.stream.subarray(12, 16));
    if (device !== "mntr" && device !== "prtr") {
      findings.push(finding("output-intent", `the destination profile has device class ${device || "none"}, and PDF/A admits only mntr or prtr`));
    }
  }

  for (const [id, object] of file.objects) {
    if (object.dict.includes("/Type /Font") && object.dict.includes("/Subtype /Type1")) {
      findings.push(finding("font-not-embedded", `font ${id} is a base-14 Type1 face, whose glyphs the file does not carry`));
    }
    if (!object.dict.startsWith("<< /Type /Page ")) continue;
    const stream = decoder.decode(file.objects.get(referenced(object.dict, "Contents") ?? 0)?.stream);
    const composites = /\/GS\d+ gs/.test(stream) || /\/Sh\d+ sh/.test(stream);
    if (composites && !object.dict.includes("/Group")) {
      findings.push(
        finding("transparency-group", `page ${id} composites but names no blending space, which PDF/A reads as undeclared transparency`),
      );
    }
  }
  return findings;
}

// PDF/A requires every `/Info` entry to have its XMP counterpart and to agree with it, so a value
// reaching one block alone is refused — which is what a caller filling in `info` would otherwise hit.
const COUNTERPARTS: readonly (readonly [string, string])[] = [
  ["Title", "dc:title"],
  ["Author", "dc:creator"],
  ["Subject", "dc:description"],
  ["Keywords", "pdf:Keywords"],
  ["Creator", "xmp:CreatorTool"],
  ["Producer", "pdf:Producer"],
  ["CreationDate", "xmp:CreateDate"],
  ["ModDate", "xmp:ModifyDate"],
];

// A date is `D:20260921093000Z` in the dictionary and `2026-09-21T09:30:00Z` in the packet, so both
// sides are reduced to the digits they share rather than compared in a form only one of them uses.
function agree(declared: string, shown: string): boolean {
  if (!/^D:\d/.test(declared)) return declared === shown;
  const digits = (text: string): string => text.replaceAll(/\D/g, "");
  return digits(declared) === digits(shown);
}

// `pdfTextString` writes a literal only while the value is printable ASCII and `<FEFF…>` past it,
// so reading the literal alone skips the comparison for every title carrying an accent or a dash.
function dictionaryValue(info: string, key: string): string | undefined {
  const literal = new RegExp(`/${key} \\(((?:\\\\.|[^()\\\\])*)\\)`).exec(info)?.[1];
  if (literal !== undefined) return literal;
  const hex = new RegExp(`/${key} <FEFF([\\dA-Fa-f]*)>`).exec(info)?.[1];
  if (hex === undefined) return undefined;
  return (hex.match(/.{4}/g) ?? []).map((unit) => String.fromCharCode(Number.parseInt(unit, 16))).join("");
}

/** Every `/Info` value the XMP packet contradicts, or carries no counterpart for at all. @internal */
export function metadataFindings(file: PdfParsedFile): PdfConformFinding[] {
  // The packet is UTF-8 by XMP's own rule, while the rest of the file is read byte for byte — so
  // reading it in latin1 makes every accented title disagree with the dictionary beside it.
  const packet = new TextDecoder().decode([...file.objects.values()].find((object) => object.dict.includes("/Type /Metadata"))?.stream);
  if (!packet.includes("pdfaid:conformance")) return [];
  const info = [...file.objects.values()].find((object) => /\/(Title|Producer|CreationDate) [(<]/.test(object.dict))?.dict ?? "";
  const findings: PdfConformFinding[] = [];
  for (const [key, property] of COUNTERPARTS) {
    const value = dictionaryValue(info, key);
    if (value === undefined) continue;
    const shown = new RegExp(`<${property}(?:[^>]*)>([\\S\\s]*?)</${property}>`).exec(packet)?.[1] ?? "";
    const stripped = shown.replaceAll(/<[^>]*>/g, "").trim();
    if (agree(value, stripped)) continue;
    findings.push(finding("info-xmp-mismatch", `/${key} is ${value} and ${property} is ${stripped || "absent"}; PDF/A requires the two to agree`));
  }
  return findings;
}
