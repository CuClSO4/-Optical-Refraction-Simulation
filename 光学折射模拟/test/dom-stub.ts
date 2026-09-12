/**
 * 极简 DOM 打桩：让「零依赖、无构建」的前端代码可以在 Node 里跑一遍
 * （见 test/app.smoke.ts）。只实现本项目真正用到的 API。
 */

export interface StubNode {
  tagName: string;
  children: StubNode[];
  parentNode: StubNode | null;
  ownerDocument?: StubDocument;
  textContent: string;
  className: string;
  style: Record<string, string> & {
    setProperty: (k: string, v: string) => void;
    cssText?: string;
  };
  dataset: Record<string, string>;
  listeners: Map<string, ((ev: unknown) => void)[]>;
  append: (...nodes: (StubNode | string)[]) => void;
  replaceChildren: (...nodes: (StubNode | string)[]) => void;
  remove: () => void;
  addEventListener: (type: string, fn: (ev: unknown) => void, opts?: unknown) => void;
  removeEventListener: (type: string, fn: (ev: unknown) => void) => void;
  setPointerCapture: (id?: number) => void;
  releasePointerCapture: (id?: number) => void;
  /** 属性表（SVG / dataset 之类会用到） */
  attributes: Record<string, string>;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  innerHTML: string;
  classList: {
    add: (...names: string[]) => void;
    remove: (...names: string[]) => void;
    toggle: (name: string) => boolean;
    contains: (name: string) => boolean;
  };
  getBoundingClientRect: () => {
    x: number;
    y: number;
    width: number;
    height: number;
    left: number;
    top: number;
  };
  dispatch: (type: string, ev?: Record<string, unknown>) => void;
  click: () => void;
  /** 递归收集所有后代（含自身） */
  all: () => StubNode[];
  find: (predicate: (n: StubNode) => boolean) => StubNode | undefined;
}

let nodeCount = 0;

