/**
 * 等价性测试：纯 JS 版本（dist/）与 TS 源码版本（src/）必须在同一输入下产出完全相同的输出。
 *
 *   node --experimental-strip-types test/roundtrip.test.ts
 *
 * 这是「dist 可替代 src 运行」的硬性保证：一旦转换器剥错东西，
 * 这里会立刻以数值差异暴露出来。
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installDom } from "./dom-stub.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = join(ROOT, "dist", "core", "trace.js");

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (!existsSync(distEntry)) {
  console.error("缺少 dist/ —— 请先运行： node --experimental-strip-types tools/build-js.ts");
  process.exit(1);
}

const ts = {
  trace: await import("../src/core/trace.ts"),
  geometry: await import("../src/core/geometry.ts"),
  spectrum: await import("../src/core/spectrum.ts"),
  math: await import("../src/core/math2d.ts"),
  scene: await import("../src/scene.ts"),
};
const js = {
  trace: await import("../dist/core/trace.js"),
  geometry: await import("../dist/core/geometry.js"),
  spectrum: await import("../dist/core/spectrum.js"),
  math: await import("../dist/core/math2d.js"),
  scene: await import("../dist/scene.js"),
};

/**
 * UI 层（render / ui / main / view）含有 DOM 调用，只能在打桩环境里加载。
 * 这里先装好全局桩，再逐个 import，用来验证转换器没有把 UI 代码改坏。
 */
