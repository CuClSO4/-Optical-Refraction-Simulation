/**
 * 光学几何内核：形状轮廓生成 + 光线求交。
 *
 * 约定
 *  · 所有轮廓先在局部坐标生成，再经「绕原点旋转 → 平移」进入世界坐标。
 *  · 弧面用「弦高（sagitta）」参数化：给定半高 h 与弦高 s，
 *    曲率半径 R = (h² + s²) / (2s)，圆弧取「相对弦的凹陷量恰为 s」的那一段：
 *        x(θ) = ±(s − R(1 − cos θ)),  y(θ) = R·sin θ,  θ ∈ [−θmax, +θmax]
 *    端点恒为 (0, ±h)，弧顶为 (±s, 0)，因此多个表面可以严丝合缝拼接。
 *  · 顶点数组统一为逆时针（CCW），于是「边方向的左法线」恒指向外部。
 *  · 每条边在世界坐标下都是一段直线，因此几何体在物理上是精确的多面体，
 *    圆弧只通过采样密度引入离散化误差（48 段时弦高误差 < 0.1%）。
 */

import { add, bounds, cross, dot, ensureCCW, norm, perp, pointInPolygon, scale, sub, transformPoints, v } from "./math2d.js";

/* ------------------------------------------------------------------ 类型 */

 










 






 









 











 





 







 




 





 




/** 生成后的几何体：闭合多边形轮廓（世界坐标，CCW）。 */
 






/* ------------------------------------------------------- 圆弧面辅助函数 */

 





/** 由半高与弦高得到圆弧参数；弦高过小视为平直面。 */
function arcSpec(h , sag )  {
  const s = Math.abs(sag);
  if (s < 1e-4) return { R: Infinity, tMax: 0, flat: true };
  const R = (h * h + s * s) / (2 * s);
  const ratio = Math.min(1, h / R);
  return { R, tMax: Math.asin(ratio), flat: false };
}

/**
 * 生成一段圆弧上的采样点，端点恒为 (0, ±h)，弧顶在 (±s, 0)。
 *
 * 统一参数化（凸弧与凹弧共用同一支圆弧取样）：
 *   x(θ) = σ·(s − R(1 − cos θ))
 *   y(θ) = R·sin θ,   θ ∈ [−θmax, +θmax],  θmax = asin(h/R),  R = (h²+s²)/(2s)
 *
 * 代入可验：
 *   θ = 0      → (σ·s, 0)   弧顶
 *   θ = ±θmax  → (0, ±h)    两端严格落在弦上
 * 这正是「弦高为 s」的圆弧：s = R − √(R² − h²)。
 *
 * σ = +1：凸向 +x（中间最厚）；σ = −1：凹向 −x（中间最薄）。
 */
function arcPoints(h , sag , sigma , steps )  {
  const spec = arcSpec(h, sag);
  if (spec.flat) return [v(0, -h), v(0, h)];
  const { R, tMax } = spec;
  const s = Math.abs(sag);
  const pts  = [];
  for (let i = 0; i <= steps; i++) {
    const th = -tMax + (2 * tMax * i) / steps;
    pts.push(v(sigma * (s - R * (1 - Math.cos(th))), R * Math.sin(th)));
  }
  return pts;
}

/** 弦高对应的弧顶凹陷量（正值）：s = R − √(R² − h²)。 */
function sagOf(h , sag )  {
  const spec = arcSpec(h, sag);
  if (spec.flat) return 0;
  return spec.R - Math.sqrt(Math.max(0, spec.R * spec.R - h * h));
}

/**
 * 把用户给的「中心厚度 / 弦高」整理成自洽参数，
 * 保证轮廓不会自交（例如双凸时两弧顶之和不得大于中心厚度）。
 */
