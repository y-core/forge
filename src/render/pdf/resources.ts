import { num } from "./text";
import type { Ink, PdfImage, PdfResources, PdfShading, PdfShadingStop } from "./types";

function components(ink: Ink): string {
  return `${num(ink[0])} ${num(ink[1])} ${num(ink[2])}`;
}

function ramp(from: PdfShadingStop, to: PdfShadingStop): string {
  return `<< /FunctionType 2 /Domain [0 1] /C0 [${components(from.ink)}] /C1 [${components(to.ink)}] /N 1 >>`;
}

// PDF interpolates between two inks and no more, so a third stop is a stitching function over a
// ramp per interval, each ramp re-encoded onto its own zero-to-one domain.
function gradient(stops: readonly PdfShadingStop[]): string {
  const ordered = [...stops].sort((one, other) => one.at - other.at);
  const ramps = ordered.slice(1).map((stop, index) => ramp(ordered[index] ?? stop, stop));
  const [only] = ramps;
  if (only !== undefined && ramps.length === 1) return only;
  const bounds = ordered
    .slice(1, -1)
    .map((stop) => num(stop.at))
    .join(" ");
  const encode = ramps.map(() => "0 1").join(" ");
  return `<< /FunctionType 3 /Domain [0 1] /Functions [${ramps.join(" ")}] /Bounds [${bounds}] /Encode [${encode}] >>`;
}

function shadingDictionary(of: PdfShading, up: (y: number) => number): string {
  const coordinates =
    of.kind === "axial"
      ? [of.from[0], up(of.from[1]), of.to[0], up(of.to[1])]
      : [of.from[0], up(of.from[1]), of.from[2], of.to[0], up(of.to[1]), of.to[2]];
  const type = of.kind === "axial" ? 2 : 3;
  return `<< /ShadingType ${type} /ColorSpace /DeviceRGB /Coords [${coordinates.map(num).join(" ")}] /Function ${gradient(of.stops)} /Extend [true true] >>`;
}

/** A registry that names a graphics state or a gradient the first time a stream reaches for it. @internal */
export function createPdfResources(
  height: number,
  images: ReadonlyMap<PdfImage, number> = new Map(),
  fonts: ReadonlyMap<string, string> = new Map(),
): PdfResources {
  const names = new Map([...images.keys()].map((image, index) => [image, `Im${index}`]));
  const up = (y: number): number => height - y;
  const alphas = new Map<number, string>();
  const shadings = new Map<string, string>();
  const named = (entries: ReadonlyMap<string, string>, key: string): string =>
    entries.size === 0 ? "" : ` /${key} << ${[...entries].map(([name, body]) => `/${name} ${body}`).join(" ")} >>`;
  const states = new Map<string, string>();
  return {
    alpha(value) {
      const found = alphas.get(value);
      if (found !== undefined) return found;
      const name = `GS${alphas.size}`;
      alphas.set(value, name);
      states.set(name, `<< /Type /ExtGState /ca ${num(value)} /CA ${num(value)} >>`);
      return name;
    },
    shading(of) {
      const body = shadingDictionary(of, up);
      const found = shadings.get(body);
      if (found !== undefined) return found;
      const name = `Sh${shadings.size}`;
      shadings.set(body, name);
      return name;
    },
    image(of) {
      const name = names.get(of);
      if (name === undefined) throw new Error("image: a page drew an image the writer never allocated an object for");
      return name;
    },
    font(name) {
      const resource = fonts.get(name);
      if (resource === undefined) throw new Error("font: a run is set in a face the writer never embedded");
      return resource;
    },
    dictionary(entries) {
      const gradients = new Map([...shadings].map(([body, name]) => [name, body]));
      const drawn = new Map([...images].map(([image, id]) => [names.get(image) ?? "", `${id} 0 R`]));
      return `<< /Font << ${entries} >>${named(states, "ExtGState")}${named(gradients, "Shading")}${named(drawn, "XObject")} >>`;
    },
  };
}
