// server.js new
require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const helmet = require("helmet");
const db = require("./db");

// ✅ NEW: http server + socket.io
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// --------------------
// Express
// --------------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change_me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// --------------------
// ✅ Socket.IO setup
// --------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

io.on("connection", (socket) => {
  socket.on("join:category", (key) => {
    if (typeof key === "string" && key.length < 100) socket.join(`category:${key}`);
  });

  socket.on("join:post", (postId) => {
    const s = String(postId || "");
    if (s.length && s.length < 50) socket.join(`post:${s}`);
  });
});

// --------------------
// SQLite helpers
// --------------------
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// --------------------
// Discord helpers (Bot)
// --------------------
function mustEnv(name) {
  if (!process.env[name]) throw new Error(`Missing ${name} in .env`);
  return process.env[name];
}

async function discordBotFetch(url) {
  const token = mustEnv("DISCORD_BOT_TOKEN");
  const res = await fetch(`https://discord.com/api/v10${url}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Discord API failed ${res.status}: ${txt}`);
  }
  return res.json();
}

// Cache role id -> name for 5 min
let roleCache = { map: new Map(), updatedAt: 0 };

async function refreshGuildRolesCache() {
  const guildId = mustEnv("DISCORD_GUILD_ID");
  const now = Date.now();
  if (now - roleCache.updatedAt < 5 * 60 * 1000 && roleCache.map.size) return;

  const roles = await discordBotFetch(`/guilds/${guildId}/roles`);
  const m = new Map();
  for (const r of roles) m.set(r.id, r.name);
  roleCache = { map: m, updatedAt: now };
}

async function fetchMemberRoleIds(userId) {
  const guildId = mustEnv("DISCORD_GUILD_ID");
  const member = await discordBotFetch(`/guilds/${guildId}/members/${userId}`);
  return Array.isArray(member.roles) ? member.roles : [];
}

// Throttle sync per user to avoid rate limits (10s)
const lastSync = new Map();
async function syncUserRolesFromDiscord(userId) {
  const now = Date.now();
  const last = lastSync.get(userId) || 0;
  if (now - last < 10_000) return;
  lastSync.set(userId, now);

  const roleIds = await fetchMemberRoleIds(userId);

  await dbRun(`DELETE FROM user_roles WHERE user_id = ?`, [userId]);
  for (const rid of roleIds) {
    await dbRun(`INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`, [userId, rid]);
  }
}

function avatarUrl(user) {
  if (!user) return "";
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=96`;
  const disc = parseInt(user.discriminator || "0", 10) || 0;
  return `https://cdn.discordapp.com/embed/avatars/${disc % 5}.png`;
}

// Admin access by role ids table
async function userHasAdminAccess(userId) {
  const row = await dbGet(
    `
    SELECT 1 AS ok
    FROM user_roles ur
    JOIN admin_access_roles aar ON aar.role_id = ur.role_id
    WHERE ur.user_id = ?
    LIMIT 1
    `,
    [userId]
  );
  return !!row;
}

async function requireAdmin(req, res, next) {
  if (!req.user?.id) return res.redirect("/login");
  const ok = await userHasAdminAccess(req.user.id);
  if (!ok) return res.status(403).render("forbidden", {
    title: "Access denied",
    message: "This page is for staff only.",
  });
  next();
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.redirect("/login");
}

// Convert role IDs -> badges shown in UI
function guessStyleFromName(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("owner") || n.includes("founder")) return "owner";
  if (n.includes("admin")) return "admin";
  if (n.includes("mod")) return "mod";
  if (n.includes("verify")) return "verified";
  if (n.includes("seller") || n.includes("vendor")) return "seller";
  return "neutral";
}

async function getUserBadges(userId) {
  const roleRows = await dbAll(`SELECT role_id FROM user_roles WHERE user_id = ?`, [userId]);
  const roleIds = (roleRows || []).map(r => r.role_id);

  const overrides = await dbAll(`SELECT role_id, label, style FROM role_labels`, []);
  const overrideMap = new Map(overrides.map(o => [o.role_id, o]));

  await refreshGuildRolesCache();

  const badges = [];
  for (const rid of roleIds) {
    const ov = overrideMap.get(rid);
    if (ov) {
      badges.push({ role_id: rid, label: ov.label, style: ov.style || "neutral" });
      continue;
    }
    const name = roleCache.map.get(rid);
    if (!name) continue;
    badges.push({ role_id: rid, label: name, style: guessStyleFromName(name) });
  }

  badges.sort((a, b) => a.label.localeCompare(b.label));
  return badges;
}

