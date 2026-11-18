# Deployment — Alumni Hub

## 1. Running Locally

**Requirements:** Python 3.10+ and pip. No database server is needed
(SQLite is built into Python).

```bash
# 1. Go inside the project folder
cd alumni-hub-minor

# 2. Create and activate a virtual environment (recommended)
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Linux / Mac

# 3. Install the required packages (Flask, Flask-Login, Werkzeug)
pip install -r requirements.txt

# 4. Create the database and fill demo data (run once)
python seed.py

# 5. Start the application
python app.py
```

Open **http://127.0.0.1:5000** in the browser and log in with a
[demo account](MEMORY.md#demo-credentials).

Notes:

- `python app.py` also creates the tables automatically
  (`models.init_db()` runs at startup), so step 4 is only needed for the
  demo data and the admin account.
- To reset everything: stop the app, delete `alumni_hub.db`, run
  `python seed.py` again.
- Uploaded profile pictures are stored in the `uploads/` folder.

## 2. GitHub Repository

- **Repo:** <https://github.com/RajenderMohanVerma/alumni_hub>
  (owner `RajenderMohanVerma`, private, branch `main`)
- It contains the complete source: `app.py`, `models.py`, `config.py`,
  `seed.py`, `templates/`, `static/`, `docs/` and this README set.
- **Not in the repo** (see `.gitignore`): `alumni_hub.db` (`*.db`),
  `__pycache__/`, `venv/`, `.env`. Anyone cloning must run
  `python seed.py` once before `python app.py`.
- This repo is separate from the larger production-style project at
  `RajenderMohanVerma/alumni-hub` — do not mix the two codebases.

## 3. Vercel Deployment (public demo)

**Live demo:** <https://alumnihubclg.vercel.app>

### How it was deployed

1. In the Vercel dashboard: **Add New → Project → Import** the GitHub
   repository `alumni_hub`.
2. Vercel's Python runtime **auto-detects the root `app.py`** as the Flask
   entrypoint — no `vercel.json` and no `api/index.py` are needed, and the
   Framework Preset can stay on the auto-detected Flask setting.
3. Click **Deploy**. Every later push to `main` triggers an automatic
   redeploy.

### How the app supports Vercel

Vercel functions run in a **read-only project bundle** with only `/tmp`
writable, and `/tmp` is temporary. The app handles this in `config.py` and
`app.py` using the `VERCEL` environment variable (set automatically by
Vercel):

| Behaviour | Locally | On Vercel (`VERCEL` env present) |
|-----------|---------|----------------------------------|
| Database file | `alumni_hub.db` in the project folder | `/tmp/alumni_hub.db` |
| Uploads folder | `uploads/` in the project folder | `/tmp/uploads` |
| Demo data | `python seed.py` (manual, once) | **Auto-seeded** on cold start if the users table is empty |
| Secret key | Default value in `config.py` | `SECRET_KEY` env var if set (see below) |

Because `/tmp` can be wiped on a cold start, **data on the Vercel demo can
reset** — registrations made on the demo may disappear, but the seeded demo
accounts always come back. This is accepted for a demo; see
[MEMORY.md](MEMORY.md) for the reasoning.

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `SECRET_KEY` | Optional | Overrides the placeholder secret key used to sign session cookies. Set it in **Vercel → Project → Settings → Environment Variables** for a real deployment. Without it, the app uses the default value from `config.py` (fine for a class demo). |
| `VERCEL` | — (automatic) | Set by Vercel itself; the app only reads it to switch the database/upload paths to `/tmp`. Never set it locally. |

### Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `FUNCTION_INVOCATION_FAILED` / "could not import app.py" | The database is being opened inside the read-only bundle — make sure the `config.py` Vercel branch (`/tmp` paths) is deployed. |
| Demo logins stop working after a redeploy | The `/tmp` database was reset and the new instance has not seeded yet — just reload the page once (auto-seed runs at startup). |
| Profile picture upload fails on Vercel | Expected limitation of temporary storage; uploads work locally. |