export function createNode(tagName: string): StubNode {
  nodeCount++;
  const props: Record<string, unknown> = {};
  const listeners = new Map<string, ((ev: unknown) => void)[]>();
  // installDom() 会把 document 挂到 globalThis 上；节点默认取它作为 ownerDocument
  const gDoc = (globalThis as unknown as { document?: StubDocument }).document;

  const node = {
    tagName: tagName.toUpperCase(),
    children: [] as StubNode[],
    parentNode: null as StubNode | null,
    ownerDocument: gDoc,
    className: "",
    className: "",
    id: "",
    type: "",
    value: "",
    checked: false,
    min: "",
    max: "",
    step: "",
    title: "",
    open: false,
    width: 1280,
    height: 720,
    href: "",
    download: "",
    dataset: {},
    listeners,
  } as unknown as StubNode & Record<string, unknown>;

  const style = {
    setProperty: (k: string, v: string): void => {
      (style as unknown as Record<string, string>)[k] = v;
    },
  } as StubNode["style"];
  node.style = style;

  const appendChild = (child: StubNode | string): void => {
    if (typeof child === "string") {
      const text = createNode("#text");
      text.textContent = child;
      text.parentNode = node;
      node.children.push(text);
    } else {
      child.parentNode = node;
      node.children.push(child);
    }
  };

  node.append = (...nodes: (StubNode | string)[]): void => {
    for (const n of nodes) appendChild(n);
  };
  node.getRootNode = (): StubNode => {
    let cur = node as StubNode;
    while (cur.parentNode) cur = cur.parentNode;
    return cur;
  };
  node.replaceChildren = (...nodes: (StubNode | string)[]): void => {
    node.children.length = 0;
    node.textContent = "";
    for (const n of nodes) appendChild(n);
  };
  node.remove = (): void => {
    const parent = node.parentNode;
    if (!parent) return;
    const i = parent.children.indexOf(node as StubNode);
    if (i >= 0) parent.children.splice(i, 1);
  };
  node.addEventListener = (type: string, fn: (ev: unknown) => void): void => {
    const list = listeners.get(type) ?? [];
    list.push(fn);
    listeners.set(type, list);
  };
  node.removeEventListener = (type: string, fn: (ev: unknown) => void): void => {
    const list = listeners.get(type) ?? [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  node.setPointerCapture = (): void => {};
  node.releasePointerCapture = (): void => {};
  const attributes: Record<string, string> = {};
  node.attributes = attributes;
  node.setAttribute = (name: string, value: string): void => {
    attributes[name] = String(value);
  };
  node.getAttribute = (name: string): string | null => attributes[name] ?? null;
  node.innerHTML = "";
  // 以 className 为唯一数据源：UI 里有些地方是直接给 className 赋值的，
  // 若再单独维护一个 Set，两边就会不一致（早期版本踩过）。
  const classListOf = (): string[] => node.className.split(/\s+/).filter(Boolean);
  const setClasses = (list: string[]): void => {
    node.className = [...new Set(list)].join(" ");
  };
  node.classList = {
    add: (...names: string[]): void => {
      setClasses([...classListOf(), ...names]);
    },
    remove: (...names: string[]): void => {
      setClasses(classListOf().filter((c) => !names.includes(c)));
    },
    toggle: (name: string, force?: boolean): boolean => {
      // 与真实 DOM 一致：给了 force 就按它增删，不再取反。
      // （早期打桩忽略 force，UI 里 `toggle(cls, cond)` 会误删 class，测试跟着一起错。）
      const on = force === undefined ? !classListOf().includes(name) : force;
      setClasses(on ? [...classListOf(), name] : classListOf().filter((c) => c !== name));
      return on;
    },
    contains: (name: string): boolean => classListOf().includes(name),
  };
  node.getBoundingClientRect = (): {
    x: number;
    y: number;
    width: number;
    height: number;
    left: number;
    top: number;
  } => ({ x: 0, y: 0, width: 1280, height: 720, left: 0, top: 0 });
  node.dispatch = (type: string, ev: Record<string, unknown> = {}): void => {
    const payload = {
      type,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      deltaY: 0,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: (): void => {},
      target: node,
      ...ev,
    };
    for (const fn of listeners.get(type) ?? []) fn(payload);
  };
  node.click = (): void => node.dispatch("click");
  node.all = (): StubNode[] => {
    const out: StubNode[] = [node as StubNode];
    for (const c of node.children) out.push(...c.all());
    return out;
  };
  node.find = (predicate: (n: StubNode) => boolean): StubNode | undefined =>
    node.all().find(predicate);

  Object.assign(node, props);

  // textContent 与真实 DOM 一致：读取时汇总所有后代文本，写入时替换为纯文本节点。
  // （早期版本把它当普通字段，父节点读不到子节点文本，测试断言会误判。）
  let ownText = "";
  const isTextNode = (): boolean => node.tagName === "#TEXT";
  Object.defineProperty(node, "textContent", {
    get(): string {
      if (isTextNode()) return ownText;
      let out = "";
      for (const c of node.children) out += c.textContent;
      return out;
    },
    set(value: string): void {
      const str = String(value ?? "");
      if (isTextNode()) {
        ownText = str;
        return;
      }
      node.children.length = 0;
      if (str !== "") {
        const text = createNode("#text");
        text.textContent = str;
        node.children.push(text);
      }
    },
    configurable: true,
  });

  return node as StubNode;
}

/* ------------------------------------------------------------ 画布上下文 */

const CTX_METHODS = [
  "setTransform",
  "save",
  "restore",
  "beginPath",
  "closePath",
  "moveTo",
  "lineTo",
  "arc",
  "arcTo",
  "fill",
  "stroke",
  "fillRect",
  "strokeRect",
  "clearRect",
  "drawImage",
  "measureText",
  "createLinearGradient",
  "createRadialGradient",
  "setLineDash",
  "scale",
  "translate",
  "rotate",
  "clip",
  "fillText",
  "strokeText",
  "ellipse",
  "quadraticCurveTo",
  "bezierCurveTo",
  "rect",
] as const;

export function createContext(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {
    canvas: null,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    strokeStyle: "#000",
    fillStyle: "#000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    shadowColor: "transparent",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    filter: "none",
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
  };
  for (const m of CTX_METHODS) {
    if (m === "measureText") {
      ctx[m] = (text: string) => ({ width: String(text).length * 7 });
    } else if (m === "createLinearGradient" || m === "createRadialGradient") {
      ctx[m] = () => ({ addColorStop: (): void => {} });
    } else {
      ctx[m] = (): void => {};
    }
  }
  return ctx as unknown as CanvasRenderingContext2D;
}

/* --------------------------------------------------------------- 安装全局 */

export interface StubWindow {
  devicePixelRatio: number;
  addEventListener: (type: string, fn: (ev: unknown) => void) => void;
  dispatch: (type: string, ev?: Record<string, unknown>) => void;
  requestAnimationFrame: (cb: (t: number) => void) => number;
  setTimeout: (cb: () => void, ms?: number) => number;
  clearTimeout: (id?: number) => void;
  ResizeObserver: new (cb: () => void) => { observe: (t: unknown) => void; disconnect: () => void };
  document: StubDocument;
  /** 手动驱动一帧 */
  tick: (count?: number) => void;
  frames: number;
}

export interface StubDocument {
  body: StubNode;
  /** 模拟浏览器：文档已就绪，boot.ts 会立即启动应用 */
  readyState: string;
  createElement: (tag: string) => StubNode;
  createElementNS: (ns: string, tag: string) => StubNode;
  getElementById: (id: string) => StubNode | null;
  querySelector: (sel: string) => StubNode | null;
  append: (...nodes: (StubNode | string)[]) => void;
  root: StubNode;
  ids: Map<string, StubNode>;
}

export function installDom(): StubWindow {
  const root = createNode("div");
  const ids = new Map<string, StubNode>();
  const rafQueue: ((t: number) => void)[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;

  const doc: StubDocument = {
    body: createNode("body"),
    readyState: "complete",
    root,
    ids,
    createElement: (tag: string): StubNode => {
      const node = createNode(tag);
      if (tag.toLowerCase() === "canvas") {
        (node as unknown as { getContext: () => CanvasRenderingContext2D }).getContext = () =>
          createContext();
      }
      return node;
    },
    createElementNS: (_ns: string, tag: string): StubNode => doc.createElement(tag),
    getElementById: (id: string): StubNode | null => ids.get(id) ?? null,
    querySelector: (): StubNode | null => null,
    append: (...nodes: (StubNode | string)[]): void => root.append(...nodes),
  };

  const win = {
    devicePixelRatio: 2,
    document: doc,
    frames: 0,
    addEventListener: (): void => {},
    dispatch: (): void => {},
    requestAnimationFrame: (cb: (t: number) => void): number => {
      rafQueue.push(cb);
      return rafQueue.length;
    },
    setTimeout: (cb: () => void): number => {
      timerId++;
      timers.set(timerId, cb);
      return timerId;
    },
    clearTimeout: (id?: number): void => {
      if (id !== undefined) timers.delete(id);
    },
    ResizeObserver: class {
      constructor(_cb: () => void) {}
      observe(): void {}
      disconnect(): void {}
    },
    tick: (count = 1): void => {
      const g = globalThis as unknown as { frames: number };
      for (let i = 0; i < count; i++) {
        const queue = rafQueue.splice(0, rafQueue.length);
        g.frames++;
        for (const cb of queue) cb(g.frames * 16.7);
      }
      const due = [...timers.entries()];
      timers.clear();
      for (const [, cb] of due) cb();
    },
  };

  const g0 = globalThis as unknown as { frames: number };
  g0.frames = 0;
  (win as unknown as { frames: number }).frames = 0;

  (win as unknown as { performance: unknown }).performance = performance;

  // 只在 lib.dom 下才存在的全局名，直接挂到 globalThis 上
  const g = globalThis as unknown as Record<string, unknown>;
  const winListeners = new Map<string, ((ev: unknown) => void)[]>();
  g.document = doc;
  g.ownerDocument = doc;
  g.requestAnimationFrame = win.requestAnimationFrame;
  g.cancelAnimationFrame = (): void => {};
  g.ResizeObserver = win.ResizeObserver;
  g.devicePixelRatio = win.devicePixelRatio;
  g.HTMLCanvasElement = class {};
  g.Element = class {};
  g.getComputedStyle = () => ({ getPropertyValue: () => "" });
  g.addEventListener = (type: string, fn: (ev: unknown) => void): void => {
    const list = winListeners.get(type) ?? [];
    list.push(fn);
    winListeners.set(type, list);
  };
  g.removeEventListener = (): void => {};
  // 浏览器里 window === globalThis：这里保持一致，
  // 这样 `window.document`、`window.setTimeout` 都能正常工作
  g.window = g;
  g.tick = win.tick;
  g.frames = 0;
  /** 派发 window 级事件（如 keydown），供测试使用 */
  g.dispatchWindowEvent = (type: string, ev: Record<string, unknown> = {}): void => {
    const payload = {
      type,
      key: "",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      target: null,
      preventDefault: (): void => {},
      ...ev,
    };
    for (const fn of winListeners.get(type) ?? []) fn(payload);
  };

  // 注册 index.html 里的固定 id
  for (const id of [
    "view",
    "panel",
    "library",
    "crash",
    "stat-rays",
    "stat-segments",
    "stat-traced",
    "stat-frame",
  ]) {
    const node = doc.createElement(id === "view" ? "canvas" : id === "crash" ? "pre" : "div");
    (node as unknown as { id: string }).id = id;
    // index.html 里 #crash 带 hidden 属性，初始是隐藏的
    (node as unknown as { hidden: boolean }).hidden = id === "crash";
    ids.set(id, node);
    root.append(node);
  }

  return win;
}

export { nodeCount };
