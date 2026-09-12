/**
 * 渲染器。
 *
 * 光线的叠加严格在线性强度空间里完成：
 *   1. 所有线段以 `lighter`（加性混合）画进追踪缓冲，每个通道的颜色固定，
 *      亮度由该段携带的相对光强决定 —— 于是「多色光重叠处变白」是物理结果，
 *      不是调参调出来的；
 *   2. 缓冲按画布尺寸放大到显示层，并通过多层叠加 + 对比度压缩做色调映射，
 *      让亮部保持色彩而不是被硬截断；
 *   3. 最上层再画几何轮廓、元件标签、光源示意与拖拽手柄。
 *
 * 分辨率可调：追踪缓冲可以低于显示分辨率，拖动时自动降档以保证流畅。
 */

import { type OpticElement, buildGeometry, type ShapeGeometry } from "./core/geometry.ts";
import type { LightSource } from "./core/trace.ts";
import { dirFrom, perp, scale, add, type Vec2 } from "./core/math2d.ts";
import type { Segment, TraceStats } from "./core/trace.ts";
import type { Viewport } from "./view.ts";

export interface RenderSettings {
  /** 线性强度增益 */
  exposure: number;
  /** 对比度压缩指数（1 = 线性，>1 压暗中间调） */
  gamma: number;
  /** 光晕强度（0 = 关闭；1 ≈ 默认观感；可超过 1，面板不设上限） */
  bloom: number;
  /** 光线底部宽度（**屏幕空间** CSS 像素，与缩放无关） */
  lineWidth: number;
  /** 追踪缓冲相对显示分辨率的质量系数（见 QUALITY_MIN / QUALITY_MAX） */
  quality: number;
  showGrid: boolean;
  showOutline: boolean;
  showNormals: boolean;
  showLabels: boolean;
}

/**
 * 质量系数的硬边界。
 *
 * 这三个渲染参数里只有 quality 必须留边界：缓冲尺寸 = 画布尺寸 × quality，
 * 若不封顶，手输一个很大的数就会尝试分配巨量显存/内存而卡死页面。
 * 曝光、光晕、线宽没有这个问题，可以随便填。
 */
export const QUALITY_MIN = 0.1;
export const QUALITY_MAX = 2;

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  // 默认值 = 面板「光线与亮度」里最亮、最粗的那组设置：
  // 曝光拉满让每束光都亮起来，线宽 3 CSS 像素保证远看也清晰。
  // 想看细腻的单根光线时，把线宽往小调即可（透明度不会跟着掉，光依旧亮）。
  exposure: 4,
  gamma: 0.82,
  bloom: 1,
  lineWidth: 3,
  quality: 1,
  showGrid: true,
  showOutline: true,
  showNormals: false,
  showLabels: true,
};

/* 背景：偏亮的深蓝灰，保证光线依旧醒目，同时不是“一片黑” */
const BG_TOP = "#1b2740";
const BG_BOTTOM = "#121a2b";
const VIGNETTE = "rgba(0,0,0,0.28)";
const GRID_MAJOR = "rgba(150,190,235,0.20)";
const GRID_MINOR = "rgba(150,190,235,0.09)";
const AXIS = "rgba(170,210,245,0.30)";

interface Batch {
  r: number;
  g: number;
  b: number;
  q: number;
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Viewport;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly buf: HTMLCanvasElement;
  private readonly bufCtx: CanvasRenderingContext2D;
  private bufW = 0;
  private bufH = 0;
  /** 最近一次绘制中「最强线段终点」的屏幕坐标（CSS 像素），供测试验证相机跟随。 */
  lightSample: { x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement, view: Viewport) {
    this.canvas = canvas;
    this.view = view;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("无法获取 2D 绘图上下文");
    this.ctx = ctx;
    this.buf = document.createElement("canvas");
    const bctx = this.buf.getContext("2d", { alpha: false });
    if (!bctx) throw new Error("无法创建光线缓冲上下文");
    this.bufCtx = bctx;
  }

