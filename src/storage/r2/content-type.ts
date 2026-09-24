/** MIME type returned when no extension matches. @public */
export const CONTENT_TYPE_DEFAULT = "application/octet-stream";

const MIME_MAP: Record<string, string> = {
  avif: "image/avif",
  css: "text/css; charset=utf-8",
  gif: "image/gif",
  gz: "application/gzip",
  htm: "text/html; charset=utf-8",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  otf: "font/otf",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xml: "application/xml; charset=utf-8",
  zip: "application/zip",
};

/** Extensions whose mapped MIME type a browser executes as a document on the serving origin. @public */
export const ACTIVE_CONTENT_EXTENSIONS: ReadonlySet<string> = new Set(["htm", "html", "js", "mjs", "svg", "xml"]);

// The spellings a caller may store explicitly for the same content, which `MIME_MAP` never emits.
// The `+xml` family is a suffix rule below instead, because its membership is open-ended.
const ACTIVE_TYPE_ALIASES = [
  "application/ecmascript",
  "application/javascript",
  "application/x-javascript",
  "application/xhtml+xml",
  "text/ecmascript",
  "text/xml",
  "text/xsl",
];

const ACTIVE_ESSENCES = new Set([
  ...[...ACTIVE_CONTENT_EXTENSIONS].map((ext) => (MIME_MAP[ext] as string).split(";")[0] as string),
  ...ACTIVE_TYPE_ALIASES,
]);

/** Whether a stored MIME type is one a browser would render as a document rather than download. @public */
export function isActiveContentType(contentType: string): boolean {
  const essence = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  // Any `+xml` essence, not an enumeration of them: a browser parses `application/atom+xml` and
  // every other structured-syntax sibling as a document, in which an XHTML `<script>` runs.
  return ACTIVE_ESSENCES.has(essence) || essence.endsWith("+xml");
}

/** Infers MIME type from the file extension in `key`, refusing to guess an active one. @public */
export function inferContentType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  // `hasOwn` rather than a truthiness test: `"upload.constructor"` otherwise reads `Object` off the
  // prototype, which is not nullish, so the fallback never fires and a non-string reaches `put`.
  if (ext === undefined || !Object.hasOwn(MIME_MAP, ext)) return CONTENT_TYPE_DEFAULT;
  // A key is routinely user-chosen, so inferring an active type here is what turns an upload into a
  // same-origin document; an explicit `contentType` on `put` still wins.
  return ACTIVE_CONTENT_EXTENSIONS.has(ext) ? CONTENT_TYPE_DEFAULT : (MIME_MAP[ext] as string);
}
