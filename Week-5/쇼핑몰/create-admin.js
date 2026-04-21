// 슈퍼 관리자 계정 생성/갱신 + Supabase 대시보드 노출 권한 부여
// 실행: node create-admin.js [username] [password]
// 기본값: admin / admin1234

require("dotenv").config();
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const USERNAME = process.argv[2] || "admin";
const PASSWORD = process.argv[3] || "admin1234";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    // 1. is_admin 컬럼 없으면 추가 (향후 관리자 기능 대비)
    await pool.query(`
      ALTER TABLE shopping.users
        ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log("✅ is_admin 컬럼 확인/추가 완료");

    // 2. 관리자 계정 upsert
    const hash = await bcrypt.hash(PASSWORD, 10);
    const { rows } = await pool.query(
      `INSERT INTO shopping.users (username, password_hash, is_admin)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             is_admin      = TRUE
       RETURNING id, username, is_admin, created_at`,
      [USERNAME, hash]
    );
    const u = rows[0];
    console.log("✅ 관리자 계정 생성/갱신");
    console.log(`   id:       ${u.id}`);
    console.log(`   username: ${u.username}`);
    console.log(`   password: ${PASSWORD}  ← 로그인 시 사용`);
    console.log(`   is_admin: ${u.is_admin}`);

    // 3. Supabase Dashboard Table Editor 및 API에서 shopping 스키마가
    //    authenticated/anon 사용자에게 보이도록 권한 부여
    await pool.query(`
      GRANT USAGE ON SCHEMA shopping TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shopping
        TO authenticated, service_role;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shopping
        TO authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA shopping
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA shopping
        GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
    `);
    console.log("✅ shopping 스키마 권한 부여 완료 (authenticated/service_role)");

    // 4. 현재 상태 요약
    const { rows: stats } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM shopping.users) AS users,
        (SELECT COUNT(*)::int FROM shopping.users WHERE is_admin) AS admins,
        (SELECT COUNT(*)::int FROM shopping.cart_items) AS cart_items
    `);
    console.log("\n📊 현재 상태:", stats[0]);
  } catch (e) {
    console.error("❌ 에러:", e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
