import { basename } from "node:path";
import { splitPathParts } from "../rules/context.ts";

const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export function detectSep(path: string): string {
  if (path.includes("\\")) return "\\";
  if (path.includes("/")) return "/";
  return "\\";
}

export function joinPath(base: string, child: string): string {
  if (!child) return base;
  if (!base) return child;
  if (isAbsolutePath(child)) return child;
  const sep = detectSep(base) || detectSep(child);
  const normalizedChild = child
    .replace(/[\\/]+/g, sep)
    .replace(new RegExp(`^[${escapeRegExp(sep)}]+`), "");
  const trimmedBase = base.replace(new RegExp(`[${escapeRegExp(sep)}]+$`), "");
  return `${trimmedBase}${sep}${normalizedChild}`;
}

export function parentPathOf(path: string): string {
  const sep = detectSep(path);
  const parts = splitPathParts(path);
  if (parts.length <= 1) {
    if (path.startsWith("/") && sep === "/") return "/";
    return "";
  }
  const parentParts = parts.slice(0, -1);
  if (/^[A-Za-z]:$/.test(parentParts[0] ?? "")) {
    const drive = parentParts[0]!;
    const rest = parentParts.slice(1).join(sep);
    return rest ? `${drive}${sep}${rest}` : `${drive}${sep}`;
  }
  if (path.startsWith("\\\\") || path.startsWith("//")) {
    return `${path.slice(0, 2)}${parentParts.join(sep)}`;
  }
  if (path.startsWith("/") && sep === "/") {
    return `/${parentParts.join("/")}`;
  }
  return parentParts.join(sep);
}

export function replacePrefix(path: string, from: string, to: string): string {
  const pathNorm = path.replace(/[\\/]+/g, "/");
  const fromNorm = from.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  const pathCmp = pathNorm.toLowerCase();
  const fromCmp = fromNorm.toLowerCase();
  if (pathCmp === fromCmp) return to;
  if (!pathCmp.startsWith(`${fromCmp}/`)) return path;
  const rest = pathNorm.slice(fromNorm.length).replace(/^\/+/, "");
  const sep = detectSep(to) || detectSep(path);
  return joinPath(to, rest.replace(/\//g, sep));
}

export function normalizeKey(path: string): string {
  return path.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/") || path.startsWith("//");
}

export function splitStemExt(name: string, isDir: boolean): { stem: string; ext: string } {
  if (isDir) return { stem: name, ext: "" };
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, lastDot), ext: name.slice(lastDot) };
}

export function withNumericSuffix(name: string, isDir: boolean, n: number): string {
  const { stem, ext } = splitStemExt(name, isDir);
  return `${stem} (${n})${ext}`;
}

export function isIllegalName(name: string): boolean {
  if (!name || name.trim() === "" || name === "." || name === "..") return true;
  if (name.endsWith(" ") || name.endsWith(".")) return true;
  if (ILLEGAL_CHARS.test(name)) return true;
  const stem = splitStemExt(name, false).stem.toLowerCase();
  if (RESERVED.has(name.toLowerCase()) || RESERVED.has(stem)) return true;
  return false;
}

export function isLongPath(path: string): boolean {
  return path.length > 259 && !path.startsWith("\\\\?\\");
}

export function fileNameOf(path: string): string {
  const parts = splitPathParts(path);
  return parts[parts.length - 1] ?? basename(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
