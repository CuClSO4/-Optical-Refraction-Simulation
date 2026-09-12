/**
 * 端到端冒烟测试：在 Node 里用极简 DOM 打桩跑通整个应用
 *   - 面板构建（场景预设 / 元件参数 / 光源参数 / 渲染参数）
 *   - 追踪 + 渲染一帧
 *   - 画布交互：选中、拖动、滚轮缩放、键盘删除
 *   - 撤销 / 重做
 *
 *   node --experimental-strip-types test/app.smoke.ts
 */

import assert from "node:assert/strict";
import { installDom, type StubNode, type StubWindow } from "./dom-stub.ts";

const win: StubWindow = installDom();
const doc = win.document;

const view = doc.getElementById("view") as unknown as HTMLCanvasElement;
const panel = doc.getElementById("panel")!;
const statSegments = doc.getElementById("stat-segments")!;

const { App } = await import("../src/main.ts");
const { SCENE_PRESETS } = await import("../src/scene.ts");

/** 精确匹配 class（`includes` 会把 lib-tabs 也当成 lib-tab）。 */
function hasClass(node: StubNode, cls: string): boolean {
  return node.className.split(/\s+/).includes(cls);
}

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

const canvasNode = view as unknown as unknown as StubNode;
const libraryNode = doc.getElementById("library")!;
const app = new App(
  view,
  panel,
  {
    rays: doc.getElementById("stat-rays")!,
    segments: statSegments,
    traced: doc.getElementById("stat-traced")!,
    frame: doc.getElementById("stat-frame")!,
  },
  libraryNode as unknown as HTMLElement,
);

const state = app.state;

/* ------------------------------------------------------------------ 渲染 */

test("启动后能构建面板并渲染出光线", () => {
  win.tick(2);
  assert.ok(Number(statSegments.textContent) > 0, "应追踪出线段");
  assert.ok(panel.all().length > 40, `面板应包含大量控件，实际 ${panel.all().length} 个节点`);
});

test("面板包含「属性菜单 / 场景预设 / 渲染与显示」三个区块与全部场景预设", () => {
  const sections = panel.all().filter((n) => n.tagName === "DETAILS");
  assert.ok(sections.length >= 3, `应有至少 3 个区块，实际 ${sections.length}`);
  const text = panel.all().map((n) => n.textContent).join("|");
  for (const preset of SCENE_PRESETS) {
    assert.ok(text.includes(preset.label), `缺少场景预设按钮：${preset.label}`);
  }
});

test("左侧元器件库：三个一级分类 + 元器件卡片网格", () => {
  const tabs = libraryNode.all().filter((n) => hasClass(n, "lib-tab"));
  assert.equal(tabs.length, 3, `应有 3 个一级分类，实际 ${tabs.length}`);
  const tabText = tabs.map((t) => t.textContent).join("|");
  for (const label of ["实验仪器", "光源", "画布"]) {
    assert.ok(tabText.includes(label), `缺少一级分类：${label}`);
  }
  // 默认分类下应有二级分类标题与卡片
  const groups = libraryNode.all().filter((n) => hasClass(n, "lib-group-title"));
  assert.ok(groups.length >= 3, `实验仪器下应有至少 3 个二级分类，实际 ${groups.length}`);
  const items = libraryNode.all().filter((n) => hasClass(n, "lib-item"));
  assert.ok(items.length >= 12, `应有足够多的元器件卡片，实际 ${items.length}`);
  const names = items.map((i) => i.textContent).join("|");
  for (const name of ["双凸透镜", "平凹".replace("凹", "凸"), "三棱镜", "玻璃板", "圆形水珠"]) {
    assert.ok(names.includes(name), `缺少元器件：${name}`);
  }
});

test("点击元器件卡片 → 加入画布中心并选中（右侧弹出属性菜单）", () => {
  app.applyPreset(SCENE_PRESETS[0]!);
  const countBefore = state.elements.length;
  const prismCard = libraryNode
    .all()
    .find((n) => hasClass(n, "lib-item") && n.textContent.includes("三棱镜"));
  assert.ok(prismCard, "找不到「三棱镜」卡片");
  prismCard!.click();
  win.tick(2);
  assert.equal(state.elements.length, countBefore + 1, "应新增一个元件");
  const added = state.elements[state.elements.length - 1]!;
  assert.equal(added.kind, "prism");
  assert.equal(added.label, "三棱镜");
  assert.equal(state.selectedElementId, added.id, "新加的元件应被选中");

  // 右侧属性菜单应显示该元件名
  const panelText = panel.all().map((n) => n.textContent).join("|");
  assert.ok(panelText.includes("属性菜单"), "右侧应有属性菜单区块");
  assert.ok(panelText.includes("三棱镜"), "属性菜单应显示当前选中的元件");
});

