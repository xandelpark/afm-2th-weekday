// filmcamera_shop 스키마 + 시드 데이터 주입
// 실행: node seed.js (여러 번 실행해도 안전 — 멱등)

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || "").trim(),
});

// index.html 의 PRODUCTS 배열과 동일 (정적 카피 — 한 번 주입 후 DB가 정본이 됨)
const SEED_PRODUCTS = [
  {
    id: 1, image: "images/camera-1.jpg",
    brand: "Leica", name: "M6 TTL", year: 1998,
    format: "35mm 레인지파인더", condition: "A+급", stock: 2,
    price: 3800000, badge: "BEST",
    description:
      "라이카의 클래식 레인지파인더. 수동 노출계 TTL 탑재, 크롬 마감. 초점이 빠르고 셔터음이 조용해 스트리트 포토의 왕자로 불립니다.",
    specs: {
      포맷: "35mm",
      셔터: "1s ~ 1/1000s + B",
      무게: "560g",
      마운트: "Leica M",
      뷰파인더: "0.85× / 0.72× / 0.58× 선택",
      노출계: "TTL 중앙중점",
    },
  },
  {
    id: 2, image: "images/camera-2.jpg",
    brand: "Canon", name: "AE-1 Program", year: 1981,
    format: "35mm SLR", condition: "B급", stock: 5,
    price: 320000, badge: null,
    description:
      "70~80년대를 풍미한 혁신의 아이콘. 프로그램 AE 모드 탑재로 입문자에게 부담 없이 필름 맛을 경험하기 좋습니다. 50mm f/1.8 렌즈 포함.",
    specs: {
      포맷: "35mm",
      셔터: "2s ~ 1/1000s",
      무게: "590g",
      마운트: "Canon FD",
      렌즈: "FD 50mm f/1.8 기본 포함",
      노출: "Programmed AE · 셔터우선 AE · 수동",
    },
  },
  {
    id: 3, image: "images/camera-3.jpg",
    brand: "Nikon", name: "FM2", year: 1984,
    format: "35mm 기계식 SLR", condition: "A급", stock: 3,
    price: 780000, badge: "NEW",
    description:
      "배터리 없이도 셔터가 동작하는 완전 기계식 바디. 1/4000s 고속 셔터로 보도 사진가들의 믿을 만한 서브 바디였죠.",
    specs: {
      포맷: "35mm",
      셔터: "1s ~ 1/4000s",
      무게: "540g",
      마운트: "Nikon F",
      싱크: "1/250s",
      뷰파인더: "93% / 0.86×",
    },
  },
  {
    id: 4, image: "images/camera-4.jpg",
    brand: "Olympus", name: "OM-1", year: 1972,
    format: "35mm 소형 SLR", condition: "A급", stock: 1,
    price: 520000, badge: "RARE",
    description:
      "\"세상에서 가장 작은 풀프레임 SLR\". Maitani Yoshihisa의 절제된 디자인 미학이 녹아있는 걸작.",
    specs: {
      포맷: "35mm",
      셔터: "1s ~ 1/1000s",
      무게: "510g",
      마운트: "Olympus OM",
      특징: "미러 쇽 저감 설계",
      배터리: "PX625 (수은→SR44 변환)",
    },
  },
  {
    id: 5, image: "images/camera-5.jpg",
    brand: "Rolleiflex", name: "2.8F Planar", year: 1965,
    format: "6×6 중형 TLR", condition: "A-급", stock: 1,
    price: 2400000, badge: "RARE",
    description:
      "독일 장인정신이 깃든 전설의 이안반사 중형 카메라. Carl Zeiss Planar 80mm f/2.8 렌즈의 3차원적 묘사력은 지금도 회자됩니다.",
    specs: {
      포맷: "6×6 중형 (120 필름)",
      셔터: "1s ~ 1/500s + B",
      무게: "1,280g",
      렌즈: "Carl Zeiss Planar 80mm f/2.8 고정",
      뷰파인더: "웨이스트레벨 (WLF)",
      필름: "120 / 220",
    },
  },
  {
    id: 6, image: "images/camera-6.jpg",
    brand: "Pentax", name: "K1000", year: 1980,
    format: "35mm SLR", condition: "B+급", stock: 8,
    price: 180000, badge: null,
    description:
      "필름 사진 입문의 교과서. 단순하고 튼튼한 기계식 SLR로 수많은 사진 학생을 길러낸 베스트셀러.",
    specs: {
      포맷: "35mm",
      셔터: "1s ~ 1/1000s",
      무게: "620g",
      마운트: "Pentax K",
      노출계: "TTL 중앙중점",
      특징: "배터리 없이 셔터 동작 가능",
    },
  },
];

// 기본 계정
const SEED_USERS = [
  {
    email: "admin@filmlab.co.kr",
    password: "admin1234",
    name: "슈퍼관리자",
    role: "superadmin",
  },
  {
    email: "customer@test.co.kr",
    password: "test1234",
    name: "테스트 고객",
    role: "customer",
  },
];

(async () => {
  const client = await pool.connect();
  try {
    // 1) 스키마 적용
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await client.query(sql);
    console.log("✅ schema.sql 적용 완료");

    // 2) 상품 재주입 (멱등: truncate 후 고정 id 로 재삽입)
    await client.query("BEGIN");
    // orders 가 products 를 직접 참조하지 않으므로 products 만 truncate 하면 충분
    await client.query(
      "TRUNCATE TABLE filmcamera_shop.products RESTART IDENTITY"
    );
    for (const p of SEED_PRODUCTS) {
      await client.query(
        `INSERT INTO filmcamera_shop.products
           (id, brand, name, year, format, condition, stock, price, badge, image, description, specs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          p.id,
          p.brand,
          p.name,
          p.year,
          p.format,
          p.condition,
          p.stock,
          p.price,
          p.badge,
          p.image,
          p.description,
          JSON.stringify(p.specs),
        ]
      );
    }
    // 시퀀스를 최대 id+1 로 맞춤 (다음 insert 시 충돌 방지)
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('filmcamera_shop.products', 'id'),
        COALESCE((SELECT MAX(id) FROM filmcamera_shop.products), 1),
        true
      )
    `);
    await client.query("COMMIT");
    console.log(`✅ products 재주입 완료 (${SEED_PRODUCTS.length}건)`);

    // 3) 기본 계정 upsert (멱등)
    for (const u of SEED_USERS) {
      const hash = await bcrypt.hash(u.password, 10);
      await client.query(
        `INSERT INTO filmcamera_shop.users (email, password_hash, name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           name          = EXCLUDED.name,
           role          = EXCLUDED.role`,
        [u.email, hash, u.name, u.role]
      );
      console.log(`   · 계정 upsert: ${u.email} (${u.role})`);
    }
    console.log("✅ 기본 계정 주입 완료");

    // 4) 현재 상태 출력
    const { rows } = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM filmcamera_shop.users)    AS users,
        (SELECT COUNT(*)::int FROM filmcamera_shop.products) AS products,
        (SELECT COUNT(*)::int FROM filmcamera_shop.orders)   AS orders
    `);
    console.log(
      `📊 현재 상태: users=${rows[0].users}, products=${rows[0].products}, orders=${rows[0].orders}`
    );
    console.log("");
    console.log("🔐 로그인 정보");
    console.log("   슈퍼관리자: admin@filmlab.co.kr / admin1234");
    console.log("   테스트 고객: customer@test.co.kr / test1234");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    console.error("❌ seed 실패:", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
