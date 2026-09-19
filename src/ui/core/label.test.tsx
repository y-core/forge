import { describe, expect, it } from "bun:test";

import { attrsOf, classesOf, tagOf } from "../../testing/markup";
import { render } from "../../testing/render";
import { Label } from "./label";

describe("Label", () => {
  it("renders the whole caption exactly, its text escaped and the required marker appended after it", async () => {
    expect(await render(<Label required>{`R&D's`}</Label>)).toBe(
      '<label data-slot="label" class="flex w-fit items-center gap-2 text-sm leading-snug font-medium text-foreground' +
        ' group-data-[disabled]/field:opacity-50">R&amp;D&#39;s<span data-slot="label-required" aria-hidden="true" class="ms-0.5 text-destructive-text">*</span></label>',
    );
  });

  it("names itself with a slot and emits no for attribute it was not given", async () => {
    expect(attrsOf(await render(<Label>Name</Label>))).toEqual({ "data-slot": "label" });
  });

  it("binds to the control it was pointed at, which is the whole reason a label is not a span", async () => {
    expect(attrsOf(await render(<Label for='email-field'>Email</Label>))).toEqual({ "data-slot": "label", for: "email-field" });
  });

  it("omits the required marker unless required is set, so an optional field is not mis-announced", async () => {
    expect(tagOf(await render(<Label>Optional</Label>), 'data-slot="label-required"')).toBe("");
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Label class='my-label'>Text</Label>)).at(-1)).toBe("my-label");
  });
});
