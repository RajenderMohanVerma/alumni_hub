# Alumni Hub — Academic Community Platform

> A simple web application that connects the **Students**, **Alumni** and **Faculty** of a college on one platform — build profiles, connect, chat, share jobs and stay updated.

Alumni Hub is an **MCA Minor Project** built with **Flask + SQLite + Bootstrap**.
The code is deliberately small, clean and well-commented, so every part is easy
to understand, run and explain.

---

## 🌐 Live Demo

**👉 [alumnihubclg.vercel.app](https://alumnihubclg.vercel.app)**

The demo is hosted on Vercel. Use any demo account below — or simply click a
**demo-account button on the login page** and the credentials fill themselves.

| Role    | Email                | Password    |
|---------|----------------------|-------------|
| Admin   | admin@alumnihub.com  | admin123    |
| Student | student@demo.com     | student123  |
| Alumni  | alumni@demo.com      | alumni123   |
| Faculty | faculty@demo.com     | faculty123  |

> ℹ️ The Vercel demo runs on temporary storage, so data can reset on a
> redeploy/cold start. The demo accounts and demo data are re-created
> automatically every time (auto-seed), so the demo always works.

---

## ✨ Features

- **4 user roles** — Student, Alumni, Faculty, Admin with role-based access
- **Authentication** — register, login, logout, change password
  (passwords are stored only as hashes, never in plain text)
- **Profiles** — view/edit profile with photo upload and role-specific fields
  (course/branch for students, company for alumni, department for faculty)
- **Member Directory** — search by name, skills or company; filter by role;
  cards also filter live while typing
- **Connections** — send / accept / reject connection requests
- **Chat** — simple one-to-one messaging with unread badges
- **Job Portal** — alumni post, edit and delete jobs; students browse, search
  and apply with a cover note; alumni manage applicants and update status
  (Applied / Shortlisted / Rejected)
- **Announcements** — faculty posts announcements visible to all members
- **Notifications** — automatic alerts for connection requests, new jobs and
  application updates
- **Admin Panel** — statistics dashboard with a Chart.js graph,
  block/unblock/delete users, delete any job, and an inbox for Contact-page
  messages
- **Public Pages** — Home (live statistics, latest jobs), About, Services and
  a Contact page whose form messages are saved to the database — all wrapped
  in a common navbar and a rich footer, with subtle scroll animations

---

## 🛠️ Tech Stack

| Part      | Technology                                        |
|-----------|---------------------------------------------------|
| Backend   | Python, Flask, Flask-Login                        |
| Database  | SQLite (built-in `sqlite3` module, raw SQL)       |
| Frontend  | HTML, Jinja2 templates, Bootstrap 5, Font Awesome |
| Charts    | Chart.js (admin dashboard)                        |
| Security  | Werkzeug password hashing, login sessions         |
| Hosting   | GitHub (source) + Vercel (live demo)              |

---

## 📸 Screenshots

The fastest way to see the project is the
**[live demo](https://alumnihubclg.vercel.app)** — it opens on the home page
with live statistics and the latest jobs. Log in with a demo account to see
the role dashboards, member directory, chat, job board and the admin panel
exactly as they run locally.

---

## 📁 Project Structure

```
alumni-hub-minor/
├── app.py                  -> All routes (grouped in commented sections)
├── models.py               -> Database connection, table creation, helpers
├── config.py               -> Settings (secret key, DB path, uploads)
├── seed.py                 -> Creates demo users, jobs, messages, etc.
├── requirements.txt        -> Python packages needed
├── alumni_hub.db           -> SQLite database (created by seed.py / app.py)
├── uploads/                -> Profile pictures uploaded by users
├── static/
│   ├── css/style.css       -> Custom styles (blue theme, animations, footer)
│   ├── js/main.js          -> Toasts, confirms, chat scroll, reveal
│   │                          animations, counters, live search
│   └── images/default-avatar.svg
├── templates/
│   ├── base.html           -> Common layout: navbar, footer, flash toasts
│   ├── home.html, about.html, services.html, contact.html
│   ├── auth/               -> login, register, change password
│   ├── dashboard_student.html / dashboard_alumni.html / dashboard_faculty.html
│   ├── profile.html, edit_profile.html
│   ├── search.html, connections.html
│   ├── chat.html, conversation.html
│   ├── jobs.html, job_detail.html, post_job.html
│   ├── my_jobs.html, applicants.html, applied_jobs.html
│   ├── announcements.html, notifications.html
│   ├── admin/              -> dashboard, users, jobs, messages
│   └── errors/             -> 404 and 500 pages
└── docs/                   -> Full project documentation (see below)
```

---

## 🚀 Setup & Run

```bash
# 1. Go inside the project folder
cd alumni-hub-minor

# 2. (Recommended) create and activate a virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Linux / Mac

# 3. Install the required packages
pip install -r requirements.txt

# 4. Create the database and fill demo data (run once)
python seed.py

# 5. Start the application
python app.py
```

Then open **http://127.0.0.1:5000** in your browser.

---

## 🔑 Demo Accounts

| Role    | Email                | Password    |
|---------|----------------------|-------------|
| Admin   | admin@alumnihub.com  | admin123    |
| Student | student@demo.com     | student123  |
| Student | priya@demo.com       | student123  |
| Alumni  | alumni@demo.com      | alumni123   |
| Alumni  | vikram@demo.com      | alumni123   |
| Faculty | faculty@demo.com     | faculty123  |

(The admin account is created only by `seed.py` — it cannot be registered
from the website.)

---

## 🗄️ Database Tables (11)

| Table            | Purpose                                              |
|------------------|------------------------------------------------------|
| users            | All accounts (name, email, password hash, role)      |
| student_profile  | Course, branch, year, skills, bio of students        |
| alumni_profile   | Company, designation, experience of alumni           |
| faculty_profile  | Department, designation, qualification of faculty    |
| connections      | Connection requests (pending / accepted / rejected)  |
| messages         | One-to-one chat messages                             |
| jobs             | Jobs posted by alumni                                |
| applications     | Students' job applications with status               |
| announcements    | Announcements posted by faculty                      |
| notifications    | Alerts shown to users (bell icon in the navbar)      |
| contact_messages | Messages sent from the public Contact page           |

Full schema, relationships and sample queries:
[docs/DATABASE.md](docs/DATABASE.md)

---

## ☁️ Deployment

- **Source code:** [github.com/RajenderMohanVerma/alumni_hub](https://github.com/RajenderMohanVerma/alumni_hub)
  (the database file is *not* in the repo — run `python seed.py` after cloning)
- **Live demo:** [alumnihubclg.vercel.app](https://alumnihubclg.vercel.app),
  deployed on Vercel by importing the GitHub repository. Vercel's Python
  runtime auto-detects the root `app.py` as the Flask entrypoint — no extra
  configuration files are needed.
- **Vercel support built into the app:** Vercel's filesystem is read-only
  except `/tmp`, so when the `VERCEL` environment variable is present,
  `config.py` switches the database to `/tmp/alumni_hub.db` and uploads to
  `/tmp/uploads`, and `app.py` auto-seeds the demo data on a cold start if
  the database is empty. A `SECRET_KEY` environment variable can override
  the default key in real deployments.

Step-by-step details: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## 📚 Documentation

Complete documentation lives in the [`docs/`](docs/) folder:

| File | Contents |
|------|----------|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/OVERVIEW.md](docs/OVERVIEW.md) | Problem statement, objectives, scope, features |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, request lifecycle, diagrams |
| [docs/DESIGN.md](docs/DESIGN.md) | UI design system + database ER diagram |
| [docs/DATABASE.md](docs/DATABASE.md) | All tables, relationships, sample SQL |
| [docs/TASKS.md](docs/TASKS.md) | Module-wise task checklist with status |
| [docs/MEMORY.md](docs/MEMORY.md) | Key decisions, project history, limitations |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Local run, GitHub and Vercel deployment |
| [docs/TESTING.md](docs/TESTING.md) | Test flows performed and their results |

---

## 🔮 Future Scope

- Email-based OTP verification and password reset
- Real-time chat using WebSockets (Socket.IO)
- Cloud database (e.g. PostgreSQL / Turso) so hosted data is permanent
- Resume upload with job applications
- Email notifications in addition to in-app alerts

---

**Developed by Rajender Mohan Verma — MCA Minor Project**