function resolveLens(el ) 




 {
  const h = Math.max(0.05, el.height);
  let sF = Math.max(0, Math.min(h, Math.abs(el.sagFront)));
  let sB = Math.max(0, Math.min(h, Math.abs(el.sagBack)));
  const tc = Math.max(0.01, el.centerThickness);

  switch (el.kind) {
    case "biconvex":
      // 两弧顶之和不能超过中心厚度，否则轮廓自交
      if (sF + sB > tc * 0.98) {
        const k = (tc * 0.98) / (sF + sB || 1);
        sF *= k;
        sB *= k;
      }
      break;
    case "planoconvex":
      if (sF > tc * 0.98) sF = tc * 0.98;
      sB = 0;
      break;
    case "biconcave":
      // 中心最薄处即 tc，边缘自然变厚，无自交风险
      break;
    case "meniscus":
      // 两表面同向弯曲，后表面弦高不得超过前表面，否则中心会变薄为负
      if (sB > sF) sB = sF * 0.98;
      break;
  }
  return { h, tc, sF, sB };
}

/* ------------------------------------------------------------ 轮廓生成 */

/** 双凸透镜：前弧凸向 +x、后弧凸向 −x，中心厚度 tc。 */
function biconvexOutline(el )  {
  const { h, tc, sF, sB } = resolveLens(el);
  const front = arcPoints(h, sF, 1, 48); // (0,−h) → (0,+h)
  const back = arcPoints(h, sB, -1, 48).map((p) => v(p.x - tc, p.y));
  return ensureCCW(front.concat(back.slice().reverse()));
}

/** 平凸透镜：前弧 + 后平面。平面位置由弦高 s 与中心厚度 tc 共同确定。 */
function planoconvexOutline(el )  {
  const { h, tc, sF } = resolveLens(el);
  const front = arcPoints(h, sF, 1, 56); // 从下到上，弧顶 (sF, 0)
  const flatX = -(sagOf(h, sF) + tc);
  const back = [v(flatX, h), v(flatX, -h)];
  return ensureCCW(front.concat(back));
}

/** 双凹透镜：两弧都凹向内侧，中心最薄处厚度为 tc。 */
function biconcaveOutline(el )  {
  const { h, tc, sF, sB } = resolveLens(el);
  // 边缘比通光半径更高，使中心厚度恰为 tc
  const edgeH = h + tc / 2;
  const k = edgeH / h;
  const front = arcPoints(h, sF, 1, 48).map((p) => v(p.x, p.y * k)); // 弧顶 (+sF·k, 0)
  const back = arcPoints(h, sB, -1, 48).map((p) => v(p.x, p.y * k)); // 弧顶 (−sB·k, 0)
  const frontApex = sagOf(h, sF) * k;
  const backApex = sagOf(h, sB) * k;
  // 让后弧顶落到 x = frontApex − tc
  const shift = frontApex - tc + backApex;
  const backShifted = back.map((p) => v(p.x + shift, p.y));
  return ensureCCW(front.concat(backShifted.reverse()));
}

/**
 * 弯月（凸凹）透镜：前表面外凸、后表面内凹，两表面在边缘处重合于 (0, ±h)，
 * 因此边缘厚度为 tc，中心厚度为 tc + sB − sF。
 */
function meniscusOutline(el )  {
  const { h, tc, sF, sB } = resolveLens(el);
  const front = arcPoints(h, sF, 1, 48); // 弧顶 (+sF, 0)
  const back = arcPoints(h, sB, -1, 48); // 弧顶 (−sB, 0)
  const backShifted = back.map((p) => v(p.x - tc, p.y));
  return ensureCCW(front.concat(backShifted.reverse()));
}

/** 由顶角与腰长构造等腰三棱镜（顶角朝 +y），随后以质心居中。 */
function prismOutline(apexDeg , size )  {
  const apex = (Math.min(170, Math.max(5, apexDeg)) * Math.PI) / 180;
  const half = apex / 2;
  const s = Math.max(0.2, size);
  const a = v(0, 0);
  const b = v(s * Math.sin(half), s * Math.cos(half));
  const c = v(-s * Math.sin(half), s * Math.cos(half));
  const cx = (a.x + b.x + c.x) / 3;
  const cy = (a.y + b.y + c.y) / 3;
  return ensureCCW([sub(a, v(cx, cy)), sub(b, v(cx, cy)), sub(c, v(cx, cy))]);
}

/** 矩形轮廓。 */
function rectOutline(halfWidth , halfHeight )  {
  const hw = Math.max(0.05, halfWidth);
  const hh = Math.max(0.05, halfHeight);
  return ensureCCW([v(-hw, -hh), v(hw, -hh), v(hw, hh), v(-hw, hh)]);
}

