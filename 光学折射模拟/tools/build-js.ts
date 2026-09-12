/**
 * 构建纯 JS 版本：src/**.ts → dist/**.js
 *
 *   node --experimental-strip-types tools/build-js.ts
 *
 * 产物是可以在任意现代浏览器里直接运行的 ES module（无类型语法），
 * 并且由 test/roundtrip.test.ts 与 TS 版本做「同输入同输出」比对。
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScript } from "./ts2js.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "dist");

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (extname(full) === ".ts") out.push(full);
  }
  return out;
}

/** 把 import 路径里的 .ts 换成 .js。 */
function rewriteImportPaths(code: string): string {
  return code
    .replace(/(\bfrom\s*["'])([^"']+)\.ts(["'])/g, "$1$2.js$3")
    .replace(/(\bimport\s*\(\s*["'])([^"']+)\.ts(["']\s*\))/g, "$1$2.js$3")
    .replace(/(\bimport\s+["'])([^"']+)\.ts(["'])/g, "$1$2.js$3");
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const files = collect(SRC).filter((f) => !f.endsWith(".d.ts"));
let totalRemoved = 0;
let totalLeftover = 0;

console.log("文件".padEnd(26), "剥离注解".padStart(9), "遗留".padStart(6));
for (const file of files.sort()) {
  const src = readFileSync(file, "utf8");
  const report = stripTypeScript(src, relative(SRC, file));
  const code = rewriteImportPaths(report.code);
  const target = join(OUT, relative(SRC, file).replace(/\.ts$/, ".js"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, code, "utf8");
  totalRemoved += report.removed;
  totalLeftover += report.suspicious.length;
  console.log(
    relative(SRC, file).padEnd(26),
    String(report.removed).padStart(9),
    String(report.suspicious.length).padStart(6),
  );
  for (const l of report.suspicious.slice(0, 6)) console.log(`      ⚠ ${l}`);
}

console.log(`\n共 ${files.length} 个文件 → dist/，剥离注解 ${totalRemoved} 处，可疑残留 ${totalLeftover} 处`);
if (totalLeftover > 0) process.exitCode = 1;