test("点击光源卡片 → 新增光源（含预设光谱）", () => {
  const before = state.sources.length;
  const view = libraryNode.all().find((n) => hasClass(n, "lib-tab") && n.textContent.includes("光源"));
  assert.ok(view, "找不到光源分类");
  view!.click();
  const card = libraryNode
    .all()
    .find((n) => hasClass(n, "lib-item") && n.textContent.includes("红色激光"));
  assert.ok(card, "找不到「红色激光」卡片");
  card!.click();
  win.tick(2);
  assert.equal(state.sources.length, before + 1, "应新增一个光源");
  const added = state.sources[state.sources.length - 1]!;
  assert.equal(added.label, "红色激光");
  assert.equal(added.spectrum.kind, "continuous");
  assert.ok(Math.abs(added.spectrum.lambda - 632.8) < 1e-6, "应为 632.8nm 单色");
  assert.equal(state.selectedSourceId, added.id, "新光源应被选中");
});

test("新元器件落在视图中心附近（先平移再取用也能对上位置）", () => {
  // 上一个用例切到了「光源」分类，这里先切回「实验仪器」
  const instTab = libraryNode.all().find((n) => hasClass(n, "lib-tab") && n.textContent.includes("实验仪器"));
  assert.ok(instTab, "找不到实验仪器分类");
  instTab!.click();
  app.resetView();
  app.panViewBy(-220, 120);
  const center = { ...app.view.center };
  const before = state.elements.length;
  const card = libraryNode
    .all()
    .find((n) => hasClass(n, "lib-item") && n.textContent.includes("玻璃板"));
  assert.ok(card, "找不到「玻璃板」卡片");
  card!.click();
  win.tick(1);
  const added = state.elements[state.elements.length - 1]!;
  assert.equal(state.elements.length, before + 1);
  const dist = Math.hypot(added.pos.x - center.x, added.pos.y - center.y);
  assert.ok(dist < 2.5, `新元件应落在视图中心附近，实际距离 ${dist.toFixed(2)}`);
  app.resetView();
});

test("画布分类：复位/适应/缩放按钮可用，且可切换滚轮模式", () => {
  const viewTab = libraryNode
    .all()
    .find((n) => hasClass(n, "lib-tab") && n.textContent.includes("画布"));
  assert.ok(viewTab, "找不到画布分类");
  viewTab!.click();
  const btns = libraryNode.all().filter((n) => hasClass(n, "btn"));
  const labels = btns.map((b) => b.textContent).join("|");
  for (const label of ["复位视图", "适应场景", "放大", "缩小", "缩放模式", "元件模式"]) {
    assert.ok(labels.includes(label), `画布分类缺少按钮：${label}`);
  }
  // 点击「放大」应改变缩放
  const zoomBefore = app.view.zoom;
  btns.find((b) => b.textContent === "放大")!.click();
  assert.ok(app.view.zoom > zoomBefore, "点击放大应提高缩放倍率");
  btns.find((b) => b.textContent === "复位视图")!.click();
  assert.equal(app.view.zoom, 1, "复位视图后缩放应为 100%");
  // 切换滚轮模式：元件模式下滚轮不再缩放画布，而是缩放元件
  btns.find((b) => b.textContent === "元件模式")!.click();
  app.applyPreset(SCENE_PRESETS[0]!);
  app.selectElement(state.elements[0]!.id);
  const zoom2 = app.view.zoom;
  const el = state.elements[0]!;
  const sizeBefore = el.kind === "biconvex" ? el.height : 0;
  canvasNode.dispatch("wheel", { clientX: app.view.width / 2, clientY: app.view.height / 2, deltaY: -120 });
  assert.equal(app.view.zoom, zoom2, "元件模式下滚轮不应缩放画布");
  const sizeAfter = el.kind === "biconvex" ? el.height : 0;
  assert.ok(sizeAfter > sizeBefore, `元件模式下滚轮应缩放元件：${sizeBefore} → ${sizeAfter}`);
  // 切回缩放模式
  libraryNode.all().find((n) => n.textContent === "缩放模式")!.click();
});

