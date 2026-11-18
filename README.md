# Alumni Hub

**A web platform that connects Students, Alumni and Faculty of an institute** — member directory,
connections, one-to-one chat, a job board, announcements and an admin panel, all in one place.

### 🌐 Live Demo: [alumnihubclg.vercel.app](https://alumnihubclg.vercel.app)

> **Architecture:** Alumni Hub is a **hybrid** project. The main application is written in
> **JavaScript (Node.js + Express)**, and one small part — authentication — is a
> **Python (Flask) service**. Both share the same SQLite database. See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the two parts work together.

---

## Features

| Module | What it does |
|---|---|
| **Public website** | Home page with live counters and latest jobs, About, Services and a Contact page (messages are saved for the admin) — no login needed |
| **Users & Roles** | Register / login as **Student**, **Alumni** or **Faculty**; a separate **Admin** manages the platform |
| **Profiles** | Photo upload, role-specific details (course / company / department), skills and bio |
| **Member Directory** | Search all members with instant live filtering, filter by role, view full profiles |
| **Connections** | Send, accept or reject connection requests, with notifications |
| **Chat** | Simple one-to-one messaging with unread badges in the navbar |
| **Job Board** | Alumni post jobs; students apply in one click and track status (Applied / Shortlisted / Rejected); alumni manage applicants |
| **Announcements** | Faculty publish notices for the whole institute |
| **Notifications** | Connection requests, new jobs and application updates in one feed |
| **Admin Panel** | Dashboard with charts, block/delete users, delete jobs, read contact-form messages |
| **Design** | Common navbar + rich footer on every page, animated counters, scroll-reveal cards, fully responsive (Bootstrap 5) |

## Technology

| Part | Stack |
|---|---|
| Main app (port **3000**) | JavaScript · Node.js · Express 4 · EJS templates · `better-sqlite3` · Multer (photo uploads) |
| Auth service (port **5001**) | Python · Flask · Werkzeug password hashing (scrypt) |
| Database | SQLite — one shared file, 11 tables |
| Frontend | Bootstrap 5 · Bootstrap Icons · Chart.js |

**Why is authentication in Python?** Password hashes in the database are Werkzeug *scrypt*
hashes, and only Werkzeug can verify them. So login, registration and change-password live in
the small Flask service; the Express app never checks a password — it verifies the **signed
login token** (HMAC-SHA256) that the auth service creates after a successful login.

## Quick Start

You need **Node.js 18+** and **Python 3** installed. Then:

```bash
# 1. Install the JavaScript dependencies
npm install

# 2. Install the Python dependencies (only Flask + Werkzeug)
pip install -r auth_service/requirements.txt

# 3. Create the demo data (demo users, jobs, connections...)
node seed.js

# 4. Start BOTH servers (two terminals)
node app.js                          # main app      -> http://127.0.0.1:3000
python auth_service/auth.py          # auth service  -> http://127.0.0.1:5001
```

Open **http://127.0.0.1:3000** and explore. The Login / Register pages are served by the
auth service on port 5001 — after login it hands you back to the main app automatically.

> `python seed.py` is also kept in the project root — it creates exactly the same demo data
> from Python (used by the auth service for its Vercel auto-seed).

## Demo Accounts

Click any account on the login page to auto-fill it — or type it manually:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@alumnihub.com` | `admin123` |
| Student | `student@demo.com` | `student123` |
| Alumni | `alumni@demo.com` | `alumni123` |
| Faculty | `faculty@demo.com` | `faculty123` |

More demo members (Priya, Amit, Vikram, Sneha, Dr. Ananya…) are included — find them in the
Member Directory after logging in.

## Project Structure

```
alumni-hub-minor/
├── package.json          # JS dependencies (express, ejs, better-sqlite3, ...)
├── app.js                # Express server — ALL main routes (port 3000)
├── models.js             # Database layer: connection, 11 tables, helpers
├── config.js             # Settings: ports, DB path, AUTH_SECRET, auth URL
├── seed.js               # Demo data (JavaScript)
├── seed.py               # Demo data (Python — canonical copy, kept as-is)
├── views/                # EJS templates (partials/header + footer = the base layout)
├── public/               # CSS, JS, images (served directly by Express)
├── uploads/              # Profile pictures uploaded by users
├── auth_service/
│   ├── auth.py           # Flask app — ONLY login / register / change-password (port 5001)
│   ├── templates/        # Login, register, change-password pages
│   ├── static/style.css  # Same stylesheet as the main app
│   └── requirements.txt  # Flask + Werkzeug only
├── alumni_hub.db         # SQLite database (created by the seed)
└── docs/                 # Full project documentation
```

## How Login Works (token handoff)

1. Clicking **Login** sends you to the Flask auth service (`:5001/login`).
2. Flask checks your email + password against the shared database (Werkzeug scrypt).
3. It creates a signed token — `base64url(JSON) + "." + HMAC-SHA256` — valid for 6 hours.
4. Your browser is redirected to the Express app: `/auth/callback?token=...`.
5. Express verifies the signature, stores the token in an **httpOnly cookie**, and opens
   your dashboard. Every request re-checks the token and reloads your user row, so an
   admin block/delete takes effect immediately.

## Documentation

Full documentation lives in the [docs/](docs/) folder: project overview, architecture
(with diagrams), design & ER diagram, database schema, task list, project memory and
deployment guide.

## Deployment

The project runs anywhere Node.js runs. On **Vercel** (demo hosting) the database and
uploads automatically move to `/tmp` and demo data is seeded on first boot — note that
data resets there, so use a normal Node host for permanent data.
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

**Developed by Rajender Mohan Verma**
