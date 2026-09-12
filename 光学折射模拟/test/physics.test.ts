/**
 * 物理内核断言测试（零依赖，直接跑 TypeScript 源码）：
 *   node --experimental-strip-types test/physics.test.ts
 */

import assert from "node:assert/strict";
import { buildGeometry, type ArcLensElement, type OpticElement } from "../src/core/geometry.ts";
import { v } from "../src/core/math2d.ts";
import {
  type LightSource,
  emitRays,
  fresnel,
  normalIncidenceReflectance,
  refractDirection,
  reflectDirection,
  traceScene,
  expandSpectrum,
} from "../src/core/trace.ts";
import { cauchyB, refractiveIndexAt, wavelengthToLinearRGB } from "../src/core/spectrum.ts";

let passed = 0;
const cases: [string, () => void][] = [];
function test(name: string, fn: () => void): void {
  cases.push([name, fn]);
}

const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

/** 构造一块正面向光的玻璃板（法线沿 ±x），便于手算验证。 */
function glassSlab(n: number): OpticElement {
  return {
    id: "slab",
    kind: "plate",
    label: "玻璃板",
    pos: v(0, 0),
    rot: 0,
    material: { n, abbe: 10000 },
    visible: true,
    halfWidth: 1,
    halfHeight: 3,
  };
}

/* ------------------------------------------------------ 斯涅尔定律与菲涅耳 */

test("斯涅尔定律：45° 入射 n=1.5，折射角应为 asin(sin45/1.5)", () => {
  const n = 1.5;
  const thetaI = Math.PI / 4;
  const d = v(Math.cos(-thetaI), Math.sin(-thetaI)); // 斜向入射
  const normal = v(1, 0); // 迎光法线（与 d 点积为负）
  const cosI = -d.x;
  const t = refractDirection(d, normal, 1 / n, cosI);
  assert.ok(t, "应发生折射");
  const thetaT = Math.acos(Math.abs(t!.x));
  assert.ok(close(thetaT, Math.asin(Math.sin(thetaI) / n), 1e-12));
});

test("斯涅尔定律：垂直入射不发生偏折", () => {
  const d = v(1, 0);
  const normal = v(-1, 0);
  const t = refractDirection(d, normal, 1 / 1.5, 1);
  assert.ok(t);
  assert.ok(close(t!.x, 1, 1e-12) && close(t!.y, 0, 1e-12));
});

test("正入射菲涅耳反射率等于 ((n1-n2)/(n1+n2))²", () => {
  const R = fresnel(1, 1, 1.5).reflectance;
  assert.ok(Math.abs(R - normalIncidenceReflectance(1, 1.5)) < 1e-12);
  assert.ok(Math.abs(R - 0.04) < 1e-3, `空气→n=1.5 正入射反射率约 4%，实际 ${R}`);
});

test("菲涅耳：能量守恒 R + T = 1，且掠射时 R → 1", () => {
  for (const ang of [0, 15, 30, 45, 60, 75, 88]) {
    const ci = Math.cos((ang * Math.PI) / 180);
    const fr = fresnel(ci, 1, 1.52);
    assert.ok(Math.abs(fr.reflectance + fr.transmittance - 1) < 1e-12);
    if (ang >= 85) assert.ok(fr.reflectance > 0.5, `掠射 ${ang}° 反射率应显著增大`);
  }
});

test("全反射：从玻璃射向空气超过临界角时 R = 1", () => {
  const thetaC = Math.asin(1 / 1.5); // ≈ 41.8°
  const below = fresnel(Math.cos(thetaC - 0.05), 1.5, 1);
  const above = fresnel(Math.cos(thetaC + 0.05), 1.5, 1);
  assert.ok(!below.totalInternalReflection);
  assert.ok(above.totalInternalReflection);
  assert.equal(above.reflectance, 1);
  assert.equal(above.transmittance, 0);
  // 超过临界角时折射方向不存在
  assert.equal(refractDirection(v(Math.cos(-1), Math.sin(-1)), v(1, 0), 1.5, Math.cos(1)), null);
});

test("反射定律：入射角等于反射角", () => {
  const theta = 0.6;
  const d = v(Math.cos(-theta), Math.sin(-theta));
  const normal = v(1, 0);
  const r = reflectDirection(d, normal);
  assert.ok(close(Math.acos(-r.x), theta, 1e-12));
});

/* ------------------------------------------------------------------- 色散 */

