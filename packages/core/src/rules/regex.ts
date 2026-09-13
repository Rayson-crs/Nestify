export function compileRegex(pattern: string): RegExp {
  let source = pattern;
  let flags = "u";
  if (/\(\?i\)/i.test(source)) {
    flags += "i";
    source = source.replace(/\(\?i\)/gi, "");
  }
  return new RegExp(source, flags);
}
