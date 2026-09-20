import type { Result } from "../../result/types";

/** How a run is set, in the terms that change how wide it measures. @internal */
export interface TextStyle {
  bold?: boolean | undefined;
  tracking?: number | undefined;
}

/** An ink as PDF's own device RGB, with an optional fourth component carrying its alpha. @internal */
export type Ink = readonly [number, number, number, number?];

/** One run of a mark and the paint it carries, in the artwork's own coordinate space. @public */
export interface PdfArtworkPath {
  commands: readonly PdfPathCommand[];
  fill?: Ink | undefined;
  stroke?: Ink | undefined;
  weight?: number | undefined;
}

// The artifact is the contract between the asset pipeline and this engine: plain JSON, so neither
// namespace names the other's types and the file on disk is what has to stay in step.
/** A mark converted to paths at build time, which is the only form this engine draws one in. @public */
export interface PdfArtwork {
  width: number;
  height: number;
  paths: readonly PdfArtworkPath[];
  /** What a reader announces in place of the drawing; a mark with none is decoration. */
  alt?: string | undefined;
}

/** The letterhead repeated at the head of every page. @public */
export interface PdfLetterhead {
  name: string;
  tagline: string;
  email: string;
  phone: string;
  /** The mark set beside the wording, as the asset pipeline's own output. */
  mark?: PdfArtwork | undefined;
  /** How wide the mark is drawn, which is what its own coordinates are scaled out of. */
  markWidth?: number | undefined;
}

/** The state a printed tick box is in. @public */
export type PdfMark = "ticked" | "crossed" | "empty";

/** One of a pair of cells set side by side: an answer, or a rule to write one on. @public */
export type PdfCell = { label: string; value: string } | { label: string; blank: true };

/** One box and the wording beside it, as an option of a question or a line of a list. @public */
export interface PdfTick {
  label: string;
  mark: PdfMark;
}

/** One track of a row: a number is a share of what is left over, `{ points }` a fixed width. @public */
export type PdfTrack = number | { points: number };

/** How many of a row's twelve columns one field spans. @public */
export type PdfSpan = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** Where a label sits relative to its answer. @public */
export type PdfLabels = "beside" | "above";

/** One field of a row: what it asks, the answer where there is one, and where it sits. @public */
export interface PdfField {
  label: string;
  value?: string | undefined;
  span?: PdfSpan | undefined;
  start?: number | undefined;
  labels?: PdfLabels | undefined;
}

/** Why a document could not be rendered, as the one failure channel this namespace answers on. @public */
export interface PdfRenderError {
  kind: "max-pages" | "colour-notation" | "compress" | "image" | "link" | "metadata" | "tagged" | "encoding" | "font";
  message: string;
}

/** A render outcome, narrowed to this namespace's failure shape. @public */
export type PdfResult<T> = Result<T, PdfRenderError>;

/** What a node is, in the document's own terms, so the structure tree reads a role and not a shape. @public */
export type PdfTag = "artwork" | "heading" | "intro" | "label" | "letterhead" | "link" | "mark" | "note" | "rule" | "subtitle" | "title" | "value";

/** Which of the two base-14 faces a run is set in. @public */
export type PdfBaseFace = "regular" | "bold";

/** What every node carries about the structure it belongs to. @internal */
export interface PdfTagged {
  tag: PdfTag;
  /** What a reader announces in place of a drawing; a drawing with none is decoration. */
  alt?: string | undefined;
}

/** A run of type at an absolute position, measured down from the page's top edge. @internal */
export interface PdfTextNode extends PdfTagged {
  kind: "text";
  x: number;
  y: number;
  run: string;
  face: PdfBaseFace;
  size: number;
  tracking: number;
  /** What the writer substitutes for `run` as it emits, once the page and the count are known. */
  placeholder?: PdfPlaceholder | undefined;
  /** The embedded face this run is set in; absent where the base-14 pair sets it. */
  embedded?: string | undefined;
}

/** A running header or footer: the elements it lays out to, and the room it takes on every page. @internal */
export interface PdfBand {
  elements: readonly PdfElement[];
  height: number;
}

