import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import {
  FIELD_LABEL_CLASSES,
  FieldDescription,
  FieldError,
  FieldLabel,
  fieldControlProps,
  fieldDescribedBy,
  fieldDescriptionId,
  fieldErrorId,
  fieldId,
} from "./field";
import { FormField } from "./field-layout";
import { Field } from "./field-stack";
import { Input } from "./input";

describe("fieldId helpers", () => {
  it("fieldId returns field-{name}", () => {
    expect(fieldId("email")).toBe("field-email");
  });

  it("fieldDescriptionId returns field-{name}-description", () => {
    expect(fieldDescriptionId("email")).toBe("field-email-description");
  });

  it("fieldErrorId returns field-{name}-error", () => {
    expect(fieldErrorId("email")).toBe("field-email-error");
  });

  it("a scope separates two fields that share a name", () => {
    expect([fieldId("email", "signup"), fieldDescriptionId("email", "signup"), fieldErrorId("email", "signup")]).toEqual([
      "field-signup-email",
      "field-signup-email-description",
      "field-signup-email-error",
    ]);
  });

  it("the description and error ids are derived from the control id, scoped or not", () => {
    expect(fieldDescriptionId("email", "signup")).toBe(`${fieldId("email", "signup")}-description`);
    expect(fieldErrorId("email")).toBe(`${fieldId("email")}-error`);
  });
});

describe("Field primitives", () => {
  it("wires Field.Label to the control id via explicit name prop", async () => {
    expect(
      await render(
        <FormField name='email'>
          <FormField.Label name='email'>Email address</FormField.Label>
          <FormField.Content>
            <Input field={{ name: "email" }} />
          </FormField.Content>
        </FormField>,
      ),
    ).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-red-600 flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50" for="field-email">Email address</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-email" name="email"></div></fieldset>',
    );
  });

  it("adds data-invalid to the field and aria-invalid to the control", async () => {
    expect(
      await render(
        <FormField name='email' invalid>
          <FormField.Label name='email'>Email</FormField.Label>
          <FormField.Content>
            <Input field={{ name: "email", invalid: true }} />
            <FormField.Error name='email'>Email is required.</FormField.Error>
          </FormField.Content>
        </FormField>,
      ),
    ).toBe(
      '<fieldset data-slot="field" data-invalid="" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-red-600 flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50" for="field-email">Email</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-email" name="email" aria-describedby="field-email-error" aria-invalid="true"><p data-slot="field-error" class="text-sm font-normal text-red-600" id="field-email-error" role="alert">Email is required.</p></div></fieldset>',
    );
  });

  it("wires description and error ids into aria-describedby", async () => {
    expect(
      await render(
        <FormField name='message' invalid>
          <FormField.Label name='message'>Message</FormField.Label>
          <FormField.Content>
            <Input field={{ name: "message", invalid: true, description: true }} />
            <FormField.Description name='message'>Minimum 15 characters</FormField.Description>
            <FormField.Error name='message'>Required</FormField.Error>
          </FormField.Content>
        </FormField>,
      ),
    ).toBe(
      '<fieldset data-slot="field" data-invalid="" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-red-600 flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50" for="field-message">Message</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-message" name="message" aria-describedby="field-message-description field-message-error" aria-invalid="true"><p data-slot="field-description" class="text-sm leading-normal text-muted-foreground" id="field-message-description">Minimum 15 characters</p><p data-slot="field-error" class="text-sm font-normal text-red-600" id="field-message-error" role="alert">Required</p></div></fieldset>',
    );
  });

  it("inherits disabled state on the control", async () => {
    expect(
      await render(
        <FormField name='name' disabled>
          <FormField.Label name='name'>Name</FormField.Label>
          <FormField.Content>
            <Input field={{ name: "name", disabled: true }} />
          </FormField.Content>
        </FormField>,
      ),
    ).toBe(
      '<fieldset disabled data-slot="field" data-disabled="" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-red-600 flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50" for="field-name">Name</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-name" name="name" disabled></div></fieldset>',
    );
  });

  it("preserves explicit control props over field defaults", async () => {
    expect(
      await render(
        <FormField name='name' invalid>
          <FormField.Label name='name'>Name</FormField.Label>
          <FormField.Content>
            <Input id='custom-id' aria-describedby='custom-help' aria-invalid='false' field={{ name: "name", invalid: true }} />
          </FormField.Content>
        </FormField>,
      ),
    ).toBe(
      '<fieldset data-slot="field" data-invalid="" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-red-600 flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50" for="field-name">Name</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="custom-id" aria-describedby="custom-help field-name-error" aria-invalid="false" name="name"></div></fieldset>',
    );
  });

  it("renders Field.Group with stack classes", async () => {
    expect(
      await render(
        <FormField.Group>
          <FormField name='name'>
            <FormField.Label name='name'>Name</FormField.Label>
            <FormField.Content>
              <Input field={{ name: "name" }} />
            </FormField.Content>
          </FormField>
        </FormField.Group>,
      ),
    ).toBe(
      '<div data-slot="field-group" class="@container/field-group flex w-full flex-col gap-6"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-red-600 flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50" for="field-name">Name</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-name" name="name"></div></fieldset></div>',
    );
  });

  it("renders Field.Set and Field.Legend with explicit slots", async () => {
    expect(
      await render(
        <FormField.Set>
          <FormField.Legend>Contact details</FormField.Legend>
        </FormField.Set>,
      ),
    ).toBe(
      '<fieldset data-slot="field-set" class="flex flex-col gap-6"><legend data-slot="field-legend" data-variant="legend" class="mb-3 font-medium text-base text-foreground">Contact details</legend></fieldset>',
    );
  });

  it("renders Field.Title and Field.Separator with explicit slots", async () => {
    expect(
      await render(
        <FormField.Group>
          <FormField name='name'>
            <FormField.Title>Name</FormField.Title>
            <FormField.Content>
              <Input field={{ name: "name" }} />
            </FormField.Content>
          </FormField>
          <FormField.Separator>or</FormField.Separator>
        </FormField.Group>,
      ),
    ).toBe(
      '<div data-slot="field-group" class="@container/field-group flex w-full flex-col gap-6"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-red-600 flex-col [&amp;&gt;*]:w-full"><div data-slot="field-title" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50">Name</div><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-name" name="name"></div></fieldset><div data-content="true" data-slot="field-separator" class="relative h-5 text-sm"><hr data-slot="separator" aria-orientation="horizontal" class="h-px w-full border-0 bg-border absolute inset-0 top-1/2"><span data-slot="field-separator-content" class="relative mx-auto block w-fit bg-background px-2 text-muted-foreground">or</span></div></div>',
    );
  });
});

