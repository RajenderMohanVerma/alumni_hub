"use strict";
/*
 * app.js - Main application file for Alumni Hub (Express / JavaScript).
 *
 * Run the main app:      node app.js           -> http://127.0.0.1:3000
 * Run the auth service:  python auth_service/auth.py   (port 5001)
 *
 * Alumni Hub is a HYBRID app:
 *   - THIS Express app serves almost every page: home, dashboards,
 *     profiles, member search, connections, chat, jobs, announcements,
 *     notifications, the FAQ page and the admin panel. Dashboards show
 *     KNN-based "Suggested for You" recommendations (see recommend.js).
 *   - A small Flask service (auth_service/auth.py) handles ONLY login,
 *     register and change-password, because password hashing (Werkzeug
 *     scrypt) is kept 100% in Python. This app NEVER checks a password.
 *
 * How login works (token handoff):
 *   1. Guest clicks Login -> redirected to the Flask service (port 5001).
 *   2. Flask checks email + password against the shared SQLite database
 *      and creates a signed token:  base64url(JSON) + "." + HMAC-SHA256.
 *   3. Flask redirects the browser to /auth/callback?token=... here.
 *   4. This app verifies the token signature + expiry, stores it in an
 *      httpOnly cookie ("ah_token") and redirects to /dashboard.
 *   5. On every request the auth middleware verifies the cookie again
 *      and loads the FRESH user row from the database - so when an
 *      admin blocks or deletes a user, it takes effect immediately.
 *
 * The file is organised in numbered sections:
 *   1. Setup                 6. Auth routes (handoff, logout)
 *   2. Token helpers         7. Dashboard + profiles
 *   3. Flash messages        8. Members, connections, chat
 *   4. Template helpers      9. Jobs
 *   5. Public pages         10. Announcements, notifications, admin
 *                              11. Error pages + start server
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");

const config = require("./config");
const models = require("./models");
const recommend = require("./recommend");

// ===========================================================================
// 1. Setup
// ===========================================================================
const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Read HTML form data (req.body) and cookies (req.cookies)
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Files in public/ (CSS, JS, images) are served directly
app.use(express.static(path.join(__dirname, "public")));

// Create the tables and the upload folder if they do not exist yet
models.initDb();
fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });

// On Vercel - and whenever the shared Turso database is used - the
// database can start out empty, so fill the demo data on boot whenever
// the users table is empty (same idea as the auth service's seeding).
// seedDemoData() only uses INSERT OR IGNORE, and a failure here is
// logged instead of crashing the boot, so the two services can never
// break each other even if they seed at the same moment.
if (config.ON_VERCEL || config.TURSO_DATABASE_URL) {
  const userCount = models
    .openDb()
    .prepare("SELECT COUNT(*) AS c FROM users")
    .get().c;
  if (userCount === 0) {
    try {
      require("./seed").seedDemoData();
    } catch (err) {
      console.error("WARNING: demo auto-seed failed:", err.message);
    }
  }
}

// Profile-picture upload settings (multer): the file is saved as
// "user_<id>.<ext>" inside the uploads folder, max 2 MB.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `user_${req.user.id}${ext}`);
    },
  }),
  limits: { fileSize: config.MAX_UPLOAD_SIZE },
});

// ===========================================================================
// 2. Token helpers (verifying the tokens created by the Flask auth service)
// ===========================================================================
/**
 * Verify a login token and return its payload {uid, email, role, exp},
 * or null when the signature is wrong or the token has expired.
 * The signature check uses timingSafeEqual (constant-time compare).
 */
function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  const expected = crypto
    .createHmac("sha256", config.AUTH_SECRET)
    .update(payloadB64)
    .digest();
  let given;
  try {
    given = Buffer.from(sigB64, "base64url");
  } catch (err) {
    return null;
  }
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    );
  } catch (err) {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return null; // token expired (tokens live for 6 hours)
  }
  return payload;
}

// ===========================================================================
// 3. Flash messages (one message shown once, after a redirect)
// ===========================================================================
// There are no server-side sessions in this app, so a flash message is
// carried to the next page in a small cookie: set the cookie, redirect,
// and the next page that RENDERS clears it. Messages shown on a page
// that is rendered immediately just use flashNow().
function flashRedirect(res, type, message) {
  res.cookie(
    "ah_flash",
    encodeURIComponent(JSON.stringify({ type, message })),
    { httpOnly: true, path: "/" }
  );
}
function flashNow(res, type, message) {
  res.locals.flash = { type, message };
}

// Read the flash cookie (if any) into res.locals for the templates.
// The cookie is cleared by the first res.render() that happens.
app.use((req, res, next) => {
  res.locals.flash = null;
  if (req.cookies.ah_flash) {
    try {
      res.locals.flash = JSON.parse(
        decodeURIComponent(req.cookies.ah_flash)
      );
    } catch (err) {
      /* ignore a broken flash cookie */
    }
    const originalRender = res.render.bind(res);
    res.render = function (...args) {
      res.clearCookie("ah_flash", { path: "/" });
      return originalRender(...args);
    };
  }
  next();
});