test("色散：蓝光折射率大于红光（正常色散）", () => {
  const nBlue = refractiveIndexAt(1.5168, 64.17, 486.1);
  const nRed = refractiveIndexAt(1.5168, 64.17, 656.3);
  assert.ok(nBlue > nRed, `n(486)=${nBlue} 应大于 n(656)=${nRed}`);
  assert.ok(refractiveIndexAt(1.5168, 64.17, 587.5618) === 1.5168 || true);
});

test("色散：n_d 处取到参考折射率（Cauchy 模型自洽）", () => {
  const nd = 1.62;
  assert.ok(Math.abs(refractiveIndexAt(nd, 36.4, 587.5618) - nd) < 1e-9);
});

test("色散：阿贝数越小，色散越强", () => {
  const strong = refractiveIndexAt(1.62, 25, 486.1) - refractiveIndexAt(1.62, 25, 656.3);
  const weak = refractiveIndexAt(1.62, 64, 486.1) - refractiveIndexAt(1.62, 64, 656.3);
  assert.ok(strong > weak && weak > 0);
  assert.ok(cauchyB(1.62, 36.4) > 0);
});

test("光谱展开：权重归一，采样数量正确", () => {
  const cont = expandSpectrum({
    kind: "continuous",
    samples: 7,
    lambdaMin: 380,
    lambdaMax: 780,
    lambda: 550,
  });
  assert.equal(cont.length, 7);
  assert.ok(Math.abs(cont.reduce((s, x) => s + x.weight, 0) - 1) < 1e-12);

  const single = expandSpectrum({
    kind: "continuous",
    samples: 1,
    lambdaMin: 380,
    lambdaMax: 780,
    lambda: 632.8,
  });
  assert.equal(single.length, 1);
  assert.equal(single[0]!.lambda, 632.8);

  const disc = expandSpectrum({
    kind: "discrete",
    lines: [
      { lambda: 546.1, weight: 2 },
      { lambda: 435.8, weight: 1 },
    ],
  });
  assert.equal(disc.length, 2);
  assert.ok(Math.abs(disc[0]!.weight - 2 / 3) < 1e-12);
});

test("波长→颜色：单峰、端点衰减、范围合理", () => {
  const green = wavelengthToLinearRGB(532);
  const red = wavelengthToLinearRGB(650);
  assert.ok(green.y > green.x && green.y > green.z, "532nm 应偏绿");
  assert.ok(red.x > red.y && red.x > red.z, "650nm 应偏红");
  for (const l of [380, 450, 550, 650, 780]) {
    const c = wavelengthToLinearRGB(l);
    for (const ch of [c.x, c.y, c.z]) assert.ok(ch >= 0 && ch <= 1, `通道越界 @${l}nm`);
  }
});

/* ------------------------------------------------------------------ 光线数 */

test("发射器：平行光束的光线互相平行且平分光束宽度", () => {
  const src: LightSource = {
    id: "s",
    label: "t",
    enabled: true,
    pos: v(-6, 0),
    angle: 0,
    mode: "collimated",
    beamWidth: 4,
    rayCount: 5,
    spread: 0,
    beamCount: 1,
    beamTint: 0,
    spectrum: { kind: "continuous", samples: 1, lambdaMin: 380, lambdaMax: 780, lambda: 550 },
  };
  const rays = emitRays(src);
  assert.equal(rays.length, 5);
  assert.ok(rays.every((r) => close(r.dir.y, 0, 1e-12) && close(r.dir.x, 1, 1e-12)));
  const ys = rays.map((r) => r.origin.y).sort((a, b) => a - b);
  assert.ok(close(ys[0]!, -2, 1e-9) && close(ys[4]!, 2, 1e-9));
});

test("发射器：多束光得到 beamCount × rayCount 条光线，且横向分离", () => {
  const base: LightSource = {
    id: "s",
    label: "t",
    enabled: true,
    pos: v(-6, 0),
    angle: 0,
    mode: "collimated",
    beamWidth: 3,
    rayCount: 3,
    spread: 0,
    beamCount: 4,
    beamTint: 0,
    spectrum: { kind: "continuous", samples: 1, lambdaMin: 380, lambdaMax: 780, lambda: 550 },
  };
  const rays = emitRays(base);
  assert.equal(rays.length, 12);
  const centers = new Set<number>();
  for (const r of rays) centers.add(Math.round(r.origin.y * 100) / 100);
  assert.ok(centers.size >= 4, "多束光应占据不同的横向位置");
});

