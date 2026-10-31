import gfm from "../../../tests/fixtures/markdown/gfm.json";
import { GFM_TASK_LISTS } from "./gfm-task-lists.fixture";
import { parseMarkdown, renderMarkdownHtml } from "./mod";
import type { HtmlSchema } from "./mod";

/** Every GFM spec example, raw HTML included, with the task list examples, a repeated footnote and a loose task list. */
export const GFM_CORPUS: readonly string[] = [
  ...gfm.examples.map(({ markdown }) => markdown),
  ...GFM_TASK_LISTS.map(({ markdown }) => markdown),
  "Text[^1] and again[^1].\n\n[^1]: Note.\n",
  "- [ ] a\n\n- [x] b\n",
];

/** Renders every `GFM_CORPUS` source under `schema`, once as is and once with its task boxes written as form fields. */
export function renderGfmCorpus(schema: HtmlSchema): string[] {
  return GFM_CORPUS.flatMap((source) => {
    const document = parseMarkdown(source);
    return [renderMarkdownHtml(document, { schema }), renderMarkdownHtml(document, { schema, tasks: { name: "task" } })];
  });
}
