/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

/**
 * 类型声明：本项目零依赖，不安装 @types/node。
 * 测试文件用到了 node: 内置模块与少量全局量，这里给出最小可用声明。
 */

declare module "node:assert/strict" {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
};