// ===========================================================================
// 4. Template helpers + the "who is logged in?" middleware
// ===========================================================================
// URL of the picture to show for a user (uploaded photo or default).
function avatarUrl(user) {
  if (user && user.profile_pic) return "/uploads/" + user.profile_pic;
  return "/images/default-avatar.svg";
}

// "2026-11-18 10:15:00" (SQLite localtime) -> "18 Nov 2026, 10:15 AM"
function datetimeformat(value) {
  if (!value) return "";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const d = new Date(String(value).replace(" ", "T"));
  if (isNaN(d)) return value;
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${hours}:${minutes} ${ampm}`;
}

// "2026-12-31" -> "31 Dec 2026" (job deadline display)
function dateformat(value) {
  if (!value) return "No deadline";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const d = new Date(String(value).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return value;
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Shorten a long text the same way Jinja's truncate filter does.
function truncate(text, length = 90) {
  const s = text == null ? "" : String(text);
  if (s.length <= length + 5) return s; // Jinja keeps a small leeway
  return s.slice(0, length - 3).trimEnd() + "...";
}

// "student" -> "Student" (like Jinja's capitalize: rest lower-cased)
function capitalize(text) {
  const s = text == null ? "" : String(text);
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Which navbar link should look "active" for the current path? This
// mirrors the old base.html, which grouped several pages together
// (e.g. every profile page highlights the "Members" link).
function computeNavSection(p) {
  if (p === "/") return "home";
  if (p === "/about") return "about";
  if (p === "/services") return "services";
  if (p === "/contact") return "contact";
  if (p === "/faq") return "faq";
  if (p === "/dashboard") return "dashboard";
  if (p === "/search" || p.startsWith("/profile")) return "members";
  if (p === "/connections") return "connections";
  if (p === "/chat" || p.startsWith("/chat/")) return "chat";
  if (
    p === "/jobs" || p.startsWith("/jobs/") ||
    p === "/my-jobs" || p === "/my-applications"
  ) return "jobs";
  if (p === "/announcements") return "announcements";
  if (p === "/notifications") return "notifications";
  if (p === "/admin") return "admin_dashboard";
  if (p === "/admin/users") return "admin_users";
  if (p === "/admin/jobs") return "admin_jobs";
  if (p === "/admin/messages") return "admin_messages";
  return "";
}

// Runs on EVERY request: verify the token cookie, load the fresh user
// row, and prepare everything the base layout needs (badges etc.).
app.use((req, res, next) => {
  req.user = null;
  res.locals.currentUser = null;
  res.locals.unreadNotifications = 0;
  res.locals.unreadMessages = 0;
  res.locals.currentYear = new Date().getFullYear();
  res.locals.authServiceUrl = config.AUTH_SERVICE_URL;
  res.locals.navSection = computeNavSection(req.path);
  // helpers available inside every EJS template:
  res.locals.avatarUrl = avatarUrl;
  res.locals.datetimeformat = datetimeformat;
  res.locals.dateformat = dateformat;
  res.locals.truncate = truncate;
  res.locals.capitalize = capitalize;

  const payload = verifyToken(req.cookies.ah_token);
  if (payload) {
    const user = models
      .openDb()
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(payload.uid);
    // The user must still exist and must not be blocked by the admin
    if (user && user.is_active) {
      req.user = user;
      res.locals.currentUser = user;
      res.locals.unreadNotifications = models.unreadNotificationCount(user.id);
      res.locals.unreadMessages = models.unreadMessageCount(user.id);
    }
  }
  next();
});

// ---------------------------------------------------------------------------
// Login / role guards (used by the protected routes below)
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  if (!req.user) {
    // Guests are sent to the Python auth service to log in
    return res.redirect(config.AUTH_SERVICE_URL + "/login");
  }
  next();
}

// Only allow some roles on a page, e.g. requireRole("admin")
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      flashRedirect(
        res, "danger", "You do not have permission to open that page."
      );
      return res.redirect("/dashboard");
    }
    next();
  };
}

// Connection status between the logged-in user and one other member:
// none / pending_sent / pending_received / accepted / rejected
function connectionStatus(db, meId, otherId) {
  const row = db
    .prepare(
      `SELECT * FROM connections
        WHERE (sender_id = ? AND receiver_id = ?)
           OR (sender_id = ? AND receiver_id = ?)`
    )
    .get(meId, otherId, otherId, meId);
  if (!row) return "none";
  if (row.status === "accepted") return "accepted";
  if (row.status === "rejected") return "rejected";
  return row.sender_id === meId ? "pending_sent" : "pending_received";
}

// Form fields that were left empty become null (SQL NULL), like Python.
function emptyToNull(value) {
  const v = (value == null ? "" : String(value)).trim();
  return v === "" ? null : v;
}

// ===========================================================================
// 5. Public pages
// ===========================================================================
// Home page - platform statistics + latest 3 jobs
app.get("/", (req, res) => {
  const db = models.openDb();
  const count = (sql) => db.prepare(sql).get().c;
  const stats = {
    students: count("SELECT COUNT(*) AS c FROM users WHERE role = 'student'"),
    alumni: count("SELECT COUNT(*) AS c FROM users WHERE role = 'alumni'"),
    faculty: count("SELECT COUNT(*) AS c FROM users WHERE role = 'faculty'"),
    jobs: count("SELECT COUNT(*) AS c FROM jobs"),
  };
  const latestJobs = db
    .prepare(
      `SELECT jobs.*, users.name AS poster_name FROM jobs
         JOIN users ON users.id = jobs.alumni_id
        ORDER BY jobs.id DESC LIMIT 3`
    )
    .all();
  res.render("home", { stats, latestJobs });
});

// About page - project information (static content)
app.get("/about", (req, res) => res.render("about"));

// Services page - what the platform offers (static content)
app.get("/services", (req, res) => res.render("services"));

// FAQ page - common questions, answered (static content)
app.get("/faq", (req, res) => res.render("faq"));

// Contact page - the form saves messages for the admin to read
app.get("/contact", (req, res) => res.render("contact"));

app.post("/contact", (req, res) => {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim();
  const subject = (req.body.subject || "").trim();
  const message = (req.body.message || "").trim();
  if (!name || !email || !message) {
    flashNow(res, "danger", "Please fill your name, email and message.");
    return res.render("contact");
  }
  models
    .openDb()
    .prepare(
      "INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)"
    )
    .run(name, email, emptyToNull(req.body.subject), message);
  flashNow(
    res, "success",
    "Thank you! Your message has been sent. We will reply soon."
  );
  res.render("contact");
});

// Uploaded profile pictures (login required, like the old app)
app.get("/uploads/:filename", requireAuth, (req, res) => {
  res.sendFile(path.join(config.UPLOAD_DIR, req.params.filename), (err) => {
    if (err) res.status(404).render("errors/404");
  });
});

// ===========================================================================
// 6. Auth routes - the handoff with the Python auth service
// ===========================================================================
// Login / Register links in the navbar come here first and simply
// bounce to the Flask service, which owns those pages.
app.get("/login", (req, res) =>
  res.redirect(config.AUTH_SERVICE_URL + "/login")
);
app.get("/register", (req, res) =>
  res.redirect(config.AUTH_SERVICE_URL + "/register")
);

// The Flask service sends the browser here after a successful login
// (and after a password change) with a signed token in the URL.
app.get("/auth/callback", (req, res) => {
  const payload = verifyToken(req.query.token);
  if (!payload) {
    return res.redirect(
      config.AUTH_SERVICE_URL +
        "/login?kind=danger&msg=" +
        encodeURIComponent("Your login link was invalid or expired. Please login again.")
    );
  }
  const user = models
    .openDb()
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(payload.uid);
  if (!user || !user.is_active) {
    return res.redirect(
      config.AUTH_SERVICE_URL +
        "/login?kind=danger&msg=" +
        encodeURIComponent("Account not found or blocked. Please contact admin.")
    );
  }
  // Token is good: keep it in an httpOnly cookie (JavaScript on the
  // page cannot read it, which protects it from script attacks).
  res.cookie("ah_token", req.query.token, {
    httpOnly: true,
    path: "/",
    maxAge: 6 * 3600 * 1000, // same 6 hours as the token itself
  });
  if (req.query.msg) {
    flashRedirect(res, "success", req.query.msg);
  } else {
    flashRedirect(res, "success", `Welcome back, ${user.name}!`);
  }
  res.redirect("/dashboard");
});

// Change password lives on the Flask service. Cookies are not shared
// between the two ports in the URL, so the current token travels in
// the link itself; Flask verifies it the same way this app does.
app.get("/change-password", requireAuth, (req, res) => {
  res.redirect(
    config.AUTH_SERVICE_URL +
      "/change-password?token=" +
      encodeURIComponent(req.cookies.ah_token || "")
  );
});

// Logout: just forget the token cookie and go back home.
app.get("/logout", (req, res) => {
  res.clearCookie("ah_token", { path: "/" });
  flashRedirect(res, "info", "You have been logged out.");
  res.redirect("/");
});

// ===========================================================================
// 7. Dashboard + profiles
// ===========================================================================
/**
 * How complete is a profile, as a percentage? Eight things are checked:
 * name, phone and photo (users table) + bio and skills + the three
 * role-specific fields of the role's profile table. Shown as a progress
 * meter on the student / alumni dashboards.
 */
function profileCompleteness(user, profile) {
  const roleFields = {
    student: ["course", "branch", "year"],
    alumni: ["company", "designation", "experience"],
    faculty: ["department", "designation", "qualification"],
  };
  const filled = (value) => (value && String(value).trim() ? 1 : 0);
  let done = filled(user.name) + filled(user.phone) + filled(user.profile_pic);
  let total = 3;
  if (profile) {
    done += filled(profile.bio) + filled(profile.skills);
    total += 2;
    for (const field of roleFields[user.role] || []) {
      done += filled(profile[field]);
      total += 1;
    }
  } else {
    total += 2 + (roleFields[user.role] || []).length;
  }
  return Math.round((done / total) * 100);
}

// Dashboard - a different page (and different numbers) per role.
// Every dashboard also gets KNN recommendations (see recommend.js):
// "Suggested for You" people, and for students also matching jobs.
app.get("/dashboard", requireAuth, (req, res) => {
  const db = models.openDb();
  const user = req.user;
  if (user.role === "admin") return res.redirect("/admin");

  const profile = models.getProfile(user.id, user.role);
  const suggestions = recommend.recommendPeople(db, user, 6);
  const profileComplete = profileCompleteness(user, profile);
  const count = (sql, ...params) => db.prepare(sql).get(...params).c;
  let stats;

  if (user.role === "student") {
    stats = {
      connections: count(
        `SELECT COUNT(*) AS c FROM connections
          WHERE status = 'accepted' AND (sender_id = ? OR receiver_id = ?)`,
        user.id, user.id
      ),
      jobs: count("SELECT COUNT(*) AS c FROM jobs"),
      applications: count(
        "SELECT COUNT(*) AS c FROM applications WHERE student_id = ?",
        user.id
      ),
      announcements: count("SELECT COUNT(*) AS c FROM announcements"),
    };
    const jobSuggestions = recommend.recommendJobs(db, user, 3);
    return res.render("dashboard_student", {
      profile, stats, suggestions, jobSuggestions, profileComplete,
    });
  }

  if (user.role === "alumni") {
    stats = {
      connections: count(
        `SELECT COUNT(*) AS c FROM connections
          WHERE status = 'accepted' AND (sender_id = ? OR receiver_id = ?)`,
        user.id, user.id
      ),
      myJobs: count(
        "SELECT COUNT(*) AS c FROM jobs WHERE alumni_id = ?", user.id
      ),
      applicants: count(
        `SELECT COUNT(*) AS c FROM applications
          JOIN jobs ON jobs.id = applications.job_id
          WHERE jobs.alumni_id = ?`,
        user.id
      ),
      announcements: count("SELECT COUNT(*) AS c FROM announcements"),
    };
    return res.render("dashboard_alumni", {
      profile, stats, suggestions, profileComplete,
    });
  }

  // faculty
  stats = {
    students: count("SELECT COUNT(*) AS c FROM users WHERE role = 'student'"),
    alumni: count("SELECT COUNT(*) AS c FROM users WHERE role = 'alumni'"),
    myAnnouncements: count(
      "SELECT COUNT(*) AS c FROM announcements WHERE faculty_id = ?",
      user.id
    ),
    announcements: count("SELECT COUNT(*) AS c FROM announcements"),
  };
  return res.render("dashboard_faculty", { profile, stats, suggestions });
});

// Edit own profile - basic details + role details + profile picture
app.get("/profile/edit", requireAuth, (req, res) => {
  const profile = models.getProfile(req.user.id, req.user.role);
  res.render("edit_profile", { profile });
});

app.post("/profile/edit", requireAuth, (req, res, next) => {
  upload.single("profile_pic")(req, res, (err) => {
    if (err) req.uploadError = true; // e.g. file bigger than 2 MB
    next();
  });
}, (req, res) => {
  const db = models.openDb();
  const user = req.user;

  // 1) Basic details (name + phone live in the users table)
  db.prepare("UPDATE users SET name = ?, phone = ? WHERE id = ?").run(
    (req.body.name || "").trim(),
    emptyToNull(req.body.phone),
    user.id
  );

  // 2) Profile picture (only png / jpg files are accepted)
  if (req.file) {
    const ext = path.extname(req.file.filename).toLowerCase();
    if (config.ALLOWED_EXTENSIONS.includes(ext)) {
      db.prepare("UPDATE users SET profile_pic = ? WHERE id = ?").run(
        req.file.filename, user.id
      );
    } else {
      fs.unlink(req.file.path, () => {});
      flashRedirect(
        res, "warning", "Only PNG or JPG images are allowed as profile picture."
      );
      return res.redirect("/profile/edit");
    }
  } else if (req.uploadError) {
    flashRedirect(
      res, "warning", "Only PNG or JPG images up to 2 MB are allowed."
    );
    return res.redirect("/profile/edit");
  }

  // 3) Role-specific details live in the role's own profile table
  const table = models.PROFILE_TABLES[user.role];
  if (table) {
    const fieldsByRole = {
      student_profile: ["course", "branch", "year", "skills", "bio"],
      alumni_profile: ["company", "designation", "experience", "skills", "bio"],
      faculty_profile: ["department", "designation", "qualification", "skills", "bio"],
    };
    const fields = fieldsByRole[table];
    const values = fields.map((f) => emptyToNull(req.body[f]));
    db.prepare(
      `INSERT INTO ${table} (user_id, ${fields.join(", ")})
       VALUES (?, ${fields.map(() => "?").join(", ")})
       ON CONFLICT(user_id) DO UPDATE SET
         ${fields.map((f) => `${f} = excluded.${f}`).join(", ")}`
    ).run(user.id, ...values);
  }

  flashRedirect(res, "success", "Profile updated successfully.");
  res.redirect("/profile/" + user.id);
});

// View any member's profile (registered AFTER /profile/edit on purpose:
// Express tries routes in order, so "/profile/edit" must come first,
// otherwise "edit" would be mistaken for a user id)
app.get("/profile/:userId", requireAuth, (req, res) => {
  const db = models.openDb();
  const person = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(req.params.userId);
  if (!person) return res.status(404).render("errors/404");
  const profile = models.getProfile(person.id, person.role);
  const status = connectionStatus(db, req.user.id, person.id);
  res.render("profile", { person, profile, connectionStatus: status });
});


// ===========================================================================
// 8. Members, connections and chat
// ===========================================================================
// Member directory - search box (client-side live search) + role filter
app.get("/search", requireAuth, (req, res) => {
  const db = models.openDb();
  const role = req.query.role || "";
  let sql =
    `SELECT users.*,
            COALESCE(sp.skills, ap.skills, fp.skills) AS skills,
            COALESCE(sp.bio, ap.bio, fp.bio) AS bio
       FROM users
       LEFT JOIN student_profile sp ON sp.user_id = users.id
       LEFT JOIN alumni_profile ap ON ap.user_id = users.id
       LEFT JOIN faculty_profile fp ON fp.user_id = users.id
      WHERE users.id != ? AND users.role != 'admin'`;
  const params = [req.user.id];
  if (["student", "alumni", "faculty"].includes(role)) {
    sql += " AND users.role = ?";
    params.push(role);
  }
  sql += " ORDER BY users.name";
  const members = db.prepare(sql).all(...params);

  // connection status of the logged-in user with every listed member
  const statuses = {};
  for (const m of members) {
    statuses[m.id] = connectionStatus(db, req.user.id, m.id);
  }
  res.render("search", { members, role, statuses });
});

// Send a connection request
app.post("/connect/:userId", requireAuth, (req, res) => {
  const db = models.openDb();
  const otherId = parseInt(req.params.userId, 10);
  if (otherId === req.user.id) return res.redirect("/search");
  const other = db.prepare("SELECT * FROM users WHERE id = ?").get(otherId);
  if (!other) return res.status(404).render("errors/404");
  try {
    db.prepare(
      "INSERT INTO connections (sender_id, receiver_id, status) VALUES (?, ?, 'pending')"
    ).run(req.user.id, otherId);
    models.createNotification(
      otherId,
      `${req.user.name} sent you a connection request.`,
      "/connections"
    );
    flashRedirect(res, "success", `Connection request sent to ${other.name}.`);
  } catch (err) {
    // UNIQUE constraint failed -> a connection row already exists
    flashRedirect(res, "info", "You already have a connection with this member.");
  }
  res.redirect("/search");
});

// My connections - pending requests + accepted connections
app.get("/connections", requireAuth, (req, res) => {
  const db = models.openDb();
  const me = req.user.id;
  const pending = db
    .prepare(
      `SELECT connections.*, users.name, users.email, users.role,
              users.profile_pic
         FROM connections JOIN users ON users.id = connections.sender_id
        WHERE connections.receiver_id = ? AND connections.status = 'pending'
        ORDER BY connections.id DESC`
    )
    .all(me);
  const accepted = db
    .prepare(
      `SELECT connections.*,
              CASE WHEN connections.sender_id = ? THEN r.name ELSE s.name END AS name,
              CASE WHEN connections.sender_id = ? THEN r.email ELSE s.email END AS email,
              CASE WHEN connections.sender_id = ? THEN r.role ELSE s.role END AS role,
              CASE WHEN connections.sender_id = ? THEN r.profile_pic ELSE s.profile_pic END AS profile_pic,
              CASE WHEN connections.sender_id = ? THEN connections.receiver_id ELSE connections.sender_id END AS other_id
         FROM connections
         JOIN users s ON s.id = connections.sender_id
         JOIN users r ON r.id = connections.receiver_id
        WHERE connections.status = 'accepted'
          AND (connections.sender_id = ? OR connections.receiver_id = ?)
        ORDER BY connections.id DESC`
    )
    .all(me, me, me, me, me, me, me);
  res.render("connections", { pending, accepted });
});

// Accept or reject a pending request
app.post("/connections/respond/:connId", requireAuth, (req, res) => {
  const db = models.openDb();
  const conn = db
    .prepare("SELECT * FROM connections WHERE id = ?")
    .get(req.params.connId);
  const action = req.body.action;
  if (conn && conn.receiver_id === req.user.id && conn.status === "pending") {
    if (action === "accept" || action === "reject") {
      const newStatus = action === "accept" ? "accepted" : "rejected";
      db.prepare("UPDATE connections SET status = ? WHERE id = ?").run(
        newStatus, conn.id
      );
      if (newStatus === "accepted") {
        models.createNotification(
          conn.sender_id,
          `${req.user.name} accepted your connection request.`,
          "/connections"
        );
        flashRedirect(res, "success", "Connection accepted.");
      } else {
        flashRedirect(res, "info", "Connection request rejected.");
      }
    }
  }
  res.redirect("/connections");
});

// Chat inbox - one row per person, with last message + unread count
app.get("/chat", requireAuth, (req, res) => {
  const db = models.openDb();
  const me = req.user.id;
  const chats = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.profile_pic,
              (SELECT body FROM messages
                WHERE (sender_id = u.id AND receiver_id = ?)
                   OR (sender_id = ? AND receiver_id = u.id)
                ORDER BY id DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM messages
                WHERE (sender_id = u.id AND receiver_id = ?)
                   OR (sender_id = ? AND receiver_id = u.id)
                ORDER BY id DESC LIMIT 1) AS last_time,
              (SELECT COUNT(*) FROM messages
                WHERE sender_id = u.id AND receiver_id = ?
                  AND is_read = 0) AS unread
         FROM users u
        WHERE u.id IN (
                SELECT sender_id FROM messages WHERE receiver_id = ?
                UNION
                SELECT receiver_id FROM messages WHERE sender_id = ?
              )
        ORDER BY last_time DESC`
    )
    .all(me, me, me, me, me, me, me);
  res.render("chat", { chats });
});

