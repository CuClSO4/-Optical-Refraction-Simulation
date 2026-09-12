/**
 * 控制面板：完全数据驱动地构建 DOM。
 *
 * 设计约定
 *  · `rebuild()` 重建整个面板（切换选中对象、增删元件时调用）；
 *  · `refreshValues()` 只同步控件的当前值（拖拽、滑杆连续输入时调用），
 *    这样不会丢掉滑杆的焦点，也不会打断拖动。
 */

 
import { LAMBDA_REF, wavelengthToLinearRGB } from "./core/spectrum.js";
 
import { expandSpectrum } from "./core/trace.js";
import { ELEMENT_KIND_LABELS, MATERIALS, SPECTRUM_PRESETS, SCENE_PRESETS } from "./scene.js";
// 分辨率的硬边界与渲染器共用同一组常量，避免面板和渲染层各写一份、改一处漏一处。
import { QUALITY_MAX as Q_MAX, QUALITY_MIN as Q_MIN } from "./render.js";
 

 
























/** 一组控件携带的「只更新数值」的能力。 */
 






export class Panel {
     
     
   current  = null;
  /** 右侧「属性菜单」内容的构建函数（重建时复用）。 */
   selectionBody  = null;

  constructor(host , callbacks ) {
    this.root = host;
    this.cb = callbacks;
  }

  rebuild()  {
    this.current = this.build();
  }

  refreshValues()  {
    this.current?.refresh();
  }

   build()  {
    const host = this.root;
    host.replaceChildren();
    const controls  = [];
    const rebuilt  = [];
    const doc = host.ownerDocument ?? document;

    const push = (c )  => {
      controls.push(c.refresh);
      rebuilt.push(c.rebuild);
    };

    /* ------------------------------------------- 选中对象（面板最上方） */
    push(this.buildSelectionSection(host));

    /* ------------------------------------------------------- 场景与预设 */
    host.append(
      section("场景预设", [
        buttonGrid(
          doc,
          SCENE_PRESETS.map((p) => ({
            label: p.label,
            title: p.hint,
            onClick: () => this.cb.applyPreset(p),
          })),
        ),
        row(
          doc,
          button(doc, "撤销 ⌘Z", () => this.cb.undo(), "ghost"),
          button(doc, "重做 ⇧⌘Z", () => this.cb.redo(), "ghost"),
          button(doc, "导出 PNG", () => this.cb.exportPng(), "ghost"),
        ),
      ]),
    );

    /* --------------------------------------------------------- 渲染与显示 */
    push(this.buildRenderSection(host));

    return {
      refresh: () => {
        for (const fn of controls) fn();
      },
      rebuild: () => {
        for (const fn of rebuilt) fn();
      },
    };
  }

  /* ------------------------------------------------ 选中对象（右侧菜单） */

  /**
   * 右侧面板的核心：选中某个元器件后显示的属性菜单。
   * 参考 NB 化学实验室的交互 —— 选中后弹出一块菜单，含快捷操作 + 参数。
   */
   buildSelectionSection(host )  {
    const doc = host.ownerDocument ?? document;
    const refreshers  = [];
    const body = doc.createElement("div");
    body.className = "selection-body";

    const buildBody = ()  => {
      body.replaceChildren();
      refreshers.length = 0;
      const el = this.cb.state.elements.find((e) => e.id === this.cb.state.selectedElementId);
      const src = this.cb.state.sources.find((s) => s.id === this.cb.state.selectedSourceId);

      // 标题行
      const titleRow = doc.createElement("div");
      titleRow.className = "panel-title-row";
      const title = doc.createElement("div");
      title.className = "panel-title";
      const badge = doc.createElement("div");
      badge.className = "selection-badge";
      if (el) {
        title.textContent = el.label;
        badge.textContent = el.visible ? "显示中" : "已隐藏";
      } else if (src) {
        title.textContent = src.label;
        badge.textContent = src.enabled ? "已开启" : "已关闭";
      } else {
        title.textContent = "未选中对象";
        badge.textContent = `${this.cb.state.elements.length} 元件 / ${this.cb.state.sources.length} 光源`;
      }
      titleRow.append(title, badge);
      body.append(titleRow);

      if (!el && !src) {
        const hint = doc.createElement("p");
        hint.className = "hint-text";
        hint.textContent =
          "点击左侧元器件库添加新对象，或点击画布中的元件/光源来编辑它的参数。";
        body.append(hint);
        return;
      }

      // 快捷操作
      const actions = doc.createElement("div");
      actions.className = "quick-actions";
      const mk = (label , title2 , danger , fn )  => {
        const b = doc.createElement("button");
        b.type = "button";
        b.className = `qa-btn${danger ? " is-danger" : ""}`;
        b.title = title2;
        b.textContent = label;
        b.addEventListener("click", fn);
        return b;
      };
      if (el) {
        actions.append(
          mk("复制", "复制这个元件", false, () => this.cb.duplicateSelected()),
          mk("居中", "把视图对准这个元件", false, () => this.cb.focusSelection()),
          mk(el.visible ? "隐藏" : "显示", "显示 / 隐藏", false, () =>
            this.cb.update((s) => {
              const t = s.elements.find((e) => e.id === el.id);
              if (t) t.visible = !t.visible;
            }, { rebuild: true }),
          ),
          mk("删除", "删除这个元件", true, () => this.cb.deleteSelected()),
        );
      } else if (src) {
        actions.append(
          mk("复制", "复制这个光源", false, () => this.cb.duplicateSelected()),
          mk("居中", "把视图对准这个光源", false, () => this.cb.focusSelection()),
          mk(src.enabled ? "关闭" : "开启", "开启 / 关闭", false, () =>
            this.cb.update((s) => {
              const t = s.sources.find((x) => x.id === src.id);
              if (t) t.enabled = !t.enabled;
            }, { rebuild: true }),
          ),
          mk("删除", "删除这个光源", true, () => this.cb.deleteSelected()),
        );
      }
      body.append(actions);

      // 参数
      const params = doc.createElement("div");
      params.className = "el-params";
      params.append(...(el ? this.elementParamNodes(el, refreshers) : this.sourceParamNodes(src , refreshers)));
      body.append(params);
    };

    buildBody();

    host.append(section("属性菜单", [body]));
    this.selectionBody = buildBody;

    return {
      refresh: () => {
        for (const fn of refreshers) fn();
      },
      rebuild: () => {
        buildBody();
      },
    };
  }

