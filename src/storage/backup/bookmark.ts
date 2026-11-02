import { D1BackupError } from "./errors";

/** D1's Time Travel bookmark grammar, unanchored, as every reader of one in forge checks it. @internal */
export const D1_BOOKMARK_PATTERN = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";

const BOOKMARK = new RegExp(`^${D1_BOOKMARK_PATTERN}$`);

/** Whether `value` is a D1 bookmark, and so safe to put in an object key or a URL. @internal */
export function isD1Bookmark(value: string): boolean {
  return BOOKMARK.test(value);
}

/** Holds a bookmark D1 answered to the grammar, so it is safe to name an object or a URL with. @internal */
export function checkedBookmark(bookmark: string): string {
  if (!isD1Bookmark(bookmark)) throw new D1BackupError("malformed", "D1 answered a bookmark outside its documented grammar");
  return bookmark;
}
