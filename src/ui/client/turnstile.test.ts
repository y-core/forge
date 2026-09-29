import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Mock } from "bun:test";

import { ANNOUNCER_REGION_SLOTS } from "../contracts/announcer-contract";
import { TURNSTILE, TURNSTILE_ABANDONED_EVENT, TURNSTILE_SCRIPT_URL, TURNSTILE_TRUSTED_TYPES_POLICY } from "../contracts/turnstile-contract";
import type { TurnstileAbandonedDetail } from "../contracts/types";
import { announce } from "./announce";
import { FakeDocument, FakeElement, FakeEvent, fakeTree } from "./dom.fixture";
import { assignTurnstileScriptSrc, findWidget, hasTurnstileApi, hasHtmxSubmission, mountTurnstile, restoreFocus } from "./turnstile";

const win = (turnstile?: unknown) => ({ turnstile }) as unknown as Window;

describe("hasTurnstileApi", () => {
  it("is true only for an object that can actually render", () => {
    expect(hasTurnstileApi(win({ render: () => "widget-1" }))).toBe(true);
  });

  it("is false when nothing has been assigned", () => {
    expect(hasTurnstileApi(win())).toBe(false);
  });

  it("is false for an element the DOM exposed under the name", () => {
    // Any element with `id="turnstile"` becomes `window.turnstile`, and a truthiness test would
    // take it for the API and try to render into it.
    const { el } = fakeTree();
    expect(hasTurnstileApi(win(el("DIV", { id: "turnstile" })))).toBe(false);
  });

  it("is false when render is present but is not callable", () => {
    expect(hasTurnstileApi(win({ render: "yes" }))).toBe(false);
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

class FakeSubmitEvent extends FakeEvent {
  declare readonly submitter?: FakeElement | null;
}

/** The hidden input Cloudflare writes the token into, answering the compound selector the fake's `matches` cannot parse. */
class FakeTokenInput extends FakeElement {
  override matches(selector: string): boolean {
    return selector === "input[name]" || super.matches(selector);
  }
}

interface Scene {
  form: FakeForm;
  field: FakeElement;
  widget: FakeElement;
  calls: { executes: number; resets: number; params: Record<string, unknown> | null };
  /** The control each replayed `submit` named, or `form` for a press with no submitter. */
  replayed: string[];
}

/** A mounted controller over a form carrying `formAttrs`, with a descendant field that posts on its own. */
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
    SubmitEvent: FakeSubmitEvent,
  });

  const form = new FakeForm("FORM", formAttrs);
  form.ownerDocument = doc;
  const field = new FakeElement("INPUT", { name: "email", "hx-post": "/validate" });
  const widget = new FakeElement("DIV", { "data-ref": TURNSTILE.widget, "data-sitekey": "site-key", ...widgetAttrs });
  form.append(field, widget);
  doc.body.append(form);

  const replayed: string[] = [];
  form.addEventListener("submit", (event) => replayed.push((event as FakeSubmitEvent).submitter?.id || "form"));

  mountTurnstile(form as unknown as HTMLElement);
  return { form, field, widget, calls, replayed };
}

const finallyRequest = (scene: Scene, from: FakeElement, status?: number): { resets: number; value: string } => {
  const response = status === undefined ? undefined : { status };
  from.dispatchEvent(new FakeEvent("htmx:finally:request", { detail: { ctx: { sourceElement: from, response } } }));
  return { resets: scene.calls.resets, value: scene.field.value };
};

const configRequest = (scene: Scene, elt: FakeElement, submitter?: FakeElement): { prevented: boolean; executes: number } => {
  const event = new FakeEvent("htmx:config:request", { detail: { ctx: { sourceElement: elt, request: { submitter } } } });
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
    it(`resets the widget and clears the form for a 200 answer to a request the form issued through ${verb}`, () => {
      const scene = mountedScene({ [verb]: "/contact" });
      scene.field.value = "typed@example.com";

      expect(finallyRequest(scene, scene.form, 200)).toEqual({ resets: 1, value: "" });
    });
  }

  it("leaves the token and the fields alone for a descendant field's own request", () => {
    const scene = mountedScene({ "hx-post": "/contact" });
    scene.field.value = "typed@example.com";

    expect(finallyRequest(scene, scene.field, 200)).toEqual({ resets: 0, value: "typed@example.com" });
  });

  it("resets the token on a 422 answer but keeps what the reader typed", () => {
    const scene = mountedScene({ "hx-post": "/contact" });
    scene.field.value = "typed@example.com";

    expect(finallyRequest(scene, scene.form, 422)).toEqual({ resets: 1, value: "typed@example.com" });
  });

  it("resets the token on a request that never got a response but keeps what the reader typed", () => {
    const scene = mountedScene({ "hx-post": "/contact" });
    scene.field.value = "typed@example.com";

    expect(finallyRequest(scene, scene.form)).toEqual({ resets: 1, value: "typed@example.com" });
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

  it("holds the press and replays the form's submission once the challenge answers", () => {
    const scene = submitScene();

    expect(configRequest(scene, scene.form)).toEqual({ prevented: true, executes: 1 });
    expect(scene.replayed).toEqual([]);

    completeChallenge(scene);

    expect(scene.replayed).toEqual(["form"]);
  });

  it("lets a press through unheld once the token input is filled, spending no challenge on it", () => {
    const scene = submitScene();
    const token = new FakeTokenInput("INPUT", { type: "hidden", name: "cf-turnstile-response" });
    token.value = "token-1";
    scene.widget.append(token);

    expect(configRequest(scene, scene.form)).toEqual({ prevented: false, executes: 0 });
  });

  it("still holds a press while the token input is present but empty", () => {
    const scene = submitScene();
    scene.widget.append(new FakeTokenInput("INPUT", { type: "hidden", name: "cf-turnstile-response" }));

    expect(configRequest(scene, scene.form)).toEqual({ prevented: true, executes: 1 });
  });

  it("lets a descendant field's own request through unheld, spending no challenge on it", () => {
    const scene = submitScene();

    expect(configRequest(scene, scene.field)).toEqual({ prevented: false, executes: 0 });
    expect(scene.replayed).toEqual([]);
  });

  it("replays the press that displaced the first, carrying its submitter and no other", () => {
    const scene = submitScene();
    const first = button(scene, "submit");
    const second = button(scene, "preview");

    configRequest(scene, scene.form, first);
    // One press is one challenge, so the displacement rides the one already in flight.
    expect(configRequest(scene, scene.form, second)).toEqual({ prevented: true, executes: 1 });
    expect({ first: first.disabled, second: second.disabled }).toEqual({ first: false, second: true });

    completeChallenge(scene);

    expect(scene.replayed).toEqual(["preview"]);
    expect(second.disabled).toBe(false);
  });

  it("reports a dropped press to the form rather than losing it", () => {
    const scene = submitScene();
    const pressed = button(scene, "submit");
    const reported: TurnstileAbandonedDetail[] = [];
    scene.form.addEventListener(TURNSTILE_ABANDONED_EVENT, (event) => {
      reported.push((event as unknown as CustomEvent<TurnstileAbandonedDetail>).detail);
    });

    configRequest(scene, scene.form, pressed);
    const errored = scene.calls.params?.["error-callback"] as (code?: unknown) => void;
    errored(300010);

    expect(reported).toEqual([{ reason: "error", submitter: pressed as unknown as HTMLElement }]);
    expect(scene.replayed).toEqual([]);
    expect({ disabled: pressed.disabled, busy: pressed.getAttribute("aria-busy") }).toEqual({ disabled: false, busy: null });
  });
});

describe("mountTurnstile — a revealed failure is announced on its own channel", () => {
  it("interrupts with the fallback, and an app message on the default channel does not cancel it", () => {
    const scene = mountedScene({ "hx-post": "/contact" });
    const doc = scene.form.ownerDocument as FakeDocument;
    const assertive = new FakeElement("DIV", { "data-slot": ANNOUNCER_REGION_SLOTS.assertive });
    doc.root.append(assertive);
    const fallback = new FakeElement("P", { "data-ref": TURNSTILE.fallback });
    fallback.hidden = true;
    fallback.textContent = "The security check could not load.";
    scene.form.querySelector(`[data-ref='${TURNSTILE.widget}']`)?.append(fallback);

    const errored = scene.calls.params?.["error-callback"] as (code?: unknown) => void;
    errored(300010);
    announce("Payment declined", { politeness: "assertive", within: doc as unknown as Node });
    doc.defaultView.flush();

    expect(assertive.children.map((node) => node.textContent)).toEqual(["The security check could not load.", "Payment declined"]);
  });
});

describe("assignTurnstileScriptSrc", () => {
  type Rules = { createScriptURL(input: string): string };
  const trustedUrl = { trusted: TURNSTILE_SCRIPT_URL };
  const scriptSink = () => ({ src: "" as unknown }) as unknown as HTMLScriptElement;
  const ttWindow = (createPolicy: (name: string, rules: Rules) => { createScriptURL(input: string): object }) =>
    ({ trustedTypes: { createPolicy } }) as unknown as Window;
  let errors: Mock<typeof console.error>;

  beforeEach(() => {
    errors = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errors.mockRestore();
  });

  it("writes the plain URL where the window has no Trusted Types API", () => {
    const script = scriptSink();
    expect(assignTurnstileScriptSrc(script, {} as Window)).toBe(true);
    expect(script.src).toBe(TURNSTILE_SCRIPT_URL);
  });

  it("writes the policy's TrustedScriptURL, creating the named policy once per window", () => {
    const names: string[] = [];
    const policyWindow = ttWindow((name) => {
      names.push(name);
      return { createScriptURL: () => trustedUrl };
    });
    const first = scriptSink();
    const second = scriptSink();
    expect(assignTurnstileScriptSrc(first, policyWindow)).toBe(true);
    expect(assignTurnstileScriptSrc(second, policyWindow)).toBe(true);
    expect(first.src as unknown).toBe(trustedUrl);
    expect(second.src as unknown).toBe(trustedUrl);
    expect(names).toEqual([TURNSTILE_TRUSTED_TYPES_POLICY]);
  });

  it("gives the policy a rule that admits Cloudflare's URL and refuses any other", () => {
    let rules: Rules | undefined;
    assignTurnstileScriptSrc(
      scriptSink(),
      ttWindow((_, given) => {
        rules = given;
        return { createScriptURL: () => trustedUrl };
      }),
    );
    expect(rules?.createScriptURL(TURNSTILE_SCRIPT_URL)).toBe(TURNSTILE_SCRIPT_URL);
    expect(() => rules?.createScriptURL("https://evil.example/api.js")).toThrow(TypeError);
  });

  it("reports false, once, naming the policy, when the browser refuses to create it", () => {
    let attempts = 0;
    const policyWindow = ttWindow(() => {
      attempts += 1;
      throw new TypeError("Refused to create a TrustedTypePolicy");
    });
    expect(assignTurnstileScriptSrc(scriptSink(), policyWindow)).toBe(false);
    expect(assignTurnstileScriptSrc(scriptSink(), policyWindow)).toBe(false);
    expect(attempts).toBe(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain(TURNSTILE_TRUSTED_TYPES_POLICY);
    expect(String(errors.mock.calls[0]?.[0])).toContain("trusted-types");
  });

  it("reports false, naming the policy, when the sink write itself throws", () => {
    const script = {
      set src(_: unknown) {
        throw new TypeError("This document requires 'TrustedScriptURL' assignment");
      },
    } as unknown as HTMLScriptElement;
    expect(
      assignTurnstileScriptSrc(
        script,
        ttWindow(() => ({ createScriptURL: () => trustedUrl })),
      ),
    ).toBe(false);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain(TURNSTILE_TRUSTED_TYPES_POLICY);
  });
});
