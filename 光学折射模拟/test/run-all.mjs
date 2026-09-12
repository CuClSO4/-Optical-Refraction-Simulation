/**
 * 零依赖测试入口：依次运行全部测试文件。
 *
 *   npm test
 *   node test/run-all.mjs          （或 node --experimental-strip-types test/run-all.ts）
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const suites = [
  ["物理内核", "physics.test.ts"],
  ["斯涅尔定律自洽性", "snell.test.ts"],
  ["场景预设", "presets.test.ts"],
  ["dist ↔ src 等价性（纯 JS 产物）", "roundtrip.test.ts"],
  ["静态自检", "lint.ts"],
  ["界面端到端冒烟", "app.smoke.ts"],
];

let failed = 0;
for (const [title, file] of suites) {
  console.log(`\n──────── ${title} (${file}) ────────`);
  const res = spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(here, file)],
    { stdio: "inherit" },
  );
  if (res.status !== 0) failed++;
}

console.log(
  failed === 0
    ? `\n全部 ${suites.length} 个测试文件通过 ✓`
    : `\n有 ${failed} 个测试文件未通过 ✗`,
);
process.exitCode = failed === 0 ? 0 : 1;
