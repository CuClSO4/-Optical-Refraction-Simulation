/**
 * 元器件库：左侧「取用区」的数据来源。
 *
 * 设计参考 NB 化学实验室：左侧按一级分类（实验仪器 / 光源 / 画布机位）分栏，
 * 下面再分二级分类（透镜、棱镜与多面体、玻璃体），每个元器件是一张图标卡片；
 * 点击即把该元器件加到画布中央（视口中心），随后在右侧弹出它的属性菜单。
 */

 
 
import { MATERIALS } from "./scene.js";

 

























 




 






/** 生成透镜示意图形：`lens` 取 1 为凸、−1 为凹；`flat` 表示另一侧为平面。 */
function lensIcon(dir )  {
  const r = 12.5;
  const s = 3.6;
  const bulge = dir * s;
  return `
    <path d="M9 2 A${r} ${r} 0 0 ${dir > 0 ? 1 : 0} 9 22 Z" />
    <path d="M21 2 A${r} ${r} 0 0 ${dir > 0 ? 0 : 1} 21 22 Z" />`;
}

function triangleIcon()  {
  return `<path d="M15 2 L28 22 L2 22 Z" />`;
}

function plateIcon()  {
  return `<rect x="6" y="3" width="18" height="18" rx="1.5" />`;
}

function circleIcon()  {
  return `<circle cx="15" cy="12" r="9.5" />`;
}

function polygonIcon()  {
  return `<path d="M15 2 L26 9.5 L22 22 L8 22 L4 9.5 Z" />`;
}

