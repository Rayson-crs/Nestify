import type { RuleSet } from "./types.ts";

export const BUILTIN_RULESETS: RuleSet[] = [
  {
    id: "download-inbox",
    name: "默认下载整理",
    description: "Dry-run by default. Rule 4 disabled.",
    dryRunDefault: true,
    collision: "suffix",
    rules: [
      {
        id: "rename-dir-from-single-video",
        enabled: true,
        priority: 1,
        action: "rename_dir",
        template: "{children.main_video.stem}",
        match: {
          all: [
            { field: "is_dir", eq: true },
            { field: "children.video_count", eq: 1 },
            { field: "name", ne_field: "children.main_video.stem" },
          ],
        },
      },
      {
        id: "flatten-single-child-dir",
        enabled: true,
        priority: 2,
        action: "flatten_dir",
        match: {
          all: [
            { field: "is_dir", eq: true },
            { field: "children.dir_count", eq: 1 },
            { field: "children.useful_file_count", eq: 0 },
          ],
        },
      },
      {
        id: "strip-release-tags",
        enabled: true,
        priority: 3,
        action: "rename_file",
        template: "{name.regex_replace('\\[.*?\\]', '').regex_replace('(?i)(1080P|2160P|4K|WEB-DL|BluRay)', '').trim()}{ext}",
        match: {
          all: [
            { field: "is_dir", eq: false },
            { field: "name", regex: "(?i)(\\[.*?\\]|1080P|2160P|4K|WEB-DL|BluRay)" },
          ],
        },
      },
      {
        id: "move-videos-to-videos-folder",
        enabled: false,
        priority: 4,
        action: "move",
        template: "Videos/{name}{ext}",
        match: {
          all: [
            { field: "is_dir", eq: false },
            { field: "ext", in: [".mp4", ".mkv", ".avi", ".mov"] },
          ],
        },
      },
      {
        id: "archive-already-extracted",
        enabled: true,
        priority: 5,
        action: "delete_to_quarantine",
        reason: "已存在同名解压目录，默认隔离压缩包",
        match: {
          all: [
            { field: "kind", eq: "archive" },
            { field: "peer_dir.exists", eq: true },
          ],
        },
      },
    ],
  },
  {
    id: "media-rename",
    name: "媒体路径改名",
    description: "a/b/c/a.txt -> b.txt via {grandparent}{ext}, or c.txt via {parent}{ext}",
    dryRunDefault: true,
    collision: "suffix",
    rules: [
      {
        id: "rename-to-grandparent",
        enabled: true,
        priority: 1,
        action: "rename_file",
        template: "{grandparent}{ext}",
        match: { all: [{ field: "is_dir", eq: false }] },
      },
      {
        id: "rename-to-parent",
        enabled: false,
        priority: 2,
        action: "rename_file",
        template: "{parent}{ext}",
        match: { all: [{ field: "is_dir", eq: false }] },
      },
    ],
  },
];

export function listBuiltinProfiles(): RuleSet[] {
  return BUILTIN_RULESETS.map((profile) => structuredClone(profile))
}

export function getBuiltinProfile(id: string): RuleSet | undefined {
  const profile = BUILTIN_RULESETS.find((item) => item.id === id)
  return profile ? structuredClone(profile) : undefined
}
