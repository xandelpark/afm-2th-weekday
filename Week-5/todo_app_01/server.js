require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'todo-app-01-secret-key-2026';
const PORT = Number(process.env.PORT) || 3003;
const SCHEMA = 'todo_app_01';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.users (
      id SERIAL PRIMARY KEY,
      email VARCHAR UNIQUE NOT NULL,
      password_hash VARCHAR NOT NULL,
      name VARCHAR NOT NULL,
      role VARCHAR DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE ${SCHEMA}.users ADD COLUMN IF NOT EXISTS role VARCHAR DEFAULT 'user'
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.todos (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES ${SCHEMA}.users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      completed BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const adminEmail = 'admin@todoapp01.local';
  const exists = await pool.query(`SELECT id FROM ${SCHEMA}.users WHERE email = $1`, [adminEmail]);
  if (exists.rows.length === 0) {
    const hashed = await bcrypt.hash('admin1234', 10);
    await pool.query(
      `INSERT INTO ${SCHEMA}.users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)`,
      [adminEmail, hashed, '슈퍼관리자', 'admin']
    );
    console.log('기본 슈퍼관리자 생성: admin@todoapp01.local / admin1234');
  }
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

function getUser(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if (method === 'GET' && (url === '/' || url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  try {
    if (method === 'POST' && url === '/api/signup') {
      const { email, password, name } = JSON.parse(await readBody(req));
      if (!email || !password || !name) return json(res, { error: '모든 항목을 입력하세요' }, 400);
      if (password.length < 4) return json(res, { error: '비밀번호는 4자 이상이어야 합니다' }, 400);

      const exists = await pool.query(`SELECT id FROM ${SCHEMA}.users WHERE email = $1`, [email]);
      if (exists.rows.length > 0) return json(res, { error: '이미 가입된 이메일입니다' }, 409);

      const hashed = await bcrypt.hash(password, 10);
      const { rows } = await pool.query(
        `INSERT INTO ${SCHEMA}.users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, role`,
        [email, hashed, name]
      );
      const token = jwt.sign({ id: rows[0].id, email, name, role: rows[0].role }, JWT_SECRET, { expiresIn: '7d' });
      return json(res, { user: rows[0], token }, 201);
    }

    if (method === 'POST' && url === '/api/login') {
      const { email, password } = JSON.parse(await readBody(req));
      if (!email || !password) return json(res, { error: '이메일과 비밀번호를 입력하세요' }, 400);

      const { rows } = await pool.query(`SELECT * FROM ${SCHEMA}.users WHERE email = $1`, [email]);
      if (rows.length === 0) return json(res, { error: '이메일 또는 비밀번호가 틀렸습니다' }, 401);

      const valid = await bcrypt.compare(password, rows[0].password_hash);
      if (!valid) return json(res, { error: '이메일 또는 비밀번호가 틀렸습니다' }, 401);

      const user = { id: rows[0].id, email: rows[0].email, name: rows[0].name, role: rows[0].role };
      const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
      return json(res, { user, token });
    }

    if (method === 'GET' && url === '/api/me') {
      const user = getUser(req);
      if (!user) return json(res, { error: 'Unauthorized' }, 401);
      const { rows } = await pool.query(`SELECT id, email, name, role FROM ${SCHEMA}.users WHERE id = $1`, [user.id]);
      if (rows.length === 0) return json(res, { error: 'User not found' }, 404);
      return json(res, { user: rows[0] });
    }

    const user = getUser(req);
    if (!user && url.startsWith('/api/todos')) {
      return json(res, { error: 'Unauthorized' }, 401);
    }

    if (method === 'GET' && url === '/api/todos') {
      const { rows } = await pool.query(
        `SELECT * FROM ${SCHEMA}.todos WHERE user_id = $1 ORDER BY created_at DESC`,
        [user.id]
      );
      return json(res, rows);
    }

    if (method === 'POST' && url === '/api/todos') {
      const { text } = JSON.parse(await readBody(req));
      if (!text || !text.trim()) return json(res, { error: '내용을 입력하세요' }, 400);
      const { rows } = await pool.query(
        `INSERT INTO ${SCHEMA}.todos (user_id, text) VALUES ($1, $2) RETURNING *`,
        [user.id, text.trim()]
      );
      return json(res, rows[0], 201);
    }

    const toggleMatch = url.match(/^\/api\/todos\/(\d+)\/toggle$/);
    if (method === 'PATCH' && toggleMatch) {
      await pool.query(
        `UPDATE ${SCHEMA}.todos SET completed = NOT completed WHERE id = $1 AND user_id = $2`,
        [Number(toggleMatch[1]), user.id]
      );
      return json(res, { ok: true });
    }

    const deleteMatch = url.match(/^\/api\/todos\/(\d+)$/);
    if (method === 'DELETE' && deleteMatch) {
      await pool.query(
        `DELETE FROM ${SCHEMA}.todos WHERE id = $1 AND user_id = $2`,
        [Number(deleteMatch[1]), user.id]
      );
      return json(res, { ok: true });
    }

    if (method === 'DELETE' && url === '/api/todos/done') {
      await pool.query(
        `DELETE FROM ${SCHEMA}.todos WHERE completed = true AND user_id = $1`,
        [user.id]
      );
      return json(res, { ok: true });
    }

    if (url.startsWith('/api/admin')) {
      if (!user) return json(res, { error: 'Unauthorized' }, 401);
      const adminCheck = await pool.query(`SELECT role FROM ${SCHEMA}.users WHERE id = $1`, [user.id]);
      if (adminCheck.rows.length === 0 || adminCheck.rows[0].role !== 'admin') {
        return json(res, { error: '관리자 권한이 필요합니다' }, 403);
      }

      if (method === 'GET' && url === '/api/admin/users') {
        const { rows } = await pool.query(
          `SELECT u.id, u.email, u.name, u.role, u.created_at,
                  COUNT(t.id)::int AS todo_count,
                  COUNT(t.id) FILTER (WHERE t.completed)::int AS done_count
           FROM ${SCHEMA}.users u
           LEFT JOIN ${SCHEMA}.todos t ON t.user_id = u.id
           GROUP BY u.id ORDER BY u.created_at DESC`
        );
        return json(res, rows);
      }

      const userTodosMatch = url.match(/^\/api\/admin\/users\/(\d+)\/todos$/);
      if (method === 'GET' && userTodosMatch) {
        const { rows } = await pool.query(
          `SELECT * FROM ${SCHEMA}.todos WHERE user_id = $1 ORDER BY created_at DESC`,
          [Number(userTodosMatch[1])]
        );
        return json(res, rows);
      }

      const deleteUserMatch = url.match(/^\/api\/admin\/users\/(\d+)$/);
      if (method === 'DELETE' && deleteUserMatch) {
        const targetId = Number(deleteUserMatch[1]);
        if (targetId === user.id) return json(res, { error: '자기 자신은 삭제할 수 없습니다' }, 400);
        await pool.query(`DELETE FROM ${SCHEMA}.users WHERE id = $1`, [targetId]);
        return json(res, { ok: true });
      }

      const adminDeleteTodoMatch = url.match(/^\/api\/admin\/todos\/(\d+)$/);
      if (method === 'DELETE' && adminDeleteTodoMatch) {
        await pool.query(`DELETE FROM ${SCHEMA}.todos WHERE id = $1`, [Number(adminDeleteTodoMatch[1])]);
        return json(res, { ok: true });
      }

      if (method === 'GET' && url === '/api/admin/stats') {
        const users = await pool.query(`SELECT COUNT(*)::int AS count FROM ${SCHEMA}.users`);
        const todos = await pool.query(`SELECT COUNT(*)::int AS count FROM ${SCHEMA}.todos`);
        const done = await pool.query(`SELECT COUNT(*)::int AS count FROM ${SCHEMA}.todos WHERE completed = true`);
        return json(res, {
          userCount: users.rows[0].count,
          todoCount: todos.rows[0].count,
          doneCount: done.rows[0].count
        });
      }
    }
  } catch (err) {
    console.error('서버 오류:', err.message);
    return json(res, { error: err.message }, 500);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Todo 서버 실행 중: http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('DB 연결 실패:', err.message);
  process.exit(1);
});
