/**
 * 零依赖静态服务器。
 *
 * 浏览器按 ES module 直接加载 .ts 源码，依赖 V8 的原生 TypeScript 类型剥离
 * （Chrome/Edge 111+ 已默认启用）。因此本项目无需任何构建步骤与第三方依赖。
 *
 *   node server.mjs [--port 5180] [--host 127.0.0.1]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(argValue("--port", process.env.PORT ?? 5180));
const HOST = argValue("--host", "127.0.0.1");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  // 关键：TS 必须以 JS 的 MIME 返回，浏览器才会当作模块执行
  ".ts": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

/** 防目录穿越：解析后必须仍在 ROOT 之内。 */
function safeJoin(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const asRel = normalize(decoded).replace(/^([/\\])+/, "");
  const full = join(ROOT, asRel);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

const server = createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  let target = safeJoin(req.url ?? "/");
  if (!target) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    let info = await stat(target);
    if (info.isDirectory()) {
      target = join(target, "index.html");
      info = await stat(target);
    }
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
      "content-length": body.byteLength,
      "cache-control": "no-store, must-revalidate",
      // 源码直出，彻底禁用缓存：否则改完代码刷新页面可能还拿到旧版本
      "x-content-type-options": "nosniff",
    });
    if (req.method === "HEAD") res.end();
    else res.end(body);
  } catch (err) {
    const code = err && err.code === "ENOENT" ? 404 : 500;
    res.writeHead(code, { "content-type": "text/plain; charset=utf-8" });
    res.end(code === 404 ? `404 Not Found: ${req.url}` : `500 ${String(err)}`);
  }
});

/** 端口被占用时给出可操作的提示，而不是甩一段堆栈。 */
server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`\n[启动失败] 端口 ${PORT} 已被占用（EADDRINUSE）。\n`);
    console.error("这通常是因为已经有一个服务器在运行 —— 先试试直接在浏览器打开：");
    console.error(`  http://${HOST}:${PORT}/\n`);
    console.error("如果你想再起一个，换一个端口即可：");
    console.error(`  node server.mjs --port 5200\n`);
    console.error("如果确实需要释放该端口，可以查出占用进程并结束它（Windows）：");
    console.error(`  netstat -ano | findstr :${PORT}`);
    console.error("  taskkill /PID <上面查到的PID> /F\n");
    process.exitCode = 1;
  } else {
    console.error("[启动失败]", err);
    process.exitCode = 1;
  }
});

server.listen(PORT, HOST, () => {
  console.log(`光学折射实验室 → http://${HOST}:${PORT}/`);
  console.log(`静态根目录: ${ROOT}`);
});
