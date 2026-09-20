import { describe, expect, test } from "bun:test";

import { Field } from "./form";
import { paginate } from "./paginate";
import { createPdfRenderer } from "./renderer";
import type { PdfDocument } from "./types";
import { composePdf, deflate } from "./writer";

const decoder = new TextDecoder("latin1");

const DOC: PdfDocument = {
  title: "Declaration of interest",
  content: Array.from({ length: 40 }, () => Field({ fields: [{ label: "Surname", value: "Du Toit" }] })),
};

async function bytesOf(compress?: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const rendered = await createPdfRenderer(compress === undefined ? {} : { compress }).render(DOC);
  if (!rendered.ok) throw new Error(rendered.error.message);
  return rendered.data;
}

// A deflate stream's bytes are the runtime compressor's business, so a feature is asserted against
// what the stream inflates to rather than against the stream itself.
async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

describe("compression defaults on", () => {
  test("declares the filter and produces a smaller file than the uncompressed one", async () => {
    const [on, off] = [await bytesOf(), await bytesOf(false)];
    expect(decoder.decode(on)).toContain("/Filter /FlateDecode");
    expect(on.length).toBeLessThan(off.length);
  });

  test("writes no filter at all when the caller turns it off", async () => {
    expect(decoder.decode(await bytesOf(false))).not.toContain("/Filter");
  });

  test("a compressed stream inflates to exactly the operators the uncompressed one carries", async () => {
    const [stream] = composePdf(paginate(DOC)).streams;
    expect(stream).toBeDefined();
    expect(await inflate(await deflate(stream ?? ""))).toBe(stream ?? "");
  });

  test("declares the compressed byte length, which is what a reader seeks by", async () => {
    const bytes = await bytesOf();
    const declared = Number(/\/Length (\d+) \/Filter/.exec(decoder.decode(bytes))?.[1]);
    expect(declared).toBeGreaterThan(0);
    expect(declared).toBeLessThan(Number(/\/Length (\d+) >>/.exec(decoder.decode(await bytesOf(false)))?.[1]));
  });

  test("stays deterministic: two compressed renders of one document are byte-identical", async () => {
    expect([...(await bytesOf())]).toEqual([...(await bytesOf())]);
  });

  test("keeps the file structurally readable, with its xref still resolving", async () => {
    const text = decoder.decode(await bytesOf());
    const start = Number(/startxref\n(\d+)\n/.exec(text)?.[1]);
    expect(text.slice(start, start + 4)).toBe("xref");
    const offsets = [...text.slice(text.indexOf("xref\n")).matchAll(/^(\d{10}) 00000 n $/gm)].map((found) => Number(found[1]));
    offsets.forEach((offset, index) => {
      expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
  });
});