  /* ------------------------------------------------------------ 元件面板 */

   buildElementsSection(host )  {
    const doc = host.ownerDocument ?? document;
    const refreshers  = [];
    const rebuilders  = [];

    const list = doc.createElement("div");
    list.className = "el-list";

    const listRefresh = ()  => {
      list.replaceChildren(
        ...this.cb.state.elements.map((el, index) => elementRow(doc, el, index, this.cb)),
      );
    };
    listRefresh();

    const params = doc.createElement("div");
    params.className = "el-params";
    const buildParams = ()  => {
      params.replaceChildren();
      const el = this.selected();
      if (!el) {
        const hint = doc.createElement("p");
        hint.className = "hint-text";
        hint.textContent = "点击画布中的光学元件以编辑参数，或从下方添加新元件。";
        params.append(hint);
        return;
      }
      refreshers.length = 0;
      params.append(...this.elementParamNodes(el, refreshers));
    };
    buildParams();

    const addRow = buttonGrid(
      doc,
      ELEMENT_KIND_LABELS.map((k) => ({
        label: k.label,
        onClick: () => this.cb.addElement(k.kind),
      })),
    );

    host.append(section("光学元件", [list, params, addRow]));

    rebuilders.push(() => {
      listRefresh();
      buildParams();
    });
    return {
      refresh: () => {
        for (const fn of refreshers) fn();
      },
      rebuild: () => {
        for (const fn of rebuilders) fn();
      },
    };
  }

   selected()  {
    return this.cb.state.elements.find((e) => e.id === this.cb.state.selectedElementId);
  }

   elementParamNodes(el , refreshers )  {
    const doc = this.root.ownerDocument;
    const nodes  = [];
    const upd = (fn , options  )  => {
      this.cb.update(
        (s) => {
          const target = s.elements.find((e) => e.id === el.id);
          if (target) fn(target);
        },
        options,
      );
    };

    const title = doc.createElement("div");
    title.className = "el-title";
    title.textContent = el.label;
    nodes.push(title);

    /* 位置与旋转 */
    nodes.push(
      numberRow(doc, [
        {
          label: "x",
          value: () => this.live(el).pos.x,
          sliderMin: -8,
          sliderMax: 8,
          step: 0.05,
          onInput: (val) => upd((t) => (t.pos = { x: val, y: t.pos.y })),
          refresh: refreshers,
        },
        {
          label: "y",
          value: () => this.live(el).pos.y,
          sliderMin: -4.5,
          sliderMax: 4.5,
          step: 0.05,
          onInput: (val) => upd((t) => (t.pos = { x: t.pos.x, y: val })),
          refresh: refreshers,
        },
        {
          label: "旋转°",
          value: () => (this.live(el).rot * 180) / Math.PI,
          sliderMin: -180,
          sliderMax: 180,
          step: 1,
          onInput: (val) => upd((t) => (t.rot = (val * Math.PI) / 180)),
          refresh: refreshers,
        },
      ]),
    );

    /* 形状参数 */
    const shapeRows = this.shapeParamNodes(el, refreshers);
    if (shapeRows.length > 0) {
      const head = doc.createElement("div");
      head.className = "sub-head";
      head.textContent = "几何参数";
      nodes.push(head, numberRow(doc, shapeRows));
    }

    /* 材质 */
    const materialHead = doc.createElement("div");
    materialHead.className = "sub-head";
    materialHead.textContent = "光学材料";
    nodes.push(materialHead);

    const materialSelect = doc.createElement("select");
    materialSelect.className = "select";
    for (const m of MATERIALS) {
      const opt = doc.createElement("option");
      opt.value = m.key;
      opt.textContent = `${m.label} · n=${m.n}`;
      materialSelect.append(opt);
    }
    materialSelect.value =
      MATERIALS.find(
        (m) =>
          Math.abs(m.n - el.material.n) < 1e-4 && Math.abs(m.abbe - el.material.abbe) < 0.5,
      )?.key ?? "custom";
    materialSelect.addEventListener("change", () => {
      const m = MATERIALS.find((x) => x.key === materialSelect.value);
      if (!m || m.key === "custom") return;
      upd((t) => (t.material = { n: m.n, abbe: m.abbe }), { rebuild: true });
    });
    const syncMaterialSelect = ()  => {
      const cur = this.live(el).material;
      materialSelect.value =
        MATERIALS.find(
          (m) => Math.abs(m.n - cur.n) < 1e-4 && Math.abs(m.abbe - cur.abbe) < 0.5,
        )?.key ?? "custom";
    };
    refreshers.push(syncMaterialSelect);
    nodes.push(materialSelect);

    const noDispersion = ()  => this.live(el).material.abbe >= 900;
    nodes.push(
      numberRow(doc, [
        {
          label: "折射率 n_d",
          value: () => this.live(el).material.n,
          sliderMin: 1,
          sliderMax: 2.6,
          step: 0.001,
          format: (x) => x.toFixed(3),
          onInput: (val) =>
            upd((t) => {
              t.material = { ...t.material, n: val };
            }),
          refresh: refreshers,
        },
        {
          label: "阿贝数 V_d",
          value: () => (noDispersion() ? 100 : this.live(el).material.abbe),
          sliderMin: 10,
          sliderMax: 100,
          step: 0.5,
          format: (x) => (x >= 100 ? "无色散" : x.toFixed(1)),
          onInput: (val) =>
            upd((t) => {
              t.material = { ...t.material, abbe: val >= 100 ? 10000 : val };
            }),
          refresh: refreshers,
        },
      ]),
    );

    const nHint = doc.createElement("p");
    nHint.className = "hint-text";
    nHint.textContent =
      "V_d 越小声散越强（火石玻璃）；设成「无色散」时所有波长取同一折射率。临界角 = asin(1/n)。";
    nodes.push(nHint);

    return nodes;
  }

