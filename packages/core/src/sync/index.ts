export { ChangeProcessor, type ChangeProcessorOptions } from "./processor.ts";
export { eventTypeForExists, startLibraryWatcher, type LibraryWatcher, type WatcherEvent } from "./watcher.ts";
export { ensureInitialReconciliation, recoverProcessingChanges } from "../db/repos/sync.ts";
