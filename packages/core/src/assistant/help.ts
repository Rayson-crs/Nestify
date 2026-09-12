import { parseChainCall } from "./insert.ts";
import type { AssistantItem } from "./types.ts";

export type AssistantHelp = {
  help: string;
  example: string;
};

const CHAIN_HELP: Record<string, AssistantHelp> = {
  trim: {
    help: "去掉当前字段首尾空格。点名称后挂到光标所在的 {字段} 上，例如 {name.trim()}。",
    example: "` Avatar ` → `Avatar`",
  },
  collapse_space: {
    help: "把连续空白收成单个空格，并去掉首尾空白。",
    example: "`Avatar   2009` → `Avatar 2009`",
  },
  remove_space: {
    help: "去掉字段里的全部空白，包括空格和换行。",
    example: "`Avatar 2009` → `Avatar2009`",
  },
  sanitize: {
    help: "把 Windows 非法文件名字符换成下划线，并去掉尾部的点和空格。",
    example: "`Avatar:? ` → `Avatar_`",
  },
  remove_ads: {
    help: "去掉网址和带「广告」字样的括号文字。",
    example: "`www.site.com-阿凡达` → `阿凡达`",
  },
  dedupe: {
    help: "按字符去重，只保留第一次出现的字符。",
    example: "`aaabcc` → `abc`",
  },
  normalize: {
    help: "按 Unicode NFKC 归一，全角字母数字会靠近半角。",
    example: "`Ａｖａｔａｒ` → `Avatar`",
  },
  to_halfwidth: {
    help: "把全角字符转成半角，全角空格变成普通空格。",
    example: "`Ａｖａｔａｒ：２` → `Avatar:2`",
  },
  remove_punctuation: {
    help: "去掉中英文标点，保留文字、数字和空白。",
    example: "`Avatar, 2009!` → `Avatar 2009`",
  },
  remove_brackets: {
    help: "只去掉括号字符，括号里的内容会留下来。",
    example: "`[4K]阿凡达` → `4K阿凡达`",
  },
  remove_bracket_content: {
    help: "去掉括号及其中内容，不把点号改成空格。",
    example: "`[4K]阿凡达.2009.副本` → `阿凡达.2009.副本`",
  },
  remove_copy_suffix: {
    help: "去掉末尾的「副本」「Copy」或 (1) 这类副本后缀。",
    example: "`阿凡达 - 副本` → `阿凡达`",
  },
  collapse_dots: {
    help: "把点号改成空格，并合并连续分隔符。不会去掉 [4K] 这类括号。",
    example: "`[4K]阿凡达.2009.副本` → `[4K]阿凡达 2009 副本`",
  },
  strip_ext_in_name: {
    help: "去掉名字中间或末尾误带的常见扩展名。",
    example: "`阿凡达.mkv` → `阿凡达`",
  },
  remove_edition_tags: {
    help: "去掉 BluRay、WEB-DL、HDR、REPACK 等发行标签。",
    example: "`Avatar BluRay HDR` → `Avatar`",
  },
  filename_safe_colon: {
    help: "把英文冒号换成全角冒号，避免 Windows 文件名非法。",
    example: "`21:00 阿凡达` → `21：00 阿凡达`",
  },
  zh_space_fix: {
    help: "在中文和英文、数字之间补空格。",
    example: "`阿凡达2009` → `阿凡达 2009`",
  },
  remove_emoji: {
    help: "去掉 emoji 符号，并合并留下的空白。",
    example: "`阿凡达🔥` → `阿凡达`",
  },
  replace: {
    help: "把原文字全部替换成新文字。点名称后会先填写两个参数。",
    example: "`.replace('旧','新')`  ：`旧名字` → `新名字`",
  },
  regex_replace: {
    help: "按正则全局替换。点名称后填写正则和替换内容。",
    example: "`.regex_replace('\\\\s+', '-')`  ：`Avatar  2009` → `Avatar-2009`",
  },
  spaces_to_underscore: {
    help: "把空白改成下划线。",
    example: "`Avatar 2009` → `Avatar_2009`",
  },
  underscore_to_space: {
    help: "把下划线和短横线改成空格。",
    example: "`Avatar_2009-Cut` → `Avatar 2009 Cut`",
  },
  upper: {
    help: "全部转为大写。",
    example: "`avatar` → `AVATAR`",
  },
  lower: {
    help: "全部转为小写。",
    example: "`Avatar` → `avatar`",
  },
  title: {
    help: "每个词的首字母大写，其余小写。",
    example: "`avatar the way` → `Avatar The Way`",
  },
  capitalize: {
    help: "只把第一个字符改为大写，其余保持原样。",
    example: "`avatar` → `Avatar`",
  },
  snake_case: {
    help: "拆词后用下划线连接，并转为小写。",
    example: "`Avatar The Way` → `avatar_the_way`",
  },
  kebab_case: {
    help: "拆词后用短横线连接，并转为小写。",
    example: "`Avatar The Way` → `avatar-the-way`",
  },
  camel_case: {
    help: "拆词后转为小驼峰。",
    example: "`Avatar The Way` → `avatarTheWay`",
  },
  pascal_case: {
    help: "拆词后转为大驼峰。",
    example: "`Avatar The Way` → `AvatarTheWay`",
  },
  constant_case: {
    help: "拆词后转为全大写下划线。",
    example: "`Avatar The Way` → `AVATAR_THE_WAY`",
  },
  length: {
    help: "返回字符个数，中文按一个字符计算。结果是数字，一般不要直接当文件名。",
    example: "`阿凡达` → `3`",
  },
  slice: {
    help: "按起止位置截取。负数从末尾数；只填一个参数表示截到结尾或从末尾取。",
    example: "`.slice(0, 6)`  ：`Avatar.2009` → `Avatar`；`.slice(-4)` → `2009`",
  },
  truncate: {
    help: "超出指定长度后截断并追加省略号。点名称后填写长度。",
    example: "`.truncate(6)`  ：`阿凡达2009` → `阿凡达200…`",
  },
  repeat: {
    help: "把当前字符串重复 n 次，最多 20 次。点名称后填写次数。",
    example: "`.repeat(2)`  ：`AB` → `ABAB`",
  },
  reverse: {
    help: "按字符反转顺序。",
    example: "`阿凡达` → `达凡阿`",
  },
  first_word: {
    help: "取第一个词。空格、下划线、短横都会当作词边界。",
    example: "`Avatar The Way` → `Avatar`",
  },
  last_word: {
    help: "取最后一个词。",
    example: "`Avatar The Way` → `Way`",
  },
  initials: {
    help: "取每个词的首字母并大写。",
    example: "`Avatar The Way` → `ATW`",
  },
  nth_word: {
    help: "取第 n 个词。正数从 1 开始，负数从后往前。点名称后填写序号。",
    example: "`.nth_word(2)`  ：`Avatar The Way` → `The`",
  },
  split_at: {
    help: "按分隔符切开后取第 n 段。点名称后填写分隔符和段号。",
    example: "`.split_at('-', 1)`  ：`S01-E02` → `S01`",
  },
  insert: {
    help: "在指定位置插入文字。位置 0 表示开头，负数从末尾算。",
    example: "`.insert(0, '前缀')`  ：`Avatar` → `前缀Avatar`",
  },
  keep_digits: {
    help: "只保留数字，其它字符全部去掉。",
    example: "`S01E02` → `0102`",
  },
  remove_digits: {
    help: "去掉数字，保留其它字符。",
    example: "`S01E02` → `SE`",
  },
  keep_letters: {
    help: "只保留字母和中文，去掉数字和符号。",
    example: "`Avatar 2009` → `Avatar`",
  },
  remove_letters: {
    help: "去掉字母和中文，保留数字和符号。",
    example: "`Avatar 2009` → ` 2009`",
  },
  keep_alnum: {
    help: "只保留字母、中文和数字。",
    example: "`Avatar-2009!` → `Avatar2009`",
  },
  keep_ascii: {
    help: "只保留可见 ASCII 字符，中文和 emoji 会被去掉。",
    example: "`阿凡达 Avatar` → ` Avatar`",
  },
  extract_year: {
    help: "抽出名字里的 19xx / 20xx 年份。",
    example: "`Avatar.2009 [4K]` → `2009`",
  },
  extract_number: {
    help: "抽出第一个连续数字。",
    example: "`S01E12` → `01`",
  },
  extract_last_number: {
    help: "抽出最后一个连续数字。",
    example: "`S01E12` → `12`",
  },
  extract_resolution: {
    help: "抽出分辨率。4K / UHD 会归一成 2160p。",
    example: "`Avatar 4K` → `2160p`",
  },
  normalize_resolution: {
    help: "只返回归一后的分辨率；没有分辨率时得到空字符串。",
    example: "`Avatar UHD` → `2160p`",
  },
  extract_season_episode: {
    help: "抽出季集，支持 S01E02、1x02、第 n 集。",
    example: "`Show S1E2` → `S01E02`",
  },
  extract_episode: {
    help: "只抽出集数。",
    example: "`Show S01E02` → `02`",
  },
  extract_source: {
    help: "抽出 BluRay / WEB-DL / HDTV 等片源标签。",
    example: "`Avatar BluRay` → `BluRay`",
  },
  remove_year: {
    help: "去掉名字里的 19xx / 20xx 年份，并合并留下的分隔符。",
    example: "`Avatar.2009 [4K]` → `Avatar [4K]`；`Avatar (2009)` → `Avatar`",
  },
  extract_date: {
    help: "从名字抽出日期并格式化。点名称后填写输出格式。",
    example: "`.extract_date('yyyy-MM-dd')`  ：`IMG_20240102` → `2024-01-02`",
  },
  match: {
    help: "用正则匹配。有捕获组时返回第一组，否则返回整段匹配。",
    example: "`.match('S(\\\\d+)')`  ：`Show S01E02` → `01`",
  },
  before: {
    help: "截到第一次出现的分隔文字之前。找不到则保持原样。",
    example: "`.before('-')`  ：`Avatar-2009` → `Avatar`",
  },
  after: {
    help: "截第一次出现的分隔文字之后。找不到则得到空字符串。",
    example: "`.after('-')`  ：`Avatar-2009` → `2009`",
  },
  between: {
    help: "截取两段标记之间的内容。点名称后填写开始和结束标记。",
    example: "`.between('[', ']')`  ：`[4K]阿凡达` → `4K`",
  },
  pad: {
    help: "从左侧补齐到指定宽度。点名称后填写宽度和填充字符。",
    example: "`.pad(3, '0')`  ：`7` → `007`",
  },
  pad_start: {
    help: "从左侧补齐到指定宽度，和 pad 相同。",
    example: "`.pad_start(3, '0')`  ：`7` → `007`",
  },
  pad_end: {
    help: "从右侧补齐到指定宽度。",
    example: "`.pad_end(8, '_')`  ：`Avatar` → `Avatar__`",
  },
  pad_number: {
    help: "把第一个数字补齐到指定宽度，其它文字保持不动。",
    example: "`.pad_number(3, '0')`  ：`E7` → `E007`",
  },
  prefix: {
    help: "在开头加上指定文字。点名称后填写前缀。",
    example: "`.prefix('前缀_')`  ：`Avatar` → `前缀_Avatar`",
  },
  suffix: {
    help: "在末尾加上指定文字。点名称后填写后缀。",
    example: "`.suffix('_副本')`  ：`Avatar` → `Avatar_副本`",
  },
  ensure_prefix: {
    help: "没有该前缀时才加上，避免重复叠加。",
    example: "`.ensure_prefix('IMG_')`  ：`001` → `IMG_001`，已有则不变",
  },
  ensure_suffix: {
    help: "没有该后缀时才加上。",
    example: "`.ensure_suffix('_final')`  ：`Avatar` → `Avatar_final`",
  },
  remove_prefix: {
    help: "如果以指定前缀开头，就去掉这段前缀。",
    example: "`.remove_prefix('IMG_')`  ：`IMG_001` → `001`",
  },
  remove_suffix: {
    help: "如果以指定后缀结尾，就去掉这段后缀。",
    example: "`.remove_suffix('_副本')`  ：`Avatar_副本` → `Avatar`",
  },
  wrap: {
    help: "在左右两侧加上指定文字。点名称后填写左侧和右侧。",
    example: "`.wrap('[', ']')`  ：`4K` → `[4K]`",
  },
  if_empty: {
    help: "当前字段去掉空白后仍为空时，改用默认值。",
    example: "`.if_empty('未命名')`  ：空名字 → `未命名`",
  },
  format_size: {
    help: "把字节数格式化成友好大小。只适合挂在 {size} 上，挂在文件名上会得到 0B。",
    example: "`1048576`.format_size() → `1MB`",
  },
  if_contains: {
    help: "当前字段包含某词时，整段替换成指定文字；否则保持原样。点名称后填写要找的词和替换结果。",
    example: "`.if_contains('4K', '[4K]')`  ：`Avatar 4K` → `[4K]`；`Avatar` 保持不变",
  },
  max_len: {
    help: "按字符截断，不加省略号。填长度就用该长度；不填则按 Windows 路径剩余长度截，避免目标路径超长。",
    example: "`.max_len(6)`  ：`阿凡达2009` → `阿凡达200`",
  },
  take_parent_if_numeric: {
    help: "当前字段去掉空白后全是数字时，改用父目录名。适合 1.mp4、2.mp4 这种被拆出来的分集。",
    example: "`1` 所在 `阿凡达/` → `阿凡达`；`Avatar` 保持不变",
  },
  take_grandparent_if_cd: {
    help: "当前值或父目录是 CD1 / DISC1 / DVD2 这类碟层时，改用祖父目录名。",
    example: "`阿凡达/CD1/1.mp4` 的父目录 → `阿凡达`",
  },
  ensure_ext: {
    help: "模板忘记 {ext} 时，把原扩展名补回末尾。已经有同样后缀则不再叠加。",
    example: "`Avatar` + .mkv → `Avatar.mkv`；`Avatar.mkv` 保持不变",
  },
};

