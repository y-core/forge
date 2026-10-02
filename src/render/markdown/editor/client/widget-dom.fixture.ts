import type { EditorView, WidgetType } from "@codemirror/view";

interface FakeElement {
  readonly tag: string;
  className: string;
  textContent: string;
  title: string;
  type: string;
  checked: boolean;
  disabled: boolean;
  readonly attributes: Record<string, string>;
  readonly listeners: string[];
  setAttribute(name: string, value: string): void;
  addEventListener(type: string): void;
}

function fakeElement(tag: string): FakeElement {
  const attributes: Record<string, string> = {};
  const listeners: string[] = [];
  return {
    tag,
    className: "",
    textContent: "",
    title: "",
    type: "",
    checked: false,
    disabled: false,
    attributes,
    listeners,
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
    addEventListener: (type) => {
      listeners.push(type);
    },
  };
}

const FAKE_VIEW = { dom: { ownerDocument: { createElement: fakeElement } } } as unknown as EditorView;

/** What a widget's `toDOM` builds, read off a DOM-free fake; an input also reports its state and the sorted event types it listens for. */
export function renderedWidget(widget: WidgetType): Record<string, unknown> {
  const dom = widget.toDOM(FAKE_VIEW) as unknown as FakeElement;
  const shown: Record<string, unknown> = { tag: dom.tag, class: dom.className, text: dom.textContent };
  if (dom.title !== "") shown.title = dom.title;
  if (dom.tag === "input")
    Object.assign(shown, {
      type: dom.type,
      checked: dom.checked,
      disabled: dom.disabled,
      attributes: dom.attributes,
      listeners: dom.listeners.toSorted(),
    });
  return shown;
}