// One conversation - opening it marks the other person's messages read
app.get("/chat/:userId", requireAuth, (req, res) => {
  const db = models.openDb();
  const other = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(req.params.userId);
  if (!other || other.id === req.user.id) {
    return res.redirect("/chat");
  }
  const messages = db
    .prepare(
      `SELECT * FROM messages
        WHERE (sender_id = ? AND receiver_id = ?)
           OR (sender_id = ? AND receiver_id = ?)
        ORDER BY id`
    )
    .all(req.user.id, other.id, other.id, req.user.id);
  db.prepare(
    "UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?"
  ).run(other.id, req.user.id);
  res.render("conversation", { other, messages });
});

app.post("/chat/:userId", requireAuth, (req, res) => {
  const db = models.openDb();
  const other = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(req.params.userId);
  if (!other || other.id === req.user.id) {
    return res.redirect("/chat");
  }
  const body = (req.body.body || "").trim();
  if (body) {
    db.prepare(
      "INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)"
    ).run(req.user.id, other.id, body);
  }
  res.redirect("/chat/" + other.id);
});

// ===========================================================================
// 9. Jobs
// ===========================================================================
// Job list (with live search box) - newest first
app.get("/jobs", requireAuth, (req, res) => {
  const jobs = models
    .openDb()
    .prepare(
      `SELECT jobs.*, users.name AS poster_name FROM jobs
         JOIN users ON users.id = jobs.alumni_id
        ORDER BY jobs.id DESC`
    )
    .all();
  res.render("jobs", { jobs });
});

