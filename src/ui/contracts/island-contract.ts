/** The attribute a resumable island's serialized state is written to and read from. @public */
export const ISLAND_STATE_ATTR = "data-island-state";

/** The same attribute as a `dataset` key, derived so the two spellings cannot drift. @public */
export const ISLAND_STATE_KEY = ISLAND_STATE_ATTR.slice(5).replaceAll(/-(\w)/g, (_, c: string) => c.toUpperCase());
