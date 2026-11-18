"""
models.py - Database layer for Alumni Hub (Minor Project)

This file contains everything related to the SQLite database:
  1. How to connect to the database  -> get_db()
  2. How to create all the tables    -> init_db()
  3. A few small helper functions used by many routes
     (profiles, notifications, unread counters)

The routes in app.py use these helpers and run simple SQL queries.
"""

import sqlite3

from flask import g

from config import DATABASE


# ---------------------------------------------------------------------------
# 1. Database connection
# ---------------------------------------------------------------------------
def get_raw_connection():
    """Open a plain SQLite connection (used by seed.py and init_db)."""
    conn = sqlite3.connect(DATABASE)
    # Rows behave like dictionaries: row['name'], row['email'], ...
    conn.row_factory = sqlite3.Row
    # Switch ON foreign-key support so ON DELETE CASCADE works
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    """Return the database connection for the current request.

    Flask's `g` object stores one connection per request, so we do not
    open a new connection again and again inside the same request.
    """
    if "db" not in g:
        g.db = get_raw_connection()
    return g.db


def close_db(error=None):
    """Close the request's connection (registered in app.py)."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


# ---------------------------------------------------------------------------
# 2. Table creation
# ---------------------------------------------------------------------------
# One CREATE TABLE statement per table. "IF NOT EXISTS" means running
# init_db() again and again is safe - existing data is never deleted.
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('student', 'alumni', 'faculty', 'admin')),
    phone         TEXT,
    profile_pic   TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1,   -- 0 = blocked by admin
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
"""


def init_db():
    """Create all tables if they do not exist yet."""
    conn = get_raw_connection()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# 3. Small shared helpers
# ---------------------------------------------------------------------------
# Which profile table belongs to which role
PROFILE_TABLES = {
    "student": "student_profile",
    "alumni": "alumni_profile",
    "faculty": "faculty_profile",
}


def get_profile(user_id, role):
    """Return the role-profile row of a user (or None for admin)."""
    table = PROFILE_TABLES.get(role)
    if table is None:
        return None
    db = get_db()
    return db.execute(
        f"SELECT * FROM {table} WHERE user_id = ?", (user_id,)
    ).fetchone()


def create_notification(user_id, text, link=None):
    """Insert one notification for a user.

    Used when: a connection request arrives / is accepted, a new job is
    posted, an application is received, an application status changes.
    """
    db = get_db()
    db.execute(
        "INSERT INTO notifications (user_id, text, link) VALUES (?, ?, ?)",
        (user_id, text, link),
    )
    db.commit()


def unread_notification_count(user_id):
    """How many unread notifications a user has (shown as navbar badge)."""
    db = get_db()
    row = db.execute(
        "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0",
        (user_id,),
    ).fetchone()
    return row["c"]


def unread_message_count(user_id):
    """How many unread chat messages a user has (shown as navbar badge)."""
    db = get_db()
    row = db.execute(
        "SELECT COUNT(*) AS c FROM messages WHERE receiver_id = ? AND is_read = 0",
        (user_id,),
    ).fetchone()
    return row["c"]
