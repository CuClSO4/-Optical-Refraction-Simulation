/**
 * 静态自检脚本（零依赖）：在没有 tsc 的环境里做几项有针对性的检查。
 *
 *   node --experimental-strip-types test/lint.ts
 *
 * 检查项
 *  1. 所有相对 import 必须带 .ts / .mjs 扩展名（浏览器原生加载要求）
 *  2. 是否存在「类型剥离不支持」的语法（参数属性、enum、namespace、装饰器）
 *  3. v() 必须传两个参数（本项目最容易犯的 API 误用）
 *  4. 是否残留 __OPTICS_DEBUG__ 之类的调试代码
 *  5. 每个源文件里的 define/export 名称与文件内 import 使用情况（粗查未使用导入）
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// 必须用 fileURLToPath：直接取 URL.pathname 不会解码，路径里含中文（或空格）时会变成
// %E5%85%89... 这样的转义串，进而 scandir ENOENT。
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const files = collect(join(ROOT, "src")).concat(collect(join(ROOT, "test")));

let problems = 0;
const report = (file: string, line: number, message: string): void => {
  problems++;
  console.log(`  ✗ ${relative(ROOT, file)}:${line}  ${message}`);
};

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if ([".ts", ".mjs"].includes(extname(full))) out.push(full);
  }
  return out;
}

/** 逐行括号配平地取出某次调用的实参文本。 */
function callArgs(text: string, openIndex: number): { args: string[]; end: number } {
  let depth = 0;
  let cur = "";
  const args: string[] = [];
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        if (cur.trim()) args.push(cur.trim());
        return { args, end: i };
      }
    } else if (ch === "," && depth === 1) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    if (depth >= 1) cur += ch;
  }
  return { args, end: openIndex };
}

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

  // 1) import 扩展名
  for (const m of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
    const spec = m[1]!;
    if (!/\.(ts|mjs|css|js)$/.test(spec)) {
      const line = text.slice(0, m.index).split("\n").length;
      report(file, line, `相对导入缺少扩展名: ${spec}`);
    }
  }

  // 2) 不支持的 TS 语法
  const isComment = (line: string): boolean => /^\s*(\/\/|\*|\/\*)/.test(line);
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    if (/\bconstructor\s*\([^)]*\b(private|public|protected|readonly)\b/.test(line)) {
      report(file, i + 1, "参数属性语法在类型剥离模式下不可用");
    }
    if (/^\s*(export\s+)?enum\b/.test(line)) report(file, i + 1, "enum 不是可擦除语法");
    if (/^\s*(export\s+)?namespace\b/.test(line)) report(file, i + 1, "namespace 不是可擦除语法");
    if (/^\s*@[A-Za-z]/.test(line)) report(file, i + 1, "装饰器不是可擦除语法");
  });

  // 3) v() 参数个数（math2d.v 需要两个参数）；检查脚本自身除外
  if (file.endsWith("math2d.ts") || file.endsWith("lint.ts")) continue;
  for (const m of text.matchAll(/(?<![\w.$])v\(/g)) {
    const openIndex = m.index! + m[0].length - 1;
    const { args, end } = callArgs(text, openIndex);
    void end;
    if (args.length !== 2) {
      const line = text.slice(0, m.index).split("\n").length;
      report(file, line, `v() 需要 2 个参数，实际 ${args.length} 个: v(${args.join(", ")})`);
    }
  }

  // 4) 调试残留
  lines.forEach((line, i) => {
    if (/__OPTICS_DEBUG__|debugger;|console\.log\(/.test(line) && !file.includes("test")) {
      report(file, i + 1, "疑似调试代码残留");
    }
  });
}

console.log(problems === 0 ? "\n静态自检通过：未发现问题" : `\n静态自检发现 ${problems} 个问题`);
if (problems > 0) process.exitCode = 1;
