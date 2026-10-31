import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { mount } from "../../../../../ui/client/browser.fixture";

declare global {
  interface Window {
    forgeTextarea: typeof import("./mount");
    textareaDispose: () => void;
    textareaSubmitted: string[];
    textareaInputs: number;
    textareaPrevented: boolean[];
  }
}

interface EditorState {
  readonly value: string;
  readonly selection: readonly [number, number];
}

const EXPOSE = { expose: { forgeTextarea: "./render/markdown/editor/textarea/client/mount" } };

const FIXTURE = [
  `<form id="form">`,
  `<textarea id="body" data-markdown></textarea>`,
  `<textarea id="note" data-markdown></textarea>`,
  `<textarea id="plain"></textarea>`,
  `<textarea id="ro" data-markdown readonly></textarea>`,
  `<div id="host"></div>`,
  `</form>`,
  `<button id="after">after</button>`,
].join("");

const stateOf = (textarea: Locator): Promise<EditorState> =>
  textarea.evaluate((el: HTMLTextAreaElement) => ({ value: el.value, selection: [el.selectionStart, el.selectionEnd] as const }));

async function prime(textarea: Locator, value: string, start: number, end: number = start): Promise<void> {
  await textarea.evaluate(
    (el: HTMLTextAreaElement, [text, from, to]) => {
      el.value = text;
      el.focus();
      el.setSelectionRange(from, to);
    },
    [value, start, end] as const,
  );
}

const caretAt = (value: string): EditorState => ({ value, selection: [value.length, value.length] });

const selecting = (value: string, part: string): EditorState => {
  const at = value.indexOf(part);
  return { value, selection: [at, at + part.length] };
};

const body = (page: Page): Locator => page.locator("#body");

function countInputs(textarea: Locator): Promise<void> {
  return textarea.evaluate((el) => {
    window.textareaInputs = 0;
    el.addEventListener("input", () => (window.textareaInputs += 1));
  });
}

function stubExecCommand(page: Page): Promise<void> {
  return page.evaluate(() => {
    document.execCommand = () => false;
  });
}

test.beforeEach(async ({ page }) => {
  await mount(page, FIXTURE, EXPOSE);
  await page.evaluate(() => {
    window.textareaSubmitted = [];
    window.textareaDispose = window.forgeTextarea.mountMarkdownTextarea(document.getElementById("form") as HTMLElement, {
      onSubmit: (textarea) => window.textareaSubmitted.push(textarea.id),
    });
  });
});

