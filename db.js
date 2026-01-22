// db.js
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("forum.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      discriminator TEXT,
      avatar TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (user_id, role_id)
    )
  `);

  // Optional: override name/style for a role id (if you want custom labels)
  db.run(`
    CREATE TABLE IF NOT EXISTS role_labels (
      role_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      style TEXT NOT NULL DEFAULT 'neutral'
    )
  `);

  // Role IDs allowed to access /admin
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_access_roles (
      role_id TEXT PRIMARY KEY
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_locked INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      author_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      author_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);

  // seed categories once
  db.get(`SELECT COUNT(*) AS c FROM categories`, (err, row) => {
    if (err) return;
    if ((row?.c ?? 0) === 0) {
      const stmt = db.prepare(`INSERT INTO categories (key, name, description) VALUES (?, ?, ?)`);
      stmt.run("feedback", "Feedback", "Share your thoughts — short and clear is perfect.");
      stmt.run("bugs", "Bugs", "Tell us what broke. Screenshots help a lot.");
      stmt.run("suggestions", "Suggestions", "Ideas you want us to build next.");
      stmt.run("refunds", "Refunds", "Refund help and dispute questions.");
      stmt.finalize();
    }
  });
});

module.exports = db;