   live (fallback )  {
    return (this.cb.state.elements.find((e) => e.id === fallback.id)  ) ?? fallback;
  }

   shapeParamNodes(el , refreshers )  {
    switch (el.kind) {
      case "biconvex":
      case "biconcave":
      case "meniscus":
        return [
          this.field("通光半径 h", el, refreshers, (t) => (t.kind === el.kind ? t.height : 1.8), 0.2, 4, 0.01, (t, val) => {
            if (isArc(t)) t.height = val;
          }),
          this.field("中心厚度", el, refreshers, (t) => (isArc(t) ? t.centerThickness : 0.4), 0.02, 2.5, 0.01, (t, val) => {
            if (isArc(t)) t.centerThickness = val;
          }),
          this.field("前表面弦高", el, refreshers, (t) => (isArc(t) ? t.sagFront : 0.3), 0, 4, 0.01, (t, val) => {
            if (isArc(t)) t.sagFront = val;
          }),
          this.field("后表面弦高", el, refreshers, (t) => (isArc(t) ? t.sagBack : 0.3), 0, 4, 0.01, (t, val) => {
            if (isArc(t)) t.sagBack = val;
          }),
        ];
      case "planoconvex":
        return [
          this.field("通光半径 h", el, refreshers, (t) => (isArc(t) ? t.height : 1.8), 0.2, 4, 0.01, (t, val) => {
            if (isArc(t)) t.height = val;
          }),
          this.field("中心厚度", el, refreshers, (t) => (isArc(t) ? t.centerThickness : 0.4), 0.02, 2.5, 0.01, (t, val) => {
            if (isArc(t)) t.centerThickness = val;
          }),
          this.field("前表面弦高", el, refreshers, (t) => (isArc(t) ? t.sagFront : 0.3), 0, 4, 0.01, (t, val) => {
            if (isArc(t)) t.sagFront = val;
          }),
        ];
      case "plate":
        return [
          this.field("半宽", el, refreshers, (t) => (t.kind === "plate" ? t.halfWidth : 1.5), 0.2, 5, 0.01, (t, val) => {
            if (t.kind === "plate") t.halfWidth = val;
          }),
          this.field("半高", el, refreshers, (t) => (t.kind === "plate" ? t.halfHeight : 1.5), 0.2, 4, 0.01, (t, val) => {
            if (t.kind === "plate") t.halfHeight = val;
          }),
        ];
      case "prism":
        return [
          this.field("顶角°", el, refreshers, (t) => (t.kind === "prism" ? t.apexAngle : 60), 5, 170, 0.5, (t, val) => {
            if (t.kind === "prism") t.apexAngle = val;
          }),
          this.field("腰长", el, refreshers, (t) => (t.kind === "prism" ? t.size : 3), 0.5, 6, 0.01, (t, val) => {
            if (t.kind === "prism") t.size = val;
          }),
        ];
      default:
        return [];
    }
  }

   field(
    label ,
    el ,
    refreshers ,
    get ,
    sliderMin ,
    sliderMax ,
    step ,
    set ,
  )  {
    return {
      label,
      value: () => get(this.live(el)),
      sliderMin,
      sliderMax,
      step,
      onInput: (val) => this.cb.update((s) => {
        const t = s.elements.find((x) => x.id === el.id);
        if (t) set(t, val);
      }),
      refresh: refreshers,
    };
  }

  /* ------------------------------------------------------------ 光源面板 */

