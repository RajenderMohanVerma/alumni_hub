"""
auth.py - Alumni Hub AUTHENTICATION SERVICE (Python + Flask).

Run it:    python auth_service/auth.py        -> http://127.0.0.1:5001
Main app:  node app.js                        -> http://127.0.0.1:3000

Alumni Hub is a HYBRID project. The main application is JavaScript
(Express), but ONE part stays in Python on purpose: authentication.
This small Flask service is the ONLY place that touches passwords:

    GET/POST  /login            - login page + credential check
    GET/POST  /register         - registration page + account creation
    GET/POST  /change-password  - change password page
    GET       /logout           - hands over to the Express logout

Why keep auth in Python? Passwords in the shared SQLite database are
hashed with Werkzeug's scrypt (generate_password_hash). Only Werkzeug
can verify those hashes, so login/registration must live here. The
Express app never sees or checks a password - it only verifies the
signed TOKENS this service creates.

How the token handoff works:
    1. The user submits the login form to this service (port 5001).
    2. This service checks email + password against the SAME database
       the Express app uses (the local ../alumni_hub.db file, or the
       shared Turso cloud database when TURSO_DATABASE_URL is set).
    3. On success it builds a token:
           payload = {"uid": id, "email": ..., "role": ...,
                      "exp": now + 6 hours}
           token   = base64url(payload) + "." +
                     base64url(HMAC-SHA256(payload, AUTH_SECRET))
    4. The browser is redirected to the Express app:
           {APP_URL}/auth/callback?token=...
    5. Express verifies the signature with the same AUTH_SECRET, stores
       the token in an httpOnly cookie and opens the dashboard.
"""

import base64
import hashlib
import hmac
import json
import os
import sqlite3
import sys
import time
from urllib.parse import quote

from flask import Flask, redirect, render_template, request
from werkzeug.security import check_password_hash, generate_password_hash

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
# This file lives in auth_service/ - the project root is one level up.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Public URL of the Express app (where users are sent after login)
APP_URL = os.environ.get("APP_URL", "http://127.0.0.1:3000")

# Shared secret used to SIGN login tokens. The Express app verifies the
# signatures with the same secret (see config.js). Demo default - a real
# deployment would set the AUTH_SECRET environment variable.
AUTH_SECRET = os.environ.get("AUTH_SECRET", "alumni-hub-auth-secret")

# On Vercel the project folder is read-only, so the database lives in
# /tmp there (same pattern the Express app uses in config.js).
if os.environ.get("VERCEL"):
    DATABASE = "/tmp/alumni_hub.db"
else:
    DATABASE = os.path.join(BASE_DIR, "alumni_hub.db")

# Optional SHARED cloud database (Turso / libSQL). On Vercel this
# service and the Express app run as separate projects, each with its
# own /tmp - so a local SQLite file can never be shared between them,
# and new registrations used to never reach the main app. When
# TURSO_DATABASE_URL is set, BOTH services use the same remote
# database instead (the Express app reads the same variables in
# config.js). When it is not set, the local file above is used
# exactly as before.
TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL", "")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "")
USE_TURSO = bool(TURSO_DATABASE_URL)

PORT = 5001

app = Flask(__name__)


@app.context_processor
def inject_app_url():
    """Make APP_URL available in every template (navbar/footer links)."""
    return {"app_url": APP_URL}


@app.after_request
def cache_static_assets(response):
    """Let browsers actually cache this service's CSS / logo files.

    Flask's default for /static files is "Cache-Control: no-cache",
    so the login page's stylesheet was revalidated against the
    server on every single visit. The policy matches the main app:
    reuse the file for an hour without asking, then for up to a day
    a stale copy may be shown while a fresh one is fetched in the
    background (stale-while-revalidate). Only /static/ paths are
    touched - the HTML pages themselves stay uncached, as before.
    """
    if request.path.startswith("/static/"):
        response.headers["Cache-Control"] = (
            "public, max-age=3600, stale-while-revalidate=86400"
        )
    return response


