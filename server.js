const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// --- Database Setup ---
// Vercel Postgres automatically injects POSTGRES_URL into your environment variables
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS issues (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        upvotes INTEGER DEFAULT 0,
        downvotes INTEGER DEFAULT 0,
        status TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        hidden INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        value TEXT NOT NULL UNIQUE
      );
    `);

  
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Failed to initialize database:', err);
  }
}

initDB();

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Admin Auth ---
const ADMIN_USER = 'supieeewupieee';
const ADMIN_PASS = '1.e4c5!2.Nf6d5';

function requireAdmin(req, res, next) {
  const { username, password } = req.headers;
  if (username === ADMIN_USER && password === ADMIN_PASS) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// =================== PUBLIC ROUTES ===================

app.get('/api/categories', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM categories');
  res.json(rows);
});

app.get('/api/issues', async (req, res) => {
  const { category, status } = req.query;
  let query = `
    SELECT i.*, 
      (SELECT COUNT(*) FROM comments c WHERE c.issue_id = i.id AND c.hidden = 0) as comment_count
    FROM issues i
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;

  if (category && category !== 'all') { 
    query += ` AND i.category = $${paramIndex++}`; 
    params.push(category); 
  }
  if (status && status !== 'all') { 
    query += ` AND i.status = $${paramIndex++}`; 
    params.push(status); 
  }
  query += ' ORDER BY i.created_at DESC';
  
  const { rows } = await pool.query(query, params);
  // Postgres returns COUNT as a string, parse it for the frontend
  rows.forEach(r => r.comment_count = parseInt(r.comment_count));
  res.json(rows);
});

app.get('/api/issues/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM issues WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

app.post('/api/issues', async (req, res) => {
  const { title, category, description } = req.body;
  if (!title || !category || !description) return res.status(400).json({ error: 'Missing fields' });
  
  const { rows } = await pool.query(
    'INSERT INTO issues (title, category, description) VALUES ($1, $2, $3) RETURNING id', 
    [title, category, description]
  );
  res.json({ id: rows[0].id, message: 'Issue submitted!' });
});

app.post('/api/issues/:id/vote', async (req, res) => {
  const { type } = req.body;
  if (!['up', 'down'].includes(type)) return res.status(400).json({ error: 'Invalid vote' });
  
  const col = type === 'up' ? 'upvotes' : 'downvotes';
  await pool.query(`UPDATE issues SET ${col} = ${col} + 1 WHERE id = $1`, [req.params.id]);
  
  const { rows } = await pool.query('SELECT upvotes, downvotes FROM issues WHERE id = $1', [req.params.id]);
  res.json(rows[0]);
});

app.get('/api/issues/:id/comments', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM comments WHERE issue_id = $1 AND hidden = 0 ORDER BY created_at ASC', [req.params.id]);
  res.json(rows);
});

app.post('/api/issues/:id/comments', async (req, res) => {
  const { author, body } = req.body;
  if (!author || !body) return res.status(400).json({ error: 'Missing fields' });
  
  const { rows } = await pool.query(
    'INSERT INTO comments (issue_id, author, body) VALUES ($1, $2, $3) RETURNING id', 
    [req.params.id, author, body]
  );
  res.json({ id: rows[0].id, message: 'Comment posted!' });
});

// =================== ADMIN ROUTES ===================

app.patch('/api/admin/issues/:id', requireAdmin, async (req, res) => {
  const { title, description, category } = req.body;
  await pool.query('UPDATE issues SET title = $1, description = $2, category = $3 WHERE id = $4', [title, description, category, req.params.id]);
  res.json({ success: true });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/admin/categories', requireAdmin, async (req, res) => {
  const { name, value } = req.body;
  try {
    await pool.query('INSERT INTO categories (name, value) VALUES ($1, $2)', [name, value]);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: 'Category already exists or invalid' });
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/admin/issues', requireAdmin, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT i.*, (SELECT COUNT(*) FROM comments c WHERE c.issue_id = i.id) as comment_count
    FROM issues i ORDER BY i.created_at DESC
  `);
  rows.forEach(r => r.comment_count = parseInt(r.comment_count));
  res.json(rows);
});

app.patch('/api/admin/issues/:id/votes', requireAdmin, async (req, res) => {
  const { upvotes, downvotes } = req.body;
  await pool.query('UPDATE issues SET upvotes = $1, downvotes = $2 WHERE id = $3', [upvotes, downvotes, req.params.id]);
  res.json({ success: true });
});

app.patch('/api/admin/issues/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  await pool.query('UPDATE issues SET status = $1 WHERE id = $2', [status, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/admin/issues/:id', requireAdmin, async (req, res) => {
  // Comments will be auto-deleted because of ON DELETE CASCADE in the Postgres schema
  await pool.query('DELETE FROM issues WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/admin/issues/:id/comments', requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM comments WHERE issue_id = $1 ORDER BY created_at ASC', [req.params.id]);
  res.json(rows);
});

app.patch('/api/admin/comments/:id', requireAdmin, async (req, res) => {
  const { body } = req.body;
  await pool.query('UPDATE comments SET body = $1 WHERE id = $2', [body, req.params.id]);
  res.json({ success: true });
});

app.patch('/api/admin/comments/:id/visibility', requireAdmin, async (req, res) => {
  const { hidden } = req.body;
  await pool.query('UPDATE comments SET hidden = $1 WHERE id = $2', [hidden ? 1 : 0, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/admin/comments/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM comments WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`\n🗳️  Wasay For Batch Rep running on port ${PORT}\n`));

// =================== FRONTEND ROUTING (VERCEL FIX) ===================

// Serve index.html for the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve admin.html explicitly
app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve the admin panel if someone just types /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Catch-all route: If a user types a random URL, send them back to the homepage
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Vercel requires the express app to be exported
module.exports = app;
// Vercel requires the express app to be exported
module.exports = app;
