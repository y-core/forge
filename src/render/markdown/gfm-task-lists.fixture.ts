/** cmark-gfm marks its task list examples `disabled`, so the fixture drops them; they are copied here from its spec text. */
export const GFM_TASK_LISTS: readonly { markdown: string; html: string }[] = [
  {
    markdown: "- [ ] foo\n- [x] bar\n",
    html: '<ul>\n<li><input disabled="" type="checkbox"> foo</li>\n<li><input checked="" disabled="" type="checkbox"> bar</li>\n</ul>\n',
  },
  {
    markdown: "- [x] foo\n  - [ ] bar\n  - [x] baz\n- [ ] bim\n",
    html: '<ul>\n<li><input checked="" disabled="" type="checkbox"> foo\n<ul>\n<li><input disabled="" type="checkbox"> bar</li>\n<li><input checked="" disabled="" type="checkbox"> baz</li>\n</ul>\n</li>\n<li><input disabled="" type="checkbox"> bim</li>\n</ul>\n',
  },
];
