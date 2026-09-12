import type { Entry, EntryKind } from "@nestify/shared";

const COVER_STEMS = new Set([
  "cover",
  "poster",
  "folder",
  "fanart",
  "backdrop",
  "thumb",
  "front",
  "back",
  "disc",
  "banner",
]);

const COVER_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);

export interface MainVideoView {
  stem: string;
  name: string;
  ext: string;
}

export interface ChildrenView {
  count: number;
  file_count: number;
  dir_count: number;
  useful_file_count: number;
  video_count: number;
  image_count: number;
  main_kind: EntryKind | null;
  main_name: string | null;
  main_stem: string | null;
  names: string[];
  has_unique_video: boolean;
  main_video: MainVideoView | null;
}

export interface RuleContext {
  entry: Entry;
  id: string;
  name: string;
  stem: string;
  filename: string;
  ext: string;
  ext_no_dot: string;
  parent: string;
  grandparent: string;
  drive: string;
  root: string;
  depth: number;
  kind: EntryKind;
  is_dir: boolean;
  isDir: boolean;
  size: number;
  mtime: number;
  ctime: number;
  date_created: number;
  date_modified: number;
  path: string;
  relPath: string;
  children: ChildrenView;
  peer_dir: { exists: boolean };
  seq: number;
  parent_seq: number;
}

export interface ContextIndex {
  byId: Map<string, Entry>;
  byParentId: Map<string, Entry[]>;
  byPath: Map<string, Entry>;
  siblings: Map<string, Entry[]>;
}

export function splitPathParts(path: string): string[] {
  return path.split(/[\\/]+/).filter((part) => part.length > 0 && part !== ".");
}

export function ancestorName(path: string, n: number): string {
  const levels = Math.abs(n);
  if (levels <= 0) return basename(path);
  const parts = splitPathParts(path);
  const idx = parts.length - 1 - levels;
  return idx >= 0 ? (parts[idx] ?? "") : "";
}

export function buildContextIndex(entries: readonly Entry[]): ContextIndex {
  const byId = new Map<string, Entry>();
  const byParentId = new Map<string, Entry[]>();
  const byPath = new Map<string, Entry>();
  const siblings = new Map<string, Entry[]>();

  for (const entry of entries) {
    if (entry.tombstone) continue;
    byId.set(entry.id, entry);
    byPath.set(normalizePathKey(entry.path), entry);
    const parentKey = entry.parentId ?? entry.parentPath ?? "";
    const group = byParentId.get(parentKey);
    if (group) group.push(entry);
    else byParentId.set(parentKey, [entry]);

    const siblingKey = entry.parentPath ?? entry.parentId ?? "";
    const sibs = siblings.get(siblingKey);
    if (sibs) sibs.push(entry);
    else siblings.set(siblingKey, [entry]);
  }

  return { byId, byParentId, byPath, siblings };
}

export function listDirectChildren(entry: Entry, index: ContextIndex): Entry[] {
  return index.byParentId.get(entry.id) ?? [];
}

export function isSidecarFile(entry: Entry, children: readonly Entry[]): boolean {
  if (entry.isDir) return false;
  if (entry.kind === "subtitle") return true;
  if (entry.ext === ".nfo") return true;

  const videos = children.filter((child) => !child.isDir && child.kind === "video");
  if (entry.kind === "image" || COVER_EXTS.has(entry.ext)) {
    const stem = entry.stem.toLowerCase();
    if (COVER_STEMS.has(stem)) return true;
    if (videos.some((video) => video.stem.toLowerCase() === stem)) return true;
    if (videos.length > 0) return true;
  }
  return false;
}

export function buildChildrenView(entry: Entry, index: ContextIndex): ChildrenView {
  const children = listDirectChildren(entry, index);
  const files = children.filter((child) => !child.isDir);
  const dirs = children.filter((child) => child.isDir);
  const videos = files.filter((child) => child.kind === "video");
  const images = files.filter((child) => child.kind === "image");
  const useful = files.filter((child) => !isSidecarFile(child, children));
  const mainVideo = videos.length === 1 ? videos[0]! : null;
  const mainFile = useful.length === 1 ? useful[0]! : mainVideo;

  return {
    count: children.length,
    file_count: files.length,
    dir_count: dirs.length,
    useful_file_count: useful.length,
    video_count: videos.length,
    image_count: images.length,
    main_kind: mainFile?.kind ?? (dirs.length === 1 && files.length === 0 ? "dir" : null),
    main_name: mainFile?.name ?? null,
    main_stem: mainFile?.stem ?? mainVideo?.stem ?? null,
    names: children.map((child) => child.name),
    has_unique_video: videos.length === 1,
    main_video: mainVideo
      ? { stem: mainVideo.stem, name: mainVideo.name, ext: mainVideo.ext }
      : null,
  };
}

export function buildRuleContext(
  entry: Entry,
  index: ContextIndex,
  extras: { seq?: number; parent_seq?: number } = {},
): RuleContext {
  const parent = ancestorName(entry.path, 1);
  const grandparent = ancestorName(entry.path, 2);
  const children = buildChildrenView(entry, index);
  const siblingKey = entry.parentPath ?? entry.parentId ?? "";
  const siblings = index.siblings.get(siblingKey) ?? [];
  const peerDir = siblings.some(
    (item) => item.id !== entry.id && item.isDir && item.name.toLowerCase() === entry.stem.toLowerCase(),
  );

  const parts = splitPathParts(entry.path);
  const drive = /^[A-Za-z]:$/.test(parts[0] ?? "") ? (parts[0] ?? "") : "";
  const root = drive ? (parts[1] ?? drive) : (parts[0] ?? "");
  return {
    entry,
    id: entry.id,
    name: entry.stem,
    stem: entry.stem,
    filename: entry.name,
    ext: entry.ext,
    ext_no_dot: entry.ext.replace(/^\./, ""),
    parent,
    grandparent,
    drive,
    root,
    depth: entry.depth,
    kind: entry.kind,
    is_dir: entry.isDir,
    isDir: entry.isDir,
    size: entry.size,
    mtime: entry.mtime,
    ctime: entry.ctime,
    date_created: entry.ctime,
    date_modified: entry.mtime,
    path: entry.path,
    relPath: entry.relPath,
    children,
    peer_dir: { exists: peerDir },
    seq: extras.seq ?? 0,
    parent_seq: extras.parent_seq ?? 0,
  };
}

export function getContextValue(ctx: RuleContext, field: string): unknown {
  const trimmed = field.trim();
  const ancestor = trimmed.match(/^ancestor\((-?\d+)\)$/);
  if (ancestor) return ancestorName(ctx.path, Number(ancestor[1]));

  const aliased = aliasField(trimmed);
  return readPath(ctx, aliased);
}

function aliasField(field: string): string {
  switch (field) {
    case "isDir":
      return "is_dir";
    case "children.fileCount":
      return "children.file_count";
    case "children.dirCount":
      return "children.dir_count";
    case "children.usefulFileCount":
      return "children.useful_file_count";
    case "children.videoCount":
      return "children.video_count";
    case "children.imageCount":
      return "children.image_count";
    case "children.mainKind":
      return "children.main_kind";
    case "children.mainName":
      return "children.main_name";
    case "children.mainStem":
      return "children.main_stem";
    case "children.hasUniqueVideo":
      return "children.has_unique_video";
    default:
      return field;
  }
}

function readPath(source: unknown, field: string): unknown {
  const parts = field.split(".");
  let current: unknown = source;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function normalizePathKey(path: string): string {
  return path.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
}

function basename(path: string): string {
  const parts = splitPathParts(path);
  return parts.at(-1) ?? "";
}
