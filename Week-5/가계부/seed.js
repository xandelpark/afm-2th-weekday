// 스키마 생성 + 샘플 데이터 주입 스크립트
// 실행: node seed.js

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SEED = [
  { type: "income",  date: "2026-04-01", amount: 3200000, category: "급여",      memo: "4월 월급" },
  { type: "expense", date: "2026-04-02", amount:  850000, category: "주거",      memo: "월세" },
  { type: "expense", date: "2026-04-03", amount:   14900, category: "구독료",    memo: "넷플릭스" },
  { type: "expense", date: "2026-04-03", amount:   13000, category: "구독료",    memo: "유튜브 프리미엄" },
  { type: "expense", date: "2026-04-04", amount:   28400, category: "식비",      memo: "장보기 - 이마트" },
  { type: "expense", date: "2026-04-05", amount:   12500, category: "식비",      memo: "점심 - 샤브샤브" },
  { type: "expense", date: "2026-04-06", amount:    4500, category: "교통",      memo: "지하철" },
  { type: "expense", date: "2026-04-07", amount:   45000, category: "문화/여가", memo: "영화+저녁" },
  { type: "expense", date: "2026-04-09", amount:  100000, category: "경조사",    memo: "친구 결혼식 축의금" },
  { type: "income",  date: "2026-04-10", amount:  150000, category: "부수입",    memo: "중고거래" },
  { type: "expense", date: "2026-04-12", amount:   32000, category: "식비",      memo: "배달의민족" },
  { type: "expense", date: "2026-04-14", amount:   67800, category: "쇼핑",      memo: "유니클로" },
  { type: "expense", date: "2026-04-15", amount:   25000, category: "의료",      memo: "감기 진료" },
  { type: "expense", date: "2026-04-17", amount:    7900, category: "구독료",    memo: "ChatGPT Plus" },
  { type: "expense", date: "2026-04-18", amount:    9500, category: "교통",      memo: "택시" },
  { type: "income",  date: "2026-04-20", amount:   50000, category: "용돈",      memo: "부모님 용돈" },
  { type: "expense", date: "2026-04-21", amount:    8900, category: "식비",      memo: "점심 - 김밥천국" },
];

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await pool.query(sql);
    console.log("✅ schema.sql 적용 완료");

    const { rows: [{ count }] } = await pool.query("SELECT COUNT(*)::int AS count FROM ledger.entries");
    if (count > 0) {
      console.log(`ℹ️  이미 ${count}건이 존재합니다. 기존 데이터 삭제 후 재주입합니다.`);
      await pool.query("TRUNCATE ledger.entries RESTART IDENTITY");
    }

    for (const e of SEED) {
      await pool.query(
        `INSERT INTO ledger.entries (type, entry_date, amount, category, memo)
         VALUES ($1, $2, $3, $4, $5)`,
        [e.type, e.date, e.amount, e.category, e.memo]
      );
    }
    console.log(`✅ 샘플 데이터 ${SEED.length}건 주입 완료`);

    const { rows } = await pool.query(`
      SELECT type, COUNT(*)::int AS cnt, SUM(amount)::bigint AS sum
      FROM ledger.entries GROUP BY type ORDER BY type
    `);
    console.log("📊 현재 상태:");
    rows.forEach((r) => console.log(`   ${r.type}: ${r.cnt}건, 합계 ${Number(r.sum).toLocaleString("ko-KR")}원`));
  } catch (err) {
    console.error("❌ 에러:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