   buildSourcesSection(host )  {
    const doc = host.ownerDocument ?? document;
    const list = doc.createElement("div");
    list.className = "el-list";
    const listRefresh = ()  => {
      list.replaceChildren(
        ...this.cb.state.sources.map((src, index) => sourceRow(doc, src, index, this.cb)),
      );
    };
    listRefresh();

    const body = doc.createElement("div");
    body.className = "el-params";
    const refreshers  = [];
    const buildBody = ()  => {
      body.replaceChildren();
      refreshers.length = 0;
      const src = this.cb.state.sources.find((s) => s.id === this.cb.state.selectedSourceId);
      if (!src) {
        const hint = doc.createElement("p");
        hint.className = "hint-text";
        hint.textContent = "点击画布中的黄色光源或上方列表来编辑光源参数。";
        body.append(hint);
        return;
      }
      body.append(...this.sourceParamNodes(src, refreshers));
    };
    buildBody();

    host.append(
      section("光源", [
        list,
        body,
        buttonGrid(doc, [{ label: "＋ 新增光源", onClick: () => this.cb.addSource() }]),
      ]),
    );

    return {
      refresh: () => {
        for (const fn of refreshers) fn();
      },
      rebuild: () => {
        listRefresh();
        buildBody();
      },
    };
  }

   sourceParamNodes(src , refreshers )  {
    const doc = this.root.ownerDocument;
    const nodes  = [];
    const live = ()  => this.cb.state.sources.find((s) => s.id === src.id) ?? src;
    const upd = (fn , options  )  => {
      this.cb.update((s) => {
        const t = s.sources.find((x) => x.id === src.id);
        if (t) fn(t);
      }, options);
    };

    const title = doc.createElement("div");
    title.className = "el-title";
    title.textContent = `${src.label} · ${live().enabled ? "开启" : "关闭"}`;
    nodes.push(title);

    /* 位置 / 角度 */
    nodes.push(
      numberRow(doc, [
        {
          label: "x",
          value: () => live().pos.x,
          sliderMin: -9,
          sliderMax: 9,
          step: 0.05,
          onInput: (val) => upd((t) => (t.pos = { x: val, y: t.pos.y })),
          refresh: refreshers,
        },
        {
          label: "y",
          value: () => live().pos.y,
          sliderMin: -4.5,
          sliderMax: 4.5,
          step: 0.05,
          onInput: (val) => upd((t) => (t.pos = { x: t.pos.x, y: val })),
          refresh: refreshers,
        },
        {
          label: "角度°",
          value: () => (live().angle * 180) / Math.PI,
          sliderMin: -180,
          sliderMax: 180,
          step: 1,
          onInput: (val) => upd((t) => (t.angle = (val * Math.PI) / 180)),
          refresh: refreshers,
        },
      ]),
    );

    /* 发射方式 */
    const modeHead = doc.createElement("div");
    modeHead.className = "sub-head";
    modeHead.textContent = "光束结构";
    nodes.push(modeHead);

    const modeSelect = doc.createElement("select");
    modeSelect.className = "select";
    const modes  = [
      { value: "collimated", label: "平行光束（发射点横向铺开）" },
      { value: "point", label: "点光源（同一发射点、角度展开）" },
      { value: "area", label: "面光源（横向铺开 + 角度展开）" },
    ];
    for (const m of modes) {
      const opt = doc.createElement("option");
      opt.value = m.value;
      opt.textContent = m.label;
      modeSelect.append(opt);
    }
    modeSelect.value = src.mode;
    modeSelect.addEventListener("change", () =>
      upd((t) => (t.mode = modeSelect.value["mode"])),
    );
    refreshers.push(() => (modeSelect.value = live().mode));
    nodes.push(modeSelect);

    nodes.push(
      numberRow(doc, [
        {
          label: "光束宽度",
          value: () => live().beamWidth,
          sliderMin: 0,
          sliderMax: 9,
          step: 0.02,
          format: (x) => x.toFixed(2),
          onInput: (val) => upd((t) => (t.beamWidth = val)),
          refresh: refreshers,
        },
        {
          label: "每束光线数",
          value: () => live().rayCount,
          sliderMin: 1,
          sliderMax: 61,
          step: 1,
          format: (x) => x.toFixed(0),
          onInput: (val) => upd((t) => (t.rayCount = Math.round(val))),
          refresh: refreshers,
        },
        {
          label: "光束数量",
          value: () => live().beamCount,
          sliderMin: 1,
          sliderMax: 15,
          step: 1,
          format: (x) => x.toFixed(0),
          onInput: (val) => upd((t) => (t.beamCount = Math.round(val))),
          refresh: refreshers,
        },
      ]),
    );

    nodes.push(
      numberRow(doc, [
        {
          label: "发散角°",
          value: () => live().spread,
          sliderMin: 0,
          sliderMax: 170,
          step: 1,
          format: (x) => x.toFixed(0),
          onInput: (val) => upd((t) => (t.spread = val)),
          refresh: refreshers,
        },
        {
          label: "多束色偏 nm",
          value: () => live().beamTint,
          sliderMin: 0,
          sliderMax: 400,
          step: 5,
          format: (x) => x.toFixed(0),
          onInput: (val) => upd((t) => (t.beamTint = val)),
          refresh: refreshers,
        },
      ]),
    );

    /* 光源标记尺寸（仅影响显示与命中范围） */
    nodes.push(
      numberRow(doc, [
        {
          label: "标记大小",
          value: () => live().size,
          sliderMin: 0.5,
          sliderMax: 4,
          step: 0.1,
          format: (x) => `×${x.toFixed(1)}`,
          onInput: (val) => upd((t) => (t.size = val)),
          refresh: refreshers,
        },
        {
          label: "光束宽度",
          value: () => live().beamWidth,
          sliderMin: 0,
          sliderMax: 9,
          step: 0.02,
          format: (x) => x.toFixed(2),
          onInput: (val) => upd((t) => (t.beamWidth = val)),
          refresh: refreshers,
        },
      ]),
    );
    const zoomRow = doc.createElement("div");
    zoomRow.className = "btn-grid";
    for (const [label, factor] of [
      ["放大光源", 1.25],
      ["缩小光源", 1 / 1.25],
    ]) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "btn btn-ghost";
      b.textContent = label;
      b.title = "调整光源标记的显示大小，便于选中";
      b.addEventListener("click", () => upd((t) => (t.size = clampNum(t.size * factor, 0.5, 4))));
      zoomRow.append(b);
    }
    nodes.push(zoomRow);

