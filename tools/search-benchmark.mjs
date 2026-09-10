#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

const { openDatabase, searchEntries, listDirectoryChildren, explainSearchPlan, explainDirectoryChildrenPlan, rebuildSqliteDerivedIndexes } =
  await import("../packages/core/src/index.ts");

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printUsage();
  process.exit(0);
}

const rows = positiveInt(args.rows, 100_000);
const warmup = positiveInt(args.warmup, 10);
const iterations = positiveInt(args.iterations, 100);
const coldIterations = positiveInt(args["cold-iterations"], Math.min(10, iterations), true);
const seed = positiveInt(args.seed, 42);
const writeConcurrency = positiveInt(args["write-concurrency"], 0, true);
const keepDb = Boolean(args.keep);
const skipDerived = Boolean(args["skip-derived"]);
const dbPath = args.db ? resolve(args.db) : join(tmpdir(), `nestify-search-benchmark-${process.pid}.sqlite`);
const libraryId = "benchmark-library";
const rootPath = "D:/Benchmark";

mkdirSync(dirname(dbPath), { recursive: true });
if (!args.db && existsSync(dbPath)) removeDatabase(dbPath);

const db = openDatabase(dbPath);
try {
  const hasData = Number(db.prepare("SELECT COUNT(*) AS n FROM entries").get().n) > 0;
  if (!hasData) {
    const started = performance.now();
    seedDatabase(db, rows, seed, libraryId, rootPath);
    console.log(JSON.stringify({ event: "fixture.created", rows, elapsedMs: round(performance.now() - started), dbPath }));
    if (!skipDerived) {
      const derivedStarted = performance.now();
      rebuildSqliteDerivedIndexes(db);
      console.log(JSON.stringify({ event: "fixture.derived-indexes", elapsedMs: round(performance.now() - derivedStarted) }));
    }
  }

  db.exec("ANALYZE; PRAGMA optimize;");
  const actualRows = Number(db.prepare("SELECT COUNT(*) AS n FROM entries").get().n);
  const derivedRows = Number(db.prepare("SELECT COUNT(*) AS n FROM name_trigrams").get().n);
  const scenarios = buildScenarios(db, libraryId, rootPath)
    .filter((scenario) => !args.scenario || scenario.name === args.scenario);
  const plans = scenarios.map((scenario) => ({
    name: scenario.name,
    details: (scenario.directory
      ? explainDirectoryChildrenPlan(db, libraryId, scenario.directory)
      : explainSearchPlan(db, scenario.request)).map((row) => row.detail),
  }));
  console.log(JSON.stringify({
    event: "plans",
    plans: plans.map((plan) => ({
      ...plan,
      scan: plan.details.some((detail) => /\bSCAN\b/.test(detail)),
      tempBtree: plan.details.some((detail) => detail.includes("TEMP B-TREE")),
      correlated: plan.details.some((detail) => detail.includes("CORRELATED")),
    })),
  }));

  const results = [];
  for (const scenario of scenarios) {
    const cold = measureColdConnections(dbPath, scenario, coldIterations);
    const hot = measureScenario(db, scenario, iterations, true, warmup);
    const sample = runScenario(db, scenario);
    const validation = validateScenario(scenario, sample);
    if (!validation.ok) throw new Error(`${scenario.name} consistency check failed: ${validation.message}`);
    results.push({
      name: scenario.name,
      connectionCold: summarize(cold),
      hot: summarize(hot),
      validation,
      sample: {
        hits: sample.hits.length,
        total: sample.total,
        hasMore: sample.hasMore,
        statsIncluded: "statsIncluded" in sample ? sample.statsIncluded : undefined,
        elapsedMs: sample.elapsedMs,
      },
    });
  }
  console.log(JSON.stringify({
    event: "search.results",
    dbPath,
    requestedRows: rows,
    actualRows,
    derivedRows,
    warmup,
    iterations,
    coldIterations,
    coldCacheNote: "connectionCold reopens a read-only SQLite connection for every sample; the operating-system file cache is not flushed.",
    results,
  }, replacer));

  if (writeConcurrency > 0) {
    console.log(JSON.stringify({ event: "write-concurrency", result: measureWrites(db, writeConcurrency, libraryId, rootPath) }));
  }
} finally {
  db.close();
  if (!keepDb && !args.db) removeDatabase(dbPath);
}

