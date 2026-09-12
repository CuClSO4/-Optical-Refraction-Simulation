/**
 * 场景模型与预设：元件工厂、光源工厂、若干可一键切换的光学场景。
 */

import { defaultPolygonPoints } from "./core/geometry.js";
 
import { v } from "./core/math2d.js";

 

let idSeed = 0;
const nextId = (prefix )  => `${prefix}-${(++idSeed).toString(36)}`;

/* -------------------------------------------------------------- 材料预设 */

export const MATERIALS  = [
  { key: "bk7", label: "BK7 冕牌玻璃", n: 1.5168, abbe: 64.17 },
  { key: "f2", label: "F2 火石玻璃", n: 1.62, abbe: 36.4 },
  { key: "sf11", label: "SF11 重火石", n: 1.7847, abbe: 25.68 },
  { key: "acrylic", label: "亚克力 PMMA", n: 1.4917, abbe: 57.4 },
  { key: "water", label: "水", n: 1.333, abbe: 55.7 },
  { key: "sapphire", label: "蓝宝石", n: 1.77, abbe: 72.2 },
  { key: "diamond", label: "金刚石", n: 2.417, abbe: 55 },
  { key: "custom", label: "自定义", n: 1.5, abbe: 64 },
];

/** 高度色散的教学材料：阿贝数很小，彩虹张角明显。 */
export const HIGH_DISPERSION  = { n: 1.72, abbe: 18 };

/**
 * 色散用玻璃：n_d = 1.6、V_d = 22（比 F2 更“火石”）。
 * 选这个数值是因为要同时满足两个条件：
 *  · 色散大（n_F − n_C 大）→ 彩虹扇面张得开；
 *  · 折射率不能太高，否则 60° 棱镜第二个面会直接全反射，根本出不了光。
 */
export const DISPERSION_GLASS  = { n: 1.6, abbe: 22 };

/* ------------------------------------------------------------ 元件工厂 */

export function makeElement(kind , pos , material )  {
  const id = nextId(kind);
  const base = { id, kind, pos, rot: 0, material: { ...material }, visible: true };

  switch (kind) {
    case "biconvex":
      return {
        ...base,
        kind,
        label: "双凸透镜",
        height: 1.8,
        centerThickness: 0.42,
        sagFront: 0.28,
        sagBack: 0.28,
      };
    case "planoconvex":
      return {
        ...base,
        kind,
        label: "平凸透镜",
        height: 1.8,
        centerThickness: 0.5,
        sagFront: 0.42,
        sagBack: 0,
      };
    case "biconcave":
      return {
        ...base,
        kind,
        label: "双凹透镜",
        height: 1.7,
        centerThickness: 0.28,
        sagFront: 0.5,
        sagBack: 0.5,
      };
    case "meniscus":
      return {
        ...base,
        kind,
        label: "弯月透镜",
        height: 1.7,
        centerThickness: 0.34,
        sagFront: 0.5,
        sagBack: 0.3,
      };
    case "prism":
      return { ...base, kind, label: "三棱镜", apexAngle: 60, size: 3.1 };
    case "plate":
      return { ...base, kind, label: "玻璃板", halfWidth: 1.5, halfHeight: 1.5 };
    case "triangle":
      return { ...base, kind, label: "三角形", points: [] };
    case "rect":
      return { ...base, kind, label: "矩形", points: [] };
    case "polygon":
      return { ...base, kind, label: "自定义多边形", points: defaultPolygonPoints(1.35) };
  }
}

export const ELEMENT_KIND_LABELS  = [
  { kind: "biconvex", label: "双凸透镜" },
  { kind: "planoconvex", label: "平凸透镜" },
  { kind: "biconcave", label: "双凹透镜" },
  { kind: "meniscus", label: "弯月透镜" },
  { kind: "prism", label: "三棱镜" },
  { kind: "plate", label: "玻璃板" },
  { kind: "triangle", label: "正三角形" },
  { kind: "rect", label: "矩形" },
  { kind: "polygon", label: "自定义多边形" },
];

/* ------------------------------------------------------------ 光源工厂 */

