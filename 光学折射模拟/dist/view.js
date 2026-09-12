/**
 * 视口：世界坐标 ⇄ 屏幕坐标，并负责画布自带的平移 / 缩放。
 *
 * 世界坐标取「屏幕中心为原点、y 向下为正」，与 canvas 一致（也符合几何光学的
 * 习惯：光轴水平向右）。
 *
 * 变换关系：
 *   屏幕 = (世界 − center) · ppu · zoom + 画布中心
 *   世界 = (屏幕 − 画布中心) / (ppu · zoom) + center
 * 其中 ppu 是「基准每单位像素数」（由画布高度决定，保证纵向固定显示 worldHeight 个单位），
 * zoom 是用户缩放倍率，center 是视图中心对应的世界坐标（拖动改变它）。
 */

 

 






export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 12;

export class Viewport {
  /** CSS 像素下的画布尺寸。 */
  width = 1;
  height = 1;
  /** devicePixelRatio，用于渲染到高分辨率缓冲。 */
  dpr = 1;
  /** 世界高度固定为 9（默认缩放下 y ∈ [−4.5, 4.5]）。 */
   baseWorldHeight = 9;

  /** 视图中心（世界坐标）。 */
  center  = { x: 0, y: 0 };
  /** 用户缩放倍率。 */
  zoom = 1;

   baseScale = 1;
   offX = 0;
   offY = 0;

  /** 按新的画布尺寸更新（CSS 像素）。 */
  resize(width , height , dpr )  {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    this.baseScale = this.height / this.baseWorldHeight;
    this.offX = this.width / 2;
    this.offY = this.height / 2;
  }

  /** 每世界单位对应多少 CSS 像素（含缩放）。 */
  get pixelsPerUnit()  {
    return this.baseScale * this.zoom;
  }

  /** 当前可见的世界范围。 */
  get bounds()  {
    const halfW = this.width / 2 / this.pixelsPerUnit;
    const halfH = this.height / 2 / this.pixelsPerUnit;
    return {
      min: { x: this.center.x - halfW, y: this.center.y - halfH },
      max: { x: this.center.x + halfW, y: this.center.y + halfH },
    };
  }

  /** 当前可见的世界宽度（供状态显示）。 */
  get worldWidth()  {
    return this.width / this.pixelsPerUnit;
  }

  /** 当前可见的世界高度。 */
  get worldHeight()  {
    return this.height / this.pixelsPerUnit;
  }

  toScreen(p )  {
    const s = this.pixelsPerUnit;
    return {
      x: this.offX + (p.x - this.center.x) * s,
      y: this.offY + (p.y - this.center.y) * s,
    };
  }

  /**
   * 屏幕坐标 → 世界坐标。
   * 用箭头函数属性而不是普通方法，这样即使被解构出来单独调用也保持 this 绑定。
   */
  toWorld = (p )  => {
    const s = this.pixelsPerUnit;
    return {
      x: (p.x - this.offX) / s + this.center.x,
      y: (p.y - this.offY) / s + this.center.y,
    };
  };

  /** 世界长度 → 像素长度。 */
  px(worldLength )  {
    return worldLength * this.pixelsPerUnit;
  }

  /** 平移：按屏幕像素位移移动视图。 */
  panBy(dxScreen , dyScreen )  {
    const s = this.pixelsPerUnit;
    this.center = { x: this.center.x - dxScreen / s, y: this.center.y - dyScreen / s };
  }

  /**
   * 以某个屏幕点为锚点缩放（该点对应的世界坐标保持不动），返回是否真的变了。
   * 这是滚轮缩放的正确做法：光标下的内容不会“跑掉”。
   */
  zoomAt(anchorScreen , factor )  {
    const before = this.toWorld(anchorScreen);
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * factor));
    if (next === this.zoom) return false;
    this.zoom = next;
    const after = this.toWorld(anchorScreen);
    this.center = {
      x: this.center.x + (before.x - after.x),
      y: this.center.y + (before.y - after.y),
    };
    return true;
  }

  /** 复位到默认视图（中心为原点、缩放为 1）。 */
  reset()  {
    this.center = { x: 0, y: 0 };
    this.zoom = 1;
  }

  get state()  {
    return { center: { ...this.center }, zoom: this.zoom };
  }

  setState(state )  {
    this.center = { ...state.center };
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, state.zoom));
  }

  /** 让整个场景刚好落在视野里（用于「适应窗口」）。 */
  fitBounds(bounds , padding = 1.4)  {
    const w = Math.max(0.5, bounds.max.x - bounds.min.x);
    const h = Math.max(0.5, bounds.max.y - bounds.min.y);
    const zoomX = this.width / ((w + padding) * this.baseScale);
    const zoomY = this.height / ((h + padding) * this.baseScale);
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(zoomX, zoomY)));
    this.center = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 };
  }
}
