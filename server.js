/**
 * BuildMatrix Backend (Express + SQLite)
 * - Session-based authentication (cookies)
 * - Two-factor authentication (TOTP + recovery codes)
 * - Password reset (email optional, dev token fallback)
 * - Build saving for logged-in users
 *
 * Run:
 *   1) npm install
 *   2) copy .env.example -> .env
 *   3) npm run dev
 */

require("dotenv").config();
const express = require("express");
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const session = require("express-session");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
const PORT = Number(process.env.PORT || 5000);

const DB_FILE = process.env.DB_FILE || path.join(__dirname, "buildmatrix.sqlite");
let SQL = null;
let sqliteDb = null;

async function initDatabase() {
  if (sqliteDb) return sqliteDb;

  SQL = SQL || (await initSqlJs());
  if (fs.existsSync(DB_FILE)) {
    const filebuf = fs.readFileSync(DB_FILE);
    sqliteDb = new SQL.Database(new Uint8Array(filebuf));
  } else {
    sqliteDb = new SQL.Database();
  }

  sqliteDb.run("PRAGMA foreign_keys = ON;");

  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      two_factor_enabled INTEGER NOT NULL DEFAULT 0,
      two_factor_secret TEXT,
      two_factor_temp_secret TEXT,
      two_factor_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);

    CREATE TABLE IF NOT EXISTS two_factor_recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      recovery_code TEXT NOT NULL,
      is_used INTEGER NOT NULL DEFAULT 0,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_recovery_codes_user_id ON two_factor_recovery_codes(user_id);

    CREATE TABLE IF NOT EXISTS two_factor_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_two_factor_logs_user_id ON two_factor_logs(user_id);

    CREATE TABLE IF NOT EXISTS builds (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_builds_user_id ON builds(user_id);

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price INTEGER NOT NULL,
      tier TEXT,
      specs TEXT,
      img TEXT,
      rating REAL,
      ratingCount INTEGER,
      meta TEXT
    );
  `);

  saveDatabase();
  return sqliteDb;
}

function saveDatabase() {
  if (!sqliteDb || !SQL) return;
  const data = sqliteDb.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function rowsFromStatement(stmt) {
  const cols = stmt.getColumnNames();
  const rows = [];
  while (stmt.step()) {
    const vals = stmt.get();
    const row = {};
    for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
    rows.push(row);
  }
  return rows;
}

async function dbQuery(sql, params = []) {
  await initDatabase();
  const isSelect = /^\s*select/i.test(sql);
  const stmt = sqliteDb.prepare(sql);
  stmt.bind(params);

  let rows = [];
  if (isSelect) rows = rowsFromStatement(stmt);
  else {
    while (stmt.step()) {}
  }

  stmt.free();

  if (!isSelect) {
    const affectedRows = sqliteDb.getRowsModified ? sqliteDb.getRowsModified() : 0;
    let insertId = null;
    try {
      const r = sqliteDb.exec("SELECT last_insert_rowid() AS id;");
      insertId = r?.[0]?.values?.[0]?.[0] ?? null;
    } catch (_) {}
    saveDatabase();
    return [{ affectedRows, insertId }];
  }

  return [rows];
}

const db = { query: dbQuery };

async function pingDB() {
  await db.query("SELECT 1 AS ok");
}

async function ensureSchema() {
  await initDatabase();
}

app.set("trust proxy", 1);

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

const allowlist = (process.env.CLIENT_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isNgrokOrigin(origin) {
  try {
    const u = new URL(origin);
    return u.hostname.endsWith(".ngrok-free.dev") || u.hostname.endsWith(".ngrok.io");
  } catch {
    return false;
  }
}

// FIXED CORS CONFIGURATION
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      
      // Allow all localhost origins
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return callback(null, true);
      }
      
      // Check against allowlist
      if (allowlist.includes(origin)) return callback(null, true);
      
      // Check for ngrok
      if (isNgrokOrigin(origin)) return callback(null, true);
      
      // Allow same origin (when serving frontend from same port)
      if (origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`) {
        return callback(null, true);
      }
      
      console.log("⚠️ CORS blocked origin:", origin);
      callback(new Error("CORS not allowed"));
    },
    credentials: true,
    optionsSuccessStatus: 200
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: process.env.SESSION_COOKIE_NAME || "buildmatrix.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  req.user = { id: req.session.userId };
  next();
}

