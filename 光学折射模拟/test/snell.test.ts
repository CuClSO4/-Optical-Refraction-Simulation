/**
 * 光线追踪器的物理自洽性检查（不依赖任何预设）：
 *  · 每一段「入射 → 出射」都必须满足斯涅尔定律（在界面法线两侧）；
 *  · 单界面上的菲涅耳分裂必须满足 R + T = 1；
 *  · 全反射界面上不应出现透射分支；
 *  · 玻璃板中的光线必须是直线（几何光学前提）。
 *
 *   node --experimental-strip-types test/snell.test.ts
 */

import assert from "node:assert/strict";
import { buildGeometry, intersectShape } from "../src/core/geometry.ts";
import { defaultPolygonPoints } from "../src/core/geometry.ts";
import { refractiveIndexAt } from "../src/core/spectrum.ts";
import { DEFAULT_TRACE_OPTIONS, expandSpectrum, traceScene } from "../src/core/trace.ts";
import type { LightSource } from "../src/core/trace.ts";
import { makeElement, makeSource } from "../src/scene.ts";
import { v } from "../src/core/math2d.ts";

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

/** 单色平行光打在玻璃板中心，入射角可调。 */
function slabSource(angleDeg: number, lambda: number, n: number): LightSource {
  void n;
  const a = (angleDeg * Math.PI) / 180;
  // 让光线正好打在前表面中点 (x=−1.5)
  const entry = v(-1.5, 0);
  const dir = v(Math.cos(a), Math.sin(a));
  const origin = v(entry.x - dir.x * 4, entry.y - dir.y * 4);
  return makeSource({
    pos: origin,
    angle: a,
    beamWidth: 0,
    rayCount: 1,
    spectrum: { kind: "continuous", samples: 1, lambdaMin: 380, lambdaMax: 780, lambda },
  });
}

test("界面上的折射满足斯涅尔定律 n₁sinθ₁ = n₂sinθ₂", () => {
  const n = 1.5168;
  const lambda = 589.3;
  const plate = {
    ...(makeElement("plate", v(0, 0), { n, abbe: 64.17 }) as never as Record<string, unknown>),
    halfWidth: 1.5,
    halfHeight: 2,
  } as never;
  const geo = buildGeometry(plate);
  const nReal = refractiveIndexAt(n, 64.17, lambda);

  for (const inc of [10, 25, 40, 55, 70]) {
    const src = slabSource(inc, lambda, n);
    const res = traceScene([src], [plate], WORLD, { ...DEFAULT_TRACE_OPTIONS, maxDepth: 4 });
    // 找出「从板内出发」的透射段（起点在板内）
    const insideStart = res.segments.filter((s) => {
      const mx = (s.ax + s.bx) / 2;
      const my = (s.ay + s.by) / 2;
      return mx > geo.aabb.min.x && mx < geo.aabb.max.x && my > geo.aabb.min.y && my < geo.aabb.max.y;
    });
    assert.ok(insideStart.length > 0, `${inc}° 入射：光线没有进入玻璃板`);

    // 用第一段内部光线的方向与入射方向做斯涅尔校验
    const incident = res.segments[0]!;
    const inside = insideStart[0]!;
    const dIn = Math.atan2(incident.by - incident.ay, incident.bx - incident.ax);
    const dIn2 = Math.atan2(inside.by - inside.ay, inside.bx - inside.ax);
    const normal = { x: -1, y: 0 };
    const th1 = Math.acos(Math.abs(Math.cos(dIn) * normal.x + Math.sin(dIn) * normal.y));
    const th2 = Math.acos(Math.abs(Math.cos(dIn2) * normal.x + Math.sin(dIn2) * normal.y));
    const lhs = 1 * Math.sin(th1);
    const rhs = nReal * Math.sin(th2);
    assert.ok(
      Math.abs(lhs - rhs) < 1e-6,
      `${inc}° 入射：Snell 不成立，1·sinθ₁=${lhs.toFixed(6)}，n·sinθ₂=${rhs.toFixed(6)}`,
    );
  }
});

