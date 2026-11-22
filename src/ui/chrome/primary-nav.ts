import { LABEL_DEFAULTS } from "../contracts/labels";
import type {
  NavContribution,
  NavDefinition,
  NavGroup,
  NavItem,
  NavLink,
  NavMegaMenu,
  NavMenu,
  NavSectionItem,
  NavSlot,
  NavState,
  NavStateResolver,
  PrimaryNav,
} from "./types";

type KeyedSectionItem = NavContribution<string, unknown, unknown>["items"][number];
type KeyedGroup = Extract<KeyedSectionItem, { heading: string }>;
type KeyedItem = Extract<KeyedSectionItem, { items: unknown }>["items"][number];
type KeyedEntry = KeyedGroup["group"][number];
type BarEntry = { readonly key: string; readonly item: NavMenu | NavMegaMenu } | { readonly key?: undefined; readonly item: NavSectionItem };

function freeze<T extends object>(value: T): T {
  Object.freeze(value);
  return value;
}

function copyNavLeaf<T extends { filters?: readonly string[] | undefined }>(leaf: T): Omit<T, "filters"> & { filters?: string[] } {
  const { filters, ...rest } = leaf;
  return filters === undefined ? rest : { ...rest, filters: freeze([...filters]) };
}

function copyNavEntry(entry: KeyedEntry): NavLink | NavSlot {
  return freeze("slot" in entry ? copyNavLeaf(entry) : copyNavLeaf(entry));
}

function copyNavGroup(group: KeyedGroup): NavGroup {
  return freeze({ ...copyNavLeaf(group), group: freeze(group.group.map(copyNavEntry)) });
}

function copyNavMenu(menu: Extract<KeyedItem, { items: unknown }>): NavMenu {
  return freeze({ ...copyNavLeaf(menu), items: freeze(menu.items.map(copyNavItem)) });
}

function copyNavMegaMenu(menu: Extract<KeyedItem, { groups: unknown }>): NavMegaMenu {
  return freeze({ ...copyNavLeaf(menu), groups: freeze(menu.groups.map(copyNavGroup)) });
}

function copyNavItem(item: KeyedItem): NavItem {
  if ("items" in item) return copyNavMenu(item);
  if ("groups" in item) return copyNavMegaMenu(item);
  return copyNavEntry(item);
}

function copyBarEntry(item: KeyedSectionItem): BarEntry {
  if ("heading" in item) return { item: copyNavGroup(item) };
  if (!("key" in item)) return { item: copyNavItem(item) };
  const { key, ...menu } = item;
  return { key, item: "items" in menu ? copyNavMenu(menu) : copyNavMegaMenu(menu) };
}

function refuseToggleLabel(items: readonly NavSectionItem[]): void {
  for (const item of items) {
    // The collapse toggle owns this accessible name; a second control sharing it is ambiguous to a screen reader.
    if ("label" in item && item.label?.trim().toLowerCase() === LABEL_DEFAULTS.navbarToggle.toLowerCase()) {
      throw new Error(`createPrimaryNav: a nav entry may not be labelled "${item.label}"; the bar's toggle owns that name.`);
    }
    if ("items" in item) refuseToggleLabel(item.items);
    if ("group" in item) refuseToggleLabel(item.group);
    if ("groups" in item) refuseToggleLabel(item.groups);
  }
}

function refuseUnresolvedHref(link: Pick<NavLink, "label" | "href">, hrefs: ReadonlyMap<string, string>): void {
  if (!hrefs.has(link.href)) {
    throw new Error(`createPrimaryNav: the link "${link.label}" names the key "${link.href}", which no contribution gives an href.`);
  }
}

function refuseUnresolvedHrefs(items: readonly NavSectionItem[], hrefs: ReadonlyMap<string, string>): void {
  for (const item of items) {
    if ("href" in item) refuseUnresolvedHref(item, hrefs);
    if ("items" in item) refuseUnresolvedHrefs(item.items, hrefs);
    if ("group" in item) refuseUnresolvedHrefs(item.group, hrefs);
    if ("groups" in item) refuseUnresolvedHrefs(item.groups, hrefs);
  }
}

function isMenu(item: NavSectionItem): item is NavMenu {
  return "items" in item;
}

function isMegaMenu(item: NavSectionItem): item is NavMegaMenu {
  return "groups" in item;
}

function sameTokens(held: readonly string[] | undefined, declared: readonly string[]): boolean {
  if (held === undefined) return false;
  const heldSet = new Set(held);
  const declaredSet = new Set(declared);
  return heldSet.size === declaredSet.size && [...declaredSet].every((token) => heldSet.has(token));
}

function refuseDifferingFilters(existing: NavMenu | NavMegaMenu, incoming: NavMenu | NavMegaMenu): void {
  if (incoming.filters !== undefined && !sameTokens(existing.filters, incoming.filters)) {
    throw new Error(`createPrimaryNav: the menu "${incoming.label}" declares filters that differ from the menu it merges into.`);
  }
}

