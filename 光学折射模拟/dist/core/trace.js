/**
 * 光线追踪内核（二维几何光学）。
 *
 * 物理模型
 * ─────────
 * 1) 折射：矢量形式的斯涅尔定律（无全反射时）
 *      t = (n₁/n₂)·d + ( (n₁/n₂)·cosθᵢ − cosθₜ ) · n
 *    其中 n 为指向入射侧的单位法线，cosθᵢ = −n·d，
 *    cosθₜ = √(1 − (n₁/n₂)²(1 − cos²θᵢ))；根号内为负即发生全反射。
 *
 * 2) 反射：r = d − 2(n·d)·n
 *
 * 3) 分光：非偏振光的菲涅耳反射率
 *      R = ½·(Rs + Rp)，Rs = |(n₁cosθᵢ − n₂cosθₜ)/(n₁cosθᵢ + n₂cosθₜ)|²
 *                        Rp = |(n₁cosθₜ − n₂cosθᵢ)/(n₁cosθₜ + n₂cosθᵢ)|²
 *    透射率取 T = 1 − R（忽略吸收），因此光线在界面处按 R / T 分裂成两支，
 *    携带的能量严格守恒。全反射时 R = 1、T = 0。
 *
 * 4) 色散：n 随波长变化，用 Cauchy 双项近似（见 spectrum.ts），
 *    由 n_d 与阿贝数 V_d 确定。复色光被拆成若干单色光分别追踪，
 *    最后在同一张线性缓冲里做加性叠加 → 自然出现色散彩虹。
 *
 * 5) 介质判定：交点两侧的介质由「交点稍前侧位置是否在多边形内」决定，
 *    而非依赖携带状态，因此重叠、嵌套的元件也不会判错。
 */

import { buildGeometry, insideElement, intersectShape, previousSideProbe } from "./geometry.js";
import { add, dirFrom, dot, norm, perp, scale, sub } from "./math2d.js";
import { refractiveIndexAt, wavelengthToLinearRGB } from "./spectrum.js";

/* ------------------------------------------------------------------ 类型 */

 





 

 

























 









 





 

 












 








 









export const DEFAULT_TRACE_OPTIONS  = {
  maxDepth: 14,
  minPower: 2e-3,
  maxSegments: 260000,
  maxTraced: 2600000,
};

 




/* ------------------------------------------------------------ 菲涅耳系数 */

 







const clamp01 = (x )  => (x < 0 ? 0 : x > 1 ? 1 : x);

export function fresnel(cosI , n1 , n2 )  {
  const ci = clamp01(Math.abs(cosI));
  const eta = n1 / n2;
  const sin2T = eta * eta * (1 - ci * ci);
  if (sin2T >= 1) {
    return {
      reflectance: 1,
      transmittance: 0,
      cosI: ci,
      cosT: 0,
      totalInternalReflection: true,
    };
  }
  const ct = Math.sqrt(Math.max(0, 1 - sin2T));
  const rsNum = n1 * ci - n2 * ct;
  const rsDen = n1 * ci + n2 * ct;
  const rpNum = n1 * ct - n2 * ci;
  const rpDen = n1 * ct + n2 * ci;
  const rs = (rsNum * rsNum) / (rsDen * rsDen);
  const rp = (rpNum * rpNum) / (rpDen * rpDen);
  const R = clamp01(0.5 * (rs + rp));
  return {
    reflectance: R,
    transmittance: 1 - R,
    cosI: ci,
    cosT: ct,
    totalInternalReflection: false,
  };
}

/** 正入射时的菲涅耳反射率，用于测试与 UI 提示。 */
export function normalIncidenceReflectance(n1 , n2 )  {
  const r = (n1 - n2) / (n1 + n2);
  return r * r;
}

/** 折射方向；全反射时返回 null。 */
export function refractDirection(
  d ,
  n ,
  eta ,
  cosI ,
)  {
  const k = 1 - eta * eta * (1 - cosI * cosI);
  if (k < 0) return null;
  const cosT = Math.sqrt(k);
  return norm(add(scale(d, eta), scale(n, eta * cosI - cosT)));
}

/** 反射方向。 */
export function reflectDirection(d , n )  {
  return sub(d, scale(n, 2 * dot(n, d)));
}

/* -------------------------------------------------------------- 光谱展开 */

/** 把光源光谱展开为「波长 + 相对强度权重」列表，权重之和为 1。 */
export function expandSpectrum(s )  {
  if (s.kind === "discrete") {
    const lines = s.lines.filter((l) => l.weight > 0);
    if (lines.length === 0) return [{ lambda: 550, weight: 1 }];
    if (lines.length === 1) return [{ lambda: lines[0] .lambda, weight: 1 }];
    const total = lines.reduce((acc, l) => acc + l.weight, 0);
    return lines.map((l) => ({ lambda: l.lambda, weight: l.weight / total }));
  }

  if (s.samples <= 1) return [{ lambda: s.lambda, weight: 1 }];

  const out  = [];
  for (let i = 0; i < s.samples; i++) {
    const t = s.samples === 1 ? 0 : i / (s.samples - 1);
    out.push({
      lambda: s.lambdaMin + (s.lambdaMax - s.lambdaMin) * t,
      weight: 1 / s.samples,
    });
  }
  return out;
}

