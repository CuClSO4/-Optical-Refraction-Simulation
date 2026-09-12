/**
 * 应用主程序：状态管理、交互（拖拽/旋转/缩放）、追踪调度与渲染循环。
 */

import { buildGeometry, defaultPolygonPoints } from "./core/geometry.js";
import { DEFAULT_TRACE_OPTIONS, traceScene } from "./core/trace.js";
import { add, angleOf, clamp, dirFrom, dist, norm, scale, sub, v } from "./core/math2d.js";
import { DEFAULT_RENDER_SETTINGS, Renderer } from "./render.js";
import { SCENE_PRESETS, cloneScene, defaultScene, makeElement, makeSource } from "./scene.js";
import { Panel } from "./ui.js";
import { Library } from "./library-ui.js";
import { templateIsSource, templateMaterial } from "./library.js";
import { Viewport } from "./view.js";

 








 
















export class App {
   view = new Viewport();
    
     
     
     
    past  = [];
    future  = [];

   segments  = [];
  /** 当前追踪所用世界范围（与相机解耦，见 computeTraceBounds）。 */
   traceBounds  = null;
   stats  = {
    rays: 0,
    segments: 0,
    traced: 0,
    capped: false,
    wavelengthCount: 0,
    ms: 0,
  };
   dirty = true;
   needsTrace = true;
  /** 上一次测量到画布尺寸为 0（布局未就绪），需要在后续帧里重试。 */
   pendingResize = false;
  /** 尺寸重试次数（用于诊断）。 */
   sizeRetries = 0;
  /** 滚轮行为：缩放画布，还是缩放元件尺寸（可通过左侧「画布」分类切换）。 */
   wheelMode  = "zoom";
   dragging  = null;
   interactionActive = false;
   interactionTimer = 0;
    
    
   frameCount = 0;
   framesRendered = 0;
   lastFpsAt = performance.now();
   fps = 0;

     
     
     






  constructor(
    canvas ,
    panelHost ,
    statsHost 




,
    libraryHost  ,
  ) {
    // 注意：不能用 TS 的参数属性语法（constructor(private x)），
    // 因为浏览器/Node 的原生类型剥离只支持「可擦除」语法。
    this.canvas = canvas;
    this.panelHost = panelHost;
    this.statsHost = statsHost;

    const scene = defaultScene();
    this.state = {
      elements: scene.elements,
      sources: scene.sources,
      selectedElementId: scene.elements[0]?.id ?? null,
      selectedSourceId: scene.sources[0]?.id ?? null,
      render: { ...DEFAULT_RENDER_SETTINGS },
      trace: { ...DEFAULT_TRACE_OPTIONS },
    };

    this.renderer = new Renderer(canvas, this.view);
    this.panel = new Panel(panelHost, {
      state: this.state,
      invalidate: () => this.invalidate(),
      rebuild: () => this.panel.rebuild(),
      refresh: () => this.panel.refreshValues(),
      update: (mutate, options) => this.update(mutate, options),
      applyPreset: (preset) => this.applyPreset(preset),
      selectElement: (id) => this.selectElement(id),
      selectSource: (id) => this.selectSource(id),
      addElement: (kind) => this.addElement(kind),
      addSource: () => this.addSource(),
      duplicateSelected: () => this.duplicateSelected(),
      deleteSelected: () => this.deleteSelected(),
      focusSelection: () => this.focusSelection(),
      resetScene: () => this.applyPreset(SCENE_PRESETS[0] ),
      undo: () => this.undo(),
      redo: () => this.redo(),
      exportPng: () => this.exportPng(),
      viewReset: () => this.resetView(),
      viewFit: () => this.fitViewToScene(),
      viewZoom: (factor) => this.zoomView(factor),
    });
    this.library = new Library(libraryHost ?? document.createElement("div"), {
      pick: (tpl) => this.pickTemplate(tpl),
      redraw: () => this.library.rebuild(),
      viewReset: () => this.resetView(),
      viewFit: () => this.fitViewToScene(),
      viewZoom: (factor) => this.zoomView(factor),
      setWheelMode: (mode) => {
        this.wheelMode = mode;
        this.library.rebuild();
        this.canvas.style.cursor = mode === "element" ? "grab" : "move";
      },
      wheelMode: () => this.wheelMode,
    });

    this.attachEvents();
    this.panel.rebuild();
    this.library.rebuild();
    this.observeSize();
    requestAnimationFrame(this.frame);
  }

  /* ---------------------------------------------------- 元器件库 → 画布 */

  /**
   * 点击左侧元器件卡片：按当前视图中心放置（这样先平移画布再取用，
   * 元件就会出现在你正在看的位置），随后选中它，右侧弹出属性菜单。
   */
  pickTemplate(tpl )  {
    if (templateIsSource(tpl)) {
      this.addSourceFromTemplate(tpl);
      return;
    }
    const material = templateMaterial(tpl) ?? this.currentMaterial();
    const kind = tpl.kind  ;
    const at = this.nextPlacement();
    const el = makeElement(kind, at, material);
    el.label = tpl.name;
    if (tpl.overrides) {
      Object.assign(el, tpl.overrides);
    }
    if (kind === "polygon" && !tpl.materialKey) {
      // 默认多边形顶点保持 makeElement 的生成结果
    }
    this.update((s) => {
      s.elements.push(el);
      s.selectedElementId = el.id;
      s.selectedSourceId = null;
    });
    this.panel.rebuild();
    this.library.rebuild();
  }

