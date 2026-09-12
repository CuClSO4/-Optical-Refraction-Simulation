/**
 * 归一化 dist/ 里的多行 import：把
 *     import {
 *       a,
 *       b,
 *     } from "./x.js";
 * 折叠成单行 `import { a, b } from "./x.js";`
 * 并顺带剔除残留的「类型名导入」（例如 Vec2 / ShapeGeometry），
 * 它们在本项目里都恰好是 src 中 interface 的名字。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

function collect(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full, ext));
    else if (extname(full) === ext) out.push(full);
  }
  return out;
}

/** 收集 src 里所有 interface / type 的名字（这些名字一定是纯类型）。 */
const typeNames = new Set<string>();
for (const file of collect(SRC, ".ts")) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g)) {
    typeNames.add(m[1]!);
  }
  for (const m of text.matchAll(/\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    typeNames.add(m[1]!);
  }
}
console.log(`类型名集合: ${[...typeNames].join(", ")}`);

let fixedFiles = 0;
let droppedNames = 0;

for (const file of collect(DIST, ".js")) {
  const before = readFileSync(file, "utf8");
  let after = before.replace(
    /import\s*\{([\s\S]*?)\}\s*from\s*("([^"]+)"|'([^']+)')\s*;/g,
    (m, inner: string, _q: string, dq: string, sq: string) => {
      const spec = dq ?? sq;
      const names = inner
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => {
          // 带别名的导入（`X as Y`）是值导入：别名必须原样保留，绝不能被当成
          // 「纯类型名」删掉 —— 否则产物里留下未定义变量，浏览器直接 ReferenceError。
          if (/\s+as\s+/.test(s)) return true;
          const name = s.replace(/^type\s+/, "").trim();
          if (typeNames.has(name)) {
            droppedNames++;
            return false;
          }
          return true;
        });
      return `import { ${names.join(", ")} } from "${spec}";`;
    },
  );
  after = after.replace(/import\s+([A-Za-z_$][\w$]*)\s*,\s*\{([\s\S]*?)\}\s*from\s*"([^"]+)"\s*;/g, (_m, def: string, inner: string, spec: string) => {
    const names = inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^type\s+/, "").trim())
      .filter((s) => !typeNames.has(s));
    return `import ${def}, { ${names.join(", ")} } from "${spec}";`;
  });

  if (after !== before) {
    writeFileSync(file, after, "utf8");
    fixedFiles++;
  }
}

console.log(`归一化 ${fixedFiles} 个文件，剔除纯类型导入名 ${droppedNames} 处`);
console.log(`样例: ${relative(ROOT, collect(DIST, ".js")[0]!)}`);