/* ---------------------------------------------------------------- 发射器 */

 




/**
 * 生成一个光源的全部初始光线。
 *  · collimated：光线沿轴平行，发射点沿光束宽度均匀分布（真正的“平行光束”）。
 *  · area：与 collimated 相同起点，但方向在发散角内展开（面光源）。
 *  · point：所有光线从轴的起点出发，方向在发散角内展开（点光源）。
 * beamCount > 1 时，沿光束宽度方向复制出多束，形成“多束光”。
 */
export function emitRays(src )  {
  const out  = [];
  const beams = Math.max(1, Math.round(src.beamCount));
  const perBeam = Math.max(1, Math.round(src.rayCount));
  const width = Math.max(0, src.beamWidth);
  const spread = (Math.max(0, src.spread) * Math.PI) / 180;
  const lateral = perp(dirFrom(src.angle)); // 垂直于光束轴的方向

  for (let b = 0; b < beams; b++) {
    // 多束光：把所有光束对称地铺在 beamWidth 内
    const center = beams === 1 ? 0 : (b / (beams - 1) - 0.5) * width * beams * 0.55;
    const base = add(src.pos, scale(lateral, center));

    for (let i = 0; i < perBeam; i++) {
      let angle = src.angle;
      let origin = base;

      if (src.mode === "point") {
        const t = perBeam === 1 ? 0 : (i / (perBeam - 1) - 0.5) * spread;
        angle = src.angle + t;
      } else if (src.mode === "collimated") {
        // 平行光：仅横向偏移发射点
        const off = perBeam === 1 ? 0 : (i / (perBeam - 1) - 0.5) * width;
        origin = add(base, scale(lateral, off));
      } else {
        // area：横向偏移 + 角度展开
        const off = perBeam === 1 ? 0 : (i / (perBeam - 1) - 0.5) * width;
        const t = perBeam === 1 ? 0 : (i / (perBeam - 1) - 0.5) * spread;
        origin = add(base, scale(lateral, off));
        angle = src.angle + t;
      }

      out.push({ origin, dir: dirFrom(angle) });
    }
  }
  return out;
}

/* -------------------------------------------------------------- 主追踪器 */

const MIN_STEP = 5e-4;

export function traceScene(
  sources ,
  elements ,
  worldBounds ,
  opts  = DEFAULT_TRACE_OPTIONS,
)  {
  const t0 = performance.now();

  // 预生成几何体，避免每条光线重复构造
  const shapes  = [];
  for (const el of elements) {
    if (!el.visible) continue;
    shapes.push({ el, geo: buildGeometry(el) });
  }

  // 世界边界作为「吸收壁」：线段裁剪到窗口内，光线打到窗口即终止。

  const segments  = [];
  const stats  = {
    rays: 0,
    segments: 0,
    traced: 0,
    capped: false,
    wavelengthCount: 0,
    ms: 0,
  };

  const maxSeg = opts.maxSegments;
  const maxTraced = opts.maxTraced;
  const maxSegmentsPerWavelength = Math.max(
    16,
    Math.floor(maxSeg / Math.max(1, countWavelengths(sources))),
  );
  // 待追踪分支栈：反射支不递归，而是压栈后由外层循环继续，
  // 这样任意深度下都只有 O(1) 的调用栈，安全且顺序稳定。
  const pending  = [];

  for (const src of sources) {
    if (!src.enabled) continue;
    const rays = emitRays(src);
    const lines = expandSpectrum(src.spectrum);

    // 复色多束时，逐束做微小波长偏移，让“多束光”呈现不同颜色
    const beams = Math.max(1, Math.round(src.beamCount));
    for (let bi = 0; bi < beams; bi++) {
      const tintShift =
        src.beamTint !== 0 && beams > 1 ? (bi / (beams - 1) - 0.5) * src.beamTint : 0;
      stats.wavelengthCount += lines.length * rays.length;

      for (const line of lines) {
        const lambda = Math.max(200, Math.min(1200, line.lambda + tintShift));
        const rgb = wavelengthToLinearRGB(lambda);
        const power = line.weight / rays.length;
        for (const ray of rays) {
          if (segments.length >= maxSegmentsPerWavelength) {
            stats.capped = true;
            break;
          }
          stats.rays++;
          pending.length = 0;
          traceRay(
            { o: ray.origin, d: ray.dir, p: power, lambda, rgb, depth: 0 },
            shapes,
            worldBounds,
            opts,
            stats,
            segments,
            maxTraced,
            maxSegmentsPerWavelength,
            pending,
          );
        }
      }
    }
  }

  stats.segments = segments.length;
  stats.ms = performance.now() - t0;
  return { segments, stats };
}

function countWavelengths(sources )  {
  let n = 0;
  for (const s of sources) n += expandSpectrum(s.spectrum).length;
  return n;
}

