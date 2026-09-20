import { describe, expect, test } from "bun:test";

import { PAGE_HEIGHT } from "./geometry";
import type { PdfEmbeddedFont, PdfImage, PdfLink, PdfNode, PdfPage } from "./types";
import { composePdf, createObjectManager, operatorsFor, writePdf } from "./writer";

const decoder = new TextDecoder("latin1");

function pageOf(nodes: PdfNode[]): PdfPage {
  return { nodes, y: 0, letterheadNodes: 0 };
}

describe("the object manager", () => {
  test("allocates numbers in the order the document declares them", () => {
    const manager = createObjectManager();
    expect([manager.allocate("<< /a >>"), manager.allocate("<< /b >>"), manager.allocate("<< /c >>")]).toEqual([1, 2, 3]);
    expect(manager.objects().map((object) => object.body)).toEqual(["<< /a >>", "<< /b >>", "<< /c >>"]);
  });
});

describe("the y-up conversion happens in the writer and nowhere else", () => {
  test("a run's y-down baseline becomes its distance from the page's bottom edge", () => {
    const ops = operatorsFor({ kind: "text", tag: "value", x: 56, y: 100, run: "x", face: "regular", size: 10, tracking: 0 });
    expect(ops).toBe(`BT /F1 10 Tf 0 Tc 56 ${PAGE_HEIGHT - 100} Td (x) Tj ET`);
  });

  test("a line's endpoints flip together, so a horizontal rule stays horizontal", () => {
    const commands = [
      { op: "move", x: 56, y: 100 },
      { op: "line", x: 539, y: 100 },
    ] as const;
    expect(operatorsFor({ kind: "path", tag: "rule", commands, paint: "stroke", weight: 0.5 })).toBe("0.5 w 56 742 m 539 742 l S");
  });

  test("a top-anchored rectangle becomes a bottom-anchored one of the same height", () => {
    const commands = [{ op: "rect", x: 10, y: 100, width: 8, height: 30 }] as const;
    expect(operatorsFor({ kind: "path", tag: "artwork", commands })).toBe("10 712 8 30 re f");
  });
});

