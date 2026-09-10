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
  {
    // 步骤链版下载整理：与 download-inbox 行为一致，但通过结构化 steps 描述，
    // 演示 IF/ELSE/FOR/transform 怎么落地；切换此 profile 即可在 plan 面板观察到
    // 同样的 ops，但 evaluator.trace 会输出更详细的步骤级调试信息。
    id: "download-inbox-stepped",
    name: "默认下载整理 · 步骤链版",
    description: "演示：单视频目录改名为视频 stem、空单层目录拍平、剥离资源标签、视频移入 Videos、已解压的归档进入隔离区。",
    dryRunDefault: true,
    collision: "suffix",
    rules: [
      {
        id: "rename-dir-from-single-video",
        enabled: true,
        priority: 1,
        action: "rename_dir",
        template: "{children.main_video.stem}",
        reason: "video/1080p-clip",
        steps: [
          {
            id: "rename-dir:filter",
            kind: "filter",
            when: {
              all: [
                { field: "is_dir", eq: true },
                { field: "children.video_count", eq: 1 },
                { field: "name", ne_field: "children.main_video.stem" },
              ],
            },
            target: { kind: "self" },
            why: "保留：单视频目录，且目录名与视频名不一致",
          },
          {
            id: "rename-dir:extract-main",
            kind: "transform",
            from: { kind: "self" },
            as: "mainStem",
            expr: "{children.main_video.stem}",
            why: "提取主视频文件名作为新目录名",
          },
          {
            id: "rename-dir:action",
            kind: "action",
            action: "rename_dir",
            target: { kind: "self" },
            template: "{scope.last.mainStem}",
            reason: "把目录改名为主视频 stem",
          },
        ],
      },
      {
        id: "flatten-single-child-dir",
        enabled: true,
        priority: 2,
        action: "flatten_dir",
        template: "",
        reason: "空单层目录",
        steps: [
          {
            id: "flatten:filter",
            kind: "filter",
            when: {
              all: [
                { field: "is_dir", eq: true },
                { field: "children.dir_count", eq: 1 },
                { field: "children.useful_file_count", eq: 0 },
              ],
            },
            target: { kind: "self" },
            why: "保留：仅含 1 个子目录且无非视频文件",
          },
          {
            id: "flatten:action",
            kind: "action",
            action: "flatten_dir",
            target: { kind: "self" },
            reason: "把子目录拍平到当前目录",
          },
        ],
      },
      {
        id: "strip-release-tags",
        enabled: true,
        priority: 3,
        action: "rename_file",
        template:
          "{name.regex_replace('\\\\[[^\\\\]]*\\\\]', '').regex_replace('(?i)(1080P|2160P|4K|WEB-DL|BluRay)', '').trim()}{ext}",
        reason: "disc/quality tags",
        steps: [
          {
            id: "strip:filter",
            kind: "filter",
            when: {
              all: [
                { field: "is_dir", eq: false },
                {
                  field: "name",
                  regex: "(?i)(\\\\[[^\\\\]]*\\\\]|1080P|2160P|4K|WEB-DL|BluRay)",
                },
              ],
            },
            target: { kind: "self" },
            why: "保留：文件名包含方括号或质量标签",
          },
          {
            id: "strip:clean-stem",
            kind: "transform",
            from: { kind: "self" },
            as: "cleanStem",
            expr:
              "{name.regex_replace('\\\\[[^\\\\]]*\\\\]', '').regex_replace('(?i)(1080P|2160P|4K|WEB-DL|BluRay)', '').trim()}",
            why: "剥离方括号与质量标签得到干净 stem",
          },
          {
            id: "strip:action",
            kind: "action",
            action: "rename_file",
            target: { kind: "self" },
            template: "{scope.last.cleanStem}{ext}",
            reason: "改名：把清理后的 stem 写回文件名",
          },
        ],
      },
      {
        id: "move-videos-to-videos-folder",
        enabled: false,
        priority: 4,
        action: "move",
        template: "Videos/{name}{ext}",
        reason: "video -> Videos",
        steps: [
          {
            id: "move:filter",
            kind: "filter",
            when: {
              all: [
                { field: "is_dir", eq: false },
                { field: "ext", in: [".mp4", ".mkv", ".avi", ".mov"] },
              ],
            },
            target: { kind: "self" },
            why: "保留：视频文件",
          },
          {
            id: "move:action",
            kind: "action",
            action: "move",
            target: { kind: "self" },
            template: "Videos/{name}{ext}",
            reason: "移动：把视频统一放进 Videos 子目录",
          },
        ],
      },
      {
        id: "archive-already-extracted",
        enabled: true,
        priority: 5,
        action: "delete_to_quarantine",
        reason: "已存在同名解压目录，默认隔离压缩包",
        steps: [
          {
            id: "archive:filter",
            kind: "filter",
            when: {
              all: [{ field: "kind", eq: "archive" }, { field: "peer_dir.exists", eq: true }],
            },
            target: { kind: "self" },
            why: "保留：归档文件 + 同名解压目录已存在",
          },
          {
            id: "archive:action",
            kind: "action",
            action: "delete_to_quarantine",
            target: { kind: "self" },
            reason: "隔离：避免重复提取",
          },
        ],
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
