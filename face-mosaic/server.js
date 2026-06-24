// face-mosaic 정적 서버 — File System Access API는 secure context가 필요하므로
// http://localhost 로 서빙한다 (localhost는 secure context로 취급됨).
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3011;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(ROOT, rel);

  // 디렉토리 탈출 방지
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 — 파일을 찾을 수 없습니다");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`face-mosaic 실행 중 → http://localhost:${PORT}`);
  console.log("Chrome · Edge · Arc 에서 위 주소를 열어주세요.");
});
