# Project Memory — Alumni Hub

The "why" behind the project: key decisions, history, credentials and
limitations. Read this before making changes.

## Key Decisions

| Decision | Why |
|----------|-----|
| **Hybrid: Express (JS) main app + Flask auth service** | Converted on request so most of the codebase is JavaScript. Python is kept ONLY for authentication, because the stored password hashes are Werkzeug scrypt and only Werkzeug can verify them. The two services share one SQLite file and communicate through a signed-token handoff (HMAC-SHA256, 6-hour expiry, httpOnly cookie). See [ARCHITECTURE.md](ARCHITECTURE.md). |
| **Raw SQL (no ORM)** | Real SQL is visible in the code (`better-sqlite3` in JS, `sqlite3` in Python) — easy to demonstrate and answer questions on. SQLite needs zero installation and the whole DB is one file. |
| **Server-rendered templates (no React/API)** | EJS templates with header/footer partials in the main app, Jinja2 in the auth service — same pages, same Bootstrap design as the original monolith. |
| **No OTP / email verification** | Needs an SMTP/app-password setup and adds failure modes in a demo. Registration is direct; the admin can block/delete misuse. Deliberately out of scope. |
| **No WebSockets for chat** | Chat is a simple form POST + page load (with read/unread tracking). Real-time sockets would need Socket.IO + a different hosting model and are hard to justify at this project's level. |
| **One `app.js` for all main routes** | Grouped, commented sections (PUBLIC / JOBS / CHAT / ADMIN…) make the whole flow readable top-to-bottom. `models.js` holds only DB code, `config.js` only settings. The auth service is a single small `auth.py`. |
| **Separate profile table per role** | Students, alumni and faculty genuinely have different fields; three small tables are clearer than one wide table full of NULLs. |
| **Admin is seed-only** | Admins are never created from the public register form — `seed.py` creates the single admin account. |
| **Bootstrap 5 via CDN** | Responsive UI with almost no custom CSS; the custom theme lives in one `style.css`. |
| **Vercel for the public demo** | Free, one-click from GitHub, gives a shareable link for teachers — accepted with the known data-reset limitation (below). |

## Project History

1. **Origin** — A large, production-style *Alumni Hub* already existed
   (~160 endpoints, OTP login, ML recommendations, Socket.IO chat, Turso
   cloud DB — repo `RajenderMohanVerma/alumni-hub`). It was far too big to
   submit or defend as a college project.
2. **Smaller version built fresh** — This project was written from scratch as a
   separate, simplified codebase: Flask + raw `sqlite3` + Bootstrap,
   ~3,700 lines, 28 templates, 10 tables, only the core features
   (auth, profiles, directory, connections, chat, jobs, announcements,
   notifications, admin). Verified with a 60-check automated flow test and
   live screenshots.
3. **GitHub** — The user created a separate repository,
   [`RajenderMohanVerma/alumni_hub`](https://github.com/RajenderMohanVerma/alumni_hub)
   (private; underscore name — distinct from the big `alumni-hub`), and the
   project was pushed there (initial commit `ee60018`). The seeded
   `alumni_hub.db` is **not** in the repo (`*.db` is gitignored) — clone
   users run `python seed.py` first.
4. **Vercel deployment** — Deployed by importing the GitHub repo into
   Vercel: <https://alumnihubclg.vercel.app>. The first deployment crashed
   with `FUNCTION_INVOCATION_FAILED` ("could not import app.py") because
   the app opened its SQLite database inside Vercel's **read-only** project
   bundle.
5. **Vercel fix (commit `28a830a`)** — `config.py`: when the `VERCEL`
   environment variable is present, `DATABASE = /tmp/alumni_hub.db` and
   `UPLOAD_FOLDER = /tmp/uploads`; `SECRET_KEY` can be overridden by an
   environment variable. `app.py`: on Vercel, if the users table is empty
   (cold start), the demo data is seeded automatically. Vercel's Python
   runtime auto-detects the root `app.py` as the Flask entrypoint, so no
   `vercel.json` / `api/index.py` was needed.
6. **Demo-login convenience (commit `5889a87`)** — The login page shows the
   four demo accounts as buttons; one click auto-fills email + password.
7. **Polish pass** — Common pages for everyone (Services, Contact), rich
   footer on all pages, active-page navbar highlighting, scroll-in
   animations, count-up statistics, live search filtering, admin inbox for
   contact messages (`contact_messages` becomes the 11th table), and this
   `docs/` folder + a professional main README.
8. **Hybrid conversion (JavaScript + Python auth)** — The all-Python app
   was converted in place: the main application is now Node.js/Express
   (`app.js`, `models.js`, `config.js`, `views/`, `public/`, `seed.js`),
   and Python remains only as a small Flask **auth service**
   (`auth_service/auth.py`, port 5001) for login/register/change-password,
   since password hashes are Werkzeug scrypt. Login works by signed-token
   handoff (see [ARCHITECTURE.md](ARCHITECTURE.md)). `seed.py` is kept
   unchanged as the canonical demo-data record; `seed.js` creates
   identical data (it writes Werkzeug-format scrypt hashes using Node's
   `crypto.scryptSync`, which Werkzeug verifies). The existing
   `alumni_hub.db` kept working unchanged. The old all-Python version
   remains in this repo's git history.

## Demo Credentials

Created by the seed scripts — `node seed.js`, or `python seed.py`
(identical data; also auto-seeded on Vercel cold starts):

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@alumnihub.com | admin123 |
| Student | student@demo.com | student123 |
| Student | priya@demo.com | student123 |
| Student | amit@demo.com | student123 |
| Alumni | alumni@demo.com | alumni123 |
| Alumni | vikram@demo.com | alumni123 |
| Alumni | sneha@demo.com | alumni123 |
| Faculty | faculty@demo.com | faculty123 |
| Faculty | ananya@demo.com | faculty123 |

## Known Limitations

- **Vercel data resets** — On Vercel the filesystem is temporary, so the
  `/tmp` database can reset on a cold start/redeploy. New registrations and
  content may disappear; demo data always comes back via auto-seed. For a
  permanent deployment use a server with a real disk (e.g. PythonAnywhere)
  or a cloud database.
- **No email features** — No OTP, no password reset, no email notifications;
  all alerts are in-app only.
- **Chat is not real-time** — Messages appear on page load/refresh; there is
  no typing indicator or push delivery.
- **SQLite concurrency** — Fine for a class demo; not meant for heavy
  multi-user production traffic.
- **Single admin account** — Created by the seed; there is no UI to create
  more admins.
- **Uploads are local files** — Profile pictures live in `uploads/`
  (on Vercel: `/tmp/uploads`, equally temporary).
- **Two servers must both run** — The main app (Node, port 3000) and the
  auth service (Python, port 5001). If the auth service is down, pages
  still open but nobody can log in.
- **Default `AUTH_SECRET`** — A placeholder shared secret (used to sign
  login tokens) is in `config.js` and `auth_service/auth.py` for local
  use; real deployments should set the `AUTH_SECRET` environment
  variable — to the SAME value in both services (see
  [DEPLOYMENT.md](DEPLOYMENT.md)).
