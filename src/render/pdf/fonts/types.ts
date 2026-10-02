import type { Result } from "../../../result/types";

/** How slanted a face is; a requested italic is never synthesised from a roman. @public */
export type PdfFontStyle = "normal" | "italic" | "oblique";

/** A face's weight on the CSS scale, where 400 is regular and 700 bold. @public */
export type PdfFontWeight = number;

/** A face's width on the CSS percentage scale, where 100 is normal. @public */
export type PdfFontStretch = number;

/** What a run asks for, before the ladder turns it into a face that exists. @public */
export interface PdfFontRequest {
  family: string;
  weight?: PdfFontWeight | undefined;
  style?: PdfFontStyle | undefined;
  stretch?: PdfFontStretch | undefined;
}

/** The advances a face sets at, per 1000 units of the em, by code point. @public */
export interface PdfFontMetrics {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  /** The face's own bounding box in font units, which the file's font descriptor declares. */
  bbox: readonly [number, number, number, number];
  advances: ReadonlyMap<number, number>;
  /** The glyph id the subset assigned each code point, which `Identity-H` addresses. */
  glyphs: ReadonlyMap<number, number>;
  /** Pair adjustments pulled from GPOS at build time, keyed by the two code points. */
  kerning?: ReadonlyMap<string, number> | undefined;
}

/** One concrete face: a family member at a weight, a style and a width. @public */
export interface PdfFace {
  family: string;
  /** What the file's `/BaseFont` and `/FontName` are written as, read off the face's own `name` table. */
  postScriptName: string;
  weight: PdfFontWeight;
  style: PdfFontStyle;
  stretch: PdfFontStretch;
  metrics: PdfFontMetrics;
  /** The subset sfnt the writer embeds; absent while a pack ships metrics only. */
  sfnt?: Uint8Array | undefined;
}

/** A pack exactly as the asset pipeline writes it: plain JSON, which is the contract. @public */
export interface PdfFontPackData {
  family: string;
  faces: {
    postScriptName: string;
    weight: PdfFontWeight;
    style: PdfFontStyle;
    stretch: PdfFontStretch;
    /** Where the subset face was written, relative to the asset root. */
    sfnt: string;
    metrics: {
      unitsPerEm: number;
      ascent: number;
      descent: number;
      bbox: readonly [number, number, number, number];
      advances: Record<string, number>;
      glyphs: Record<string, number>;
      kerning: Record<string, number>;
    };
  }[];
}

/** A family and the faces shipped for it. @public */
export interface PdfFontPack {
  family: string;
  faces: readonly PdfFace[];
}

/** Why a requested face could not be resolved to one that exists. @public */
export interface PdfFontError {
  kind: "unknown-family" | "no-style";
  message: string;
}

/** The families a document may select from. @public */
export interface PdfFontSet {
  readonly families: readonly string[];
  match(request: PdfFontRequest): Result<PdfFace, PdfFontError>;
}