/** The embedded faces a document draws with, each under the name a run refers to it by. @public */
export type PdfDocumentFonts = readonly PdfEmbeddedFont[];

// A pair rather than one face: `face` is discarded once a node carries `embedded`, so a single
// default would set every bold run in the regular weight.
/** The embedded faces a whole document is set in, named from `fonts`, one per base face. @public */
export type PdfDefaultFaces = Record<PdfBaseFace, string>;

/** The metrics an embedded face ships beside its bytes. @public */
export interface PdfEmbeddedMetrics {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  bbox: readonly [number, number, number, number];
  /** Advance per 1000 units of the em, by code point. */
  advances: ReadonlyMap<number, number>;
  /** Pair adjustments per 1000 units, keyed `"<left>,<right>"` by code point. */
  kerning?: ReadonlyMap<string, number> | undefined;
}

/** One face written into the file: its bytes, the glyphs it covers, and how it measures. @public */
export interface PdfEmbeddedFont {
  /** The name a run refers to this face by, and the key the writer's resources use. */
  name: string;
  postScriptName: string;
  sfnt: Uint8Array;
  /** Code point to glyph id, which `Identity-H` addresses directly. */
  glyphs: ReadonlyMap<number, number>;
  metrics: PdfEmbeddedMetrics;
}

/** A face and the code points it can set, which is what a fallback decision is made on. @internal */
export interface PdfFaceCoverage {
  name: string;
  covers(code: number): boolean;
}

/** One stretch of a run and the face that sets it; an absent face is one nothing covers. @internal */
export interface PdfFaceRun {
  face: string | undefined;
  run: string;
}

/** What the trailer carries beyond the catalog: the information dictionary and the file identifier. @internal */
export interface PdfFileMetadata {
  info?: string | undefined;
  id?: string | undefined;
  /** The XMP packet, which a conformance checker reads in place of the dictionary. */
  xmp?: string | undefined;
}

/** Which page is being emitted, and how many the document has. @internal */
export interface PdfPagePosition {
  index: number;
  count: number;
}

/** A value only the writer knows: which page this is, and how many there are. @internal */
export type PdfPlaceholder = "page-number" | "page-count";

/** One step of a path, in the engine's y-down space; the writer flips it as it emits. @public */
export type PdfPathCommand =
  | { op: "move"; x: number; y: number }
  | { op: "line"; x: number; y: number }
  | { op: "curve"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: "rect"; x: number; y: number; width: number; height: number }
  | { op: "close" };

/** A path under construction: every step returns the pen, and `commands` closes it. @public */
export interface PdfPen {
  move(x: number, y: number): PdfPen;
  line(x: number, y: number): PdfPen;
  curve(x1: number, y1: number, x2: number, y2: number, x: number, y: number): PdfPen;
  rect(x: number, y: number, width: number, height: number): PdfPen;
  close(): PdfPen;
  commands(): readonly PdfPathCommand[];
}

/** A box's four corner radii; a corner that names none takes `all`. @public */
export interface PdfCorners {
  all?: number | undefined;
  topLeft?: number | undefined;
  topRight?: number | undefined;
  bottomRight?: number | undefined;
  bottomLeft?: number | undefined;
}

/** Where a gradient reaches an ink, from zero at its start to one at its end. @public */
export interface PdfShadingStop {
  at: number;
  ink: Ink;
}

/** A gradient fill: axial between two points, or radial between two circles. @public */
export type PdfShading =
  | { kind: "axial"; from: readonly [number, number]; to: readonly [number, number]; stops: PdfShadingStops }
  | { kind: "radial"; from: readonly [number, number, number]; to: readonly [number, number, number]; stops: PdfShadingStops };

/** A gradient's stops, which the type requires two of because one ink is not a gradient. @public */
export type PdfShadingStops = readonly [PdfShadingStop, PdfShadingStop, ...PdfShadingStop[]];