/** 默认自定义多边形（正五边形，CCW）。 */
export function defaultPolygonPoints(halfSize = 1.3)  {
  const pts  = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    pts.push(v(Math.cos(a) * halfSize, Math.sin(a) * halfSize));
  }
  return ensureCCW(pts);
}

/* ------------------------------------------------------------ 公共入口 */

/** 生成任意光学元件的世界坐标几何。 */
export function buildGeometry(el )  {
  let local ;

  switch (el.kind) {
    case "biconvex":
      local = biconvexOutline(el);
      break;
    case "planoconvex":
      local = planoconvexOutline(el);
      break;
    case "biconcave":
      local = biconcaveOutline(el);
      break;
    case "meniscus":
      local = meniscusOutline(el);
      break;
    case "plate":
      local = rectOutline(el.halfWidth, el.halfHeight);
      break;
    case "prism":
      local = prismOutline(el.apexAngle, el.size);
      break;
    case "triangle":
      local = prismOutline(60, 2.6);
      break;
    case "rect":
      local = rectOutline(1.7, 1.1);
      break;
    case "polygon":
      local = ensureCCW(el.points.map((p) => v(p.x, p.y)));
      break;
  }

  const outline = transformPoints(local, el.pos, el.rot);
  let areaTwice = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] ;
    const b = outline[(i + 1) % outline.length] ;
    areaTwice += a.x * b.y - b.x * a.y;
  }
  return {
    outline,
    aabb: bounds(outline),
    area: Math.abs(areaTwice) / 2,
  };
}

/* -------------------------------------------------------------- 光线求交 */

 








/**
 * 射线与单个几何体求交，返回最近的正向交点。
 * 先用包围盒做 slab 粗筛，再逐边解「射线 × 线段」的交点。
 * 注意：这里的 minT 同时用作「起点保护」，避免光线刚离开界面就立刻重新命中它。
 */
export function intersectShape(
  origin ,
  dir ,
  geo ,
  el ,
  minT = 1e-6,
)  {
  const floor = Math.max(minT, 0);

  // ---- 包围盒 slab 粗筛：把 [t0, t1] 与射线的可见区间求交
  let t0 = floor;
  let t1 = Infinity;
  const { min, max } = geo.aabb;
  const oAxis = [origin.x, origin.y];
  const dAxis = [dir.x, dir.y];
  const loAxis = [min.x, min.y];
  const hiAxis = [max.x, max.y];

  for (let axis = 0; axis < 2; axis++) {
    const o = oAxis[axis] ;
    const d = dAxis[axis] ;
    if (Math.abs(d) < 1e-12) {
      // 与该轴平行：只要起点落在板的范围内就继续，否则必然不相交
      if (o < loAxis[axis] || o > hiAxis[axis]) return null;
      continue;
    }
    let ta = (loAxis[axis] - o) / d;
    let tb = (hiAxis[axis] - o) / d;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }

  // ---- 逐边求交（解 origin + t·dir = a + u·e）
  const poly = geo.outline;
  let best  = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] ;
    const b = poly[(i + 1) % poly.length] ;
    const e = sub(b, a);
    const denom = cross(dir, e);
    if (Math.abs(denom) < 1e-12) continue; // 与边平行
    const ao = sub(a, origin);
    const t = cross(ao, e) / denom;
    const u = cross(ao, dir) / denom;
    if (t <= floor || u < 0 || u > 1) continue;
    if (!best || t < best.t) {
      let n = norm(perp(e));
      if (dot(n, dir) > 0) n = scale(n, -1); // 翻到迎光侧
      best = { t, point: add(origin, scale(dir, t)), normal: n, element: el, edgeIndex: i };
    }
  }
  return best;
}

/** 点是否位于元件内部（用于判定光线「进入」还是「离开」介质）。 */
export function insideElement(p , geo )  {
  return pointInPolygon(p, geo.outline);
}

/** 沿光线反方向退极小距离取探针点，避免恰好落在边界上。 */
export function previousSideProbe(hit , dir )  {
  return add(hit.point, scale(dir, -1e-5));
}
