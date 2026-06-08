import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Input } from "./input";

describe("Input", () => {
  it("renders an <input> element", async () => {
    const out = await render(<Input />);
    expect(out).toContain("<input");
    expect(out).toContain('data-slot="input"');
  });

  it("includes default styling classes", async () => {
    const out = await render(<Input />);
    expect(out).toContain("w-full");
    expect(out).toContain("rounded-lg");
    expect(out).toContain("border-input");
  });

  it("passes through id and name", async () => {
    const out = await render(<Input id='email' name='email' />);
    expect(out).toContain('id="email"');
    expect(out).toContain('name="email"');
  });

  it("passes through the type attribute", async () => {
    const out = await render(<Input type='email' />);
    expect(out).toContain('type="email"');
  });

  it("passes through the placeholder attribute", async () => {
    const out = await render(<Input placeholder='Enter email' />);
    expect(out).toContain('placeholder="Enter email"');
  });

  it("passes through the required attribute", async () => {
    const out = await render(<Input required />);
    expect(out).toContain("required");
  });

  it("passes through the disabled attribute", async () => {
    const withDisabled = await render(<Input disabled />);
    const withoutDisabled = await render(<Input />);
    expect(withDisabled).toMatch(/\bdisabled(?!:)/);
    expect(withoutDisabled).not.toMatch(/\bdisabled(?!:)/);
  });

  it("passes through aria-describedby", async () => {
    const out = await render(<Input aria-describedby='help-text' />);
    expect(out).toContain('aria-describedby="help-text"');
  });

  it("passes through aria-invalid", async () => {
    const out = await render(<Input aria-invalid='true' />);
    expect(out).toContain('aria-invalid="true"');
  });

  it("merges a custom class with the default classes", async () => {
    const out = await render(<Input class='my-input' />);
    expect(out).toContain("my-input");
    expect(out).toContain("w-full");
  });
});