/** 元器件库定义。 */
export const LIBRARY_TABS  = [
  {
    key: "instruments",
    label: "实验仪器",
    icon: "◈",
    groups: [
      {
        title: "透镜",
        items: [
          {
            key: "biconvex",
            name: "双凸透镜",
            hint: "两侧外凸，平行光会聚（凸透镜）",
            kind: "biconvex",
            icon: lensIcon(1),
          },
          {
            key: "planoconvex",
            name: "平凸透镜",
            hint: "一面平、一面凸，色差演示常用",
            kind: "planoconvex",
            icon: `<path d="M11 2 A13 13 0 0 1 11 22 Z" /><path d="M11 2 L11 22" />`,
          },
          {
            key: "biconcave",
            name: "双凹透镜",
            hint: "两侧内凹，平行光发散（凹透镜）",
            kind: "biconcave",
            icon: lensIcon(-1),
          },
          {
            key: "meniscus",
            name: "弯月透镜",
            hint: "一凸一凹，用于减小像差",
            kind: "meniscus",
            icon: `<path d="M9 2 A13 13 0 0 1 9 22 Z" /><path d="M15 2 A13 13 0 0 0 15 22 Z" />`,
          },
        ],
      },
      {
        title: "棱镜与多面体",
        items: [
          {
            key: "prism",
            name: "三棱镜",
            hint: "等边三棱镜，白光色散（色散成彩虹）",
            kind: "prism",
            icon: triangleIcon(),
          },
          {
            key: "prism-thin",
            name: "薄棱镜",
            hint: "顶角较小的棱镜，偏向角小",
            kind: "prism",
            icon: `<path d="M15 4 L27 20 L3 20 Z" />`,
            overrides: { apexAngle: 30, size: 3.2 },
          },
          {
            key: "triangle",
            name: "正三角形",
            hint: "等边三角玻璃体（全反射演示）",
            kind: "triangle",
            icon: triangleIcon(),
          },
          {
            key: "rect",
            name: "矩形玻璃",
            hint: "矩形玻璃体",
            kind: "rect",
            icon: plateIcon(),
          },
          {
            key: "polygon",
            name: "自定义多边形",
            hint: "顶点可拖动编辑，例如做成水珠",
            kind: "polygon",
            icon: polygonIcon(),
          },
          {
            key: "circle",
            name: "圆形水珠",
            hint: "圆形玻璃体（水滴彩虹）",
            kind: "polygon",
            icon: circleIcon(),
            materialKey: "water",
            overrides: { label: "圆形水珠" },
          },
        ],
      },
      {
        title: "玻璃体",
        items: [
          {
            key: "plate",
            name: "玻璃板",
            hint: "平行平板，出射光与入射光平行",
            kind: "plate",
            icon: plateIcon(),
          },
          {
            key: "slab-tall",
            name: "高玻璃砖",
            hint: "细长玻璃砖，容易发生全反射",
            kind: "plate",
            icon: `<rect x="11" y="1.5" width="8" height="21" rx="1" />`,
            materialKey: "sf11",
            overrides: { halfWidth: 1.2, halfHeight: 3.4 },
          },
          {
            key: "sf11-block",
            name: "重火石方块",
            hint: "n=1.785 的强折射方块",
            kind: "rect",
            icon: `<rect x="5" y="4" width="20" height="16" rx="1.5" />`,
            materialKey: "sf11",
            overrides: { label: "重火石方块" },
          },
          {
            key: "diamond",
            name: "棱形宝石",
            hint: "n=2.417（金刚石），临界角很小",
            kind: "polygon",
            icon: `<path d="M15 2 L27 12 L15 22 L3 12 Z" />`,
            materialKey: "diamond",
            overrides: { label: "宝石" },
          },
        ],
      },
    ],
  },
  {
    key: "lights",
    label: "光源",
    icon: "☀",
    groups: [
      {
        title: "单色光源",
        items: [
          {
            key: "laser-red",
            name: "红色激光",
            hint: "632.8nm 单束激光",
            kind: "source",
            icon: `<circle cx="8" cy="12" r="3" /><path d="M11 12 L28 12" stroke-dasharray="3 2" />`,
            source: { preset: "mono", lambda: 632.8 },
          },
          {
            key: "laser-green",
            name: "绿色激光",
            hint: "532nm 单束激光",
            kind: "source",
            icon: `<circle cx="8" cy="12" r="3" /><path d="M11 12 L28 12" stroke-dasharray="3 2" />`,
            source: { preset: "mono", lambda: 532 },
          },
          {
            key: "laser-violet",
            name: "紫色激光",
            hint: "405nm 单束激光",
            kind: "source",
            icon: `<circle cx="8" cy="12" r="3" /><path d="M11 12 L28 12" stroke-dasharray="3 2" />`,
            source: { preset: "mono", lambda: 405 },
          },
        ],
      },
      {
        title: "复色光源",
        items: [
          {
            key: "white-fan",
            name: "白光扇形光",
            hint: "连续白光（15 色），适合看色散",
            kind: "source",
            icon: `<path d="M6 12 L28 4 M6 12 L28 12 M6 12 L28 20" />`,
            source: { preset: "white15" },
          },
          {
            key: "point-fan",
            name: "点光源",
            hint: "同一发射点、角度展开的复色点光源",
            kind: "source",
            icon: `<circle cx="6" cy="12" r="2.4" /><path d="M8 12 L28 3 M8 12 L28 12 M8 12 L28 21" />`,
            source: { preset: "white7", mode: "point", spread: 50, rayCount: 9 },
          },
          {
            key: "parallel-multi",
            name: "多束平行光",
            hint: "5 束平行单色光",
            kind: "source",
            icon: `<path d="M4 6 H28 M4 12 H28 M4 18 H28" />`,
            source: { preset: "mono", beamCount: 5, rayCount: 1, beamWidth: 4.5 },
          },
          {
            key: "mercury",
            name: "汞灯",
            hint: "5 条离散谱线的汞灯",
            kind: "source",
            icon: `<path d="M6 12 L28 6 M6 12 L28 10 M6 12 L28 14 M6 12 L28 18" />`,
            source: { preset: "mercury" },
          },
        ],
      },
    ],
  },
  {
    key: "view",
    label: "画布",
    icon: "⎚",
    groups: [],
  },
];

/** 取某个模板的材质。 */
export function templateMaterial(tpl )  {
  if (!tpl.materialKey) return null;
  const m = MATERIALS.find((x) => x.key === tpl.materialKey);
  return m ? { n: m.n, abbe: m.abbe } : null;
}

/** 模板是否为光源（光源不是「光学元件」，而是 LightSource）。 */
export function templateIsSource(tpl )  {
  return tpl.kind === "source";
}

 