export function makeSource(overrides  = {})  {
  return {
    id: nextId("src"),
    label: "光束",
    enabled: true,
    pos: v(-6.2, 0),
    angle: 0,
    mode: "collimated",
    beamWidth: 2.6,
    rayCount: 5,
    spread: 0,
    beamCount: 1,
    beamTint: 0,
    size: 1,
    spectrum: {
      kind: "continuous",
      samples: 1,
      lambdaMin: 380,
      lambdaMax: 780,
      lambda: 589.3,
    },
    ...overrides,
  };
}

/** 常见光谱预设。 */
export const SPECTRUM_PRESETS 



 = [
  {
    key: "mono",
    label: "单色（可调波长）",
    build: () => ({
      kind: "continuous",
      samples: 1,
      lambdaMin: 380,
      lambdaMax: 780,
      lambda: 632.8,
    }),
  },
  {
    key: "white7",
    label: "连续白光（7 色采样）",
    build: () => ({
      kind: "continuous",
      samples: 7,
      lambdaMin: 400,
      lambdaMax: 700,
      lambda: 550,
    }),
  },
  {
    key: "white15",
    label: "连续白光（15 色采样）",
    build: () => ({
      kind: "continuous",
      samples: 15,
      lambdaMin: 390,
      lambdaMax: 730,
      lambda: 550,
    }),
  },
  {
    key: "mercury",
    label: "汞灯（谱线）",
    build: () => ({
      kind: "discrete",
      lines: [
        { lambda: 404.7, weight: 0.5 },
        { lambda: 435.8, weight: 0.8 },
        { lambda: 546.1, weight: 1 },
        { lambda: 577.0, weight: 0.7 },
        { lambda: 579.1, weight: 0.7 },
      ],
    }),
  },
  {
    key: "sodium",
    label: "钠灯（D 双线）",
    build: () => ({
      kind: "discrete",
      lines: [
        { lambda: 589.0, weight: 1 },
        { lambda: 589.6, weight: 1 },
      ],
    }),
  },
  {
    key: "hydrogen",
    label: "氢灯（巴耳末线）",
    build: () => ({
      kind: "discrete",
      lines: [
        { lambda: 656.3, weight: 1 },
        { lambda: 486.1, weight: 0.7 },
        { lambda: 434.0, weight: 0.5 },
        { lambda: 410.2, weight: 0.35 },
      ],
    }),
  },
];

/* --------------------------------------------------------------- 场景预设 */

 






