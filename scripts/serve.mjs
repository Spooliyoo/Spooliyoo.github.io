// Tiny static server for the built app (out/). Usage: node scripts/serve.mjs [dir] [port]
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "out");
const port = Number(process.argv[3] ?? 4173);
const base = (process.env.BASE_PATH ?? "").replace(/\/$/, "");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".data": "application/octet-stream",
  ".map": "application/json",
};

createServer((req, res) => {
  let url = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  if (base) {
    if (!url.startsWith(base)) return res.writeHead(404).end("Not found");
    url = url.slice(base.length) || "/";
  }
  let file = path.join(root, url);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!existsSync(file)) file = path.join(root, "404.html");
  const status = file.endsWith("404.html") && !url.includes("404") ? 404 : 200;
  res.writeHead(status, {
    "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}${base}/`));
