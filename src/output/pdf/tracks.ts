import type { PdfTrack } from "./types";

/** How wide each track of a row resolves to, once the fixed ones and the gaps are taken out. @internal */
export function resolveTracks(tracks: readonly PdfTrack[], available: number, gap: number): number[] {
  if (tracks.length === 0) return [];
  let fixed = 0;
  let shares = 0;
  for (const track of tracks) {
    if (typeof track === "number") shares += track;
    else fixed += track.points;
  }
  const free = available - fixed - gap * (tracks.length - 1);
  return tracks.map((track) => {
    if (typeof track !== "number") return track.points;
    return shares === 0 ? 0 : (free * track) / shares;
  });
}

/** Where each track of a row begins, measured from the row's own left edge. @internal */
export function trackOffsets(widths: readonly number[], gap: number): number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const width of widths) {
    offsets.push(at);
    at += width + gap;
  }
  return offsets;
}

/** How wide `count` adjacent tracks measure together, the gaps between them included. @internal */
export function spanOf(widths: readonly number[], start: number, count: number, gap: number): number {
  const taken = widths.slice(start, start + count);
  return taken.reduce((total, width) => total + width, 0) + gap * Math.max(taken.length - 1, 0);
}
