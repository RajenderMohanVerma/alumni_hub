"use strict";
/*
 * models.js - Database layer for Alumni Hub
 *
 * This file contains everything related to the SQLite database:
 *   1. How to connect to the database  -> openDb()
 *   2. How to create all the tables    -> initDb()
 *   3. A few small helper functions used by many routes
 *      (profiles, notifications, unread counters)
 *
 * The routes in app.js use these helpers and run simple SQL queries
 * through a synchronous SQLite driver, so the code reads almost
 * exactly like the old Python/sqlite3 version. Which driver is used
 * depends on the configuration (see openDb below):
 *   - default: the local database file, through `better-sqlite3`
 *   - when TURSO_DATABASE_URL is set: the shared Turso cloud
 *     database, through the `libsql` package (same synchronous API)
 *
 * NOTE: this file never touches passwords. Password hashes are created
 * and checked ONLY by the Python auth service (Werkzeug scrypt).
 */

const BetterSqlite3 = require("better-sqlite3");
const config = require("./config");

// ---------------------------------------------------------------------------
// 1. Database connection
// ---------------------------------------------------------------------------
let db = null;

/**
 * Open (once) and return the shared database connection.
 * Rows come back as plain objects: row.name, row.email, ...
 */
function openDb() {
  if (db === null) {
    db = config.TURSO_DATABASE_URL ? openTursoDb() : new BetterSqlite3(config.DATABASE);
    // Switch ON foreign-key support so ON DELETE CASCADE works
    db.pragma("foreign_keys = ON");
  }
  return db;
}

/**
 * Remove the "_metadata" property (query timing info) that the libsql
 * driver adds to rows it returns. better-sqlite3 rows do not have it,
 * and neither templates nor JSON responses should ever see it.
 */
function stripMetadata(row) {
  if (row && typeof row === "object" && "_metadata" in row) {
    const clean = { ...row };
    delete clean._metadata;
    return clean;
  }
  return row;
}

/**
 * Open the shared Turso (libSQL) database. The `libsql` package is a
 * synchronous driver with the same prepare/run/get/all API as
 * better-sqlite3, so no route code had to change; the only adaptation
 * is wrapping prepare() so returned rows lose their "_metadata".
 * The package is required lazily so local runs without it (and
 * without Turso) are completely unaffected.
 */
function openTursoDb() {
  let LibsqlDatabase;
  try {
    LibsqlDatabase = require("libsql");
  } catch (err) {
    throw new Error(
      "TURSO_DATABASE_URL is set but the 'libsql' package is not " +
        "installed. Run 'npm install' first."
    );
  }
  const remote = new LibsqlDatabase(config.TURSO_DATABASE_URL, {
    authToken: config.TURSO_AUTH_TOKEN || undefined,
  });
  const prepare = remote.prepare.bind(remote);
  remote.prepare = (sql) => {
    const stmt = prepare(sql);
    const get = stmt.get.bind(stmt);
    const all = stmt.all.bind(stmt);
    stmt.get = (...args) => stripMetadata(get(...args));
    stmt.all = (...args) => all(...args).map(stripMetadata);
    return stmt;
  };
  return remote;
}

// ---------------------------------------------------------------------------
// 2. Table creation
// ---------------------------------------------------------------------------
// One CREATE TABLE statement per table. "IF NOT EXISTS" means running
// initDb() again and again is safe - existing data is never deleted.
// (The Python auth service creates exactly the same tables.)
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('student', 'alumni', 'faculty', 'admin')),
    phone         TEXT,
    profile_pic   TEXT,
    photo_data    TEXT,
    photo_mime    TEXT,
    photo_updated_at INTEGER,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS student_profile (
    user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    course   TEXT,
    branch   TEXT,
    year     TEXT,
    skills   TEXT,
    bio      TEXT
);

CREATE TABLE IF NOT EXISTS alumni_profile (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    company     TEXT,
    designation TEXT,
    experience  TEXT,
    skills      TEXT,
    bio         TEXT
);

CREATE TABLE IF NOT EXISTS faculty_profile (
    user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    department    TEXT,
    designation   TEXT,
    qualification TEXT,
    skills        TEXT,
    bio           TEXT
);

CREATE TABLE IF NOT EXISTS connections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at  TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE (sender_id, receiver_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    alumni_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    company     TEXT NOT NULL,
    location    TEXT,
    salary      TEXT,
    description TEXT,
    deadline    TEXT,
    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS applications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cover_note TEXT,
    status     TEXT NOT NULL DEFAULT 'Applied'
               CHECK (status IN ('Applied', 'Shortlisted', 'Rejected')),
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE (job_id, student_id)
);

CREATE TABLE IF NOT EXISTS announcements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    body       TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    link       TEXT,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS contact_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    subject    TEXT,
    message    TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
`;

/**
 * Columns added to the users table after the first release. Profile
 * pictures used to be saved as files in an uploads folder; on Vercel
 * that folder is temporary and different on every server instance, so
 * a photo kept vanishing (the default icon showed instead). Photos are
 * now stored IN the database itself (base64 text + its mime type), so
 * they are available everywhere the database is. photo_updated_at
 * (unix seconds) doubles as the cache-busting version in photo URLs.
 */
const USER_PHOTO_COLUMNS = [
  ["photo_data", "TEXT"],
  ["photo_mime", "TEXT"],
  ["photo_updated_at", "INTEGER"],
];

/**
 * Create all tables if they do not exist yet, and add any newer users
 * columns to databases created before they existed. Idempotent: the
 * column list is checked first, so running this on every boot (in both
 * services) is safe and changes nothing once the columns are there.
 */
function initDb() {
  const db = openDb();
  db.exec(SCHEMA);
  const existing = new Set(
    db
      .prepare("PRAGMA table_info(users)")
      .all()
      .map((col) => col.name)
  );
  for (const [name, type] of USER_PHOTO_COLUMNS) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Small shared helpers
// ---------------------------------------------------------------------------
// Which profile table belongs to which role
const PROFILE_TABLES = {
  student: "student_profile",
  alumni: "alumni_profile",
  faculty: "faculty_profile",
};

/** Return the role-profile row of a user (or null for admin). */
function getProfile(userId, role) {
  const table = PROFILE_TABLES[role];
  if (!table) return null;
  return (
    openDb()
      .prepare(`SELECT * FROM ${table} WHERE user_id = ?`)
      .get(userId) || null
  );
}

/**
 * Insert one notification for a user.
 *
 * Used when: a connection request arrives / is accepted, a new job is
 * posted, an application is received, an application status changes.
 */
function createNotification(userId, text, link = null) {
  openDb()
    .prepare("INSERT INTO notifications (user_id, text, link) VALUES (?, ?, ?)")
    .run(userId, text, link);
}

/** How many unread notifications a user has (shown as navbar badge). */
function unreadNotificationCount(userId) {
  const row = openDb()
    .prepare(
      "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0"
    )
    .get(userId);
  return row.c;
}

/** How many unread chat messages a user has (shown as navbar badge). */
function unreadMessageCount(userId) {
  const row = openDb()
    .prepare(
      "SELECT COUNT(*) AS c FROM messages WHERE receiver_id = ? AND is_read = 0"
    )
    .get(userId);
  return row.c;
}

module.exports = {
  openDb,
  initDb,
  PROFILE_TABLES,
  getProfile,
  createNotification,
  unreadNotificationCount,
  unreadMessageCount,
};