function seedDatabase(db, count, randomSeed, id, root) {
  const now = Date.now();
  db.exec("DROP TRIGGER IF EXISTS entries_ai; DROP TRIGGER IF EXISTS entries_ad; DROP TRIGGER IF EXISTS entries_au;");
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO libraries(id, name, roots_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, "Benchmark", JSON.stringify([root]), now, now);
    const insertEntry = db.prepare(`INSERT INTO entries(
      id, library_id, parent_id, name, stem, ext, is_dir, size, mtime, depth, kind, path, parent_path, rel_path,
      tombstone, seen_at, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`);
    const insertMembership = db.prepare("INSERT INTO library_entries(entry_id, library_id, rel_path, seen_at, tombstone) VALUES (?, ?, ?, ?, 0)");
    const directories = [];
    const directoryCount = Math.max(1, Math.ceil(count / 1000));
    for (let index = 0; index < directoryCount; index += 1) {
      const name = `Folder-${String(index).padStart(6, "0")}`;
      const path = `${root}/${name}`;
      const entryId = `dir-${index}`;
      directories.push({ entryId, path, name });
      insertEntry.run(entryId, id, null, name, name, "", 1, 0, now - index * 1000, 1, "dir", path, root, name, now, now);
      insertMembership.run(entryId, id, name, now);
    }
    const random = mulberry32(randomSeed);
    const extensions = ["txt", "jpg", "mp4", "mkv", "pdf", "docx", "zip"];
    const chinese = ["资料", "报告", "照片", "电影", "项目", "备份", "合同"];
    for (let index = 0; index < count; index += 1) {
      const directory = directories[index % directories.length];
      const extension = extensions[index % extensions.length];
      const base = index % 17 === 0 ? `${chinese[index % chinese.length]}-${index}` : `Asset-${index}-${Math.floor(random() * 100000)}`;
      const name = `${base}.${extension}`;
      const path = `${directory.path}/${name}`;
      const relPath = `${directory.name}/${name}`;
      const entryId = `file-${index}`;
      const size = Math.floor(random() * 10_000_000);
      const mtime = now - Math.floor(random() * 31_536_000_000);
      insertEntry.run(entryId, id, directory.entryId, name, base, extension, 0, size, mtime, 2, kindFor(extension), path, directory.path, relPath, now, now);
      insertMembership.run(entryId, id, relPath, now);
    }
    db.exec("COMMIT");
    createFtsTriggers(db);
  } catch (error) {
    db.exec("ROLLBACK");
    createFtsTriggers(db);
    throw error;
  }
}

function buildScenarios(db, id, root) {
  const firstPage = searchEntries(db, { libraryId: id, text: "Asset", resultMode: "hits-only", limit: 50 });
  return [
    { name: "empty-hits-only", request: { libraryId: id, text: "", resultMode: "hits-only", limit: 50 }, minimumHits: 50 },
    { name: "name-fts", request: { libraryId: id, text: "Asset-42", resultMode: "hits-only", limit: 50 } },
    { name: "substring-trigram", request: { libraryId: id, text: "set-42", textMode: "substring", resultMode: "hits-only", limit: 50 } },
    { name: "chinese", request: { libraryId: id, text: "资料", resultMode: "hits-only", limit: 50 } },
    { name: "extension-filter", request: { libraryId: id, text: "ext:mkv", resultMode: "hits-only", limit: 50 } },
    { name: "structured-filter", request: { libraryId: id, text: "size:>1mb kind:file", resultMode: "hits-only", limit: 50 } },
    {
      name: "keyset-second-page",
      request: { libraryId: id, text: "Asset", resultMode: "hits-only", limit: 50, cursor: firstPage.nextCursor },
      excludedEntryIds: firstPage.hits.map((hit) => hit.entryId),
    },
    { name: "direct-children", directory: `${root}/Folder-000000`, options: { limit: 50 }, minimumHits: 50 },
  ];
}

function measureScenario(db, scenario, count, hot, warmupCount = 0) {
  const run = () => runScenario(db, scenario);
  if (hot) for (let index = 0; index < warmupCount; index += 1) run();
  const elapsed = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    run();
    elapsed.push(performance.now() - started);
  }
  return elapsed;
}

function measureColdConnections(path, scenario, count) {
  const elapsed = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout = 5000; PRAGMA query_only = ON;");
      runScenario(db, scenario);
    } finally {
      db.close();
    }
    elapsed.push(performance.now() - started);
  }
  return elapsed;
}

function runScenario(db, scenario) {
  return scenario.directory
    ? listDirectoryChildren(db, "benchmark-library", scenario.directory, scenario.options)
    : searchEntries(db, scenario.request);
}