const dom = installDom();
const uiModules: Record<string, { ok: boolean; error?: string; exports?: string[] }> = {};
for (const name of ["view", "render", "ui", "main", "boot"]) {
  try {
    const mod = (await import(`../dist/${name}.js`)) as Record<string, unknown>;
    uiModules[name] = { ok: true, exports: Object.keys(mod) };
  } catch (err) {
    uiModules[name] = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
void dom;

const WORLD = { min: { x: -9, y: -4.5 }, max: { x: 9, y: 4.5 } };

test("所有模块都能被加载（dist 的导出名与 src 一致）", () => {
  for (const key of ["trace", "geometry", "spectrum", "math", "scene"] as const) {
    const missing = Object.keys(ts[key]).filter((k) => !(k in js[key]));
    assert.equal(missing.length, 0, `${key} 缺少导出: ${missing.join(", ")}`);
  }
});

test("UI 层产物（view/render/ui/main/boot）能被解析并加载", () => {
  for (const [name, info] of Object.entries(uiModules)) {
    assert.ok(info.ok, `dist/${name}.js 加载失败: ${info.error}`);
  }
  assert.ok(uiModules.view!.exports!.includes("Viewport"), "view.js 应导出 Viewport");
  assert.ok(uiModules.render!.exports!.includes("Renderer"), "render.js 应导出 Renderer");
  assert.ok(uiModules.ui!.exports!.includes("Panel"), "ui.js 应导出 Panel");
  assert.ok(uiModules.main!.exports!.includes("App"), "main.js 应导出 App");
  assert.ok(uiModules.main!.exports!.includes("boot"), "main.js 应导出 boot");
});

test("dist/boot.js 在 DOM 打桩下能真正启动应用（面板被填充、无错误横幅）", () => {
  // boot.js 是浏览器入口：import 时它会自行启动应用
  const win = (globalThis as unknown as { tick?: (n?: number) => void }).tick;
  win?.(2);
  const panel = document.getElementById("panel")!;
  const crash = document.getElementById("crash") as unknown as { hidden: boolean; textContent: string };
  // 先报出错误横幅内容，便于定位（如果有）
  assert.ok(
    crash.hidden,
    `启动过程留下了错误横幅:\n${String(crash.textContent).slice(0, 400)}`,
  );
  assert.ok(panel.all().length > 40, `启动后面板应被填充，实际 ${panel.all().length} 个节点`);
});

test("色散函数逐点一致", () => {
  for (const lambda of [380, 405, 486.1, 550, 587.5618, 656.3, 700, 780]) {
    for (const [n, abbe] of [
      [1.5168, 64.17],
      [1.72, 18],
      [2.417, 55],
      [1.0, 10000],
    ] as const) {
      const a = ts.spectrum.refractiveIndexAt(n, abbe, lambda);
      const b = js.spectrum.refractiveIndexAt(n, abbe, lambda);
      assert.equal(b, a, `n(${lambda}) 不一致: ${a} vs ${b}`);
    }
  }
});

test("波长→RGB 一致", () => {
  for (const lambda of [380, 440, 532, 589, 632.8, 700, 780]) {
    assert.deepEqual(js.spectrum.wavelengthToLinearRGB(lambda), ts.spectrum.wavelengthToLinearRGB(lambda));
  }
});

test("几何轮廓逐点一致", () => {
  for (const [i, preset] of ts.scene.SCENE_PRESETS.entries()) {
    const a = preset.build();
    const b = js.scene.SCENE_PRESETS[i]!.build();
    assert.equal(b.elements.length, a.elements.length, `预设 ${preset.label} 元件数不同`);
    for (let k = 0; k < a.elements.length; k++) {
      const ga = ts.geometry.buildGeometry(a.elements[k]!);
      const gb = js.geometry.buildGeometry(b.elements[k]!);
      assert.equal(gb.outline.length, ga.outline.length, `预设 ${preset.label} 轮廓点数不同`);
      for (let j = 0; j < ga.outline.length; j++) {
        assert.equal(gb.outline[j]!.x, ga.outline[j]!.x, `预设 ${preset.label} 第 ${j} 点 x 不同`);
        assert.equal(gb.outline[j]!.y, ga.outline[j]!.y, `预设 ${preset.label} 第 ${j} 点 y 不同`);
      }
      assert.equal(gb.area, ga.area, `预设 ${preset.label} 面积不同`);
    }
  }
});

test("光线追踪结果逐位一致（8 个预设 × 全部线段）", () => {
  for (const preset of ts.scene.SCENE_PRESETS) {
    const a = preset.build();
    const b = js.scene.SCENE_PRESETS.find((p) => p.label === preset.label)!.build();
    const ra = ts.trace.traceScene(a.sources, a.elements, WORLD, ts.trace.DEFAULT_TRACE_OPTIONS);
    const rb = js.trace.traceScene(b.sources, b.elements, WORLD, js.trace.DEFAULT_TRACE_OPTIONS);
    assert.equal(rb.segments.length, ra.segments.length, `预设 ${preset.label} 线段数不同`);
    assert.equal(rb.stats.traced, ra.stats.traced, `预设 ${preset.label} 求交次数不同`);
    assert.equal(rb.stats.rays, ra.stats.rays, `预设 ${preset.label} 光线数不同`);
    for (let i = 0; i < ra.segments.length; i++) {
      const sa = ra.segments[i]!;
      const sb = rb.segments[i]!;
      assert.equal(sb.ax, sa.ax, `预设 ${preset.label} 第 ${i} 段 ax`);
      assert.equal(sb.ay, sa.ay, `预设 ${preset.label} 第 ${i} 段 ay`);
      assert.equal(sb.bx, sa.bx, `预设 ${preset.label} 第 ${i} 段 bx`);
      assert.equal(sb.by, sa.by, `预设 ${preset.label} 第 ${i} 段 by`);
      assert.equal(sb.power, sa.power, `预设 ${preset.label} 第 ${i} 段 power`);
      assert.equal(sb.r, sa.r, `预设 ${preset.label} 第 ${i} 段 r`);
      assert.equal(sb.g, sa.g, `预设 ${preset.label} 第 ${i} 段 g`);
      assert.equal(sb.b, sa.b, `预设 ${preset.label} 第 ${i} 段 b`);
    }
  }
});

test("发射器（单束/多束/点光源）输出一致", () => {
  const cases = [
    { mode: "collimated", beamWidth: 4, rayCount: 5, spread: 0, beamCount: 1, beamTint: 0 },
    { mode: "collimated", beamWidth: 4.6, rayCount: 1, spread: 0, beamCount: 5, beamTint: 90 },
    { mode: "point", beamWidth: 0, rayCount: 9, spread: 60, beamCount: 1, beamTint: 0 },
    { mode: "area", beamWidth: 3, rayCount: 7, spread: 30, beamCount: 3, beamTint: 40 },
  ] as const;
  for (const c of cases) {
    const make = (mod: typeof ts.trace): unknown =>
      mod.emitRays({
        id: "s",
        label: "t",
        enabled: true,
        pos: { x: -6, y: 0.4 },
        angle: 0.3,
        mode: c.mode,
        beamWidth: c.beamWidth,
        rayCount: c.rayCount,
        spread: c.spread,
        beamCount: c.beamCount,
        beamTint: c.beamTint,
        spectrum: {
          kind: "continuous",
          samples: 5,
          lambdaMin: 400,
          lambdaMax: 700,
          lambda: 550,
        },
      } as never);
    assert.deepEqual(make(js.trace), make(ts.trace), `${c.mode} 发射器输出不同`);
  }
});

test("光谱展开与菲涅耳系数一致", () => {
  const spec = { kind: "continuous", samples: 15, lambdaMin: 400, lambdaMax: 700, lambda: 550 } as const;
  assert.deepEqual(js.trace.expandSpectrum(spec as never), ts.trace.expandSpectrum(spec as never));
  const discrete = { kind: "discrete", lines: [{ lambda: 546.1, weight: 2 }, { lambda: 435.8, weight: 1 }] } as const;
  assert.deepEqual(js.trace.expandSpectrum(discrete as never), ts.trace.expandSpectrum(discrete as never));
  for (const cosI of [1, 0.9, 0.7, 0.5, 0.2, 0.05]) {
    assert.deepEqual(js.trace.fresnel(cosI, 1, 1.52), ts.trace.fresnel(cosI, 1, 1.52));
    assert.deepEqual(js.trace.fresnel(cosI, 1.52, 1), ts.trace.fresnel(cosI, 1.52, 1));
  }
});

test("矢量工具与射线求交一致", () => {
  const plate = {
    id: "p",
    kind: "plate",
    label: "板",
    pos: { x: 1, y: -0.5 },
    rot: 0.3,
    material: { n: 1.5, abbe: 64 },
    visible: true,
    halfWidth: 2,
    halfHeight: 1,
  } as const;
  const ga = ts.geometry.buildGeometry(plate as never);
  const gb = js.geometry.buildGeometry(plate as never);
  for (const [o, d] of [
    [{ x: -4, y: -0.5 }, { x: 1, y: 0 }],
    [{ x: -4, y: -2 }, { x: 0.5, y: Math.sqrt(3) / 2 }],
    [{ x: 0, y: 3 }, { x: 0.2, y: -1 }],
  ] as const) {
    const ha = ts.geometry.intersectShape(o, d, ga, plate as never, 1e-9);
    const hb = js.geometry.intersectShape(o, d, gb, plate as never, 1e-9);
    assert.equal(hb?.t ?? null, ha?.t ?? null, `交点参数不同 (${JSON.stringify(o)})`);
    assert.equal(hb?.point.x ?? null, ha?.point.x ?? null);
    assert.equal(hb?.point.y ?? null, ha?.point.y ?? null);
  }
});

console.log(`\n${passed}/${passed + failed} 通过${failed ? `，${failed} 失败` : ""}`);
if (failed > 0) process.exitCode = 1;