/** How a path is painted, beyond the geometry it draws. @internal */
export interface PdfPathPaint {
  paint?: "fill" | "stroke" | "fill-stroke" | undefined;
  weight?: number | undefined;
  /** Opacity from zero to one, which reaches the page as an `ExtGState`. */
  alpha?: number | undefined;
  /** A gradient the path is clipped to, which takes the place of the current fill ink. */
  shading?: PdfShading | undefined;
}

/** An image in the form PDF carries it: the stream's own bytes and what the dictionary says of them. @public */
export interface PdfImage {
  width: number;
  height: number;
  /** The stream as the filter below names it, which for a passthrough is the source's own bytes. */
  bytes: Uint8Array;
  bitsPerComponent: number;
  /** `/DeviceGray`, `/DeviceRGB`, `/DeviceCMYK`, or an `/Indexed` array carrying its own palette. */
  colourSpace: string;
  filter: "DCTDecode" | "FlateDecode";
  /** What the filter is parameterised by, as PNG's own filtering is by a predictor. */
  decodeParms?: string | undefined;
  /** The alpha channel as a separate image, which is the only form PDF carries transparency in. */
  mask?: PdfImage | undefined;
}

/** An image drawn into a rectangle, anchored at its top-left. @internal */
export interface PdfImageNode extends PdfTagged {
  kind: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  image: PdfImage;
  alpha?: number | undefined;
}

/** One path and how it is painted, with its geometry already resolved. @internal */
export interface PdfPathNode extends PdfPathPaint, PdfTagged {
  kind: "path";
  commands: readonly PdfPathCommand[];
}

/** A change of fill or stroke ink, which persists until the next one. @internal */
export interface PdfInkNode extends PdfTagged {
  kind: "ink";
  channel: "fill" | "stroke";
  ink: Ink;
}

/** One drawable or one change of paint state, with its geometry already resolved. @internal */
export type PdfNode = PdfImageNode | PdfInkNode | PdfPathNode | PdfTextNode;

/** One stretch of a page's nodes a reader announces as one thing; an untyped run is an artifact. @internal */
export interface PdfMarkedRun {
  type: string | undefined;
  from: number;
  to: number;
  /** The id the content stream marks this run with, which the structure element points back at. */
  mcid: number;
  alt?: string | undefined;
}

/** One entry of the structure tree: what it is, which page carries it, and the run it covers. @internal */
export interface PdfStructureElement {
  type: string;
  page: number;
  mcid: number;
  alt?: string | undefined;
  /** The run's own words, which is what an outline entry is titled with. */
  text?: string | undefined;
}

/** Where a link goes: a page of this document, or an address outside it. @public */
export type PdfDestination = { page: number } | { uri: string };

