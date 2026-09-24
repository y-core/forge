import type { TimingProbe, TimingProbeHandle } from "./types";

type SubtleWithTimingSafeEqual = SubtleCrypto & {
  timingSafeEqual?: (a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView) => boolean;
};

function bytesOf(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  return ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
}

/** Installs a real constant-time comparison as `crypto.subtle.timingSafeEqual` and records each answer. @internal */
export function installTimingProbe(): TimingProbeHandle {
  const subtle = crypto.subtle as SubtleWithTimingSafeEqual;
  const original = subtle.timingSafeEqual;
  const probe: TimingProbe = { compared: [] };

  subtle.timingSafeEqual = (a, b) => {
    const left = bytesOf(a);
    const right = bytesOf(b);
    if (left.byteLength !== right.byteLength) throw new TypeError("Input buffers must have the same byte length");
    let diff = 0;
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounds guaranteed by the loop condition.
    for (let i = 0; i < left.byteLength; i++) diff |= left[i]! ^ right[i]!;
    const equal = diff === 0;
    probe.compared.push(equal);
    return equal;
  };

  return {
    probe,
    restore: () => {
      if (original) subtle.timingSafeEqual = original;
      else delete subtle.timingSafeEqual;
    },
  };
}
