/** 二维向量与基础数学工具。全部为纯函数，便于物理内核单独测试。 */

export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

/** 二维“叉积”：返回标量 z 分量（a × b）。 */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

/** 逆时针旋转 90°，用于把有向边转换为法线。 */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

/** 由角度（弧度）生成单位方向向量。 */
export const dirFrom = (angle: number): Vec2 => ({ x: Math.cos(angle), y: Math.sin(angle) });
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);

/** 多边形有向面积（正值为逆时针）。 */
export function signedArea(pts: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** 保证顶点顺序为逆时针，使“边方向的左手法线”恒指向外部。 */
export function ensureCCW(pts: Vec2[]): Vec2[] {
  return signedArea(pts) < 0 ? pts.slice().reverse() : pts;
}

/** 点是否在多边形内部（射线交叉法，边界情况不保证稳定）。 */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y) {
      const t = (p.y - a.y) / (b.y - a.y);
      if (p.x < a.x + t * (b.x - a.x)) inside = !inside;
    }
  }
  return inside;
}

export interface Aabb {
  min: Vec2;
  max: Vec2;
}

export function bounds(pts: readonly Vec2[]): Aabb {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: v(minX, minY), max: v(maxX, maxY) };
}

/** 绕 origin 旋转后平移，得到世界坐标点（就地返回新数组）。 */
export function transformPoints(
  pts: readonly Vec2[],
  pos: Vec2,
  rot: number,
): Vec2[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return pts.map((p) => ({
    x: pos.x + p.x * c - p.y * s,
    y: pos.y + p.x * s + p.y * c,
  }));
}
