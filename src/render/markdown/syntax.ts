import type { MarkdownExtensionInline, MarkdownSyntax, MarkdownSyntaxDefinition, DelimiterConstruct } from "./types";

/** The longest window an inline construct may scan from its trigger, which is what bounds an extension's cost per character. @internal */
export const MAX_CONSTRUCT_LENGTH = 1024;

const RESERVED_DELIMITERS: ReadonlySet<number> = new Set([0x2a, 0x5f, 0x7e]);

function groupBy<T, K>(items: readonly T[], keysOf: (item: T) => readonly K[]): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    for (const key of keysOf(item)) {
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [item]);
      else group.push(item);
    }
  }
  return groups;
}

/** Validates a syntax definition and indexes it for the engine; a malformed one throws, since it is a programming error. */
export function defineMarkdownSyntax(definition: MarkdownSyntaxDefinition): MarkdownSyntax {
  const inline = definition.inline ?? [];
  for (const construct of inline) {
    if (construct.triggers.length === 0) throw new Error(`defineMarkdownSyntax: \`${construct.name}\` has no trigger characters.`);
    if (!Number.isInteger(construct.maxLength) || construct.maxLength < 1 || construct.maxLength > MAX_CONSTRUCT_LENGTH)
      throw new Error(`defineMarkdownSyntax: \`${construct.name}\` needs an integer maxLength from 1 to ${MAX_CONSTRUCT_LENGTH}.`);
  }
  const delimiters = new Map<number, MarkdownExtensionInline["type"]>();
  for (const { char, type } of definition.delimiters ?? []) {
    if (RESERVED_DELIMITERS.has(char) || delimiters.has(char))
      throw new Error(`defineMarkdownSyntax: delimiter character ${String.fromCharCode(char)} is already taken.`);
    delimiters.set(char, type);
  }
  return {
    triggers: groupBy(inline, (construct) => construct.triggers),
    delimiters,
    blocks: groupBy(definition.blocks ?? [], (transform) => [transform.type]),
  };
}

/** CommonMark and GFM with no extensions. @internal */
export const COMMONMARK: MarkdownSyntax = defineMarkdownSyntax({});

/** The `==text==` highlight, an exact run of two `=` on the shared delimiter stack. */
export const HIGHLIGHT_DELIMITER: DelimiterConstruct = { char: 0x3d, type: "highlight" };
