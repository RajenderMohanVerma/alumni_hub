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
 * through the `better-sqlite3` package, which is synchronous - so the
 * code reads almost exactly like the old Python/sqlite3 version.
 *
 * NOTE: this file never touches passwords. Password hashes are created
 * and checked ONLY by the Python auth service (Werkzeug scrypt).
 */

const Database = require("better-sqlite3");
const config = require("./config");

// ---------------------------------------------------------------------------
// 1. Database connection
// ---------------------------------------------------------------------------
let db = null;

/**
 * Open (once) and return the shared SQLite connection.
 * Rows come back as plain objects: row.name, row.email, ...
 */
function openDb() {
  if (db === null) {
    db = new Database(config.DATABASE);
    // Switch ON foreign-key support so ON DELETE CASCADE works
    db.pragma("foreign_keys = ON");
  }
  return db;
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

/** Create all tables if they do not exist yet. */
function initDb() {
  openDb().exec(SCHEMA);
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