// Expose locals + auto refresh roles
app.use(async (req, res, next) => {
  res.locals.me = req.user || null;
  res.locals.avatarUrl = avatarUrl;
  res.locals.myBadges = [];
  res.locals.canAdmin = false;

  if (req.user?.id) {
    try {
      await syncUserRolesFromDiscord(req.user.id);
      res.locals.myBadges = await getUserBadges(req.user.id);
      res.locals.canAdmin = await userHasAdminAccess(req.user.id);
    } catch (e) {
      res.locals.myBadges = [];
      res.locals.canAdmin = false;
      console.warn("[Locals] role refresh failed:", e.message);
    }
  }

  next();
});

// --------------------
// Passport Discord
// --------------------
passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: process.env.DISCORD_CALLBACK_URL,
      scope: ["identify"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const existing = await dbGet(`SELECT id FROM users WHERE id = ?`, [profile.id]);

        if (!existing) {
          await dbRun(
            `INSERT INTO users (id, username, discriminator, avatar) VALUES (?, ?, ?, ?)`,
            [profile.id, profile.username, profile.discriminator || null, profile.avatar || null]
          );
        } else {
          await dbRun(
            `UPDATE users SET username=?, discriminator=?, avatar=? WHERE id=?`,
            [profile.username, profile.discriminator || null, profile.avatar || null, profile.id]
          );
        }

        const user = await dbGet(`SELECT * FROM users WHERE id = ?`, [profile.id]);
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await dbGet(`SELECT * FROM users WHERE id = ?`, [id]);
    done(null, user || null);
  } catch (err) {
    done(err);
  }
});

// --------------------
// Routes: Auth
// --------------------
app.get("/login", (req, res) => res.render("index", { loginOnly: true, categories: [] }));
app.get("/auth/discord", passport.authenticate("discord"));
app.get("/auth/discord/callback",
  passport.authenticate("discord", { failureRedirect: "/login" }),
  (req, res) => res.redirect("/")
);
app.get("/logout", (req, res) => req.logout(() => res.redirect("/")));

// --------------------
// Pages
// --------------------
app.get("/", async (req, res) => {
  const categories = await dbAll(`SELECT * FROM categories ORDER BY id ASC`);
  res.render("index", { loginOnly: false, categories: categories || [] });
});

app.get("/c/:key", async (req, res) => {
  const cat = await dbGet(`SELECT * FROM categories WHERE key = ?`, [req.params.key]);
  if (!cat) return res.status(404).render("forbidden", { title: "Not found", message: "That page doesn’t exist." });

  const posts = await dbAll(
    `
    SELECT p.*, u.username, u.discriminator, u.avatar
    FROM posts p
    JOIN users u ON u.id = p.author_id
    WHERE p.category_id = ?
    ORDER BY p.created_at DESC
    `,
    [cat.id]
  );

  const out = [];
  for (const p of (posts || [])) {
    const badges = await getUserBadges(p.author_id);
    out.push({ ...p, badges });
  }

  res.render("category", { cat, posts: out });
});

app.get("/p/:id", async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isFinite(postId)) return res.status(400).render("forbidden", { title: "Bad link", message: "That link looks wrong." });

  const post = await dbGet(
    `
    SELECT p.*, c.key as category_key, c.name as category_name,
           u.username, u.discriminator, u.avatar
    FROM posts p
    JOIN users u ON u.id = p.author_id
    JOIN categories c ON c.id = p.category_id
    WHERE p.id = ?
    `,
    [postId]
  );
  if (!post) return res.status(404).render("forbidden", { title: "Not found", message: "That post doesn’t exist." });

  post.badges = await getUserBadges(post.author_id);

  const replies = await dbAll(
    `
    SELECT r.*, u.username, u.discriminator, u.avatar
    FROM replies r
    JOIN users u ON u.id = r.author_id
    WHERE r.post_id = ?
    ORDER BY r.created_at ASC
    `,
    [postId]
  );

  const repliesOut = [];
  for (const r of (replies || [])) {
    const badges = await getUserBadges(r.author_id);
    repliesOut.push({ ...r, badges });
  }

  res.render("post", { post, replies: repliesOut });
});

app.get("/new/:key", requireAuth, async (req, res) => {
  const cat = await dbGet(`SELECT * FROM categories WHERE key = ?`, [req.params.key]);
  if (!cat) return res.status(404).render("forbidden", { title: "Not found", message: "That section doesn’t exist." });
  res.render("newpost", { cat });
});