    /* 光谱 */
    const specHead = doc.createElement("div");
    specHead.className = "sub-head";
    specHead.textContent = "光谱";
    nodes.push(specHead);

    const presetSelect = doc.createElement("select");
    presetSelect.className = "select";
    for (const p of SPECTRUM_PRESETS) {
      const opt = doc.createElement("option");
      opt.value = p.key;
      opt.textContent = p.label;
      presetSelect.append(opt);
    }
    const spec = live().spectrum;
    presetSelect.value =
      spec.kind === "discrete"
        ? (SPECTRUM_PRESETS.find((p) => {
            const built = p.build();
            return (
              built.kind === "discrete" &&
              built.lines.length === spec.lines.length &&
              Math.abs(built.lines[0] .lambda - spec.lines[0] .lambda) < 0.6
            );
          })?.key ?? "mercury")
        : spec.samples <= 1
          ? "mono"
          : spec.samples <= 9
            ? "white7"
            : "white15";
    presetSelect.addEventListener("change", () => {
      const p = SPECTRUM_PRESETS.find((x) => x.key === presetSelect.value);
      if (!p) return;
      upd((t) => (t.spectrum = p.build()), { rebuild: true });
    });
    refreshers.push(() => {
      const cur = live().spectrum;
      presetSelect.value =
        cur.kind === "discrete" ? presetSelect.value : cur.samples <= 1 ? "mono" : cur.samples <= 9 ? "white7" : "white15";
    });
    nodes.push(presetSelect);

    /* 光谱预览色带 */
    nodes.push(spectrumSwatch(doc, live().spectrum, presetSelect.value));

    /* 单色波长 */
    const isMono = live().spectrum.kind === "continuous" && live().spectrum.samples <= 1;
    if (isMono) {
      nodes.push(
        numberRow(doc, [
          {
            label: "波长 nm",
            value: () => {
              const s = live().spectrum  ;
              return s.lambda;
            },
            sliderMin: 380,
            sliderMax: 780,
            step: 0.1,
            format: (x) => x.toFixed(1),
            onInput: (val) =>
              upd((t) => {
                const s = t.spectrum  ;
                t.spectrum = { ...s, samples: 1, lambda: val };
              }),
            refresh: refreshers,
          },
        ]),
      );
    } else if (live().spectrum.kind === "continuous") {
      nodes.push(
        numberRow(doc, [
          {
            label: "采样数",
            value: () => (live().spectrum).samples,
            sliderMin: 2,
            sliderMax: 41,
            step: 1,
            format: (x) => `${x.toFixed(0)} 色`,
            onInput: (val) =>
              upd((t) => {
                const s = t.spectrum  ;
                t.spectrum = { ...s, samples: Math.round(val) };
              }),
            refresh: refreshers,
          },
          {
            label: "起始 nm",
            value: () => (live().spectrum).lambdaMin,
            sliderMin: 380,
            sliderMax: 700,
            step: 5,
            format: (x) => x.toFixed(0),
            onInput: (val) =>
              upd((t) => {
                const s = t.spectrum  ;
                t.spectrum = { ...s, lambdaMin: Math.min(val, s.lambdaMax - 10) };
              }),
            refresh: refreshers,
          },
          {
            label: "终止 nm",
            value: () => (live().spectrum).lambdaMax,
            sliderMin: 420,
            sliderMax: 780,
            step: 5,
            format: (x) => x.toFixed(0),
            onInput: (val) =>
              upd((t) => {
                const s = t.spectrum  ;
                t.spectrum = { ...s, lambdaMax: Math.max(val, s.lambdaMin + 10) };
              }),
            refresh: refreshers,
          },
        ]),
      );
    }

    const specHint = doc.createElement("p");
    specHint.className = "hint-text";
    specHint.textContent =
      "复色光会按波长分别追踪并在同一缓冲里叠加，因此色散（彩虹）是计算出来的，不是画上去的。";
    nodes.push(specHint);

