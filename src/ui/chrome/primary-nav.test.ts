import { describe, expect, it } from "bun:test";

import { createPrimaryNav, resolveNavState } from "./primary-nav";
import type { NavbarProps, NavContribution, NavState, NavStateResolver } from "./types";

type Key = "home" | "notebooks" | "account";
type Ctx = { user: string | null };
type State = { signedIn: boolean };

const HOME = { label: "Home", href: "home" } as const;
const NOTEBOOKS = { label: "Notebooks", href: "notebooks" } as const;
const ACCOUNT_MENU = { key: "account", label: "Account", items: [{ label: "Settings", href: "account" as const }] };
const ACCOUNT_BAR = { label: "Account", items: [{ label: "Settings", href: "account" }] };

const EMPTY_BAR = { sections: [{ items: [] }] };

describe("createPrimaryNav", () => {
  it("renders the bar in array order", () => {
    const home: NavContribution<"home", Ctx, State> = { items: [HOME], hrefs: { home: "/" } };
    const rest: NavContribution<"notebooks" | "account", Ctx, State> = {
      items: [NOTEBOOKS, ACCOUNT_MENU],
      hrefs: { notebooks: "/n", account: "/a" },
    };

    expect(createPrimaryNav<Key, Ctx, State>([home, rest]).definition()).toEqual({ sections: [{ items: [HOME, NOTEBOOKS, ACCOUNT_BAR] }] });
    expect(createPrimaryNav<Key, Ctx, State>([rest, home]).definition()).toEqual({ sections: [{ items: [NOTEBOOKS, ACCOUNT_BAR, HOME] }] });
  });

  it("renders an empty bar from no contributions", () => {
    expect(createPrimaryNav<Key, Ctx, State>([]).definition()).toEqual(EMPTY_BAR);
  });

  it("returns a frozen result: the nav, its definition, each section and its items, and its states", () => {
    const nav = createPrimaryNav<Key, Ctx, State>([{ items: [HOME], hrefs: { home: "/" }, state: async () => ({ signedIn: true }) }]);
    const definition = nav.definition();
    expect([nav, definition, definition.sections, definition.sections[0], definition.sections[0]?.items, nav.states()].every(Object.isFrozen)).toBe(
      true,
    );
    expect(nav.definition()).toBe(definition);
    // @ts-expect-error -- a section's items are readonly
    expect(() => definition.sections[0]?.items.push(NOTEBOOKS)).toThrow(TypeError);
    expect(nav.definition()).toEqual({ sections: [{ items: [HOME] }] });
  });

  describe("an hrefs key two contributions share", () => {
    it("throws, naming the key", () => {
      expect(() =>
        createPrimaryNav<Key, Ctx, State>([
          { items: [HOME], hrefs: { home: "/" } },
          { items: [], hrefs: { home: "/home" } },
        ]),
      ).toThrow('createPrimaryNav: the key "home" is already contributed.');
    });

    it("names the first shared key when a later contribution repeats several", () => {
      expect(() =>
        createPrimaryNav<Key, Ctx, State>([
          { items: [], hrefs: { home: "/", notebooks: "/n" } },
          { items: [], hrefs: { account: "/a", notebooks: "/other", home: "/other" } },
        ]),
      ).toThrow('createPrimaryNav: the key "notebooks" is already contributed.');
    });

    it("is not raised by distinct keys", () => {
      const nav = createPrimaryNav<Key, Ctx, State>([
        { items: [HOME], hrefs: { home: "/" } },
        { items: [NOTEBOOKS], hrefs: { notebooks: "/n" } },
      ]);
      expect([nav.resolveHref("home"), nav.resolveHref("notebooks")]).toEqual(["/", "/n"]);
    });
  });

  describe("the toggle's name", () => {
    const refusals: { name: string; label: string; items: NavContribution<"home", Ctx, State>["items"] }[] = [
      { name: "a top-level link", label: "Menu", items: [{ label: "Menu", href: "home" }] },
      { name: "a padded, lower-case link", label: " menu ", items: [{ label: " menu ", href: "home" }] },
      { name: "a link inside a menu", label: "Menu", items: [{ key: "more", label: "More", items: [{ label: "Menu", href: "home" }] }] },
      {
        name: "a link two menus deep",
        label: "Menu",
        items: [{ key: "more", label: "More", items: [{ label: "Deeper", items: [{ label: "Menu", href: "home" }] }] }],
      },
      { name: "the label of a menu itself", label: "Menu", items: [{ key: "menu", label: "Menu", items: [{ label: "Home", href: "home" }] }] },
      { name: "a link inside a group", label: "Menu", items: [{ heading: "Site", group: [{ label: "Menu", href: "home" }] }] },
      {
        name: "a link inside a megamenu column",
        label: "Menu",
        items: [{ key: "more", label: "More", groups: [{ heading: "Site", group: [{ label: "Menu", href: "home" }] }] }],
      },
      { name: "a slot", label: "MENU", items: [{ slot: "search", label: "MENU" }] },
    ];

    for (const { name, label, items } of refusals) {
      it(`is refused on ${name}`, () => {
        expect(() => createPrimaryNav<Key, Ctx, State>([{ items: [HOME, ...items], hrefs: { home: "/" } }])).toThrow(
          `may not be labelled "${label}"`,
        );
      });
    }

    const acceptances: { name: string; items: NavContribution<"home", Ctx, State>["items"] }[] = [
      { name: "a label that only starts with it", items: [{ label: "Menus", href: "home" }] },
      { name: "a label that only ends with it", items: [{ label: "Main menu", href: "home" }] },
      { name: "a group heading, which names no control", items: [{ heading: "Menu", group: [{ label: "Home", href: "home" }] }] },
    ];

    for (const { name, items } of acceptances) {
      it(`is not refused on ${name}`, () => {
        expect(createPrimaryNav<Key, Ctx, State>([{ items, hrefs: { home: "/" } }]).definition()).toEqual({ sections: [{ items }] });
      });
    }
  });

  describe("a link whose key no contribution gives an href", () => {
    it("throws when built, naming the link and the key", () => {
      expect(() =>
        createPrimaryNav<"home" | "billing", Ctx, State>([
          {
            items: [
              { label: "Home", href: "home" },
              { label: "Billing", href: "billing" },
            ],
            hrefs: { home: "/" },
          },
        ]),
      ).toThrow('createPrimaryNav: the link "Billing" names the key "billing", which no contribution gives an href.');
    });

    it("throws for a link inside a nested submenu", () => {
      expect(() =>
        createPrimaryNav<Key, Ctx, State>([
          {
            items: [HOME, { key: "more", label: "More", items: [{ label: "Deeper", items: [{ label: "Settings", href: "account" }] }] }],
            hrefs: { home: "/" },
          },
        ]),
      ).toThrow('createPrimaryNav: the link "Settings" names the key "account", which no contribution gives an href.');
    });

    it("throws for a link inside a megamenu column", () => {
      expect(() =>
        createPrimaryNav<Key, Ctx, State>([
          {
            items: [{ key: "more", label: "More", groups: [{ heading: "Site", group: [{ label: "Notes", href: "notebooks" }] }] }],
            hrefs: { home: "/" },
          },
        ]),
      ).toThrow('createPrimaryNav: the link "Notes" names the key "notebooks", which no contribution gives an href.');
    });

    it("throws for a footer link", () => {
      expect(() =>
        createPrimaryNav<Key, Ctx, State>([{ items: [HOME], hrefs: { home: "/" }, footer: [{ label: "Your account", href: "account" }] }]),
      ).toThrow('createPrimaryNav: the link "Your account" names the key "account", which no contribution gives an href.');
    });

    it("is not raised when another contribution gives the href", () => {
      const nav = createPrimaryNav<Key, Ctx, State>([
        {
          items: [HOME, { key: "more", label: "More", items: [{ label: "Settings", href: "account" }] }],
          hrefs: { home: "/" },
          footer: [{ label: "Notes", href: "notebooks" }],
        },
        { items: [], hrefs: { account: "/a", notebooks: "/n" } },
      ]);
      expect(nav.footer()).toEqual([{ label: "Notes", href: "/n" }]);
      expect(nav.resolveHref("account")).toBe("/a");
    });
  });

  describe("resolveHref", () => {
    it("returns the URL a contribution gave its key", () => {
      const nav = createPrimaryNav<Key, Ctx, State>([{ items: [HOME, NOTEBOOKS], hrefs: { home: "/", notebooks: "/notebooks?view=grid" } }]);
      expect(nav.resolveHref("notebooks")).toBe("/notebooks?view=grid");
    });

    it("throws on a key nobody contributed rather than falling back to home", () => {
      const nav = createPrimaryNav<Key, Ctx, State>([{ items: [HOME], hrefs: { home: "/" } }]);
      expect(() => nav.resolveHref("nowhere")).toThrow(/no href is contributed for the key "nowhere"/);
    });

    it("throws on an empty key", () => {
      const nav = createPrimaryNav<Key, Ctx, State>([{ items: [HOME], hrefs: { home: "/" } }]);
      expect(() => nav.resolveHref("")).toThrow(/no href is contributed for the key ""/);
    });
  });

  describe("footer", () => {
    it("resolves every contribution's footer links to URLs in array order", () => {
      const nav = createPrimaryNav<Key, Ctx, State>([
        { items: [HOME], hrefs: { home: "/" }, footer: [{ label: "About", href: "home" }] },
        { items: [NOTEBOOKS], hrefs: { notebooks: "/n" } },
        { items: [], hrefs: { account: "/a" }, footer: [{ label: "Your account", href: "account" }] },
      ]);
      expect(nav.footer()).toEqual([
        { label: "About", href: "/" },
        { label: "Your account", href: "/a" },
      ]);
    });

    it("keeps the links a contribution gave when the caller changes its own footer objects", () => {
      const about: { label: string; href: "home" | "account" } = { label: "About", href: "home" };
      const nav = createPrimaryNav<"home" | "account", Ctx, State>([{ items: [], hrefs: { home: "/", account: "/a" }, footer: [about] }]);
      about.label = "Changed";
      about.href = "account";
      expect(nav.footer()).toEqual([{ label: "About", href: "/" }]);
    });

    it("is empty when no contribution brings footer links", () => {
      expect(createPrimaryNav<Key, Ctx, State>([{ items: [HOME], hrefs: { home: "/" } }]).footer()).toEqual([]);
    });
  });

  describe("states", () => {
    it("holds each contribution's resolver in array order and skips a contribution without one", async () => {
      const signedIn: NavStateResolver<Ctx, State> = async (c) => ({ signedIn: c.user !== null });
      const always: NavStateResolver<Ctx, State> = async () => ({ signedIn: true });
      const nav = createPrimaryNav<Key, Ctx, State>([
        { items: [HOME], hrefs: { home: "/" }, state: signedIn },
        { items: [NOTEBOOKS], hrefs: { notebooks: "/n" } },
        { items: [], hrefs: { account: "/a" }, state: always },
      ]);

      const states = nav.states();
      expect(states).toHaveLength(2);
      expect(states[0]).toBe(signedIn);
      expect(states[1]).toBe(always);
      expect(await states[0]?.({ user: "ada" })).toEqual({ signedIn: true });
      expect(await states[0]?.({ user: null })).toEqual({ signedIn: false });
    });

    it("hands out a list a caller cannot add a resolver to", () => {
      const nav = createPrimaryNav<Key, Ctx, State>([{ items: [HOME], hrefs: { home: "/" }, state: async () => ({ signedIn: true }) }]);
      expect(() => (nav.states() as NavStateResolver<Ctx, State>[]).push(async () => ({ signedIn: false }))).toThrow(TypeError);
      expect(nav.states()).toHaveLength(1);
    });
  });

  it("fits Navbar's config and resolveHref props, with resolveHref detached from the nav", () => {
    const nav = createPrimaryNav<Key, Ctx, State>([{ items: [HOME], hrefs: { home: "/" } }]);
    const props: Pick<NavbarProps, "config" | "resolveHref"> = { config: nav.definition(), resolveHref: nav.resolveHref };
    expect(props.config).toEqual({ sections: [{ items: [HOME] }] });
    expect(props.resolveHref("home")).toBe("/");
  });

  describe("at compile time", () => {
    it("refuses, in a slice's own contribution, a misspelled key", () => {
      // @ts-expect-error -- "notebok" is not a key of this contribution's hrefs
      const slice: NavContribution<"notebooks", Ctx, State> = { items: [{ label: "N", href: "notebok" }], hrefs: { notebooks: "/n" } };
      expect(() => createPrimaryNav<Key, Ctx, State>([slice])).toThrow('the link "N" names the key "notebok"');
    });

    it("refuses an hrefs key outside the app's key set", () => {
      // @ts-expect-error -- "notebok" is not one of the app's keys
      expect(createPrimaryNav<Key, Ctx, State>([{ items: [], hrefs: { notebok: "/n" } }]).definition()).toEqual(EMPTY_BAR);
    });

    it("refuses a slice whose keys are not the app's", () => {
      const slice: NavContribution<"elsewhere", Ctx, State> = { items: [], hrefs: { elsewhere: "/e" } };
      // @ts-expect-error -- "elsewhere" is not one of the app's keys
      expect(createPrimaryNav<Key, Ctx, State>([slice]).resolveHref("elsewhere")).toBe("/e");
    });

    it("refuses, in a slice's own contribution, a misspelled footer key", () => {
      // @ts-expect-error -- "hme" is not a key of this contribution's hrefs
      const slice: NavContribution<"home", Ctx, State> = { items: [], hrefs: { home: "/" }, footer: [{ label: "H", href: "hme" }] };
      expect(() => createPrimaryNav<Key, Ctx, State>([slice])).toThrow('the link "H" names the key "hme"');
    });

    it("refuses, in a slice's own contribution, a misspelled key inside a nested menu", () => {
      const slice: NavContribution<"account", Ctx, State> = {
        // @ts-expect-error -- "acount" is not a key of this contribution's hrefs
        items: [{ key: "more", label: "More", items: [{ label: "A", href: "acount" }] }],
        hrefs: { account: "/a" },
      };
      expect(() => createPrimaryNav<Key, Ctx, State>([slice])).toThrow('the link "A" names the key "acount"');
    });

    it("refuses, in a slice's own contribution, an app key its hrefs do not carry", () => {
      // @ts-expect-error -- "account" is an app key, but this contribution gives it no URL
      const slice: NavContribution<"notebooks", Ctx, State> = { items: [{ label: "A", href: "account" }], hrefs: { notebooks: "/n" } };
      expect(() => createPrimaryNav<Key, Ctx, State>([slice])).toThrow('the link "A" names the key "account"');
    });

    it("refuses a bar-level menu without a key, and asks none of a nested menu", () => {
      // @ts-expect-error -- a bar-level menu carries the key it merges by
      const keyless: NavContribution<"home", Ctx, State> = { items: [{ label: "More", items: [HOME] }], hrefs: { home: "/" } };
      const nested: NavContribution<"home", Ctx, State> = {
        items: [{ key: "more", label: "More", items: [{ label: "Deeper", items: [HOME] }] }],
        hrefs: { home: "/" },
      };
      expect([keyless, nested]).toHaveLength(2);
    });

    it("refuses a state resolver of the wrong shape", () => {
      const wrong = { items: [], hrefs: { home: "/" }, state: async () => ({ signedIn: "yes" }) };
      // @ts-expect-error -- signedIn is a boolean, not a string
      expect(createPrimaryNav<Key, Ctx, State>([wrong]).states()).toHaveLength(1);
    });

    it("accepts a flat contribution declared as const", () => {
      const flat = { items: [HOME, NOTEBOOKS], hrefs: { home: "/", notebooks: "/n" } } as const;
      expect(createPrimaryNav<Key, Ctx, State>([flat]).definition()).toEqual({ sections: [{ items: [HOME, NOTEBOOKS] }] });
    });

    it("accepts a contribution declared as const that nests a menu", () => {
      const nested = { items: [{ key: "more", label: "More", items: [{ label: "A", href: "account" }] }], hrefs: { account: "/a" } } as const;
      expect(createPrimaryNav<Key, Ctx, State>([nested]).definition()).toEqual({
        sections: [{ items: [{ label: "More", items: [{ label: "A", href: "account" }] }] }],
      });
    });

    it("accepts a contribution declared as const that nests a group", () => {
      const grouped = { items: [{ heading: "Site", group: [{ label: "H", href: "home" }] }], hrefs: { home: "/" } } as const;
      expect(createPrimaryNav<Key, Ctx, State>([grouped]).definition()).toEqual({
        sections: [{ items: [{ heading: "Site", group: [{ label: "H", href: "home" }] }] }],
      });
    });
  });
});