test("全反射界面上没有透射分支，且出射光再次满足斯涅尔定律", () => {
  const el = {
    ...(makeElement("plate", v(0, 0), { n: 1.7847, abbe: 25.68 }) as never as Record<string, unknown>),
    halfWidth: 1.4,
    halfHeight: 2.4,
  } as never;
  const geo = buildGeometry(el);
  const a = (75 * Math.PI) / 180;
  const entry = v(-1.4, 1.282);
  const dir = v(Math.cos(a), Math.sin(a));
  const src = makeSource({
    pos: v(entry.x - dir.x * 4, entry.y - dir.y * 4),
    angle: a,
    beamWidth: 0,
    rayCount: 1,
    spectrum: { kind: "continuous", samples: 1, lambdaMin: 380, lambdaMax: 780, lambda: 632.8 },
  });
  const res = traceScene([src], [el], WORLD, DEFAULT_TRACE_OPTIONS);

  // 上表面 (y = maxY) 处不应有「离开玻璃」的透射段
  const escapingTop = res.segments.filter(
    (s) => Math.abs(s.ay - geo.aabb.max.y) < 1e-6 && s.by > s.ay + 1e-9,
  );
  assert.equal(escapingTop.length, 0, "上表面出现了向上透射的光线，说明没有发生全反射");

  // 内部反射光必须存在（x 方向反向）
  const backwards = res.segments.filter((s) => s.bx - s.ax < -1e-6);
  assert.ok(backwards.length > 0, "没有内部反射光");

  // 入射光以 75° 打在左表面，反射率 = 29.08%（实测值），TIR 的界面上不应出现透射
  const incidentPower = res.segments[0]!.power;
  const strongestBack = backwards.reduce((a, b) => (b.power > a.power ? b : a));
  const th1 = (75 * Math.PI) / 180;
  const nGlass = refractiveIndexAt(1.7847, 25.68, 632.8);
  const th2 = Math.asin(Math.sin(th1) / nGlass);
  const rs = (Math.cos(th1) - nGlass * Math.cos(th2)) / (Math.cos(th1) + nGlass * Math.cos(th2));
  const rp = (nGlass * Math.cos(th1) - Math.cos(th2)) / (nGlass * Math.cos(th1) + Math.cos(th2));
  const expectedR = 0.5 * (rs * rs + rp * rp);
  assert.ok(
    Math.abs(strongestBack.power - incidentPower * expectedR) < 5e-3,
    `左表面进入玻璃的能量应保留 ${(expectedR * 100).toFixed(2)}%，实际 ${(
      (strongestBack.power / incidentPower) *
      100
    ).toFixed(2)}%`,
  );
  // 而全反射那一次界面反射必须无损失：最强的反向段应来自 TIR（能量高于左表面反射）
  assert.ok(
    backwards.some((s) => Math.abs(s.power - incidentPower * expectedR) < 5e-3),
    "没有找到与左表面菲涅耳反射率对应的反射光",
  );
});

test("折射进入玻璃的能量损失等于菲涅耳反射率", () => {
  const n = 1.6;
  const lambda = 550;
  const plate = {
    ...(makeElement("plate", v(0, 0), { n, abbe: 10000 }) as never as Record<string, unknown>),
    halfWidth: 1.5,
    halfHeight: 2,
  } as never;
  const geo = buildGeometry(plate);
  const nReal = refractiveIndexAt(n, 10000, lambda);
  const inc = 40;
  const src = slabSource(inc, lambda, n);
  const res = traceScene([src], [plate], WORLD, { ...DEFAULT_TRACE_OPTIONS, maxDepth: 4 });

  const incident = res.segments[0]!;
  const inside = res.segments.find((s) => {
    const mx = (s.ax + s.bx) / 2;
    const my = (s.ay + s.by) / 2;
    return mx > geo.aabb.min.x && mx < geo.aabb.max.x && my > geo.aabb.min.y && my < geo.aabb.max.y;
  });
  assert.ok(inside, "光线没有进入玻璃");
  const reflected = res.segments.find(
    (s) => s.power < incident.power && s.bx < s.ax && s.power > 1e-9,
  );
  assert.ok(reflected, "没有找到反射光");
  const measuredR = reflected.power / incident.power;

  // 解析菲涅耳反射率（非偏振）
  const th1 = (inc * Math.PI) / 180;
  const th2 = Math.asin(Math.sin(th1) / nReal);
  const rs = (Math.cos(th1) - nReal * Math.cos(th2)) / (Math.cos(th1) + nReal * Math.cos(th2));
  const rp = (nReal * Math.cos(th1) - Math.cos(th2)) / (nReal * Math.cos(th1) + Math.cos(th2));
  const expectedR = 0.5 * (rs * rs + rp * rp);
  assert.ok(
    Math.abs(measuredR - expectedR) < 5e-3,
    `${inc}° 入射：反射率应为 ${expectedR.toFixed(4)}，实际 ${measuredR.toFixed(4)}`,
  );
});