/** One link annotation: the rectangle a reader activates, and where it takes them. @internal */
export interface PdfLink {
  target: PdfDestination;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One line of the outline: its wording, the page it opens, and the lines nested under it. @internal */
export interface PdfOutlineItem {
  title: string;
  page: number;
  children: readonly PdfOutlineItem[];
}

/** What a tagged document declares beyond the tree its own tags build. @internal */
export interface PdfTagging {
  /** The document's natural language, as a BCP 47 tag. */
  lang: string;
}

/** A run of type that takes a reader somewhere when they activate it. @public */
export interface LinkProps {
  children: readonly PdfElement[];
  to: PdfDestination;
}

/** One page's nodes, in the order they are painted. @internal */
export interface PdfPage {
  nodes: PdfNode[];
  y: number;
  letterheadNodes: number;
  /** The annotations this page carries, which are placed rather than painted. */
  links?: PdfLink[] | undefined;
}

/** What a channel decides about the page it draws; an unset ink emits nothing at all, not black. @internal */
export interface PdfChannel {
  readonly heading?: Ink | undefined;
  readonly rule?: Ink | undefined;
  readonly letterhead?: Ink | undefined;
  readonly intro?: Ink | undefined;
}

/** What a cursor decides beyond the letterhead it repeats; a scratch cursor names almost none of it. @internal */
export interface PdfCursorOptions {
  channel?: PdfChannel | undefined;
  paper?: PdfResolvedPage | undefined;
  header?: PdfBand | undefined;
  measure?: PdfBox | undefined;
  /** The baseline a page is full at; the content box's own bottom edge where it says nothing. */
  bottom?: number | undefined;
  typesetting?: PdfTypesetting | undefined;
  /** The most pages this cursor opens; a cursor naming none opens as many as it is asked for. */
  ceiling?: number | undefined;
}

/** The surface every draw routine writes through: it owns the page, the baseline and the breaks. @internal */
export interface PdfCursor {
  readonly pages: PdfPage[];
  readonly channel: PdfChannel;
  readonly paper: PdfResolvedPage;
  /** What this document measures and breaks its type by, which `place` reads rather than is passed. */
  readonly typesetting: PdfTypesetting;
  /** Where the first line of the current page sits, which is what a break resets `y` to. */
  readonly pageTop: number;
  y: number;
  readonly empty: boolean;
  tagged(tag: PdfTag, draw: () => void, alt?: string): void;
  // `null` is not `undefined` here: a run that resolved its own face down to the base-14 pair has
  // decided, and the document default must not put it back on a face that cannot set it (§7c).
  /** Draws a run. `undefined` takes the document's default face, `null` is base-14 decided. */
  text(
    run: string,
    x: number,
    y: number,
    face: PdfBaseFace,
    size: number,
    tracking?: number,
    placeholder?: PdfPlaceholder,
    embedded?: string | null,
  ): void;
  rule(y: number): void;
  segment(x: number, y: number, width: number, weight: number): void;
  polyline(points: readonly (readonly [number, number])[], weight: number): void;
  roundedRect(x: number, y: number, size: number, radius: number, weight: number): void;
  path(commands: readonly PdfPathCommand[], paint?: PdfPathPaint): void;
  /** Records an annotation over what `draw` paints, and marks everything it paints as a link. */
  linked(target: PdfDestination, box: { x: number; width: number }, draw: () => void): void;
  image(of: PdfImage, x: number, y: number, width: number, height: number, alpha?: number): void;
  ink(colour: Ink, onto?: "fill" | "stroke"): void;
  painted(ink: Ink | undefined, draw: () => void): void;
  stroked(ink: Ink | undefined, draw: () => void): void;
  newPage(): void;
  reserve(height: number): void;
}

/** A run of type, wrapped to the width it is given. @public */
export interface TextProps {
  children: string;
  size?: number | undefined;
  bold?: boolean | undefined;
  tracking?: number | undefined;
  leading?: number | undefined;
  tag?: PdfTag | undefined;
  /** Whether a word wider than its column is cut; it overflows visibly where this is unset. */
  breakWord?: boolean | undefined;
  /** The face to set this run in, or the faces to try in order; the base-14 pair is the last resort. */
  font?: PdfEmbeddedFont | readonly PdfEmbeddedFont[] | undefined;
}

/** A stack of elements, one under the next. @public */
export interface StackProps {
  children: readonly PdfElement[];
  gap?: number | undefined;
}

/** A row of elements set side by side across its tracks. @public */
export interface RowProps {
  children: readonly PdfElement[];
  tracks?: readonly PdfTrack[] | undefined;
  gap?: number | undefined;
}

/** An element inset from the box it was given. @public */
export interface BoxProps {
  children: readonly PdfElement[];
  gap?: number | undefined;
  padding?: number | undefined;
}

/** The page this is, or how many there are. @public */
export interface PageNumberProps {
  /** Renders the document's page count instead of the current page's number. */
  total?: boolean | undefined;
  size?: number | undefined;
  bold?: boolean | undefined;
  /** How many digits to reserve room for; the digits of `DEFAULT_PDF_MAX_PAGES` where it is unset. */
  digits?: number | undefined;
}

/** Empty vertical room. @public */
export interface SpacerProps {
  height: number;
}

/** A rule drawn across the width of its box. @public */
export interface DividerProps {
  weight?: number | undefined;
  tag?: PdfTag | undefined;
}

/** A path drawn in the room it is given, its commands measured from its own top-left corner. @public */
export interface PathProps {
  commands: readonly PdfPathCommand[];
  height: number;
  /** What a reader announces in place of the drawing; a path with none is decoration. */
  alt?: string | undefined;
  fill?: Ink | PdfShading | undefined;
  stroke?: Ink | undefined;
  weight?: number | undefined;
  alpha?: number | undefined;
  tag?: PdfTag | undefined;
}

/** An image set across the width of its box, or across the width it is given. @public */
export interface ImageProps {
  image: PdfImage;
  /** What a reader announces in place of the image; an image with none is decoration. */
  alt?: string | undefined;
  /** How wide to draw it; the width of its box where it says nothing. */
  width?: number | undefined;
  /** How tall to draw it; scaled from the width at the image's own aspect ratio where it says nothing. */
  height?: number | undefined;
  alpha?: number | undefined;
  tag?: PdfTag | undefined;
}

/** A rounded panel drawn behind its children, each corner free to take its own radius. @public */
export interface PanelProps {
  children: readonly PdfElement[];
  radius?: number | PdfCorners | undefined;
  padding?: number | undefined;
  gap?: number | undefined;
  fill?: Ink | PdfShading | undefined;
  stroke?: Ink | undefined;
  weight?: number | undefined;
  alpha?: number | undefined;
}

/** A group that moves to the next page whole rather than breaking inside itself. @public */
export interface KeepTogetherProps {
  children: readonly PdfElement[];
  gap?: number | undefined;
}

/** The document information dictionary, as the fields a reader shows in its properties panel. @public */
export interface PdfInfo {
  title?: string | undefined;
  author?: string | undefined;
  subject?: string | undefined;
  keywords?: string | undefined;
  creator?: string | undefined;
  producer?: string | undefined;
  /** The creation and modification dates, which default to each other where only one is given. */
  created?: Date | undefined;
  modified?: Date | undefined;
}

/** A grid whose columns agree across every row. @public */
export interface TableProps {
  /** The columns, resolved once for the whole table; one equal share each where it says nothing. */
  tracks?: readonly PdfTrack[] | undefined;
  gap?: number | undefined;
  /** The row re-emitted at the top of every page the table continues onto. */
  header?: readonly PdfElement[] | undefined;
  rows: readonly (readonly PdfElement[])[];
}

/** A page size this engine names; an unlisted size is given as points instead. @public */
export type PdfPageSize = "a2" | "a3" | "a4" | "a5" | "a6" | "letter" | "legal" | "tabloid";

/** How wide the paper is left at each edge; `all` is what a side that says nothing takes. @public */
export interface PdfMargin {
  all?: number | undefined;
  top?: number | undefined;
  right?: number | undefined;
  bottom?: number | undefined;
  left?: number | undefined;
}

/** The paper a document is set on, as data rather than a branch inside the engine. @public */
export interface PdfPageSpec {
  size?: PdfPageSize | undefined;
  /** The paper in portrait points, which takes precedence over `size`. */
  points?: readonly [number, number] | undefined;
  orientation?: "portrait" | "landscape" | undefined;
  margin?: PdfMargin | undefined;
}

/** A page spec settled into points, with every margin present. @public */
export interface PdfResolvedPage {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

/** A section heading, or a sub-heading at level two. @public */
export interface HeadingProps {
  children: string;
  level?: 1 | 2 | undefined;
}

/** One row of the grid and the fields sharing it. @public */
export interface FieldProps {
  fields: readonly PdfField[];
}

/** A paragraph of explanatory copy. @public */
export interface NoteProps {
  children: string;
}

/** A list of tick lines. @public */
export interface TickListProps {
  items: readonly PdfTick[];
}

/** A question and the boxes answering it. @public */
export interface OptionGroupProps {
  label: string;
  options: readonly PdfTick[];
}

/** A row of signature cells. @public */
export interface SignatureRowProps {
  cells: readonly PdfCell[];
}

/** How many columns a grid divides its measure into, and what sits between them. @public */
export interface PdfGridOptions {
  columns?: number | undefined;
  gap?: number | undefined;
}

/** A column grid expressed as tracks: a span is a run of them, never a count of its own. @public */
export interface PdfGrid {
  readonly columns: number;
  readonly gap: number;
  readonly tracks: readonly PdfTrack[];
  widths(available: number): number[];
  columnX(available: number, start: number): number;
  spanWidth(available: number, start: number, span: number): number;
}

/** What an element wants, what it needs at minimum, and how tall it is at the width it was asked about. @internal */
export interface PdfMeasure {
  preferred: number;
  minimum: number;
  height: number;
}

/** The room an element was given: where it starts, how wide it is, and the tallest a fresh page can hold. @internal */
export interface PdfBox {
  x: number;
  width: number;
  height: number;
}

/** One run of an element that is painted whole, or moved to the next page whole. @internal */
export interface PdfFragment {
  reserve: number;
  advance: number;
  paint(cursor: PdfCursor): void;
}

// A parameter because only these two signatures are crossed by both construction styles. Rejected:
// a module-level `withTypesetting(set, fn)` ambient, which makes `measure(width)` read a global.
/** How a document measures and breaks its type, and which embedded face sets each weight. @internal */
export interface PdfTypesetting {
  width(text: string, size: number, style?: TextStyle): number;
  wrap(text: string, size: number, width: number, style?: TextStyle, breakWord?: boolean): string[];
  preferred(text: string, size: number, style?: TextStyle): number;
  minimum(text: string, size: number, style?: TextStyle): number;
  /** The embedded face a run of this weight is set in; absent where the base-14 pair sets it. */
  embedded(of: PdfBaseFace): PdfEmbeddedFont | undefined;
}

/** Something that answers what it measures before anything draws it. @public */
export interface PdfElement {
  measure(width: number, set?: PdfTypesetting): PdfMeasure;
  fragments(box: PdfBox, set?: PdfTypesetting): readonly PdfFragment[];
  /** Whether this opens a run that is kept with what follows it, as a heading keeps its section. */
  startsSection?: boolean | undefined;
}

/** How few lines may be stranded either side of a page break. @internal */
export interface PdfBreakLimits {
  orphans?: number | undefined;
  widows?: number | undefined;
}

/** A document to render: a title, an optional subtitle, and the elements beneath them. @public */
export interface PdfDocument {
  title: string;
  intro?: string | undefined;
  subtitle?: string | undefined;
  letterhead?: PdfLetterhead | undefined;
  /** A running header, laid out once and repeated above the content on every page. */
  header?: PdfContent;
  /** A running footer, laid out once and repeated below the content on every page. */
  footer?: PdfContent;
  content: PdfContent;
}

/** What a document may be written as: elements, JSX descriptors, fragments, arrays, or nothing. @public */
export type PdfContent = PdfElement | readonly PdfContent[] | { type: unknown; props: Record<string, unknown> } | null | undefined | boolean;

/** A document's named colours, which the display list references rather than carrying values. @public */
export interface PdfPalette {
  ink(name: string): Ink | undefined;
}

/** What a renderer decides about every document it draws. @public */
export interface PdfRendererOptions {
  /** The page ceiling a render is refused above; `DEFAULT_PDF_MAX_PAGES` where it is unset. */
  maxPages?: number | undefined;
  /** Whether content streams are deflated; on where it is unset. */
  compress?: boolean | undefined;
  /** Whether the file carries an information dictionary and a derived `/ID`; `"none"` where it is unset. */
  metadata?: "none" | "standard" | undefined;
  /** Whether a structure tree is written, which is what makes a document readable to a screen reader. */
  tagged?: boolean | undefined;
  /** The natural language a tagged document declares, as a BCP 47 tag; `DEFAULT_PDF_LANG` where unset. */
  lang?: string | undefined;
  /** The colour scheme the document draws in; unnamed colours emit no ink operator at all. */
  palette?: PdfPalette | undefined;
  // Rejected: a `role` or `weight` field on a `fonts` entry. It is a pure name-to-face lookup, and
  // overloading it would make a face supplied for one `Text({ font })` run the document default.
  /** The faces a document may set in; the base-14 pair is what it falls back to. */
  fonts?: PdfDocumentFonts | undefined;
  // Rejected: a `font` prop on the form components. The letterhead, title, intro and subtitle come
  // from `PdfDocument` and have no props, so a prop would need this beside it — two ways to do one.
  /** The faces from `fonts` the whole document is set in; the base-14 pair sets it where unset. */
  defaultFont?: PdfDefaultFaces | undefined;
  /** The paper every document is set on; A4 with even margins where it is unset. */
  page?: PdfPageSpec | undefined;
  /** The fewest lines a paragraph may leave at the foot of a page before it is moved whole. */
  orphans?: number | undefined;
  /** The fewest lines a paragraph may carry onto the next page. */
  widows?: number | undefined;
  /** What the document information dictionary carries; written only when `metadata` is `"standard"`. */
  info?: PdfInfo | undefined;
}

/** What a document and a set of options settle to once the refusals are past. @internal */
export interface PdfPrepared {
  pages: readonly PdfPage[];
  paper: PdfResolvedPage;
}

/** What every drawing in a layout says about itself, whatever shape it is. @public */
export interface PdfLayoutDrawing {
  tag: PdfTag;
  /** What a reader announces in place of a drawing; a drawing with none is decoration. */
  alt?: string | undefined;
}

/** A run of type where it actually landed, measured down from the page's top edge. @public */
export interface PdfLayoutText extends PdfLayoutDrawing {
  kind: "text";
  x: number;
  y: number;
  /** The words as the file carries them, with a page number or a count already substituted. */
  text: string;
  face: PdfBaseFace;
  size: number;
  tracking: number;
}

/** An image in the rectangle it fills, anchored at its top-left. @public */
export interface PdfLayoutImage extends PdfLayoutDrawing {
  kind: "image";
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A drawn path, which has a role and an outline but no position of its own. @public */
export interface PdfLayoutPath extends PdfLayoutDrawing {
  kind: "path";
}

/** One thing a page draws. A change of paint state is not one, so no ink reaches a layout. @public */
export type PdfLayoutNode = PdfLayoutImage | PdfLayoutPath | PdfLayoutText;

/** One page's drawings, in the order they are painted. @public */
export interface PdfLayoutPage {
  nodes: readonly PdfLayoutNode[];
}

/** Where a document's every drawing landed, grouped by the page that carries it. @public */
export interface PdfLayout {
  pages: readonly PdfLayoutPage[];
}

/** A configured renderer: documents in, the bytes of a PDF file out. @public */
export interface PdfRenderer {
  render(doc: PdfDocument): Promise<PdfResult<Uint8Array<ArrayBuffer>>>;
}

/** The names a content stream addresses its graphics state and gradients by, registered as it emits. @internal */
export interface PdfResources {
  alpha(value: number): string;
  shading(of: PdfShading): string;
  /** The `XObject` name an image is addressed by; an image the writer never saw is refused. */
  image(of: PdfImage): string;
  /** The `Font` name an embedded face is addressed by; a face the writer never saw is refused. */
  font(name: string): string;
  /** The whole `/Resources` value, with the font entries already built. */
  dictionary(fonts: string): string;
}

/** A document's streams and the numbering they were built against, settled once per render. @internal */
export interface PdfComposition {
  pages: readonly PdfPage[];
  paper: PdfResolvedPage;
  fonts?: PdfDocumentFonts | undefined;
  tagging?: PdfTagging | undefined;
  streams: readonly string[];
  resources: PdfResources;
  /** The object number each image was given, which the writer allocates against rather than derives. */
  images: ReadonlyMap<PdfImage, number>;
  writesBase14: boolean;
  firstPage: number;
}

/** An object allocated a number in document order, which is what makes the xref offsets reproducible. @internal */
export interface PdfObject {
  id: number;
  body: string | { head: string; bytes: Uint8Array; tail: string };
}

/** Allocates object numbers in the order the document declares them. @internal */
export interface PdfObjectManager {
  allocate(body: PdfObject["body"]): number;
  /** Takes the next number without a body, for an object whose contents are not known yet. */
  reserve(): number;
  fill(id: number, body: PdfObject["body"]): void;
  objects(): readonly PdfObject[];
}