  /** 从光源模板创建光源。 */
   addSourceFromTemplate(tpl )  {
    const cfg = tpl.source ?? {};
    const base = makeSource({
      label: tpl.name,
      pos: this.nextPlacement(),
      spectrum:
        cfg.preset === "white15"
          ? { kind: "continuous", samples: 15, lambdaMin: 390, lambdaMax: 730, lambda: 550 }
          : cfg.preset === "white7"
            ? { kind: "continuous", samples: 7, lambdaMin: 400, lambdaMax: 700, lambda: 550 }
            : cfg.preset === "mercury"
              ? {
                  kind: "discrete",
                  lines: [
                    { lambda: 404.7, weight: 0.5 },
                    { lambda: 435.8, weight: 0.8 },
                    { lambda: 546.1, weight: 1 },
                    { lambda: 577.0, weight: 0.7 },
                    { lambda: 579.1, weight: 0.7 },
                  ],
                }
              : {
                  kind: "continuous",
                  samples: 1,
                  lambdaMin: 380,
                  lambdaMax: 780,
                  lambda: cfg.lambda ?? 632.8,
                },
    });
    if (cfg.mode) base.mode = cfg.mode;
    if (typeof cfg.spread === "number") base.spread = cfg.spread;
    if (typeof cfg.beamCount === "number") base.beamCount = cfg.beamCount;
    if (typeof cfg.rayCount === "number") base.rayCount = cfg.rayCount;
    if (typeof cfg.beamWidth === "number") base.beamWidth = cfg.beamWidth;
    // 光源放在视图中心偏左一点，方便光向右传播
    base.pos = v(base.pos.x - this.view.worldWidth * 0.18, base.pos.y);

    this.update((s) => {
      s.sources.push(base);
      s.selectedSourceId = base.id;
      s.selectedElementId = null;
    });
    this.panel.rebuild();
    this.library.rebuild();
  }

  /** 当前选中元件的材质；没有就返回默认 BK7。 */
   currentMaterial()  {
    const el = this.selectedElement();
    if (el) return { ...el.material };
    return { n: 1.5168, abbe: 64.17 };
  }

  /** 新元器件的落点：当前视图中心 + 螺旋式偏移，避免重叠。 */
   nextPlacement()  {
    const center = { x: this.view.center.x, y: this.view.center.y };
    const span = Math.max(1.2, this.view.worldHeight * 0.16);
    const count = this.state.elements.length + this.state.sources.length;
    if (count === 0) return v(center.x, center.y);
    const ring = Math.ceil(count / 6);
    const index = (count - 1) % 6;
    const angle = (index / 6) * Math.PI * 2;
    return v(
      center.x + Math.cos(angle) * span * ring * 0.9,
      center.y + Math.sin(angle) * span * ring * 0.9,
    );
  }

  /** 把视图对准当前选中的对象（右侧菜单里的「居中」按钮）。 */
  focusSelection()  {
    const el = this.selectedElement();
    const src = this.selectedSource();
    const target = el ? el.pos : src ? src.pos : null;
    if (!target) return;
    this.view.center = { x: target.x, y: target.y };
    this.refreshTraceBounds();
    this.dirty = true;
    this.updateViewReadout();
  }

  /* --------------------------------------------------------------- 尺寸 */