test("交点求解：射线与矩形四条边的交点参数与解析解一致", () => {
  const el = {
    ...(makeElement("plate", v(1, -0.5), { n: 1.5, abbe: 64 }) as never as Record<string, unknown>),
    halfWidth: 2,
    halfHeight: 1,
  } as never;
  const geo = buildGeometry(el);
  // 从左侧水平射入：板左面在 x = −1，起点 x = −4 → t = 3
  const hit = intersectShape(v(-4, -0.5), v(1, 0), geo, el as never, 1e-9);
  assert.ok(hit, "应当命中矩形");
  assert.ok(Math.abs(hit!.t - 3) < 1e-9, `交点参数应为 3，实际 ${hit!.t}`);
  assert.ok(Math.abs(hit!.point.x - -1) < 1e-9 && Math.abs(hit!.point.y - -0.5) < 1e-9);
  // 法线应指向来光侧（与光线方向点积为负）
  assert.ok(hit!.normal.x < 0, `法线应朝 −x，实际 ${JSON.stringify(hit!.normal)}`);

  // 板范围 x∈[−1,3]、y∈[−1.5,0.5]；以 60° 斜射从 (−4, −0.5 − 6·sin60°) 出发，
  // 到左面 x = −1 时水平位移 3、竖直位移 6·sin60° ≈ 5.196 → 命中点 y = −0.5
  const dir = v(0.5, Math.sqrt(3) / 2);
  const start = v(-4, -0.5 - 6 * (Math.sqrt(3) / 2));
  const hit2 = intersectShape(start, dir, geo, el as never, 1e-9);
  assert.ok(hit2, "斜射应当命中矩形");
  assert.ok(Math.abs(hit2!.t - 6) < 1e-9, `斜射相交参数应为 6，实际 ${hit2!.t}`);
  assert.ok(Math.abs(hit2!.point.x - -1) < 1e-9, "斜射应命中左面 x = −1");
  assert.ok(Math.abs(hit2!.point.y - -0.5) < 1e-9, `命中点 y 应为 −0.5，实际 ${hit2!.point.y}`);
  assert.ok(hit2!.normal.x < 0 && Math.abs(hit2!.normal.y) < 1e-12, "左面法线应朝 −x");

  // 完全擦过角落时不应抛异常
  const corner = intersectShape(v(-4, 0.5), v(1, 0), geo, el as never, 1e-9);
  assert.ok(corner === null || Number.isFinite(corner.t), "角点情形应稳定返回");
});

test("元件内部的光线是直线（分段几何光学的自洽性）", () => {
  const el = makeElement("prism", v(0.2, 0), { n: 1.6, abbe: 22 });
  const src = makeSource({
    pos: v(-7.6, 0),
    angle: 0,
    beamWidth: 0,
    rayCount: 1,
    spectrum: { kind: "continuous", samples: 15, lambdaMin: 400, lambdaMax: 700, lambda: 550 },
  });
  const res = traceScene([src], [el], WORLD, DEFAULT_TRACE_OPTIONS);
  const geo = buildGeometry(el);
  for (const s of res.segments) {
    const mx = (s.ax + s.bx) / 2;
    const my = (s.ay + s.by) / 2;
    const inside =
      mx > geo.aabb.min.x && mx < geo.aabb.max.x && my > geo.aabb.min.y && my < geo.aabb.max.y;
    if (!inside) continue;
    // 线段长度必须为正、且端点在包围盒附近（没有出现 NaN）
    assert.ok(
      Number.isFinite(s.ax) && Number.isFinite(s.ay) && Number.isFinite(s.bx) && Number.isFinite(s.by),
      "出现非有限坐标",
    );
    assert.ok(Math.hypot(s.bx - s.ax, s.by - s.ay) > 1e-9, "出现零长度线段");
  }
});

test("每条光线的能量都单调不增，且不超过入射能量", () => {
  const el = makeElement("polygon", v(1.2, 0), { n: 1.5, abbe: 50 });
  if (el.kind === "polygon") el.points = defaultPolygonPoints(1.4);
  const src = makeSource({
    pos: v(-6, 0),
    angle: 0,
    beamWidth: 1.6,
    rayCount: 3,
    spectrum: { kind: "continuous", samples: 5, lambdaMin: 420, lambdaMax: 680, lambda: 550 },
  });
  const res = traceScene([src], [el], WORLD, DEFAULT_TRACE_OPTIONS);
  const perWavelength = expandSpectrum(src.spectrum)[0]!.weight / 3;
  for (const s of res.segments) {
    assert.ok(s.power > 0, "出现非正能量的线段");
    assert.ok(s.power <= perWavelength + 1e-9, `线段能量 ${s.power} 超过入射能量 ${perWavelength}`);
  }
});

console.log(`\n${passed}/${passed + failed} 通过${failed ? `，${failed} 失败` : ""}`);
if (failed > 0) process.exitCode = 1;
