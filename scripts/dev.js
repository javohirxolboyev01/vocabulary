// web/ papkasini http://localhost:3000 da ochadi (paket o'rnatish shart emas).
// Ishga tushirish: npm run dev
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");

const WEB_DIR = path.join(__dirname, "..", "web");
const PORT = Number(process.env.PORT ?? 3000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.normalize(path.join(WEB_DIR, urlPath === "/" ? "index.html" : urlPath));
  // ../ orqali web/ papkasidan tashqariga chiqishni oldini olamiz
  if (!file.startsWith(WEB_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(404).end("Topilmadi");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(content);
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Ilova: ${url}  (to'xtatish: Ctrl+C)`);
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${opener} ${url}`);
});