# ---------------------------------------------------------------------------
# Database helpers (same database + same schema as the Express app)
# ---------------------------------------------------------------------------
# There are two ways to connect, behind ONE interface:
#   - default: a local SQLite file through the standard sqlite3 module
#   - Turso mode (TURSO_DATABASE_URL set): the remote libSQL database
#     through the `libsql` package, wrapped in the small adapter
#     classes below so the rest of this file - and seed.py - can use
#     it exactly like sqlite3, including reading row values by column
#     name (row["email"]). Plain libsql rows are tuples without column
#     names, which is the one gap the adapter fills.

class _TursoRow:
    """A row that supports row[0] AND row["email"], like sqlite3.Row."""

    def __init__(self, columns, values):
        self._columns = list(columns)
        self._values = tuple(values)

    def __getitem__(self, key):
        if isinstance(key, str):
            return self._values[self._columns.index(key)]
        return self._values[key]

    def __len__(self):
        return len(self._values)

    def __iter__(self):
        return iter(self._values)

    def keys(self):
        return list(self._columns)


class _TursoCursor:
    """Cursor wrapper whose fetch methods return _TursoRow objects."""

    def __init__(self, cursor):
        self._cursor = cursor
        description = cursor.description or ()
        self._columns = [col[0] for col in description]

    @property
    def lastrowid(self):
        return self._cursor.lastrowid

    def fetchone(self):
        row = self._cursor.fetchone()
        if row is None:
            return None
        return _TursoRow(self._columns, row)

    def fetchall(self):
        return [_TursoRow(self._columns, row)
                for row in self._cursor.fetchall()]


class _TursoConnection:
    """sqlite3-shaped wrapper around a libsql (Turso) connection."""

    def __init__(self, url, auth_token):
        import libsql  # only needed in Turso mode; see requirements.txt

        self._conn = libsql.connect(url, auth_token=auth_token)

    def execute(self, sql, params=()):
        return _TursoCursor(self._conn.execute(sql, tuple(params)))

    def executemany(self, sql, seq_of_params):
        return _TursoCursor(
            self._conn.executemany(sql, [tuple(p) for p in seq_of_params])
        )

    def executescript(self, script):
        return self._conn.executescript(script)

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()


def _connect():
    """Open a connection to the shared database (Turso or local file)."""
    if USE_TURSO:
        return _TursoConnection(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN)
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def get_db():
    """Open a connection whose rows can be read by column name.

    Deliberately does NOT run "PRAGMA foreign_keys = ON" on every
    request any more: against the shared cloud database every extra
    statement is a network round trip, and none of this service's
    request-time operations (read a user, insert a user + profile,
    update a password) depend on foreign-key enforcement - the
    inserts use ids that were just created or checked in the same
    request. Table setup (init_db, below) still sets the pragma on
    its own connection, and the Express app sets it on its side,
    where the cascading deletes live.
    """
    return _connect()