   observeSize()  {
    const resize = ()  => {
      this.observeSizeMeasure();
      if (!this.pendingResize) this.sizeRetries = 0;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(this.canvas);
  }

  /**
   * 布局未就绪时的兜底：每帧重试测量一次。
   * 若长时间量不到有效尺寸（比如被 display:none 或 0 高度容器包住），
   * 直接把诊断信息显示出来，而不是静默地黑屏。
   */
   observeSizeRetry()  {
    this.sizeRetries++;
    this.observeSizeMeasure();
    if (this.sizeRetries === 90 && (this.pendingResize || this.view.width < 8)) {
      const rect = this.canvas.getBoundingClientRect();
      reportError(
        new Error(
          `画布一直测不到有效尺寸：rect=${rect.width}×${rect.height}，` +
            `canvas.width=${this.canvas.width}，clientWidth=${this.canvas.clientWidth}，` +
            `offsetParent=${this.canvas.offsetParent ? "有" : "无（可能被隐藏）"}`,
        ),
        "布局",
      );
    }
  }

  /** 只做一次尺寸测量（构造期与重试期共用）。 */
   observeSizeMeasure()  {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 8 || h < 8) {
      this.pendingResize = true;
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.view.resize(w, h, dpr);
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    this.pendingResize = false;
    this.needsTrace = true;
    this.dirty = true;
  }

  /* --------------------------------------------------------------- 更新 */

  /** 修改状态：记录历史、标记脏、按需刷新面板。 */
  update(
    mutate ,
    options  = {},
  )  {
    const { history = true, rebuild = false, retrace = true } = options;
    if (history) this.pushHistory();
    mutate(this.state);
    if (retrace) this.needsTrace = true;
    this.dirty = true;
    if (rebuild) this.panel.rebuild();
    else this.panel.refreshValues();
  }

   pushHistory()  {
    this.past.push(cloneScene(this.state.elements, this.state.sources));
    if (this.past.length > 80) this.past.shift();
    this.future.length = 0;
  }

  undo()  {
    const snap = this.past.pop();
    if (!snap) return;
    this.future.push(cloneScene(this.state.elements, this.state.sources));
    this.state.elements = snap.elements;
    this.state.sources = snap.sources;
    this.state.selectedElementId = snap.elements[0]?.id ?? null;
    this.state.selectedSourceId = snap.sources[0]?.id ?? null;
    this.needsTrace = true;
    this.dirty = true;
    this.panel.rebuild();
  }

  redo()  {
    const snap = this.future.pop();
    if (!snap) return;
    this.past.push(cloneScene(this.state.elements, this.state.sources));
    this.state.elements = snap.elements;
    this.state.sources = snap.sources;
    this.state.selectedElementId = snap.elements[0]?.id ?? null;
    this.state.selectedSourceId = snap.sources[0]?.id ?? null;
    this.needsTrace = true;
    this.dirty = true;
    this.panel.rebuild();
  }

  /* --------------------------------------------------------- 追踪范围 */

  /**
   * 光线追踪所使用的世界范围。
   *
   * 两条原则：
   *  1. **与相机的“缩放”无关的固定基准** —— 否则滚轮缩放后已算好的线段与元件会错位
   *     （早期版本直接用「当前可见范围」追踪，踩过这个坑）；
   *  2. **必须完整覆盖当前可见画面**，这样无论缩小到多小，光线都会一直延伸到屏幕边缘，
   *     由屏幕边界负责裁剪，而不是在画面中间断掉。
   *
   * 因此取：默认视窗（16×9，保证初始场景完整）∪ 当前可见范围 ∪ 场景内容，再外扩一圈。
   */
   computeTraceBounds()  {
    const DEFAULT_HALF_W = 8;
    const DEFAULT_HALF_H = this.view.baseWorldHeight / 2;
    const visible = this.view.bounds;

    let minX = Math.min(-DEFAULT_HALF_W, visible.min.x);
    let maxX = Math.max(DEFAULT_HALF_W, visible.max.x);
    let minY = Math.min(-DEFAULT_HALF_H, visible.min.y);
    let maxY = Math.max(DEFAULT_HALF_H, visible.max.y);

    for (const el of this.state.elements) {
      const aabb = buildGeometry(el).aabb;
      minX = Math.min(minX, aabb.min.x);
      maxX = Math.max(maxX, aabb.max.x);
      minY = Math.min(minY, aabb.min.y);
      maxY = Math.max(maxY, aabb.max.y);
    }
    for (const src of this.state.sources) {
      minX = Math.min(minX, src.pos.x);
      maxX = Math.max(maxX, src.pos.x);
      minY = Math.min(minY, src.pos.y);
      maxY = Math.max(maxY, src.pos.y);
    }

    // 外扩：留出反射、绕行以及「缩小后仍能延伸到屏幕外」的余量
    const padX = 6;
    const padY = 5;
    return {
      min: v(minX - padX, minY - padY),
      max: v(maxX + padX, maxY + padY),
    };
  }

  /** 重新计算追踪范围；若与当前缓存的差别超过阈值，则标记需要重新追踪。 */
   refreshTraceBounds()  {
    const next = this.computeTraceBounds();
    const cur = this.traceBounds;
    const changed =
      !cur ||
      Math.abs(next.min.x - cur.min.x) > 1e-6 ||
      Math.abs(next.min.y - cur.min.y) > 1e-6 ||
      Math.abs(next.max.x - cur.max.x) > 1e-6 ||
      Math.abs(next.max.y - cur.max.y) > 1e-6;
    this.traceBounds = next;
    if (changed) this.needsTrace = true;
  }

  selectElement(id )  {
    this.state.selectedElementId = id;
    if (id) this.state.selectedSourceId = null;
    this.dirty = true;
    this.panel.rebuild();
  }

  selectSource(id )  {
    this.state.selectedSourceId = id;
    if (id) this.state.selectedElementId = null;
    this.dirty = true;
    this.panel.rebuild();
  }

  addElement(kind )  {
    const source = (this.state.selectedElementId
      ? this.state.elements.find((e) => e.id === this.state.selectedElementId)
      : undefined) ?? this.state.elements[0];
    const material = source ? { ...source.material } : { n: 1.5168, abbe: 64.17 };
    const el = makeElement(kind, v(-0.6, 0.6), material);
    this.update((s) => {
      s.elements.push(el);
      s.selectedElementId = el.id;
      s.selectedSourceId = null;
    });
    this.panel.rebuild();
  }

  addSource()  {
    const el = this.state.sources[this.state.sources.length - 1];
    const src = makeSource({
      pos: el ? add(el.pos, v(0.4, 1.4)) : v(-6.2, 1.2),
      angle: el?.angle ?? 0,
      spectrum: el ? (JSON.parse(JSON.stringify(el.spectrum))  ) : undefined,
    });
    this.update((s) => {
      s.sources.push(src);
      s.selectedSourceId = src.id;
      s.selectedElementId = null;
    });
    this.panel.rebuild();
  }

  duplicateSelected()  {
    const el = this.selectedElement();
    if (el) {
      const copy  = JSON.parse(JSON.stringify(el))  ;
      copy.id = `dup-${Math.random().toString(36).slice(2, 8)}`;
      copy.pos = add(copy.pos, v(0.8, 0.8));
      this.update((s) => {
        s.elements.push(copy);
        s.selectedElementId = copy.id;
      });
      this.panel.rebuild();
      return;
    }
    const src = this.selectedSource();
    if (!src) return;
    const copy  = JSON.parse(JSON.stringify(src))  ;
    copy.id = `dup-${Math.random().toString(36).slice(2, 8)}`;
    copy.pos = add(copy.pos, v(0.4, 1));
    this.update((s) => {
      s.sources.push(copy);
      s.selectedSourceId = copy.id;
    });
    this.panel.rebuild();
  }

  deleteSelected()  {
    const elId = this.state.selectedElementId;
    const srcId = this.state.selectedSourceId;
    if (!elId && !srcId) return;
    this.update((s) => {
      if (elId) {
        s.elements = s.elements.filter((e) => e.id !== elId);
        s.selectedElementId = s.elements[0]?.id ?? null;
      }
      if (srcId) {
        s.sources = s.sources.filter((e) => e.id !== srcId);
        s.selectedSourceId = s.sources[0]?.id ?? null;
      }
    });
    this.panel.rebuild();
  }

  applyPreset(preset )  {
    const built = preset.build();
    this.update((s) => {
      s.elements = built.elements;
      s.sources = built.sources;
      s.selectedElementId = built.elements[0]?.id ?? null;
      s.selectedSourceId = null;
    });
    this.panel.rebuild();
  }

  selectedElement()  {
    return this.state.elements.find((e) => e.id === this.state.selectedElementId);
  }

  selectedSource()  {
    return this.state.sources.find((e) => e.id === this.state.selectedSourceId);
  }

  exportPng()  {
    const url = this.renderer.toDataURL();
    const a = document.createElement("a");
    a.href = url;
    a.download = `optics-lab-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
    a.click();
  }

  /* --------------------------------------------------------------- 交互 */

   pointerScreen(ev )  {
    const rect = this.canvas.getBoundingClientRect();
    return v(ev.clientX - rect.left, ev.clientY - rect.top);
  }

   pointerWorld(ev )  {
    return this.view.toWorld(this.pointerScreen(ev));
  }

  /** 平移视图（拖动空白处 / 中键拖动 / 空格+拖动）。 */
   startViewDrag(ev , id = "view")  {
    const rect = this.canvas.getBoundingClientRect();
    this.dragging = {
      kind: "view",
      id,
      grabOffset: v(0, 0),
      startWorld: this.pointerWorld(ev),
      vertexIndex: -1,
      startValue: 0,
      startThickness: 0,
      angleBase: 0,
      moved: false,
      lastScreenX: ev.clientX - rect.left,
      lastScreenY: ev.clientY - rect.top,
    };
    this.setInteraction(true);
  }

  /** 复位视图（平移 + 缩放）。 */
  resetView()  {
    this.view.reset();
    this.refreshTraceBounds();
    this.dirty = true;
    this.updateViewReadout();
  }

   attachEvents()  {
    const canvas = this.canvas;
    canvas.addEventListener("pointerdown", (ev) => this.onPointerDown(ev));
    canvas.addEventListener("pointermove", (ev) => this.onPointerMove(ev));
    canvas.addEventListener("pointerup", (ev) => this.onPointerUp(ev));
    canvas.addEventListener("pointercancel", (ev) => this.onPointerUp(ev));
    canvas.addEventListener("pointerleave", () => {
      if (!this.dragging) {
        this.hoverElementId = undefined;
        this.hoverSourceId = undefined;
        this.dirty = true;
      }
    });
    canvas.addEventListener("dblclick", (ev) => {
      const world = this.pointerWorld(ev);
      const el = this.hitElement(world);
      if (el) {
        // 双击元件：显示/隐藏
        this.update((s) => {
          const target = s.elements.find((e) => e.id === el.id);
          if (target) target.visible = !target.visible;
        });
        this.panel.rebuild();
        return;
      }
      // 双击空白：视图复位
      this.view.reset();
      this.refreshTraceBounds();
      this.dirty = true;
    });
    canvas.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const screen = this.pointerScreen(ev);
        const overElement = this.hitElement(this.view.toWorld(screen));
        // 滚轮行为由左侧「画布」分类里的模式决定；Shift 临时切换到另一种。
        const scaleMode = this.wheelMode === "element" ? !ev.shiftKey : ev.shiftKey;

        if (scaleMode) {
          const el = overElement ?? this.selectedElement();
          if (el) {
            this.scaleElement(el, ev.deltaY < 0 ? 1.06 : 1 / 1.06);
            return;
          }
        }

        // 默认：以光标为锚点缩放画布
        if (this.view.zoomAt(screen, ev.deltaY < 0 ? 1.12 : 1 / 1.12)) {
          this.refreshTraceBounds();
          this.dirty = true;
          this.updateViewReadout();
        }
      },
      { passive: false },
    );
    window.addEventListener("keydown", (ev) => this.onKey(ev));
  }

  /** 平移视图（统一入口：平移后按需扩展追踪范围，保证光线始终延伸出屏幕）。 */
  panViewBy(dxScreen , dyScreen )  {
    this.view.panBy(dxScreen, dyScreen);
    this.refreshTraceBounds();
    this.dirty = true;
    this.updateViewReadout();
  }

  /** 缩放某个元件的尺寸（Shift + 滚轮）。 */
   scaleElement(el , factor )  {
    this.update(
      (s) => {
        const target = s.elements.find((e) => e.id === el.id);
        if (!target) return;
        if (target.kind === "plate") {
          target.halfWidth = clamp(target.halfWidth * factor, 0.2, 5);
          target.halfHeight = clamp(target.halfHeight * factor, 0.2, 5);
        } else if (isArcLens(target)) {
          target.height = clamp(target.height * factor, 0.2, 4);
        } else if (target.kind === "prism") {
          target.size = clamp(target.size * factor, 0.6, 6);
        } else if (target.kind === "polygon") {
          target.points = target.points.map((p) => scale(p, factor));
        }
      },
      { history: false },
    );
    this.panel.refreshValues();
  }

   onKey(ev )  {
    const tag = (ev.target | null)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (ev.key === "Delete" || ev.key === "Backspace") {
      this.deleteSelected();
      ev.preventDefault();
    } else if (ev.key === "d" && (ev.ctrlKey || ev.metaKey)) {
      this.duplicateSelected();
      ev.preventDefault();
    } else if (ev.key === "z" && (ev.ctrlKey || ev.metaKey)) {
      if (ev.shiftKey) this.redo();
      else this.undo();
      ev.preventDefault();
    } else if (ev.key === "y" && (ev.ctrlKey || ev.metaKey)) {
      this.redo();
      ev.preventDefault();
    } else if (ev.key === "0" && (ev.ctrlKey || ev.metaKey)) {
      this.resetView();
      ev.preventDefault();
    } else if (ev.key === "Escape") {
      this.selectElement(null);
      this.selectSource(null);
    }
  }

   onPointerDown(ev )  {
    this.canvas.setPointerCapture(ev.pointerId);
    const world = this.pointerWorld(ev);
    const px = this.view.pixelsPerUnit;

    // 0) 中键 / 空格 / 右键：直接平移画布
    if (ev.button === 1 || ev.button === 2 || ev.getModifierState?.("Space")) {
      this.startViewDrag(ev);
      return;
    }
    // 1) 光源角度箭头（命中范围随光源尺寸放大）
    for (const src of this.state.sources) {
      if (!src.enabled) continue;
      const sc = src.size && src.size > 0 ? src.size : 1;
      const tip = add(src.pos, scale(dirFrom(src.angle), 1.25 * sc));
      if (dist(world, tip) * px < 18 * sc + 8) {
        this.startDrag({
          kind: "source-angle",
          id: src.id,
          grabOffset: v(0, 0),
          startWorld: world,
          vertexIndex: -1,
          startValue: src.angle,
          startThickness: 0,
          angleBase: 0,
          moved: false,
        });
        this.selectSource(src.id);
        return;
      }
    }

    // 2) 光源本体：命中半径取「标记半径」与一个舒适下限中的较大者，
    //    并随缩放适当放宽，保证在任意缩放下都容易点中。
    for (const src of this.state.sources) {
      if (!src.enabled) continue;
      const sc = src.size && src.size > 0 ? src.size : 1;
      const hitRadius = Math.max(9 * sc, 15 / Math.max(0.4, px / 90));
      if (dist(world, src.pos) * px < hitRadius) {
        this.startDrag({
          kind: "source",
          id: src.id,
          grabOffset: sub(src.pos, world),
          startWorld: world,
          vertexIndex: -1,
          startValue: 0,
          startThickness: 0,
          angleBase: 0,
          moved: false,
        });
        this.selectSource(src.id);
        return;
      }
    }

    // 3) 自定义多边形的顶点
    const selected = this.selectedElement();
    if (selected && selected.kind === "polygon") {
      const c = Math.cos(selected.rot);
      const s = Math.sin(selected.rot);
      for (let i = 0; i < selected.points.length; i++) {
        const p = selected.points[i] ;
        const worldP = v(selected.pos.x + p.x * c - p.y * s, selected.pos.y + p.x * s + p.y * c);
        if (dist(world, worldP) * px < 12) {
          this.startDrag({
            kind: "vertex",
            id: selected.id,
            grabOffset: v(0, 0),
            startWorld: world,
            vertexIndex: i,
            startValue: 0,
            startThickness: 0,
            angleBase: 0,
            moved: false,
          });
          return;
        }
      }
    }

    // 4) 光学元件
    const el = this.hitElement(world);
    if (el) {
      this.selectElement(el.id);
      if (isArcLens(el) && ev.shiftKey) {
        this.startDrag({
          kind: "sag",
          id: el.id,
          grabOffset: v(0, 0),
          startWorld: world,
          vertexIndex: -1,
          startValue: el.sagFront,
          startThickness: 0,
          angleBase: 0,
          moved: false,
        });
        return;
      }
      this.startDrag({
        kind: "element",
        id: el.id,
        grabOffset: sub(el.pos, world),
        startWorld: world,
        vertexIndex: -1,
        startValue: 0,
        startThickness: el.kind === "plate" ? el.halfWidth : el.kind === "prism" ? el.size : 1,
        angleBase: el.rot,
        moved: false,
      });
      return;
    }

    // 落在空白处：取消选中，并让这次拖动变成「平移画布」
    this.selectElement(null);
    this.selectSource(null);
    this.startViewDrag(ev);
  }

   startDrag(drag )  {
    this.dragging = drag;
    this.setInteraction(true);
  }

   onPointerMove(ev )  {
    const world = this.pointerWorld(ev);
    const drag = this.dragging;
    if (!drag) {
      this.updateHover(world);
      return;
    }

    // 平移画布：用屏幕像素差计算，与缩放比例无关
    if (drag.kind === "view") {
      const rect = this.canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const dx = sx - drag.lastScreenX;
      const dy = sy - drag.lastScreenY;
      if (!drag.moved && Math.hypot(dx, dy) > 2) drag.moved = true;
      if (drag.moved && (dx !== 0 || dy !== 0)) {
        // 平移会改变可见范围：统一入口里会按需扩展追踪范围，
        // 这样光线永远延伸出屏幕、由屏幕边界裁剪（否则会在画面中间断掉）。
        this.panViewBy(dx, dy);
      }
      drag.lastScreenX = sx;
      drag.lastScreenY = sy;
      return;
    }

    if (!drag.moved && dist(world, drag.startWorld) * this.view.pixelsPerUnit > 3) {
      drag.moved = true;
      this.pushHistory();
    }
    if (!drag.moved) return;

    this.update(
      (s) => {
        if (drag.kind === "source" || drag.kind === "source-angle") {
          const src = s.sources.find((x) => x.id === drag.id);
          if (!src) return;
          if (drag.kind === "source") {
            src.pos = add(world, drag.grabOffset);
          } else {
            src.angle = angleOf(norm(sub(world, src.pos)));
          }
          return;
        }
        const el = s.elements.find((x) => x.id === drag.id);
        if (!el) return;
        if (drag.kind === "element") {
          el.pos = add(world, drag.grabOffset);
        } else if (drag.kind === "vertex" && el.kind === "polygon") {
          const local = rotateInv(sub(world, el.pos), el.rot);
          el.points[drag.vertexIndex] = local;
        } else if (drag.kind === "sag") {
          if (
            el.kind === "biconvex" ||
            el.kind === "planoconvex" ||
            el.kind === "biconcave" ||
            el.kind === "meniscus"
          ) {
            const dx = world.x - drag.startWorld.x;
            const next = clamp(drag.startValue + dx * 0.5, 0, el.height);
            el.sagFront = next;
            if (el.kind !== "planoconvex") el.sagBack = next;
          }
        }
      },
      { history: false, rebuild: false },
    );
  }

   onPointerUp(ev )  {
    if (this.dragging) {
      const wasView = this.dragging.kind === "view";
      this.dragging = null;
      this.setInteraction(false);
      if (!wasView) this.panel.rebuild();
    } else {
      this.pointerWorld(ev);
    }
  }

   setInteraction(active )  {
    this.interactionActive = active;
    if (active) {
      window.clearTimeout(this.interactionTimer);
    } else {
      this.interactionTimer = window.setTimeout(() => {
        this.interactionActive = false;
        this.dirty = true;
      }, 140);
    }
    this.dirty = true;
  }

  /** 光源的命中半径（CSS 像素）：与绘制/拖拽逻辑保持一致，保证「光标样式」与「点得中」相符。 */
   sourceHitRadius(src )  {
    const px = this.view.pixelsPerUnit;
    const sc = src.size && src.size > 0 ? src.size : 1;
    return Math.max(9 * sc, 15 / Math.max(0.4, px / 90));
  }

   updateHover(world )  {
    const prevEl = this.hoverElementId;
    const prevSrc = this.hoverSourceId;
    const el = this.hitElement(world);
    let src ;
    if (!el) {
      const px = this.view.pixelsPerUnit;
      src = this.state.sources.find(
        (x) => x.enabled && dist(world, x.pos) * px < this.sourceHitRadius(x),
      );
    }
    this.hoverElementId = el?.id;
    this.hoverSourceId = src?.id;
    if (prevEl !== this.hoverElementId || prevSrc !== this.hoverSourceId) {
      // 元件/光源上是“可抓取”，空白处是“可平移画布”
      this.canvas.style.cursor = el || src ? "grab" : "move";
      this.dirty = true;
    }
  }

  /** 命中测试：返回包含该点的元件（取面积最小者，便于选中内层元件）。 */
   hitElement(world , geoCache  )  {
    let best ;
    let bestArea = Infinity;
    for (const el of this.state.elements) {
      if (!el.visible) continue;
      const geo = geoCache ? geoCache(el) : buildGeometry(el);
      if (!pointInShape(world, geo.outline)) continue;
      if (geo.area < bestArea) {
        bestArea = geo.area;
        best = el;
      }
    }
    return best;
  }

  /* --------------------------------------------------------------- 主循环 */

   frame = ()  => {
    // 渲染/追踪里任何异常都不能让 requestAnimationFrame 链断掉：
    // 一旦断掉，画面会永久停在“一片黑 + 读数全 0”的状态，而且看不出原因。
    try {
      this.renderFrame();
    } catch (err) {
      reportError(err, "渲染循环");
    }
    requestAnimationFrame(this.frame);
  };

   renderFrame()  {
    const now = performance.now();
    this.framesRendered++;
    this.frameCount++;
    if (now - this.lastFpsAt >= 400) {
      this.fps = (this.frameCount * 1000) / (now - this.lastFpsAt);
      this.frameCount = 0;
      this.lastFpsAt = now;
    }

    // 视口还没量到有效尺寸时不要追踪/绘制：重试测量，等布局就绪
    if (this.pendingResize || this.view.width < 8 || this.view.height < 8) {
      this.observeSizeRetry();
      return;
    }
    if (this.needsTrace) {
      this.refreshTraceBounds();
      const result = traceScene(
        this.state.sources,
        this.state.elements,
        this.traceBounds ,
        this.state.trace,
      );
      this.segments = result.segments;
      this.stats = result.stats;
      this.needsTrace = false;
    }

    if (this.dirty) {
      this.renderer.draw(this.segments, this.state.elements, this.state.sources, this.state.render, {
        hoveredId: this.hoverElementId,
        selectedId: this.state.selectedElementId ?? this.state.selectedSourceId ?? undefined,
        active: this.interactionActive,
      });
      this.dirty = false;
      this.updateStats();
      // 只要成功画出一帧，就把启动/错误横幅收起来
      clearCrashBanner();
    }
  }

   updateStats()  {
    this.statsHost.rays.textContent = String(this.stats.rays);
    this.statsHost.segments.textContent = String(this.stats.segments);
    this.statsHost.traced.textContent = String(this.stats.traced);
    this.updateViewReadout();
  }

  /** 帧时读数里附带视图状态（缩放与平移），方便确认拖拽/滚轮生效。 */
   updateViewReadout()  {
    const canvasInfo = `${this.canvas.width}×${this.canvas.height}`;
    const zoomPct = Math.round(this.view.zoom * 100);
    const cx = this.view.center.x.toFixed(1);
    const cy = this.view.center.y.toFixed(1);
    const errs = errorTotal();
    this.statsHost.frame.textContent =
      `${this.stats.ms.toFixed(1)} ms · ${this.fps.toFixed(0)} fps · 画布 ${canvasInfo} · ` +
      `缩放 ${zoomPct}% · 中心 ${cx},${cy}${errs ? ` · ⚠ ${errs} 个错误` : ""}`;
  }

  /** 视图：缩放指定倍率（以画布中心为锚点）。 */
  zoomView(factor )  {
    const anchor = v(this.view.width / 2, this.view.height / 2);
    if (this.view.zoomAt(anchor, factor)) {
      this.refreshTraceBounds();
      this.dirty = true;
      this.updateViewReadout();
    }
  }

  /** 视图：让全部元件刚好落在视野内。 */
  fitViewToScene()  {
    if (this.state.elements.length === 0) {
      this.resetView();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of this.state.elements) {
      const geo = buildGeometry(el);
      minX = Math.min(minX, geo.aabb.min.x);
      minY = Math.min(minY, geo.aabb.min.y);
      maxX = Math.max(maxX, geo.aabb.max.x);
      maxY = Math.max(maxY, geo.aabb.max.y);
    }
    for (const src of this.state.sources) {
      minX = Math.min(minX, src.pos.x);
      minY = Math.min(minY, src.pos.y);
      maxX = Math.max(maxX, src.pos.x);
      maxY = Math.max(maxY, src.pos.y);
    }
    this.view.fitBounds({ min: v(minX, minY), max: v(maxX, maxY) });
    this.refreshTraceBounds();
    this.dirty = true;
    this.updateViewReadout();
  }

  /** 已成功渲染的帧数（供启动自检使用）。 */
  get renderedFrames()  {
    return this.framesRendered;
  }

  /** 当前线段快照（测试用：验证相机变换不影响追踪结果）。 */
  segmentsSnapshot()  {
    return this.segments.map((s) => ({
      ax: s.ax,
      ay: s.ay,
      bx: s.bx,
      by: s.by,
      power: s.power,
    }));
  }

  /** 触发一次重绘（供面板调用）。 */
  invalidate()  {
    this.dirty = true;
  }
}

/* --------------------------------------------------------------- 错误报告 */

let crashHost  = null;
let lastReport = "";
let errorCount = 0;

function crashElement()  {
  if (!crashHost && typeof document !== "undefined") crashHost = document.getElementById("crash");
  return crashHost;
}

/** 渲染成功一帧后隐藏错误/启动横幅。 */
export function clearCrashBanner()  {
  const host = crashElement();
  if (host && !host.hidden) {
    host.hidden = true;
    host.textContent = "";
  }
}

/**
 * 把运行期错误显示在画布上方（不必打开 DevTools），同时写进控制台。
 * 首次错误保留完整调用栈，重复错误只累加计数，避免刷屏。
 */
export function reportError(err , context )  {
  const detail = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
  const key = `${context}|${detail}`;
  const isNew = key !== lastReport;
  if (isNew) {
    lastReport = key;
    errorCount = 1;
  } else {
    errorCount++;
  }

  console.error(`[光学折射实验室] ${context} 出错：`, err);

  const host = crashElement();
  if (!host) return;
  const brief = detail.split("\n").slice(0, 6).join("\n");
  host.textContent = `⚠ ${context}出错（累计 ${errorCount} 次）\n\n${brief}\n\n请把这段内容发给我。`;
  host.hidden = false;
}

/** 出错次数，显示在顶栏，便于判断“看起来空白”时到底有没有报错。 */
export function errorTotal()  {
  return errorCount;
}

function installGlobalErrorHandlers()  {
  window.addEventListener("error", (ev) => {
    const target = ev.target  ;
    if (target && target !== (window) && target.tagName) {
      reportError(
        new Error(
          `资源加载失败: <${target.tagName.toLowerCase()}> ${target.getAttribute?.("src") ?? target.getAttribute?.("href") ?? ""}`,
        ),
        "资源加载",
      );
      return;
    }
    reportError(ev.error ?? new Error(ev.message), "未捕获异常");
  });
  window.addEventListener("unhandledrejection", (ev) => {
    reportError((ev).reason, "未处理的 Promise 拒绝");
  });
}

/* ------------------------------------------------------------------ 工具 */

function isArcLens(el )  {
  return (
    el.kind === "biconvex" ||
    el.kind === "planoconvex" ||
    el.kind === "biconcave" ||
    el.kind === "meniscus"
  );
}

function rotateInv(p , rot )  {
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  return v(p.x * c - p.y * s, p.x * s + p.y * c);
}

function pointInShape(p , poly )  {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] ;
    const b = poly[j] ;
    if (a.y > p.y !== b.y > p.y) {
      const t = (p.y - a.y) / (b.y - a.y);
      if (p.x < a.x + t * (b.x - a.x)) inside = !inside;
    }
  }
  return inside;
}

/* -------------------------------------------------------------------- 启动 */

function element (id )  {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少必要的 DOM 节点: #${id}`);
  return el  ;
}

/**
 * 启动应用。放在导出函数里而不是模块顶层，这样测试环境可以直接
 * `import` 本模块拿到 App 类，而不会触发副作用。
 */
export function boot()  {
  // 先装全局错误捕获，这样连启动阶段的异常也能显示在页面上
  installGlobalErrorHandlers();

  // 启动阶段先给个可见反馈，避免“一片黑、看不出在不在跑”
  const crash = document.getElementById("crash");
  if (crash) {
    crash.textContent =
      "正在启动…\n\n（若这行文字在 2 秒后仍然存在，说明脚本没有跑起来或渲染循环没有开始）";
    crash.hidden = false;
  }

  const canvas = element ("view");
  const panel = element ("panel");
  const library = document.getElementById("library");
  const app = new App(
    canvas,
    panel,
    {
      rays: element("stat-rays"),
      segments: element("stat-segments"),
      traced: element("stat-traced"),
      frame: element("stat-frame"),
    },
    library ?? undefined,
  );
  // 便于在控制台里调试/脚本化（挂到 window 上，调试时无需类型断言）
  (window)["opticsLab"] = app;
  console.info("[光学折射实验室] 启动完成");
  return app;
}

/** 启动并做「是否真的渲染出第一帧」的自检。 */
export function bootWithSelfCheck()  {
  let app ;
  try {
    app = boot();
  } catch (err) {
    reportError(err, "启动");
    const host = crashElement();
    if (host) {
      host.textContent = `${host.textContent ?? ""}\n\n如果浏览器不支持原生 TypeScript 类型剥离，或脚本没有加载成功，也会出现这条提示。`;
      host.hidden = false;
    }
    return null;
  }

  // 启动自检：1.5 秒后若一帧都没画出来，多半是渲染循环抛异常
  window.setTimeout(() => {
    if (app.renderedFrames > 0) return;
    const host = crashElement();
    if (!host) return;
    const canvas = document.getElementById("view")  ;
    const rect = canvas?.getBoundingClientRect();
    host.textContent =
      `⚠ 应用已初始化，但 1.5 秒内没有成功渲染任何一帧。\n\n` +
      `画布像素尺寸 : ${canvas?.width ?? 0}×${canvas?.height ?? 0}\n` +
      `画布可见尺寸 : ${rect ? `${Math.round(rect.width)}×${Math.round(rect.height)}` : "未知"}\n` +
      `devicePixelRatio: ${window.devicePixelRatio}\n` +
      `浏览器: ${navigator.userAgent}\n\n` +
      `请把这段内容发给我。`;
    host.hidden = false;
  }, 1500);

  return app;
}

export { defaultPolygonPoints };
