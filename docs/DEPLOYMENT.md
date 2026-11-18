# Deployment — Alumni Hub

Alumni Hub is a **hybrid** project with TWO servers that must both run:

| Server | Command | URL |
|--------|---------|-----|
| Main app (JavaScript / Express) | `node app.js` | http://127.0.0.1:3000 |
| Auth service (Python / Flask) | `python auth_service/auth.py` | http://127.0.0.1:5001 |

## 1. Running Locally

**Requirements:** Node.js 18+ and Python 3.10+. No database server is
needed (SQLite is a single file).

```bash
# 1. Go inside the project folder
cd alumni-hub-minor

# 2. Install the JavaScript dependencies
npm install

# 3. Install the Python dependencies (auth service only)
pip install -r auth_service/requirements.txt

# 4. Create the database and fill demo data (run once)
node seed.js

# 5. Start BOTH servers (two terminals)
node app.js
python auth_service/auth.py
```

Open **http://127.0.0.1:3000** in the browser and log in with a
[demo account](MEMORY.md#demo-credentials). Clicking Login takes you to
the auth service on port 5001 and straight back after a successful login.

Notes:

- Both servers create the tables automatically at startup
  (`initDb()` in `models.js`, `init_db()` in `auth.py`), so step 4 is
  only needed for the demo data and the admin account.
- `python seed.py` creates exactly the same demo data as `node seed.js`
  (kept as the canonical record; the auth service also uses it for its
  Vercel auto-seed).
- To reset everything: stop both servers, delete `alumni_hub.db`, run
  `node seed.js` again.
- Uploaded profile pictures are stored in the `uploads/` folder.

### Environment variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `AUTH_SECRET` | both | Shared secret that signs login tokens. Must be the SAME in both services. A demo default (`alumni-hub-auth-secret`) is built in; set a real value for deployment. |
| `AUTH_SERVICE_URL` | main app | Where the auth service lives (default `http://127.0.0.1:5001`). |
| `APP_URL` | both | Public URL of the main app (default `http://127.0.0.1:3000`); the auth service redirects users back here. |
| `PORT` | main app | Port of the Express app (default 3000). |
| `VERCEL` | — (automatic) | Set by Vercel itself; both services only read it to switch database/upload paths to `/tmp`. Never set it locally. |

## 2. GitHub Repository

- **Repo:** <https://github.com/RajenderMohanVerma/alumni_hub>
  (owner `RajenderMohanVerma`, private, branch `main`)
- It contains the complete source: `app.js`, `models.js`, `config.js`,
  `seed.js`, `seed.py`, `views/`, `public/`, `auth_service/`, `docs/`
  and this README set.
- **Not in the repo** (see `.gitignore`): `alumni_hub.db` (`*.db`),
  `node_modules/`, `__pycache__/`, `venv/`, `.env`. Anyone cloning must
  run `node seed.js` once, then start both servers.
- This repo is separate from the larger production-style project at
  `RajenderMohanVerma/alumni-hub` — do not mix the two codebases.

## 3. Vercel Deployment (public demo)

**Live demo:** <https://alumnihubclg.vercel.app>

The demo was originally deployed when the project was a single Flask
app (Vercel's Python runtime auto-detected the root `app.py`). The
hybrid version has two parts, so on Vercel it is deployed as **two
projects** from the same repository:

1. **Main app project** — a Node project running `app.js` (Express).
   Set `AUTH_SERVICE_URL` to the auth project's URL and `APP_URL` to
   this project's URL.
2. **Auth service project** — a Python project running
   `auth_service/auth.py` (Flask). Set `APP_URL` to the main project's
   URL, and `AUTH_SECRET` to the **same value** in both projects.

### How the app supports Vercel

Vercel functions run in a **read-only project bundle** with only `/tmp`
writable, and `/tmp` is temporary. Both services handle this with the
`VERCEL` environment variable (set automatically by Vercel):

| Behaviour | Locally | On Vercel (`VERCEL` env present) |
|-----------|---------|----------------------------------|
| Database file | `alumni_hub.db` in the project folder | `/tmp/alumni_hub.db` |
| Uploads folder | `uploads/` in the project folder | `/tmp/uploads` |
| Demo data | `node seed.js` (manual, once) | **Auto-seeded** on cold start if the users table is empty (Express via `seed.js`; the auth service via `seed.py`) |

Because `/tmp` can be wiped on a cold start, **data on the Vercel demo
can reset** — registrations made on the demo may disappear, but the
seeded demo accounts always come back. This is accepted for a demo; see
[MEMORY.md](MEMORY.md) for the reasoning.

### Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Login page does not open / "connection refused" on port 5001 | The auth service is not running — start `python auth_service/auth.py` (locally) or check the auth project's deployment (Vercel). |
| After login you bounce back to the login page with an error | Token rejected: `AUTH_SECRET` differs between the two services, or `APP_URL` / `AUTH_SERVICE_URL` point at the wrong project. |
| `FUNCTION_INVOCATION_FAILED` on Vercel | The database is being opened inside the read-only bundle — make sure the deployed code contains the `VERCEL` → `/tmp` branch (`config.js` / `auth.py`). |
| Demo logins stop working after a redeploy | The `/tmp` database was reset and the new instance has not seeded yet — just reload the page once (auto-seed runs at startup). |
| Profile picture upload fails on Vercel | Expected limitation of temporary storage; uploads work locally. |