export const SCENE_PRESETS  = [
  {
    key: "convex-focus",
    label: "凸透镜聚焦",
    hint: "平行单色光经双凸透镜会聚于焦点",
    build: () => ({
      elements: [makeElement("biconvex", v(0, 0), { n: 1.5168, abbe: 64.17 })],
      sources: [
        makeSource({
          pos: v(-7.2, 0),
          beamWidth: 3.2,
          rayCount: 9,
          spectrum: {
            kind: "continuous",
            samples: 1,
            lambdaMin: 380,
            lambdaMax: 780,
            lambda: 532,
          },
        }),
      ],
    }),
  },
  {
    key: "prism-dispersion",
    label: "棱镜色散",
    hint: "白光经三棱镜展开成连续光谱",
    build: () => {
      // 用高色散玻璃（阿贝数 22）让彩虹扇面更明显。
      // 顶角 70° + 顺时针转 12°：白光以约 33° 入射左面，
      // 出射后向下方展开约 10°，在画面右上形成清晰的红→紫扇形。
      const prism = makeElement("prism", v(0.2, 0), DISPERSION_GLASS);
      if (prism.kind === "prism") {
        prism.apexAngle = 70;
        prism.rot = (-12 * Math.PI) / 180;
      }
      return {
        elements: [prism],
        sources: [
          makeSource({
            pos: v(-7.6, 0),
            beamWidth: 0,
            rayCount: 1,
            spectrum: {
              kind: "continuous",
              samples: 15,
              lambdaMin: 400,
              lambdaMax: 700,
              lambda: 550,
            },
          }),
        ],
      };
    },
  },
  {
    key: "multi-beam",
    label: "多束平行光",
    hint: "5 束平行光入射双凸透镜，展示不同高度的成像",
    build: () => ({
      elements: [makeElement("biconvex", v(1.6, 0), { n: 1.5168, abbe: 64.17 })],
      sources: [
        makeSource({
          pos: v(-7.4, 0),
          beamWidth: 4.4,
          beamCount: 5,
          rayCount: 1,
          mode: "collimated",
          spectrum: {
            kind: "continuous",
            samples: 1,
            lambdaMin: 380,
            lambdaMax: 780,
            lambda: 589.3,
          },
        }),
      ],
    }),
  },
  {
    key: "plano-convex",
    label: "平凸透镜色差",
    hint: "复色平行光经平凸透镜，不同颜色焦点位置不同（色差）",
    build: () => ({
      elements: [makeElement("planoconvex", v(0, 0), { n: 1.62, abbe: 36.4 })],
      sources: [
        makeSource({
          pos: v(-7.2, 0),
          beamWidth: 2.6,
          rayCount: 5,
          spectrum: {
            kind: "continuous",
            samples: 9,
            lambdaMin: 400,
            lambdaMax: 700,
            lambda: 550,
          },
        }),
      ],
    }),
  },
  {
    key: "concave-diverge",
    label: "双凹透镜发散",
    hint: "平行光经双凹透镜后发散，反向延长线交于虚焦点",
    build: () => ({
      elements: [makeElement("biconcave", v(0, 0), { n: 1.5168, abbe: 64.17 })],
      sources: [
        makeSource({
          pos: v(-7.2, 0),
          beamWidth: 2.2,
          rayCount: 7,
          spectrum: {
            kind: "continuous",
            samples: 1,
            lambdaMin: 380,
            lambdaMax: 780,
            lambda: 589.3,
          },
        }),
      ],
    }),
  },
  {
    key: "total-reflection",
    label: "全反射演示",
    hint: "入射角 75° > 临界角 34.1°，玻璃板上表面把光完全反射回去",
    build: () => ({
      elements: [
        {
          ...(makeElement("plate", v(0, 0), { n: 1.7847, abbe: 25.68 })),
          halfWidth: 1.4,
          halfHeight: 2.4,
        },
      ],
      sources: [
        makeSource({
          // 以 75° 入射左表面（临界角只有 34.1°，所以这里很容易发生全反射）：
          // 折射角 33.2° → 射到上表面时入射角 56.8° > 34.1° → 全反射折返射出
          pos: v(-2.4, -2.45),
          angle: 75 * (Math.PI / 180),
          beamWidth: 0,
          rayCount: 1,
          spectrum: {
            kind: "continuous",
            samples: 1,
            lambdaMin: 380,
            lambdaMax: 780,
            lambda: 632.8,
          },
        }),
      ],
    }),
  },
  {
    key: "multi-color-beams",
    label: "三色分束",
    hint: "复色光被拆成多束，每束带不同波长偏移",
    build: () => ({
      elements: [makeElement("biconvex", v(1.4, 0), { n: 1.62, abbe: 36.4 })],
      sources: [
        makeSource({
          pos: v(-7.4, 0),
          beamWidth: 4.6,
          beamCount: 3,
          rayCount: 1,
          beamTint: 90,
          spectrum: {
            kind: "continuous",
            samples: 5,
            lambdaMin: 420,
            lambdaMax: 680,
            lambda: 550,
          },
        }),
      ],
    }),
  },
  {
    key: "water-drop",
    label: "水滴彩虹",
    hint: "白光射入圆形水珠，内部一次反射后出射形成彩虹",
    build: () => ({
      elements: [
        {
          ...(makeElement("polygon", v(1.2, 0), { n: 1.333, abbe: 55.7 })),
          points: circlePoints(1.9, 64),
          label: "水珠",
        },
      ],
      sources: [
        makeSource({
          pos: v(-7.2, 0.55),
          angle: 0,
          beamWidth: 0,
          rayCount: 1,
          spectrum: {
            kind: "continuous",
            samples: 15,
            lambdaMin: 400,
            lambdaMax: 700,
            lambda: 550,
          },
        }),
      ],
    }),
  },
];

/** 生成圆形多边形顶点（近似水珠/圆柱透镜）。 */
export function circlePoints(radius , segments )  {
  const pts  = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pts.push(v(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  return pts;
}

/** 默认场景：凸透镜聚焦。 */
export function defaultScene()  {
  return SCENE_PRESETS[0] .build();
}

/** 深拷贝（含嵌套数组），用于历史快照。 */
export function cloneScene(elements , sources ) 


 {
  return {
    elements: JSON.parse(JSON.stringify(elements))  ,
    sources: JSON.parse(JSON.stringify(sources))  ,
  };
}