test.describe("a wrap shortcut on a marked textarea", () => {
  const WRAPS = [
    { key: "Control+b", after: selecting("say **hello** world", "hello") },
    { key: "Control+i", after: selecting("say *hello* world", "hello") },
    { key: "Control+e", after: selecting("say `hello` world", "hello") },
    { key: "Control+k", after: selecting("say [hello](url) world", "url") },
  ] as const;

  for (const { key, after } of WRAPS) {
    test(`${key} wraps the selected word and selects what the reader types next`, async ({ page }) => {
      await prime(body(page), "say hello world", 4, 9);

      await page.keyboard.press(key);

      expect(await stateOf(body(page))).toEqual(after);
    });
  }

  test("Control+b on a bare caret opens an empty pair with the caret between its markers", async ({ page }) => {
    await prime(body(page), "ab", 1);

    await page.keyboard.press("Control+b");

    expect(await stateOf(body(page))).toEqual({ value: "a****b", selection: [3, 3] });
  });

  for (const key of ["Control+Shift+b", "Control+Alt+b", "Meta+b"]) {
    test(`${key} leaves the text and the selection as they were`, async ({ page }) => {
      await prime(body(page), "say hello world", 4, 9);

      await page.keyboard.press(key);

      expect(await stateOf(body(page))).toEqual({ value: "say hello world", selection: [4, 9] });
    });
  }

  test("Control+b on a word already in strong markers removes them and keeps the word selected", async ({ page }) => {
    await prime(body(page), "say **hello** world", 6, 11);

    await page.keyboard.press("Control+b");

    expect(await stateOf(body(page))).toEqual(selecting("say hello world", "hello"));
  });

  test("leaves a keydown another listener already cancelled", async ({ page }) => {
    await prime(body(page), "say hello world", 4, 9);
    await body(page).evaluate((el: HTMLTextAreaElement) => {
      const cancelB = (event: KeyboardEvent): void => {
        if (event.key !== "b") return;
        event.preventDefault();
        el.removeEventListener("keydown", cancelB);
      };
      el.addEventListener("keydown", cancelB);
    });

    await page.keyboard.press("Control+b");

    expect(await stateOf(body(page))).toEqual({ value: "say hello world", selection: [4, 9] });
  });

  for (const { composing, after } of [
    { composing: true, after: { value: "say hello world", selection: [4, 9] } },
    { composing: false, after: selecting("say **hello** world", "hello") },
  ] as const) {
    test(`${composing ? "ignores" : "acts on"} a dispatched Control+b ${composing ? "during" : "outside"} IME composition`, async ({ page }) => {
      await prime(body(page), "say hello world", 4, 9);

      await body(page).evaluate(
        (el, isComposing) =>
          el.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, isComposing, bubbles: true, cancelable: true })),
        composing,
      );

      expect(await stateOf(body(page))).toEqual(after);
    });
  }

  test("wraps in every marked textarea under the root, not only the first", async ({ page }) => {
    const note = page.locator("#note");
    await prime(note, "say hello world", 4, 9);

    await page.keyboard.press("Control+b");

    expect(await stateOf(note)).toEqual(selecting("say **hello** world", "hello"));
  });

  test("leaves a textarea without data-markdown unwrapped", async ({ page }) => {
    const plain = page.locator("#plain");
    await prime(plain, "say hello world", 4, 9);

    await page.keyboard.press("Control+b");

    expect(await stateOf(plain)).toEqual({ value: "say hello world", selection: [4, 9] });
  });
});

test.describe("Enter on a marked textarea", () => {
  const CONTINUED = [
    { list: "a bullet", source: "- one", after: caretAt("- one\n- ") },
    { list: "a starred bullet", source: "* one", after: caretAt("* one\n* ") },
    { list: "an ordered list past nine", source: "9. nine", after: caretAt("9. nine\n10. ") },
    { list: "a ticked check item, with a fresh unticked box", source: "- [x] done", after: caretAt("- [x] done\n- [ ] ") },
  ] as const;

  for (const { list, source, after } of CONTINUED) {
    test(`continues ${list} from the end of the item`, async ({ page }) => {
      await prime(body(page), source, source.length);

      await page.keyboard.press("Enter");

      expect(await stateOf(body(page))).toEqual(after);
    });
  }

  test("continues the line the caret is on, not the last line of the text", async ({ page }) => {
    await prime(body(page), "- a\n- b", "- a".length);

    await page.keyboard.press("Enter");

    expect(await stateOf(body(page))).toEqual({ value: "- a\n- \n- b", selection: ["- a\n- ".length, "- a\n- ".length] });
  });

  for (const empty of ["- ", "1. ", "- [ ] "]) {
    test(`clears an empty ${JSON.stringify(empty)} item instead of continuing it`, async ({ page }) => {
      const source = `${empty}one\n${empty}`;
      await prime(body(page), source, source.length);

      await page.keyboard.press("Enter");

      expect(await stateOf(body(page))).toEqual(caretAt(`${empty}one\n`));
    });
  }

  const LEFT_TO_BROWSER = [
    { when: "on a line that is not a list item", source: "plain", select: [5, 5], after: caretAt("plain\n") },
    { when: "with the caret inside the marker", source: "- one", select: [1, 1], after: { value: "-\n one", selection: [2, 2] } },
    { when: "with a selection on a list line", source: "- one", select: [2, 5], after: caretAt("- \n") },
  ] as const;

  for (const { when, source, select, after } of LEFT_TO_BROWSER) {
    test(`inserts a bare newline ${when}`, async ({ page }) => {
      await prime(body(page), source, select[0], select[1]);

      await page.keyboard.press("Enter");

      expect(await stateOf(body(page))).toEqual(after);
    });
  }

  test("inserts a bare newline for Shift+Enter at the end of a list item", async ({ page }) => {
    await prime(body(page), "- one", 5);

    await page.keyboard.press("Shift+Enter");

    expect(await stateOf(body(page))).toEqual(caretAt("- one\n"));
  });

  test("continues text a script assigned without an input event, and text typed after an earlier continuation", async ({ page }) => {
    await prime(body(page), "- a", 3);
    await page.keyboard.press("Enter");
    expect(await stateOf(body(page))).toEqual(caretAt("- a\n- "));

    await page.keyboard.type("b");
    await page.keyboard.press("Enter");
    expect(await stateOf(body(page))).toEqual(caretAt("- a\n- b\n- "));

    await prime(body(page), "1. x", 4);
    await page.keyboard.press("Enter");
    expect(await stateOf(body(page))).toEqual(caretAt("1. x\n2. "));
  });
});

