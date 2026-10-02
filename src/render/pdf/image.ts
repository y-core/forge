import { err, ok } from "../../result/result";
import { MAX_PDF_IMAGE_PIXELS } from "./limits";
import type { PdfImage, PdfNode, PdfPage, PdfResult } from "./types";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8];

// Colour type to the components a pixel carries, split into the ones that are colour and the one
// that is alpha — which PDF keeps in a separate image rather than interleaved.
const CHANNELS: Readonly<Record<number, { colour: number; alpha: number; space: string }>> = {
  0: { colour: 1, alpha: 0, space: "/DeviceGray" },
  2: { colour: 3, alpha: 0, space: "/DeviceRGB" },
  3: { colour: 1, alpha: 0, space: "" },
  4: { colour: 1, alpha: 1, space: "/DeviceGray" },
  6: { colour: 3, alpha: 1, space: "/DeviceRGB" },
};

const JPEG_SPACES: Readonly<Record<number, string>> = { 1: "/DeviceGray", 3: "/DeviceRGB", 4: "/DeviceCMYK" };

function refuse(message: string): PdfResult<never> {
  return err({ kind: "image", message });
}

function starts(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, at) => bytes[at] === byte);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function be32(bytes: Uint8Array, at: number): number {
  return (((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) >>> 0;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const estimate = a + b - c;
  const [da, db, dc] = [Math.abs(estimate - a), Math.abs(estimate - b), Math.abs(estimate - c)];
  if (da <= db && da <= dc) return a;
  return db <= dc ? b : c;
}

// PNG's five filters are what `/Predictor 15` describes, so a passthrough never runs this; only the
// alpha path does, because splitting a channel out means seeing the samples themselves.
function unfilter(raw: Uint8Array, stride: number, height: number, sample: number): Uint8Array {
  const out = new Uint8Array(stride * height);
  let at = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[at] ?? 0;
    at += 1;
    const from = row * stride;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= sample ? (out[from + index - sample] ?? 0) : 0;
      const above = row === 0 ? 0 : (out[from - stride + index] ?? 0);
      const corner = row === 0 || index < sample ? 0 : (out[from - stride + index - sample] ?? 0);
      const guess = filter === 1 ? left : filter === 2 ? above : filter === 3 ? (left + above) >> 1 : filter === 4 ? paeth(left, above, corner) : 0;
      out[from + index] = ((raw[at + index] ?? 0) + guess) & 0xff;
    }
    at += stride;
  }
  return out;
}

// A declared length is the one number in the file a crafted PNG controls outright, and the cursor
// advances by it: a length past the buffer is refused here rather than read as the rest of the file.
function chunksOf(bytes: Uint8Array): { type: string; data: Uint8Array }[] | undefined {
  const chunks: { type: string; data: Uint8Array }[] = [];
  let at = PNG_SIGNATURE.length;
  while (at + 8 <= bytes.length) {
    const length = be32(bytes, at);
    if (length > bytes.length - at - 8) return undefined;
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
    at += length + 12;
  }
  return chunks;
}

function parms(colours: number, depth: number, width: number): string {
  return `<< /Predictor 15 /Colors ${colours} /BitsPerComponent ${depth} /Columns ${width} >>`;
}

async function withAlpha(
  idat: Uint8Array,
  head: { width: number; height: number; depth: number; colour: number; alpha: number; space: string },
): Promise<PdfResult<PdfImage>> {
  const { width, height, depth, colour, alpha, space } = head;
  const bytes = depth / 8;
  const sample = (colour + alpha) * bytes;
  // A truncated or corrupt IDAT fails inside the runtime's own decompressor, so the throw is caught
  // here and answered as this namespace's refusal rather than escaping past the `PdfResult`.
  let pixels: Uint8Array;
  try {
    pixels = unfilter(await inflate(idat), width * sample, height, sample);
  } catch {
    return refuse("png: the IDAT data does not inflate to the rows the header declares — the file is truncated or corrupt");
  }
  const colourBytes = new Uint8Array(width * height * colour * bytes);
  const alphaBytes = new Uint8Array(width * height * alpha * bytes);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    colourBytes.set(pixels.subarray(pixel * sample, pixel * sample + colour * bytes), pixel * colour * bytes);
    alphaBytes.set(pixels.subarray(pixel * sample + colour * bytes, (pixel + 1) * sample), pixel * alpha * bytes);
  }
  return ok({
    width,
    height,
    bytes: await deflate(colourBytes),
    bitsPerComponent: depth,
    colourSpace: space,
    filter: "FlateDecode",
    mask: { width, height, bytes: await deflate(alphaBytes), bitsPerComponent: depth, colourSpace: "/DeviceGray", filter: "FlateDecode" },
  });
}

