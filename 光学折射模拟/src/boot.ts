/**
 * 浏览器入口（唯一有副作用的地方）：启动应用并做「第一帧」自检。
 *
 * 这个文件不包含任何 TypeScript 专有语法，所以 dist/boot.js 与 src/boot.ts
 * 内容一致；index.html 直接加载 dist/boot.js，从而完全不依赖浏览器的
 * 原生 TypeScript 类型剥离能力（Chrome/Edge 111+ 才有的特性）。
 */

import { bootWithSelfCheck } from "./main.ts";

function start(): void {
  try {
    bootWithSelfCheck();
  } catch (err) {
    // 兜底：连启动函数本身都出错时，尽量把信息显示到页面上
    const host = document.getElementById("crash");
    if (host) {
      host.textContent = `⚠ 启动失败：${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
      host.hidden = false;
    }
    console.error(err);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
