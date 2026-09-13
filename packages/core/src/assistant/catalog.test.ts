import assert from "node:assert/strict";
import { test } from "node:test";
import { applyChain } from "../rules/chain.ts";
import { getContextValue } from "../rules/context.ts";
import { CHAIN_FUNCS } from "../rules/placeholders.ts";
import { parseSearchQuery, SEARCH_FILTER_KEYS } from "../search/parse.ts";
import {
  ASSISTANT_CATALOG,
  comparisonSearchFields,
  itemsForContext,
  searchFieldDefinitions,
} from "./catalog.ts";
import { chainHelpNames, describeAssistantItem } from "./help.ts";
import { insertChainAtCursor, insertRuleChainAtCursor, parseChainCall, parseSearchQueryToParts, resolveInsertValue } from "./insert.ts";
import { previewRenameTemplate } from "./preview.ts";

const RENAME_FIELD_SAMPLE = {
  path: "/lib/movie/Avatar.mkv",
  name: "Avatar",
  stem: "Avatar",
  filename: "Avatar.mkv",
  ext: ".mkv",
  ext_no_dot: "mkv",
  parent: "movie",
  grandparent: "lib",
  drive: "",
  root: "lib",
  depth: 2,
  kind: "video",
  is_dir: false,
  isDir: false,
  size: 1024,
  mtime: 0,
  ctime: 0,
  date_created: 0,
  date_modified: 0,
  relPath: "movie/Avatar.mkv",
  children: {
    count: 1,
    file_count: 1,
    dir_count: 0,
    useful_file_count: 1,
    video_count: 1,
    image_count: 0,
    main_kind: "video",
    main_name: "Avatar.mkv",
    main_stem: "Avatar",
    names: ["Avatar.mkv"],
    has_unique_video: true,
    main_video: { stem: "Avatar", name: "Avatar.mkv", ext: ".mkv" },
  },
  peer_dir: { exists: false },
  seq: 1,
  parent_seq: 1,
  id: "1",
  entry: {} as never,
} as const;

test("itemsForContext hides dup from scope filters and search syntax from rename templates", () => {
  const search = itemsForContext("search");
  const scope = itemsForContext("scope-filter");
  const group = itemsForContext("rename-group-filter");
  const rename = itemsForContext("rename-template");
  const mtime = itemsForContext("search-field", "mtime");

  assert.ok(search.some((item) => item.id === "dup-true"));
  assert.equal(scope.some((item) => item.searchFields?.includes("dup")), false);
  assert.equal(group.some((item) => item.searchFields?.includes("dup")), false);
  assert.ok(scope.some((item) => item.id === "recipe-empty-dir"));
  assert.ok(scope.some((item) => item.id === "recipe-kind-video"));
  assert.ok(rename.some((item) => item.value === "{children.main_stem}"));
  assert.ok(rename.some((item) => item.value === "{children.main_video.stem}"));
  assert.equal(rename.some((item) => item.value === "AND" || item.value.includes("mtime:")), false);
  assert.ok(mtime.every((item) => item.searchFields?.includes("mtime")));
  assert.equal(mtime.some((item) => item.value === "video"), false);
  assert.ok(search.some((item) => item.id === "op-not"));
  assert.ok(search.some((item) => item.id === "has-nfo"));
  assert.ok(search.some((item) => item.id === "recipe-unique-video"));
  assert.ok(search.some((item) => item.id === "recipe-useful-one"));
  assert.ok(search.some((item) => item.id === "recipe-same-stem"));
  assert.ok(search.some((item) => item.id === "recipe-orphan-sidecar"));
  assert.ok(searchFieldDefinitions().some((field) => field.value === "ctime"));
  assert.ok(searchFieldDefinitions().some((field) => field.value === "useful_file_count"));
  assert.ok(rename.some((item) => item.value === ".take_parent_if_numeric()"));
  assert.ok(rename.some((item) => item.value === ".ensure_ext()"));
});

