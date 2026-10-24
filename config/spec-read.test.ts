import { describe, expect, it } from "bun:test";

import { readSpecReferences } from "./spec-read";

const FILE = "src/ui/client/menu.browser.ts";

const read = (...lines: string[]): ReturnType<typeof readSpecReferences> => readSpecReferences(lines.join("\n"), FILE);

const refusal = (...lines: string[]): string => {
  try {
    read(...lines);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "read without refusal";
};

describe("readSpecReferences() — what it reads", () => {
  it("reads an `expose` map written inline, across lines, with string keys and both quotes", () => {
    expect(
      read(
        'import { mount, test } from "./browser.fixture";',
        "await mount(page, html, {",
        "  expose: {",
        '    forgeMenu: "./ui/client/menu",',
        "    \"forge-sheet\": './ui/client/sheet.ts',",
        "  },",
        '  css: ["./ui/assets/css/forge-ui.css"],',
        "});",
      ).specifiers,
    ).toEqual(["./ui/client/menu", "./ui/client/sheet.ts"]);
  });

  it("reads a local const whose literal it reads in turn — as the options, the map, a spread, a property or a value", () => {
    expect(
      read(
        'const MENU = "./ui/client/menu";',
        "const MAP = { forgeMenu: MENU, forgeDom: `./ui/client/dom` } as const;",
        "const EXPOSE = { expose: MAP };",
        'const MORE = { expose: { ...EXPOSE.expose, forgeHtmx: "./ui/client/htmx" } };',
        "const OPTIONS = { ...MORE, css: [] } satisfies object;",
        "await mount(page, html, OPTIONS);",
        "await mount(page, html, { expose: EXPOSE.expose });",
        "await bundleModules(MAP);",
        'await bundleModules({ forgeSignal: "./ui/client/signal", ...MAP });',
      ).specifiers,
    ).toEqual([
      "./ui/client/menu",
      "./ui/client/dom",
      "./ui/client/htmx",
      "./ui/client/menu",
      "./ui/client/dom",
      "./ui/client/menu",
      "./ui/client/dom",
      "./ui/client/signal",
      "./ui/client/menu",
      "./ui/client/dom",
    ]);
  });

  it("reads a local map handed over through the `expose` shorthand", () => {
    expect(read('const expose = { forgeMenu: "./ui/client/menu" };', "await mount(page, html, { expose });").specifiers).toEqual([
      "./ui/client/menu",
    ]);
  });

  it("reads a map named through a local const as its contents, never as nothing", () => {
    expect(
      read('const M = { forgeMenu: "./ui/client/menu" };', "await mount(page, html, { expose: M });", "await bundleModules(M);").specifiers,
    ).toEqual(["./ui/client/menu", "./ui/client/menu"]);
  });

  it("reads a `mount` with no options as exposing nothing", () => {
    expect(read("await mount(page, html);", "await mount(page, await render(x));").specifiers).toEqual([]);
  });

  it("reads every `new URL(…, import.meta.url)` path, a template or a local const included, and passes over a URL with another base", () => {
    expect(
      read(
        'const CONFIG = new URL("../fixtures/app/wrangler.jsonc", import.meta.url).pathname;',
        "const CSS = fileURLToPath(new URL(`../assets/css/forge-ui.css`, import.meta.url));",
        'const SCHEMA = "../../src/auth/schema.sql";',
        "const DDL = new URL(SCHEMA, import.meta.url);",
        "const host = new URL(origin).hostname;",
        'const page = new URL("/next", "https://forge.test/");',
      ).urls,
    ).toEqual(["../fixtures/app/wrangler.jsonc", "../assets/css/forge-ui.css", "../../src/auth/schema.sql"]);
  });

  it("ignores the names in comments, strings, templates, regular expressions and object keys", () => {
    expect(
      read(
        "// mount(page, html, options) — a comment is not a call",
        "/* bundleModules(map) */",
        'const title = "survives the navigation mount(performs)";',
        "const note = `the ${'mount'} inside a template, and import.meta.url`;",
        'const pattern = /mount\\("|bundleModules/;',
        'const shell = render({ mount: "probe", page: "next" });',
      ),
    ).toEqual({ specifiers: [], urls: [] });
  });
});

describe("readSpecReferences() — what it refuses rather than reads as nothing", () => {
  it("refuses a value that is not a string literal, naming the file and line", () => {
    expect(refusal("", "await mount(page, html, { expose: { forgeMenu: specifier } });")).toStartWith(`${FILE}:2: `);
  });

  it("refuses the `expose` shorthand when no local const backs it", () => {
    expect(refusal("async function open(expose) {", "  await mount(page, html, { expose });", "}")).toStartWith(`${FILE}:2: `);
  });

  it("refuses options, a map or a spread built in another file", () => {
    expect(refusal('import { OPTIONS } from "./shared";', "await mount(page, html, OPTIONS);")).toContain(
      "`OPTIONS`, which is not one local const,",
    );
    expect(refusal('import { MAP } from "./shared";', "await bundleModules(MAP);")).toContain("`MAP`");
    expect(refusal('import { MAP } from "./shared";', "await mount(page, html, { expose: { ...MAP } });")).toContain("`MAP`");
    expect(refusal('import { BASE } from "./shared";', "await mount(page, html, { ...BASE });")).toContain("`BASE`");
  });

  it("refuses options that are a parameter, a call, or a name declared twice", () => {
    expect(refusal("async function open(options) {", "  await mount(page, html, options);", "}")).toContain("`options`");
    expect(refusal("await mount(page, html, options());")).toContain("`options` followed by more than property reads");
    expect(refusal('const M = { a: "./a" };', "{", '  const M = { b: "./b" };', "}", "await bundleModules(M);")).toContain(
      "`M`, which is not one local const,",
    );
  });

  it("refuses a template with a substitution, a computed `expose` key and a method named `expose`", () => {
    expect(refusal("await bundleModules({ forgeMenu: `./ui/client/${name}` });")).toContain("cannot be read whole");
    expect(refusal('await mount(page, html, { ["expose"]: { a: "./a" } });')).toContain("a computed or method member");
    expect(refusal('await mount(page, html, { expose() { return { a: "./a" }; } });')).toContain("a computed or method member");
  });

  it("refuses a `new URL` path that is a parameter, a call or a template with a substitution", () => {
    expect(refusal("function at(path) {", "  return new URL(path, import.meta.url);", "}")).toStartWith(`${FILE}:2: `);
    expect(refusal("new URL(join(a, b), import.meta.url);")).toContain("cannot be read whole");
    expect(refusal("new URL(`../${dir}/wrangler.jsonc`, import.meta.url);")).toContain("cannot be read whole");
  });

  it("refuses `import.meta.url` anywhere but the base of a `new URL` it reads", () => {
    expect(refusal("const here = fileURLToPath(import.meta.url);")).toContain("`import.meta.url` used other than");
  });

  it("refuses `mount` or `bundleModules` passed on, renamed or reached as an unread member", () => {
    expect(refusal("const open = mount;")).toContain("`mount` used other than as a call");
    expect(refusal('import { mount as open } from "./browser.fixture";')).toContain("imported under another name");
    expect(refusal("const helpers = { bundleModules };")).toContain("`bundleModules` used other than as a call");
    expect(refusal('import * as fixture from "./browser.fixture";', "const open = fixture.mount;")).toContain("`.mount` used other than as a call");
  });

  it("refuses a spread argument, whose options cannot be told apart", () => {
    expect(refusal("await mount(...args);")).toContain("a spread argument");
  });
});
