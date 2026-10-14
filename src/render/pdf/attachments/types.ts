/** The ceilings a read holds a file to, each refused by name once passed. @public */
export interface PdfAttachmentLimits {
  /** Bytes; a larger file is refused unread. Defaults to 6 MiB. */
  maxInputBytes?: number | undefined;
  /** Counts packed objects as well as top-level ones. Defaults to 100,000. */
  maxObjects?: number | undefined;
  /** Bytes, per stream; decompression is cancelled once passed. Defaults to 6 MiB. */
  maxInflatedBytes?: number | undefined;
  /** Bytes, summed over every stream the read decodes, a stored one included; decompression is cancelled once passed. Defaults to 6 MiB. */
  maxTotalDecodedBytes?: number | undefined;
}

/** What one read may still decode, charged as each stream it reaches is decoded. @internal */
export interface PdfDecodeBudget {
  perStream: number;
  total: number;
  spent: number;
}

/** One object read back out of a file, with its dictionary text and the stream payload it declared. @internal */
export interface PdfParsedObject {
  id: number;
  dict: string;
  stream?: Uint8Array<ArrayBuffer>;
  container?: number;
}

/** One value of PDF's object syntax, with a reference left for the caller to resolve. @internal */
export type PdfParsedValue =
  | { kind: "name"; value: string }
  | { kind: "string"; bytes: Uint8Array<ArrayBuffer> }
  | { kind: "number"; value: number }
  | { kind: "ref"; id: number }
  | { kind: "array"; items: PdfParsedValue[] }
  | { kind: "dict"; entries: ReadonlyMap<string, PdfParsedValue> }
  | { kind: "keyword"; value: string };