describe("the file structure", () => {
  const bytes = writePdf(
    composePdf([pageOf([{ kind: "text", tag: "value", x: 56, y: 100, run: "hello", face: "regular", size: 10, tracking: 0 }])]),
  );
  const text = decoder.decode(bytes);

  test("opens with a PDF 1.4 header and a binary comment, and closes with the end-of-file marker", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect([...bytes.slice(9, 15)]).toEqual([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
    expect(text.endsWith("%%EOF\n")).toBe(true);
  });

  test("declares one page, and a trailer sized to the objects it allocated", () => {
    expect(text).toContain("/Type /Pages /Kids [5 0 R] /Count 1");
    expect(text).toContain("/Size 7 /Root 1 0 R");
  });

  test("points startxref at an xref table whose entries are each exactly twenty bytes", () => {
    const start = Number(/startxref\n(\d+)\n/.exec(text)?.[1]);
    expect(text.slice(start, start + 4)).toBe("xref");
    for (const entry of text.slice(text.indexOf("xref\n")).split("\n").slice(2, 8)) expect(`${entry}\n`).toHaveLength(20);
  });

  test("resolves every xref offset to the object that claims that number", () => {
    const table = text.slice(text.indexOf("xref\n"));
    const offsets = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((found) => Number(found[1]));
    offsets.forEach((offset, index) => {
      expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
  });
});

describe("a page declares the graphics states and gradients its own stream reaches for", () => {
  const bytes = writePdf(
    composePdf([
      pageOf([
        { kind: "ink", tag: "artwork", channel: "fill", ink: [1, 0, 0, 0.5] },
        {
          kind: "path",
          tag: "artwork",
          commands: [{ op: "rect", x: 0, y: 0, width: 10, height: 10 }],
          shading: {
            kind: "axial",
            from: [0, 0],
            to: [10, 0],
            stops: [
              { at: 0, ink: [1, 0, 0] },
              { at: 1, ink: [0, 0, 1] },
            ],
          },
        },
      ]),
    ]),
  );
  const text = decoder.decode(bytes);

  test("names the state an ink's alpha registered, in the page's resource dictionary", () => {
    expect(text).toContain("/ExtGState << /GS0 << /Type /ExtGState /ca 0.5 /CA 0.5 >> >>");
    expect(text).toContain("/GS0 gs 1 0 0 rg");
  });

  test("names the gradient the path is clipped to, and paints it through that clip", () => {
    expect(text).toContain("/Shading << /Sh0 << /ShadingType 2");
    expect(text).toContain("W n /Sh0 sh Q");
  });
});

describe("an image is one object, pointed at from the page that draws it", () => {
  const image: PdfImage = {
    width: 2,
    height: 1,
    bytes: new Uint8Array([1, 2]),
    bitsPerComponent: 8,
    colourSpace: "/DeviceRGB",
    filter: "FlateDecode",
    mask: { width: 2, height: 1, bytes: new Uint8Array([3]), bitsPerComponent: 8, colourSpace: "/DeviceGray", filter: "FlateDecode" },
  };
  const text = decoder.decode(writePdf(composePdf([pageOf([{ kind: "image", tag: "artwork", x: 10, y: 100, width: 40, height: 20, image }])])));

  test("numbers the image and its mask before the first page, so the page numbering stays derivable", () => {
    expect(text).toContain("/SMask 6 0 R");
    expect(text).toContain("/Type /Pages /Kids [7 0 R]");
  });

  test("names it in the page's resources and draws it through a bracketed transform", () => {
    expect(text).toContain("/XObject << /Im0 5 0 R >>");
    expect(text).toContain(`q 40 0 0 20 10 ${PAGE_HEIGHT - 120} cm /Im0 Do Q`);
  });
});

describe("a tagged document carries the tree its own display-list tags describe", () => {
  const nodes: PdfNode[] = [
    { kind: "text", tag: "title", x: 0, y: 10, run: "Declaration", face: "bold", size: 14, tracking: 0 },
    { kind: "path", tag: "rule", commands: [{ op: "move", x: 0, y: 20 }], paint: "stroke", weight: 0.5 },
    { kind: "text", tag: "value", x: 0, y: 30, run: "Du Toit", face: "regular", size: 10, tracking: 0 },
  ];
  const tagged = decoder.decode(writePdf(composePdf([pageOf(nodes)], undefined, undefined, { lang: "en-ZA" })));
  const plain = decoder.decode(writePdf(composePdf([pageOf(nodes)])));

  test("brackets each run in the stream, and marks a rule as an artifact rather than content", () => {
    expect(tagged).toContain("/H1 << /MCID 0 >> BDC");
    expect(tagged).toContain("/Artifact BMC");
    expect(tagged).toContain("/P << /MCID 1 >> BDC");
  });

  test("gives every typed run an element pointing back at the page and the id that drew it", () => {
    expect(tagged).toContain("/Type /StructElem /S /H1");
    expect(tagged).toContain("/Type /StructTreeRoot");
    expect(tagged).toContain("/StructParents 0");
  });

  test("declares itself marked, names its language, and asks a viewer to show the title", () => {
    expect(tagged).toContain("/MarkInfo << /Marked true >>");
    expect(tagged).toContain("/Lang (en-ZA)");
    expect(tagged).toContain("/ViewerPreferences << /DisplayDocTitle true >>");
  });

  test("a figure enters the tree only with the text a reader announces in its place", () => {
    const drawing = (alt?: string): PdfNode => ({
      kind: "path",
      tag: "artwork",
      commands: [{ op: "close" }],
      ...(alt === undefined ? {} : { alt }),
    });
    const described = decoder.decode(writePdf(composePdf([pageOf([drawing("A mark")])], undefined, undefined, { lang: "en" })));
    const bare = decoder.decode(writePdf(composePdf([pageOf([drawing()])], undefined, undefined, { lang: "en" })));
    expect(described).toContain("/S /Figure");
    expect(described).toContain("/Alt (A mark)");
    expect(bare).not.toContain("/Figure");
    expect(bare).toContain("/Artifact BMC");
  });

  test("an untagged document writes no structure object at all, so nothing claims a structure it lacks", () => {
    expect(plain).not.toContain("StructTreeRoot");
    expect(plain).not.toContain("BDC");
    expect(plain).not.toContain("/StructParents");
    expect(plain).toContain("<< /Type /Catalog /Pages 2 0 R >>");
  });
});

describe("a link is an annotation the page lists, and an element the tree reaches", () => {
  const linked = (target: PdfLink["target"]): PdfPage => ({
    nodes: [{ kind: "text", tag: "link", x: 10, y: 20, run: "Terms", face: "regular", size: 10, tracking: 0 }],
    links: [{ target, x: 10, y: 10, width: 40, height: 12 }],
    y: 0,
    letterheadNodes: 0,
  });

  test("an external address becomes a URI action, in a rectangle flipped into user space", () => {
    const text = decoder.decode(writePdf(composePdf([linked({ uri: "https://example.org/terms" })])));
    expect(text).toContain("/Type /Annot /Subtype /Link");
    expect(text).toContain("/A << /S /URI /URI (https://example.org/terms) >>");
    expect(text).toContain(`/Rect [10 ${PAGE_HEIGHT - 22} 50 ${PAGE_HEIGHT - 10}]`);
  });

  test("an internal destination names the page object rather than an address", () => {
    expect(decoder.decode(writePdf(composePdf([linked({ page: 0 }), linked({ page: 0 })])))).toContain("/Dest [7 0 R /Fit]");
  });

  test("the page lists what it carries, and a page with no link lists nothing", () => {
    expect(decoder.decode(writePdf(composePdf([linked({ page: 0 })])))).toContain("/Annots [5 0 R]");
    expect(decoder.decode(writePdf(composePdf([pageOf([])])))).not.toContain("/Annots");
  });

  test("a tagged link reaches a reader through its annotation as well as its words", () => {
    const text = decoder.decode(writePdf(composePdf([linked({ uri: "https://example.org" })], undefined, undefined, { lang: "en" })));
    expect(text).toContain("/S /Link");
    expect(text).toContain("/K [0 << /Type /OBJR /Obj 5 0 R >>]");
  });
});

describe("what the metadata option writes beyond the information dictionary", () => {
  const heads: PdfNode[] = [
    { kind: "text", tag: "title", x: 0, y: 10, run: "Declaration", face: "bold", size: 14, tracking: 0 },
    { kind: "text", tag: "heading", x: 0, y: 30, run: "PART A", face: "bold", size: 12, tracking: 0 },
  ];
  const written = decoder.decode(writePdf(composePdf([pageOf(heads)]), undefined, { xmp: "<?xpacket?>" }));

  test("carries the XMP packet unfiltered, so a checker finds it in the file as it stands", () => {
    expect(written).toContain("/Type /Metadata /Subtype /XML");
    expect(written).toContain("<?xpacket?>");
    expect(written).not.toContain("/Filter /FlateDecode");
  });

  test("builds the outline from the document's own heads, nested by the level each is set at", () => {
    expect(written).toContain("/Type /Outlines");
    expect(written).toContain("/Title (Declaration)");
    expect(written).toContain("/Title (PART A)");
    expect(written).toContain("/PageMode /UseOutlines");
  });

  test("writes neither where the option names neither, so a plain file declares no metadata it has not got", () => {
    const bare = decoder.decode(writePdf(composePdf([pageOf(heads)])));
    expect(bare).not.toContain("/Metadata");
    expect(bare).not.toContain("/Outlines");
  });
});

describe("/Length counts bytes, because that is what a reader seeks by", () => {
  test("a stream carrying a multi-byte character declares its byte length, not its character count", () => {
    // Every byte above 0x7e is written as a three-character octal escape, so a character count
    // equals the byte count only while the stream is ASCII — and a reader seeking by it overruns.
    const stream = "BT /F1 10 Tf 0 Tc 56 742 Td (caf\\351) Tj ET";
    const bytes = writePdf(
      composePdf([pageOf([{ kind: "text", tag: "value", x: 56, y: 100, run: "café", face: "regular", size: 10, tracking: 0 }])]),
    );
    const declared = Number(/\/Length (\d+) >>/.exec(decoder.decode(bytes))?.[1]);
    expect(declared).toBe(new TextEncoder().encode(stream).length);
  });
});

describe("an embedded face is addressed by where it sits in the document's fonts", () => {
  // Addressed by position rather than by a name hash: `Face1000` and `Face3661` are the collision
  // class, and two faces on one resource name set one's runs in the other's glyphs, undisclosed.
  const faceOf = (name: string): PdfEmbeddedFont => ({
    name,
    postScriptName: `${name}-Regular`,
    sfnt: new Uint8Array([0]),
    glyphs: new Map([[65, 3]]),
    metrics: { unitsPerEm: 1000, ascent: 800, descent: -200, bbox: [0, 0, 1000, 1000], advances: new Map([[65, 500]]) },
  });
  const fonts = [faceOf("Face1000"), faceOf("Face3661")];
  const run = (embedded: string): PdfNode => ({
    kind: "text",
    tag: "value",
    x: 0,
    y: 10,
    run: "A",
    face: "regular",
    size: 10,
    tracking: 0,
    embedded,
  });
  const text = decoder.decode(writePdf(composePdf([pageOf([run("Face1000"), run("Face3661")])], undefined, fonts)));

  test("gives each face its own resource name, where a hash of the name gave them one", () => {
    expect(text).toContain("/E0 ");
    expect(text).toContain("/E1 ");
  });

  test("sets each run in the face it names, rather than in whichever face won the collision", () => {
    expect(text).toContain("BT /E0 10 Tf");
    expect(text).toContain("BT /E1 10 Tf");
  });
});
