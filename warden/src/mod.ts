export { type CatalogueScope, renderCatalogue } from "./catalogue/render";
export { createWardenCommands } from "./cli/commands";
export { createCatalogueCommand, createKnowledgeCommands, createServeCommand } from "./cli/knowledge";
export { bindings, DEFAULT_ARCH, declaredVersion, executables, installedVersion, placeNatives } from "./cli/natives";
export type { Subject } from "./cli/show";
export { show, SUBJECTS } from "./cli/show";
export { chunkDocument, frontmatter, glossary, headings, proseOf, ruleClauses } from "./corpus/chunk";
export { fnv1a } from "./corpus/hash";
export { chunkId, headingSlug, parseId, sourceId } from "./corpus/ident";
export { citationTarget, headerOf, relationsOf, resolveDoc } from "./corpus/relate";
export { canonSources, discover, localSources, repoRelative, weightOf } from "./corpus/source";
export type { GoldenCheckConfig } from "./gate/queries";
export { checkGoldenQueries } from "./gate/queries";
export type { GoldenQuery } from "./gate/golden";
export { GOLDEN, NEGATIVE } from "./gate/golden";
export type { WardenCheckConfig } from "./gate/warden";
export { checkWarden } from "./gate/warden";
export { readMeta, stampVersions, versionsMatch, writeMeta } from "./index/db";
export { COLUMN_WEIGHTS, INDEXER_VERSION, SCHEMA, SCHEMA_VERSION, TOKENIZE } from "./index/schema";
// The knowledge surface is re-exported through its own barrel rather than restated module by
// module, so `search/mod.ts` stays the one place that decides what it is. A star re-export would
// say it in one line and is banned, so the names are listed — but they are listed once.
export type { BuildReport, Freshness, Knowledge, OpenOptions } from "./search/mod";
export { advisory, build, freshness, gateIndexPath, indexPath, load, openDatabase, openIndex, rebuild } from "./search/mod";
export { CANON_ROOT, CLAUDE_ROOT, resolveRepoRoot, walkUpToRepo, WARDEN_ROOT } from "./paths";
export { check, checkAgents, checkBoundary, checkTree } from "./sync/check";
export { type KindSource, readKind, resolveKind, resolveKindSource } from "./sync/kind";
export { seed, seedFiles } from "./sync/seed";
export { copyTree, identical, sync, syncTrees, walk } from "./sync/sync";
export type { Chunk, Corpus, Divergence, Kind, Relation, SeedFile, SourceDoc, SyncOutcome, SyncTree, Tree } from "./types";
export { canonVersion } from "./version";