describe("createPrimaryNav — merging menus by key", () => {
  type NavKey = "a" | "b" | "c" | "d";
  type Items = NavContribution<NavKey, Ctx, State>["items"];
  const A = { label: "A", href: "a" } as const;
  const B = { label: "B", href: "b" } as const;
  const C = { label: "C", href: "c" } as const;
  const D = { label: "D", href: "d" } as const;
  const HOME_D = { label: "Home", href: "d" } as const;
  const column = <L extends NavKey>(heading: string, link: { label: string; href: L }) => ({ heading, group: [link] });

  function barOf(...contributions: { items: Items; hrefs: Partial<Record<NavKey, string>> }[]) {
    return createPrimaryNav<NavKey, Ctx, State>(contributions).definition().sections[0]?.items;
  }

  it("renders two contributions' same-key menus as one menu, children in array order, at the first's position", () => {
    expect(
      barOf(
        { items: [{ key: "platform", label: "Platform", items: [A] }, HOME_D], hrefs: { a: "/a", d: "/d" } },
        { items: [{ key: "platform", label: "Platform", items: [B] }], hrefs: { b: "/b" } },
      ),
    ).toEqual([{ label: "Platform", items: [A, B] }, HOME_D]);
    expect(
      barOf(
        { items: [{ key: "platform", label: "Platform", items: [B] }], hrefs: { b: "/b" } },
        { items: [{ key: "platform", label: "Platform", items: [A] }, HOME_D], hrefs: { a: "/a", d: "/d" } },
      ),
    ).toEqual([{ label: "Platform", items: [B, A] }, HOME_D]);
  });

  it("merges two same-key menus inside one contribution", () => {
    expect(
      barOf({
        items: [{ key: "platform", label: "Platform", items: [A] }, HOME_D, { key: "platform", label: "Platform", items: [B] }],
        hrefs: { a: "/a", b: "/b", d: "/d" },
      }),
    ).toEqual([{ label: "Platform", items: [A, B] }, HOME_D]);
  });

  it("merges a third contribution into the menu two earlier ones already share", () => {
    expect(
      barOf(
        { items: [{ key: "platform", label: "Platform", items: [A] }], hrefs: { a: "/a" } },
        { items: [{ key: "platform", label: "Platform", items: [B] }], hrefs: { b: "/b" } },
        { items: [{ key: "platform", label: "Platform", items: [C] }], hrefs: { c: "/c" } },
      ),
    ).toEqual([{ label: "Platform", items: [A, B, C] }]);
  });

  it("merges same-key megamenus' columns in array order, keeping the first's align", () => {
    expect(
      barOf(
        { items: [{ key: "explore", label: "Explore", groups: [column("Build", A)], align: "end" }], hrefs: { a: "/a" } },
        { items: [{ key: "explore", label: "Explore", groups: [column("Run", B)] }], hrefs: { b: "/b" } },
        { items: [{ key: "explore", label: "Explore", groups: [column("Ship", C)], align: "end" }], hrefs: { c: "/c" } },
      ),
    ).toEqual([{ label: "Explore", groups: [column("Build", A), column("Run", B), column("Ship", C)], align: "end" }]);
  });

  it("keeps two menus apart when their keys differ, even under one label", () => {
    expect(
      barOf(
        { items: [{ key: "ui", label: "Platform", items: [A] }], hrefs: { a: "/a" } },
        { items: [{ key: "render", label: "Platform", items: [B] }], hrefs: { b: "/b" } },
      ),
    ).toEqual([
      { label: "Platform", items: [A] },
      { label: "Platform", items: [B] },
    ]);
  });

  it("appends a nested submenu's items rather than merging it with a same-label submenu", () => {
    expect(
      barOf(
        { items: [{ key: "platform", label: "Platform", items: [{ label: "Storage", items: [A] }] }], hrefs: { a: "/a" } },
        { items: [{ key: "platform", label: "Platform", items: [{ label: "Storage", items: [B] }] }], hrefs: { b: "/b" } },
      ),
    ).toEqual([
      {
        label: "Platform",
        items: [
          { label: "Storage", items: [A] },
          { label: "Storage", items: [B] },
        ],
      },
    ]);
  });

  it("keeps a group, a slot and a link that share a menu's label apart from the menu", () => {
    expect(
      barOf(
        { items: [{ key: "platform", label: "Platform", items: [A] }], hrefs: { a: "/a" } },
        {
          items: [
            { heading: "Platform", group: [B] },
            { slot: "search", label: "Platform" },
            { label: "Platform", href: "d" },
            { key: "platform", label: "Platform", items: [C] },
          ],
          hrefs: { b: "/b", c: "/c", d: "/d" },
        },
      ),
    ).toEqual([
      { label: "Platform", items: [A, C] },
      { heading: "Platform", group: [B] },
      { slot: "search", label: "Platform" },
      { label: "Platform", href: "d" },
    ]);
  });

  it("keeps two plain links that share a label as two links", () => {
    expect(
      barOf({ items: [{ label: "Docs", href: "a" }], hrefs: { a: "/a" } }, { items: [{ label: "Docs", href: "b" }], hrefs: { b: "/b" } }),
    ).toHaveLength(2);
  });

  it("leaves the merge key out of the definition", () => {
    const bar = barOf({
      items: [
        { key: "platform", label: "Platform", items: [A] },
        { key: "explore", label: "Explore", groups: [column("Build", B)] },
      ],
      hrefs: { a: "/a", b: "/b" },
    });
    expect(bar?.some((item) => "key" in item)).toBe(false);
  });

  describe("a label that differs under one key", () => {
    const cases: { name: string; first: string; later: string }[] = [
      { name: "another word", first: "Platform", later: "Products" },
      { name: "another case", first: "Platform", later: "platform" },
      { name: "padding", first: "Platform", later: " Platform " },
    ];

    for (const { name, first, later } of cases) {
      it(`is refused on ${name}, for a menu and a megamenu`, () => {
        expect(() =>
          barOf(
            { items: [{ key: "k", label: first, items: [A] }], hrefs: { a: "/a" } },
            { items: [{ key: "k", label: later, items: [B] }], hrefs: { b: "/b" } },
          ),
        ).toThrow(`createPrimaryNav: the menu "${later}" shares the key "k" with the menu "${first}", under another label.`);
        expect(() =>
          barOf(
            { items: [{ key: "k", label: first, groups: [column("Build", A)] }], hrefs: { a: "/a" } },
            { items: [{ key: "k", label: later, groups: [column("Run", B)] }], hrefs: { b: "/b" } },
          ),
        ).toThrow(`createPrimaryNav: the menu "${later}" shares the key "k" with the menu "${first}", under another label.`);
      });
    }

    it("is not raised by the identical label", () => {
      expect(
        barOf(
          { items: [{ key: "k", label: "Platform", items: [A] }], hrefs: { a: "/a" } },
          { items: [{ key: "k", label: "Platform", items: [B] }], hrefs: { b: "/b" } },
        ),
      ).toEqual([{ label: "Platform", items: [A, B] }]);
    });
  });

  describe("a key shared across menu kinds", () => {
    it("is refused when a megamenu takes a menu's key", () => {
      expect(() =>
        barOf(
          { items: [{ key: "k", label: "Platform", items: [A] }], hrefs: { a: "/a" } },
          { items: [{ key: "k", label: "Platform", groups: [column("Run", B)] }], hrefs: { b: "/b" } },
        ),
      ).toThrow('createPrimaryNav: the menu "Platform" shares the key "k" with a menu of another kind.');
    });

    it("is refused when a menu takes a megamenu's key", () => {
      expect(() =>
        barOf(
          { items: [{ key: "k", label: "Wide", groups: [column("Build", A)] }], hrefs: { a: "/a" } },
          { items: [{ key: "k", label: "Wide", items: [B] }], hrefs: { b: "/b" } },
        ),
      ).toThrow('createPrimaryNav: the menu "Wide" shares the key "k" with a menu of another kind.');
    });

    it("is not raised when each kind has its own key", () => {
      expect(
        barOf(
          { items: [{ key: "menu", label: "Platform", items: [A] }], hrefs: { a: "/a" } },
          { items: [{ key: "mega", label: "Platform", groups: [column("Run", B)] }], hrefs: { b: "/b" } },
        ),
      ).toEqual([
        { label: "Platform", items: [A] },
        { label: "Platform", groups: [column("Run", B)] },
      ]);
    });
  });

  describe("filters on a merging menu", () => {
    const accepted: { name: string; first?: string[]; later?: string[]; merged?: string[] }[] = [
      { name: "the later menu omits them, keeping the first's", first: ["admin"], merged: ["admin"] },
      {
        name: "the same tokens in another order, keeping the first's order",
        first: ["admin", "staff"],
        later: ["staff", "admin"],
        merged: ["admin", "staff"],
      },
      { name: "a repeated token, compared as a set", first: ["admin"], later: ["admin", "admin"], merged: ["admin"] },
      { name: "neither declares any" },
      { name: "both declare none", first: [], later: [], merged: [] },
    ];

    for (const { name, first, later, merged } of accepted) {
      it(`are accepted when ${name}`, () => {
        const filtered = (list: string[] | undefined) => (list === undefined ? {} : { filters: list });
        expect(
          barOf(
            { items: [{ key: "platform", label: "Platform", items: [A], ...filtered(first) }], hrefs: { a: "/a" } },
            { items: [{ key: "platform", label: "Platform", items: [B], ...filtered(later) }], hrefs: { b: "/b" } },
          ),
        ).toEqual([{ label: "Platform", items: [A, B], ...filtered(merged) }]);
        expect(
          barOf(
            { items: [{ key: "explore", label: "Explore", groups: [column("Build", A)], ...filtered(first) }], hrefs: { a: "/a" } },
            { items: [{ key: "explore", label: "Explore", groups: [column("Run", B)], ...filtered(later) }], hrefs: { b: "/b" } },
          ),
        ).toEqual([{ label: "Explore", groups: [column("Build", A), column("Run", B)], ...filtered(merged) }]);
      });
    }

    const refused: { name: string; first?: string[]; later: string[] }[] = [
      { name: "the tokens differ", first: ["admin"], later: ["guest"] },
      { name: "the first declares none and the later some", later: ["admin"] },
      { name: "the later adds a token", first: ["admin"], later: ["admin", "guest"] },
      { name: "the later drops a token", first: ["admin", "staff"], later: ["admin"] },
      { name: "the later declares an empty list", first: ["admin"], later: [] },
    ];

    for (const { name, first, later } of refused) {
      it(`are refused when ${name}`, () => {
        const filtered = (list: string[] | undefined) => (list === undefined ? {} : { filters: list });
        expect(() =>
          barOf(
            { items: [{ key: "platform", label: "Platform", items: [A], ...filtered(first) }], hrefs: { a: "/a" } },
            { items: [{ key: "platform", label: "Platform", items: [B], filters: later }], hrefs: { b: "/b" } },
          ),
        ).toThrow('createPrimaryNav: the menu "Platform" declares filters that differ from the menu it merges into.');
        expect(() =>
          barOf(
            { items: [{ key: "explore", label: "Explore", groups: [column("Build", A)], ...filtered(first) }], hrefs: { a: "/a" } },
            { items: [{ key: "explore", label: "Explore", groups: [column("Run", B)], filters: later }], hrefs: { b: "/b" } },
          ),
        ).toThrow('createPrimaryNav: the menu "Explore" declares filters that differ from the menu it merges into.');
      });
    }
  });

  describe("align on a merging megamenu", () => {
    const aligned = (align: "start" | "center" | "end" | undefined) => (align === undefined ? {} : { align });
    const cases: {
      name: string;
      first?: "start" | "center" | "end";
      later?: "start" | "center" | "end";
      merged?: "start" | "center" | "end" | "refused";
    }[] = [
      { name: "is kept from the first when the later omits it", first: "end", merged: "end" },
      { name: "is accepted when both declare the same", first: "center", later: "center", merged: "center" },
      { name: "is absent when neither declares one" },
      { name: "is refused when the two differ", first: "end", later: "start", merged: "refused" },
      { name: "is refused when the first declares none and the later one", later: "end", merged: "refused" },
    ];

    for (const { name, first, later, merged } of cases) {
      it(name, () => {
        const run = () =>
          barOf(
            { items: [{ key: "explore", label: "Explore", groups: [column("Build", A)], ...aligned(first) }], hrefs: { a: "/a" } },
            { items: [{ key: "explore", label: "Explore", groups: [column("Run", B)], ...aligned(later) }], hrefs: { b: "/b" } },
          );
        if (merged === "refused") {
          expect(run).toThrow('createPrimaryNav: the menu "Explore" declares an align that differs from the menu it merges into.');
        } else {
          expect(run()).toEqual([{ label: "Explore", groups: [column("Build", A), column("Run", B)], ...aligned(merged) }]);
        }
      });
    }
  });

  it("refuses an hrefs key a merged menu's other contributor already gave", () => {
    expect(() =>
      barOf(
        { items: [{ key: "platform", label: "Platform", items: [A] }], hrefs: { a: "/a" } },
        { items: [{ key: "platform", label: "Platform", items: [B] }], hrefs: { b: "/b" } },
        { items: [{ key: "platform", label: "Platform", items: [C] }], hrefs: { b: "/other", c: "/c" } },
      ),
    ).toThrow('createPrimaryNav: the key "b" is already contributed.');
  });

  it("resolves a merged menu's links through each contributor's own hrefs", () => {
    const nav = createPrimaryNav<NavKey, Ctx, State>([
      { items: [{ key: "platform", label: "Platform", items: [A] }], hrefs: { a: "/a" } },
      { items: [{ key: "platform", label: "Platform", items: [B] }], hrefs: { b: "/b" } },
    ]);
    expect([nav.resolveHref("a"), nav.resolveHref("b")]).toEqual(["/a", "/b"]);
  });

  describe("a definition's nested entries", () => {
    function exploreNav() {
      return createPrimaryNav<NavKey, Ctx, State>([
        {
          items: [
            { key: "platform", label: "Platform", items: [A] },
            { key: "explore", label: "Explore", groups: [column("Build", B)] },
          ],
          hrefs: { a: "/a", b: "/b" },
        },
      ]);
    }
    const EXPLORE_BAR = {
      sections: [
        {
          items: [
            { label: "Platform", items: [A] },
            { label: "Explore", groups: [column("Build", B)] },
          ],
        },
      ],
    };

    it("refuses a push into a menu's items", () => {
      const nav = exploreNav();
      const menu = nav.definition().sections[0]?.items[0];
      if (menu === undefined || !("items" in menu)) throw new Error("expected a menu");
      // @ts-expect-error -- a menu's items are readonly
      expect(() => menu.items.push(C)).toThrow(TypeError);
      expect(nav.definition()).toEqual(EXPLORE_BAR);
    });

    it("refuses a push into a megamenu's groups", () => {
      const nav = exploreNav();
      const megamenu = nav.definition().sections[0]?.items[1];
      if (megamenu === undefined || !("groups" in megamenu)) throw new Error("expected a megamenu");
      // @ts-expect-error -- a megamenu's groups are readonly
      expect(() => megamenu.groups.push(column("Run", D))).toThrow(TypeError);
      expect(nav.definition()).toEqual(EXPLORE_BAR);
    });

    it("refuses a push into a megamenu group's items", () => {
      const nav = exploreNav();
      const megamenu = nav.definition().sections[0]?.items[1];
      if (megamenu === undefined || !("groups" in megamenu)) throw new Error("expected a megamenu");
      // @ts-expect-error -- a group's entries are readonly
      expect(() => megamenu.groups[0]?.group.push(D)).toThrow(TypeError);
      expect(nav.definition()).toEqual(EXPLORE_BAR);
    });

    it("refuses at compile time a write to an entry's label", () => {
      const nav = exploreNav();
      const menu = nav.definition().sections[0]?.items[0];
      if (menu === undefined || !("items" in menu)) throw new Error("expected a menu");
      // @ts-expect-error -- an entry's label is readonly
      expect(() => (menu.label = "Renamed")).toThrow(TypeError);
      expect(nav.definition()).toEqual(EXPLORE_BAR);
    });

    it("leaves a contribution's own objects unfrozen and untouched by a merge", () => {
      const platform = { key: "platform", label: "Platform", items: [A] };
      const explore = { key: "explore", label: "Explore", groups: [column("Build", B)] };
      createPrimaryNav<NavKey, Ctx, State>([
        { items: [platform, explore], hrefs: { a: "/a", b: "/b" } },
        {
          items: [
            { key: "platform", label: "Platform", items: [C] },
            { key: "explore", label: "Explore", groups: [column("Run", D)] },
          ],
          hrefs: { c: "/c", d: "/d" },
        },
      ]);

      expect(platform).toEqual({ key: "platform", label: "Platform", items: [A] });
      expect(explore).toEqual({ key: "explore", label: "Explore", groups: [column("Build", B)] });
      expect([platform, platform.items, explore, explore.groups, explore.groups[0]?.group].some(Object.isFrozen)).toBe(false);
    });
  });
});