/** Every id the rendered markup declares or references, in document order. */
function idsAndRefs(html: string): string[] {
  return [...html.matchAll(/(?:^|\s)(?:id|for|aria-describedby)="([^"]*)"/g)].flatMap((match) => (match[1] ?? "").split(" "));
}

describe("Field ids — aria-describedby names only what renders", () => {
  it("a control with no description emits no aria-describedby at all", async () => {
    // A dangling IDREF is not a no-op: assistive technology reports it as an error, and the user
    // hears a field whose help text it cannot find.
    expect(await render(<Input field={{ name: "email" }} />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-email" name="email">',
    );
  });

  it("a declared description wires the IDREF, and the description element carries that id", async () => {
    expect(
      await render(
        <FormField name='email'>
          <FormField.Content>
            <Input field={{ name: "email", description: true }} />
            <FormField.Description name='email'>We never share it.</FormField.Description>
          </FormField.Content>
        </FormField>,
      ),
    ).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-red-600 flex-col [&amp;&gt;*]:w-full"><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-email" name="email" aria-describedby="field-email-description"><p data-slot="field-description" class="text-sm leading-normal text-muted-foreground" id="field-email-description">We never share it.</p></div></fieldset>',
    );
  });

  it("an invalid field with no description names the error alone", async () => {
    expect(await render(<Input field={{ name: "email", invalid: true }} />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-email" name="email" aria-describedby="field-email-error" aria-invalid="true">',
    );
  });

  it("a caller's own aria-describedby survives when the field adds nothing", async () => {
    expect(await render(<Input aria-describedby='custom-help' field={{ name: "email" }} />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" aria-describedby="custom-help" id="field-email" name="email">',
    );
  });
});

describe("Field ids — two forms on one page", () => {
  const twoForms = (scoped: boolean) => {
    const form = (scope: string) => {
      // The one naming object every member of the field reads, which is what keeps them agreeing.
      const naming = scoped ? { name: "email", scope } : { name: "email" };
      return (
        <FormField name='email'>
          <FormField.Label {...naming}>Email</FormField.Label>
          <FormField.Content>
            <Input field={{ ...naming, description: true }} />
            <FormField.Description {...naming}>Work address</FormField.Description>
          </FormField.Content>
        </FormField>
      );
    };
    return render(
      <div>
        {form("signin")}
        {form("signup")}
      </div>,
    );
  };

  it("a scope makes every id on the page unique", async () => {
    const ids = idsAndRefs(await twoForms(true));

    expect(ids).toEqual([
      "field-signin-email",
      "field-signin-email",
      "field-signin-email-description",
      "field-signin-email-description",
      "field-signup-email",
      "field-signup-email",
      "field-signup-email-description",
      "field-signup-email-description",
    ]);
    // Each id appears exactly twice — once declared, once referenced — and never across forms.
    expect(new Set(ids).size).toBe(4);
  });

  it("the label's for still matches the control it labels", async () => {
    const html = await twoForms(true);

    expect([...html.matchAll(/for="([^"]*)"/g)].map((match) => match[1])).toEqual(["field-signin-email", "field-signup-email"]);
    expect([...html.matchAll(/<input[^>]*\sid="([^"]*)"/g)].map((match) => match[1])).toEqual(["field-signin-email", "field-signup-email"]);
  });

  it("without a scope the same two forms collide, which is what the scope exists to prevent", async () => {
    const ids = idsAndRefs(await twoForms(false));

    const perForm = ["field-email", "field-email", "field-email-description", "field-email-description"];
    expect(ids).toEqual([...perForm, ...perForm]);
    expect(new Set(ids).size).toBe(2);
  });
});

/** The ids the markup *declares* — every `id="…"`, in document order. */
function declaredIds(html: string): string[] {
  return [...html.matchAll(/(?:^|\s)id="([^"]*)"/g)].map((match) => match[1] ?? "");
}

/** The ids the markup *references* — every token of every `for` / `aria-describedby` /
 * `aria-labelledby`, in document order. Split on a single space so an empty token survives into the
 * list rather than being silently swallowed: an empty IDREF is precisely what this is looking for. */
function referencedIds(html: string): string[] {
  return [...html.matchAll(/(?:^|\s)(?:for|aria-describedby|aria-labelledby)="([^"]*)"/g)].flatMap((match) => (match[1] ?? "").split(" "));
}

describe("Field ids — the empty string is not a missing value", () => {
  it("an empty caller-supplied aria-describedby does not become the whole value", () => {
    // Were the final emptiness check dropped, this would return "" and render
    // `aria-describedby=""` — an IDREF list naming nothing, which assistive technology reports as
    // an error rather than ignoring.
    expect(fieldDescribedBy("email", { existing: "" })).toBe(undefined);
  });

  it("a field that declares neither a description nor an error points at nothing", () => {
    expect([
      fieldDescribedBy("email"),
      fieldDescribedBy("email", { description: false, invalid: false }),
      fieldDescribedBy("email", { description: false, invalid: false, existing: "" }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("an empty scope derives the same three ids as no scope at all", () => {
    // `scope` is genuinely optional and "" is the caller saying "no scope", so collapsing the two
    // is correct: the alternative would be ids like `field--email` on every unscoped field.
    expect([fieldId("email", ""), fieldDescriptionId("email", ""), fieldErrorId("email", "")]).toEqual([
      "field-email",
      "field-email-description",
      "field-email-error",
    ]);
    expect(fieldDescribedBy("email", { scope: "", description: true, invalid: true })).toBe("field-email-description field-email-error");
  });

  it("fieldControlProps omits the aria-describedby key entirely rather than setting it undefined", () => {
    // `toStrictEqual`, not `toEqual`: `toEqual` treats a key holding `undefined` as absent, so it
    // could not tell "no aria-describedby key" from "the key is there and undefined" — which is the
    // whole claim. The two `undefined` values below are keys the function does set, and their
    // presence here is what proves the matcher is reading key identity rather than value equality.
    expect(fieldControlProps({}, { name: "email" })).toStrictEqual({
      id: "field-email",
      name: "email",
      disabled: undefined,
      "aria-invalid": undefined,
    });
  });

  it("every IDREF a full field renders names an element declared in that same render", async () => {
    const html = await render(
      <FormField name='email' invalid>
        <FormField.Label name='email'>Email</FormField.Label>
        <FormField.Content>
          <Input field={{ name: "email", description: true, invalid: true }} />
          <FormField.Description name='email'>Work address</FormField.Description>
          <FormField.Error name='email'>Required</FormField.Error>
        </FormField.Content>
      </FormField>,
    );

    // Pin that references were emitted at all — an invariant over an empty list holds vacuously,
    // and this whole case would pass on markup that had stopped wiring anything.
    const refs = referencedIds(html);
    expect(refs).toEqual(["field-email", "field-email-description", "field-email-error"]);
    const declared = declaredIds(html);
    expect(refs.filter((id) => id === "" || !declared.includes(id))).toEqual([]);
    expect(declared).toEqual(["field-email", "field-email-description", "field-email-error"]);
  });
});

const INPUT_CLASSES =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50";

/** The full compound field, named however the caller names it — the one render the suppression
 * invariant and its named counterpart are both read off, so the two differ in nothing but `name`. */
const fullField = (name: string) =>
  render(
    <FormField name={name} invalid>
      <FormField.Label name={name}>Email</FormField.Label>
      <FormField.Content>
        <Input field={{ name, description: true, invalid: true }} />
        <FormField.Description name={name}>Work address</FormField.Description>
        <FormField.Error name={name}>Required</FormField.Error>
      </FormField.Content>
    </FormField>,
  );

describe("Field ids — an empty or whitespace-only name is no name at all", () => {
  it("fieldControlProps derives neither an id nor an aria-describedby for an empty name", () => {
    // The control derived two IDREFs here before the fix, naming a description and an error element
    // that the members — which have always guarded the empty name — render no id for.
    expect(fieldControlProps({}, { name: "", description: true, invalid: true })).toStrictEqual({
      name: "",
      disabled: undefined,
      "aria-invalid": true,
    });
  });

  it("a whitespace-only name is the same no-name as the empty string", () => {
    // An id of `field- ` could never be referenced by an IDREF, since HTML splits IDREF lists on
    // whitespace — so there is no reading of a blank name under which deriving one is useful.
    expect(fieldControlProps({}, { name: " ", description: true, invalid: true })).toStrictEqual({
      name: " ",
      disabled: undefined,
      "aria-invalid": true,
    });
  });

  it("an explicit caller id survives an empty name — only the derived id is suppressed", () => {
    expect(fieldControlProps({ id: "mine" }, { name: "" })).toStrictEqual({ id: "mine", name: "", disabled: undefined, "aria-invalid": undefined });
  });

  it("fieldDescribedBy derives nothing from a blank name however much the field declares", () => {
    expect([fieldDescribedBy("", { description: true, invalid: true }), fieldDescribedBy(" ", { description: true, invalid: true })]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("a caller's own reference still survives an unnamed field", () => {
    // Only *derived* ids are suppressed. `custom-help` is the caller's own claim about a element
    // forge did not render and cannot vouch for either way, so suppressing it would be forge
    // discarding data it was handed.
    expect(fieldDescribedBy("", { existing: "custom-help", description: true })).toBe("custom-help");
  });

  it("an empty existing contributes no token, so no leading space survives the join", () => {
    expect(fieldDescribedBy("email", { existing: "", description: true })).toBe("field-email-description");
  });

  it("a multi-token existing is re-joined with single spaces", () => {
    expect(fieldDescribedBy("email", { existing: "a  b ", description: true })).toBe("a b field-email-description");
  });

  it("a control with a blank name renders no id, and its name attribute passes through as given", async () => {
    // `name=""` IS emitted, deliberately: a `name` is not an IDREF but caller data under the
    // pass-through contract, and a control with an empty name is one the browser already skips at
    // submission. Suppressing an id is about references that resolve; this attribute references
    // nothing.
    expect(await render(<Input field={{ name: "" }} />)).toBe(`<input data-slot="input" class="${INPUT_CLASSES}" name="">`);
  });

  it("aria-invalid still rides on a blank-named control, because invalidity is not an IDREF", async () => {
    expect(await render(<Input field={{ name: "", description: true, invalid: true }} />)).toBe(
      `<input data-slot="input" class="${INPUT_CLASSES}" name="" aria-invalid="true">`,
    );
  });

  it("FieldDescription renders no id for a blank name", async () => {
    expect(await render(<FieldDescription name=''>hi</FieldDescription>)).toBe(
      '<p data-slot="field-description" class="text-sm leading-normal text-muted-foreground">hi</p>',
    );
  });

  it("FieldLabel renders no for, and FieldError no id, for a blank name", async () => {
    expect([await render(<FieldLabel name=''>hi</FieldLabel>), await render(<FieldError name=''>bad</FieldError>)]).toEqual([
      `<label data-slot="field-label" class="${FIELD_LABEL_CLASSES}">hi</label>`,
      '<p data-slot="field-error" class="text-sm font-normal text-red-600" role="alert">bad</p>',
    ]);
  });

  it("a whole blank-named field declares and references no id at all", async () => {
    const html = await fullField("");

    // Both halves: an empty *reference* list is what the fix is for, and an empty *declared* list is
    // what makes it agreement rather than one side of the pair having simply stopped rendering.
    expect([referencedIds(html), declaredIds(html)]).toEqual([[], []]);
  });

  it("the same markup named renders the full set, so the empty pair above means suppression", async () => {
    // The control case for the one above. An invariant over two empty lists holds vacuously; this is
    // the render that shows the lists are empty because the name is blank, not because the compound
    // stopped wiring anything.
    const html = await fullField("email");

    expect([referencedIds(html), declaredIds(html)]).toEqual([
      ["field-email", "field-email-description", "field-email-error"],
      ["field-email", "field-email-description", "field-email-error"],
    ]);
  });

  it("a whole field named with an interior space declares and references no id either", async () => {
    // Beside its control case deliberately: same render, same reader, one line apart, so the empty
    // pair reads as suppression of an unresolvable id rather than as the compound having stopped
    // wiring. `first name` derives `field-first name-description`, which the browser splits into
    // `field-first` and `name-description` — two tokens, neither declared anywhere on the page.
    const html = await fullField("first name");

    expect([referencedIds(html), declaredIds(html)]).toEqual([[], []]);
  });

  it("an empty caller aria-describedby leaves no leading space on the rendered attribute", async () => {
    // The exact path the bug was reported through. The empty attribute is the input under test —
    // biome is right that it is invalid, and that is precisely why forge must not propagate it.
    // biome-ignore lint/a11y/useValidAriaValues: an invalid empty IDREF list is the input this case exists to feed in
    expect(await render(<Input aria-describedby='' field={{ name: "email", description: true }} />)).toBe(
      `<input data-slot="input" class="${INPUT_CLASSES}" aria-describedby="field-email-description" id="field-email" name="email">`,
    );
  });
});

/** U+00A0. A legal id character that no parser treats as a token separator — spelled by codepoint so
 * the difference from an ASCII space is visible in the source rather than only in a diff. */
const NBSP = "\u00a0";

/** Every character in HTML's ASCII whitespace set, labelled — the class an id may not contain and
 * the one an IDREF list is split on. */
const ASCII_WS_CHARS: ReadonlyArray<readonly [label: string, ws: string]> = [
  ["tab", "\t"],
  ["line feed", "\n"],
  ["form feed", "\f"],
  ["carriage return", "\r"],
  ["space", " "],
];

describe("Field ids — a name or scope must be a single id token", () => {
  it("fieldControlProps derives neither an id nor an aria-describedby for a name with a space", () => {
    // The reported case.
    expect(fieldControlProps({}, { name: "first name", description: true, invalid: true })).toStrictEqual({
      name: "first name",
      disabled: undefined,
      "aria-invalid": true,
    });
  });

  it("every other ASCII whitespace character suppresses derivation exactly as a space does", () => {
    // The one case that fails if the class is narrowed back to `" "` alone. HTML splits an IDREF list
    // on all five of these, so an id containing any of them is equally unreferenceable.
    // The label rides along so a failure names the character rather than printing an invisible one.
    const derived = ASCII_WS_CHARS.map(([label, ws]) => [label, fieldControlProps({}, { name: `a${ws}b`, description: true, invalid: true })]);

    expect(derived).toStrictEqual(ASCII_WS_CHARS.map(([label, ws]) => [label, { name: `a${ws}b`, disabled: undefined, "aria-invalid": true }]));
  });

  it("fieldDescribedBy derives nothing from a name containing a tab or a newline", () => {
    // Before the fix these returned `"field-a b-description"` — the whitespace run collapsed by the
    // `\s+` split — while the sibling `FieldDescription` declared `id="field-a\tb-description"`. Not
    // the same string, so the reference dangled even though both halves had been asked for one id.
    expect([fieldDescribedBy("a\tb", { description: true }), fieldDescribedBy("a\nb", { description: true })]).toEqual([undefined, undefined]);
  });

  it("a scope containing whitespace suppresses derivation as surely as the name does", () => {
    // Falling back to the unscoped id instead would collide with the very field the scope exists to
    // be distinguished from.
    expect(fieldDescribedBy("email", { scope: "sign up", description: true })).toBe(undefined);
    expect(fieldControlProps({}, { name: "email", scope: "sign up", description: true })).toStrictEqual({
      name: "email",
      disabled: undefined,
      "aria-invalid": undefined,
    });
  });

  it("a blank scope is no scope, not an unresolvable one", () => {
    expect(fieldId("email", " ")).toBe("field-email");
    expect(fieldDescribedBy("email", { scope: " ", description: true })).toBe("field-email-description");
  });

  it("an empty scope still derives the unscoped id", () => {
    // Regression pin on the path the fix did not touch: `""` and a blank scope must stay the same.
    expect(fieldId("email", "")).toBe("field-email");
  });

  it("a non-breaking space is a legal id character, so it derives and the two halves agree", async () => {
    // The both-directions guard, paired with the space case above: ASCII whitespace suppresses, a
    // non-ASCII space does not. The defect was precisely that these two strings diverged — the
    // declared id held codepoint 160 where the reference held 32 — so the assertion is that the
    // rendered id IS the derived reference, not merely that each looks right on its own.
    const describedBy = fieldDescribedBy(`a${NBSP}b`, { description: true });

    expect(await render(<FieldDescription name={`a${NBSP}b`}>Work address</FieldDescription>)).toBe(
      `<p data-slot="field-description" class="text-sm leading-normal text-muted-foreground" id="${describedBy}">Work address</p>`,
    );
    expect(describedBy).toBe(`field-a${NBSP}b-description`);
  });

  it("a name of nothing but a non-breaking space is a present name", () => {
    // An accepted behaviour change, not an accident: under the old `.trim()` this name was absent.
    // One whitespace definition per file is the whole point of the fix — two is how the defect
    // arose — and `field- ` is an id an IDREF can name, so there is no ground to suppress it.
    expect(fieldControlProps({}, { name: NBSP })).toStrictEqual({
      id: `field-${NBSP}`,
      name: NBSP,
      disabled: undefined,
      "aria-invalid": undefined,
    });
  });

  it("a caller token containing a non-breaking space is one token, not two", () => {
    expect(fieldDescribedBy("email", { existing: `a${NBSP}b`, description: true })).toBe(`a${NBSP}b field-email-description`);
  });

  it("ASCII whitespace runs in a caller's existing value still collapse", () => {
    expect(fieldDescribedBy("email", { existing: "a  b ", description: true })).toBe("a b field-email-description");
  });

  it("a control named with a space renders no id, and its name attribute passes through as given", async () => {
    // `name` is caller data under the pass-through contract, not an IDREF — it references nothing, so
    // there is nothing for it to fail to resolve.
    expect(await render(<Input field={{ name: "first name" }} />)).toBe(`<input data-slot="input" class="${INPUT_CLASSES}" name="first name">`);
  });

  it("FieldLabel renders no for, and FieldDescription and FieldError no id, for a name with a space", async () => {
    expect([
      await render(<FieldLabel name='first name'>Name</FieldLabel>),
      await render(<FieldDescription name='first name'>Work address</FieldDescription>),
      await render(<FieldError name='first name'>Required</FieldError>),
    ]).toEqual([
      `<label data-slot="field-label" class="${FIELD_LABEL_CLASSES}">Name</label>`,
      '<p data-slot="field-description" class="text-sm leading-normal text-muted-foreground">Work address</p>',
      '<p data-slot="field-error" class="text-sm font-normal text-red-600" role="alert">Required</p>',
    ]);
  });
});

describe("Field — arbitrary attribute pass-through", () => {
  it("forwards data-* attributes to the root with escaped values", async () => {
    expect(
      await render(
        <Field label='Email' data-test-hook='email-field' data-note='a&b'>
          <Input field={{ name: "email" }} />
        </Field>,
      ),
    ).toBe(
      '<div data-slot="field" data-orientation="vertical" class="flex flex-col gap-1" data-test-hook="email-field" data-note="a&amp;b"><span data-slot="field-label" class="text-xs font-medium text-muted-foreground">Email</span><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-email" name="email"></div>',
    );
  });
});
