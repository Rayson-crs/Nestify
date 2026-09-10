export { gramsForName, insertTrigrams } from "./trigram.ts";
export {
  SQLITE_SEARCH_INDEX_VERSION,
  getSearchIndexState,
  markSearchIndexBuilding,
  markSearchIndexDirty,
  markSearchIndexFailed,
  markSearchIndexReady,
  rebuildSqliteDerivedIndexes,
  shouldFallbackToSqlite,
  sqliteSearchIndexVersion,
  upgradeSqliteDerivedIndexes,
  type SearchIndexState,
  type SearchIndexStatus,
} from "./index-state.ts";
export { parseSearchQuery, type ParsedSearchQuery } from "./parse.ts";
export {
  ALL_LIBRARIES_ID,
  explainDirectoryChildrenPlan,
  explainSearchPlan,
  explainSearchTrigramProbes,
  listDirectoryChildren,
  searchEntries,
  type SearchEntriesRequest,
  type SearchEntriesResult,
  type SearchEntryHit,
  type SearchSort,
} from "./query.ts";
