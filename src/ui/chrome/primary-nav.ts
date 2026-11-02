import { LABEL_DEFAULTS } from "../contracts/labels";
import type { NavContribution, NavDefinition, NavGroup, NavItem, NavLink, NavSectionItem, NavSlot, NavStateResolver, PrimaryNav } from "./types";

type KeyedSectionItem = NavContribution<string, unknown, unknown>["items"][number];
type KeyedGroup = Extract<KeyedSectionItem, { heading: string }>;
type KeyedItem = Exclude<KeyedSectionItem, KeyedGroup>;
type KeyedEntry = KeyedGroup["group"][number];

function copyNavLeaf<T extends { filters?: readonly string[] | undefined }>(leaf: T): Omit<T, "filters"> & { filters?: string[] } {
  const { filters, ...rest } = leaf;
  return filters === undefined ? rest : { ...rest, filters: [...filters] };
}

function copyNavEntry(entry: KeyedEntry): NavLink | NavSlot {
  return "slot" in entry ? copyNavLeaf(entry) : copyNavLeaf(entry);
}

function copyNavGroup(group: KeyedGroup): NavGroup {
  return { ...copyNavLeaf(group), group: group.group.map(copyNavEntry) };
}

function copyNavItem(item: KeyedItem): NavItem {
  if ("items" in item) return { ...copyNavLeaf(item), items: item.items.map(copyNavItem) };
  if ("groups" in item) return { ...copyNavLeaf(item), groups: item.groups.map(copyNavGroup) };
  return copyNavEntry(item);
}

function copyNavSectionItem(item: KeyedSectionItem): NavSectionItem {
  return "heading" in item ? copyNavGroup(item) : copyNavItem(item);
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

/** Creates one app's primary navbar, to which each feature contributes its entries at registration. @public */
export function createPrimaryNav<K extends string, C, S>(): PrimaryNav<K, C, S> {
  const bar: NavSectionItem[] = [];
  const footer: Pick<NavLink, "label" | "href">[] = [];
  const states: NavStateResolver<C, S>[] = [];
  const hrefs = new Map<string, string>();

  const resolveHref = (key: string): string => {
    const href = hrefs.get(key);
    if (href === undefined) throw new Error(`createPrimaryNav: no href is contributed for the key "${key}".`);
    return href;
  };

  const contribute = <L extends K>(contribution: NavContribution<L, C, S>): void => {
    const items = contribution.items.map(copyNavSectionItem);
    refuseToggleLabel(items);
    const taken = Object.keys(contribution.hrefs).find((key) => hrefs.has(key));
    if (taken !== undefined) throw new Error(`createPrimaryNav: the key "${taken}" is already contributed.`);

    for (const [key, href] of Object.entries<string>(contribution.hrefs)) hrefs.set(key, href);
    bar.push(...items);
    footer.push(...(contribution.footer ?? []));
    if (contribution.state !== undefined) states.push(contribution.state);
  };

  return {
    contribute,
    definition: (): NavDefinition => ({ sections: [{ items: [...bar] }] }),
    footer: () => footer.map((link) => ({ label: link.label, href: resolveHref(link.href) })),
    resolveHref,
    states: () => [...states],
  };
}