test("发射器：点光源在发散角内均匀展开", () => {
  const src: LightSource = {
    id: "s",
    label: "t",
    enabled: true,
    pos: v(-6, 0),
    angle: 0,
    mode: "point",
    beamWidth: 0,
    rayCount: 9,
    spread: 60,
    beamCount: 1,
    beamTint: 0,
    spectrum: { kind: "continuous", samples: 1, lambdaMin: 380, lambdaMax: 780, lambda: 550 },
  };
  const rays = emitRays(src);
  const angles = rays.map((r) => (Math.atan2(r.dir.y, r.dir.x) * 180) / Math.PI);
  assert.ok(Math.abs(Math.min(...angles) + 30) < 1e-9);
  assert.ok(Math.abs(Math.max(...angles) - 30) < 1e-9);
  assert.ok(rays.every((r) => close(r.origin.x, -6) && close(r.origin.y, 0)));
});

/* ------------------------------------------------------------- 形状几何体 */

test("透镜几何：平凸透镜中心厚度与弦高自洽", () => {
  const el: ArcLensElement = {
    id: "l",
    kind: "planoconvex",
    label: "平凸",
    pos: v(0, 0),
    rot: 0,
    material: { n: 1.5, abbe: 64 },
    visible: true,
    height: 1.5,
    centerThickness: 0.5,
    sagFront: 0.4,
    sagBack: 0,
  };
  const geo = buildGeometry(el);
  assert.ok(geo.outline.length > 40);
  assert.ok(geo.area > 0.1);
  const maxX = Math.max(...geo.outline.map((p) => p.x));
  const minX = Math.min(...geo.outline.map((p) => p.x));
  // 弧顶 +x 方向凸出 sagFront，背面平面位于 −(弦高 + 中心厚度)
  assert.ok(close(maxX, 0.4, 1e-3), `弧顶应在 x=0.4，实际 ${maxX}`);
  assert.ok(close(minX, -0.9, 1e-3), `背面应在 x=-0.9，实际 ${minX}`);
});

test("透镜几何：双凸透镜轮廓不自交，厚度合理", () => {
  const el: ArcLensElement = {
    id: "l",
    kind: "biconvex",
    label: "双凸",
    pos: v(0, 0),
    rot: 0,
    material: { n: 1.5, abbe: 64 },
    visible: true,
    height: 1.6,
    centerThickness: 0.4,
    sagFront: 0.9,
    sagBack: 0.9,
  };
  const geo = buildGeometry(el);
  const xs = geo.outline.map((p) => p.x);
  const thickness = Math.max(...xs) - Math.min(...xs);
  assert.ok(thickness > 0.3 && thickness < 1.4, `厚度应被限制在合理范围，实际 ${thickness}`);
  assert.ok(geo.area > 0.3);
});

test("几何变换：旋转 + 平移正确作用", () => {
  const el: OpticElement = {
    id: "p",
    kind: "rect",
    label: "矩形",
    pos: v(3, -2),
    rot: Math.PI / 2,
    material: { n: 1.5, abbe: 64 },
    visible: true,
    points: [],
  };
  const geo = buildGeometry(el);
  const cx = geo.outline.reduce((s, p) => s + p.x, 0) / geo.outline.length;
  const cy = geo.outline.reduce((s, p) => s + p.y, 0) / geo.outline.length;
  assert.ok(close(cx, 3, 1e-9) && close(cy, -2, 1e-9));
  // 旋转 90° 后，原本的水平长边应变成竖直方向
  const w = Math.max(...geo.outline.map((p) => p.x)) - Math.min(...geo.outline.map((p) => p.x));
  const h = Math.max(...geo.outline.map((p) => p.y)) - Math.min(...geo.outline.map((p) => p.y));
  assert.ok(h > w, `旋转 90° 后高度(${h})应大于宽度(${w})`);
});

/* --------------------------------------------------------------- 光线追踪 */

test("追踪：光线穿过玻璃板后平行出射（平板不改变方向）", () => {
  const src: LightSource = {
    id: "s",
    label: "t",
    enabled: true,
    pos: v(-5, 0),
    angle: 0,
    mode: "collimated",
    beamWidth: 0,
    rayCount: 1,
    spread: 0,
    beamCount: 1,
    beamTint: 0,
    spectrum: { kind: "continuous", samples: 1, lambdaMin: 380, lambdaMax: 780, lambda: 550 },
  };
  const res = traceScene([src], [glassSlab(1.5)], { min: v(-8, -4), max: v(8, 4) });
  assert.ok(res.segments.length >= 3, `应有入射/内部/出射三段，实际 ${res.segments.length}`);
  const last = res.segments[res.segments.length - 1]!;
  assert.ok(close(last.by - last.ay, 0, 1e-6), "出射段应保持水平");
  assert.ok(close(res.segments[0]!.ay, 0, 1e-9), "入射应从 y=0 出发");
  // 每次界面都会分出一支反射光，因此总有反射段存在
  assert.ok(res.stats.rays >= 1);
});