describe("resolveNavState", () => {
  it("merges every contribution's filters and slots in array order, each filter once", async () => {
    const avatar = (place: { inMenu: boolean }) => (place.inMenu ? "menu" : "bar");
    const nav = createPrimaryNav<Key, Ctx, NavState>([
      { items: [HOME], hrefs: { home: "/" }, state: async () => ({ activeFilters: ["member", "reader"], slots: { avatar } }) },
      { items: [NOTEBOOKS], hrefs: { notebooks: "/n" } },
      { items: [], hrefs: { account: "/a" }, state: async (c) => ({ activeFilters: ["admin", "member"], slots: { who: c.user } }) },
    ]);

    const state = await resolveNavState(nav, { user: "ada" });
    expect(state.activeFilters).toEqual(["member", "reader", "admin"]);
    expect(Object.keys(state.slots)).toEqual(["avatar", "who"]);
    expect(state.slots["avatar"]).toBe(avatar);
    expect(state.slots["who"]).toBe("ada");
  });

  it("throws, naming the slot, when two contributions fill it", async () => {
    const nav = createPrimaryNav<Key, Ctx, NavState>([
      { items: [HOME], hrefs: { home: "/" }, state: async () => ({ activeFilters: [], slots: { signout: "first" } }) },
      { items: [], hrefs: { account: "/a" }, state: async () => ({ activeFilters: [], slots: { signout: "second" } }) },
    ]);

    await expect(resolveNavState(nav, { user: null })).rejects.toThrow(/the slot "signout" is filled by two contributions/);
  });

  it("refuses a slot filled twice even when the first contribution left it undefined", async () => {
    const nav = createPrimaryNav<Key, Ctx, NavState>([
      { items: [HOME], hrefs: { home: "/" }, state: async () => ({ activeFilters: [], slots: { signout: undefined } }) },
      { items: [], hrefs: { account: "/a" }, state: async () => ({ activeFilters: [], slots: { signout: "second" } }) },
    ]);

    await expect(resolveNavState(nav, { user: null })).rejects.toThrow(/the slot "signout" is filled by two contributions/);
  });

  it("lets two contributions fill different slots, and one contribution fill several", async () => {
    const nav = createPrimaryNav<Key, Ctx, NavState>([
      { items: [HOME], hrefs: { home: "/" }, state: async () => ({ activeFilters: [], slots: { brand: "B", search: "S" } }) },
      { items: [], hrefs: { account: "/a" }, state: async () => ({ activeFilters: [], slots: { signout: "O" } }) },
    ]);

    expect(await resolveNavState(nav, { user: null })).toEqual({ activeFilters: [], slots: { brand: "B", search: "S", signout: "O" } });
  });

  it("runs every resolver before any settles, and merges in array order when a later one settles first", async () => {
    const first = Promise.withResolvers<NavState>();
    const second = Promise.withResolvers<NavState>();
    const started: string[] = [];
    const nav = createPrimaryNav<Key, Ctx, NavState>([
      {
        items: [HOME],
        hrefs: { home: "/" },
        state: () => {
          started.push("first");
          return first.promise;
        },
      },
      {
        items: [],
        hrefs: { account: "/a" },
        state: () => {
          started.push("second");
          return second.promise;
        },
      },
    ]);

    const merged = resolveNavState(nav, { user: "ada" });
    expect(started).toEqual(["first", "second"]);
    second.resolve({ activeFilters: ["late"], slots: { two: "2" } });
    await Promise.resolve();
    first.resolve({ activeFilters: ["early"], slots: { one: "1" } });

    const state = await merged;
    expect(state.activeFilters).toEqual(["early", "late"]);
    expect(Object.keys(state.slots)).toEqual(["one", "two"]);
  });

  describe("deduplicates filters, keeping each one's first position", () => {
    const cases: { name: string; contributed: string[][]; expected: string[] }[] = [
      { name: "within one contribution", contributed: [["a", "b", "a"]], expected: ["a", "b"] },
      {
        name: "across contributions",
        contributed: [
          ["b", "a"],
          ["c", "a", "b"],
        ],
        expected: ["b", "a", "c"],
      },
      { name: "when every token repeats", contributed: [["x"], ["x"], ["x"]], expected: ["x"] },
      { name: "when nothing repeats", contributed: [["a"], ["b", "c"]], expected: ["a", "b", "c"] },
    ];
    const keys: Key[] = ["home", "notebooks", "account"];

    for (const { name, contributed, expected } of cases) {
      it(name, async () => {
        const nav = createPrimaryNav<Key, Ctx, NavState>(
          contributed.map((activeFilters, i) => {
            const key = keys[i] as Key;
            return { items: [], hrefs: { [key]: `/${key}` }, state: async () => ({ activeFilters, slots: {} }) };
          }),
        );

        expect((await resolveNavState(nav, { user: null })).activeFilters).toEqual(expected);
      });
    }
  });

  it("resolves to an empty state when nothing contributes one", async () => {
    expect(await resolveNavState(createPrimaryNav<Key, Ctx, NavState>([]), { user: null })).toEqual({ activeFilters: [], slots: {} });

    const stateless = createPrimaryNav<Key, Ctx, NavState>([{ items: [HOME], hrefs: { home: "/" } }]);
    expect(await resolveNavState(stateless, { user: null })).toEqual({ activeFilters: [], slots: {} });
  });

  it("hands each resolver this request's context", async () => {
    const nav = createPrimaryNav<Key, Ctx, NavState>([
      { items: [], hrefs: { home: "/" }, state: async (c) => ({ activeFilters: [c.user ?? "nobody"], slots: {} }) },
    ]);

    expect((await resolveNavState(nav, { user: "ada" })).activeFilters).toEqual(["ada"]);
    expect((await resolveNavState(nav, { user: null })).activeFilters).toEqual(["nobody"]);
  });

  it("rejects with a resolver's own error when that resolver rejects", async () => {
    const failure = new Error("session store unreachable");
    const nav = createPrimaryNav<Key, Ctx, NavState>([
      { items: [HOME], hrefs: { home: "/" }, state: async () => ({ activeFilters: ["ok"], slots: {} }) },
      {
        items: [],
        hrefs: { account: "/a" },
        state: async () => {
          throw failure;
        },
      },
    ]);

    const outcome = await resolveNavState(nav, { user: null }).then(
      () => "resolved",
      (error: unknown) => error,
    );
    expect(outcome).toBe(failure);
  });

  it("refuses at compile time a primary nav whose state is not Navbar-shaped", async () => {
    const nav = createPrimaryNav<Key, Ctx, State>([{ items: [], hrefs: { home: "/" }, state: async () => ({ signedIn: true }) }]);
    // @ts-expect-error -- { signedIn } carries neither activeFilters nor slots
    const merged = resolveNavState(nav, { user: null });
    await merged.catch(() => undefined);
    expect(nav.states()).toHaveLength(1);
  });
});