function mergeMenu(existing: NavMenu, incoming: NavMenu): NavMenu {
  refuseDifferingFilters(existing, incoming);
  return freeze({ ...existing, items: freeze([...existing.items, ...incoming.items]) });
}

function mergeMegaMenu(existing: NavMegaMenu, incoming: NavMegaMenu): NavMegaMenu {
  refuseDifferingFilters(existing, incoming);
  if (incoming.align !== undefined && incoming.align !== existing.align) {
    throw new Error(`createPrimaryNav: the menu "${incoming.label}" declares an align that differs from the menu it merges into.`);
  }
  return freeze({ ...existing, groups: freeze([...existing.groups, ...incoming.groups]) });
}

function mergeKeyed(key: string, existing: NavMenu | NavMegaMenu, incoming: NavMenu | NavMegaMenu): NavMenu | NavMegaMenu {
  if (isMenu(existing) && isMenu(incoming)) return mergeLabelled(key, existing, incoming, mergeMenu);
  if (isMegaMenu(existing) && isMegaMenu(incoming)) return mergeLabelled(key, existing, incoming, mergeMegaMenu);
  throw new Error(`createPrimaryNav: the menu "${incoming.label}" shares the key "${key}" with a menu of another kind.`);
}

function mergeLabelled<M extends NavMenu | NavMegaMenu>(key: string, existing: M, incoming: M, merge: (existing: M, incoming: M) => M): M {
  if (incoming.label !== existing.label) {
    throw new Error(
      `createPrimaryNav: the menu "${incoming.label}" shares the key "${key}" with the menu "${existing.label}", under another label.`,
    );
  }
  return merge(existing, incoming);
}

function mergeIntoBar(bar: readonly BarEntry[], incoming: readonly BarEntry[]): BarEntry[] {
  const merged = [...bar];
  for (const entry of incoming) {
    const index = entry.key === undefined ? -1 : merged.findIndex((held) => held.key === entry.key);
    const existing = merged[index];
    if (entry.key === undefined || existing?.key === undefined) merged.push(entry);
    else merged[index] = { key: entry.key, item: mergeKeyed(entry.key, existing.item, entry.item) };
  }
  return merged;
}

type AppNavContribution<K extends string, C, S> = Omit<NavContribution<K, C, S>, "hrefs"> & {
  readonly hrefs: Readonly<Partial<Record<K, string>>>;
};

/** Composes one app's frozen navbar from every contribution in array order, merging menus by `key`; throws on a link with no href. @public */
export function createPrimaryNav<K extends string, C, S>(contributions: readonly AppNavContribution<K, C, S>[]): PrimaryNav<C, S> {
  let bar: BarEntry[] = [];
  const footer: Pick<NavLink, "label" | "href">[] = [];
  const states: NavStateResolver<C, S>[] = [];
  const hrefs = new Map<string, string>();

  for (const contribution of contributions) {
    const entries = contribution.items.map(copyBarEntry);
    refuseToggleLabel(entries.map((entry) => entry.item));
    for (const [key, href] of Object.entries<string | undefined>(contribution.hrefs)) {
      if (hrefs.has(key)) throw new Error(`createPrimaryNav: the key "${key}" is already contributed.`);
      if (href !== undefined) hrefs.set(key, href);
    }
    bar = mergeIntoBar(bar, entries);
    for (const link of contribution.footer ?? []) footer.push(freeze({ label: link.label, href: link.href }));
    if (contribution.state !== undefined) states.push(contribution.state);
  }
  const barItems = bar.map((entry) => entry.item);
  refuseUnresolvedHrefs(barItems, hrefs);
  for (const link of footer) refuseUnresolvedHref(link, hrefs);

  const resolveHref = (key: string): string => {
    const href = hrefs.get(key);
    if (href === undefined) throw new Error(`createPrimaryNav: no href is contributed for the key "${key}".`);
    return href;
  };
  const definition: NavDefinition = freeze({ sections: freeze([freeze({ items: freeze(barItems) })]) });
  const heldStates = freeze(states);

  return freeze({
    definition: () => definition,
    footer: () => footer.map((link) => ({ label: link.label, href: resolveHref(link.href) })),
    resolveHref,
    states: () => heldStates,
  });
}

/** Runs every contributed state resolver for this request and merges the results, in contribution order, into one `Navbar` state. @public */
export async function resolveNavState<C, S extends NavState>(nav: PrimaryNav<C, S>, c: C): Promise<NavState> {
  const resolved = await Promise.all(nav.states().map((state) => state(c)));
  const activeFilters = new Set<string>();
  const slots: NavState["slots"] = {};
  for (const state of resolved) {
    for (const filter of state.activeFilters) activeFilters.add(filter);
    for (const [key, slot] of Object.entries(state.slots)) {
      if (Object.hasOwn(slots, key)) throw new Error(`resolveNavState: the slot "${key}" is filled by two contributions.`);
      slots[key] = slot;
    }
  }
  return { activeFilters: [...activeFilters], slots };
}
