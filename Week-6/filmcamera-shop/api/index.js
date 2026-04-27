// Vercel Serverless Function entrypoint
// Express 앱(server.js)을 그대로 래핑해 모든 요청(정적 + /api/*)을 처리한다.
module.exports = require("../server.js");
