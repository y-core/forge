import { describe, expect, it } from "bun:test";

import { TURNSTILE, TURNSTILE_ABANDONED_EVENT, type TurnstileAbandonedDetail } from "../contracts/turnstile-contract";
import { FakeDocument, FakeElement, FakeEvent, fakeTree } from "./test-dom";
import { findWidget, hasApi, hasHtmxSubmission, htmxWillValidate, mountTurnstile, restoreFocus } from "./turnstile";

const win = (turnstile?: unknown) => ({ turnstile }) as unknown as Window;

describe("hasApi", () => {
  it("is true only for an object that can actually render", () => {
    expect(hasApi(win({ render: () => "widget-1" }))).toBe(true);
  });

  it("is false when nothing has been assigned", () => {
    expect(hasApi(win())).toBe(false);
  });

  it("is false for an element the DOM exposed under the name", () => {
    // Any element with `id="turnstile"` becomes `window.turnstile`, and a truthiness test would
    // take it for the API and try to render into it.
    const { el } = fakeTree();
    expect(hasApi(win(el("DIV", { id: "turnstile" })))).toBe(false);
  });

  it("is false when render is present but is not callable", () => {
    expect(hasApi(win({ render: "yes" }))).toBe(false);
  });
});

describe("findWidget", () => {
  it("reports the root when the root is itself the widget", () => {
    const { el } = fakeTree();
    const root = el("DIV", { "data-ref": TURNSTILE.widget });
    expect(findWidget(root as unknown as HTMLElement)).toBe(root as unknown as HTMLElement);
  });

  it("reports a widget below the root", () => {
    const { el } = fakeTree();
    const root = el();
    const widget = el("DIV", { "data-ref": TURNSTILE.widget });
    root.append(el(), widget);
    expect(findWidget(root as unknown as HTMLElement)).toBe(widget as unknown as HTMLElement);
  });

  it("reports null when the tree holds no widget", () => {
    const { el } = fakeTree();
    const root = el();
    root.append(el("DIV", { "data-ref": TURNSTILE.fallback }));
    expect(findWidget(root as unknown as HTMLElement)).toBe(null);
  });
});

describe("hasHtmxSubmission", () => {
  const form = (attrs: Record<string, string>, child?: Record<string, string>) => {
    const { el } = fakeTree();
    const node = el("FORM", attrs);
    if (child) node.append(el("BUTTON", child));
    return node as unknown as Element;
  };

  it("is true for a form that posts through htmx", () => {
    expect(hasHtmxSubmission(form({ "hx-post": "/contact" }))).toBe(true);
  });

  it("is true for every other htmx verb, and for the `data-` spelling", () => {
    expect(hasHtmxSubmission(form({ "hx-put": "/contact" }))).toBe(true);
    expect(hasHtmxSubmission(form({ "hx-patch": "/contact" }))).toBe(true);
    expect(hasHtmxSubmission(form({ "hx-delete": "/contact" }))).toBe(true);
    expect(hasHtmxSubmission(form({ "data-hx-post": "/contact" }))).toBe(true);
  });

  it("is true for a form submitting through a descendant", () => {
    expect(hasHtmxSubmission(form({}, { "hx-post": "/contact" }))).toBe(true);
  });

  it("is false for a native form, which has no request for the challenge to defer", () => {
    expect(hasHtmxSubmission(form({ action: "/contact", method: "post" }))).toBe(false);
  });
});

describe("htmxWillValidate", () => {
  const node = (tag: string, attrs: Record<string, string> = {}, props: Record<string, unknown> = {}) =>
    Object.assign(new FakeElement(tag, attrs), props) as unknown as Element;

  const willValidate = (elt: Element, submitter: Element | null = null) => htmxWillValidate(elt, submitter);

  it("is true for a plain form, which is the case htmx validates", () => {
    expect(willValidate(node("FORM"))).toBe(true);
  });

  it("is false for a form the author marked novalidate", () => {
    expect(willValidate(node("FORM", {}, { noValidate: true }))).toBe(false);
  });

  it("is true when hx-validate overrides novalidate, as htmx's own || does", () => {
    expect(willValidate(node("FORM", { "hx-validate": "true" }, { noValidate: true }))).toBe(true);
  });

  it("is false when the pressed control carries formnovalidate", () => {
    expect(willValidate(node("FORM"), node("BUTTON", {}, { formNoValidate: true }))).toBe(false);
    expect(willValidate(node("FORM", { "hx-validate": "true" }), node("BUTTON", {}, { formNoValidate: true }))).toBe(false);
  });

  it("is false for a button-issued submission, which htmx never validates on its own", () => {
    expect(willValidate(node("BUTTON"), node("BUTTON", {}, { formNoValidate: true }))).toBe(false);
    expect(willValidate(node("BUTTON"))).toBe(false);
  });

  it("is true for a button asking for validation, in either spelling", () => {
    expect(willValidate(node("BUTTON", { "hx-validate": "true" }))).toBe(true);
    expect(willValidate(node("BUTTON", { "data-hx-validate": "true" }))).toBe(true);
  });

  it("is still true for a validating button whose press carries formnovalidate", () => {
    // htmx reads `formnovalidate` off the form's own data, which a button-issued press never reaches.
    expect(willValidate(node("BUTTON", { "hx-validate": "true" }), node("BUTTON", {}, { formNoValidate: true }))).toBe(true);
  });

  it("is false for a button whose ancestor form declares hx-validate, which htmx does not inherit", () => {
    const { el } = fakeTree();
    const form = el("FORM", { "hx-validate": "true" });
    const button = el("BUTTON", { "hx-post": "/contact" });
    form.append(button);
    expect(willValidate(button as unknown as Element)).toBe(false);
  });
});

