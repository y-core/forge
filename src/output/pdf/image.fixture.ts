const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const TABLE = Array.from({ length: 256 }, (_entry, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, data: readonly number[]): number[] {
  const typed = [...type].map((character) => character.charCodeAt(0));
  return [...be32(data.length), ...typed, ...data, ...be32(crc32(new Uint8Array([...typed, ...data])))];
}

async function idat(rows: readonly (readonly number[])[], filters: readonly number[]): Promise<number[]> {
  const raw = new Uint8Array(rows.flatMap((row, index) => [filters[index] ?? 0, ...row]));
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return [...new Uint8Array(await new Response(stream).arrayBuffer())];
}

/** A PNG of `rows`, built to order so a test states the bytes it means rather than carrying a file. */
export async function pngBytes(options: {
  width: number;
  height: number;
  depth: number;
  colour: number;
  rows: readonly (readonly number[])[];
  palette?: readonly number[] | undefined;
  interlaced?: boolean | undefined;
  transparency?: readonly number[] | undefined;
  /** The PNG filter each row is stored under; every row is stored unfiltered where it says nothing. */
  filters?: readonly number[] | undefined;
}): Promise<Uint8Array> {
  const head = header(options.width, options.height, options.depth, options.colour);
  if (options.interlaced === true) head[12] = 1;
  return new Uint8Array([
    ...SIGNATURE,
    ...chunk("IHDR", head),
    ...(options.palette === undefined ? [] : chunk("PLTE", options.palette)),
    ...(options.transparency === undefined ? [] : chunk("tRNS", options.transparency)),
    ...chunk("IDAT", await idat(options.rows, options.filters ?? [])),
    ...chunk("IEND", []),
  ]);
}

function header(width: number, height: number, depth: number, colour: number): number[] {
  return [...be32(width), ...be32(height), depth, colour, 0, 0, 0];
}

/** A PNG whose IHDR declares `length` rather than its own, which is what a hostile chunk length is. */
export function pngDeclaringLength(length: number): Uint8Array {
  const data = header(1, 1, 8, 0);
  const typed = [..."IHDR"].map((character) => character.charCodeAt(0));
  const declared = [...be32(length), ...typed, ...data, ...be32(crc32(new Uint8Array([...typed, ...data])))];
  return new Uint8Array([...SIGNATURE, ...declared, ...chunk("IEND", [])]);
}

/** A PNG whose IDAT carries `data` as it stands, so a test can state bytes that do not inflate. */
export function pngRawIdat(options: { width: number; height: number; depth: number; colour: number; data: readonly number[] }): Uint8Array {
  return new Uint8Array([
    ...SIGNATURE,
    ...chunk("IHDR", header(options.width, options.height, options.depth, options.colour)),
    ...chunk("IDAT", [...options.data]),
    ...chunk("IEND", []),
  ]);
}

/** A JPEG carrying nothing but the frame header the embedder reads, and the entropy-coded byte after it. */
export function jpegBytes(width: number, height: number, components: number, marker = 0xc0): Uint8Array {
  const frame = [8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, components];
  const length = 8 + components * 3;
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    marker,
    (length >> 8) & 0xff,
    length & 0xff,
    ...frame,
    ...Array.from({ length: components * 3 }, () => 1),
    0xff,
    0xd9,
  ]);
}