test("catalog live items stay inside the search and rename engines", () => {
  const chainSet = new Set<string>(CHAIN_FUNCS);
  const comparison = comparisonSearchFields();
  assert.ok(comparison.has("name_length"));
  assert.ok(comparison.has("ctime"));
  assert.ok(searchFieldDefinitions().some((field) => field.value === "child_count"));
  assert.ok(searchFieldDefinitions().some((field) => field.value === "unique_video"));

  for (const item of ASSISTANT_CATALOG) {
    if (item.hidden) continue;
    if (item.engine === "search-filter") {
      const field = item.searchFields?.find((name) => name !== "text");
      assert.ok(field && SEARCH_FILTER_KEYS.has(field), `${item.id} uses unknown filter ${field}`);
      const inserted = resolveInsertValue(item, "search");
      if (item.kind === "field") {
        assert.equal(inserted, `${field}:`, `${item.id} should insert an editable field prefix`);
        continue;
      }
      const parsed = parseSearchQuery(inserted);
      assert.ok(hasParsedFilter(parsed, field), `${item.id} did not parse as ${field}: ${inserted}`);
    }
    if (item.engine === "search-recipe") {
      const parsed = parseSearchQuery(item.value);
      assert.ok(
        parsed.textTerms.length > 0
          || parsed.ext
          || parsed.kind
          || parsed.size
          || parsed.mtime
          || parsed.has
          || parsed.missing
          || parsed.ctime
          || parsed.uniqueVideo
          || parsed.isSidecar
          || parsed.windowsIllegal
          || parsed.nameDigits
          || parsed.childCount
          || parsed.fileCount
          || parsed.dirCount
          || parsed.usefulFileCount
          || parsed.sameStem
          || parsed.orphanSidecar
          || parsed.nameLength
          || parsed.nameDate
          || parsed.pathDate
          || parsed.datePattern
          || parsed.folderName
          || parsed.fileName
          || parsed.parent
          || parsed.path,
        `${item.id} recipe did not parse: ${item.value}`,
      );
    }
    if (item.engine === "rename-chain") {
      const parsed = parseChainCall(item.value) ?? {
        name: item.value.replace(/^\./, "").replace(/\(.*\)$/, ""),
        args: [],
      };
      assert.ok(chainSet.has(parsed.name as (typeof CHAIN_FUNCS)[number]), `${item.id} unknown chain ${parsed.name}`);
      assert.doesNotThrow(() => applyChain("Avatar.2009 [4K]", parsed.name, parsed.args));
      if (parsed.name === "remove_year") {
        assert.equal(applyChain("Avatar.2009 [4K]", parsed.name, parsed.args), "Avatar [4K]");
        assert.equal(applyChain("Avatar (2009)", parsed.name, parsed.args), "Avatar");
      }
    }
    if (item.engine === "rename-field") {
      const field = item.value.replace(/^\{|\}$/g, "");
      const value = getContextValue(RENAME_FIELD_SAMPLE as never, field);
      assert.notEqual(value, undefined, `${item.id} field ${field} is missing from RuleContext`);
    }
  }
});

test("insertChainAtCursor attaches to the expression under the caret", () => {
  const next = insertChainAtCursor("{parent}/{name}{ext}", ".trim()", 12);
  assert.equal(next.value, "{parent}/{name.trim()}{ext}");
});

test("parseSearchQueryToParts keeps existing filters instead of resetting", () => {
  const parts = parseSearchQueryToParts("kind:dir AND child_count:=0");
  assert.deepEqual(parts.map((part) => `${part.joiner}:${part.field}:${part.operator}${part.value}`), [
    "AND:kind:dir",
    "AND:child_count:=0",
  ]);
});

test("name filters insert their field prefix directly for inline editing", () => {
  const item = ASSISTANT_CATALOG.find((candidate) => candidate.id === "search-folder-name");
  assert.ok(item);
  assert.equal(item.kind, "field");
  assert.equal(item.engine, "search-filter");
  assert.equal(item.params, undefined);
  assert.equal(resolveInsertValue(item, "search"), "folder_name:");
  assert.equal(resolveInsertValue(item, "scope-filter"), "folder_name:");

  const fileItem = ASSISTANT_CATALOG.find((candidate) => candidate.id === "search-file-name");
  assert.ok(fileItem);
  assert.equal(fileItem.kind, "field");
  assert.equal(resolveInsertValue(fileItem, "search"), "file_name:");
});

