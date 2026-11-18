"use strict";
/*
 * config.js - Project settings for Alumni Hub (main Express app)
 *
 * All the basic configuration of the main app lives in this one file so
 * it is easy to find and change. app.js, models.js and seed.js read
 * their values from here.
 *
 * Alumni Hub is a HYBRID project:
 *   - this Express app (JavaScript, port 3000) serves almost everything
 *   - a small Flask service in auth_service/ (Python, port 5001) handles
 *     ONLY login / register / change-password, because password hashing
 *     (Werkzeug scrypt) lives there. The two apps share one SQLite file
 *     and one shared secret (AUTH_SECRET) used to sign login tokens.
 */

const path = require("path");

// Base folder of the project (the folder where this file lives)
const BASE_DIR = __dirname;

// Port of THIS Express app. Login links etc. live on the auth service.
const PORT = process.env.PORT || 3000;

// Public URL of this app and of the Python auth service. The auth
// service redirects the browser back to APP_URL after a login, and this
// app redirects guests to AUTH_SERVICE_URL when they must log in.
const APP_URL = process.env.APP_URL || "http://127.0.0.1:3000";
const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || "http://127.0.0.1:5001";

// Shared secret used to sign the login tokens that the Flask auth
// service creates and this app verifies (HMAC-SHA256). The SAME value
// must be set in auth_service/auth.py. It is a demo default - a real
// deployment would set the AUTH_SECRET environment variable.
const AUTH_SECRET = process.env.AUTH_SECRET || "alumni-hub-auth-secret";

// On Vercel the project folder is read-only and storage is temporary,
// so the database and uploads must live in /tmp there. Locally (and on
// normal hosting) everything stays inside the project folder as usual.
const ON_VERCEL = Boolean(process.env.VERCEL);
const DATABASE =
  process.env.DATABASE_PATH ||
  (ON_VERCEL
    ? "/tmp/alumni_hub.db"
    : path.join(BASE_DIR, "alumni_hub.db"));
const UPLOAD_DIR = ON_VERCEL
  ? "/tmp/uploads"
  : path.join(BASE_DIR, "uploads");

// Optional SHARED cloud database (Turso / libSQL). On Vercel the two
// services run as separate projects, so a local SQLite file can never
// be shared between them (each project has its own /tmp) - which is
// why new registrations used to vanish before reaching the main app.
// When TURSO_DATABASE_URL is set, BOTH services use the same remote
// database instead of a local file (see models.js and auth.py). When
// it is not set, nothing changes: the local file above is used.
// TURSO_AUTH_TOKEN is the access token of that database.
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

// Only these image types are allowed for profile pictures
const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg"];

// Maximum upload size = 2 MB
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024;

module.exports = {
  BASE_DIR,
  PORT,
  APP_URL,
  AUTH_SERVICE_URL,
  AUTH_SECRET,
  DATABASE,
  UPLOAD_DIR,
  TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN,
  ALLOWED_EXTENSIONS,
  MAX_UPLOAD_SIZE,
  ON_VERCEL,
};