function validateScenario(scenario, sample) {
  if (sample.hits.length < (scenario.minimumHits ?? 1)) {
    return { ok: false, message: `expected at least ${scenario.minimumHits ?? 1} hits, received ${sample.hits.length}` };
  }
  const excluded = new Set(scenario.excludedEntryIds ?? []);
  const overlap = sample.hits.filter((hit) => excluded.has(hit.entryId));
  return overlap.length === 0
    ? { ok: true, message: "result shape and page uniqueness verified" }
    : { ok: false, message: `keyset page repeated ${overlap.length} entries` };
}

function measureWrites(db, count, id, root) {
  const writer = db.prepare(`INSERT INTO entries(
    id, library_id, parent_id, name, stem, ext, is_dir, size, mtime, depth, kind, path, parent_path, rel_path,
    tombstone, seen_at, indexed_at
  ) VALUES (?, ?, NULL, ?, ?, 'txt', 0, 10, ?, 1, 'text', ?, ?, ?, 0, ?, ?)`);
  const membership = db.prepare("INSERT INTO library_entries(entry_id, library_id, rel_path, seen_at, tombstone) VALUES (?, ?, ?, ?, 0)");
  const queryRequest = { libraryId: id, text: "concurrency", resultMode: "hits-only", limit: 50 };
  const queryElapsed = [];
  const started = performance.now();
  db.exec("BEGIN");
  try {
    for (let index = 0; index < count; index += 1) {
      const now = Date.now();
      const name = `concurrency-${index}.txt`;
      const path = `${root}/${name}`;
      const entryId = `concurrent-${index}`;
      writer.run(entryId, id, name, `concurrency-${index}`, now, path, root, name, now, now);
      membership.run(entryId, id, name, now);
      const queryStarted = performance.now();
      searchEntries(db, queryRequest);
      queryElapsed.push(performance.now() - queryStarted);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    rowsWritten: count,
    elapsedMs: round(performance.now() - started),
    queryDuringWrite: summarize(queryElapsed),
    walBytes: null,
    note: "This CLI mode uses one synchronous connection; real Electron Query/Writer Worker lock contention must be measured in the desktop process.",
  };
}

function createFtsTriggers(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
      INSERT INTO entry_fts(rowid, name, stem, parent_path, rel_path)
      VALUES (new.rowid, new.name, new.stem, new.parent_path, new.rel_path);
    END;
    CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
      INSERT INTO entry_fts(entry_fts, rowid, name, stem, parent_path, rel_path)
      VALUES ('delete', old.rowid, old.name, old.stem, old.parent_path, old.rel_path);
    END;
    CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
      INSERT INTO entry_fts(entry_fts, rowid, name, stem, parent_path, rel_path)
      VALUES ('delete', old.rowid, old.name, old.stem, old.parent_path, old.rel_path);
      INSERT INTO entry_fts(rowid, name, stem, parent_path, rel_path)
      VALUES (new.rowid, new.name, new.stem, new.parent_path, new.rel_path);
    END;
  `);
}

function removeDatabase(path) {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    minMs: round(sorted[0] ?? 0),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted.at(-1) ?? 0),
    meanMs: round(values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0),
  };
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") parsed.help = true;
    else if (token === "--keep") parsed.keep = true;
    else if (token.startsWith("--")) parsed[token.slice(2)] = argv[index + 1]?.startsWith("-") ? true : argv[++index];
  }
  return parsed;
}

function positiveInt(value, fallback, allowZero = false) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || (allowZero ? number < 0 : number <= 0)) throw new Error(`expected an integer, received ${value}`);
  return number;
}

function kindFor(extension) {
  if (extension === "jpg") return "image";
  if (["mp4", "mkv"].includes(extension)) return "video";
  if (["pdf", "docx"].includes(extension)) return "document";
  return "file";
}

function mulberry32(value) {
  return () => {
    let next = value += 0x6D2B79F5;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function replacer(_key, value) {
  return typeof value === "bigint" ? Number(value) : value;
}

function printUsage() {
  console.log(`Usage: npm run benchmark:search -- [options]

Options:
  --db PATH                 Use or create a persistent database at PATH
  --rows N                  Fixture file rows (default: 100000)
  --seed N                  Deterministic fixture seed (default: 42)
  --warmup N                Hot-cache warmup calls per scenario (default: 10)
  --iterations N            Measured hot-cache calls per scenario (default: 100)
  --cold-iterations N       Reopened-connection samples (default: min(10, iterations))
  --write-concurrency N     Add N writes and query after each write
  --skip-derived            Skip FTS/n-gram rebuild for fixture-generation profiling only
  --keep                    Keep an automatically created database
  --help                    Show this help
`);
}