test("rule assistant exposes shared string sources and chains", () => {
  const scope = itemsForContext("scope-filter");
  assert.ok(scope.some((item) => item.id === "rule-field-name"));
  assert.ok(scope.some((item) => item.id === "rule-field-parent"));
  assert.ok(scope.some((item) => item.value === ".slice(0, 10)"));
  assert.ok(scope.some((item) => item.value === ".to_simplified()"));

  const field = scope.find((item) => item.id === "rule-field-filename");
  const chain = scope.find((item) => item.value === ".trim()");
  assert.ok(field);
  assert.ok(chain);
  assert.equal(resolveInsertValue(field, "scope-filter"), "filename:");
  assert.equal(resolveInsertValue(chain, "scope-filter"), "name.trim():");
  assert.deepEqual(insertRuleChainAtCursor("name:", ".slice(0, 2)", 5), {
    value: "name.slice(0, 2):",
    caret: 17,
  });
});

function hasParsedFilter(parsed: ReturnType<typeof parseSearchQuery>, field: string): boolean {
  switch (field) {
    case "ext":
      return (parsed.ext?.length ?? 0) > 0;
    case "parent":
      return Boolean(parsed.parent);
    case "folder_name":
      return Boolean(parsed.folderName);
    case "file_name":
      return Boolean(parsed.fileName);
    case "path":
      return Boolean(parsed.path);
    case "kind":
    case "type":
      return Boolean(parsed.kind);
    case "size":
      return Boolean(parsed.size);
    case "mtime":
      return Boolean(parsed.mtime);
    case "ctime":
      return Boolean(parsed.ctime);
    case "depth":
      return Boolean(parsed.depth);
    case "name_date":
      return Boolean(parsed.nameDate);
    case "path_date":
      return Boolean(parsed.pathDate);
    case "date_pattern":
      return Boolean(parsed.datePattern);
    case "name_length":
      return Boolean(parsed.nameLength);
    case "name_digits":
      return Boolean(parsed.nameDigits);
    case "child_count":
      return Boolean(parsed.childCount);
    case "file_count":
      return Boolean(parsed.fileCount);
    case "dir_count":
      return Boolean(parsed.dirCount);
    case "useful_file_count":
      return Boolean(parsed.usefulFileCount);
    case "same_stem":
      return parsed.sameStem !== undefined;
    case "orphan_sidecar":
      return parsed.orphanSidecar !== undefined;
    case "has":
      return Boolean(parsed.has);
    case "missing":
      return Boolean(parsed.missing);
    case "unique_video":
      return parsed.uniqueVideo !== undefined;
    case "is_sidecar":
      return parsed.isSidecar !== undefined;
    case "windows_illegal":
      return parsed.windowsIllegal !== undefined;
    case "dup":
      return parsed.dup !== undefined;
    default:
      return false;
  }
}


test("previewRenameTemplate renders current file trial for rename templates", () => {
  assert.equal(previewRenameTemplate("{name}{ext}"), "Avatar.mkv");
  assert.equal(previewRenameTemplate("{children.main_video.stem}{ext}"), "Avatar.mkv");
  assert.equal(previewRenameTemplate("{parent}_{name}{ext}", "2.mp4"), "movie_2.mp4");
});

test("every live catalog item has usage help and an effect example", () => {
  const chainNames = new Set<string>();
  for (const item of ASSISTANT_CATALOG) {
    if (item.hidden) continue;
    const info = describeAssistantItem(item);
    assert.ok(info.help.trim(), `${item.id} missing help`);
    assert.ok(info.example.trim(), `${item.id} missing example`);
    if (item.engine === "rename-chain") {
      const parsed = parseChainCall(item.value) ?? {
        name: item.value.replace(/^\./, "").replace(/\(.*\)$/s, ""),
        args: [],
      };
      chainNames.add(parsed.name);
      assert.notEqual(info.help, `插入 ${item.value}，用于「${item.label}」。`, `${item.id} fell back to generic help`);
    }
  }
  const documented = new Set(chainHelpNames());
  for (const name of chainNames) {
    assert.ok(documented.has(name), `missing chain help for ${name}`);
  }
});
