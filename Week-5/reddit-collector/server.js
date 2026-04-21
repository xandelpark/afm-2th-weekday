require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const OUTPUT_DIR = path.join(__dirname, "output");
const SCHEMA = "reddit_collector";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.collections (
      id SERIAL PRIMARY KEY,
      kind VARCHAR NOT NULL,
      subreddit VARCHAR,
      query VARCHAR,
      sort VARCHAR,
      post_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.posts (
      id SERIAL PRIMARY KEY,
      collection_id INTEGER REFERENCES ${SCHEMA}.collections(id) ON DELETE CASCADE,
      title TEXT,
      author VARCHAR,
      score INTEGER,
      num_comments INTEGER,
      url TEXT,
      permalink TEXT,
      selftext TEXT,
      subreddit VARCHAR,
      thumbnail TEXT,
      reddit_created TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log(`DB 테이블 준비 완료 (schema: ${SCHEMA})`);
}

async function redditFetch(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "reddit-collector/1.0 (student project)" },
  });
  if (!res.ok) throw new Error(`Reddit API error: ${res.status}`);
  return res.json();
}

async function getSubredditPosts(subreddit, sort = "hot", limit = 25) {
  const data = await redditFetch(
    `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.json?limit=${limit}`
  );
  return data.data.children.map((c) => ({
    title: c.data.title,
    author: c.data.author,
    score: c.data.score,
    numComments: c.data.num_comments,
    url: c.data.url,
    permalink: `https://www.reddit.com${c.data.permalink}`,
    selftext: c.data.selftext?.slice(0, 500) || "",
    created: new Date(c.data.created_utc * 1000).toISOString(),
    thumbnail: c.data.thumbnail,
    subreddit: c.data.subreddit,
  }));
}

async function searchReddit(query, subreddit = "all", sort = "relevance", limit = 25) {
  const sub = encodeURIComponent(subreddit);
  const q = encodeURIComponent(query);
  const data = await redditFetch(
    `https://www.reddit.com/r/${sub}/search.json?q=${q}&sort=${sort}&limit=${limit}&restrict_sr=on`
  );
  return data.data.children.map((c) => ({
    title: c.data.title,
    author: c.data.author,
    score: c.data.score,
    numComments: c.data.num_comments,
    url: c.data.url,
    permalink: `https://www.reddit.com${c.data.permalink}`,
    selftext: c.data.selftext?.slice(0, 500) || "",
    created: new Date(c.data.created_utc * 1000).toISOString(),
    subreddit: c.data.subreddit,
  }));
}

async function getComments(permalink, limit = 20) {
  const cleanPath = permalink.replace("https://www.reddit.com", "");
  const data = await redditFetch(
    `https://www.reddit.com${cleanPath}.json?limit=${limit}`
  );
  if (!data[1]) return [];
  return data[1].data.children
    .filter((c) => c.kind === "t1")
    .map((c) => ({
      author: c.data.author,
      body: c.data.body?.slice(0, 1000) || "",
      score: c.data.score,
      created: new Date(c.data.created_utc * 1000).toISOString(),
    }));
}

async function savePostsToDB({ kind, subreddit, query, sort, posts }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [col] } = await client.query(
      `INSERT INTO ${SCHEMA}.collections (kind, subreddit, query, sort, post_count)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [kind, subreddit || null, query || null, sort || null, posts.length]
    );
    for (const p of posts) {
      await client.query(
        `INSERT INTO ${SCHEMA}.posts
         (collection_id, title, author, score, num_comments, url, permalink, selftext, subreddit, thumbnail, reddit_created)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [col.id, p.title, p.author, p.score, p.numComments, p.url, p.permalink,
         p.selftext, p.subreddit, p.thumbnail || null, p.created]
      );
    }
    await client.query("COMMIT");
    return col.id;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function toCSV(posts) {
  const header = "Title,Author,Score,Comments,Subreddit,URL,Created\n";
  const rows = posts
    .map((p) => {
      const escaped = (s) => `"${String(s).replace(/"/g, '""')}"`;
      return [
        escaped(p.title),
        escaped(p.author),
        p.score,
        p.numComments,
        escaped(p.subreddit),
        escaped(p.permalink || p.url),
        escaped(p.created),
      ].join(",");
    })
    .join("\n");
  return header + rows;
}

