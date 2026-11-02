import { describe, expect, it } from "bun:test";

import { createPrimaryNav } from "./primary-nav";
import type { NavbarProps, NavContribution, NavStateResolver } from "./types";

type Key = "home" | "notebooks" | "account";
type Ctx = { user: string | null };
type State = { signedIn: boolean };

const HOME = { label: "Home", href: "home" } as const;
const NOTEBOOKS = { label: "Notebooks", href: "notebooks" } as const;
const ACCOUNT_MENU = { label: "Account", items: [{ label: "Settings", href: "account" as const }] };

const EMPTY_BAR = { sections: [{ items: [] }] };

describe("createPrimaryNav", () => {
  it("renders the bar in registration order", () => {
    const first = createPrimaryNav<Key, Ctx, State>();
    first.contribute({ items: [HOME], hrefs: { home: "/" } });
    first.contribute({ items: [NOTEBOOKS, ACCOUNT_MENU], hrefs: { notebooks: "/n", account: "/a" } });
    expect(first.definition()).toEqual({ sections: [{ items: [HOME, NOTEBOOKS, ACCOUNT_MENU] }] });

    const second = createPrimaryNav<Key, Ctx, State>();
    second.contribute({ items: [NOTEBOOKS, ACCOUNT_MENU], hrefs: { notebooks: "/n", account: "/a" } });
    second.contribute({ items: [HOME], hrefs: { home: "/" } });
    expect(second.definition()).toEqual({ sections: [{ items: [NOTEBOOKS, ACCOUNT_MENU, HOME] }] });
  });

  it("hands out a definition whose items a caller cannot grow the bar through", () => {
    const nav = createPrimaryNav<Key, Ctx, State>();
    nav.contribute({ items: [HOME], hrefs: { home: "/" } });
    nav.definition().sections[0]?.items.push(NOTEBOOKS);
    expect(nav.definition()).toEqual({ sections: [{ items: [HOME] }] });
  });

  describe("a key contributed twice", () => {
    it("throws at contribute, naming the key", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      nav.contribute({ items: [HOME], hrefs: { home: "/" } });
      expect(() => nav.contribute({ items: [], hrefs: { home: "/home" } })).toThrow(/the key "home" is already contributed/);
    });

    it("leaves the bar, the footer, the states and every href as they were", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      const kept: NavStateResolver<Ctx, State> = async () => ({ signedIn: true });
      nav.contribute({ items: [HOME], hrefs: { home: "/" }, footer: [{ label: "About", href: "home" }], state: kept });

      const refused: NavContribution<"home" | "notebooks", Ctx, State> = {
        items: [NOTEBOOKS],
        hrefs: { notebooks: "/n", home: "/elsewhere" },
        footer: [{ label: "Notebooks", href: "notebooks" }],
        state: async () => ({ signedIn: false }),
      };
      expect(() => nav.contribute(refused)).toThrow(/already contributed/);

      expect(nav.definition()).toEqual({ sections: [{ items: [HOME] }] });
      expect(nav.footer()).toEqual([{ label: "About", href: "/" }]);
      expect(nav.states()).toHaveLength(1);
      expect(nav.states()[0]).toBe(kept);
      expect(nav.resolveHref("home")).toBe("/");
      expect(() => nav.resolveHref("notebooks")).toThrow(/no href is contributed for the key "notebooks"/);
    });
  });

  describe("the toggle's name", () => {
    const refusals: { name: string; label: string; items: NavContribution<"home", Ctx, State>["items"] }[] = [
      { name: "a top-level link", label: "Menu", items: [{ label: "Menu", href: "home" }] },
      { name: "a padded, lower-case link", label: " menu ", items: [{ label: " menu ", href: "home" }] },
      { name: "a link inside a menu", label: "Menu", items: [{ label: "More", items: [{ label: "Menu", href: "home" }] }] },
      {
        name: "a link two menus deep",
        label: "Menu",
        items: [{ label: "More", items: [{ label: "Deeper", items: [{ label: "Menu", href: "home" }] }] }],
      },
      { name: "the label of a menu itself", label: "Menu", items: [{ label: "Menu", items: [{ label: "Home", href: "home" }] }] },
      { name: "a link inside a group", label: "Menu", items: [{ heading: "Site", group: [{ label: "Menu", href: "home" }] }] },
      {
        name: "a link inside a megamenu column",
        label: "Menu",
        items: [{ label: "More", groups: [{ heading: "Site", group: [{ label: "Menu", href: "home" }] }] }],
      },
      { name: "a slot", label: "MENU", items: [{ slot: "search", label: "MENU" }] },
    ];

    for (const { name, label, items } of refusals) {
      it(`is refused on ${name}, and the refused contribution adds nothing`, () => {
        const nav = createPrimaryNav<Key, Ctx, State>();
        expect(() => nav.contribute({ items: [HOME, ...items], hrefs: { home: "/" } })).toThrow(`may not be labelled "${label}"`);
        expect(nav.definition()).toEqual(EMPTY_BAR);
        expect(() => nav.resolveHref("home")).toThrow(/no href is contributed/);
      });
    }

    const acceptances: { name: string; items: NavContribution<"home", Ctx, State>["items"] }[] = [
      { name: "a label that only starts with it", items: [{ label: "Menus", href: "home" }] },
      { name: "a label that only ends with it", items: [{ label: "Main menu", href: "home" }] },
      { name: "a group heading, which names no control", items: [{ heading: "Menu", group: [{ label: "Home", href: "home" }] }] },
    ];

    for (const { name, items } of acceptances) {
      it(`is not refused on ${name}`, () => {
        const nav = createPrimaryNav<Key, Ctx, State>();
        nav.contribute({ items, hrefs: { home: "/" } });
        expect(nav.definition()).toEqual({ sections: [{ items }] });
      });
    }
  });

  describe("resolveHref", () => {
    it("returns the URL a contribution gave its key", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      nav.contribute({ items: [HOME, NOTEBOOKS], hrefs: { home: "/", notebooks: "/notebooks?view=grid" } });
      expect(nav.resolveHref("notebooks")).toBe("/notebooks?view=grid");
    });

    it("throws on a key nobody contributed rather than falling back to home", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      nav.contribute({ items: [HOME], hrefs: { home: "/" } });
      expect(() => nav.resolveHref("nowhere")).toThrow(/no href is contributed for the key "nowhere"/);
    });

    it("throws on an empty key", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      nav.contribute({ items: [HOME], hrefs: { home: "/" } });
      expect(() => nav.resolveHref("")).toThrow(/no href is contributed for the key ""/);
    });
  });

  describe("footer", () => {
    it("resolves every contribution's footer links to URLs in registration order", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      nav.contribute({ items: [HOME], hrefs: { home: "/" }, footer: [{ label: "About", href: "home" }] });
      nav.contribute({ items: [NOTEBOOKS], hrefs: { notebooks: "/n" } });
      nav.contribute({ items: [], hrefs: { account: "/a" }, footer: [{ label: "Your account", href: "account" }] });
      expect(nav.footer()).toEqual([
        { label: "About", href: "/" },
        { label: "Your account", href: "/a" },
      ]);
    });

    it("is empty when no contribution brings footer links", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      nav.contribute({ items: [HOME], hrefs: { home: "/" } });
      expect(nav.footer()).toEqual([]);
    });
  });

  describe("states", () => {
    it("holds each contribution's resolver in registration order and skips a contribution without one", async () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      const signedIn: NavStateResolver<Ctx, State> = async (c) => ({ signedIn: c.user !== null });
      const always: NavStateResolver<Ctx, State> = async () => ({ signedIn: true });
      nav.contribute({ items: [HOME], hrefs: { home: "/" }, state: signedIn });
      nav.contribute({ items: [NOTEBOOKS], hrefs: { notebooks: "/n" } });
      nav.contribute({ items: [], hrefs: { account: "/a" }, state: always });

      const states = nav.states();
      expect(states).toHaveLength(2);
      expect(states[0]).toBe(signedIn);
      expect(states[1]).toBe(always);
      expect(await states[0]?.({ user: "ada" })).toEqual({ signedIn: true });
      expect(await states[0]?.({ user: null })).toEqual({ signedIn: false });
    });

    it("hands out a list a caller cannot add a resolver to", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      nav.contribute({ items: [HOME], hrefs: { home: "/" }, state: async () => ({ signedIn: true }) });
      (nav.states() as NavStateResolver<Ctx, State>[]).push(async () => ({ signedIn: false }));
      expect(nav.states()).toHaveLength(1);
    });
  });

  it("fits Navbar's config and resolveHref props, with resolveHref detached from the nav", () => {
    const nav = createPrimaryNav<Key, Ctx, State>();
    nav.contribute({ items: [HOME], hrefs: { home: "/" } });
    const props: Pick<NavbarProps, "config" | "resolveHref"> = { config: nav.definition(), resolveHref: nav.resolveHref };
    expect(props.config).toEqual({ sections: [{ items: [HOME] }] });
    expect(props.resolveHref("home")).toBe("/");
  });

  describe("at compile time", () => {
    it("refuses a misspelled key", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      // @ts-expect-error -- "notebok" is not a key of this contribution's hrefs
      nav.contribute({ items: [{ label: "N", href: "notebok" }], hrefs: { notebooks: "/n" } });
      expect(nav.resolveHref("notebooks")).toBe("/n");
    });

    it("refuses an hrefs key outside the app's key set", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      // @ts-expect-error -- "notebok" is not one of the app's keys
      nav.contribute({ items: [], hrefs: { notebok: "/n" } });
      expect(nav.definition()).toEqual(EMPTY_BAR);
    });

    it("refuses a misspelled footer key", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      // @ts-expect-error -- "hme" is not a key of this contribution's hrefs
      nav.contribute({ items: [], hrefs: { home: "/" }, footer: [{ label: "H", href: "hme" }] });
      expect(nav.resolveHref("home")).toBe("/");
    });

    it("refuses a misspelled key inside a nested menu", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      // @ts-expect-error -- "acount" is not a key of this contribution's hrefs
      nav.contribute({ items: [{ label: "More", items: [{ label: "A", href: "acount" }] }], hrefs: { account: "/a" } });
      expect(nav.resolveHref("account")).toBe("/a");
    });

    it("refuses an app key that this contribution's hrefs does not carry", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      // @ts-expect-error -- "account" is an app key, but this contribution gives it no URL
      nav.contribute({ items: [{ label: "A", href: "account" }], hrefs: { notebooks: "/n" } });
      expect(nav.resolveHref("notebooks")).toBe("/n");
    });

    it("refuses a state resolver of the wrong shape", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      // @ts-expect-error -- signedIn is a boolean, not a string
      nav.contribute({ items: [], hrefs: { home: "/" }, state: async () => ({ signedIn: "yes" }) });
      expect(nav.states()).toHaveLength(1);
    });

    it("accepts a flat contribution declared as const", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      const flat = { items: [HOME, NOTEBOOKS], hrefs: { home: "/", notebooks: "/n" } } as const;
      nav.contribute(flat);
      expect(nav.definition()).toEqual({ sections: [{ items: [HOME, NOTEBOOKS] }] });
    });

    it("accepts a contribution declared as const that nests a menu", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      const nested = { items: [{ label: "More", items: [{ label: "A", href: "account" }] }], hrefs: { account: "/a" } } as const;
      nav.contribute(nested);
      expect(nav.definition()).toEqual({ sections: [{ items: [{ label: "More", items: [{ label: "A", href: "account" }] }] }] });
    });

    it("accepts a contribution declared as const that nests a group", () => {
      const nav = createPrimaryNav<Key, Ctx, State>();
      const grouped = { items: [{ heading: "Site", group: [{ label: "H", href: "home" }] }], hrefs: { home: "/" } } as const;
      nav.contribute(grouped);
      expect(nav.definition()).toEqual({ sections: [{ items: [{ heading: "Site", group: [{ label: "H", href: "home" }] }] }] });
    });
  });
});
