import { readFileSync, writeFileSync } from "node:fs";
const path = "apps/desktop/src/components/files/ResizableTable.tsx";
let text = readFileSync(path, "utf8");
const old1 = `          containerClassName="overflow-hidden"
          style={{ width: '100%', minWidth: totalWidth, maxWidth: '100%', tableLayout: 'fixed' }}`;
const new1 = `          containerClassName="overflow-visible"
          style={{ width: totalWidth, minWidth: totalWidth, tableLayout: 'fixed' }}`;
if (!text.includes(old1)) throw new Error("block1 not found");
text = text.replace(old1, new1);
const old2 = "        <ScrollBar orientation=\"horizontal\" />\n";
if (!text.includes(old2)) throw new Error("scrollbar not found");
text = text.replace(old2, "");
const old3 = "      style={width ? { width, minWidth: 0, maxWidth: width } : { maxWidth: 0 }}";
const new3 = "      style={width ? { width, minWidth: 0, maxWidth: width } : { width: 0, maxWidth: 0 }}";
if (!text.includes(old3)) throw new Error("style not found");
text = text.replace(old3, new3);
const old4 = '<div className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={title}>';
const new4 = '<div className="block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap" title={title}>';
if (!text.includes(old4)) throw new Error("truncated div not found");
text = text.replace(old4, new4);
writeFileSync(path, text);
console.log("updated ResizableTable");
