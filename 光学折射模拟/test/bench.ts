/** 场景基准：统计各预设的线段数与追踪耗时（用于 README 与性能回归）。 */
import { SCENE_PRESETS } from "../src/scene.ts";
import { DEFAULT_TRACE_OPTIONS, traceScene } from "../src/core/trace.ts";

const world = { min: { x: -9, y: -4.5 }, max: { x: 9, y: 4.5 } };
console.log("场景".padEnd(16), "线段".padStart(8), "求交".padStart(9), "耗时".padStart(10));
for (const preset of SCENE_PRESETS) {
  const { elements, sources } = preset.build();
  // 预热一次，减少 JIT 抖动
  traceScene(sources, elements, world, DEFAULT_TRACE_OPTIONS);
  const runs: number[] = [];
  let segs = 0;
  let traced = 0;
  for (let i = 0; i < 5; i++) {
    const r = traceScene(sources, elements, world, DEFAULT_TRACE_OPTIONS);
    runs.push(r.stats.ms);
    segs = r.stats.segments;
    traced = r.stats.traced;
  }
  const best = Math.min(...runs);
  console.log(
    preset.label.padEnd(16),
    String(segs).padStart(8),
    String(traced).padStart(9),
    `${best.toFixed(2)} ms`.padStart(10),
  );
}