export function describeAssistantItem(item: AssistantItem): AssistantHelp {
  if (item.help?.trim() && item.example?.trim()) {
    return { help: item.help, example: item.example };
  }
  if (item.engine === "rename-chain") {
    const parsed = parseChainCall(item.value) ?? {
      name: item.value.replace(/^\./, "").replace(/\(.*\)$/s, ""),
      args: [],
    };
    const named = CHAIN_HELP[parsed.name];
    if (named) {
      return item.params?.length
        ? { help: `${named.help} 点名称后会先弹出参数框。`, example: named.example }
        : named;
    }
  }
  return fallbackHelp(item);
}

export function chainHelpNames(): string[] {
  return Object.keys(CHAIN_HELP);
}

function fallbackHelp(item: AssistantItem): AssistantHelp {
  if (item.engine === "rename-field" || item.engine === "rename-snippet") {
    return {
      help: `插入 ${item.value}，改名时替换成「${item.label}」。可继续点右侧函数往这个字段上挂链。`,
      example: `${item.value} 对 Avatar.mkv 这类文件生效。`,
    };
  }
  if (item.kind === "operator") {
    if (item.value === "AND") {
      return {
        help: "让前后两个条件同时成立。关键词之间的空格默认是 OR，只有点「并且」才会变成 AND。",
        example: "`Avatar AND Poster` 必须两个词都命中。",
      };
    }
    if (item.value === "NOT") {
      return {
        help: "否定下一个条件。也可以在关键词前加 -。文件名真的以 - 开头时请加引号。",
        example: "`kind:video NOT has:subtitle` 找出没有字幕的视频；`-trailer` 排除预告片。",
      };
    }
    return {
      help: "前后两个条件满足一个即可。搜索框里用空格分开的关键词默认就是这种关系。",
      example: "`Avatar OR Poster` 命中其中一个就能出现。",
    };
  }
  if (item.engine === "search-recipe" || item.kind === "recipe") {
    return {
      help: `插入现成查询 ${item.value}。这是一整段条件，不要再塞进已经选好的单个字段行。`,
      example: `用于快速圈出「${item.label}」。`,
    };
  }
  const field = item.searchFields?.find((name) => name !== "text");
  if (field) {
    return {
      help: `作为 ${field} 条件插入。自由搜索会写成 ${field}:${item.value}；在已选字段的组装行里只插入 ${item.value}。`,
      example: `点名称后，结果按「${item.label}」过滤。`,
    };
  }
  return {
    help: `插入 ${item.value}，用于「${item.label}」。`,
    example: `点名称后把这段语法放进当前输入框。`,
  };
}