// --------------------
// Actions
// --------------------
app.post("/new/:key", requireAuth, async (req, res) => {
  const cat = await dbGet(`SELECT * FROM categories WHERE key = ?`, [req.params.key]);
  if (!cat) return res.status(404).render("forbidden", { title: "Not found", message: "That section doesn’t exist." });

  const title = String(req.body.title || "").trim();
  const body = String(req.body.body || "").trim();

  if (title.length < 3) return res.status(400).render("forbidden", { title: "Too short", message: "Give it a slightly longer title." });
  if (body.length < 5) return res.status(400).render("forbidden", { title: "Too short", message: "Write a bit more detail so we can help." });

  const result = await dbRun(
    `INSERT INTO posts (category_id, author_id, title, body) VALUES (?, ?, ?, ?)`,
    [cat.id, req.user.id, title, body]
  );

  // ✅ LIVE: notify everyone viewing this category
  io.to(`category:${cat.key}`).emit("post:new", {
    id: result.lastID,
    category_key: cat.key,
    title,
    author: req.user.username,
    created_at: Math.floor(Date.now() / 1000),
  });

  res.redirect(`/p/${result.lastID}`);
});

app.post("/reply/:postId", requireAuth, async (req, res) => {
  const postId = Number(req.params.postId);
  if (!Number.isFinite(postId)) return res.status(400).render("forbidden", { title: "Bad link", message: "That link looks wrong." });

  const body = String(req.body.body || "").trim();
  if (!body) return res.status(400).render("forbidden", { title: "Empty reply", message: "Write something first 🙂" });

  const exists = await dbGet(`SELECT id FROM posts WHERE id = ?`, [postId]);
  if (!exists) return res.status(404).render("forbidden", { title: "Not found", message: "That post doesn’t exist." });

  await dbRun(`INSERT INTO replies (post_id, author_id, body) VALUES (?, ?, ?)`, [postId, req.user.id, body]);

  // ✅ LIVE: notify everyone viewing this post
  io.to(`post:${postId}`).emit("reply:new", {
    post_id: postId,
    body,
    author: req.user.username,
    created_at: Math.floor(Date.now() / 1000),
  });

  res.redirect(`/p/${postId}#replies`);
});

// --------------------
// Admin (role-id allowlist)
// --------------------
app.get("/admin", requireAuth, requireAdmin, async (req, res) => {
  const users = await dbAll(`SELECT * FROM users ORDER BY created_at DESC LIMIT 200`);
  const out = [];
  for (const u of (users || [])) {
    const badges = await getUserBadges(u.id);
    out.push({ ...u, badges });
  }
  res.render("admin", { users: out });
});

app.get("/admin/access", requireAuth, requireAdmin, async (req, res) => {
  const roles = await dbAll(`SELECT role_id FROM admin_access_roles ORDER BY role_id ASC`);
  res.render("admin_access", { roles: roles || [] });
});

app.post("/admin/access/add", requireAuth, requireAdmin, async (req, res) => {
  const roleId = String(req.body.role_id || "").trim();
  if (roleId) await dbRun(`INSERT OR IGNORE INTO admin_access_roles (role_id) VALUES (?)`, [roleId]);
  res.redirect("/admin/access");
});

app.post("/admin/access/remove", requireAuth, requireAdmin, async (req, res) => {
  const roleId = String(req.body.role_id || "").trim();
  if (roleId) await dbRun(`DELETE FROM admin_access_roles WHERE role_id = ?`, [roleId]);
  res.redirect("/admin/access");
});

app.get("/admin/roles", requireAuth, requireAdmin, async (req, res) => {
  const labels = await dbAll(`SELECT role_id, label, style FROM role_labels ORDER BY label ASC`);
  res.render("role_labels", { labels: labels || [] });
});

app.post("/admin/roles/upsert", requireAuth, requireAdmin, async (req, res) => {
  const roleId = String(req.body.role_id || "").trim();
  const label = String(req.body.label || "").trim();
  const style = String(req.body.style || "neutral").trim();

  const allowed = ["owner","admin","mod","verified","seller","neutral"];
  const finalStyle = allowed.includes(style) ? style : "neutral";

  if (roleId && label) {
    await dbRun(
      `INSERT INTO role_labels (role_id, label, style)
       VALUES (?, ?, ?)
       ON CONFLICT(role_id) DO UPDATE SET label=excluded.label, style=excluded.style`,
      [roleId, label, finalStyle]
    );
  }

  res.redirect("/admin/roles");
});

app.post("/admin/roles/delete", requireAuth, requireAdmin, async (req, res) => {
  const roleId = String(req.body.role_id || "").trim();
  if (roleId) await dbRun(`DELETE FROM role_labels WHERE role_id = ?`, [roleId]);
  res.redirect("/admin/roles");
});

// --------------------
// Start
// --------------------
const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`ExecMarket Forum running on port ${port}`));
