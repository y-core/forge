import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { FieldDescription, FieldError, FieldLabel, fieldControlProps, fieldDescribedBy, fieldDescriptionId, fieldErrorId, fieldId } from "./field";
import { FormField } from "./field-layout";
import { Field } from "./field-stack";
import { Input } from "./input";

const ROOT = 'data-slot="field"';
const LABEL = 'data-slot="field-label"';
const DESCRIPTION = 'data-slot="field-description"';
const INPUT = 'data-slot="input"';

const CONTROL = { "data-slot": "input", "data-size": "md" };

function slotsOf(html: string): string[] {
  return [...html.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1] ?? "");
}

function contentOf(html: string, tag: string): string {
  return new RegExp(`<${tag}[^>]*>(.*)</${tag}>`).exec(html)?.[1] ?? "";
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

describe("Field primitives", () => {
  it("renders the whole field element exactly, its own class entities and a forwarded value escaped", async () => {
    expect(await render(<FormField name='email' data-note={`R&D's <x>`} />)).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-destructive-text' +
        ' flex-col [&amp;&gt;*]:w-full" data-note="R&amp;D&#39;s &lt;x&gt;"></fieldset>',
    );
  });

  it("wires Field.Label to the control id via explicit name prop", async () => {
    const html = await render(
      <FormField name='email'>
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
      <FormField name='email' invalid>
        <FormField.Label name='email'>Email</FormField.Label>
        <FormField.Content>
          <Input field={{ name: "email", invalid: true }} />
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
      <FormField name='message' invalid>
        <FormField.Label name='message'>Message</FormField.Label>
        <FormField.Content>
          <Input field={{ name: "message", invalid: true, description: true }} />
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
      <FormField name='name' disabled>
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
      <FormField name='name' invalid>
        <FormField.Label name='name'>Name</FormField.Label>
        <FormField.Content>
          <Input id='custom-id' aria-describedby='custom-help' aria-invalid='false' field={{ name: "name", invalid: true }} />
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
        <FormField name='name'>
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
    expect(contentOf(html, "legend")).toBe("Contact details");
  });

  it("renders Field.Title and Field.Separator with explicit slots, the separator carrying its own content", async () => {
    const html = await render(
      <FormField.Group>
        <FormField name='name'>
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
    expect(contentOf(html, "span")).toBe("or");
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
      <FormField name='email'>
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
    expect(attrsOf(await render(<Input field={{ name: "email", invalid: true }} />))).toEqual({
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

    const refs = referencedIds(html);
    expect(refs).toEqual(["field-email", "field-email-description", "field-email-error"]);
    const declared = declaredIds(html);
    expect(refs.filter((id) => id === "" || !declared.includes(id))).toEqual([]);
    expect(declared).toEqual(["field-email", "field-email-description", "field-email-error"]);
  });
});

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
    expect(fieldControlProps({}, { name: "", description: true, invalid: true })).toStrictEqual({
      name: "",
      disabled: undefined,
      "aria-invalid": true,
    });
  });

  it("a whitespace-only name is the same no-name as the empty string", () => {
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
    expect(attrsOf(await render(<Input field={{ name: "", description: true, invalid: true }} />))).toEqual({
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
    ]).toEqual([{ "data-slot": "field-label" }, { "data-slot": "field-description" }, { "data-slot": "field-error", role: "alert" }]);
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
    expect(fieldControlProps({}, { name: "first name", description: true, invalid: true })).toStrictEqual({
      name: "first name",
      disabled: undefined,
      "aria-invalid": true,
    });
  });

  it("every other ASCII whitespace character suppresses derivation exactly as a space does", () => {
    const derived = ASCII_WS_CHARS.map(([label, ws]) => [label, fieldControlProps({}, { name: `a${ws}b`, description: true, invalid: true })]);

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
    ]).toEqual([{ "data-slot": "field-label" }, { "data-slot": "field-description" }, { "data-slot": "field-error", role: "alert" }]);
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
    expect(attrsOf(await render(<FormField name='email' />))).toEqual({ "data-slot": "field", "data-orientation": "vertical" });
  });

  it("orientation='horizontal' stamps the horizontal axis and swaps the column layout for a row", async () => {
    const html = await render(<FormField name='email' orientation='horizontal' />);

    expect(attrsOf(html)).toEqual({ "data-slot": "field", "data-orientation": "horizontal" });
    expect(variantClasses(html, await render(<FormField name='email' />))).toEqual({
      added: ["flex-row", "items-start", "[&amp;&gt;[data-slot~=field-content]]:flex-1", "[&amp;&gt;[data-slot~=field-label]]:flex-auto"],
      dropped: ["flex-col", "[&amp;&gt;*]:w-full"],
    });
  });

  it("responsive stamps data-responsive and layers the container-query row on the vertical layout", async () => {
    const html = await render(<FormField name='email' responsive />);

    expect(attrsOf(html)).toEqual({ "data-slot": "field", "data-responsive": "", "data-orientation": "vertical" });
    expect(variantClasses(html, await render(<FormField name='email' />))).toEqual({
      added: [
        "@md/field-group:flex-row",
        "@md/field-group:items-start",
        "@md/field-group:[&amp;&gt;*]:w-auto",
        "@md/field-group:[&amp;&gt;[data-slot~=field-content]]:flex-1",
        "@md/field-group:[&amp;&gt;[data-slot~=field-label]]:flex-auto",
      ],
      dropped: [],
    });
  });
});