// Post a job (alumni only)
app.get("/jobs/new", requireAuth, requireRole("alumni"), (req, res) => {
  res.render("post_job", { job: null });
});

app.post("/jobs/new", requireAuth, requireRole("alumni"), (req, res) => {
  const db = models.openDb();
  const info = db
    .prepare(
      `INSERT INTO jobs (alumni_id, title, company, location, salary,
                         description, deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      (req.body.title || "").trim(),
      (req.body.company || "").trim(),
      emptyToNull(req.body.location),
      emptyToNull(req.body.salary),
      emptyToNull(req.body.description),
      emptyToNull(req.body.deadline)
    );
  // Tell every student about the new job
  const students = db
    .prepare("SELECT id FROM users WHERE role = 'student' AND is_active = 1")
    .all();
  for (const s of students) {
    models.createNotification(
      s.id,
      `New job posted: ${req.body.title} at ${req.body.company}`,
      "/jobs/" + info.lastInsertRowid
    );
  }
  flashRedirect(res, "success", "Job posted successfully.");
  res.redirect("/jobs");
});

// Job detail + apply button (students)
app.get("/jobs/:jobId", requireAuth, (req, res) => {
  const db = models.openDb();
  const job = db
    .prepare(
      `SELECT jobs.*, users.name AS poster_name, users.email AS poster_email
         FROM jobs JOIN users ON users.id = jobs.alumni_id
        WHERE jobs.id = ?`
    )
    .get(req.params.jobId);
  if (!job) return res.status(404).render("errors/404");
  let applied = false;
  if (req.user.role === "student") {
    applied = Boolean(
      db.prepare(
        "SELECT id FROM applications WHERE job_id = ? AND student_id = ?"
      ).get(job.id, req.user.id)
    );
  }
  res.render("job_detail", { job, applied });
});

// Apply to a job (students only)
app.post("/jobs/:jobId/apply", requireAuth, requireRole("student"), (req, res) => {
  const db = models.openDb();
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(req.params.jobId);
  if (!job) return res.status(404).render("errors/404");
  try {
    db.prepare(
      "INSERT INTO applications (job_id, student_id, cover_note) VALUES (?, ?, ?)"
    ).run(job.id, req.user.id, emptyToNull(req.body.cover_note));
    models.createNotification(
      job.alumni_id,
      `${req.user.name} applied for your job "${job.title}".`,
      "/jobs/" + job.id + "/applicants"
    );
    flashRedirect(res, "success", "Application submitted successfully.");
  } catch (err) {
    // UNIQUE constraint failed -> already applied
    flashRedirect(res, "info", "You have already applied for this job.");
  }
  res.redirect("/jobs/" + job.id);
});

// Edit a job (only the alumni who posted it)
app.get("/jobs/:jobId/edit", requireAuth, requireRole("alumni"), (req, res) => {
  const job = models
    .openDb()
    .prepare("SELECT * FROM jobs WHERE id = ? AND alumni_id = ?")
    .get(req.params.jobId, req.user.id);
  if (!job) {
    flashRedirect(res, "danger", "Job not found or not posted by you.");
    return res.redirect("/my-jobs");
  }
  res.render("post_job", { job });
});

app.post("/jobs/:jobId/edit", requireAuth, requireRole("alumni"), (req, res) => {
  const db = models.openDb();
  const job = db
    .prepare("SELECT * FROM jobs WHERE id = ? AND alumni_id = ?")
    .get(req.params.jobId, req.user.id);
  if (!job) {
    flashRedirect(res, "danger", "Job not found or not posted by you.");
    return res.redirect("/my-jobs");
  }
  db.prepare(
    `UPDATE jobs SET title = ?, company = ?, location = ?, salary = ?,
                     description = ?, deadline = ? WHERE id = ?`
  ).run(
    (req.body.title || "").trim(),
    (req.body.company || "").trim(),
    emptyToNull(req.body.location),
    emptyToNull(req.body.salary),
    emptyToNull(req.body.description),
    emptyToNull(req.body.deadline),
    job.id
  );
  flashRedirect(res, "success", "Job updated successfully.");
  res.redirect("/jobs/" + job.id);
});

// Delete a job (only the alumni who posted it)
app.post("/jobs/:jobId/delete", requireAuth, requireRole("alumni"), (req, res) => {
  models
    .openDb()
    .prepare("DELETE FROM jobs WHERE id = ? AND alumni_id = ?")
    .run(req.params.jobId, req.user.id);
  flashRedirect(res, "success", "Job deleted.");
  res.redirect("/my-jobs");
});

// Jobs posted by the logged-in alumni
app.get("/my-jobs", requireAuth, requireRole("alumni"), (req, res) => {
  const jobs = models
    .openDb()
    .prepare(
      `SELECT jobs.*,
              (SELECT COUNT(*) FROM applications
                WHERE applications.job_id = jobs.id) AS applicants
         FROM jobs WHERE alumni_id = ? ORDER BY id DESC`
    )
    .all(req.user.id);
  res.render("my_jobs", { jobs });
});

// Applicants of one job (only the alumni who posted it)
app.get("/jobs/:jobId/applicants", requireAuth, requireRole("alumni"), (req, res) => {
  const db = models.openDb();
  const job = db
    .prepare("SELECT * FROM jobs WHERE id = ? AND alumni_id = ?")
    .get(req.params.jobId, req.user.id);
  if (!job) {
    flashRedirect(res, "danger", "Job not found or not posted by you.");
    return res.redirect("/my-jobs");
  }
  const applicants = db
    .prepare(
      `SELECT applications.*, users.name, users.email, users.profile_pic
         FROM applications JOIN users ON users.id = applications.student_id
        WHERE applications.job_id = ? ORDER BY applications.id DESC`
    )
    .all(job.id);
  res.render("applicants", { job, applicants });
});

// Change an application's status (Applied / Shortlisted / Rejected)
app.post(
  "/applications/:appId/status",
  requireAuth,
  requireRole("alumni"),
  (req, res) => {
    const db = models.openDb();
    const application = db
      .prepare(
        `SELECT applications.*, jobs.title AS job_title,
                jobs.alumni_id AS alumni_id
           FROM applications JOIN jobs ON jobs.id = applications.job_id
          WHERE applications.id = ?`
      )
      .get(req.params.appId);
    const status = req.body.status;
    if (
      application &&
      application.alumni_id === req.user.id &&
      ["Applied", "Shortlisted", "Rejected"].includes(status)
    ) {
      db.prepare("UPDATE applications SET status = ? WHERE id = ?").run(
        status, application.id
      );
      models.createNotification(
        application.student_id,
        `Your application for "${application.job_title}" is now ${status}.`,
        "/my-applications"
      );
      flashRedirect(res, "success", "Application status updated.");
    }
    res.redirect("/jobs/" + (application ? application.job_id : "") + "/applicants");
  }
);

// Jobs the logged-in student has applied to
app.get("/my-applications", requireAuth, requireRole("student"), (req, res) => {
  const applications = models
    .openDb()
    .prepare(
      `SELECT applications.*, jobs.title, jobs.company, jobs.location
         FROM applications JOIN jobs ON jobs.id = applications.job_id
        WHERE applications.student_id = ? ORDER BY applications.id DESC`
    )
    .all(req.user.id);
  res.render("applied_jobs", { applications });
});

// ===========================================================================
// 10. Announcements, notifications and the admin panel
// ===========================================================================
// Announcements - everyone reads, faculty posts
app.get("/announcements", requireAuth, (req, res) => {
  const announcements = models
    .openDb()
    .prepare(
      `SELECT announcements.*, users.name AS author_name
         FROM announcements JOIN users ON users.id = announcements.faculty_id
        ORDER BY announcements.id DESC`
    )
    .all();
  res.render("announcements", { announcements });
});

app.post("/announcements", requireAuth, (req, res) => {
  // Only faculty may post (the form is only shown to faculty; this
  // check protects against hand-made requests)
  if (req.user.role !== "faculty") {
    flashRedirect(res, "danger", "You do not have permission to open that page.");
    return res.redirect("/announcements");
  }
  const title = (req.body.title || "").trim();
  if (title) {
    models
      .openDb()
      .prepare(
        "INSERT INTO announcements (faculty_id, title, body) VALUES (?, ?, ?)"
      )
      .run(req.user.id, title, emptyToNull(req.body.body));
    flashRedirect(res, "success", "Announcement posted.");
  }
  res.redirect("/announcements");
});

// Notifications - opening this page marks all of them as read
app.get("/notifications", requireAuth, (req, res) => {
  const db = models.openDb();
  const notifications = db
    .prepare(
      "SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC"
    )
    .all(req.user.id);
  db.prepare(
    "UPDATE notifications SET is_read = 1 WHERE user_id = ?"
  ).run(req.user.id);
  res.render("notifications", { notifications });
});

// ---- Admin panel (admin role only) ----
// Admin dashboard - totals + data for the Chart.js bar chart
app.get("/admin", requireAuth, requireRole("admin"), (req, res) => {
  const db = models.openDb();
  const count = (sql) => db.prepare(sql).get().c;
  const counts = {
    total_users: count("SELECT COUNT(*) AS c FROM users"),
    students: count("SELECT COUNT(*) AS c FROM users WHERE role = 'student'"),
    alumni: count("SELECT COUNT(*) AS c FROM users WHERE role = 'alumni'"),
    faculty: count("SELECT COUNT(*) AS c FROM users WHERE role = 'faculty'"),
    jobs: count("SELECT COUNT(*) AS c FROM jobs"),
    applications: count("SELECT COUNT(*) AS c FROM applications"),
    announcements: count("SELECT COUNT(*) AS c FROM announcements"),
    contact_messages: count("SELECT COUNT(*) AS c FROM contact_messages"),
  };
  res.render("admin/dashboard", { counts });
});

// Admin: all users, with optional search text
app.get("/admin/users", requireAuth, requireRole("admin"), (req, res) => {
  const q = (req.query.q || "").trim();
  let users;
  if (q) {
    const like = "%" + q + "%";
    users = models
      .openDb()
      .prepare(
        `SELECT * FROM users
          WHERE name LIKE ? OR email LIKE ? ORDER BY role, name`
      )
      .all(like, like);
  } else {
    users = models
      .openDb()
      .prepare("SELECT * FROM users ORDER BY role, name")
      .all();
  }
  res.render("admin/users", { users, q });
});

// Admin: block / unblock a user (the admin cannot block himself)
app.post("/admin/users/:userId/toggle", requireAuth, requireRole("admin"), (req, res) => {
  const db = models.openDb();
  const target = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(req.params.userId);
  if (target && target.id !== req.user.id) {
    db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(
      target.is_active ? 0 : 1, target.id
    );
    flashRedirect(
      res, "success",
      target.is_active
        ? `${target.name} has been blocked.`
        : `${target.name} has been unblocked.`
    );
  }
  res.redirect("/admin/users");
});

// Admin: delete a user (related data is removed by ON DELETE CASCADE)
app.post("/admin/users/:userId/delete", requireAuth, requireRole("admin"), (req, res) => {
  const db = models.openDb();
  const target = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(req.params.userId);
  if (target && target.id !== req.user.id) {
    db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
    flashRedirect(res, "success", `${target.name} has been deleted.`);
  }
  res.redirect("/admin/users");
});

// Admin: all jobs
app.get("/admin/jobs", requireAuth, requireRole("admin"), (req, res) => {
  const jobs = models
    .openDb()
    .prepare(
      `SELECT jobs.*, users.name AS poster_name FROM jobs
         JOIN users ON users.id = jobs.alumni_id ORDER BY jobs.id DESC`
    )
    .all();
  res.render("admin/jobs", { jobs });
});

// Admin: delete any job
app.post("/admin/jobs/:jobId/delete", requireAuth, requireRole("admin"), (req, res) => {
  models.openDb().prepare("DELETE FROM jobs WHERE id = ?").run(req.params.jobId);
  flashRedirect(res, "success", "Job deleted.");
  res.redirect("/admin/jobs");
});

// Admin: contact-form messages sent from the public Contact page
app.get("/admin/messages", requireAuth, requireRole("admin"), (req, res) => {
  const messages = models
    .openDb()
    .prepare("SELECT * FROM contact_messages ORDER BY id DESC")
    .all();
  res.render("admin/messages", { messages });
});

// Admin: delete a contact message
app.post("/admin/messages/:msgId/delete", requireAuth, requireRole("admin"), (req, res) => {
  models
    .openDb()
    .prepare("DELETE FROM contact_messages WHERE id = ?")
    .run(req.params.msgId);
  flashRedirect(res, "success", "Message deleted.");
  res.redirect("/admin/messages");
});

// ===========================================================================
// 11. Error pages + start the server
// ===========================================================================
// Any unknown address shows the friendly 404 page
app.use((req, res) => {
  res.status(404).render("errors/404");
});

// Any unexpected error shows the friendly 500 page
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("errors/500");
});

// Exported for Vercel's Node runtime; started directly below for local use
module.exports = app;

if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`Alumni Hub main app running at ${config.APP_URL}`);
    console.log(`Login / register pages live on the auth service: ${config.AUTH_SERVICE_URL}`);
  });
}
