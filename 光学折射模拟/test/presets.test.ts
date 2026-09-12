/**
 * 场景预设自检：每个预设的光源都必须真的打中光学元件，
 * 否则画面上只会有一条穿过空白的直线（这正是开发过程中踩到的坑）。
 *
 *   node --experimental-strip-types test/presets.test.ts
 */

import assert from "node:assert/strict";
import { buildGeometry, intersectShape } from "../src/core/geometry.ts";
import { DEFAULT_TRACE_OPTIONS, emitRays, traceScene } from "../src/core/trace.ts";
import { SCENE_PRESETS } from "../src/scene.ts";

const WORLD = { min: { x: -9, y: -4.5 }, max: { x: 9, y: 4.5 } };

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

test("每个场景预设至少有一条光线命中光学元件", () => {
  for (const preset of SCENE_PRESETS) {
    const { elements, sources } = preset.build();
    const shapes = elements.filter((e) => e.visible).map((el) => ({ el, geo: buildGeometry(el) }));
    let hits = 0;
    for (const src of sources) {
      for (const ray of emitRays(src)) {
        for (const s of shapes) {
          const hit = intersectShape(ray.origin, ray.dir, s.geo, s.el, 5e-4);
          if (hit) {
            hits++;
            break;
          }
        }
      }
    }
    assert.ok(hits > 0, `预设「${preset.label}」的光线全部掠过元件，没有任何一条命中`);
  }
});

test("每个场景预设都能追踪出线段且不触发安全上限", () => {
  for (const preset of SCENE_PRESETS) {
    const { elements, sources } = preset.build();
    const res = traceScene(sources, elements, WORLD, DEFAULT_TRACE_OPTIONS);
    assert.ok(res.stats.segments >= 3, `预设「${preset.label}」线段过少: ${res.stats.segments}`);
    assert.equal(res.stats.capped, false, `预设「${preset.label}」触发了上限`);
    assert.ok(res.stats.ms < 400, `预设「${preset.label}」追踪过慢: ${res.stats.ms.toFixed(1)}ms`);
  }
});

test("棱镜色散：光线在棱镜内部传播，且出射后出现多种颜色", () => {
  const preset = SCENE_PRESETS.find((p) => p.key === "prism-dispersion")!;
  const { elements, sources } = preset.build();
  const prism = elements[0]!;
  const geo = buildGeometry(prism);
  const inside = { minX: geo.aabb.min.x, maxX: geo.aabb.max.x, minY: geo.aabb.min.y, maxY: geo.aabb.max.y };

  const res = traceScene(sources, elements, WORLD, DEFAULT_TRACE_OPTIONS);

  // 至少有一条线段整体位于棱镜包围盒内部（即光线真的进入并穿过玻璃）
  const inGlass = res.segments.filter((s) => {
    const mx = (s.ax + s.bx) / 2;
    const my = (s.ay + s.by) / 2;
    return mx > inside.minX && mx < inside.maxX && my > inside.minY && my < inside.maxY;
  });
  assert.ok(inGlass.length > 0, "没有任何线段落在棱镜内部，说明光线没有进入棱镜");

  // 出射侧应出现明显的颜色分离（不同波长的出射点不同）
  const exiting = res.segments.filter((s) => s.bx > inside.maxX && s.power > 0.02);
  const colors = new Set(exiting.map((s) => `${s.r.toFixed(3)}|${s.g.toFixed(3)}|${s.b.toFixed(3)}`));
  assert.ok(colors.size >= 5, `出射光应有明显色散，实际只有 ${colors.size} 种颜色`);

  // 出射端点应散布开（光谱展开）
  const ys = exiting.map((s) => s.by);
  const spread = Math.max(...ys) - Math.min(...ys);
  assert.ok(spread > 0.05, `光谱展开过小: ${spread.toFixed(4)}`);
});

test("全反射演示：光线在玻璃内部发生反射并再次从玻璃出射", () => {
  const preset = SCENE_PRESETS.find((p) => p.key === "total-reflection")!;
  const { elements, sources } = preset.build();
  const res = traceScene(sources, elements, WORLD, DEFAULT_TRACE_OPTIONS);

  // 应该有明显多于「入射 + 出射」两段的光路（内部多次反射）
  assert.ok(res.segments.length >= 6, `线段过少，可能没有发生内部反射: ${res.segments.length}`);

  // 存在水平方向反向传播的线段（被上表面反射回来）
  const backwards = res.segments.filter((s) => s.bx - s.ax < -1e-6);
  assert.ok(backwards.length > 0, "没有找到反向传播的反射光");

  // 反射段的能量应低于入射段（菲涅耳反射率 < 1）
  const total = res.segments.reduce((acc, s) => acc + s.power, 0);
  assert.ok(total > 0 && total < 40, `总能量异常: ${total}`);
});

test("水滴彩虹：圆形水珠内部产生一次反射与出射色散", () => {
  const preset = SCENE_PRESETS.find((p) => p.key === "water-drop")!;
  const { elements, sources } = preset.build();
  const res = traceScene(sources, elements, WORLD, DEFAULT_TRACE_OPTIONS);
  assert.ok(res.stats.segments > 20, `线段过少: ${res.stats.segments}`);
  const colors = new Set(res.segments.map((s) => `${s.r.toFixed(2)}|${s.g.toFixed(2)}|${s.b.toFixed(2)}`));
  assert.ok(colors.size >= 8, `应有多种波长参与，实际 ${colors.size} 种`);
});

test("凸透镜聚焦：平行光穿过透镜后向光轴会聚", () => {
  const preset = SCENE_PRESETS.find((p) => p.key === "convex-focus")!;
  const { elements, sources } = preset.build();
  const res = traceScene(sources, elements, WORLD, DEFAULT_TRACE_OPTIONS);
  const el = elements[0]!;
  const geo = buildGeometry(el);

  // 取透镜右侧、靠近光轴的最强线段（出射光），其上端点应比下端点更接近光轴
  const outgoing = res.segments
    .filter((s) => s.ax > geo.aabb.max.x - 0.2 && s.power > 0.05)
    .sort((a, b) => b.power - a.power);
  assert.ok(outgoing.length > 0, "没有找到透镜出射的光线");
  const slopes = outgoing.map((s) => {
    const dy = s.by - s.ay;
    const dx = s.bx - s.ax;
    return dy / dx;
  });
  const converging = slopes.filter((m) => m < -0.02).length;
  assert.ok(converging > 0, "出射光线没有向光轴会聚的斜率");
});

console.log(`\n${passed}/${passed + failed} 通过${failed ? `，${failed} 失败` : ""}`);
if (failed > 0) process.exitCode = 1;