    return nodes;
  }

  /* ------------------------------------------------------------ 渲染面板 */

   buildRenderSection(host )  {
    const doc = host.ownerDocument ?? document;
    const refreshers  = [];
    const nodes  = [];

    const r = ()  => this.cb.state.render;
    const t = ()  => this.cb.state.trace;

    const head1 = doc.createElement("div");
    head1.className = "sub-head";
    head1.textContent = "视图";
    nodes.push(head1);

    nodes.push(
      row(
        doc,
        button(doc, "复位视图", () => this.cb.viewReset(), "ghost"),
        button(doc, "适应场景", () => this.cb.viewFit(), "ghost"),
        button(doc, "放大", () => this.cb.viewZoom(1.25), "ghost"),
        button(doc, "缩小", () => this.cb.viewZoom(1 / 1.25), "ghost"),
      ),
    );

    const viewHint = doc.createElement("p");
    viewHint.className = "hint-text";
    viewHint.textContent =
      "画布操作：左键拖空白处平移 · 滚轮以光标为锚点缩放 · 中键/空格+拖动平移 · 双击空白处复位 · Shift+滚轮缩放元件尺寸。";
    nodes.push(viewHint);

    const head2 = doc.createElement("div");
    head2.className = "sub-head";
    head2.textContent = "光线与亮度";
    nodes.push(head2);

    nodes.push(
      numberRow(doc, [
        {
          label: "曝光",
          value: () => r().exposure,
          sliderMin: 0.1,
          sliderMax: 4,
          step: 0.01,
          format: (x) => x.toFixed(2),
          onInput: (val) => this.cb.update((s) => (s.render.exposure = val), { history: false }),
          refresh: refreshers,
        },
        {
          label: "光晕",
          value: () => r().bloom,
          sliderMin: 0,
          sliderMax: 1,
          step: 0.01,
          format: (x) => x.toFixed(2),
          onInput: (val) => this.cb.update((s) => (s.render.bloom = val), { history: false }),
          refresh: refreshers,
        },
        {
          label: "线宽",
          value: () => r().lineWidth,
          sliderMin: 0.25,
          sliderMax: 3,
          step: 0.05,
          format: (x) => `${x.toFixed(2)} px`,
          onInput: (val) => this.cb.update((s) => (s.render.lineWidth = val), { history: false }),
          refresh: refreshers,
        },
        {
          label: "分辨率",
          value: () => r().quality,
          sliderMin: 0.4,
          sliderMax: 1,
          // 分辨率是唯一有硬边界的字段：它决定追踪缓冲的大小（缓冲 = 画布 × 分辨率）
          hardMin: Q_MIN,
          hardMax: Q_MAX,
          step: 0.05,
          format: (x) => `${(x * 100).toFixed(0)}%`,
          onInput: (val) => this.cb.update((s) => (s.render.quality = val), { history: false }),
          refresh: refreshers,
        },
      ]),
    );

    const hintRender = doc.createElement("p");
    hintRender.className = "hint-text";
    hintRender.textContent =
      "滑杆保持着常规范围；数值框可以直接输入超出滑杆范围的数值（滑杆会停在端点并变暗，数值本身生效）。" +
      `分辨率是唯一有硬边界的：${Math.round(Q_MIN * 100)}%–${Math.round(Q_MAX * 100)}%，它决定追踪缓冲的大小。`;
    nodes.push(hintRender);

    const headPrecision = doc.createElement("div");
    headPrecision.className = "sub-head";
    headPrecision.textContent = "追踪精度";
    nodes.push(headPrecision);

    nodes.push(
      numberRow(doc, [
        {
          label: "最大反射次数",
          value: () => t().maxDepth,
          sliderMin: 1,
          sliderMax: 60,
          step: 1,
          format: (x) => x.toFixed(0),
          onInput: (val) => this.cb.update((s) => (s.trace.maxDepth = Math.round(val))),
          refresh: refreshers,
        },
        {
          label: "强度阈值",
          value: () => t().minPower,
          sliderMin: 0.0002,
          sliderMax: 0.1,
          step: 0.0002,
          format: (x) => x.toFixed(4),
          onInput: (val) => this.cb.update((s) => (s.trace.minPower = val)),
          refresh: refreshers,
        },
        {
          label: "线段上限",
          value: () => t().maxSegments,
          sliderMin: 20000,
          sliderMax: 800000,
          step: 10000,
          format: (x) => `${(x / 1000).toFixed(0)}k`,
          onInput: (val) => this.cb.update((s) => (s.trace.maxSegments = Math.round(val))),
          refresh: refreshers,
        },
      ]),
    );

    const head3 = doc.createElement("div");
    head3.className = "sub-head";
    head3.textContent = "显示";
    nodes.push(head3);

    nodes.push(
      toggleGrid(doc, [
        {
          label: "网格与光轴",
          value: () => r().showGrid,
          onToggle: (val) => this.cb.update((s) => (s.render.showGrid = val), { history: false }),
          refresh: refreshers,
        },
        {
          label: "元件轮廓",
          value: () => r().showOutline,
          onToggle: (val) => this.cb.update((s) => (s.render.showOutline = val), { history: false }),
          refresh: refreshers,
        },
        {
          label: "表面法线",
          value: () => r().showNormals,
          onToggle: (val) => this.cb.update((s) => (s.render.showNormals = val), { history: false }),
          refresh: refreshers,
        },
        {
          label: "元件标签",
          value: () => r().showLabels,
          onToggle: (val) => this.cb.update((s) => (s.render.showLabels = val), { history: false }),
          refresh: refreshers,
        },
      ]),
    );

    const formula = doc.createElement("pre");
    formula.className = "formula";
    formula.textContent = [
      "n₁·sin θ₁ = n₂·sin θ₂",
      "R = ½(Rs + Rp),  T = 1 − R",
      `n_d 参考波长 ${LAMBDA_REF.d.toFixed(1)} nm`,
    ].join("\n");
    nodes.push(formula);

    host.append(section("渲染与显示", nodes));

    return {
      refresh: () => {
        for (const fn of refreshers) fn();
      },
      rebuild: () => {
        for (const fn of refreshers) fn();
      },
    };
  }
}

