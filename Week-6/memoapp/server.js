require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3008;
const SCHEMA = 'memoapp';

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.notes (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  dbInitialized = true;
  console.log(`DB 테이블 준비 완료 (schema: ${SCHEMA})`);
}

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('DB init 실패:', err.message);
    res.status(500).json({ success: false, message: 'Database initialization failed' });
  }
});

app.get('/api/notes', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, content, created_at, updated_at
       FROM ${SCHEMA}.notes
       ORDER BY updated_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '메모 목록 조회 실패' });
  }
});

app.get('/api/notes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, content, created_at, updated_at
       FROM ${SCHEMA}.notes WHERE id = $1`,
      [Number(req.params.id)]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '메모를 찾을 수 없습니다' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '메모 조회 실패' });
  }
});

app.post('/api/notes', async (req, res) => {
  try {
    const title = (req.body?.title ?? '').toString().slice(0, 255);
    const content = (req.body?.content ?? '').toString();
    const { rows } = await pool.query(
      `INSERT INTO ${SCHEMA}.notes (title, content) VALUES ($1, $2)
       RETURNING id, title, content, created_at, updated_at`,
      [title, content]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '메모 생성 실패' });
  }
});

app.put('/api/notes/:id', async (req, res) => {
  try {
    const title = (req.body?.title ?? '').toString().slice(0, 255);
    const content = (req.body?.content ?? '').toString();
    const { rows } = await pool.query(
      `UPDATE ${SCHEMA}.notes
       SET title = $1, content = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, title, content, created_at, updated_at`,
      [title, content, Number(req.params.id)]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '메모를 찾을 수 없습니다' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '메모 수정 실패' });
  }
});

app.delete('/api/notes/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ${SCHEMA}.notes WHERE id = $1`,
      [Number(req.params.id)]
    );
    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: '메모를 찾을 수 없습니다' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '메모 삭제 실패' });
  }
});

app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`메모장 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
