# Project Memory — Alumni Hub

The "why" behind the project: key decisions, history, credentials and
limitations. Read this before making changes.

## Key Decisions

| Decision | Why |
|----------|-----|
| **Flask (not Django / Node)** | Smallest learning curve; routing, templating and forms in one file-set; perfect size for a project that must be explained in a viva. |
| **Raw `sqlite3` (no SQLAlchemy ORM)** | Real SQL is visible in the code — easy to demonstrate and answer questions on. SQLite needs zero installation and the whole DB is one file. |
| **Server-rendered Jinja2 templates (no React/API)** | Keeps the project a true monolith: one app to run, one place to debug. |
| **No OTP / email verification** | Needs an SMTP/app-password setup and adds failure modes in a demo. Registration is direct; the admin can block/delete misuse. Deliberately out of scope. |
| **No WebSockets for chat** | Chat is a simple form POST + page load (with read/unread tracking). Real-time sockets would need Socket.IO + a different hosting model and are hard to justify at this project's level. |
| **One `app.py` for all routes** | Grouped, commented sections (AUTH / JOBS / CHAT / ADMIN…) make the whole flow readable top-to-bottom. `models.py` holds only DB code, `config.py` only settings. |
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

## Demo Credentials

Created by `seed.py` (and auto-seeded on Vercel cold starts):

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
- **Single admin account** — Created by `seed.py`; there is no UI to create
  more admins.
- **Uploads are local files** — Profile pictures live in `uploads/`
  (on Vercel: `/tmp/uploads`, equally temporary).
- **Default `SECRET_KEY`** — A placeholder value is in `config.py` for
  local use; real deployments should set the `SECRET_KEY` environment
  variable (see [DEPLOYMENT.md](DEPLOYMENT.md)).
