// The two members that matter, copied from a real `wrangler types` output: workerd declares
// HTMLRewriter's `Element` in global scope, where TypeScript *merges* it with lib.dom's. `append`
// then breaks the structural `ParentNode` contract and `remove` breaks `E extends Element`, so a
// browser module of forge's that names either shape stops compiling in every Worker app — while
// forge's own gate, whose type program has no such declaration, sees nothing.
interface Element {
  append(content: string | ReadableStream | Response): Element;
  remove(): Element;
}
