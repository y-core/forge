/** How `mountMarkdownTextarea` treats Mod-Enter; with no `onSubmit` the browser keeps the key. */
export interface MarkdownTextareaOptions {
  readonly onSubmit?: (textarea: HTMLTextAreaElement) => void;
}