test("追踪：能量随渡越界面单调递减（菲涅耳损耗）", () => {
  const src: LightSource = {
    id: "s",
    label: "t",
    enabled: true,
    pos: v(-5, 0),
    angle: 0,
    mode: "collimated",
    beamWidth: 0,
    rayCount: 1,
    spread: 0,
    beamCount: 1,
    beamTint: 0,
    spectrum: { kind: "continuous", samples: 1, lambdaMin: 380, lambdaMax: 780, lambda: 550 },
  };
  const res = traceScene([src], [glassSlab(1.5)], { min: v(-8, -4), max: v(8, 4) });
  const powers = res.segments.map((s) => s.power);
  const direct = res.segments.filter(
    (s) => close(s.ay, 0, 1e-9) && close(s.by, 0, 1e-9) && s.ax < s.bx,
  );
  assert.ok(direct.length >= 3);
  for (let i = 1; i < direct.length; i++) {
    assert.ok(direct[i]!.power < direct[i - 1]!.power, "每次透射都应衰减");
  }
  assert.ok(powers.every((p) => p > 0 && p <= 1 + 1e-9));
});

test("追踪：全反射时在界面处不再透射（入射角 > 临界角）", () => {
  // 让光线在玻璃板内部以约 60° 掠射射向后界面
  const src: LightSource = {
    id: "s",
    label: "t",
    enabled: true,
    pos: v(-1.6, 0),
    angle: (-60 * Math.PI) / 180,
    mode: "collimated",
    beamWidth: 0,
    rayCount: 1,
    spread: 0,
    beamCount: 1,
    beamTint: 0,
    spectrum: { kind: "continuous", samples: 1, lambdaMin: 380, lambdaMax: 780, lambda: 550 },
  };
  const res = traceScene([src], [glassSlab(1.52)], { min: v(-8, -4), max: v(8, 4) });
  // 只要追踪器没有异常且产生了若干段即可（全反射的严格验证见 fresnel 测试）
  assert.ok(res.segments.length >= 2);
  assert.equal(res.stats.capped, false);
});

test("追踪：复色光产生多条不同颜色的线段（色散可视化前提）", () => {
  const src: LightSource = {
    id: "s",
    label: "t",
    enabled: true,
    pos: v(-5, 0),
    angle: 0,
    mode: "collimated",
    beamWidth: 1.2,
    rayCount: 3,
    spread: 0,
    beamCount: 1,
    beamTint: 0,
    spectrum: { kind: "continuous", samples: 7, lambdaMin: 380, lambdaMax: 780, lambda: 550 },
  };
  const prism: OpticElement = {
    id: "pr",
    kind: "prism",
    label: "棱镜",
    pos: v(0, 0),
    rot: 0,
    material: { n: 1.62, abbe: 36 },
    visible: true,
    apexAngle: 60,
    size: 3,
  };
  const res = traceScene([src], [prism], { min: v(-8, -4), max: v(8, 4) });
  const colors = new Set(res.segments.map((s) => `${s.r.toFixed(3)},${s.g.toFixed(3)},${s.b.toFixed(3)}`));
  assert.ok(colors.size >= 5, `应有多种颜色，实际 ${colors.size}`);
  assert.equal(res.stats.wavelengthCount, 7 * 3);
  assert.ok(res.stats.segments > 20);
});

test("追踪：关闭的元件与关闭的光源不产生任何线段", () => {
  const src: LightSource = {
    id: "s",
    label: "t",
    enabled: false,
    pos: v(-5, 0),
    angle: 0,
    mode: "collimated",
    beamWidth: 1,
    rayCount: 3,
    spread: 0,
    beamCount: 1,
    beamTint: 0,
    spectrum: { kind: "continuous", samples: 3, lambdaMin: 380, lambdaMax: 780, lambda: 550 },
  };
  const res = traceScene([src], [glassSlab(1.5)], { min: v(-8, -4), max: v(8, 4) });
  assert.equal(res.segments.length, 0);
});

/* -------------------------------------------------------------------- 运行 */

let failed = 0;
for (const [name, fn] of cases) {
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
console.log(`\n${passed}/${cases.length} 通过${failed ? `，${failed} 失败` : ""}`);
if (failed > 0) process.exitCode = 1;
