// shopping 스키마 생성
// 실행: node seed.js

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await pool.query(sql);
    console.log("✅ schema.sql 적용 완료");

    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM shopping.users) AS users,
        (SELECT COUNT(*)::int FROM shopping.cart_items) AS cart_items
    `);
    console.log(`📊 현재 상태: users=${rows[0].users}, cart_items=${rows[0].cart_items}`);
  } catch (e) {
    console.error("❌ 에러:", e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
