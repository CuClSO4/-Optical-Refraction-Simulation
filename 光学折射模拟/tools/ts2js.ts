/**
 * 零依赖 TypeScript → JavaScript 转换器（本项目专用）。
 *
 * 动机：浏览器原生「类型剥离」要求 Chrome/Edge 111+，浏览器偏旧就完全打不开。
 * 这里产出一套纯 JS 版本（dist/），对浏览器版本不再有要求。
 *
 * 实现要点：不做正则替换，而是逐字符扫描并维护「当前处于哪种上下文」：
 *   · 只有在「类型位置」才把 `: T` / `as T` / `<T>` 去掉；
 *   · 在对象字面量 `{ k: v }` 里**绝不**删冒号（这是之前踩过的坑）；
 *   · 模板字符串与正则字面量整体跳过，不会误改其中的内容。
 *
 * 产物由 test/roundtrip.test.ts 与 TS 版本做「同输入 → 逐位同输出」比对。
 */

interface Annotation {
  start: number;
  end: number;
  /** 替换文本：省略/为空 = 纯删除（当前唯一的用途是 import 的 `X as Y` → `Y`）。 */
  text?: string;
}

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[A-Za-z0-9_$]/;

/** 关键字之后出现 `(` 表示这是参数表位置。 */
const PARAM_PRECEDERS = new Set([
  "function",
  "constructor",
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "typeof",
  "void",
  "new",
  "in",
  "of",
  "do",
  "else",
  "delete",
  "await",
  "yield",
  "case",
]);

export interface StripReport {
  code: string;
  removed: number;
  /** 可疑残留（人工复核用），空数组表示没有发现问题。 */
  suspicious: string[];
  /** 每一处删除的原始片段（调试用）。 */
  removedTexts: string[];
}

