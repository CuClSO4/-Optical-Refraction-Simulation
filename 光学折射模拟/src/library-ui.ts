/**
 * 左侧「元器件库」：一级分类 Tab + 二级分类 + 图标卡片网格。
 *
 * 参考 NB 化学实验室的取用区交互：
 *  · 顶部三个一级分类：实验仪器 / 光源 / 画布；
 *  · 仪器与光源下面再分二级分类（透镜、棱镜与多面体、玻璃体、单色光源、复色光源）；
 *  · 每个元器件是一张带示意图形的卡片，点击即加入画布中心并在右侧弹出属性菜单。
 */

import { LIBRARY_TABS, type LibraryTab, type LibraryTemplate } from "./library.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface LibraryCallbacks {
  /** 点击元器件卡片：加入画布 / 应用机位操作。 */
  pick: (tpl: LibraryTemplate) => void;
  /** 重绘整个库（切换分类后调用）。 */
  redraw: () => void;
  /** 画布机位 */
  viewReset: () => void;
  viewFit: () => void;
  viewZoom: (factor: number) => void;
  /** 滚轮行为模式 */
  setWheelMode: (mode: "zoom" | "element") => void;
  /** 当前滚轮模式（用于高亮按钮） */
  wheelMode: () => "zoom" | "element";
}

export class Library {
  private readonly root: HTMLElement;
  private readonly cb: LibraryCallbacks;
  private activeTabKey = "instruments";

  constructor(host: HTMLElement, callbacks: LibraryCallbacks) {
    this.root = host;
    this.cb = callbacks;
  }

  /** 当前选中的一级分类（供测试与调试）。 */
  get activeTab(): string {
    return this.activeTabKey;
  }

  rebuild(): void {
    const host = this.root;
    host.replaceChildren();
    const doc = host.ownerDocument ?? document;

    host.append(this.buildTabs(doc));

    const tab = LIBRARY_TABS.find((t) => t.key === this.activeTabKey) ?? LIBRARY_TABS[0]!;
    if (tab.key === "view") {
      host.append(...this.buildViewControls(doc));
    } else {
      for (const group of tab.groups) {
        const wrap = doc.createElement("div");
        wrap.className = "lib-group";
        const title = doc.createElement("div");
        title.className = "lib-group-title";
        title.textContent = group.title;
        const grid = doc.createElement("div");
        grid.className = "lib-grid";
        for (const item of group.items) {
          grid.append(this.buildItem(doc, item));
        }
        wrap.append(title, grid);
        host.append(wrap);
      }
    }

    const foot = doc.createElement("p");
    foot.className = "hint-text";
    foot.textContent = "点击卡片即可加入画布中心；选中对象后可在右侧编辑参数。";
    host.append(foot);
  }

  private buildTabs(doc: Document): HTMLElement {
    const wrap = doc.createElement("div");
    wrap.className = "lib-tabs";
    for (const tab of LIBRARY_TABS) {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = `lib-tab${tab.key === this.activeTabKey ? " is-active" : ""}`;
      btn.dataset.tab = tab.key;
      btn.title = tab.label;
      const icon = doc.createElement("span");
      icon.className = "tab-icon";
      icon.textContent = tab.icon;
      const label = doc.createElement("span");
      label.textContent = tab.label;
      btn.append(icon, label);
      btn.addEventListener("click", () => {
        this.activeTabKey = tab.key;
        this.cb.redraw();
      });
      wrap.append(btn);
    }
    return wrap;
  }

  private buildItem(doc: Document, item: LibraryTemplate): HTMLElement {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "lib-item";
    btn.title = item.hint;
    btn.dataset.template = item.key;

    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 30 24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = item.icon;
    const name = doc.createElement("span");
    name.className = "item-name";
    name.textContent = item.name;

    btn.append(svg, name);
    btn.addEventListener("click", () => this.cb.pick(item));
    return btn;
  }

  private buildViewControls(doc: Document): HTMLElement[] {
    const grid = doc.createElement("div");
    grid.className = "view-grid";
    const mk = (label: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "btn btn-ghost";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", fn);
      return b;
    };
    grid.append(
      mk("复位视图", "回到中心 + 100% 缩放", () => this.cb.viewReset()),
      mk("适应场景", "让全部元器件落入视野", () => this.cb.viewFit()),
      mk("放大", "以画布中心放大", () => this.cb.viewZoom(1.25)),
      mk("缩小", "以画布中心缩小", () => this.cb.viewZoom(1 / 1.25)),
    );

    const modeRow = doc.createElement("div");
    modeRow.className = "view-grid";
    modeRow.append(
      mk("缩放模式", "滚轮缩放画布（默认）", () => this.cb.setWheelMode("zoom")),
      mk("元件模式", "滚轮缩放元件尺寸", () => this.cb.setWheelMode("element")),
    );

    const note = doc.createElement("p");
    note.className = "hint-text";
    note.textContent =
      "滚轮模式：缩放模式下滚轮缩放画布，元件模式下滚轮直接缩放元件尺寸（Shift 可临时切换）。";
    return [grid, modeRow, note];
  }
}

export type { LibraryTab };