test("场景预设可切换，且都会产生光线", () => {
  for (const preset of SCENE_PRESETS) {
    app.applyPreset(preset);
    app.state.selectedSourceId = app.state.sources[0]?.id ?? null;
    app.invalidate();
    win.tick(2);
    const segs = Number(statSegments.textContent);
    assert.ok(segs > 0, `预设「${preset.label}」没有产生任何线段`);
  }
  app.applyPreset(SCENE_PRESETS[0]!);
  win.tick(2);
});

/* -------------------------------------------------------------- 交互操作 */

test("点击画布选中光学元件", () => {
  const el = state.elements[0]!;
  const p = app.view.toScreen(el.pos);
  canvasNode.dispatch("pointerdown", { clientX: p.x, clientY: p.y, shiftKey: false });
  canvasNode.dispatch("pointerup", { clientX: p.x, clientY: p.y });
  assert.equal(state.selectedElementId, el.id);
});

test("拖动元件会改变其位置", () => {
  const el = state.elements[0]!;
  const before = { ...el.pos };
  const p = app.view.toScreen(el.pos);
  canvasNode.dispatch("pointerdown", { clientX: p.x, clientY: p.y, shiftKey: false });
  canvasNode.dispatch("pointermove", { clientX: p.x + 40, clientY: p.y + 24 });
  canvasNode.dispatch("pointerup", { clientX: p.x + 40, clientY: p.y + 24 });
  const after = el.pos;
  assert.ok(
    Math.abs(after.x - before.x) > 0.1 || Math.abs(after.y - before.y) > 0.1,
    `拖动后位置应改变：${JSON.stringify(before)} → ${JSON.stringify(after)}`,
  );
});

test("拖动光源会改变其位置", () => {
  const src = state.sources[0]!;
  const before = { ...src.pos };
  const p = app.view.toScreen(src.pos);
  canvasNode.dispatch("pointerdown", { clientX: p.x, clientY: p.y, shiftKey: false });
  canvasNode.dispatch("pointermove", { clientX: p.x + 30, clientY: p.y - 20 });
  canvasNode.dispatch("pointerup", { clientX: p.x + 30, clientY: p.y - 20 });
  assert.ok(Math.hypot(src.pos.x - before.x, src.pos.y - before.y) > 0.1);
  assert.equal(state.selectedSourceId, src.id);
});

test("滚轮缩放元件尺寸（Shift + 滚轮）", () => {
  const el = state.elements[0]!;
  const before = el.kind === "prism" ? el.size : el.kind === "plate" ? el.halfWidth : el.kind === "biconvex" ? el.height : 1;
  const p = app.view.toScreen(el.pos);
  canvasNode.dispatch("pointermove", { clientX: p.x, clientY: p.y });
  canvasNode.dispatch("wheel", { clientX: p.x, clientY: p.y, deltaY: -100, shiftKey: true });
  const after =
    el.kind === "prism" ? el.size : el.kind === "plate" ? el.halfWidth : el.kind === "biconvex" ? el.height : 1;
  assert.ok(after > before, `Shift+滚轮应放大元件：${before} → ${after}`);
});

test("拖动空白处平移画布（视图中心随之改变）", () => {
  app.applyPreset(SCENE_PRESETS[0]!);
  app.resetView();
  win.tick(1);
  const before = { ...app.view.center };
  // 画布右下角是空白区域
  const x = app.view.width - 30;
  const y = app.view.height - 30;
  canvasNode.dispatch("pointerdown", { clientX: x, clientY: y, button: 0 });
  canvasNode.dispatch("pointermove", { clientX: x - 80, clientY: y - 40 });
  canvasNode.dispatch("pointerup", { clientX: x - 80, clientY: y - 40 });
  const after = app.view.center;
  // 向左上拖动 → 视图中心向右下移动
  assert.ok(after.x > before.x + 0.1, `平移后中心 x 应变大：${before.x} → ${after.x}`);
  assert.ok(after.y > before.y + 0.05, `平移后中心 y 应变大：${before.y} → ${after.y}`);
});

