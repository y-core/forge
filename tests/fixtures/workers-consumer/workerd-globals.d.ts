// Copied from `wrangler types`: workerd's global `Element` merges with lib.dom's, so a browser module
// naming `ParentNode` or `E extends Element` breaks in every Worker app while forge's own program passes.
interface Element {
  append(content: string | ReadableStream | Response): Element;
  remove(): Element;
}
