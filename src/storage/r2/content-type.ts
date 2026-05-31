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

/** Infers MIME type from the file extension in `key`; falls back to CONTENT_TYPE_DEFAULT. @public */
export function inferContentType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  return (ext && MIME_MAP[ext]) ?? CONTENT_TYPE_DEFAULT;
}