/** 待追踪分支：反射支不递归，而是压入这个显式栈。 */
 








 

/** 单条光线的完整生命周期，使用显式分支栈迭代，避免深递归。 */
function traceRay(
  start ,
  shapes ,
  box ,
  opts ,
  stats ,
  segments ,
  maxTraced ,
  maxSegments ,
  pending ,
)  {
  let cur  = start;

  while (cur) {
    let o = cur.o;
    let d = cur.d;
    let p = cur.p;
    let depth = cur.depth;
    const lambda = cur.lambda;
    const rgb = cur.rgb;
    let dead = false;

    while (!dead && depth < opts.maxDepth) {
      if (stats.traced >= maxTraced || segments.length >= maxSegments) {
        stats.capped = true;
        return;
      }

      // ---- 与所有元件求交，取最近者
      const near = findElementHit(o, d, shapes, stats);
      // ---- 与观察窗口求交，决定线段终点
      const tBox = rayBoxExit(o, d, box);
      const tEnd = near ? Math.min(near.hit.t, tBox) : tBox;
      if (!Number.isFinite(tEnd) || tEnd <= MIN_STEP) break;

      const end = add(o, scale(d, tEnd));
      stats.segments++;
      segments.push({
        ax: o.x,
        ay: o.y,
        bx: end.x,
        by: end.y,
        power: p,
        r: rgb.x,
        g: rgb.y,
        b: rgb.z,
      });

      // 先出界：光线结束
      if (!near || near.hit.t > tBox) break;

      // ---- 判定界面两侧的介质
      const media = mediumIndices(near.hit, near.geo, d, lambda);

      const nrm = near.hit.normal;
      const cosI = Math.min(1, Math.max(0, -dot(nrm, d)));
      if (cosI < 1e-6) break; // 掠射：数值不稳定，直接终止

      const fr = fresnel(cosI, media.n1, media.n2);
      const refracted = fr.totalInternalReflection
        ? null
        : refractDirection(d, nrm, media.eta, cosI);
      const reflected = reflectDirection(d, nrm);

      const pr = p * fr.reflectance;
      const pt = refracted ? p * fr.transmittance : 0;
      const takeTransmit = refracted !== null && pt >= pr;

      // 较弱的一支（且仍可观）压入栈，较强的一支继续迭代
      if (takeTransmit) {
        if (pr > opts.minPower) {
          pending.push({
            o: near.hit.point,
            d: reflected,
            p: pr,
            lambda,
            rgb,
            depth: depth + 1,
          });
        }
        o = near.hit.point;
        d = refracted ;
        p = pt;
      } else {
        if (pt > opts.minPower && refracted) {
          pending.push({
            o: near.hit.point,
            d: refracted,
            p: pt,
            lambda,
            rgb,
            depth: depth + 1,
          });
        }
        o = near.hit.point;
        d = reflected;
        p = pr;
      }

      depth++;
      if (p < opts.minPower) dead = true;
    }

    cur = pending.pop();
  }
}

/** 找到最近命中的元件；没有则返回 null。 */
function findElementHit(
  o ,
  d ,
  shapes ,
  stats ,
)  {
  let bestT = Infinity;
  let bestHit  = null;
  let bestGeo  = null;
  for (const s of shapes) {
    const hit = intersectShape(o, d, s.geo, s.el, MIN_STEP);
    stats.traced++;
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      bestHit = hit;
      bestGeo = s.geo;
    }
  }
  return bestHit && bestGeo ? { hit: bestHit, geo: bestGeo } : null;
}

/** 由「交点稍前侧是否在元件内」判定入射/出射，进而给出 n₁、n₂。 */
function mediumIndices(
  hit ,
  geo ,
  d ,
  lambda ,
)  {
  const exiting = insideElement(previousSideProbe(hit, d), geo);
  const nElement = refractiveIndexAt(hit.element.material.n, hit.element.material.abbe, lambda);
  const n1 = exiting ? nElement : 1;
  const n2 = exiting ? 1 : nElement;
  return { n1, n2, eta: n1 / n2, exiting };
}

/** 射线离开矩形窗口的参数 t（窗口外为 Infinity）。 */
function rayBoxExit(o , d , box )  {
  let tExit = Infinity;
  const oa = [o.x, o.y];
  const da = [d.x, d.y];
  const lo = [box.min.x, box.min.y];
  const hi = [box.max.x, box.max.y];
  for (let axis = 0; axis < 2; axis++) {
    const ox = oa[axis] ;
    const dx = da[axis] ;
    if (Math.abs(dx) < 1e-12) {
      if (ox < lo[axis] || ox > hi[axis]) return -1;
      continue;
    }
    const tFar = dx > 0 ? (hi[axis]  - ox) / dx : (lo[axis] - ox) / dx;
    if (tFar < tExit) tExit = tFar;
  }
  return tExit;
}

/* ------------------------------------------------------------ 便捷工具 */

/** 供 UI 显示：给定元件与波长，返回其折射率。 */
export function elementIndexAt(el , lambda )  {
  return refractiveIndexAt(el.material.n, el.material.abbe, lambda);
}
