import { describe, expect, it } from "bun:test";

import type { JSX, JSXNode } from "../../render/jsx/types";
import { attrOf, attrsOf, elementOf, innerOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { CheckboxGroup } from "./checkbox-group";
import {
  FieldDescription,
  FieldError,
  FieldLabel,
  fieldControlId,
  fieldControlProps,
  fieldDescribedBy,
  fieldDescriptionId,
  fieldErrorId,
  fieldId,
  fieldItemId,
} from "./field";
import { FormField } from "./field-layout";
import { Field } from "./field-stack";
import { Input } from "./input";
import { RadioGroup } from "./radio-group";
import type { FieldDescriptor } from "./types";

const ROOT = 'data-slot="field"';
const LABEL = 'data-slot="field-label"';
const DESCRIPTION = 'data-slot="field-description"';
const INPUT = 'data-slot="input"';

const CONTROL = { "data-slot": "input", "data-size": "md" };

function slotsOf(html: string): string[] {
  return [...html.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1] ?? "");
}

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

describe("fieldControlId", () => {
  const cases: ReadonlyArray<{
    label: string;
    id: string | undefined;
    field: { name: string; scope?: string } | undefined;
    expected: string | undefined;
  }> = [
    { label: "an explicit id wins over the descriptor", id: "mine", field: { name: "email" }, expected: "mine" },
    { label: "an explicit id stands with no descriptor", id: "mine", field: undefined, expected: "mine" },
    { label: "a descriptor derives the field id", id: undefined, field: { name: "email" }, expected: "field-email" },
    {
      label: "a scoped descriptor derives the scoped field id",
      id: undefined,
      field: { name: "email", scope: "signup" },
      expected: "field-signup-email",
    },
    { label: "an empty name derives nothing", id: undefined, field: { name: "" }, expected: undefined },
    { label: "a whitespace-only name derives nothing", id: undefined, field: { name: " " }, expected: undefined },
    { label: "neither an id nor a descriptor is no id", id: undefined, field: undefined, expected: undefined },
  ];

  for (const { label, id, field, expected } of cases) {
    it(label, () => {
      expect(fieldControlId(id, field)).toBe(expected);
    });
  }
});

