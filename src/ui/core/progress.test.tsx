import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Progress } from "./progress";

describe("Progress", () => {
  it("renders a <progress> element with data-slot=progress", async () => {
    expect(await render(<Progress />)).toBe(
      '<progress data-slot="progress" data-orientation="horizontal" class="h-2 w-full rounded-full"></progress>',
    );
  });

  it("renders value and max attributes", async () => {
    expect(await render(<Progress value={50} max={100} />)).toBe(
      '<progress data-slot="progress" data-orientation="horizontal" class="h-2 w-full rounded-full" value="50" max="100"></progress>',
    );
  });

  it("renders aria-label from the label convenience prop", async () => {
    expect(await render(<Progress label='Upload progress' />)).toBe(
      '<progress data-slot="progress" data-orientation="horizontal" aria-label="Upload progress" class="h-2 w-full rounded-full"></progress>',
    );
  });

  it("renders aria-label directly when provided", async () => {
    expect(await render(<Progress aria-label='Direct label' />)).toBe(
      '<progress data-slot="progress" data-orientation="horizontal" aria-label="Direct label" class="h-2 w-full rounded-full"></progress>',
    );
  });

  it("prefers explicit aria-label over label prop", async () => {
    expect(await render(<Progress aria-label='Explicit' label='Ignored' />)).toBe(
      '<progress data-slot="progress" data-orientation="horizontal" aria-label="Explicit" class="h-2 w-full rounded-full"></progress>',
    );
  });

  it("includes base styling classes", async () => {
    expect(await render(<Progress />)).toBe(
      '<progress data-slot="progress" data-orientation="horizontal" class="h-2 w-full rounded-full"></progress>',
    );
  });

  it("merges a custom class", async () => {
    expect(await render(<Progress class='my-progress' />)).toBe(
      '<progress data-slot="progress" data-orientation="horizontal" class="h-2 w-full rounded-full my-progress"></progress>',
    );
  });

  it("defaults to horizontal orientation with data-orientation and h-2 w-full", async () => {
    expect(await render(<Progress />)).toBe(
      '<progress data-slot="progress" data-orientation="horizontal" class="h-2 w-full rounded-full"></progress>',
    );
  });

  it("vertical orientation stamps data-orientation and flips to w-2 h-full", async () => {
    expect(await render(<Progress orientation='vertical' />)).toBe(
      '<progress data-slot="progress" data-orientation="vertical" class="w-2 h-full rounded-full"></progress>',
    );
  });
});
