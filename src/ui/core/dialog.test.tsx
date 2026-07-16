/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Dialog } from "./dialog";

describe("Dialog", () => {
  it("renders a <dialog> with the given id and data-slot=dialog", async () => {
    const out = await render(<Dialog id='confirm'>Body</Dialog>);
    expect(out).toContain("<dialog");
    expect(out).toContain('id="confirm"');
    expect(out).toContain('data-slot="dialog"');
    expect(out).toContain("Body");
  });

  it("merges a custom class", async () => {
    const out = await render(
      <Dialog id='confirm' class='w-96'>
        Body
      </Dialog>,
    );
    expect(out).toContain("w-96");
    expect(out).toContain("bg-popover");
  });
});

describe("Dialog.Trigger", () => {
  it("renders a <button> invoker with command=show-modal targeting the dialog", async () => {
    const out = await render(<Dialog.Trigger for='confirm'>Open</Dialog.Trigger>);
    expect(out).toContain("<button");
    expect(out).toContain('type="button"');
    expect(out).toContain('data-slot="dialog-trigger"');
    expect(out).toContain('command="show-modal"');
    expect(out).toContain('commandfor="confirm"');
    expect(out).toContain("Open");
  });
});

describe("Dialog.Close", () => {
  it("emits command=close by default", async () => {
    const out = await render(<Dialog.Close for='confirm'>Cancel</Dialog.Close>);
    expect(out).toContain('data-slot="dialog-close"');
    expect(out).toContain('command="close"');
    expect(out).toContain('commandfor="confirm"');
    expect(out).toContain("Cancel");
  });

  it("emits command=request-close when request is set", async () => {
    const out = await render(
      <Dialog.Close for='confirm' request>
        Cancel
      </Dialog.Close>,
    );
    expect(out).toContain('command="request-close"');
  });

  it("merges a custom class", async () => {
    const out = await render(
      <Dialog.Close for='confirm' class='text-sm'>
        Cancel
      </Dialog.Close>,
    );
    expect(out).toContain("text-sm");
  });
});

describe("Dialog composition", () => {
  it("renders trigger + dialog + close linked by a shared id", async () => {
    const out = await render(
      <>
        <Dialog.Trigger for='confirm'>Delete…</Dialog.Trigger>
        <Dialog id='confirm'>
          <p>Are you sure?</p>
          <Dialog.Close for='confirm'>Cancel</Dialog.Close>
        </Dialog>
      </>,
    );
    expect(out).toContain('command="show-modal"');
    expect(out).toContain('command="close"');
    expect(out).toContain('id="confirm"');
    expect(out).toContain("Are you sure?");
  });
});
