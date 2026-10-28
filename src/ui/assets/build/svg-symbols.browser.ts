import { expect, test } from "@playwright/test";

import { mount } from "../../client/browser.fixture";
import { svgToSymbol } from "./svg-symbols";

const SVG_NS = "http://www.w3.org/2000/svg";

/** The symbols joined into one document, in the shape the asset pipeline writes a sprite. */
function buildSprite(icons: Record<string, string>): string {
  const symbols = Object.entries(icons).flatMap(([key, content]) => svgToSymbol(content, key, "icon-")?.symbol ?? []);
  return `<svg xmlns="${SVG_NS}" style="display:none">\n${symbols.join("\n")}\n</svg>`;
}

function gradientIcon(colour: string): string {
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 2 2"><linearGradient id="g"><stop offset="0" stop-color="${colour}"/><stop offset="1" stop-color="${colour}"/></linearGradient><rect width="2" height="2" fill="url(#g)"/></svg>`;
}

test("a sprite built from awkward icons parses as XML", { tag: "@cross-engine" }, async ({ page }) => {
  const sprite = buildSprite({
    nested: `<svg viewBox="0 0 24 24"><svg viewBox="0 0 8 8"></svg><path id="tail" d="M1 1h4"/></svg>`,
    quoted: `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor'><path d="M1 1h4"/></svg>`,
    red: gradientIcon("red"),
    lime: gradientIcon("lime"),
  });
  await mount(page, "<main></main>");
  const failure = await page.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    return doc.getElementsByTagName("parsererror")[0]?.textContent ?? null;
  }, sprite);
  expect(failure).toBeNull();
});

test("two icons sharing a gradient id each paint their own colour", { tag: "@cross-engine" }, async ({ page }) => {
  const symbols = buildSprite({ red: gradientIcon("red"), lime: gradientIcon("lime") }).replace(' style="display:none"', "");
  const scene = symbols.replace(
    "\n</svg>",
    `<use href="#icon-red" x="0" y="0" width="20" height="20"/><use href="#icon-lime" x="20" y="0" width="20" height="20"/></svg>`,
  );
  const standalone = scene.replace("<svg ", '<svg width="40" height="20" ');
  await mount(page, '<canvas width="40" height="20"></canvas>');
  const pixels = await page.evaluate(async (markup) => {
    const image = new Image();
    image.src = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
    await image.decode();
    const canvas = document.querySelector("canvas");
    const context = canvas?.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(image, 0, 0);
    return [Array.from(context.getImageData(10, 10, 1, 1).data), Array.from(context.getImageData(30, 10, 1, 1).data)];
  }, standalone);
  expect(pixels).toEqual([
    [255, 0, 0, 255],
    [0, 255, 0, 255],
  ]);
});
