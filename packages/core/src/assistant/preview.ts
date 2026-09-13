import type { RuleContext } from "../rules/context.ts";
import { renderTemplate } from "../rules/template.ts";

export const SAMPLE_RENAME_FILE = "Avatar.mkv";

export function previewRenameTemplate(template: string, fileName = SAMPLE_RENAME_FILE): string {
  if (!template.trim()) return "";
  try {
    return renderTemplate(template, sampleRenameContext(fileName));
  } catch {
    return "";
  }
}

export function sampleRenameContext(fileName = SAMPLE_RENAME_FILE): RuleContext {
  const base = fileName.replace(/\\/g, "/").split("/").pop() || SAMPLE_RENAME_FILE;
  const lastDot = base.lastIndexOf(".");
  const hasExt = lastDot > 0;
  const stem = hasExt ? base.slice(0, lastDot) : base;
  const ext = hasExt ? base.slice(lastDot) : "";
  return {
    path: `/lib/movie/${base}`,
    name: stem,
    stem,
    filename: base,
    folder_name: ext ? "" : base,
    file_name: ext ? base : "",
    ext,
    ext_no_dot: ext.replace(/^\./, ""),
    parent: "movie",
    grandparent: "lib",
    drive: "",
    root: "lib",
    depth: 2,
    kind: ext ? "video" : "dir",
    is_dir: !ext,
    isDir: !ext,
    size: 1024,
    mtime: 0,
    ctime: 0,
    date_created: 0,
    date_modified: 0,
    relPath: `movie/${base}`,
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
  };
}