describe("restoreFocus", () => {
  /** A focused field, a widget container, and the frame the widget renders into it. */
  const scene = () => {
    const { doc, el } = fakeTree();
    const field = el("INPUT");
    const container = el();
    const frame = el("IFRAME");
    container.append(frame);
    doc.body.append(field, container);
    field.focus();
    return { doc, el, field, container, frame };
  };

  const restore = (container: FakeElement, previous: FakeElement | null) =>
    restoreFocus(container as unknown as HTMLElement, previous as unknown as Element | null);

  it("puts focus back on the field the widget took it from", () => {
    const { doc, field, container, frame } = scene();
    frame.focus();

    expect(restore(container, field)).toBe(true);
    expect(doc.activeElement).toBe(field);
  });

  it("puts focus back when the widget dropped focus onto the body", () => {
    const { doc, field, container } = scene();
    doc.body.focus();

    expect(restore(container, field)).toBe(true);
    expect(doc.activeElement).toBe(field);
  });

  it("puts focus back when the document reports no focused element at all", () => {
    const { doc, field, container } = scene();
    doc.activeElement = null;

    expect(restore(container, field)).toBe(true);
    expect(doc.activeElement).toBe(field);
  });

  it("reports no action when focus is on the body and nothing held it before", () => {
    const { doc, container } = scene();
    doc.body.focus();

    expect(restore(container, null)).toBe(false);
    expect(doc.activeElement).toBe(doc.body);
  });

  it("leaves focus alone when the user moved it to a real element outside the widget", () => {
    const { doc, el, field, container } = scene();
    const elsewhere = el("INPUT");
    doc.body.append(elsewhere);
    elsewhere.focus();

    expect(restore(container, field)).toBe(false);
    expect(doc.activeElement).toBe(elsewhere);
  });

  it("reports no action when focus never moved off the field", () => {
    const { doc, field, container } = scene();

    expect(restore(container, field)).toBe(false);
    expect(doc.activeElement).toBe(field);
  });

  it("leaves focus alone when the field it came from is no longer connected", () => {
    const { doc, container, frame } = scene();
    // Built outside the tree rather than removed from it: the fake reports connectedness from its
    // parent and document, and `remove()` clears only the parent.
    const gone = new FakeElement("INPUT");
    frame.focus();

    expect(restore(container, gone)).toBe(false);
    expect(doc.activeElement).toBe(frame);
    expect(gone.focused).toBe(false);
  });

  it("leaves the widget focused when nothing held focus before it rendered", () => {
    const { doc, container, frame } = scene();
    doc.activeElement = null;
    frame.focus();

    expect(restore(container, null)).toBe(false);
    expect(doc.activeElement).toBe(frame);
  });
});

class FakeForm extends FakeElement {
  reset(): void {
    for (const node of this.descendants()) node.value = "";
  }
}

interface Scene {
  form: FakeForm;
  field: FakeElement;
  calls: { executes: number; resets: number; params: Record<string, unknown> | null };
  /** Which press each released request answered, and the `skipConfirmation` it carried. */
  issued: Array<{ from: string; skip: boolean }>;
}

/** A mounted controller over a form carrying `formAttrs`, with a descendant field that posts on its
 * own — the `inlineValidation` shape whose request bubbles through the form's own listeners. */
function mountedScene(formAttrs: Record<string, string>, widgetAttrs: Record<string, string> = {}): Scene {
  const doc = Object.assign(new FakeDocument(), { documentElement: { classList: { contains: () => false } } });
  const calls: Scene["calls"] = { executes: 0, resets: 0, params: null };
  Object.assign(doc.defaultView, {
    turnstile: {
      render: (_el: unknown, params: Record<string, unknown>) => {
        calls.params = params;
        return "widget-1";
      },
      execute: () => {
        calls.executes += 1;
      },
      reset: () => {
        calls.resets += 1;
      },
      remove: () => {},
    },
  });

  const form = new FakeForm("FORM", formAttrs);
  form.ownerDocument = doc;
  const field = new FakeElement("INPUT", { name: "email", "hx-post": "/validate" });
  const widget = new FakeElement("DIV", { "data-ref": TURNSTILE.widget, "data-sitekey": "site-key", ...widgetAttrs });
  form.append(field, widget);
  doc.body.append(form);

  mountTurnstile(form as unknown as HTMLElement);
  return { form, field, calls, issued: [] };
}