test("滚轮以光标为锚点缩放画布（该点世界坐标不变）", () => {
  app.resetView();
  win.tick(1);
  const screen = { x: app.view.width * 0.35, y: app.view.height * 0.3 };
  const worldBefore = app.view.toWorld(screen);
  const zoomBefore = app.view.zoom;
  canvasNode.dispatch("wheel", { clientX: screen.x, clientY: screen.y, deltaY: -120 });
  const worldAfter = app.view.toWorld(screen);
  assert.ok(app.view.zoom > zoomBefore, `滚轮上滚应放大：${zoomBefore} → ${app.view.zoom}`);
  assert.ok(
    Math.abs(worldAfter.x - worldBefore.x) < 1e-6 && Math.abs(worldAfter.y - worldBefore.y) < 1e-6,
    `光标锚点的世界坐标应保持不变：${JSON.stringify(worldBefore)} vs ${JSON.stringify(worldAfter)}`,
  );
  // 滚回去应恢复
  canvasNode.dispatch("wheel", { clientX: screen.x, clientY: screen.y, deltaY: 120 });
  assert.ok(app.view.zoom < zoomBefore * 1.02, "下滚应缩小");
});

test("双击空白处复位视图", () => {
  app.zoomView(2.5);
  app.panViewBy(-120, 60);
  const moved = { ...app.view.center };
  assert.ok(app.view.zoom !== 1 || moved.x !== 0, "视图应已被改动");
  canvasNode.dispatch("dblclick", { clientX: app.view.width - 20, clientY: app.view.height - 20 });
  assert.equal(app.view.zoom, 1, "复位后缩放应为 1");
  assert.ok(
    Math.abs(app.view.center.x) < 1e-9 && Math.abs(app.view.center.y) < 1e-9,
    "复位后视图中心应为原点",
  );
});

test("缩放与平移后光线仍能被追踪出来", () => {
  app.zoomView(3);
  app.panViewBy(120, -80);
  app.invalidate();
  win.tick(2);
  assert.ok(Number(statSegments.textContent) >= 0, "缩放后应能正常追踪（不报错）");
  app.resetView();
  app.invalidate();
  win.tick(2);
  assert.ok(Number(statSegments.textContent) > 0, "复位后应重新出现光线");
});

test("相机（平移/缩放）不影响追踪范围：线段世界坐标保持不变", () => {
  app.applyPreset(SCENE_PRESETS[0]!);
  app.resetView();
  win.tick(2);
  const before = app.segmentsSnapshot();
  assert.ok(before.length > 10, `初始应有足够线段，实际 ${before.length}`);

  // 放大 4 倍 + 平移（模拟用户滚轮与拖动）
  app.zoomView(4);
  app.panViewBy(-260, 140);
  win.tick(2);
  const afterZoom = app.segmentsSnapshot();
  assert.equal(afterZoom.length, before.length, "缩放后线段数量应保持不变");
  for (let i = 0; i < before.length; i++) {
    assert.equal(afterZoom[i]!.ax, before[i]!.ax, `第 ${i} 段 ax 不应因缩放而改变`);
    assert.equal(afterZoom[i]!.bx, before[i]!.bx, `第 ${i} 段 bx 不应因缩放而改变`);
    assert.equal(afterZoom[i]!.ay, before[i]!.ay, `第 ${i} 段 ay 不应因缩放而改变`);
    assert.equal(afterZoom[i]!.by, before[i]!.by, `第 ${i} 段 by 不应因缩放而改变`);
  }

  // 再平移，仍不应改变
  app.panViewBy(90, -70);
  app.invalidate();
  win.tick(2);
  const afterPan = app.segmentsSnapshot();
  assert.equal(afterPan.length, before.length, "平移后线段数量应保持不变");
  assert.equal(afterPan[0]!.ax, before[0]!.ax, "平移不应改变线段世界坐标");
});

