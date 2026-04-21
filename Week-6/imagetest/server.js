// 이미지 업로드 테스트 서버 (ImageKit.io 연동)
// [클라이언트] index.html → /api/imagekit-auth 로 서명 요청 → ImageKit upload API 직접 호출

require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3010;

const URL_ENDPOINT = process.env.IMAGEKIT_URL_ENDPOINT;
const PUBLIC_KEY = process.env.IMAGEKIT_PUBLIC_KEY;
const PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY;

if (!PUBLIC_KEY || !PRIVATE_KEY || !URL_ENDPOINT) {
  console.error("⚠️  ImageKit 환경변수가 누락되었습니다. .env 파일을 확인하세요.");
}

app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ImageKit 클라이언트 업로드용 인증 파라미터 생성
// token + expire 를 private key 로 HMAC-SHA1 서명 → 브라우저가 이 값으로 직접 ImageKit 에 업로드
app.get("/api/imagekit-auth", (req, res) => {
  if (!PRIVATE_KEY) {
    return res.status(500).json({ error: "IMAGEKIT_PRIVATE_KEY 환경변수가 설정되지 않았습니다" });
  }
  try {
    const token = crypto.randomUUID();
    const expire = Math.floor(Date.now() / 1000) + 60 * 30; // 30분 유효
    const signature = crypto
      .createHmac("sha1", PRIVATE_KEY)
      .update(token + expire)
      .digest("hex");

    res.json({
      token,
      expire,
      signature,
      publicKey: PUBLIC_KEY,
      urlEndpoint: URL_ENDPOINT,
    });
  } catch (e) {
    console.error("ImageKit 인증 파라미터 생성 실패:", e);
    res.status(500).json({ error: "인증 파라미터 생성 실패" });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ imagetest 서버 실행: http://localhost:${PORT}`);
    console.log(`   ImageKit: ${URL_ENDPOINT || "(미설정)"}`);
  });
}

module.exports = app;