const afterRequest = (scene: Scene, from: FakeElement, detail: Record<string, unknown>): { resets: number; value: string } => {
  from.dispatchEvent(new FakeEvent("htmx:afterRequest", { detail: { ...detail, requestConfig: { elt: from } } }));
  return { resets: scene.calls.resets, value: scene.field.value };
};

const confirm = (scene: Scene, elt: FakeElement, submitter?: FakeElement): { prevented: boolean; executes: number } => {
  const from = submitter?.id || elt.tagName.toLowerCase();
  const event = new FakeEvent("htmx:confirm", {
    detail: { elt, ...(submitter ? { triggeringEvent: { submitter } } : {}), issueRequest: (skip: boolean) => scene.issued.push({ from, skip }) },
  });
  elt.dispatchEvent(event);
  return { prevented: event.defaultPrevented, executes: scene.calls.executes };
};

/** What Cloudflare does when the deferred challenge passes: call the `callback` the render was given. */
const completeChallenge = (scene: Scene): void => {
  const callback = scene.calls.params?.callback as (() => void) | undefined;
  callback?.();
};

describe("mountTurnstile — the reset is scoped to the element that issued the request", () => {
  const verbs = ["hx-post", "hx-put", "hx-patch", "hx-delete", "data-hx-post"];

  for (const verb of verbs) {
    it(`resets the widget and clears the form for a successful request the form issued through ${verb}`, () => {
      const scene = mountedScene({ [verb]: "/contact" });
      scene.field.value = "typed@example.com";

      expect(afterRequest(scene, scene.form, { successful: true })).toEqual({ resets: 1, value: "" });
    });
  }

  it("leaves the token and the fields alone for a descendant field's own request", () => {
    const scene = mountedScene({ "hx-post": "/contact" });
    scene.field.value = "typed@example.com";

    expect(afterRequest(scene, scene.field, { successful: true })).toEqual({ resets: 0, value: "typed@example.com" });
  });

  it("resets on the form's own submission however far the answering URL is from the declared one", () => {
    const scene = mountedScene({ "hx-post": "/contact" });
    scene.field.value = "typed@example.com";
    const xhr = { responseURL: "https://example.test/thank-you" };

    expect(afterRequest(scene, scene.form, { successful: true, xhr })).toEqual({ resets: 1, value: "" });
  });

  it("resets the token on an unsuccessful submission but keeps what the reader typed", () => {
    const scene = mountedScene({ "hx-post": "/contact" });
    scene.field.value = "typed@example.com";

    expect(afterRequest(scene, scene.form, { successful: false })).toEqual({ resets: 1, value: "typed@example.com" });
  });
});

describe("mountTurnstile — challenge='submit' holds the form's own press only", () => {
  const submitScene = () => mountedScene({ "hx-post": "/contact" }, { "data-challenge": "submit" });

  /** A submit control the press can be attributed to, which is what the hold is keyed on. */
  const button = (scene: Scene, id: string) => {
    const control = new FakeElement("BUTTON", { id, type: "submit" });
    scene.form.append(control);
    return control;
  };

  it("holds the press and releases the request once the challenge answers", () => {
    const scene = submitScene();

    expect(confirm(scene, scene.form)).toEqual({ prevented: true, executes: 1 });

    completeChallenge(scene);

    expect(scene.issued).toEqual([{ from: "form", skip: true }]);
  });

  it("lets a descendant field's own request through unheld, spending no challenge on it", () => {
    const scene = submitScene();

    expect(confirm(scene, scene.field)).toEqual({ prevented: false, executes: 0 });
    expect(scene.issued).toEqual([]);
  });

  it("answers the press that displaced the first, and no other", () => {
    const scene = submitScene();
    const first = button(scene, "submit");
    const second = button(scene, "preview");

    confirm(scene, scene.form, first);
    // One press is one challenge, so the displacement rides the one already in flight.
    expect(confirm(scene, scene.form, second)).toEqual({ prevented: true, executes: 1 });
    expect({ first: first.disabled, second: second.disabled }).toEqual({ first: false, second: true });

    completeChallenge(scene);

    expect(scene.issued).toEqual([{ from: "preview", skip: true }]);
  });

  it("reports a dropped press to the form rather than losing it", () => {
    const scene = submitScene();
    const pressed = button(scene, "submit");
    const reported: TurnstileAbandonedDetail[] = [];
    scene.form.addEventListener(TURNSTILE_ABANDONED_EVENT, (event) => {
      reported.push((event as unknown as CustomEvent<TurnstileAbandonedDetail>).detail);
    });

    confirm(scene, scene.form, pressed);
    const errored = scene.calls.params?.["error-callback"] as (code?: unknown) => void;
    errored(300010);

    expect(reported).toEqual([{ reason: "error", submitter: pressed as unknown as HTMLElement }]);
    expect(scene.issued).toEqual([]);
    expect({ disabled: pressed.disabled, busy: pressed.getAttribute("aria-busy") }).toEqual({ disabled: false, busy: null });
  });
});