describe("fieldItemId — an item never takes a group message's id", () => {
  const reserved: ReadonlyArray<readonly [value: string, scope: string | undefined]> = [
    ["error", undefined],
    ["description", undefined],
    ["error", "signup"],
    ["description", "signup"],
  ];

  it("derives no id for an item valued 'error' or 'description', scoped or not", () => {
    expect(reserved.map(([value, scope]) => fieldItemId("level", value, scope))).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("still derives an id for any other value, so only the two message suffixes are reserved", () => {
    expect([fieldItemId("level", "warn"), fieldItemId("level", "warn", "signup")]).toEqual(["field-level-warn", "field-signup-level-warn"]);
  });
});

describe("Field primitives", () => {
  it("renders the whole field element exactly, its own class entities and a forwarded value escaped", async () => {
    expect(await render(<FormField data-note={`R&D's <x>`} />)).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-destructive-text' +
        ' flex-col" data-note="R&amp;D&#39;s &lt;x&gt;"></fieldset>',
    );
  });

  it("wires Field.Label to the control id via explicit name prop", async () => {
    const html = await render(
      <FormField>
        <FormField.Label name='email'>Email address</FormField.Label>
        <FormField.Content>
          <Input field={{ name: "email" }} />
        </FormField.Content>
      </FormField>,
    );

    expect([attrOf(html, "for", LABEL), attrOf(html, "id", INPUT)]).toEqual(["field-email", "field-email"]);
    expect(slotsOf(html)).toEqual(["field", "field-label", "field-content", "input"]);
  });

  it("adds data-invalid to the field and aria-invalid to the control", async () => {
    const html = await render(
      <FormField invalid>
        <FormField.Label name='email'>Email</FormField.Label>
        <FormField.Content>
          <Input field={{ name: "email", error: "Email is required." }} />
          <FormField.Error name='email'>Email is required.</FormField.Error>
        </FormField.Content>
      </FormField>,
    );

    expect(attrsOf(html, ROOT)).toEqual({ "data-slot": "field", "data-invalid": "", "data-orientation": "vertical" });
    expect(attrsOf(html, INPUT)).toEqual({
      ...CONTROL,
      id: "field-email",
      name: "email",
      "aria-describedby": "field-email-error",
      "aria-invalid": "true",
    });
  });

  it("wires description and error ids into aria-describedby", async () => {
    const html = await render(
      <FormField invalid>
        <FormField.Label name='message'>Message</FormField.Label>
        <FormField.Content>
          <Input field={{ name: "message", error: "Required", description: true }} />
          <FormField.Description name='message'>Minimum 15 characters</FormField.Description>
          <FormField.Error name='message'>Required</FormField.Error>
        </FormField.Content>
      </FormField>,
    );

    expect(attrOf(html, "aria-describedby", INPUT)).toBe("field-message-description field-message-error");
    expect(declaredIds(html)).toEqual(["field-message", "field-message-description", "field-message-error"]);
  });

  it("inherits disabled state on the control, so the browser refuses the input itself", async () => {
    const html = await render(
      <FormField disabled>
        <FormField.Label name='name'>Name</FormField.Label>
        <FormField.Content>
          <Input field={{ name: "name", disabled: true }} />
        </FormField.Content>
      </FormField>,
    );

    expect(attrsOf(html, ROOT)).toEqual({ disabled: "", "data-slot": "field", "data-disabled": "", "data-orientation": "vertical" });
    expect(attrsOf(html, INPUT)).toEqual({ ...CONTROL, id: "field-name", name: "name", disabled: "" });
  });

  it("preserves explicit control props over field defaults, appending its own IDREF rather than replacing", async () => {
    const html = await render(
      <FormField invalid>
        <FormField.Label name='name'>Name</FormField.Label>
        <FormField.Content>
          <Input id='custom-id' aria-describedby='custom-help' aria-invalid='false' field={{ name: "name", error: "Required" }} />
        </FormField.Content>
      </FormField>,
    );

    expect(attrsOf(html, INPUT)).toEqual({
      ...CONTROL,
      id: "custom-id",
      "aria-describedby": "custom-help field-name-error",
      "aria-invalid": "false",
      name: "name",
    });
  });

  it("nests a whole field inside Field.Group, which is the element the container query keys on", async () => {
    const html = await render(
      <FormField.Group>
        <FormField>
          <FormField.Label name='name'>Name</FormField.Label>
          <FormField.Content>
            <Input field={{ name: "name" }} />
          </FormField.Content>
        </FormField>
      </FormField.Group>,
    );

    expect(attrsOf(html)).toEqual({ "data-slot": "field-group" });
    expect(slotsOf(html)).toEqual(["field-group", "field", "field-label", "field-content", "input"]);
  });

  it("renders Field.Set and Field.Legend with explicit slots, the legend naming the set", async () => {
    const html = await render(
      <FormField.Set>
        <FormField.Legend>Contact details</FormField.Legend>
      </FormField.Set>,
    );

    expect(slotsOf(html)).toEqual(["field-set", "field-legend"]);
    expect(attrsOf(html, 'data-slot="field-legend"')).toEqual({ "data-slot": "field-legend", "data-as": "legend" });
    expect(innerOf(elementOf(html, "legend"))).toBe("Contact details");
  });

  it("renders Field.Title and Field.Separator with explicit slots, the separator carrying its own content", async () => {
    const html = await render(
      <FormField.Group>
        <FormField>
          <FormField.Title>Name</FormField.Title>
          <FormField.Content>
            <Input field={{ name: "name" }} />
          </FormField.Content>
        </FormField>
        <FormField.Separator>or</FormField.Separator>
      </FormField.Group>,
    );

    expect(slotsOf(html)).toEqual([
      "field-group",
      "field",
      "field-title",
      "field-content",
      "input",
      "field-separator",
      "separator",
      "field-separator-content",
    ]);
    expect(attrsOf(html, 'data-slot="field-separator"')).toEqual({ "data-content": "true", "data-slot": "field-separator" });
    expect(innerOf(elementOf(html, "span"))).toBe("or");
  });

  it("renders an error with no live-region role, because `announce()` speaks a failed submission's first error", async () => {
    expect(attrsOf(await render(<FieldError name='email'>Required</FieldError>))).toEqual({ "data-slot": "field-error", id: "field-email-error" });
  });

  it("still takes a role the caller passes", async () => {
    expect(attrsOf(await render(<FieldError role='note'>Required</FieldError>))).toEqual({ "data-slot": "field-error", role: "note" });
  });
});

describe("FormField — the members and the control carry the name, never the root", () => {
  it("rejects a root name at the type level, and a root alone wires no id", async () => {
    // @ts-expect-error -- the root takes no `name`; the members and the control's `field` carry it
    const html = await render(<FormField name='email' />);

    expect([referencedIds(html), declaredIds(html)]).toEqual([[], []]);
  });

  it("names the layout guide's example textbox: its label points at the input and its description is the one it reads", async () => {
    const html = await render(
      <FormField.Group class='gap-2'>
        <FormField>
          <FormField.Content class='gap-2'>
            <FormField.Label name='email'>Email</FormField.Label>
            <Input field={{ name: "email", description: true }} />
            <FormField.Description name='email'>We only use this for receipts.</FormField.Description>
          </FormField.Content>
        </FormField>
      </FormField.Group>,
    );

    expect([attrOf(html, "for", LABEL), attrOf(html, "aria-describedby", INPUT)]).toEqual([
      attrOf(html, "id", INPUT),
      attrOf(html, "id", DESCRIPTION),
    ]);
    expect(referencedIds(html)).toEqual([fieldId("email"), fieldDescriptionId("email")]);
    expect(referencedIds(html).filter((id) => !declaredIds(html).includes(id))).toEqual([]);
  });
});

function idsAndRefs(html: string): string[] {
  return [...html.matchAll(/(?:^|\s)(?:id|for|aria-describedby)="([^"]*)"/g)].flatMap((match) => (match[1] ?? "").split(" "));
}

describe("Field ids — aria-describedby names only what renders", () => {
  it("a control with no description emits no aria-describedby at all", async () => {
    expect(attrsOf(await render(<Input field={{ name: "email" }} />))).toEqual({ ...CONTROL, id: "field-email", name: "email" });
  });

  it("a declared description wires the IDREF, and the description element carries that id", async () => {
    const html = await render(
      <FormField>
        <FormField.Content>
          <Input field={{ name: "email", description: true }} />
          <FormField.Description name='email'>We never share it.</FormField.Description>
        </FormField.Content>
      </FormField>,
    );

    expect(attrOf(html, "aria-describedby", INPUT)).toBe("field-email-description");
    expect(attrsOf(html, DESCRIPTION)).toEqual({ "data-slot": "field-description", id: "field-email-description" });
  });

  it("an invalid field with no description names the error alone", async () => {
    expect(attrsOf(await render(<Input field={{ name: "email", error: "Required" }} />))).toEqual({
      ...CONTROL,
      id: "field-email",
      name: "email",
      "aria-describedby": "field-email-error",
      "aria-invalid": "true",
    });
  });

  it("a caller's own aria-describedby survives when the field adds nothing", async () => {
    expect(attrsOf(await render(<Input aria-describedby='custom-help' field={{ name: "email" }} />))).toEqual({
      ...CONTROL,
      "aria-describedby": "custom-help",
      id: "field-email",
      name: "email",
    });
  });
});

describe("Field ids — two forms on one page", () => {
  const twoForms = (scoped: boolean) => {
    const form = (scope: string) => {
      const naming = scoped ? { name: "email", scope } : { name: "email" };
      return (
        <FormField>
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

function declaredIds(html: string): string[] {
  return [...html.matchAll(/(?:^|\s)id="([^"]*)"/g)].map((match) => match[1] ?? "");
}

// Split on a single space, not `\s+`: an empty IDREF token must survive into the list.
function referencedIds(html: string): string[] {
  return [...html.matchAll(/(?:^|\s)(?:for|aria-describedby|aria-labelledby)="([^"]*)"/g)].flatMap((match) => (match[1] ?? "").split(" "));
}

describe("Field ids — the empty string is not a missing value", () => {
  it("an empty caller-supplied aria-describedby does not become the whole value", () => {
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
    expect([fieldId("email", ""), fieldDescriptionId("email", ""), fieldErrorId("email", "")]).toEqual([
      "field-email",
      "field-email-description",
      "field-email-error",
    ]);
    expect(fieldDescribedBy("email", { scope: "", description: true, invalid: true })).toBe("field-email-description field-email-error");
  });

  it("fieldControlProps omits the aria-describedby key entirely rather than setting it undefined", () => {
    expect(fieldControlProps({}, { name: "email" })).toStrictEqual({
      id: "field-email",
      name: "email",
      disabled: undefined,
      "aria-invalid": undefined,
    });
  });

  it("a blank caller aria-describedby with no derived ids renders no attribute", async () => {
    expect(attrsOf(await render(<Input aria-describedby='  ' field={{ name: "email" }} />))).not.toHaveProperty("aria-describedby");
  });

  it("fieldControlProps removes an empty caller aria-describedby key rather than passing it through", () => {
    expect(fieldControlProps({ "aria-describedby": "" }, { name: "email" })).toStrictEqual({
      id: "field-email",
      name: "email",
      disabled: undefined,
      "aria-invalid": undefined,
    });
  });

  it("every IDREF a full field renders names an element declared in that same render", async () => {
    const html = await render(
      <FormField invalid>
        <FormField.Label name='email'>Email</FormField.Label>
        <FormField.Content>
          <Input field={{ name: "email", description: true, error: "Required" }} />
          <FormField.Description name='email'>Work address</FormField.Description>
          <FormField.Error name='email'>Required</FormField.Error>
        </FormField.Content>
      </FormField>,
    );

    const refs = referencedIds(html);
    expect(refs).toEqual(["field-email", "field-email-description", "field-email-error"]);
    const declared = declaredIds(html);
    expect(refs.filter((id) => id === "" || !declared.includes(id))).toEqual([]);
    expect(declared).toEqual(["field-email", "field-email-description", "field-email-error"]);
  });
});

const fullField = (name: string) =>
  render(
    <FormField invalid>
      <FormField.Label name={name}>Email</FormField.Label>
      <FormField.Content>
        <Input field={{ name, description: true, error: "Required" }} />
        <FormField.Description name={name}>Work address</FormField.Description>
        <FormField.Error name={name}>Required</FormField.Error>
      </FormField.Content>
    </FormField>,
  );

describe("Field ids — an empty or whitespace-only name is no name at all", () => {
  it("fieldControlProps derives neither an id nor an aria-describedby for an empty name", () => {
    expect(fieldControlProps({}, { name: "", description: true, error: "Required" })).toStrictEqual({
      name: "",
      disabled: undefined,
      "aria-invalid": true,
    });
  });

  it("a whitespace-only name is the same no-name as the empty string", () => {
    expect(fieldControlProps({}, { name: " ", description: true, error: "Required" })).toStrictEqual({
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
    expect(fieldDescribedBy("", { existing: "custom-help", description: true })).toBe("custom-help");
  });

  it("an empty existing contributes no token, so no leading space survives the join", () => {
    expect(fieldDescribedBy("email", { existing: "", description: true })).toBe("field-email-description");
  });

  it("a multi-token existing is re-joined with single spaces", () => {
    expect(fieldDescribedBy("email", { existing: "a  b ", description: true })).toBe("a b field-email-description");
  });

  it("a control with a blank name renders no id, and its name attribute passes through as given", async () => {
    expect(attrsOf(await render(<Input field={{ name: "" }} />))).toEqual({ ...CONTROL, name: "" });
  });

  it("aria-invalid still rides on a blank-named control, because invalidity is not an IDREF", async () => {
    expect(attrsOf(await render(<Input field={{ name: "", description: true, error: "Required" }} />))).toEqual({
      ...CONTROL,
      name: "",
      "aria-invalid": "true",
    });
  });

  it("FieldLabel renders no for, and FieldDescription and FieldError no id, for a blank name", async () => {
    expect([
      attrsOf(await render(<FieldLabel name=''>hi</FieldLabel>)),
      attrsOf(await render(<FieldDescription name=''>hi</FieldDescription>)),
      attrsOf(await render(<FieldError name=''>bad</FieldError>)),
    ]).toEqual([{ "data-slot": "field-label" }, { "data-slot": "field-description" }, { "data-slot": "field-error" }]);
  });

  it("a whole blank-named field declares and references no id at all", async () => {
    const html = await fullField("");

    expect([referencedIds(html), declaredIds(html)]).toEqual([[], []]);
  });

  it("the same markup named renders the full set, so the empty pair above means suppression", async () => {
    const html = await fullField("email");

    expect([referencedIds(html), declaredIds(html)]).toEqual([
      ["field-email", "field-email-description", "field-email-error"],
      ["field-email", "field-email-description", "field-email-error"],
    ]);
  });

  it("a whole field named with an interior space declares and references no id either", async () => {
    const html = await fullField("first name");

    expect([referencedIds(html), declaredIds(html)]).toEqual([[], []]);
  });

  it("an empty caller aria-describedby leaves no leading space on the rendered attribute", async () => {
    expect(attrOf(await render(<Input aria-describedby='' field={{ name: "email", description: true }} />), "aria-describedby")).toBe(
      "field-email-description",
    );
  });
});

/** U+00A0 — a legal id character that no parser treats as a token separator. */
const NBSP = "\u00a0";

const ASCII_WS_CHARS: ReadonlyArray<readonly [label: string, ws: string]> = [
  ["tab", "\t"],
  ["line feed", "\n"],
  ["form feed", "\f"],
  ["carriage return", "\r"],
  ["space", " "],
];

describe("Field ids — a name or scope must be a single id token", () => {
  it("fieldControlProps derives neither an id nor an aria-describedby for a name with a space", () => {
    expect(fieldControlProps({}, { name: "first name", description: true, error: "Required" })).toStrictEqual({
      name: "first name",
      disabled: undefined,
      "aria-invalid": true,
    });
  });

  it("every other ASCII whitespace character suppresses derivation exactly as a space does", () => {
    const derived = ASCII_WS_CHARS.map(([label, ws]) => [label, fieldControlProps({}, { name: `a${ws}b`, description: true, error: "Required" })]);

    expect(derived).toStrictEqual(ASCII_WS_CHARS.map(([label, ws]) => [label, { name: `a${ws}b`, disabled: undefined, "aria-invalid": true }]));
  });

  it("fieldDescribedBy derives nothing from a name containing a tab or a newline", () => {
    expect([fieldDescribedBy("a\tb", { description: true }), fieldDescribedBy("a\nb", { description: true })]).toEqual([undefined, undefined]);
  });

  it("a scope containing whitespace suppresses derivation as surely as the name does", () => {
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
    expect(fieldId("email", "")).toBe("field-email");
  });

  it("a non-breaking space is a legal id character, so it derives and the two halves agree", async () => {
    const describedBy = fieldDescribedBy(`a${NBSP}b`, { description: true });

    expect(attrsOf(await render(<FieldDescription name={`a${NBSP}b`}>Work address</FieldDescription>))).toEqual({
      "data-slot": "field-description",
      id: `field-a${NBSP}b-description`,
    });
    expect(describedBy).toBe(`field-a${NBSP}b-description`);
  });

  it("a name of nothing but a non-breaking space is a present name", () => {
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
    expect(attrsOf(await render(<Input field={{ name: "first name" }} />))).toEqual({ ...CONTROL, name: "first name" });
  });

  it("FieldLabel renders no for, and FieldDescription and FieldError no id, for a name with a space", async () => {
    expect([
      attrsOf(await render(<FieldLabel name='first name'>Name</FieldLabel>)),
      attrsOf(await render(<FieldDescription name='first name'>Work address</FieldDescription>)),
      attrsOf(await render(<FieldError name='first name'>Required</FieldError>)),
    ]).toEqual([{ "data-slot": "field-label" }, { "data-slot": "field-description" }, { "data-slot": "field-error" }]);
  });
});

describe("Field — arbitrary attribute pass-through", () => {
  it("forwards data-* attributes to the root with escaped values", async () => {
    const html = await render(
      <Field label='Email' data-test-hook='email-field' data-note='a&b'>
        <Input field={{ name: "email" }} />
      </Field>,
    );

    expect(attrsOf(html)).toEqual({
      "data-slot": "field-stack",
      "data-orientation": "vertical",
      "data-test-hook": "email-field",
      "data-note": "a&amp;b",
    });
    expect(slotsOf(html)).toEqual(["field-stack", "field-stack-label", "input"]);
  });
});

describe("FormField — orientation and responsive", () => {
  it("lays out vertically by default and stamps no data-responsive", async () => {
    expect(attrsOf(await render(<FormField />))).toEqual({ "data-slot": "field", "data-orientation": "vertical" });
  });

  it("orientation='horizontal' stamps the horizontal axis and swaps the column layout for a row", async () => {
    const html = await render(<FormField orientation='horizontal' />);

    expect(attrsOf(html)).toEqual({ "data-slot": "field", "data-orientation": "horizontal" });
    expect(variantClasses(html, await render(<FormField />))).toEqual({
      added: ["flex-row", "items-start", "[&amp;&gt;[data-slot~=field-content]]:flex-1", "[&amp;&gt;[data-slot~=field-label]]:flex-auto"],
      dropped: ["flex-col"],
    });
  });

  it("responsive stamps data-responsive and layers the container-query row on the vertical layout", async () => {
    const html = await render(<FormField responsive />);

    expect(attrsOf(html)).toEqual({ "data-slot": "field", "data-responsive": "", "data-orientation": "vertical" });
    expect(variantClasses(html, await render(<FormField />))).toEqual({
      added: [
        "@md/field-group:flex-row",
        "@md/field-group:items-start",
        "@md/field-group:[&amp;&gt;[data-slot~=field-content]]:flex-1",
        "@md/field-group:[&amp;&gt;[data-slot~=field-label]]:flex-auto",
      ],
      dropped: [],
    });
  });
});

describe("FormField.Error — a blank message renders no element, so nothing names it", () => {
  const blank: ReadonlyArray<{ label: string; element: JSX.Element }> = [
    { label: "no children", element: <FormField.Error name='email' /> },
    { label: "the empty string", element: <FormField.Error name='email'>{""}</FormField.Error> },
    { label: "an empty array", element: <FormField.Error name='email'>{[]}</FormField.Error> },
    { label: "ASCII whitespace only", element: <FormField.Error name='email'>{"  \n\t"}</FormField.Error> },
    { label: "an array of null and a space", element: <FormField.Error name='email'>{[null, " "]}</FormField.Error> },
    { label: "a nested empty array beside false", element: <FormField.Error name='email'>{[[], false]}</FormField.Error> },
    { label: "true", element: <FormField.Error name='email'>{true}</FormField.Error> },
  ];

  for (const { label, element } of blank) {
    it(`renders nothing for ${label}`, async () => {
      expect(await render(element)).toBe("");
    });
  }

  it("a field whose error is the empty string renders no error, and the control references nothing undeclared", async () => {
    const error = "";
    const html = await render(
      <FormField invalid={Boolean(error)}>
        <FormField.Label name='email'>Email</FormField.Label>
        <Input field={{ name: "email", error }} />
        <FormField.Error name='email'>{error}</FormField.Error>
      </FormField>,
    );

    expect(slotsOf(html)).toEqual(["field", "field-label", "input"]);
    expect(attrsOf(html, INPUT)).toEqual({ ...CONTROL, id: "field-email", name: "email" });
    expect(referencedIds(html).filter((id) => !declaredIds(html).includes(id))).toEqual([]);
  });

  it("a valid field whose error has no children renders no error, and the control references nothing undeclared", async () => {
    const html = await render(
      <FormField invalid={false}>
        <FormField.Label name='email'>Email</FormField.Label>
        <Input field={{ name: "email" }} />
        <FormField.Error name='email' />
      </FormField>,
    );

    expect(slotsOf(html)).toEqual(["field", "field-label", "input"]);
    expect(attrsOf(html, INPUT)).toEqual({ ...CONTROL, id: "field-email", name: "email" });
    expect(referencedIds(html).filter((id) => !declaredIds(html).includes(id))).toEqual([]);
  });

  const rendered: ReadonlyArray<{ label: string; element: JSX.Element; content: string }> = [
    { label: "the number zero", element: <FormField.Error name='email'>{0}</FormField.Error>, content: "0" },
    { label: "text padded with spaces", element: <FormField.Error name='email'>{" Required "}</FormField.Error>, content: " Required " },
    { label: "a lone non-breaking space", element: <FormField.Error name='email'>{NBSP}</FormField.Error>, content: NBSP },
    {
      label: "an element child",
      element: (
        <FormField.Error name='email'>
          <span>Required</span>
        </FormField.Error>
      ),
      content: "<span>Required</span>",
    },
    {
      label: "an array holding a space and text",
      element: <FormField.Error name='email'>{[" ", "Required"]}</FormField.Error>,
      content: " Required",
    },
  ];

  for (const { label, element, content } of rendered) {
    it(`still renders the error paragraph for ${label}, its content intact`, async () => {
      const html = await render(element);

      expect([attrsOf(html), innerOf(elementOf(html, "p"))]).toEqual([{ "data-slot": "field-error", id: "field-email-error" }, content]);
    });
  }

  it("CheckboxGroup.Error renders nothing for the empty string too", async () => {
    expect(await render(<CheckboxGroup.Error name='opts'>{""}</CheckboxGroup.Error>)).toBe("");
  });

  it("a root marked invalid styles the fieldset only, and never marks or describes the control", async () => {
    const html = await render(
      <FormField invalid>
        <Input field={{ name: "email" }} />
      </FormField>,
    );

    expect([attrsOf(html, ROOT), attrsOf(html, INPUT)]).toEqual([
      { "data-slot": "field", "data-invalid": "", "data-orientation": "vertical" },
      { ...CONTROL, id: "field-email", name: "email" },
    ]);
  });
});

const MESSAGES: ReadonlyArray<{ label: string; message: JSXNode }> = [
  { label: "the empty string", message: "" },
  { label: "ASCII whitespace only", message: "  \n\t" },
  { label: "an empty array", message: [] },
  { label: "a nested empty array beside false", message: [[], false] },
  { label: "true", message: true },
  { label: "the number zero", message: 0 },
  { label: "a lone non-breaking space", message: NBSP },
  { label: "text", message: "Required" },
  { label: "an array holding a space and text", message: [" ", "Required"] },
];

describe("FieldDescriptor.error — the control marks and describes only a message that renders", () => {
  const wired = (error: JSXNode) => (
    <FormField>
      <FormField.Label name='email'>Email</FormField.Label>
      <Input field={{ name: "email", error }} />
      <FormField.Error name='email'>{error}</FormField.Error>
    </FormField>
  );

  const blank: ReadonlyArray<{ label: string; error: JSXNode }> = [
    { label: "the empty string", error: "" },
    { label: "ASCII whitespace only", error: "  \n\t" },
    { label: "an empty array", error: [] },
    { label: "an array of null and a space", error: [null, " "] },
  ];

  for (const { label, error } of blank) {
    it(`a blank error (${label}) renders no message, so the control is neither marked nor described`, async () => {
      const html = await render(wired(error));

      expect(slotsOf(html)).toEqual(["field", "field-label", "input"]);
      expect(attrsOf(html, INPUT)).toEqual({ ...CONTROL, id: "field-email", name: "email" });
      expect(referencedIds(html).filter((id) => !declaredIds(html).includes(id))).toEqual([]);
    });
  }

  const shown: ReadonlyArray<{ label: string; error: JSXNode }> = [
    { label: "text", error: "Required" },
    { label: "text padded with spaces", error: " Required " },
    { label: "an element", error: <span>Required</span> },
  ];

  for (const { label, error } of shown) {
    it(`a rendered error (${label}) marks the control invalid and describes it by the message's id`, async () => {
      const html = await render(wired(error));

      expect(attrsOf(html, INPUT)).toEqual({
        ...CONTROL,
        id: "field-email",
        name: "email",
        "aria-describedby": "field-email-error",
        "aria-invalid": "true",
      });
      expect(declaredIds(html)).toContain("field-email-error");
      expect(referencedIds(html).filter((id) => !declaredIds(html).includes(id))).toEqual([]);
    });
  }

  for (const { label, message } of MESSAGES) {
    it(`the control is invalid exactly when the error renders, for ${label}`, async () => {
      const renders = (await render(<FormField.Error name='email'>{message}</FormField.Error>)) !== "";
      const marked = attrOf(await render(<Input field={{ name: "email", error: message }} />), "aria-invalid", INPUT) === "true";

      expect(marked).toBe(renders);
    });
  }

  it("a stale descriptor carrying only invalid: true marks nothing", () => {
    const stale: FieldDescriptor = Object.assign({ name: "email" }, { invalid: true });

    expect(fieldControlProps({}, stale)).toStrictEqual({ id: "field-email", name: "email", disabled: undefined, "aria-invalid": undefined });
  });
});

describe("CheckboxGroup and RadioGroup — the fieldset marks and describes only an error that renders", () => {
  const checkboxes = (error: JSXNode) => (
    <CheckboxGroup name='opts' error={error}>
      <CheckboxGroup.Item name='opts' value='a'>
        A
      </CheckboxGroup.Item>
      <CheckboxGroup.Error name='opts'>{error}</CheckboxGroup.Error>
    </CheckboxGroup>
  );

  const radios = (error: JSXNode) => (
    <RadioGroup name='opts' error={error}>
      <RadioGroup.Item name='opts' value='a'>
        A
      </RadioGroup.Item>
      <RadioGroup.Error name='opts'>{error}</RadioGroup.Error>
    </RadioGroup>
  );

  const groups = [
    {
      group: "CheckboxGroup",
      wired: checkboxes,
      root: 'data-slot="checkbox-group"',
      slots: ["checkbox-group", "checkbox-group-item", "checkbox-group-input"],
    },
    { group: "RadioGroup", wired: radios, root: 'data-slot="radio-group"', slots: ["radio-group", "radio-group-item", "radio-group-input"] },
  ] as const;

  const blank: ReadonlyArray<{ label: string; error: JSXNode }> = [
    { label: "the empty string", error: "" },
    { label: "ASCII whitespace only", error: "  \n\t" },
    { label: "an empty array", error: [] },
    { label: "an array of null and a space", error: [null, " "] },
  ];

  const shown: ReadonlyArray<{ label: string; error: JSXNode }> = [
    { label: "text", error: "Pick one." },
    { label: "text padded with spaces", error: " Pick one " },
    { label: "an element", error: <span>Pick one.</span> },
  ];

  for (const { group, wired, root, slots } of groups) {
    for (const { label, error } of blank) {
      it(`${group} with a blank error (${label}) renders no message, so the fieldset is neither marked nor described`, async () => {
        const html = await render(wired(error));
        const attrs = attrsOf(html, root);

        expect(slotsOf(html)).toEqual([...slots]);
        expect(["aria-describedby" in attrs, "data-invalid" in attrs]).toEqual([false, false]);
        expect(referencedIds(html).filter((id) => !declaredIds(html).includes(id))).toEqual([]);
      });
    }

    for (const { label, error } of shown) {
      it(`${group} with a rendered error (${label}) marks the fieldset and describes it by the message's id`, async () => {
        const html = await render(wired(error));
        const attrs = attrsOf(html, root);

        expect([attrs["aria-describedby"], "data-invalid" in attrs]).toEqual(["field-opts-error", true]);
        expect(declaredIds(html)).toContain("field-opts-error");
        expect(referencedIds(html).filter((id) => !declaredIds(html).includes(id))).toEqual([]);
      });
    }

    for (const { label, message } of MESSAGES) {
      it(`${group} is marked and described exactly when the error renders, for ${label}`, async () => {
        const renders = (await render(<FieldError name='opts'>{message}</FieldError>)) !== "";
        const attrs = attrsOf(await render(wired(message)), root);

        expect(["data-invalid" in attrs, attrs["aria-describedby"] === "field-opts-error"]).toEqual([renders, renders]);
      });
    }
  }

  it("a stale root carrying only invalid: true marks and describes neither group", async () => {
    const stale = Object.assign({ name: "opts" }, { invalid: true });
    const checkboxAttrs = attrsOf(await render(<CheckboxGroup {...stale} />), 'data-slot="checkbox-group"');
    const radioAttrs = attrsOf(await render(<RadioGroup {...stale} />), 'data-slot="radio-group"');

    expect([checkboxAttrs, radioAttrs].map((attrs) => ["data-invalid" in attrs, "aria-describedby" in attrs])).toEqual([
      [false, false],
      [false, false],
    ]);
  });
});

describe("fieldDescribedBy — an existing id that forge also derives", () => {
  it("names the derived id once, where the caller put it", () => {
    expect(fieldDescribedBy("email", { existing: "field-email-description", description: true })).toBe("field-email-description");
  });
});
