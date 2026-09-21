import { describe, expect, test } from "bun:test";

import { parsePdfObjects } from "./conform/parse.fixture";
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

  // Asked as a question of the resolved file rather than of its byte layout: the layout is exactly
  // what the cross-reference stream changes, and a test scraping it asserts the writer's habits.
  test("keeps the file structurally readable, with every reference it makes resolving to an object", async () => {
    const file = await parsePdfObjects(await bytesOf());
    expect(file.trailer).toContain("/Root 1 0 R");
    expect(file.objects.get(2)?.dict).toContain("/Type /Pages");
    const kids = /\/Kids \[([^\]]*)\]/.exec(file.objects.get(2)?.dict ?? "")?.[1] ?? "";
    const referenced = [...kids.matchAll(/(\d+) 0 R/g)].map((found) => Number(found[1]));
    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) expect(file.objects.get(id)?.dict).toContain("/Type /Page ");
  });
});