function toHTML(posts, title) {
  const rows = posts
    .map(
      (p) => `
    <tr>
      <td><a href="${escapeHtml(p.permalink)}" target="_blank">${escapeHtml(p.title)}</a></td>
      <td>${escapeHtml(p.author)}</td>
      <td>${p.score}</td>
      <td>${p.numComments}</td>
      <td>r/${escapeHtml(p.subreddit)}</td>
      <td>${escapeHtml(p.created?.slice(0, 10))}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#1a1a2e; color:#eee; padding:20px; }
    h1 { color:#ff6b35; margin-bottom:20px; }
    table { width:100%; border-collapse:collapse; }
    th, td { padding:10px 12px; text-align:left; border-bottom:1px solid #333; }
    th { background:#16213e; color:#ff6b35; position:sticky; top:0; }
    tr:hover { background:#16213e; }
    a { color:#4fc3f7; text-decoration:none; }
    a:hover { text-decoration:underline; }
    .meta { color:#888; margin-bottom:16px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">수집 시각: ${new Date().toLocaleString("ko-KR")} | 총 ${posts.length}건</p>
  <table>
    <thead><tr><th>제목</th><th>작성자</th><th>점수</th><th>댓글</th><th>서브레딧</th><th>날짜</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/gallery", express.static(path.join(__dirname, "output")));

app.get("/api/posts", async (req, res) => {
  try {
    const { subreddit = "popular", sort = "hot", limit = 25 } = req.query;
    const posts = await getSubredditPosts(subreddit, sort, Number(limit));
    res.json({ success: true, posts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const { q, subreddit = "all", sort = "relevance", limit = 25 } = req.query;
    if (!q) return res.status(400).json({ success: false, error: "검색어(q)를 입력하세요" });
    const posts = await searchReddit(q, subreddit, sort, Number(limit));
    res.json({ success: true, posts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/comments", async (req, res) => {
  try {
    const { permalink, limit = 20 } = req.query;
    if (!permalink) return res.status(400).json({ success: false, error: "permalink 필요" });
    const comments = await getComments(permalink, Number(limit));
    res.json({ success: true, comments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/save", async (req, res) => {
  try {
    const { posts, kind = "manual", subreddit, query, sort } = req.body;
    if (!Array.isArray(posts) || posts.length === 0) {
      return res.status(400).json({ success: false, error: "저장할 posts가 없습니다" });
    }
    const collectionId = await savePostsToDB({ kind, subreddit, query, sort, posts });
    res.json({ success: true, collectionId, saved: posts.length });
  } catch (err) {
    console.error("DB 저장 오류:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/collections", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, kind, subreddit, query, sort, post_count, created_at
       FROM ${SCHEMA}.collections ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ success: true, collections: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/collections/:id/posts", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${SCHEMA}.posts WHERE collection_id = $1 ORDER BY score DESC`,
      [Number(req.params.id)]
    );
    res.json({ success: true, posts: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/export/csv", (req, res) => {
  const { posts, filename = "reddit-data" } = req.body;
  const csv = toCSV(posts);
  const filePath = path.join(OUTPUT_DIR, `${filename}.csv`);
  fs.writeFileSync(filePath, "\uFEFF" + csv, "utf-8");
  res.download(filePath);
});

app.post("/api/export/html", (req, res) => {
  const { posts, title = "Reddit Report", filename = "reddit-report" } = req.body;
  const html = toHTML(posts, title);
  const filePath = path.join(OUTPUT_DIR, `${filename}.html`);
  fs.writeFileSync(filePath, html, "utf-8");
  res.download(filePath);
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Reddit Collector running at http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error("DB 연결 실패:", err.message);
  process.exit(1);
});