// Middleware to check if user is admin
async function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  try {
    const [rows] = await db.query("SELECT is_admin FROM users WHERE id = ?", [req.session.userId]);
    if (!rows[0]?.is_admin) {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    next();
  } catch (err) {
    console.error("Admin check error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    twoFactorEnabled: !!row.two_factor_enabled,
    is_admin: row.is_admin ? true : false,
    createdAt: row.created_at,
  };
}

function randomTokenHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function hashRecoveryCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(4).toString("hex").toUpperCase());
  }
  return codes;
}

async function sendResetEmailIfConfigured({ to, token }) {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) return { sent: false, reason: "EMAIL_USER/EMAIL_PASS not set" };

  const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || "gmail",
    auth: { user, pass },
  });

  const resetUrl =
    (process.env.CLIENT_URL || `http://localhost:${PORT}`) + `/index.html#reset?token=${token}`;

  await transporter.sendMail({
    from: user,
    to,
    subject: "BuildMatrix Password Reset",
    text: `Your reset token is: ${token}\n\nYou can also use: ${resetUrl}\n\nThis token expires in 1 hour.`,
  });

  return { sent: true };
}

app.get("/api/auth/test", (req, res) => {
  res.json({ success: true, message: "Backend is running!", time: new Date().toISOString() });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: "All fields are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
    }

    const [exists] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    if (exists.length) {
      return res.status(400).json({ success: false, error: "Email already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);
    await db.query("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", [name, email, hashed]);

    res.json({ success: true, message: "Registration successful" });
  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const twoFactorCode = String(req.body.twoFactorCode || "").trim();

    const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
    const user = rows[0];
    if (!user) return res.status(401).json({ success: false, error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ success: false, error: "Invalid credentials" });

    if (user.two_factor_enabled) {
      if (!twoFactorCode) {
        return res.json({ requires2FA: true, userId: user.id });
      }

      const verified = speakeasy.totp.verify({
        secret: user.two_factor_secret,
        encoding: "base32",
        token: twoFactorCode,
        window: 1,
      });

      if (!verified) {
        const hashed = hashRecoveryCode(twoFactorCode);
        const [rcRows] = await db.query(
          "SELECT id FROM two_factor_recovery_codes WHERE user_id = ? AND recovery_code = ? AND is_used = 0",
          [user.id, hashed]
        );
        if (!rcRows.length) {
          await db.query(
            "INSERT INTO two_factor_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)",
            [user.id, "failed", req.ip, req.headers["user-agent"] || ""]
          );
          return res.status(401).json({ success: false, error: "Invalid 2FA code" });
        }

        await db.query(
          "UPDATE two_factor_recovery_codes SET is_used = 1, used_at = datetime('now') WHERE id = ?",
          [rcRows[0].id]
        );
        await db.query(
          "INSERT INTO two_factor_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)",
          [user.id, "recovered", req.ip, req.headers["user-agent"] || ""]
        );
      } else {
        await db.query(
          "INSERT INTO two_factor_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)",
          [user.id, "verified", req.ip, req.headers["user-agent"] || ""]
        );
      }
    }

    req.session.userId = user.id;
    res.json({ success: true, user: sanitizeUser(user) });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  if (!req.session) return res.json({ success: true });
  req.session.destroy(() => res.json({ success: true, message: "Logged out" }));
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const [rcCountRows] = await db.query(
      "SELECT COUNT(*) AS count FROM two_factor_recovery_codes WHERE user_id = ? AND is_used = 0",
      [req.user.id]
    );

    res.json({ 
      ...sanitizeUser(user), 
      recoveryCodesLeft: rcCountRows[0]?.count ?? 0 
    });
  } catch (err) {
    console.error("me error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: "All fields are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: "New password must be at least 6 characters" });
    }

    const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(401).json({ success: false, error: "Current password is incorrect" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password = ? WHERE id = ?", [hashed, req.user.id]);

    res.json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    console.error("change password error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, error: "Email is required" });

    const [rows] = await db.query("SELECT id, email FROM users WHERE email = ?", [email]);
    const user = rows[0];
    if (!user) return res.status(404).json({ success: false, error: "Email not found in our system" });

    const token = randomTokenHex(32);
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await db.query("DELETE FROM password_resets WHERE user_id = ?", [user.id]);
    await db.query(
      "INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)",
      [user.id, token, expires]
    );

    let mailStatus = { sent: false };
    try {
      mailStatus = await sendResetEmailIfConfigured({ to: email, token });
    } catch (e) {
      console.warn("Email send failed, returning devToken:", e.message);
    }

    res.json({
      success: true,
      message: mailStatus.sent ? "Reset email sent!" : "Reset token generated (email not configured).",
      devToken: mailStatus.sent ? undefined : token,
    });
  } catch (err) {
    console.error("forgot password error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!token || !newPassword) {
      return res.status(400).json({ success: false, error: "Token and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
    }

    const [rows] = await db.query(
      "SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > ?",
      [token, new Date().toISOString()]
    );
    const reset = rows[0];
    if (!reset) return res.status(400).json({ success: false, error: "Invalid or expired token" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password = ? WHERE id = ?", [hashed, reset.user_id]);
    await db.query("UPDATE password_resets SET used = 1 WHERE id = ?", [reset.id]);

    res.json({ success: true, message: "Password reset successfully" });
  } catch (err) {
    console.error("reset password error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.get("/api/2fa/status", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT two_factor_enabled FROM users WHERE id = ?", [req.user.id]);
    const enabled = !!rows[0]?.two_factor_enabled;

    const [rcCountRows] = await db.query(
      "SELECT COUNT(*) AS count FROM two_factor_recovery_codes WHERE user_id = ? AND is_used = 0",
      [req.user.id]
    );

    res.json({ success: true, enabled, recoveryCodesLeft: rcCountRows[0]?.count ?? 0 });
  } catch (err) {
    console.error("2fa status error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/2fa/setup", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT email FROM users WHERE id = ?", [req.user.id]);
    const email = rows[0]?.email;
    const secret = speakeasy.generateSecret({ name: `BuildMatrix:${email}`, issuer: "BuildMatrix" });

    await db.query("UPDATE users SET two_factor_temp_secret = ? WHERE id = ?", [secret.base32, req.user.id]);

    const qrCode = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ success: true, qrCode, secret: secret.base32 });
  } catch (err) {
    console.error("2fa setup error:", err);
    res.status(500).json({ success: false, error: "Failed to setup 2FA" });
  }
});

app.post("/api/2fa/verify", requireAuth, async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    if (!token) return res.status(400).json({ success: false, error: "Token is required" });

    const [rows] = await db.query("SELECT two_factor_temp_secret FROM users WHERE id = ?", [req.user.id]);
    const temp = rows[0]?.two_factor_temp_secret;
    if (!temp) return res.status(400).json({ success: false, error: "2FA setup not initiated" });

    const ok = speakeasy.totp.verify({ secret: temp, encoding: "base32", token, window: 1 });
    if (!ok) {
      await db.query(
        "INSERT INTO two_factor_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)",
        [req.user.id, "failed", req.ip, req.headers["user-agent"] || ""]
      );
      return res.status(400).json({ success: false, error: "Invalid verification code" });
    }

    await db.query(
      "UPDATE users SET two_factor_enabled = 1, two_factor_secret = ?, two_factor_temp_secret = NULL, two_factor_verified_at = ? WHERE id = ?",
      [temp, new Date().toISOString(), req.user.id]
    );

    const recoveryCodes = generateRecoveryCodes(8);
    for (const code of recoveryCodes) {
      await db.query(
        "INSERT INTO two_factor_recovery_codes (user_id, recovery_code) VALUES (?, ?)",
        [req.user.id, hashRecoveryCode(code)]
      );
    }

    await db.query(
      "INSERT INTO two_factor_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)",
      [req.user.id, "enabled", req.ip, req.headers["user-agent"] || ""]
    );

    res.json({ success: true, message: "2FA enabled successfully", recoveryCodes });
  } catch (err) {
    console.error("2fa verify error:", err);
    res.status(500).json({ success: false, error: "Failed to verify 2FA" });
  }
});

app.post("/api/2fa/disable", requireAuth, async (req, res) => {
  try {
    await db.query(
      "UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, two_factor_temp_secret = NULL WHERE id = ?",
      [req.user.id]
    );

    await db.query("DELETE FROM two_factor_recovery_codes WHERE user_id = ?", [req.user.id]);
    await db.query(
      "INSERT INTO two_factor_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)",
      [req.user.id, "disabled", req.ip, req.headers["user-agent"] || ""]
    );

    res.json({ success: true, message: "2FA disabled successfully" });
  } catch (err) {
    console.error("2fa disable error:", err);
    res.status(500).json({ success: false, error: "Failed to disable 2FA" });
  }
});

app.get("/api/builds", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name, total, items_json, created_at FROM builds WHERE user_id = ? ORDER BY created_at DESC",
      [req.user.id]
    );

    const builds = rows.map((r) => ({
      id: r.id,
      name: r.name,
      total: r.total,
      createdAt: r.created_at,
      items: (() => {
        try {
          return JSON.parse(r.items_json || "[]");
        } catch {
          return [];
        }
      })(),
    }));

    res.json({ success: true, builds });
  } catch (err) {
    console.error("list builds error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.get("/api/builds/:id", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const [rows] = await db.query(
      "SELECT id, name, total, items_json, created_at FROM builds WHERE id = ? AND user_id = ? LIMIT 1",
      [id, req.user.id]
    );
    const r = rows[0];
    if (!r) return res.status(404).json({ success: false, error: "Build not found" });

    res.json({
      success: true,
      build: {
        id: r.id,
        name: r.name,
        total: r.total,
        createdAt: r.created_at,
        items: (() => {
          try {
            return JSON.parse(r.items_json || "[]");
          } catch {
            return [];
          }
        })(),
      },
    });
  } catch (err) {
    console.error("get build error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/builds", requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const total = Number(req.body.total || 0) || 0;
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!name) return res.status(400).json({ success: false, error: "Build name is required" });
    if (!items.length) return res.status(400).json({ success: false, error: "Build must contain at least 1 item" });

    const id = crypto.randomUUID();
    await db.query(
      "INSERT INTO builds (id, user_id, name, total, items_json) VALUES (?, ?, ?, ?, ?)",
      [id, req.user.id, name, Math.round(total), JSON.stringify(items)]
    );

    res.json({ success: true, message: "Build saved", id });
  } catch (err) {
    console.error("create build error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.put("/api/builds/:id", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const name = String(req.body.name || "").trim();
    const total = req.body.total != null ? Number(req.body.total) : null;
    const items = req.body.items != null ? (Array.isArray(req.body.items) ? req.body.items : null) : null;

    const [exists] = await db.query("SELECT id FROM builds WHERE id = ? AND user_id = ? LIMIT 1", [id, req.user.id]);
    if (!exists.length) return res.status(404).json({ success: false, error: "Build not found" });

    const fields = [];
    const values = [];

    if (name) {
      fields.push("name = ?");
      values.push(name);
    }
    if (total != null && !Number.isNaN(total)) {
      fields.push("total = ?");
      values.push(Math.round(total));
    }
    if (items != null) {
      fields.push("items_json = ?");
      values.push(JSON.stringify(items));
    }

    if (!fields.length) return res.json({ success: true, message: "Nothing to update" });

    fields.push("updated_at = ?");
    values.push(new Date().toISOString(), id, req.user.id);

    const sql = `UPDATE builds SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`;
    await db.query(sql, values);

    res.json({ success: true, message: "Build updated" });
  } catch (err) {
    console.error("update build error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.delete("/api/builds/:id", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    await db.query("DELETE FROM builds WHERE id = ? AND user_id = ?", [id, req.user.id]);
    res.json({ success: true, message: "Build deleted" });
  } catch (err) {
    console.error("delete build error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ============ ADMIN ROUTES ============

// Get dashboard stats
app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  try {
    const [userCount] = await db.query("SELECT COUNT(*) as count FROM users");
    const [buildCount] = await db.query("SELECT COUNT(*) as count FROM builds");
    const [productCount] = await db.query("SELECT COUNT(*) as count FROM products");
    const [recentUsers] = await db.query("SELECT COUNT(*) as count FROM users WHERE created_at > datetime('now', '-7 days')");
    
    res.json({
      success: true,
      stats: {
        totalUsers: userCount[0]?.count || 0,
        totalBuilds: buildCount[0]?.count || 0,
        totalProducts: productCount[0]?.count || 0,
        newUsersThisWeek: recentUsers[0]?.count || 0
      }
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Get all products
app.get("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM products ORDER BY category, name");
    res.json({ success: true, products: rows });
  } catch (err) {
    console.error("Admin products error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Add new product
app.post("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const { id, name, category, price, tier, specs, img, rating, ratingCount, meta } = req.body;
    
    if (!id || !name || !category || !price) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    await db.query(
      "INSERT INTO products (id, name, category, price, tier, specs, img, rating, ratingCount, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, name, category, price, tier || 'budget', specs || '', img || '', rating || 0, ratingCount || 0, JSON.stringify(meta || {})]
    );

    res.json({ success: true, message: "Product added successfully" });
  } catch (err) {
    console.error("Add product error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Update product
app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const productId = req.params.id;
    const { name, category, price, tier, specs, img, rating, ratingCount, meta } = req.body;

    await db.query(
      "UPDATE products SET name = ?, category = ?, price = ?, tier = ?, specs = ?, img = ?, rating = ?, ratingCount = ?, meta = ? WHERE id = ?",
      [name, category, price, tier, specs, img, rating, ratingCount, JSON.stringify(meta || {}), productId]
    );

    res.json({ success: true, message: "Product updated successfully" });
  } catch (err) {
    console.error("Update product error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Delete product
app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const productId = req.params.id;
    await db.query("DELETE FROM products WHERE id = ?", [productId]);
    res.json({ success: true, message: "Product deleted successfully" });
  } catch (err) {
    console.error("Delete product error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Get all users
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, name, email, is_admin, created_at FROM users ORDER BY created_at DESC");
    res.json({ success: true, users: rows });
  } catch (err) {
    console.error("Admin users error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Toggle admin status
app.put("/api/admin/users/:id/toggle-admin", requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    
    if (userId == req.session.userId) {
      return res.status(400).json({ success: false, error: "Cannot modify your own admin status" });
    }

    const [rows] = await db.query("SELECT is_admin FROM users WHERE id = ?", [userId]);
    if (!rows[0]) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const newStatus = rows[0].is_admin ? 0 : 1;
    await db.query("UPDATE users SET is_admin = ? WHERE id = ?", [newStatus, userId]);

    res.json({ success: true, message: `Admin status ${newStatus ? 'granted' : 'removed'}` });
  } catch (err) {
    console.error("Toggle admin error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Get all builds
app.get("/api/admin/builds", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT b.*, u.name as user_name, u.email 
      FROM builds b 
      JOIN users u ON b.user_id = u.id 
      ORDER BY b.created_at DESC
      LIMIT 100
    `);
    
    const builds = rows.map(r => ({
      ...r,
      items: (() => {
        try { return JSON.parse(r.items_json || '[]'); } 
        catch { return []; }
      })()
    }));

    res.json({ success: true, builds });
  } catch (err) {
    console.error("Admin builds error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.use("/api", (req, res, next) => next());
app.use("/api", (req, res) => res.status(404).json({ error: "API route not found" }));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

(async () => {
  try {
    await pingDB();
    await ensureSchema();
    console.log("✅ SQLite database ready");
  } catch (e) {
    console.error("❌ Database error:", e.message);
  }

  const benchmarkCache = new Map();

  function cacheKey(type, name) {
    return `${String(type || "").toLowerCase()}::${String(name || "").toLowerCase()}`;
  }

  async function fetchText(url) {
    const res = await fetch(url, { headers: { "User-Agent": "BuildMatrix/1.0 (School Project)" } });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    return await res.text();
  }

  function extractNumberAfter(labelRegex, html) {
    const m = html.match(labelRegex);
    if (!m) return null;
    const start = m.index || 0;
    const tail = html.slice(start, start + 2000);
    const num = tail.match(/(\d{1,3}(?:,\d{3})+|\d{4,})/);
    return num ? Number(String(num[1]).replace(/,/g, "")) : null;
  }

  app.get("/api/benchmarks", async (req, res) => {
    try {
      const type = String(req.query.type || "").toLowerCase();
      const name = String(req.query.name || "").trim();
      if (!type || !name) return res.status(400).json({ error: "Missing type or name" });
      if (!["cpu", "gpu"].includes(type)) return res.status(400).json({ error: "Type must be cpu or gpu" });

      const key = cacheKey(type, name);
      if (benchmarkCache.has(key)) return res.json(benchmarkCache.get(key));

      if (type === "cpu") {
        const url = `https://www.cpubenchmark.net/cpu.php?cpu=${encodeURIComponent(name)}`;
        const html = await fetchText(url);
        const score =
          extractNumberAfter(/Multithread\s*Rating/i, html) ||
          extractNumberAfter(/Average\s*CPU\s*Mark/i, html);
        if (!score) return res.status(404).json({ error: "CPU benchmark not found", source: "PassMark", url });
        const payload = { type, name, source: "PassMark CPU Mark", score, url };
        benchmarkCache.set(key, payload);
        return res.json(payload);
      }

      const searchUrl = `https://www.videocardbenchmark.net/gpu_list.php?search=${encodeURIComponent(name)}`;
      const listHtml = await fetchText(searchUrl);
      const linkMatch = listHtml.match(/gpu\.php\?gpu=[^"&]+&id=\d+/i);
      if (!linkMatch) return res.status(404).json({ error: "GPU model not found in PassMark list", source: "PassMark", url: searchUrl });

      const gpuUrl = `https://www.videocardbenchmark.net/${linkMatch[0]}`;
      const gpuHtml = await fetchText(gpuUrl);
      const score =
        extractNumberAfter(/Average\s*G3D\s*Mark/i, gpuHtml) ||
        extractNumberAfter(/Passmark\s*G3D\s*Mark/i, gpuHtml);
      if (!score) return res.status(404).json({ error: "GPU benchmark not found", source: "PassMark", url: gpuUrl });

      const payload = { type, name, source: "PassMark G3D Mark", score, url: gpuUrl };
      benchmarkCache.set(key, payload);
      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: "Benchmark fetch failed", detail: String(e.message || e) });
    }
  });

  function normalizeName(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractPesoPrices(html) {
    const items = [];
    const blocks = html.split("grid__item");
    for (const b of blocks) {
      const tMatch =
        b.match(/class="card__heading"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
        b.match(/class="product-card__title"[^>]*>([\s\S]*?)<\/a>/i) ||
        b.match(/aria-label="([^"]+)"/i);
      const title = tMatch ? String(tMatch[1]).replace(/<[^>]+>/g, "").trim() : "";
      if (!title || title.length < 3) continue;

      const pMatch = b.match(/₱\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/);
      if (!pMatch) continue;
      const price = Number(String(pMatch[1]).replace(/,/g, ""));
      if (!Number.isFinite(price) || price <= 0) continue;

      items.push({ title, price });
    }
    return items;
  }

  async function fetchPCWORXCollection(handle, page = 1) {
    const url = `https://pcworx.ph/collections/${handle}?page=${page}`;
    const html = await fetchText(url);
    return { url, html };
  }

  async function scrapeCollectionToMap(handle, maxPages = 6) {
    const map = new Map();
    for (let p = 1; p <= maxPages; p++) {
      const { html } = await fetchPCWORXCollection(handle, p);
      const items = extractPesoPrices(html);
      if (!items.length) break;
      for (const it of items) {
        const key = normalizeName(it.title);
        const prev = map.get(key);
        if (!prev || it.price < prev) map.set(key, it.price);
      }
    }
    return map;
  }

  app.get("/api/pcworx/prices", async (req, res) => {
    try {
      const handles = {
        gpu: "gpu",
        cpu: "cpu",
        motherboard: "motherboard-1",
        ram: "memory-components",
        ssd: "ssd",
        hdd: "hard-disk",
        psu: "power-supply",
        case: "casing",
        monitor: "monitors",
        keyboard: "keyboard-1",
        mouse: "mouse",
      };

      const result = {};
      for (const [cat, handle] of Object.entries(handles)) {
        const map = await scrapeCollectionToMap(handle, 8);
        result[cat] = Object.fromEntries(map.entries());
      }

      return res.json({ source: "pcworx.ph collections", result });
    } catch (e) {
      return res.status(500).json({ error: "PCWORX price scrape failed", detail: String(e.message || e) });
    }
  });

  app.listen(PORT, () => {
    console.log("=================================");
    console.log("🚀 BuildMatrix Server Running!");
    console.log(`📡 Port: ${PORT}`);
    console.log(`🌐 URL:  http://localhost:${PORT}/`);
    console.log("=================================");
  });
})();