# The same 11 CREATE TABLE statements as models.js (IF NOT EXISTS, so
# running this is always safe). Kept here so this service can also boot
# on its own - e.g. on Vercel, where it may start before the JS app.
SCHEMA = """
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
    course   TEXT, branch TEXT, year TEXT, skills TEXT, bio TEXT
);
CREATE TABLE IF NOT EXISTS alumni_profile (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    company     TEXT, designation TEXT, experience TEXT, skills TEXT, bio TEXT
);
CREATE TABLE IF NOT EXISTS faculty_profile (
    user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    department    TEXT, designation TEXT, qualification TEXT, skills TEXT, bio TEXT
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
    location    TEXT, salary TEXT, description TEXT, deadline TEXT,
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


# Columns added to the users table after the first release (profile
# photos now live in the database itself - see models.js). Added here
# too, with the same idempotent check, because this service may boot
# before the Express app against a fresh shared database.
USER_PHOTO_COLUMNS = [
    ("photo_data", "TEXT"),
    ("photo_mime", "TEXT"),
    ("photo_updated_at", "INTEGER"),
]


def init_db():
    conn = _connect()
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SCHEMA)
        existing = {
            row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()
        }
        for name, col_type in USER_PHOTO_COLUMNS:
            if name not in existing:
                conn.execute(
                    f"ALTER TABLE users ADD COLUMN {name} {col_type}"
                )
        conn.commit()
    finally:
        conn.close()


# Create the tables on startup (safe: IF NOT EXISTS)
init_db()


def _seed_demo_data_if_empty():
    """Fill the demo data once, if the users table is still empty.

    Runs when the database can start out empty (on Vercel, or when the
    shared Turso database is used). The check is a plain COUNT(*) and
    every insert in seed.py is INSERT OR IGNORE, so this service and
    the Express app can never duplicate or crash each other's seeding.

    The demo data itself lives in ../seed.py. That file uses two small
    helpers from the old all-Python app's models module
    (models.init_db and models.get_raw_connection), so we register a
    tiny stand-in module under that name before importing it.
    """
    conn = get_db()
    try:
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    finally:
        conn.close()
    if count > 0:
        return

    import types

    def raw_connection():
        # seed.py reads rows by column name (row["id"]), like get_db();
        # _connect() gives it the Turso adapter or sqlite3 accordingly
        return _connect()

    models_shim = types.ModuleType("models")
    models_shim.get_raw_connection = raw_connection
    models_shim.init_db = init_db
    sys.modules.setdefault("models", models_shim)
    sys.path.insert(0, BASE_DIR)
    # When this service is deployed on its own (root = auth_service/),
    # the bundled copy auth_service/seed.py is used instead of ../seed.py
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        import seed

        seed.main()
    except Exception as exc:  # never let seeding crash the auth service
        print(f"WARNING: demo auto-seed failed ({exc}). "
              "Run 'node seed.js' in the main app folder instead.")


if os.environ.get("VERCEL") or USE_TURSO:
    _seed_demo_data_if_empty()


# Which profile table belongs to which role (used at registration)
PROFILE_TABLES = {
    "student": "student_profile",
    "alumni": "alumni_profile",
    "faculty": "faculty_profile",
}


# ---------------------------------------------------------------------------
# Token helpers (create + verify the signed login tokens)
# ---------------------------------------------------------------------------
def _b64url(data: bytes) -> str:
    """base64url-encode without padding (same alphabet Node uses)."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def make_token(user) -> str:
    """Create the signed token handed to the Express app after login."""
    payload = {
        "uid": user["id"],
        "email": user["email"],
        "role": user["role"],
        "exp": int(time.time()) + 6 * 3600,  # valid for 6 hours
    }
    payload_b64 = _b64url(json.dumps(payload).encode("utf-8"))
    signature = hmac.new(
        AUTH_SECRET.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256
    ).digest()
    return payload_b64 + "." + _b64url(signature)


def verify_token(token):
    """Return the token payload if signature + expiry are fine, else None."""
    try:
        payload_b64, sig_b64 = token.split(".")
        expected = _b64url(
            hmac.new(
                AUTH_SECRET.encode("utf-8"),
                payload_b64.encode("ascii"),
                hashlib.sha256,
            ).digest()
        )
        if not hmac.compare_digest(expected, sig_b64):
            return None
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def load_user(user_id):
    conn = get_db()
    try:
        return conn.execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return redirect("/login")


@app.route("/login", methods=["GET", "POST"])
def login():
    # A message can arrive in the URL (e.g. after registering, or when
    # the Express app rejected a token):  /login?kind=success&msg=...
    message = request.args.get("msg", "")
    kind = request.args.get("kind", "info")
    email = ""

    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        conn = get_db()
        try:
            user = conn.execute(
                "SELECT * FROM users WHERE email = ?", (email,)
            ).fetchone()
        finally:
            conn.close()

        # Password check happens HERE and nowhere else (Werkzeug scrypt)
        if user is None or not check_password_hash(user["password_hash"], password):
            message, kind = "Invalid email or password.", "danger"
        elif not user["is_active"]:
            message = ("Your account has been blocked by the admin. "
                       "Please contact the admin.")
            kind = "danger"
        else:
            # Success: create the token and hand over to the Express app
            token = make_token(user)
            return redirect(f"{APP_URL}/auth/callback?token={token}")

    return render_template("login.html", message=message, kind=kind, email=email)