async function readPng(bytes: Uint8Array): Promise<PdfResult<PdfImage>> {
  const chunks = chunksOf(bytes);
  if (chunks === undefined) return refuse("png: a chunk declares a length past the end of the file, so its chunks cannot be walked");
  const header = chunks.find((chunk) => chunk.type === "IHDR")?.data;
  if (header === undefined) return refuse("png: the file carries no IHDR chunk, so it is not a PNG this engine can read");
  const [width, height, depth, colour] = [be32(header, 0), be32(header, 4), header[8] ?? 0, header[9] ?? 0];
  if ((header[12] ?? 0) !== 0) {
    return refuse("png: an interlaced PNG is not embedded — Adam7 would mean a full decode, and re-saving it without interlacing is one step");
  }
  const channels = CHANNELS[colour];
  if (channels === undefined) return refuse(`png: colour type ${colour} is not one this engine reads`);
  // The header is judged before anything is sized from it: every allocation below is a multiple of
  // these three numbers, and a header is what a crafted file gets to choose.
  if (width < 1 || height < 1 || width * height > MAX_PDF_IMAGE_PIXELS) {
    return refuse(`png: ${width}×${height} is past the ${MAX_PDF_IMAGE_PIXELS}-pixel ceiling a decode is bounded by`);
  }
  // Splitting an alpha channel out addresses whole samples, which a depth under eight does not give:
  // the stride would be fractional and every row would be read off its own boundary.
  if (channels.alpha > 0 && depth !== 8 && depth !== 16) {
    return refuse(`png: colour type ${colour} at ${depth} bits is not embedded — re-save it at 8 or 16 bits a channel`);
  }
  // Colour-key transparency names one sample the file draws as clear, and PDF carries transparency
  // only as a soft mask — so a passthrough would paint that key solid rather than leave it out.
  if (chunks.some((chunk) => chunk.type === "tRNS")) {
    return refuse("png: a tRNS chunk is colour-key transparency, which is not embedded — re-save it as RGBA and its alpha becomes a soft mask");
  }
  const idat = chunks.filter((chunk) => chunk.type === "IDAT");
  const data = new Uint8Array(idat.reduce((total, chunk) => total + chunk.data.length, 0));
  idat.reduce((at, chunk) => {
    data.set(chunk.data, at);
    return at + chunk.data.length;
  }, 0);

  if (channels.alpha > 0) return withAlpha(data, { width, height, depth, colour: channels.colour, alpha: channels.alpha, space: channels.space });

  if (colour !== 3) {
    return ok({
      width,
      height,
      bytes: data,
      bitsPerComponent: depth,
      colourSpace: channels.space,
      filter: "FlateDecode",
      decodeParms: parms(channels.colour, depth, width),
    });
  }

  const palette = chunks.find((chunk) => chunk.type === "PLTE")?.data;
  if (palette === undefined) return refuse("png: an indexed PNG with no PLTE chunk carries no colours to index");
  // A palette image stays one indexed sample per pixel: expanding it to RGB would triple the bytes
  // to say what the palette already says.
  return ok({
    width,
    height,
    bytes: data,
    bitsPerComponent: depth,
    colourSpace: `[/Indexed /DeviceRGB ${palette.length / 3 - 1} <${hex(palette)}>]`,
    filter: "FlateDecode",
    decodeParms: parms(1, depth, width),
  });
}

// The frame header is the only marker worth reading: it carries the size and the component count,
// and everything else in the file is what `/DCTDecode` hands to the viewer untouched.
function readJpeg(bytes: Uint8Array): PdfResult<PdfImage> {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return refuse("jpeg: the file's marker segments do not line up, so its frame header cannot be read");
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xc0 || marker === 0xc1) {
      const components = bytes[at + 9] ?? 0;
      const space = JPEG_SPACES[components];
      if (space === undefined) return refuse(`jpeg: a frame of ${components} components is not one PDF names a colour space for`);
      return ok({
        width: ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0),
        height: ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0),
        bytes,
        bitsPerComponent: bytes[at + 4] ?? 8,
        colourSpace: space,
        filter: "DCTDecode",
      });
    }
    if (marker >= 0xc2 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return refuse("jpeg: only a baseline or extended sequential frame is embedded — re-save a progressive JPEG as baseline");
    }
    at += 2 + (((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0));
  }
  return refuse("jpeg: the file ends before a frame header, so it carries no image");
}

/** Prepares an image for embedding, decoding only what PDF cannot carry as it stands. @public */
export async function createPdfImage(bytes: Uint8Array): Promise<PdfResult<PdfImage>> {
  if (starts(bytes, PNG_SIGNATURE)) return readPng(bytes);
  if (starts(bytes, JPEG_SIGNATURE)) return readJpeg(bytes);
  return refuse("the bytes begin with neither a PNG nor a JPEG signature; those are the two this engine embeds");
}

/** Every image a document draws, in the order it first reaches for one. @internal */
export function collectPdfImages(pages: readonly PdfPage[]): readonly PdfImage[] {
  const seen = new Set<PdfImage>();
  const isImage = (node: PdfNode): node is Extract<PdfNode, { kind: "image" }> => node.kind === "image";
  for (const page of pages) for (const node of page.nodes.filter(isImage)) seen.add(node.image);
  return [...seen];
}

/** One image as the object a page's resources point at, with its soft mask already numbered. @internal */
export function imageObject(image: PdfImage, mask: number | undefined): { head: string; bytes: Uint8Array; tail: string } {
  const entries = [
    "/Type /XObject /Subtype /Image",
    `/Width ${image.width} /Height ${image.height}`,
    `/ColorSpace ${image.colourSpace} /BitsPerComponent ${image.bitsPerComponent}`,
    `/Filter /${image.filter}`,
    ...(image.decodeParms === undefined ? [] : [`/DecodeParms ${image.decodeParms}`]),
    ...(mask === undefined ? [] : [`/SMask ${mask} 0 R`]),
    `/Length ${image.bytes.length}`,
  ];
  return { head: `<< ${entries.join(" ")} >>\nstream\n`, bytes: image.bytes, tail: "\nendstream" };
}
