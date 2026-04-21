require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = Number(process.env.PORT) || 3002;
const SCHEMA = 'home_recipe';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.recipes (
      id SERIAL PRIMARY KEY,
      ingredients JSONB NOT NULL,
      recipes JSONB NOT NULL,
      raw_response TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log(`DB 테이블 준비 완료 (schema: ${SCHEMA})`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function callOpenAI(ingredients) {
  const prompt = `냉장고에 있는 재료: ${ingredients.join(', ')}

이 재료들로 만들 수 있는 한국 가정식 레시피 3개를 추천해주세요.
반드시 아래 JSON 형식으로만 응답하세요. JSON 외의 텍스트는 절대 포함하지 마세요.

[
  {
    "name": "요리 이름",
    "emoji": "요리를 나타내는 이모지 1개",
    "description": "한 줄 설명",
    "time": "조리시간 (예: 20분)",
    "servings": "인분 (예: 2인분)",
    "difficulty": "쉬움/보통/어려움",
    "ingredients": ["재료1 양", "재료2 양"],
    "steps": ["1단계", "2단계", "3단계"],
    "tip": "요리 팁 한 줄"
  }
]`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '당신은 한국 가정식 요리 전문가입니다. 반드시 유효한 JSON 배열만 응답하세요.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 2000
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function saveRecipe(ingredients, raw) {
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const { rows } = await pool.query(
    `INSERT INTO ${SCHEMA}.recipes (ingredients, recipes, raw_response) VALUES ($1, $2, $3) RETURNING id, created_at`,
    [JSON.stringify(ingredients), JSON.stringify(parsed ?? []), raw]
  );
  return rows[0];
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/recipe') {
    try {
      const body = JSON.parse(await readBody(req));
      const content = await callOpenAI(body.ingredients);
      const saved = await saveRecipe(body.ingredients, content).catch(e => {
        console.error('DB 저장 실패:', e.message);
        return null;
      });
      return json(res, { content, recipeId: saved?.id ?? null });
    } catch (err) {
      console.error('OpenAI 오류:', err.message);
      return json(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'GET' && req.url === '/api/recipes') {
    try {
      const { rows } = await pool.query(
        `SELECT id, ingredients, recipes, created_at FROM ${SCHEMA}.recipes ORDER BY created_at DESC LIMIT 50`
      );
      return json(res, rows);
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  const idMatch = req.url.match(/^\/api\/recipes\/(\d+)$/);
  if (req.method === 'GET' && idMatch) {
    try {
      const { rows } = await pool.query(
        `SELECT id, ingredients, recipes, created_at FROM ${SCHEMA}.recipes WHERE id = $1`,
        [Number(idMatch[1])]
      );
      if (rows.length === 0) return json(res, { error: 'Not found' }, 404);
      return json(res, rows[0]);
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`냉장고 레시피 서버 실행 중: http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('DB 연결 실패:', err.message);
  process.exit(1);
});
