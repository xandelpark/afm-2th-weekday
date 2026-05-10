const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// 데이터 디렉토리 경로
// ========================================
const TODOS_DIR = path.join(__dirname, 'todos');
const JSON_DIR = path.join(TODOS_DIR, 'json');

// ========================================
// 인메모리 데이터 (파일에서 초기 로드)
// ========================================
let todos = [];
let nextId = 1;

function loadTodosFromFiles() {
  try {
    const files = fs.readdirSync(JSON_DIR).filter(f => f.endsWith('.json')).sort();
    todos = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(JSON_DIR, f), 'utf-8'));
      return { id: data.id, title: data.title, done: !!data.done };
    });
    nextId = todos.length > 0 ? Math.max(...todos.map(t => t.id)) + 1 : 1;
  } catch (err) {
    todos = [];
    nextId = 1;
  }
}

function saveTodosToFiles() {
  // json 폴더 동기화
  if (!fs.existsSync(JSON_DIR)) fs.mkdirSync(JSON_DIR, { recursive: true });
  // 기존 json 파일 삭제
  fs.readdirSync(JSON_DIR).filter(f => f.endsWith('.json')).forEach(f => {
    fs.unlinkSync(path.join(JSON_DIR, f));
  });
  // 기존 텍스트 파일 삭제
  fs.readdirSync(TODOS_DIR).filter(f => /^todo\d+$/.test(f)).forEach(f => {
    fs.unlinkSync(path.join(TODOS_DIR, f));
  });
  // 새로 저장
  todos.forEach((todo, i) => {
    const num = i + 1;
    fs.writeFileSync(path.join(JSON_DIR, `todo${num}.json`), JSON.stringify(todo));
    fs.writeFileSync(path.join(TODOS_DIR, `todo${num}`), todo.title);
  });
}

// 서버 시작 시 파일에서 로드
loadTodosFromFiles();

// ========================================
// 미들웨어
// ========================================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'app')));

// ========================================
// API 라우트
// ========================================

// GET /api/todos - 전체 조회
app.get('/api/todos', (_req, res) => {
  res.json({ success: true, data: todos });
});

// GET /api/todos/:id - 단일 조회
app.get('/api/todos/:id', (req, res) => {
  const todo = todos.find(t => t.id === Number(req.params.id));
  if (!todo) return res.status(404).json({ success: false, message: '할 일을 찾을 수 없습니다.' });
  res.json({ success: true, data: todo });
});

// POST /api/todos - 추가
app.post('/api/todos', (req, res) => {
  const { title } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ success: false, message: '할 일 내용을 입력해주세요.' });
  }
  const todo = { id: nextId++, title: title.trim(), done: false };
  todos.push(todo);
  saveTodosToFiles();
  res.status(201).json({ success: true, data: todo });
});

// PATCH /api/todos/:id - 수정 (제목 변경, 완료 토글)
app.patch('/api/todos/:id', (req, res) => {
  const todo = todos.find(t => t.id === Number(req.params.id));
  if (!todo) return res.status(404).json({ success: false, message: '할 일을 찾을 수 없습니다.' });
  if (req.body.title !== undefined) todo.title = req.body.title.trim();
  if (req.body.done !== undefined) todo.done = !!req.body.done;
  saveTodosToFiles();
  res.json({ success: true, data: todo });
});

// DELETE /api/todos/:id - 삭제
app.delete('/api/todos/:id', (req, res) => {
  const idx = todos.findIndex(t => t.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: '할 일을 찾을 수 없습니다.' });
  todos.splice(idx, 1);
  saveTodosToFiles();
  res.json({ success: true, message: '삭제되었습니다.' });
});

// DELETE /api/todos - 완료된 항목 일괄 삭제
app.delete('/api/todos', (_req, res) => {
  const before = todos.length;
  todos = todos.filter(t => !t.done);
  saveTodosToFiles();
  res.json({ success: true, message: `${before - todos.length}개 완료 항목이 삭제되었습니다.` });
});

// ========================================
// 유저 인메모리 데이터
// ========================================
let users = [];
let nextUserId = 1;

// GET /api/users - 전체 조회
app.get('/api/users', (_req, res) => {
  res.json({ success: true, data: users });
});

// GET /api/users/:id - 단일 조회
app.get('/api/users/:id', (req, res) => {
  const user = users.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ success: false, message: '유저를 찾을 수 없습니다.' });
  res.json({ success: true, data: user });
});

// POST /api/users - 추가
app.post('/api/users', (req, res) => {
  const { name, email, role } = req.body;
  if (!name || !name.trim() || !email || !email.trim()) {
    return res.status(400).json({ success: false, message: '이름과 이메일을 입력해주세요.' });
  }
  const user = { id: nextUserId++, name: name.trim(), email: email.trim(), role: role || 'member' };
  users.push(user);
  res.status(201).json({ success: true, data: user });
});

// PATCH /api/users/:id - 수정
app.patch('/api/users/:id', (req, res) => {
  const user = users.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ success: false, message: '유저를 찾을 수 없습니다.' });
  if (req.body.name !== undefined) user.name = req.body.name.trim();
  if (req.body.email !== undefined) user.email = req.body.email.trim();
  if (req.body.role !== undefined) user.role = req.body.role;
  res.json({ success: true, data: user });
});

// DELETE /api/users/:id - 삭제
app.delete('/api/users/:id', (req, res) => {
  const idx = users.findIndex(u => u.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: '유저를 찾을 수 없습니다.' });
  users.splice(idx, 1);
  res.json({ success: true, message: '삭제되었습니다.' });
});

// ========================================
// SPA fallback
// ========================================
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'index.html'));
});

// ========================================
// 서버 시작
// ========================================
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
module.exports = app;