  /** 根据视口与质量系数准备缓冲尺寸。 */
  private ensureBuffer(quality: number): void {
    const w = Math.max(16, Math.round(this.view.width * quality));
    const h = Math.max(16, Math.round(this.view.height * quality));
    if (w !== this.bufW || h !== this.bufH) {
      this.bufW = w;
      this.bufH = h;
      this.buf.width = w;
      this.buf.height = h;
    }
  }

  draw(
    segments: readonly Segment[],
    elements: readonly OpticElement[],
    sources: readonly LightSource[],
    settings: RenderSettings,
    interaction: { hoveredId?: string; selectedId?: string; active: boolean },
  ): void {
    const quality = clampQuality(settings.quality);
    this.lastQuality = quality;
    this.ensureBuffer(quality);

    this.drawLight(segments, quality, settings);
    this.composite(settings);
    this.drawOverlay(elements, sources, settings, interaction);
  }

  /* ------------------------------------------------------------ 光线层 */

  private drawLight(segments: readonly Segment[], quality: number, s: RenderSettings): void {
    const ctx = this.bufCtx;
    const vp = this.view;
    // 缓冲坐标 = (世界坐标 − 视图中心) × 每单位像素 × 质量系数 + 缓冲中心。
    // 注意：这里必须带上 vp.center 与 vp.zoom —— 早期版本直接写 offX + ax * pxWorld，
    // 相当于把光线永远钉在画布中心的「世界原点」上，于是平移/缩放时元件动了、光线不动。
    const pxWorld = vp.pixelsPerUnit * quality;
    const centerX = vp.center.x;
    const centerY = vp.center.y;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, this.bufW, this.bufH);

    const offX = this.bufW / 2;
    const offY = this.bufH / 2;
    const gain = s.exposure;
    // 线宽定义在「屏幕空间」：lineWidth 是显示层的 CSS 像素宽度，
    // 与缩放/视野无关 —— 于是把视图放大去观察细节时，光线不会跟着变成粗色带。
    // 乘 dpr × quality 是因为缓冲本身也是「设备像素 × 质量系数」，画完还要放大铺满画布。
    const lw = Math.max(0.75, s.lineWidth * vp.dpr * quality);

    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    let batch: Batch | null = null;
    let open = false;
    const flush = (): void => {
      if (open) {
        ctx.stroke();
        open = false;
      }
    };