test.describe("native undo", () => {
  test("Control+z after a wrap restores the text from before it", async ({ page }) => {
    await prime(body(page), "say hello world", 4, 9);
    await page.keyboard.press("Control+b");
    expect((await stateOf(body(page))).value).toBe("say **hello** world");

    await page.keyboard.press("Control+z");

    expect((await stateOf(body(page))).value).toBe("say hello world");
  });

  test("Control+z after a continuation restores the text from before it", async ({ page }) => {
    await prime(body(page), "- one", 5);
    await page.keyboard.press("Enter");
    expect((await stateOf(body(page))).value).toBe("- one\n- ");

    await page.keyboard.press("Control+z");

    expect((await stateOf(body(page))).value).toBe("- one");
  });
});

test("Tab on a marked textarea moves focus on and leaves the text unchanged", { tag: "@cross-engine" }, async ({ page }) => {
  await prime(body(page), "- one", 5);

  await page.keyboard.press("Tab");

  await expect(body(page)).not.toBeFocused();
  await expect(page.locator("#note")).toBeFocused();
  expect((await stateOf(body(page))).value).toBe("- one");
});

test.describe("Mod-Enter", () => {
  test("Control+Enter calls onSubmit once with the textarea and inserts nothing", async ({ page }) => {
    await prime(body(page), "- one", 5);

    await page.keyboard.press("Control+Enter");

    expect(await page.evaluate(() => window.textareaSubmitted)).toEqual(["body"]);
    expect(await stateOf(body(page))).toEqual(caretAt("- one"));
  });

  test("Meta+Enter off an Apple platform neither submits nor continues the list", async ({ page }) => {
    await prime(body(page), "- one", 5);

    await page.keyboard.press("Meta+Enter");

    expect(await page.evaluate(() => window.textareaSubmitted)).toEqual([]);
    expect((await stateOf(body(page))).value).not.toBe("- one\n- ");
  });

  test("is left to the browser, not prevented, when the mount has no onSubmit", async ({ page }) => {
    await page.evaluate(() => {
      window.textareaDispose();
      window.forgeTextarea.mountMarkdownTextarea(document.getElementById("form") as HTMLElement, {});
      window.textareaPrevented = [];
      document.addEventListener("keydown", (event) => {
        if (event.key === "Enter") window.textareaPrevented.push(event.defaultPrevented);
      });
    });
    await prime(body(page), "- one", 5);

    await page.keyboard.press("Control+Enter");

    expect(await page.evaluate(() => [window.textareaPrevented, window.textareaSubmitted])).toEqual([[false], []]);
  });
});

