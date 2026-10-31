import { asElement, eventTarget, ownerWindow } from "../../../../../ui/client/dom";
import { continueList, createMarkdownDraft, MARKDOWN_WRAP_KEYS, reviseMarkdownDraft, wrapSelection } from "../../../editing";
import type { MarkdownTextareaOptions } from "./types";

type TextareaDraft = ReturnType<typeof createMarkdownDraft>;
type TextareaEdit = NonNullable<ReturnType<typeof continueList>>;

const MARKDOWN_TEXTAREA = "textarea[data-markdown]";

const APPLE_PLATFORM = /Mac|iPhone|iPad|iPod/;

const mountedTextareas = new WeakMap<HTMLElement, () => void>();

function applyEdit(textarea: HTMLTextAreaElement, edit: TextareaEdit): void {
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(edit.from, edit.to);
  const doc = textarea.ownerDocument;
  const applied = edit.insert === "" ? doc.execCommand("delete") : doc.execCommand("insertText", false, edit.insert);
  if (!applied) {
    textarea.setRangeText(edit.insert, edit.from, edit.to, "end");
    const { Event } = ownerWindow(textarea) as Window & typeof globalThis;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (edit.selection !== null) textarea.setSelectionRange(edit.selection.from, edit.selection.to);
}

/** Binds list continuation, the Mod-B/I/E/K wraps and Mod-Enter to every `textarea[data-markdown]` at or under `root`, and returns a disposer. */
export function mountMarkdownTextarea(root: HTMLElement, options: MarkdownTextareaOptions = {}): () => void {
  const existing = mountedTextareas.get(root);
  if (existing) return existing;

  const lifetime = new AbortController();
  const drafts = new WeakMap<HTMLTextAreaElement, TextareaDraft>();

  function draftOf(textarea: HTMLTextAreaElement): TextareaDraft {
    const previous = drafts.get(textarea);
    const draft = previous === undefined ? createMarkdownDraft(textarea.value) : reviseMarkdownDraft(previous, textarea.value);
    drafts.set(textarea, draft);
    return draft;
  }

  function editFor(textarea: HTMLTextAreaElement, key: string, mod: boolean): TextareaEdit | null {
    const selection = { from: textarea.selectionStart, to: textarea.selectionEnd };
    if (key === "Enter") return continueList(draftOf(textarea), selection);
    if (!mod) return null;
    const wrap = MARKDOWN_WRAP_KEYS[key.toLowerCase()];
    return wrap === undefined ? null : wrapSelection(textarea.value, selection, wrap);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing || event.defaultPrevented) return;
    const el = asElement(eventTarget(event));
    if (!el?.matches(MARKDOWN_TEXTAREA)) return;
    const textarea = el as HTMLTextAreaElement;
    const apple = APPLE_PLATFORM.test(ownerWindow(textarea).navigator.platform);
    if (event.altKey || event.shiftKey || (apple ? event.ctrlKey : event.metaKey) || textarea.readOnly) return;
    const mod = apple ? event.metaKey : event.ctrlKey;
    const { onSubmit } = options;

    if (event.key === "Enter" && mod) {
      if (onSubmit === undefined) return;
      event.preventDefault();
      onSubmit(textarea);
      return;
    }

    const edit = editFor(textarea, event.key, mod);
    if (edit === null) return;
    event.preventDefault();
    applyEdit(textarea, edit);
  }

  root.addEventListener("keydown", onKeyDown, { signal: lifetime.signal });

  function dispose(): void {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    mountedTextareas.delete(root);
  }

  mountedTextareas.set(root, dispose);
  return dispose;
}