export function stripTypeScript(src: string, fileName = "input.ts"): StripReport {
  const edits: Annotation[] = [];
  const suspicious: string[] = [];
  const removedTexts: string[] = [];
  let removed = 0;
  const DEBUG = (globalThis as unknown as { __STRIP_DEBUG__?: boolean }).__STRIP_DEBUG__ === true;
  /** 统一的「追加删除」入口，便于调试定位是谁删的。 */
  const drop = (start: number, end: number, who = "?"): void => {
    edits.push({ start, end });
    removed++;
    if (DEBUG && src.slice(start, end).startsWith("type =")) {
      console.log(`[strip] drop(${who}) start=${start} end=${end}`);
      console.log("  Error().stack ↓");
      console.log(new Error().stack);
    }
    if (DEBUG) {
      const text = src.slice(start, end);
      const line = src.slice(0, start).split("\n").length;
      console.log(`[strip] ${who} 行${line} 删除「${text.replace(/\n/g, "\\n").slice(0, 50)}」`);
    }
  };

  const len = src.length;
  let i = 0;

  /** 跳到与位置 p 处的开括号匹配的闭括号之后。 */
  const skipBalanced = (p: number, open: string, close: string): number => {
    let depth = 0;
    let k = p;
    while (k < len) {
      const ch = src[k]!;
      if (ch === '"' || ch === "'" || ch === "`") {
        k = skipString(k);
        continue;
      }
      if (ch === "/" && src[k + 1] === "/") {
        while (k < len && src[k] !== "\n") k++;
        continue;
      }
      if (ch === "/" && src[k + 1] === "*") {
        const end = src.indexOf("*/", k + 2);
        k = end < 0 ? len : end + 2;
        continue;
      }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return k + 1;
      }
      k++;
    }
    return len;
  };

  /** 跳过字符串/模板字面量，返回其结束位置。 */
  function skipString(p: number): number {
    const quote = src[p]!;
    let k = p + 1;
    while (k < len) {
      const ch = src[k]!;
      if (ch === "\\") {
        k += 2;
        continue;
      }
      if (ch === quote) return k + 1;
      k++;
    }
    return len;
  }

  /** 跳过注释，返回结束位置（未命中注释则返回原位置）。 */
  const skipComment = (p: number): number => {
    if (src[p] === "/" && src[p + 1] === "/") {
      let k = p;
      while (k < len && src[k] !== "\n") k++;
      return k;
    }
    if (src[p] === "/" && src[p + 1] === "*") {
      const end = src.indexOf("*/", p + 2);
      return end < 0 ? len : end + 2;
    }
    return p;
  };

  /** 从 p 起跳过空白与注释。 */
  const skipWs = (p: number): number => {
    let k = p;
    for (;;) {
      const before = k;
      while (k < len && /\s/.test(src[k]!)) k++;
      k = skipComment(k);
      if (k === before) return k;
    }
  };

  /** 判断 `/` 在此处是正则字面量还是除号。 */
  const isRegexPosition = (p: number): boolean => {
    let k = p - 1;
    while (k >= 0 && /\s/.test(src[k]!)) k--;
    if (k < 0) return true;
    const ch = src[k]!;
    if (ID_PART.test(ch) || ch === ")" || ch === "]" || ch === "}") return false;
    return true;
  };

  /** 读取一个标识符。 */
  const readIdent = (p: number): { text: string; end: number } => {
    let k = p;
    while (k < len && ID_PART.test(src[k]!)) k++;
    return { text: src.slice(p, k), end: k };
  };

  /**
   * 从 p（应指向类型表达式的首字符）起读一个完整类型表达式，返回结束位置。
   * 支持 A、A.B、A<B, C>、A[]、A | B、A & B、(x: T) => U、{ a: T }、A["k"]、字面量。
   */
  /** 跳过 `<...>`（泛型参数/类型实参），内部允许 extends / = / 联合类型。 */
  const skipTypeAngles = (p: number): number => {
    let depth = 0;
    let k = p;
    while (k < len) {
      const c = src[k]!;
      if (c === '"' || c === "'" || c === "`") {
        k = skipString(k);
        continue;
      }
      if (c === "(" || c === "[" || c === "{") {
        k = skipBalanced(k, c, c === "(" ? ")" : c === "[" ? "]" : "}");
        continue;
      }
      if (c === "<") depth++;
      else if (c === ">") {
        depth--;
        if (depth === 0) return k + 1;
      } else if (c === ";" || c === "\n") {
        // 换行/分号处若还没配平，说明这不是泛型
        break;
      }
      k++;
    }
    return p;
  };

  const readType = (p: number): number => {
    let k = skipWs(p);
    // 前导运算符：keyof / readonly / unique / typeof / 类型谓词的 is
    for (const kw of ["keyof", "readonly", "unique", "typeof", "is"]) {
      if (src.startsWith(kw, k) && !ID_PART.test(src[k + kw.length] ?? "")) {
        k = skipWs(k + kw.length);
      }
    }
    // 主类型单元
    if (src[k] === "(") {
      // 函数类型 `(a: T, b: U) => R` 或括号包裹的类型
      const inner = skipBalanced(k, "(", ")");
      const afterInner = skipWs(inner);
      if (src.startsWith("=>", afterInner)) {
        // 递归读取返回类型，从而覆盖 `(a: T) => (b: U) => R` 这类嵌套
        const retEnd = readType(afterInner + 2);
        k = retEnd > afterInner + 2 ? retEnd : afterInner + 2;
      } else {
        k = inner;
      }
    } else if (src[k] === "{") {
      k = skipBalanced(k, "{", "}");
    } else if (src[k] === "[") {
      k = skipBalanced(k, "[", "]");
    } else if (src[k] === "`") {
      k = skipString(k);
    } else if (src[k] === '"' || src[k] === "'") {
      k = skipString(k);
    } else if (src[k] === "-" && /[0-9]/.test(src[k + 1] ?? "")) {
      // 负数字面量类型，例如 `1 | -1`
      k++;
      while (k < len && /[0-9._]/.test(src[k]!)) k++;
    } else if (ID_START.test(src[k] ?? "")) {
      const id = readIdent(k);
      // `el is T` 类型谓词：把 `el is` 一起读掉
      if (ID_START.test(src[id.end] ?? "") || src[id.end] === " ") {
        const nameEnd = readIdent(id.end).end;
        if (src.slice(id.end, nameEnd).trim() === "is") {
          const afterIs = skipWs(nameEnd);
          const unitEnd = readType(afterIs);
          k = unitEnd > afterIs ? unitEnd : nameEnd;
        } else {
          k = id.end;
          const g = skipWs(k);
          if (src[g] === "<") {
            const angles = skipTypeAngles(g);
            k = angles > g ? angles : id.end;
          }
        }
      } else {
        k = id.end;
        const g = skipWs(k);
        if (src[g] === "<") {
          const angles = skipTypeAngles(g);
          k = angles > g ? angles : id.end;
        }
      }
    } else if (/[0-9]/.test(src[k] ?? "")) {
      while (k < len && /[0-9._]/.test(src[k]!)) k++;
    } else {
      return p; // 读不出类型
    }

    // 后缀与联合/交叉类型循环
    for (;;) {
      const before = k;
      const m = skipWs(k);
      const c = src[m];
      if (c === "[" && src[m + 1] === "]") {
        k = m + 2;
        continue;
      }
      if (c === "[" && (src[m + 1] === '"' || src[m + 1] === "'")) {
        // 索引访问类型 A["kind"]
        k = skipBalanced(m, "[", "]");
        continue;
      }
      if (c === "." && ID_START.test(src[m + 1] ?? "")) {
        k = readIdent(m + 1).end;
        continue;
      }
      if (c === "|" || c === "&") {
        const after = skipWs(m + 1);
        const unitEnd = readType(after);
        if (unitEnd === after) break;
        k = unitEnd;
        continue;
      }
      k = before;
      break;
    }
    return k;
  };

  /**
   * 判断 `start`（类型表达式起点）到 `end` 之后是否为合法的「类型注解结束」位置。
   * 只有明确结束时才动手删除，避免把对象字面量误伤。
   */
  const annotationEndsHere = (end: number): boolean => {
    const k = skipWs(end);
    const ch = src[k];
    if (ch === undefined) return true;
    if (ch === "=" || ch === ";" || ch === "," || ch === ")" || ch === "]" || ch === "}") {
      // `= >` 这种不是类型结束
      if (ch === "=" && src[k + 1] === ">") return false;
      return true;
    }
    if (ch === "\n") return true;
    // `): T {` / `const f = (x): T => ...`
    if (ch === "{") return true;
    if (ch === "=" && src[k + 1] === ">") return true;
    return false;
  };

  /* ------------------------------------------------------------ 主扫描 */

  /** 判断位置 p 是否处于「语句起始」位置（上一有效字符是 { } ; 或换行缩进）。 */
  /**
   * 判断位置 p 是否处于「声明/语句起始」位置。
   * 关键点：必须**跳过注释**再往回看 —— 类字段上一行若是一条 `/** ... *\/` 文档注释，
   * 直接往回看会撞到注释的 `*\/`，从而误判成「不是语句起始」。
   */
  const isStatementStart = (p: number): boolean => {
    // 同一行前面只允许出现空白与类成员修饰符
    let lineStart = p;
    while (lineStart > 0 && src[lineStart - 1] !== "\n") lineStart--;
    const before = src
      .slice(lineStart, p)
      .replace(/\b(private|public|protected|readonly|abstract|override|declare|static)\b/g, " ")
      .trim();
    if (before !== "") return false;

    // 往回跳过空白与注释，找上一个有效字符
    let k = lineStart - 1;
    for (let guard = 0; guard < 5000 && k >= 0; guard++) {
      const c = src[k]!;
      if (/\s/.test(c)) {
        k--;
        continue;
      }
      if (c === "/" && src[k - 1] === "*") {
        const open = src.lastIndexOf("/*", k - 2);
        if (open < 0) return true;
        k = open - 1;
        continue;
      }
      if (c === "/" && src[k - 1] === "/") {
        const nl = src.lastIndexOf("\n", k - 2);
        k = nl < 0 ? -1 : nl - 1;
        continue;
      }
      break;
    }
    if (k < 0) return true;
    const prev = src[k]!;
    return prev === "{" || prev === "}" || prev === ";" || prev === "," || prev === ")";
  };

  /** 取一条 import/export 语句的范围（到分号或行尾，花括号配平，支持多行）。 */
  const statementSpan = (from: number): number => {
    let depth = 0;
    let k = from;
    while (k < len) {
      const c = src[k]!;
      if (c === '"' || c === "'" || c === "`") {
        k = skipString(k);
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ";" && depth <= 0) return k + 1;
      else if (c === "\n" && depth <= 0) return k;
      k++;
    }
    return len;
  };

  /**
   * 处理一条 import 语句里的绑定列表：
   *  · 顶层的 `type A` → `A`（纯类型导入 `import type ...` 整条删除，由调用处负责）；
   *  · `A as B` → 原样保留导入名与别名。
   *
   * 为什么要在解析阶段动 import：产物级清理里那条 `as` 规则本来是用来删类型断言的
   * （`x as number`），它会连 import 的别名一起删掉，留下未定义的本地名 ——
   * 浏览器一加载就 ReferenceError，而这种坑只在产物里出现（源码测试照样全绿）。
   * 产物已经被字符串切成了片段，那时看不到完整的 import 语句，所以保护必须在这里做：
   * 把 ` as ` 临时编码成不含空格的 \u0000A\u0000，等产物级清理跑完再还原。
   */
  const stripImportStatement = (from: number, to: number): number => {
    let hits = 0;
    const stmt = src.slice(from, to);
    const open = stmt.indexOf("{");
    if (open < 0) return hits; // 默认导入 / 命名空间导入：没有绑定列表
    const close = stmt.lastIndexOf("}");
    if (close < open) return hits;
    const innerStart = from + open + 1;
    const inner = stmt.slice(open + 1, close);
    const list = inner.split(",");
    // 收集绑定项（带绝对位置），再统一处理，避免边改边算偏移
    let cursor = innerStart;
    const bindings: { start: number; text: string }[] = [];
    for (const part of list) {
      bindings.push({ start: cursor, text: part });
      cursor += part.length + 1; // +1 = 被 split 掉的逗号
    }
    // 从后往前改，前面的偏移才不会被后面的改动影响
    for (let k = bindings.length - 1; k >= 0; k--) {
      const { start, text } = bindings[k]!;
      const rel = start + text.indexOf(text.trimStart());
      const trimmed = text.trim();
      if (!trimmed) continue;
      // `type A as B` → `A as B`
      const alias = /^(?:type\s+)?([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(trimmed);
      if (alias) {
        // 别名导入：整段重写为「原名 + 编码的 as + 别名」，避开产物级清理。
        edits.push({
          start: rel,
          end: rel + trimmed.length,
          text: `${alias[1]!}\u0000A\u0000${alias[2]!}`,
        });
        removed++;
        hits++;
        continue;
      }
      // `type A` → `A`
      if (/^type\s+/.test(trimmed)) {
        edits.push({ start: rel, end: rel + 5 });
        removed++;
        hits++;
      }
    }
    return hits;
  };

  const stripTypeKeyword = (from: number, to: number): number => {
    let hits = 0;
    for (const m of src.slice(from, to).matchAll(/\btype\s+(?=[A-Za-z_$])/g)) {
      const at = from + m.index!;
      edits.push({ start: at, end: at + 4 });
      removed++;
      hits++;
    }
    return hits;
  };

  /**
   * 花括号种类栈：用来区分「类体」与「普通块」。
   * 类字段注解（`id: T;`）和对象字面量属性（`id: value,`）语法形状相同，
   * 只有知道当前是否在类体内才能安全区分 —— 这是转换器最容易出错的地方。
   */
  const braceKinds: ("class" | "other")[] = [];
  /**
   * 当前是否「直接位于类体内」——只看**栈顶**：
   * 方法体的 `{` 会压入 "other"，因此方法体里的对象字面量不会被当成类字段注解。
   * （早期版本写成「栈里任意位置有 class」，导致 `refresh: () => {}` 这类对象属性被误删。）
   */
  const inClassBody = (): boolean =>
    braceKinds.length > 0 && braceKinds[braceKinds.length - 1] === "class";

  while (i < len) {
    const ch = src[i]!;

    if (DEBUG && src.startsWith("type =", i)) {
      console.log(`[strip] 扫描到 type = 位置 i=${i}，栈=${JSON.stringify(braceKinds)}`);
    }

    if (ch === "{") {
      // 判据：该 `{` 直接跟在类声明之后（向上直到行首，见 `class X`，且其间只有 extends 子句），
      // 同时当前不在别的类体里 —— 这样方法体的 `{` 不会被误认成类体，
      // 方法体里的对象字面量就不会被当成类字段注解。
      let k = i - 1;
      while (k >= 0 && /\s/.test(src[k]!)) k--;
      // 往回扫最多 200 字符，遇到行首或 `{` 就停
      let scan = "";
      let s = k;
      while (s >= 0 && scan.length < 200 && src[s] !== "}" && src[s] !== "{") {
        if (src[s] === "\n") break;
        scan = src[s]! + scan;
        s--;
      }
      const looksLikeClassHeader =
        /\bclass\s+[A-Za-z_$][\w$]*(\s*<[^>]*>)?(\s+extends\s+[\w$.<>,\s]+)?\s*$/.test(scan);
      braceKinds.push(looksLikeClassHeader && !inClassBody() ? "class" : "other");
      i++;
      continue;
    }
    if (ch === "}") {
      braceKinds.pop();
      i++;
      continue;
    }

    // ---- 纯类型声明块（interface / type 别名）：必须最先处理
    if (ch === "i" || ch === "t" || ch === "e") {
      // 类型别名必须是 `type Ident<...>? =`；
      // 只写 `type\s+` 会误伤属性访问（`b.type = "button"`）。
      const declMatch = /^(export\s+)?(interface\s+[A-Za-z_$]|type\s+[A-Za-z_$][\w$]*\s*(<[^>]*>)?\s*=)/.exec(
        src.slice(i, i + 60),
      );
      if (DEBUG && declMatch && src.slice(i, i + 12).startsWith("type =")) {
        console.log(`[strip] 类型块分支命中 i=${i}：${JSON.stringify(src.slice(i, i + 30))}`);
      }
      if (declMatch && (i === 0 || !ID_PART.test(src[i - 1]!))) {
        let k = i + declMatch[0].length;
        if (declMatch[2].startsWith("interface")) {
          const braceAt = src.indexOf("{", k);
          if (braceAt >= 0) k = skipBalanced(braceAt, "{", "}");
          edits.push({ start: i, end: k });
          removed++;
          i = k;
          continue;
        }
        // type 别名：删到分号；没有分号时删到「不再续行」的位置
        let depth = 0;
        while (k < len) {
          const c = src[k]!;
          if (c === "{" || c === "(" || c === "[") depth++;
          else if (c === "}" || c === ")" || c === "]") depth--;
          else if (c === ";" && depth <= 0) {
            k++;
            break;
          } else if (c === "\n" && depth <= 0) {
            const nextNonWs = skipWs(k + 1);
            const nextCh = src[nextNonWs];
            if (nextCh === "|" || nextCh === "&") {
              k++;
              continue;
            }
            break;
          }
          k++;
        }
        edits.push({ start: i, end: k });
        removed++;
        i = k;
        continue;
      }
    }

    // ---- import / export 语句：必须在字符串/括号处理之前，
    //      否则 `import { type A }` 里的花括号会先被其他分支消费掉
    if (src.startsWith("import", i) && !ID_PART.test(src[i + 6] ?? "")) {
      const stop = statementSpan(i);
      const stmt = src.slice(i, stop);
      if (/^import\s+type\b/.test(stmt)) {
        edits.push({ start: i, end: stop });
        removed++;
        i = stop;
        continue;
      }
      stripImportStatement(i, stop);
      i = stop;
      continue;
    }
    if (src.startsWith("export", i) && !ID_PART.test(src[i + 6] ?? "")) {
      const stop = statementSpan(i);
      const stmt = src.slice(i, stop);
      // `export type { A, B };` / `export type X = ...`：整条删掉
      if (/^export\s+type\b/.test(stmt)) {
        edits.push({ start: i, end: stop });
        removed++;
        i = stop;
        continue;
      }
      const before = edits.length;
      stripTypeKeyword(i, stop);
      if (edits.length > before) {
        i = stop;
        continue;
      }
      // 其余情况（export const f = ...）只跳过 export 关键字
      i = skipWs(i + 6);
      continue;
    }

    // ---- 字符串 / 模板 / 注释 / 正则：整体跳过
    if (ch === '"' || ch === "'") {
      i = skipString(i);
      continue;
    }
    if (ch === "`") {
      i = skipString(i);
      continue;
    }
    if (ch === "/") {
      const k = skipComment(i);
      if (k !== i) {
        i = k;
        continue;
      }
      if (isRegexPosition(i)) {
        // 正则字面量
        let k2 = i + 1;
        let inClass = false;
        while (k2 < len) {
          const c = src[k2]!;
          if (c === "\\") {
            k2 += 2;
            continue;
          }
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) {
            k2++;
            break;
          } else if (c === "\n") break;
          k2++;
        }
        while (k2 < len && /[a-z]/.test(src[k2]!)) k2++;
        i = k2;
        continue;
      }
    }

    // 说明：这里不需要跟踪花括号深度 —— 类型注解只会出现在「声明位置」，
    // 而对象字面量的 `k: v` 前是 `{` 或 `,`，由各处判断自行排除。

  // ---- 说明：import / export 语句已在主循环最前面统一处理
    // ---- 变量声明里的类型注解：const x: T = ...
    if (
      (src.startsWith("const", i) || src.startsWith("let", i) || src.startsWith("var", i)) &&
      (i === 0 || !ID_PART.test(src[i - 1]!))
    ) {
      const kwLen = src.startsWith("const", i) ? 5 : 3;
      // 只有「关键字 + 空白 + 标识符」才是变量声明；
      // 否则可能是 `push(...)`、`constellation` 之类的普通标识符，直接跳过关键字长度。
      const afterKw = src[i + kwLen] ?? "";
      if (!/\s/.test(afterKw)) {
        i += kwLen;
        continue;
      }
      let k = skipWs(i + kwLen);
      if (ID_START.test(src[k] ?? "")) {
        k = readIdent(k).end;
        k = skipWs(k);
        if (src[k] === ":") {
          const typeEnd = readType(k + 1);
          if (typeEnd > k + 1 && annotationEndsHere(typeEnd)) {
            drop(k, typeEnd, "const注解");
            i = typeEnd;
            continue;
          }
        }
      }
      i += kwLen;
      continue;
    }

    // ---- 函数声明 / 方法：参数表 + 返回类型 + 泛型
    if (src.startsWith("function", i) && !ID_PART.test(src[i + 8] ?? "")) {
      let k = skipWs(i + 8);
      if (src[k] === "*") k = skipWs(k + 1);
      if (ID_START.test(src[k] ?? "")) k = readIdent(k).end;
      k = skipWs(k);
      if (src[k] === "<") {
        const end = skipBalanced(k, "<", ">");
        edits.push({ start: k, end });
        removed++;
        k = skipWs(end);
      }
      if (src[k] === "(") {
        i = handleParams(k);
        continue;
      }
      i = k;
      continue;
    }

    // ---- 类成员修饰符
    if (/^(private|public|protected|readonly|abstract|override|declare)\b/.test(src.slice(i, i + 12))) {
      const word = /^(private|public|protected|readonly|abstract|override|declare)/.exec(src.slice(i, i + 12))![1]!;
      const after = skipWs(i + word.length);
      // 后面必须还是标识符/修饰符，而不是运算符
      if (ID_START.test(src[after] ?? "") || /^(private|public|protected|readonly|abstract|override|declare)\b/.test(src.slice(after, after + 12))) {
        edits.push({ start: i, end: after });
        removed++;
        i = after;
        continue;
      }
    }

    // ---- as / satisfies 断言
    if (/^as\s/.test(src.slice(i, i + 3)) && !ID_PART.test(src[i - 1] ?? "")) {
      const after = skipWs(i + 2);
      if (src.startsWith("const", after) && !ID_PART.test(src[after + 5] ?? "")) {
        edits.push({ start: i, end: after + 5 });
        removed++;
        i = after + 5;
        continue;
      }
      const typeEnd = readType(after);
      if (typeEnd > after) {
        edits.push({ start: i, end: typeEnd });
        removed++;
        i = typeEnd;
        continue;
      }
    }
    if (/^satisfies\s/.test(src.slice(i, i + 10))) {
      const after = skipWs(i + 9);
      const typeEnd = readType(after);
      if (typeEnd > after) {
        edits.push({ start: i, end: typeEnd });
        removed++;
        i = typeEnd;
        continue;
      }
    }

    // ---- 函数/方法的泛型参数：`function f<T extends X>()`、`live<T>()`
    if (ch === "<") {
      const end = skipTypeAngles(i);
      if (end > i) {
        const after = skipWs(end);
        if (src[after] === "(") {
          edits.push({ start: i, end });
          removed++;
          i = end;
          continue;
        }
      }
    }

    // ---- 可选方法/属性签名：`refresh?() { ... }`、`foo?: T;`
    if (ch === "?" && inClassBody() && isStatementStart(i)) {
      const next = src[i + 1];
      if (next === "(" || next === ":" || next === "<") {
        edits.push({ start: i, end: i + 1 });
        removed++;
        i++;
        continue;
      }
    }

    // ---- 形参表：识别为参数表的 `(`
    if (ch === "(" && isParamParen(i)) {
      i = handleParams(i);
      continue;
    }

    // ---- 类字段 / 抽象方法等「声明位置」的注解：
    //      形如 `canvas: HTMLCanvasElement;`、`foo(x: T): void;`。
    //      判据：标识符出现在语句起始位置（上一有效字符是 { } ; 或行首缩进），
    //      这样就绝不会误伤对象字面量里的 `{ k: v }`（那里前面是 { 或 ,）。
    if (ID_START.test(ch) && inClassBody() && isStatementStart(i)) {
      const nm = readIdent(i);
      // 排除「点访问赋值」：`b.type = "button";` 里的 type 不是字段名
      const beforeNm = src[i - 1] ?? "";
      if (beforeNm === "." || beforeNm === "?") {
        i = nm.end;
        continue;
      }

      let k = skipWs(nm.end);
      if (src[k] === "?") k = skipWs(k + 1);
      if (DEBUG && nm.text === "canvas") {
        console.log(
          `[strip] 类字段分支 命中 canvas: isStatementStart=${isStatementStart(i)} 下一字符=${JSON.stringify(src[k])}`,
        );
      }
      if (src[k] === ":") {
        const typeEnd = readType(k + 1);
        if (typeEnd > k + 1) {
          const afterType = skipWs(typeEnd);
          const nextCh = src[afterType];
          if (nextCh === "=") {
            // 带初始化器的类字段：只删注解，保留 `= ...`
            edits.push({ start: k, end: typeEnd });
            removed++;
            i = typeEnd;
            continue;
          }
          // 没有初始化器：整个声明删掉（`private readonly x: T;`）
          let stmtEnd = typeEnd;
          const semi = skipWs(typeEnd);
          if (src[semi] === ";") stmtEnd = semi + 1;
          edits.push({ start: i, end: stmtEnd });
          removed++;
          i = stmtEnd;
          continue;
        }
      }
      // 抽象/声明式方法签名：`foo(a: T): void;` → 整个签名删掉
      if (src[k] === "(") {
        const after = handleParams(k);
        const tail = skipWs(after);
        if (src[tail] === ";") {
          edits.push({ start: i, end: tail + 1 });
          removed++;
          i = tail + 1;
          continue;
        }
        i = after;
        continue;
      }
    }

    // ---- 非空断言：标识符/)/] 后面紧跟 !（可带空格），且其后是分隔符或运算符
    if (ch === "!" ) {
      const prev = src[i - 1] ?? "";
      const afterBang = skipWs(i + 1);
      const next = src[afterBang] ?? "";
      const prevOk = ID_PART.test(prev) || prev === ")" || prev === "]";
      const nextOk = next === "" || /[.,;)\]}=:|&?+\-*/<>]/.test(next);
      if (prevOk && nextOk) {
        edits.push({ start: i, end: i + 1 });
        removed++;
        i = i + 1;
        continue;
      }
    }

    i++;
  }

  /* ------------------------------------------------------ 形参表处理 */

  function isParamParen(p: number): boolean {
    // 往前找最近的非空白 token
    let k = p - 1;
    while (k >= 0 && /\s/.test(src[k]!)) k--;
    if (k < 0) return true;
    const ch = src[k]!;
    // `) (` 与 `] (` 是调用/索引；`. (` 与 `?. (` 是方法调用；都不是参数表
    if (ch === ")" || ch === "]") return false;
    if (ch === "." || ch === "?") return false;
    if (ID_PART.test(ch)) {
      // 标识符或关键字
      let s = k;
      while (s >= 0 && ID_PART.test(src[s]!)) s--;
      const word = src.slice(s + 1, k + 1);
      if (PARAM_PRECEDERS.has(word)) {
        return (
          word === "function" ||
          word === "constructor" ||
          word === "if" ||
          word === "for" ||
          word === "while" ||
          word === "switch" ||
          word === "catch"
        );
      }
      // 方法名 / 变量名后面跟 ( ：可能是函数调用，也可能是方法定义（或箭头函数）。
      // 判据一：`)` 后面直接跟 `{` 或 `=>` → 定义；
      // 判据二：`)` 紧跟 `:`（中间没有空格）→ 返回类型注解，也是定义；
      // 其余情况（例如 `Math.min(x) : y` 这种三元表达式）一律按调用处理，
      // 否则会把三元表达式的冒号当成参数注解删掉。
      const close = skipBalanced(p, "(", ")");
      if (src[close] === "{") return true;
      if (src[close] === ":" && !/\s/.test(src[close - 1] ?? "")) return true;
      const after = skipWs(close);
      if (src.startsWith("=>", after)) return true;
      // `function` 之类的关键字已在上面的分支处理；到这里按调用处理
      return false;
    }
    return true;
  }

  /** 逐个顶层参数处理：删掉参数名后的 `: T`、可选标记 `?`、rest 的 `...` 与 `this` 绑定。 */
  function handleParams(open: number): number {
    const close = skipBalanced(open, "(", ")");
    let depth = 0;
    let k = open + 1;
    /** 当前参数的起始位置，用于判断「冒号前是否只是参数名」。 */
    let paramStart = open + 1;
    /** 上一个候选可选标记 `?` 的位置（仅当它像参数标记时记录）。 */
    let lastQuestion = -1;

    const strip = (start: number, end: number): void => {
      edits.push({ start, end });
      removed++;
    };

    /** 冒号前是否只是一个参数名（可带 ... 与 ?）。 */
    const isNameBefore = (colonAt: number): boolean => {
      const between = src.slice(paramStart, colonAt).trim();
      return /^(\.\.\.)?[A-Za-z_$][\w$]*\??$/.test(between);
    };

    while (k < close) {
      const c = src[k]!;
      if (c === '"' || c === "'" || c === "`") {
        k = skipString(k);
        continue;
      }
      if (c === "(" || c === "[" || c === "{") {
        // `x: (a: T) => U` 这类函数类型不能进到里面的参数表去
        if (c === "(" && depth === 0 && isNameBefore(k)) {
          k += 1;
          continue;
        }
        // 其他情况：整体跳过配对的括号
        k = skipBalanced(k, c, c === "(" ? ")" : c === "[" ? "]" : "}");
        continue;
      }
      if (c === ")" || c === "]" || c === "}") {
        depth--;
        k++;
        continue;
      }
      if (c === "," && depth === 0) {
        // 该参数既没有注解也没有 `?`：这里什么也不做
        paramStart = k + 1;
        lastQuestion = -1;
        k++;
        continue;
      }

      if (c === "?" && depth === 0) {
        const between = src.slice(paramStart, k).trim();
        const looksLikeName = /^[A-Za-z_$][\w$]*$/.test(between);
        if (looksLikeName) {
          lastQuestion = k; // 暂时保留，等确认后面是注解再删
        } else {
          lastQuestion = -1; // 三元运算符的 `?`
        }
        k++;
        continue;
      }

      if (c === ":" && depth === 0 && isNameBefore(k)) {
        const typeEnd = readType(k + 1);
        if (typeEnd > k + 1) {
          // 确认是参数注解：只删注解本身与可选标记 `?`。
          // 注意：**不能删 rest 的 `...`** —— JavaScript 原生支持 rest 参数，
          // （早期版本把 `...children` 也删掉，导致 `el.append(...children)` 报错。）
          if (lastQuestion >= 0) strip(lastQuestion, lastQuestion + 1);
          strip(k, typeEnd);
          k = typeEnd;
          paramStart = typeEnd;
          lastQuestion = -1;
          continue;
        }
      }
      // 默认值 `= expr`：跳过表达式，避免其中的 `? :` 被当成类型
      if (c === "=" && depth === 0) {
        k++;
        while (k < close) {
          const cc = src[k]!;
          if (cc === "(" || cc === "[" || cc === "{") {
            k = skipBalanced(k, cc, cc === "(" ? ")" : cc === "[" ? "]" : "}");
            continue;
          }
          if (cc === "," && depth === 0) break;
          if (cc === '"' || cc === "'" || cc === "`") {
            k = skipString(k);
            continue;
          }
          k++;
        }
        continue;
      }
      k++;
    }
    // 返回类型注解：) : T   （也覆盖 `): el is Extract<...>` 这类类型谓词）
    let after = skipWs(close);
    if (src[after] === ":") {
      const typeEnd = readType(after + 1);
      if (typeEnd > after + 1) {
        edits.push({ start: after, end: typeEnd });
        removed++;
        after = typeEnd;
      }
    }
    return after;
  }

  /* --------------------------------------------------------- 应用修改 */

  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const e of edits) {
    if (e.start < cursor) continue; // 重叠，跳过
    out += src.slice(cursor, e.start);
    // 保留换行数量，方便错误定位
    const removedText = src.slice(e.start, e.end);
    removedTexts.push(removedText);
    const newlines = (removedText.match(/\n/g) ?? []).length;
    if (e.text === undefined) {
      out += " ".repeat(1) + "\n".repeat(newlines);
    } else {
      out += e.text + "\n".repeat(newlines);
    }
    cursor = e.end;
  }
  out += src.slice(cursor);

  /* ------------------------------ 产物级清理（只在 code 片段上进行） */

  /**
   * 轻量分段：把产物切成 code / 字符串 / 注释 / 模板 四类片段。
   * 模板字面量整体跳过（含其内部 `${}`），因此模板里的内容绝不会被改写。
   */
  const splitSegments = (text: string): { kind: "code" | "opaque"; text: string }[] => {
    const segs: { kind: "code" | "opaque"; text: string }[] = [];
    let buf = "";
    let p = 0;
    const pushCode = (): void => {
      if (buf) {
        segs.push({ kind: "code", text: buf });
        buf = "";
      }
    };
    while (p < text.length) {
      const c = text[p]!;
      if (c === '"' || c === "'" || c === "`") {
        pushCode();
        const quote = c;
        let q = p + 1;
        while (q < text.length) {
          if (text[q] === "\\") {
            q += 2;
            continue;
          }
          if (text[q] === quote) {
            q++;
            break;
          }
          q++;
        }
        segs.push({ kind: "opaque", text: text.slice(p, q) });
        p = q;
        continue;
      }
      if (c === "/" && text[p + 1] === "/") {
        pushCode();
        let q = p;
        while (q < text.length && text[q] !== "\n") q++;
        segs.push({ kind: "opaque", text: text.slice(p, q) });
        p = q;
        continue;
      }
      if (c === "/" && text[p + 1] === "*") {
        pushCode();
        const end = text.indexOf("*/", p + 2);
        const q = end < 0 ? text.length : end + 2;
        segs.push({ kind: "opaque", text: text.slice(p, q) });
        p = q;
        continue;
      }
      buf += c;
      p++;
    }
    pushCode();
    return segs;
  };

  // 关键：模板字符串里的 `${...}` 不能被这些规则碰到，所以只处理 code 片段。
  // 注意：这里**不做**「删除裸标识符行」之类的激进规则 —— 早期版本用它清理类字段残留，
  // 结果把 `break;` 也一并删掉，导致 switch 全部贯穿。类字段已在解析阶段精确处理。
  let assertionHits = 0;
  let asHits = 0;
  out = splitSegments(out)
    .map((seg) => {
      if (seg.kind === "opaque") return seg.text;
      let code = seg.text;
      const a = /([A-Za-z0-9_$)\]])!(?=\s*[.,;)\]}=:&|?+\-*/<>])/g;
      const as =
        /\s+as\s+(?:const|[A-Za-z_$][\w$]*(?:\s*<[^;{}()]*?>)?(?:\s*\[\s*(?:"[^"]*"|'[^']*'|\s*)\s*\])*)/g;
      assertionHits += (code.match(a) ?? []).length;
      asHits += (code.match(as) ?? []).length;
      code = code.replace(a, "$1").replace(as, "");
      return code;
    })
    .join("");
  removed += assertionHits + asHits;

  // 还原 import 里被编码的 `as`（见 stripImportStatement）
  if (out.includes("\u0000A\u0000")) out = out.split("\u0000A\u0000").join(" as ");

  // 复核：产物里不应再出现明显的类型语法
  const checkRe = [
    /\binterface\s+[A-Za-z_$][\w$]*\s*\{/,
    /\btype\s+[A-Za-z_$][\w$]*\s*=/,
    /\b(?:private|public|protected|readonly)\s+[A-Za-z_$][\w$]*\s*[:;=]/,
    /\bsatisfies\s+[A-Za-z_$]/,
    /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*[A-Za-z_$]/,
  ];
  for (const re of checkRe) {
    const m = re.exec(out);
    if (m) suspicious.push(`${fileName}: 残留 ${JSON.stringify(m[0])}`);
  }

  return { code: out, removed, suspicious, removedTexts };
}