test.describe("the setRangeText fallback when execCommand refuses", () => {
  test("Control+b still wraps, selects the word, and fires exactly one input event", async ({ page }) => {
    await stubExecCommand(page);
    await prime(body(page), "say hello world", 4, 9);
    await countInputs(body(page));

    await page.keyboard.press("Control+b");

    expect(await stateOf(body(page))).toEqual(selecting("say **hello** world", "hello"));
    expect(await page.evaluate(() => window.textareaInputs)).toBe(1);
  });

  test("Enter still continues a list item", async ({ page }) => {
    await stubExecCommand(page);
    await prime(body(page), "- one", 5);

    await page.keyboard.press("Enter");

    expect(await stateOf(body(page))).toEqual(caretAt("- one\n- "));
  });
});

test.describe("a readonly marked textarea", () => {
  for (const fallback of [false, true]) {
    test(`takes neither a wrap nor a continuation${fallback ? " when execCommand refuses" : ""}`, async ({ page }) => {
      if (fallback) await stubExecCommand(page);
      const ro = page.locator("#ro");

      await prime(ro, "say hello world", 4, 9);
      await page.keyboard.press("Control+b");
      expect((await stateOf(ro)).value).toBe("say hello world");

      await prime(ro, "- one", 5);
      await page.keyboard.press("Enter");
      expect((await stateOf(ro)).value).toBe("- one");
    });
  }
});

test("wraps in a marked textarea inside an open shadow root under the mounted root", async ({ page }) => {
  await page.evaluate(() => {
    const shadow = (document.getElementById("host") as HTMLElement).attachShadow({ mode: "open" });
    shadow.innerHTML = `<textarea data-markdown></textarea>`;
  });
  const shadowed = page.locator("#host textarea");
  await prime(shadowed, "say hello world", 4, 9);

  await page.keyboard.press("Control+b");

  expect(await stateOf(shadowed)).toEqual(selecting("say **hello** world", "hello"));
});

test("fires one input event per wrap through execCommand", async ({ page }) => {
  await prime(body(page), "say hello world", 4, 9);
  await countInputs(body(page));

  await page.keyboard.press("Control+b");

  expect(await page.evaluate(() => window.textareaInputs)).toBe(1);
});

test.describe("the disposer", () => {
  test("detaches every key, so Control+b, Enter and Control+Enter fall back to the browser", async ({ page }) => {
    await page.evaluate(() => window.textareaDispose());

    await prime(body(page), "say hello world", 4, 9);
    await page.keyboard.press("Control+b");
    expect((await stateOf(body(page))).value).toBe("say hello world");

    await prime(body(page), "- one", 5);
    await page.keyboard.press("Enter");
    expect(await stateOf(body(page))).toEqual(caretAt("- one\n"));

    await prime(body(page), "- one", 5);
    await page.keyboard.press("Control+Enter");
    expect(await page.evaluate(() => window.textareaSubmitted)).toEqual([]);
  });

  test("runs twice without throwing, and a later mount binds the keys again", async ({ page }) => {
    await page.evaluate(() => {
      window.textareaDispose();
      window.textareaDispose();
      window.forgeTextarea.mountMarkdownTextarea(document.getElementById("form") as HTMLElement);
    });
    await prime(body(page), "say hello world", 4, 9);

    await page.keyboard.press("Control+b");

    expect(await stateOf(body(page))).toEqual(selecting("say **hello** world", "hello"));
  });
});

test("mounting the same root again returns the first disposer, and the keys still wrap once", async ({ page }) => {
  expect(
    await page.evaluate(
      () => window.forgeTextarea.mountMarkdownTextarea(document.getElementById("form") as HTMLElement) === window.textareaDispose,
    ),
  ).toBe(true);
  await prime(body(page), "say hello world", 4, 9);

  await page.keyboard.press("Control+b");

  expect(await stateOf(body(page))).toEqual(selecting("say **hello** world", "hello"));
});
