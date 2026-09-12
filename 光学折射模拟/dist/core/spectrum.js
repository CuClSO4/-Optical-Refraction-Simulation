/**
 * 光谱工具：波长 → 线性 RGB 近似、Cauchy/Abbe 色散模型。
 *
 * 说明：波长 → RGB 使用 Dan Bruton 的经典分段近似，在可见光范围内
 * 给出视觉上合理的连续色带（紫→蓝→青→绿→黄→红）。
 */

 

/** 可见光谱范围（nm）—— 380~780 为国际照明委员会定义的可见区。 */
export const VISIBLE_MIN = 380;
export const VISIBLE_MAX = 780;

/** 常用参考波长（nm）：d 线为折射率 n_d 的标准参考。 */
export const LAMBDA_REF  = {
  d: 587.5618, // 氦 d 线
  F: 486.1327, // 氢 F 线（蓝）
  C: 656.2725, // 氢 C 线（红）
  e: 546.074, // 汞 e 线
  g: 435.8343, // 汞 g 线（紫）
};

/**
 * 波长（nm）→ 线性 RGB，各分量 ∈ [0,1]。
 * 强度做了端点衰减，避免 380/780nm 附近出现硬边。
 */
export function wavelengthToLinearRGB(lambda )  {
  let r = 0;
  let g = 0;
  let b = 0;
  const l = lambda;

  if (l >= 380 && l < 440) {
    r = -(l - 440) / (440 - 380);
    b = 1;
  } else if (l < 490) {
    g = (l - 440) / (490 - 440);
    b = 1;
  } else if (l < 510) {
    g = 1;
    b = -(l - 510) / (510 - 490);
  } else if (l < 580) {
    r = (l - 510) / (580 - 510);
    g = 1;
  } else if (l < 645) {
    r = 1;
    g = -(l - 645) / (645 - 580);
  } else if (l <= 780) {
    r = 1;
  } else {
    // 红外：给一个暗红色的可视化提示
    r = 0.55;
  }

  // 视见函数近似的端点衰减
  let fall = 1;
  if (l >= 380 && l < 420) fall = 0.3 + (0.7 * (l - 380)) / 40;
  else if (l > 700 && l <= 780) fall = 0.3 + (0.7 * (780 - l)) / 80;
  else if (l > 780) fall = 0.25;

  return { x: r * fall, y: g * fall, z: b * fall };
}

/**
 * Cauchy 色散模型：
 *   n(λ) = n_d + B · (1/λ² − 1/λ_d²)
 * 其中 B 由阿贝数导出：
 *   V_d = (n_d − 1) / (n_F − n_C)
 *   n_F − n_C = B · (1/λ_F² − 1/λ_C²)
 * 于是 B = (n_d − 1) / (V_d · (1/λ_F² − 1/λ_C²))。
 *
 * 因此阿贝数越小（火石玻璃），色散越强；V_d → ∞ 时无色散。
 */
export function cauchyB(nD , abbe )  {
  if (!Number.isFinite(abbe) || abbe <= 0) return 0;
  const inv = (l )  => 1 / (l * l);
  const delta = inv(LAMBDA_REF.F) - inv(LAMBDA_REF.C);
  return (nD - 1) / (abbe * delta);
}

/** 给定 n_d 与阿贝数，求某波长下的折射率（下限 1）。 */
export function refractiveIndexAt(nD , abbe , lambda )  {
  const b = cauchyB(nD, abbe);
  if (b === 0) return nD;
  const inv = (l )  => 1 / (l * l);
  const n = nD + b * (inv(lambda) - inv(LAMBDA_REF.d));
  return Math.max(1, n);
}