/* ------------------------------------------------------------ DOM 小工具 */

 

















/**
 * 是否为弧面透镜（双凸/平凸/双凹/弯月）。
 * 这里用 `el.kind === ...` 直接返回布尔值，而不是写 `el is Extract<...>` 类型谓词：
 * 类型谓词属于「类型剥离器需要特殊处理」的语法，改用普通布尔返回可以让
 * dist/ 的纯 JS 产物更简单可靠（调用处都能正常收窄）。
 */
function isArc(el )  {
  return (
    el.kind === "biconvex" ||
    el.kind === "planoconvex" ||
    el.kind === "biconcave" ||
    el.kind === "meniscus"
  );
}

function section(title , children )  {
  const el = document.createElement("details");
  el.className = "section";
  el.open = true;
  const summary = document.createElement("summary");
  summary.textContent = title;
  el.append(summary);
  const body = document.createElement("div");
  body.className = "section-body";
  body.append(...children);
  el.append(body);
  return el;
}

function row(doc , ...children )  {
  const el = doc.createElement("div");
  el.className = "row";
  el.append(...children);
  return el;
}

function button(
  doc ,
  label ,
  onClick ,
  variant  = "primary",
  title  ,
)  {
  const b = doc.createElement("button");
  b.type = "button";
  b.className = `btn btn-${variant}`;
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function buttonGrid(
  doc ,
  items ,
)  {
  const grid = doc.createElement("div");
  grid.className = "btn-grid";
  for (const item of items) {
    grid.append(button(doc, item.label, item.onClick, "ghost", item.title));
  }
  return grid;
}

/** 数值格的自增编号（用于把 <label> 通过 for/id 关联到数值输入框）。 */
let cellSeq = 0;

function numberRow(doc , fields )  {
  const wrap = doc.createElement("div");
  wrap.className = "num-row";
  wrap.style.setProperty("--cols", String(Math.min(fields.length, 3)));

  for (const field of fields) {
    const cell = doc.createElement("label");
    cell.className = "num-cell";

    const top = doc.createElement("span");
    top.className = "num-label";
    top.textContent = field.label;

    const valueOut = doc.createElement("b");
    valueOut.className = "num-value";
    valueOut.hidden = true;

    const input = doc.createElement("input");
    input.type = "range";
    input.min = String(field.sliderMin);
    input.max = String(field.sliderMax);
    input.step = String(field.step);
    input.value = String(field.value());

    const fmt = field.format ?? ((x ) => (Number.isInteger(x) ? x.toFixed(0) : x.toFixed(2)));

    // ---- 可编辑数值框：点击数值即可直接输入精确值
    const text = doc.createElement("input");
    text.type = "text";
    text.className = "num-value num-input";
    text.title = "点击可直接输入数值，回车确认，Esc 取消";
    text.value = fmt(field.value());
    // 给 <label> 关联到数值框：这样点标签文字会聚焦输入框，拖动滑杆也不受影响
    //（label 若没有 for、又包着两个控件，浏览器会绑定到第一个控件，事件容易互相干扰）
    if (!cell.id) cell.id = `num-cell-${(cellSeq += 1)}`;
    text.id = `${cell.id}-input`;
    cell.htmlFor = text.id;

    const sync = ()  => {
      const v = field.value();
      valueOut.textContent = fmt(v);
      // 滑杆值夹进自身区间：手动输入的数值大于滑杆上限时，滑块停在端点，数值本身不受影响
      input.value = String(clampNum(v, field.sliderMin, field.sliderMax));
      if (document.activeElement !== text && text.value !== fmt(v)) text.value = fmt(v);
    };
    sync();

    input.addEventListener("input", () => {
      const val = Number(input.value);
      valueOut.textContent = fmt(val);
      text.value = fmt(val);
      field.onInput(val);
    });
    input.addEventListener("change", () => sync());

    const commitText = ()  => {
      const raw = text.value.trim();
      const parsed = Number(raw);
      if (raw === "" || !Number.isFinite(parsed)) {
        text.value = fmt(field.value());
        return;
      }
      // 手输数值不受滑杆刻度限制：只有显式声明了 hardMin/hardMax 的字段（目前仅「分辨率」）才有硬边界。
      let next = parsed;
      if (field.hardMin !== undefined) next = Math.max(field.hardMin, next);
      if (field.hardMax !== undefined) next = Math.min(field.hardMax, next);
      const rounded = roundToStep(next, field.step);
      field.onInput(rounded);
      text.value = fmt(rounded);
      valueOut.textContent = fmt(rounded);
      input.value = String(clampNum(rounded, field.sliderMin, field.sliderMax));
    };
    text.addEventListener("change", commitText);
    text.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        commitText();
        text.blur();
      } else if (ev.key === "Escape") {
        text.value = fmt(field.value());
        text.blur();
      }
      // 输入框内不要触发全局快捷键（删除元件等）
      ev.stopPropagation();
    });
    field.refresh.push(sync);

    const head = doc.createElement("span");
    head.className = "num-head";
    head.append(top, text);

    cell.append(head, input);
    wrap.append(cell);
  }
  return wrap;
}