test("光线跟随画布：平移/缩放后，光与元件的屏幕相对位置不变", () => {
  app.applyPreset(SCENE_PRESETS[0]!);
  app.resetView();
  win.tick(2);

  const lens = state.elements[0]!;
  /** 最强线段终点（世界坐标）→ 屏幕坐标（用与绘制一致的变换） */
  const sampleScreen = (): { x: number; y: number } => {
    const segs = app.segmentsSnapshot();
    const strongest = segs.reduce((a, b) => (b.power > a.power ? b : a));
    return app.view.toScreen({ x: strongest.bx, y: strongest.by });
  };
  const lensScreen = (): { x: number; y: number } => app.view.toScreen(lens.pos);
  const gap = (): number => {
    const a = sampleScreen();
    const b = lensScreen();
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const baseGap = gap();

  // 平移：光线与元件的屏幕位移必须一致 → 相对距离不变
  app.panViewBy(-180, 90);
  app.invalidate();
  win.tick(2);
  assert.ok(
    Math.abs(gap() - baseGap) < 1e-6,
    `平移后光线与元件的屏幕相对位置应不变：${baseGap.toFixed(3)} → ${gap().toFixed(3)}`,
  );

  // 缩放：同理
  app.zoomView(2.5);
  win.tick(2);
  assert.ok(
    Math.abs(gap() - baseGap * 2.5) < 1e-6,
    `缩放 2.5 倍后相对距离应放大 2.5 倍：${(baseGap * 2.5).toFixed(3)} vs ${gap().toFixed(3)}`,
  );

  app.resetView();
  win.tick(2);
  assert.ok(Math.abs(gap() - baseGap) < 1e-6, "复位后应回到初始相对位置");
});

test("平移画布时，已知世界点的屏幕坐标按 1:1 移动", () => {
  // 注意：resetView() 之后不能立刻断言，因为视图复位与后续断言之间不允许有其它相机改动
  app.resetView();
  win.tick(1);
  const world = { x: 2, y: -1 };
  const before = app.view.toScreen(world);
  const dx = -150;
  const dy = 70;
  app.panViewBy(dx, dy);
  const after = app.view.toScreen(world);
  assert.ok(
    Math.abs(after.x - before.x - dx) < 1e-9,
    `屏幕位移应与拖动比一致：期望 Δx=${dx}，实际 Δx=${(after.x - before.x).toFixed(6)}`,
  );
  assert.ok(
    Math.abs(after.y - before.y - dy) < 1e-9,
    `屏幕位移应与拖动比一致：期望 Δy=${dy}，实际 Δy=${(after.y - before.y).toFixed(6)}`,
  );
  app.resetView();
  win.tick(1);
});

test("任何缩放下光线都延伸到屏幕边缘（不会在画面中途断掉）", () => {
  app.applyPreset(SCENE_PRESETS[0]!);
  app.resetView();
  win.tick(2);

  /** 当前线段是否覆盖到可见范围的四条边界之外（即会被屏幕边界裁剪） */
  const coversViewport = (): { okL: boolean; okR: boolean; okT: boolean; okB: boolean } => {
    const segs = app.segmentsSnapshot();
    const b = app.view.bounds;
    const eps = 1e-6;
    return {
      okL: segs.some((s) => Math.min(s.ax, s.bx) <= b.min.x + eps),
      okR: segs.some((s) => Math.max(s.ax, s.bx) >= b.max.x - eps),
      okT: segs.some((s) => Math.min(s.ay, s.by) <= b.min.y + eps),
      okB: segs.some((s) => Math.max(s.ay, s.by) >= b.max.y - eps),
    };
  };

  // 逐个缩小档位检查
  for (const factor of [1 / 1.25, 1 / 1.6, 1 / 2, 1 / 3, 1 / 4]) {
    app.zoomView(factor);
    win.tick(2);
    const c = coversViewport();
    const b = app.view.bounds;
    assert.ok(
      c.okL && c.okR,
      `缩放 ${(app.view.zoom * 100).toFixed(0)}% 时，光线未延伸到左右屏幕边缘 ` +
        `（可见 x ∈ [${b.min.x.toFixed(1)}, ${b.max.x.toFixed(1)}]）`,
    );
    assert.ok(
      c.okT && c.okB,
      `缩放 ${(app.view.zoom * 100).toFixed(0)}% 时，光线未延伸到上下屏幕边缘 ` +
        `（可见 y ∈ [${b.min.y.toFixed(1)}, ${b.max.y.toFixed(1)}]）`,
    );
  }

  // 平移后同样成立（追踪范围已随可见范围扩展）
  app.panViewBy(-400, 200);
  win.tick(2);
  const c = coversViewport();
  assert.ok(c.okR && c.okB, "平移后光线仍应延伸到屏幕边缘");
  app.resetView();
  win.tick(2);
});

test("元件移动后追踪范围随之扩展（相机无关）", () => {
  app.applyPreset(SCENE_PRESETS[0]!);
  app.resetView();
  win.tick(2);
  app.selectElement(state.elements[0]!.id);
  // 把元件移到很远的地方：追踪范围应跟着扩展（否则光线会在老范围里被截断）
  app.update((s) => {
    const t = s.elements[0]!;
    t.pos = { x: 26, y: 0 };
  });
  win.tick(2);
  assert.equal(state.elements[0]!.pos.x, 26);
  const snapshot = app.segmentsSnapshot();
  assert.ok(snapshot.length > 0, "移动后仍应有线段");
  // 有线段越过原来的窗口右边界（默认 8 + 6 余量 = 14），说明范围已重新计算
  const maxX = Math.max(...snapshot.map((s) => Math.max(s.ax, s.bx)));
  assert.ok(maxX > 14, `追踪范围应随元件外移而扩展，实际最大 x = ${maxX.toFixed(1)}`);
});

test("所有数值都可以直接输入（点击数值框输入精确值）", () => {
  app.applyPreset(SCENE_PRESETS[1]!); // 棱镜色散：选中棱镜
  app.selectElement(state.elements[0]!.id);
  win.tick(1);
  const inputs = panel.all().filter((n) => hasClass(n, "num-input"));
  assert.ok(inputs.length > 5, `面板里应有多组可输入数值框，实际 ${inputs.length}`);
  // 找到「折射率 n_d」那一格：它旁边有对应标签
  const cells = panel.all().filter((n) => hasClass(n, "num-cell"));
  const nCell = cells.find((c) => c.textContent.includes("折射率"));
  assert.ok(nCell, "找不到折射率输入格");
  const nInput = nCell!.all().find((n) => hasClass(n, "num-input"))!;
  assert.ok(nInput, "折射率格应有可输入数值框");
  // 直接输入 1.9 并回车
  nInput.value = "1.9";
  nInput.dispatch("change");
  win.tick(1);
  assert.ok(
    Math.abs(state.elements[0]!.material.n - 1.9) < 1e-9,
    `输入 1.9 后折射率应为 1.9，实际 ${state.elements[0]!.material.n}`,
  );
  // 数值框不再被滑杆刻度夹紧：超出滑杆范围（n_d 滑杆是 1~2.6）也照样接受。
  // 只有显式声明了硬边界的字段（「分辨率」）才会被夹紧。
  nInput.value = "99";
  nInput.dispatch("change");
  win.tick(1);
  assert.equal(state.elements[0]!.material.n, 99, "折射率应接受滑杆范围外的输入");
  // 复位，避免影响后续用例
  nInput.value = "1.5168";
  nInput.dispatch("change");
  win.tick(1);
  // 非法输入应保持原值
  const before = state.elements[0]!.material.n;
  nInput.value = "abc";
  nInput.dispatch("change");
  assert.equal(state.elements[0]!.material.n, before, "非法输入不应改动数值");
});

test("光源更容易选中：命中半径明显大于标记点，且随尺寸设置变大", () => {
  app.applyPreset(SCENE_PRESETS[0]!);
  app.resetView();
  win.tick(2);
  const src = state.sources[0]!;
  app.selectElement(null);
  app.selectSource(null);

  // 在标记点右下方偏 10 CSS 像素处按下，应能选中光源
  const px = app.view.pixelsPerUnit;
  const offsetWorld = 10 / px;
  const p = app.view.toScreen({ x: src.pos.x + offsetWorld, y: src.pos.y });
  canvasNode.dispatch("pointerdown", { clientX: p.x, clientY: p.y, button: 0 });
  canvasNode.dispatch("pointerup", { clientX: p.x, clientY: p.y });
  assert.equal(state.selectedSourceId, src.id, "距标记 10px 处也应能选中光源");

  // 放大标记后，命中半径更大：偏移 18px 处也能选中
  app.update((s) => {
    const t = s.sources[0]!;
    t.size = 2.5;
  });
  app.selectElement(null);
  app.selectSource(null);
  const p2 = app.view.toScreen({ x: src.pos.x + 18 / px, y: src.pos.y });
  canvasNode.dispatch("pointerdown", { clientX: p2.x, clientY: p2.y, button: 0 });
  canvasNode.dispatch("pointerup", { clientX: p2.x, clientY: p2.y });
  assert.equal(state.selectedSourceId, src.id, "放大标记后 18px 处也应能选中");
});

test("光源可放大缩小：面板提供「标记大小」与放大/缩小按钮", () => {
  app.applyPreset(SCENE_PRESETS[0]!);
  app.selectSource(state.sources[0]!.id);
  win.tick(1);
  const labels = panel.all().map((n) => n.textContent).join("|");
  assert.ok(labels.includes("标记大小"), "光源参数里应有「标记大小」");
  const btns = panel.all().filter((n) => hasClass(n, "btn"));
  const zoomIn = btns.find((b) => b.textContent === "放大光源");
  const zoomOut = btns.find((b) => b.textContent === "缩小光源");
  assert.ok(zoomIn && zoomOut, "应有放大光源 / 缩小光源按钮");
  const before = state.sources[0]!.size;
  zoomIn!.click();
  assert.ok(state.sources[0]!.size > before, `点放大后尺寸应变大：${before} → ${state.sources[0]!.size}`);
  zoomOut!.click();
  zoomOut!.click();
  assert.ok(state.sources[0]!.size < before, "连点两次缩小后尺寸应小于初始值");
  // 尺寸不影响物理：光线数量与线段数应保持不变
  const segsBefore = app.segmentsSnapshot().length;
  app.update((s) => {
    s.sources[0]!.size = 4;
  });
  win.tick(2);
  assert.equal(app.segmentsSnapshot().length, segsBefore, "标记大小只影响显示，不应改变光路");
  app.update((s) => {
    s.sources[0]!.size = 1;
  });
});

test("键盘删除可以移除选中元件", () => {
  const count = state.elements.length;
  app.selectElement(state.elements[0]!.id);
  app.deleteSelected();
  assert.equal(state.elements.length, count - 1);
  win.tick(1);
});

test("撤销 / 重做可恢复元件数量", () => {
  const before = state.elements.length;
  app.addElement("rect");
  assert.equal(state.elements.length, before + 1);
  app.undo();
  assert.equal(state.elements.length, before);
  app.redo();
  assert.equal(state.elements.length, before + 1);
  app.undo();
  win.tick(1);
});

/* --------------------------------------------------------------- 参数面板 */

test("修改折射率会改变面板与光路（色散介入）", () => {
  app.applyPreset(SCENE_PRESETS[1]!); // 棱镜色散
  app.state.selectedElementId = app.state.elements[0]!.id;
  app.update((s) => {
    const el = s.elements[0]!;
    el.material = { n: 2.2, abbe: 20 };
  });
  win.tick(2);
  assert.equal(state.elements[0]!.material.n, 2.2);
  assert.ok(Number(statSegments.textContent) > 0);
});

test("多束光 / 复色光参数能生效", () => {
  app.applyPreset(SCENE_PRESETS[2]!); // 多束平行光
  const src = state.sources[0]!;
  app.update((s) => {
    const t = s.sources[0]!;
    t.beamCount = 6;
    t.rayCount = 2;
    t.mode = "point";
    t.spread = 40;
  });
  win.tick(2);
  assert.equal(src.beamCount, 6);
  assert.ok(Number(statSegments.textContent) > 10);
});

test("添加元件 / 光源：类型与材质可独立设置", () => {
  for (const kind of ["biconcave", "meniscus", "plate", "polygon", "triangle"] as const) {
    app.addElement(kind);
    const last = state.elements[state.elements.length - 1]!;
    assert.equal(last.kind, kind);
  }
  const n = state.sources.length;
  app.addSource();
  assert.equal(state.sources.length, n + 1);
  win.tick(2);
});

test("渲染参数（曝光/光晕/分辨率）可调且不报错", () => {
  app.update((s) => {
    s.render.exposure = 2.4;
    s.render.bloom = 0.9;
    s.render.quality = 0.5;
    s.render.showNormals = true;
    s.render.showGrid = true;
  });
  win.tick(2);
  assert.ok(Number(statSegments.textContent) > 0);
});

test("曝光/光晕/线宽可以手输任意值（不受滑杆刻度限制），分辨率保留硬边界", () => {
  const cellOf = (label: string): StubNode => {
    const cell = panel
      .all()
      .find((n) => hasClass(n, "num-cell") && n.textContent.includes(label));
    assert.ok(cell, `找不到「${label}」数值格`);
    return cell!;
  };
  const sliderOf = (label: string): StubNode => {
    const slider = cellOf(label)
      .all()
      .find((n) => n.tagName === "INPUT" && !hasClass(n, "num-input"));
    assert.ok(slider, `「${label}」应有滑杆`);
    return slider!;
  };
  const inputOf = (label: string): StubNode => {
    const input = cellOf(label)
      .all()
      .find((n) => hasClass(n, "num-input"));
    assert.ok(input, `「${label}」应有可输入数值框`);
    return input!;
  };
  const sliderMax = (label: string): number => Number(sliderOf(label).max);

  // 手输超出滑杆范围的数值：必须原样生效，且**不会**被夹到滑杆的端点值
  const exposureMax = sliderMax("曝光");
  const exposure = inputOf("曝光");
  exposure.value = String(exposureMax + 21);
  exposure.dispatch("change");
  assert.equal(
    state.render.exposure,
    exposureMax + 21,
    `曝光应接受滑杆范围外的数值，实际 ${state.render.exposure}`,
  );
  // 触发一次面板 refresh（拖拽/滑杆都会走这条路）：数值不能被改回去
  app.update(() => {}, { history: false });
  win.tick(2);
  assert.equal(
    state.render.exposure,
    exposureMax + 21,
    `refresh 之后曝光仍应是手输的数值，实际 ${state.render.exposure}`,
  );
  assert.equal(
    inputOf("曝光").value,
    (exposureMax + 21).toFixed(2),
    "数值框不应被滑杆的端点值覆盖",
  );
  // 滑杆固定在自身范围上：超出范围时滑块停在端点，数值本身不受影响
  assert.equal(Number(sliderOf("曝光").value), exposureMax, "滑杆应停在自身上限，而不是被撑大");

  const lineWidth = inputOf("线宽");
  lineWidth.value = String(sliderMax("线宽") + 14.5);
  lineWidth.dispatch("change");
  assert.equal(state.render.lineWidth, sliderMax("线宽") + 14.5, "线宽应接受滑杆范围外的数值");

  // 分辨率有硬边界：它决定缓冲尺寸，填太大容易把页面撑死
  const quality = inputOf("分辨率");
  quality.value = "900";
  quality.dispatch("change");
  assert.equal(state.render.quality, 2, `分辨率应被夹到 200%，实际 ${state.render.quality}`);
  const quality2 = inputOf("分辨率");
  quality2.value = "0.0001";
  quality2.dispatch("change");
  assert.equal(state.render.quality, 0.1, `分辨率应被夹到 10%，实际 ${state.render.quality}`);

  // 非法输入不应改动数值
  const exposure2 = inputOf("曝光");
  const before = state.render.exposure;
  exposure2.value = "abc";
  exposure2.dispatch("change");
  assert.equal(state.render.exposure, before, "非法输入不应改动数值");

  // 滑杆本身仍能正常拖动：拖动后状态、数值框、滑块三处一致
  const slider = sliderOf("曝光");
  slider.value = "2";
  slider.dispatch("input");
  assert.equal(state.render.exposure, 2, "拖动滑杆应正常生效");
  assert.equal(inputOf("曝光").value, "2.00", "拖动滑杆后数值框应同步");

  // 收尾：恢复成默认值，避免影响后续用例
  app.update((s) => {
    s.render.exposure = 4;
    s.render.lineWidth = 3;
    s.render.quality = 1;
  });
  win.tick(2);
});

test("大场景不会失控：高密度复色光仍在安全上限内", () => {
  app.applyPreset(SCENE_PRESETS[7]!); // 水滴彩虹
  app.update((s) => {
    s.sources[0]!.rayCount = 21;
    s.sources[0]!.spectrum = {
      kind: "continuous",
      samples: 25,
      lambdaMin: 400,
      lambdaMax: 700,
      lambda: 550,
    };
  });
  win.tick(2);
  const segs = Number(statSegments.textContent);
  assert.ok(segs > 100, `应产生大量线段，实际 ${segs}`);
  assert.ok(segs <= state.trace.maxSegments, "线段数不得超过安全上限");
});

console.log(`\n${passed}/${passed + failed} 通过${failed ? `，${failed} 失败` : ""}`);
if (failed > 0) process.exitCode = 1;

