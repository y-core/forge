// The chainable engine — lazy memoized getters, the nesting rewrite and the multi-line
// close-and-reopen — is adapted from @visulima/colorize (MIT, Copyright (c) visulima), itself
// after ansis (ISC, Copyright (c) 2023 webdiscus)
// https://github.com/visulima/visulima — packages/terminal/colorize/src/colorize.server.ts

import { ESC, stripAnsi } from "./ansi";
import { COLOR_NAMES, createAnsiCodes, STYLE_NAMES } from "./codes";
import type { ColorLevel } from "./types";
import type { ColorCode } from "./types";
import type { Colorize } from "./types";

interface Props extends ColorCode {
  openStack: string;
  closeStack: string;
  parent?: Props;
}

const METHOD_NAMES = ["hex", "bgHex", "rgb", "bgRgb", "ansi256", "bgAnsi256"] as const;
const NEWLINE = /(\r*\n)/g;

/** Wraps `input` in this chain's sequences, restoring each ancestor's style and re-opening at every newline. */
function wrap(input: string, props: Props): string {
  if (input === "") return "";
  let text = input;

  if (text.includes(ESC)) {
    for (let current: Props | undefined = props; current !== undefined; current = current.parent) {
      if (current.close !== "") text = text.replaceAll(current.close, current.open);
    }
  }

  if (text.includes("\n")) text = text.replace(NEWLINE, `${props.closeStack}$1${props.openStack}`);

  return props.openStack + text + props.closeStack;
}

function build(level: ColorLevel): Colorize {
  const codes = createAnsiCodes(level);
  const descriptors: PropertyDescriptorMap = {};
  let prototype: object = {};

  const createStyle = (parent: { props?: Props }, code: ColorCode): Colorize => {
    const props: Props = {
      open: code.open,
      close: code.close,
      openStack: (parent.props?.openStack ?? "") + code.open,
      closeStack: code.close + (parent.props?.closeStack ?? ""),
      ...(parent.props === undefined ? {} : { parent: parent.props }),
    };
    const style = ((input: string) => wrap(String(input), props)) as unknown as Colorize & { props: Props };
    Object.setPrototypeOf(style, prototype);
    Object.defineProperties(style, {
      props: { value: props },
      open: { value: props.openStack },
      close: { value: props.closeStack },
      level: { value: level },
    });
    return style;
  };

  for (const name of [...COLOR_NAMES, ...STYLE_NAMES]) {
    const code: ColorCode = (codes.colors as Record<string, ColorCode>)[name] ??
      (codes.styles as Record<string, ColorCode>)[name] ?? { open: "", close: "" };
    descriptors[name] = {
      get(this: { props?: Props }) {
        const style = createStyle(this, code);
        // Memoized onto the instance the getter was reached through, so a chain built once is not
        // rebuilt on every cell of a table.
        Object.defineProperty(this, name, { value: style });
        return style;
      },
    };
  }

  for (const name of METHOD_NAMES) {
    descriptors[name] = {
      value(this: { props?: Props }, ...args: never[]) {
        return createStyle(this, (codes.methods[name] as (...a: never[]) => ColorCode)(...args));
      },
    };
  }

  descriptors.strip = { value: stripAnsi };
  prototype = Object.defineProperties({}, descriptors);

  const root = ((input: string) => String(input)) as unknown as Colorize;
  Object.setPrototypeOf(root, prototype);
  Object.defineProperties(root, { open: { value: "" }, close: { value: "" }, level: { value: level } });
  return root;
}

function buildPlain(): Colorize {
  const plain = ((input: string) => String(input)) as unknown as Colorize;
  const descriptors: PropertyDescriptorMap = {};
  for (const name of [...COLOR_NAMES, ...STYLE_NAMES]) descriptors[name] = { get: () => plain };
  for (const name of METHOD_NAMES) descriptors[name] = { value: () => plain };
  descriptors.strip = { value: stripAnsi };
  descriptors.open = { value: "" };
  descriptors.close = { value: "" };
  descriptors.level = { value: 0 };
  Object.defineProperties(plain, descriptors);
  return Object.freeze(plain);
}

/**
 * The level-0 styler: every chain is itself, and every call returns its input.
 *
 * Frozen and shared, because it holds nothing that could differ between two callers. It is the
 * default wherever a renderer takes a styler, which is what keeps every existing exact-match
 * assertion on that renderer's output true without an edit.
 * @public
 */
export const PLAIN: Colorize = buildPlain();

/** Builds a styler for `level`. Level 0 is `PLAIN`. @public */
export function createColorize(level: ColorLevel): Colorize {
  return level === 0 ? PLAIN : build(level);
}