/** 按步长取整，避免浮点噪声（例如 1.7000000000000002）。 */
function roundToStep(value , step )  {
  if (!Number.isFinite(value)) return value;
  const s = Math.abs(step) > 0 ? Math.abs(step) : 1;
  const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(s))));
  return Number(value.toFixed(decimals));
}

/** 数值夹紧（光源尺寸按钮用）。 */
function clampNum(value , lo , hi )  {
  return Math.min(hi, Math.max(lo, value));
}

function toggleGrid(
  doc ,
  items ,
)  {
  const wrap = doc.createElement("div");
  wrap.className = "toggle-grid";
  for (const item of items) {
    const label = doc.createElement("label");
    label.className = "toggle";
    const input = doc.createElement("input");
    input.type = "checkbox";
    input.checked = item.value();
    input.addEventListener("change", () => item.onToggle(input.checked));
    const span = doc.createElement("span");
    span.textContent = item.label;
    label.append(input, span);
    item.refresh.push(() => (input.checked = item.value()));
    wrap.append(label);
  }
  return wrap;
}

function elementRow(
  doc ,
  el ,
  index ,
  cb ,
)  {
  const wrap = doc.createElement("div");
  wrap.className = "el-row";
  if (el.id === cb.state.selectedElementId) wrap.classList.add("is-selected");

  const pick = doc.createElement("button");
  pick.type = "button";
  pick.className = "el-name";
  pick.textContent = `${index + 1}. ${el.label}`;
  pick.addEventListener("click", () => cb.selectElement(el.id));

  const eye = doc.createElement("button");
  eye.type = "button";
  eye.className = "icon-btn";
  eye.title = el.visible ? "隐藏" : "显示";
  eye.textContent = el.visible ? "◉" : "○";
  eye.addEventListener("click", () =>
    cb.update((s) => {
      const t = s.elements.find((x) => x.id === el.id);
      if (t) t.visible = !t.visible;
    }, { rebuild: true }),
  );

  const del = doc.createElement("button");
  del.type = "button";
  del.className = "icon-btn";
  del.title = "删除";
  del.textContent = "✕";
  del.addEventListener("click", () => {
    cb.selectElement(el.id);
    cb.deleteSelected();
  });

  wrap.append(pick, eye, del);
  return wrap;
}

function sourceRow(
  doc ,
  src ,
  index ,
  cb ,
)  {
  const wrap = doc.createElement("div");
  wrap.className = "el-row";
  if (src.id === cb.state.selectedSourceId) wrap.classList.add("is-selected");

  const swatch = doc.createElement("span");
  swatch.className = "src-swatch";
  const colors = expandSpectrum(src.spectrum).slice(0, 12);
  swatch.style.background = `linear-gradient(90deg, ${colors
    .map((c, i) => {
      const rgb = wavelengthToLinearRGB(c.lambda);
      const pos = colors.length === 1 ? 50 : (i / (colors.length - 1)) * 100;
      return `rgb(${Math.round(rgb.x * 255)},${Math.round(rgb.y * 255)},${Math.round(
        rgb.z * 255,
      )}) ${pos.toFixed(1)}%`;
    })
    .join(", ")})`;

  const pick = doc.createElement("button");
  pick.type = "button";
  pick.className = "el-name";
  const kind =
    src.spectrum.kind === "discrete"
      ? `${src.spectrum.lines.length} 条谱线`
      : src.spectrum.samples <= 1
        ? `${src.spectrum.lambda.toFixed(1)} nm`
        : `${src.spectrum.samples} 色`;
  pick.textContent = `${index + 1}. ${src.label} · ${kind}`;
  pick.addEventListener("click", () => cb.selectSource(src.id));

  const eye = doc.createElement("button");
  eye.type = "button";
  eye.className = "icon-btn";
  eye.title = src.enabled ? "关闭" : "开启";
  eye.textContent = src.enabled ? "◉" : "○";
  eye.addEventListener("click", () =>
    cb.update((s) => {
      const t = s.sources.find((x) => x.id === src.id);
      if (t) t.enabled = !t.enabled;
    }, { rebuild: true }),
  );

  const del = doc.createElement("button");
  del.type = "button";
  del.className = "icon-btn";
  del.title = "删除";
  del.textContent = "✕";
  del.addEventListener("click", () => {
    cb.selectSource(src.id);
    cb.deleteSelected();
  });

  wrap.append(swatch, pick, eye, del);
  return wrap;
}

function spectrumSwatch(doc , spec , presetKey )  {
  const wrap = doc.createElement("div");
  wrap.className = "swatch-row";
  const samples = expandSpectrum(spec);
  const maxW = Math.max(...samples.map((s) => s.weight));
  for (const s of samples.slice(0, 41)) {
    const cell = doc.createElement("span");
    cell.className = "swatch";
    const rgb = wavelengthToLinearRGB(s.lambda);
    cell.style.background = `rgb(${Math.round(rgb.x * 255)},${Math.round(rgb.y * 255)},${Math.round(
      rgb.z * 255,
    )})`;
    cell.style.opacity = String(0.35 + 0.65 * (s.weight / (maxW || 1)));
    cell.title = `${s.lambda.toFixed(1)} nm`;
    wrap.append(cell);
  }
  const note = doc.createElement("span");
  note.className = "swatch-note";
  note.textContent = presetKey;
  wrap.append(note);
  return wrap;
}