# ---------------------------------------------------------------------------
# Register
# ---------------------------------------------------------------------------
@app.route("/register", methods=["GET", "POST"])
def register():
    message = ""
    kind = "info"

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        phone = request.form.get("phone", "").strip()
        password = request.form.get("password", "")
        role = request.form.get("role", "")

        if not name or not email or not password:
            message, kind = "Please fill all required fields.", "danger"
        elif role not in PROFILE_TABLES:
            message, kind = "Please choose a valid role.", "danger"
        elif len(password) < 6:
            message, kind = "Password must be at least 6 characters long.", "danger"
        else:
            conn = get_db()
            try:
                existing = conn.execute(
                    "SELECT id FROM users WHERE email = ?", (email,)
                ).fetchone()
                if existing:
                    message = "An account with this email already exists. Please login."
                    kind = "warning"
                else:
                    cur = conn.execute(
                        "INSERT INTO users (name, email, password_hash, role, phone)"
                        " VALUES (?, ?, ?, ?, ?)",
                        (name, email, generate_password_hash(password),
                         role, phone or None),
                    )
                    # Create the empty role-profile row for the new user
                    conn.execute(
                        f"INSERT INTO {PROFILE_TABLES[role]} (user_id) VALUES (?)",
                        (cur.lastrowid,),
                    )
                    conn.commit()
                    return redirect(
                        "/login?kind=success&msg="
                        + quote("Account created successfully. Please login.")
                    )
            finally:
                conn.close()

    return render_template("register.html", message=message, kind=kind)


# ---------------------------------------------------------------------------
# Change password
# ---------------------------------------------------------------------------
@app.route("/change-password", methods=["GET", "POST"])
def change_password():
    # The user arrives from the Express app with their login token in
    # the URL (?token=...), because the login cookie belongs to the
    # Express app's pages - the token proves who they are here too.
    if request.method == "POST":
        token = request.form.get("token", "")
    else:
        token = request.args.get("token", "")

    payload = verify_token(token)
    if payload is None:
        return redirect(
            "/login?kind=danger&msg="
            + quote("Please login first to change your password.")
        )

    # ONE connection for the whole request: the user row is read from
    # it and, on a successful POST, the password UPDATE is written
    # through it too. This used to open a second connection (load_user
    # + a fresh get_db) - against the shared cloud database each new
    # connection's first statement is another round trip.
    conn = get_db()
    try:
        user = conn.execute(
            "SELECT * FROM users WHERE id = ?", (payload["uid"],)
        ).fetchone()
        if user is None or not user["is_active"]:
            return redirect(
                "/login?kind=danger&msg="
                + quote("Account not found or blocked. Please contact admin.")
            )

        message = ""
        kind = "info"
        if request.method == "POST":
            current = request.form.get("current_password", "")
            new = request.form.get("new_password", "")
            confirm = request.form.get("confirm_password", "")

            if not check_password_hash(user["password_hash"], current):
                message, kind = "Current password is incorrect.", "danger"
            elif len(new) < 6:
                message, kind = "New password must be at least 6 characters long.", "danger"
            elif new != confirm:
                message, kind = "New password and confirm password do not match.", "danger"
            else:
                conn.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (generate_password_hash(new), user["id"]),
                )
                conn.commit()
                # Back to the Express app (the same token is still valid)
                return redirect(
                    f"{APP_URL}/auth/callback?token={token}&msg="
                    + quote("Password changed successfully.")
                )

        return render_template(
            "change_password.html", user=user, token=token,
            message=message, kind=kind,
        )
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------
@app.route("/logout")
def logout():
    # The login cookie is owned by the Express app, so logging out
    # simply means sending the browser to the Express /logout route,
    # which clears the cookie.
    return redirect(f"{APP_URL}/logout")


# Exported for Vercel's Python runtime; started directly below locally
application = app

if __name__ == "__main__":
    print(f"Alumni Hub AUTH service running at http://127.0.0.1:{PORT}")
    print(f"After login, users are sent to the main app: {APP_URL}")
    app.run(host="127.0.0.1", port=PORT, debug=False)