    // 记录「屏幕空间」的最强线段端点，供测试验证光线确实跟随相机
    let strongest = -1;
    for (let i = 0; i < segments.length; i++) {
      const p = segments[i]!.power;
      if (p > strongest) strongest = p;
    }
    this.lightSample = null;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const q = Math.round(Math.min(1, seg.power * gain) * 600) / 600;
      if (!batch || batch.r !== seg.r || batch.g !== seg.g || batch.b !== seg.b || batch.q !== q) {
        flush();
        ctx.beginPath();
        // 强度转透明度：上限抬到 0.88、并配合更低的 gamma，
        // 让原本几乎看不见的弱光段也获得足够的亮度（视觉上“每根都亮”）。
        const alpha = Math.min(1, 0.88 * Math.pow(q, s.gamma));
        ctx.strokeStyle = `rgba(${Math.round(seg.r * 255)},${Math.round(seg.g * 255)},${Math.round(
          seg.b * 255,
        )},${alpha.toFixed(4)})`;
        // 宽度只温和地随强度变化（0.62~1.0 倍），弱光靠透明度区分而不是靠变粗。
        ctx.lineWidth = Math.max(0.45, lw * (0.62 + 0.38 * Math.sqrt(Math.max(q, 1e-6))));
        batch = { r: seg.r, g: seg.g, b: seg.b, q };
        open = true;
      }
      if (open) {
        const x1 = offX + (seg.ax - centerX) * pxWorld;
        const y1 = offY + (seg.ay - centerY) * pxWorld;
        const x2 = offX + (seg.bx - centerX) * pxWorld;
        const y2 = offY + (seg.by - centerY) * pxWorld;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        if (seg.power === strongest) {
          // 转回 CSS 像素（供测试使用）
          this.lightSample = { x: x2 / quality, y: y2 / quality };
        }
      }
    }
    flush();
    ctx.globalCompositeOperation = "source-over";
  }

  /* --------------------------------------------------------- 色调映射层 */

  private composite(s: RenderSettings): void {
    const ctx = this.ctx;
    const vp = this.view;
    const w = vp.width;
    const h = vp.height;

    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // 底色
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, BG_TOP);
    grad.addColorStop(1, BG_BOTTOM);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 光线本体
    ctx.drawImage(this.buf, 0, 0, this.bufW, this.bufH, 0, 0, w, h);

    // 光晕：同一缓冲以低透明度 + 大模糊叠加。
    // 半径比之前更小：细线需要的是“发亮”，而不是糊成一片粗光带。
    if (s.bloom > 0.01) {
      const blur = Math.max(3, vp.pixelsPerUnit * 0.28);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.24 * s.bloom;
      ctx.filter = `blur(${blur.toFixed(1)}px)`;
      ctx.drawImage(this.buf, 0, 0, this.bufW, this.bufH, 0, 0, w, h);
      ctx.globalAlpha = 0.18 * s.bloom;
      ctx.filter = `blur(${(blur * 2.6).toFixed(1)}px)`;
      ctx.drawImage(this.buf, 0, 0, this.bufW, this.bufH, 0, 0, w, h);
      ctx.restore();
      ctx.filter = "none";
    }

    // 高光提亮：亮部再叠一层，让重叠光束显得更“实”
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.24;
    ctx.filter = "contrast(180%) brightness(70%)";
    ctx.drawImage(this.buf, 0, 0, this.bufW, this.bufH, 0, 0, w, h);
    ctx.restore();
    ctx.filter = "none";

    // 暗角（比之前更淡，避免整体发黑）
    const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.85);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, VIGNETTE);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  /* ---------------------------------------------------------- 叠加图层 */

  private drawOverlay(
    elements: readonly OpticElement[],
    sources: readonly LightSource[],
    s: RenderSettings,
    interaction: { hoveredId?: string; selectedId?: string; active: boolean },
  ): void {
    const ctx = this.ctx;
    const vp = this.view;

    ctx.save();
    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.lineJoin = "round";

    if (s.showGrid) this.drawGrid();
    for (const el of elements) {
      if (!el.visible) continue;
      const geo = buildGeometry(el);
      const selected = interaction.selectedId === el.id;
      const hovered = interaction.hoveredId === el.id;

      // 玻璃质感：极淡填充 + 轮廓
      ctx.beginPath();
      tracePolygon(ctx, geo, vp);
      ctx.closePath();
      ctx.fillStyle = selected ? "rgba(125,211,252,0.10)" : "rgba(148,197,255,0.055)";
      ctx.fill();

      ctx.lineWidth = selected ? 2 : hovered ? 1.75 : 1.2;
      ctx.strokeStyle = selected
        ? "rgba(125,211,252,0.95)"
        : hovered
          ? "rgba(186,230,253,0.8)"
          : "rgba(170,205,255,0.52)";
      if (s.showOutline || selected || hovered) {
        if (selected) {
          ctx.shadowColor = "rgba(56,189,248,0.65)";
          ctx.shadowBlur = 12;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      if (s.showNormals) this.drawNormals(geo);
      if (selected) this.drawHandles(el, geo);
      if (s.showLabels) this.drawElementLabel(el, geo, selected);
    }

    for (const src of sources) {
      if (!src.enabled) continue;
      this.drawSource(src, interaction.selectedId === src.id);
    }

    ctx.restore();
  }

  private drawGrid(): void {
    const ctx = this.ctx;
    const vp = this.view;
    const { min, max } = vp.bounds;
    // 网格间距随缩放自适应，避免放大后密成一片、缩小后完全消失
    const step = niceStep(90 / vp.pixelsPerUnit);
    ctx.lineWidth = 1;

    const firstX = Math.ceil(min.x / step) * step;
    for (let x = firstX; x <= max.x; x += step) {
      const major = Math.abs(x / (step * 5) - Math.round(x / (step * 5))) < 1e-6;
      ctx.strokeStyle = major ? GRID_MAJOR : GRID_MINOR;
      const p = vp.toScreen({ x, y: 0 });
      const sx = Math.round(p.x) + 0.5;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, vp.height);
      ctx.stroke();
    }
    const firstY = Math.ceil(min.y / step) * step;
    for (let y = firstY; y <= max.y; y += step) {
      const major = Math.abs(y / (step * 5) - Math.round(y / (step * 5))) < 1e-6;
      ctx.strokeStyle = major ? GRID_MAJOR : GRID_MINOR;
      const p = vp.toScreen({ x: 0, y });
      const sy = Math.round(p.y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(vp.width, sy);
      ctx.stroke();
    }

    // 光轴：随缩放变淡，但始终可见
    ctx.strokeStyle = AXIS;
    ctx.setLineDash([7, 7]);
    const axis = vp.toScreen({ x: 0, y: 0 });
    if (axis.y > -50 && axis.y < vp.height + 50) {
      ctx.beginPath();
      ctx.moveTo(0, axis.y);
      ctx.lineTo(vp.width, axis.y);
      ctx.stroke();
    }
    if (axis.x > -50 && axis.x < vp.width + 50) {
      ctx.beginPath();
      ctx.moveTo(axis.x, 0);
      ctx.lineTo(axis.x, vp.height);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawNormals(geo: ShapeGeometry): void {
    const ctx = this.ctx;
    const vp = this.view;
    ctx.strokeStyle = "rgba(253,224,71,0.5)";
    ctx.lineWidth = 1;
    const n = geo.outline.length;
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 14))) {
      const a = geo.outline[i]!;
      const b = geo.outline[(i + 1) % n]!;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const e = { x: b.x - a.x, y: b.y - a.y };
      const len = Math.hypot(e.x, e.y) || 1;
      const outward = perp({ x: e.x / len, y: e.y / len });
      const p1 = vp.toScreen(mid);
      const p2 = vp.toScreen({ x: mid.x + outward.x * 0.5, y: mid.y + outward.y * 0.5 });
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  }

  private drawHandles(el: OpticElement, geo: ShapeGeometry): void {
    const ctx = this.ctx;
    const vp = this.view;
    ctx.fillStyle = "rgba(125,211,252,0.9)";
    ctx.strokeStyle = "rgba(8,20,35,0.9)";
    ctx.lineWidth = 1.5;
    for (const h of el.kind === "polygon" ? geo.outline : [el.pos]) {
      const p = vp.toScreen(h);
      ctx.beginPath();
      ctx.arc(p.x, p.y, el.kind === "polygon" ? 4.5 : 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (el.kind !== "polygon") {
      // 显示旋转方向
      const dir = dirFrom(el.rot);
      const from = vp.toScreen(el.pos);
      const to = vp.toScreen(add(el.pos, scale(dir, 1.1)));
      ctx.strokeStyle = "rgba(125,211,252,0.75)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
  }

  private drawElementLabel(el: OpticElement, geo: ShapeGeometry, selected: boolean): void {
    const ctx = this.ctx;
    const vp = this.view;
    const p = vp.toScreen(el.pos);
    const text = `${el.label} · n=${el.material.n.toFixed(3)} · V=${el.material.abbe.toFixed(0)}`;
    ctx.font = "500 12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width + 14;
    const bx = p.x - w / 2;
    const by = p.y - vp.px(geo.aabb.max.y - el.pos.y) - 26;
    ctx.fillStyle = selected ? "rgba(12,30,48,0.9)" : "rgba(9,18,30,0.7)";
    ctx.strokeStyle = selected ? "rgba(125,211,252,0.7)" : "rgba(140,175,215,0.25)";
    ctx.lineWidth = 1;
    roundRect(ctx, bx, by, w, 20, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = selected ? "#dbeafe" : "#a9c4e2";
    ctx.fillText(text, p.x, by + 10.5);
  }

  private drawSource(src: LightSource, selected: boolean): void {
    const ctx = this.ctx;
    const vp = this.view;
    const base = vp.toScreen(src.pos);
    const dir = dirFrom(src.angle);
    const lateral = perp(dir);
    const spread = (src.spread * Math.PI) / 180;
    const beams = Math.max(1, Math.round(src.beamCount));
    /** 标记尺寸倍率：只影响观感与命中范围（不参与物理） */
    const sc = src.size && src.size > 0 ? src.size : 1;

    // 光束示意扇形
    const reach = 1.6;
    if (src.beamWidth > 0.01 || spread > 0.01) {
      ctx.beginPath();
      const half = src.beamWidth / 2;
      const w2 = beams > 1 ? (src.beamWidth * beams * 0.55) / 2 + half : half;
      if (src.mode === "point" || spread > 0.01) {
        const a0 = vp.toScreen(src.pos);
        ctx.moveTo(a0.x, a0.y);
        const p1 = vp.toScreen(
          add(src.pos, scale(dirFrom(src.angle - spread / 2), reach + Math.max(0.5, w2))),
        );
        const p2 = vp.toScreen(
          add(src.pos, scale(dirFrom(src.angle + spread / 2), reach + Math.max(0.5, w2))),
        );
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
      } else {
        const c0 = add(src.pos, scale(lateral, -w2));
        const c1 = add(src.pos, scale(lateral, w2));
        const f0 = add(c0, scale(dir, reach));
        const f1 = add(c1, scale(dir, reach));
        const s0 = vp.toScreen(c0);
        const s1 = vp.toScreen(c1);
        const s2 = vp.toScreen(f1);
        const s3 = vp.toScreen(f0);
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.lineTo(s3.x, s3.y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(253,230,138,0.07)";
      ctx.fill();
      ctx.strokeStyle = "rgba(253,230,138,0.28)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 方向箭头（长度与箭头大小随 size 缩放）
    const tip = vp.toScreen(add(src.pos, scale(dir, 1.25 * sc)));
    ctx.strokeStyle = "rgba(253,230,138,0.85)";
    ctx.lineWidth = Math.max(1.4, 1.8 * sc);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    const ah = 8 * sc;
    const ang = Math.atan2(tip.y - base.y, tip.x - base.x);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - ah * Math.cos(ang - 0.4), tip.y - ah * Math.sin(ang - 0.4));
    ctx.lineTo(tip.x - ah * Math.cos(ang + 0.4), tip.y - ah * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fillStyle = "rgba(253,230,138,0.9)";
    ctx.fill();

    // 发光点（可选中时略微外扩，便于发现）
    const r = (selected ? 7 : 5.5) * sc;
    ctx.beginPath();
    ctx.arc(base.x, base.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#ffe08a";
    ctx.shadowColor = "rgba(253,230,138,0.9)";
    ctx.shadowBlur = (selected ? 18 : 10) * sc;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(20,25,15,0.85)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // 选中时加一圈虚线光环，明确「已选中」
    if (selected) {
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.arc(base.x, base.y, r + 7 * sc, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,224,138,0.75)";
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** 导出当前画面为 PNG。 */
  toDataURL(): string {
    return this.canvas.toDataURL("image/png");
  }

  /** 便于外部统计：当前缓冲尺寸。 */
  get bufferSize(): { w: number; h: number } {
    return { w: this.bufW, h: this.bufH };
  }

  /** 测试用：把某个世界坐标按当前相机换算成屏幕坐标（与光线绘制走同一套公式）。 */
  worldToLightScreen(p: { x: number; y: number }): { x: number; y: number } {
    const quality = clampQuality(this.lastQuality);
    return {
      x: this.bufW / 2 + (p.x - this.view.center.x) * this.view.pixelsPerUnit * quality,
      y: this.bufH / 2 + (p.y - this.view.center.y) * this.view.pixelsPerUnit * quality,
    };
  }

  private lastQuality = 1;
}

/** 把质量系数收进硬边界（手输的任意值也要过一个安全阀）。 */
export function clampQuality(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, value));
}

/** 把任意间距取整成「好看的刻度」：1 / 2 / 5 × 10ⁿ。 */
function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(Math.max(1e-6, raw)));
  const base = Math.pow(10, exp);
  const norm = raw / base;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return mult * base;
}

function tracePolygon(
  ctx: CanvasRenderingContext2D,
  geo: ShapeGeometry,
  vp: Viewport,
): void {  const pts = geo.outline;
  for (let i = 0; i < pts.length; i++) {
    const p = vp.toScreen(pts[i]!);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export type { TraceStats };
