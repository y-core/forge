export { type CatalogueScope, renderCanon, renderCatalogue } from "./catalogue/render";
export { createWardenCommands } from "./cli/commands";
export { createCatalogueCommand, createKnowledgeCommands, createServeCommand } from "./cli/knowledge";
export { bindings, DEFAULT_ARCH, declaredVersion, executables, installedVersion, placeNatives } from "./cli/natives";
export type { Subject } from "./cli/show";
export { show, SUBJECTS } from "./cli/show";
export { chunkDocument, frontmatter, glossary, headings, proseOf, ruleClauses } from "./corpus/chunk";
export { fnv1a } from "./corpus/hash";
export { chunkId, headingSlug, parseCorpus, parseId, sourceId } from "./corpus/ident";
export type { Resolution } from "./corpus/relate";
export { citationTarget, headerOf, relationsOf, resolveCitation, resolveDoc } from "./corpus/relate";
export type { Audience, DependencyOptions } from "./corpus/dependency";
export {
  audienceOf,
  DEPENDENCY_README_WEIGHT,
  DEPENDENCY_WEIGHT,
  dependencyRootOf,
  dependencyWeightOf,
  libraryDocsDir,
  libraryRoot,
  librarySources,
} from "./corpus/dependency";
export { canonSources, discover, localSources, repoRelative, weightOf } from "./corpus/source";
export type { DuplicateCheckConfig, DuplicatePair } from "./gate/duplicates";
export { checkDuplicates, duplicatePairs } from "./gate/duplicates";
export type { ProbeOptions } from "./cli/probe";
export { createProbeCommand, probe, probeSetsOf } from "./cli/probe";
export { createCheckCommand } from "./cli/check";
export { createRulesCommand } from "./cli/rules";
export type { ChangedFile } from "./impact/git";
export { changed, parseDiff } from "./impact/git";
export type { Impact, Touched } from "./impact/impact";
export { impact } from "./impact/impact";
export { renderImpact } from "./impact/render";
export type { GoldenCheckConfig } from "./gate/queries";
export { checkGoldenQueries } from "./gate/queries";
export type { Dimension, GoldenQuery } from "./gate/golden";
export { GOLDEN, NEGATIVE } from "./gate/golden";
export type { GoldenStep, WardenQueries } from "./gate/step-sets";
export { defineWardenQueries, goldenSetsOf, GOLDEN_STEP_LABEL, stepsOf } from "./gate/step-sets";
export type { WardenCheckConfig } from "./gate/warden";
export { checkWarden } from "./gate/warden";
export { readMeta, stampVersions, versionsMatch, writeMeta } from "./index/db";
export { COLUMN_WEIGHTS, INDEXER_VERSION, SCHEMA, SCHEMA_VERSION, TOKENIZE, UNSTEMMED_TOKENIZE } from "./index/schema";
export type { AliasTable, BuildReport, Freshness, Knowledge, OpenOptions } from "./search/mod";
export { advisory, aliasesFor, build, freshness, gateIndexPath, indexPath, load, openDatabase, openIndex, rebuild } from "./search/mod";
export { CANON_ROOT, CLAUDE_ROOT, libraryPrefix, packageNameOf, resolveRepoRoot, RULES_CANON_ROOT, walkUpToRepo, WARDEN_ROOT } from "./paths";
export type { RatchetBaseline, RatchetCheckConfig } from "./checks/ratchet";
export { checkRatchet, tightenRatchet } from "./checks/ratchet";
export type { RulesCheckConfig, RulesPlugin } from "./checks/rules";
export { checkRules } from "./checks/rules";
export type { CheckedRule, CheckFinding, CheckOptions, CheckReport } from "./rules/check";
export { compileDetector, rgArgv, sweepRules } from "./rules/check";
export { defineRules } from "./rules/define";
export type { RuleSourcesOptions } from "./rules/load";
export { loadRuleSources, registerTrees, ruleDocuments } from "./rules/load";
export { collectMarkers } from "./rules/markers";
export { buildRegister } from "./rules/resolve";
export { corpusWords, countWords, detectorClass, ownedDocuments, ruleStats } from "./rules/stats";
export type {
  DetectorClass,
  DetectorKind,
  RegisteredRule,
  RegisterProblem,
  RgDetector,
  RgExample,
  RuleDetector,
  RuleEntry,
  RuleMarkerScan,
  RuleMarkerSite,
  RuleOrigin,
  RuleRationale,
  RuleSource,
  RuleStats,
  SplitRuleMarker,
} from "./rules/types";
export { check, checkAgents, checkBoundary, checkFiles, checkGit, checkTree, MUST_IGNORE } from "./sync/check";
export { type KindSource, readKind, resolveKind, resolveKindSource } from "./sync/kind";
export { seed, seedFiles } from "./sync/seed";
export { layerTree, mergeOverlay, render, sync, syncFiles, syncPlan, syncTrees, walk, writeTree } from "./sync/sync";
export type { Chunk, Corpus, CorpusFile, Divergence, Kind, Relation, SourceDoc, SyncOutcome, SyncPlan, SyncTree, Tree } from "./types";
export { CORPORA } from "./types";
export { canonVersion } from "./version";
export type { WorkflowEnv } from "./workflow/git";
export { TASK_CHECK } from "./workflow/git";
export type { HandedOff, HandoffReport, HandoffTask } from "./workflow/handoff";
export { handoff } from "./workflow/handoff";
export type { MergedTask, PushOptions, PushReport, ReviewedTask } from "./workflow/merge";
export { mergeReviewed, preparePush } from "./workflow/merge";
export { handoffScript, mergeScript } from "./workflow/script";
