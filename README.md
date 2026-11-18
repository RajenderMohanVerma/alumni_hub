# Alumni Hub — Academic Community Platform (Minor Project)

**Alumni Hub** is a simple web application that connects the **Students**,
**Alumni** and **Faculty** of a college on one platform. Students can build a
profile, connect with alumni, chat with them and apply for jobs posted by
alumni. Faculty members can post announcements, and an **Admin** manages all
users and jobs.

This is a *minor project* version: the code is deliberately small, clean and
well-commented so that every part is easy to understand and explain.

---

## Features

- **4 user roles** – Student, Alumni, Faculty, Admin (role-based access)
- **Authentication** – register, login, logout, change password
  (passwords are stored only as hashes, never in plain text)
- **Profiles** – view/edit profile with photo upload and role-specific
  fields (course/branch for students, company for alumni, department for faculty)
- **Member Directory** – search members by name, skills or company; filter by role
- **Connections** – send / accept / reject connection requests
- **Chat** – simple one-to-one messaging with unread badges
- **Job Portal** – alumni post, edit and delete jobs; students browse,
  search and apply with a cover note; alumni manage applicants and update
  application status (Applied / Shortlisted / Rejected)
- **Announcements** – faculty can post announcements visible to all members
- **Notifications** – automatic alerts for connection requests, job posts
  and application updates
- **Admin Panel** – dashboard with statistics and a Chart.js graph,
  block/unblock/delete users, delete any job

## Technology Used

| Part      | Technology                                   |
|-----------|----------------------------------------------|
| Backend   | Python, Flask, Flask-Login                   |
| Database  | SQLite (built-in `sqlite3` module)           |
| Frontend  | HTML, Jinja2 templates, Bootstrap 5, Font Awesome |
| Charts    | Chart.js (admin dashboard)                   |
| Security  | Werkzeug password hashing, login sessions    |

## How to Run

```bash
# 1. Go inside the project folder
cd alumni-hub-minor

# 2. (Optional but recommended) create a virtual environment
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

## Demo Accounts

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

## Project Structure

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
│   ├── css/style.css       -> Custom styles (blue theme)
│   ├── js/main.js          -> Toasts, confirm dialogs, chat auto-scroll
│   └── images/default-avatar.svg
└── templates/
    ├── base.html           -> Common layout: navbar, footer, flash toasts
    ├── home.html, about.html
    ├── auth/               -> login, register, change password
    ├── dashboard_student.html / dashboard_alumni.html / dashboard_faculty.html
    ├── profile.html, edit_profile.html
    ├── search.html, connections.html
    ├── chat.html, conversation.html
    ├── jobs.html, job_detail.html, post_job.html
    ├── my_jobs.html, applicants.html, applied_jobs.html
    ├── announcements.html, notifications.html
    ├── admin/              -> dashboard, users, jobs
    └── errors/             -> 404 and 500 pages
```

## Database Tables (10)

| Table            | Purpose                                             |
|------------------|-----------------------------------------------------|
| users            | All accounts (name, email, password hash, role)     |
| student_profile  | Course, branch, year, skills, bio of students       |
| alumni_profile   | Company, designation, experience of alumni          |
| faculty_profile  | Department, designation, qualification of faculty   |
| connections      | Connection requests (pending / accepted / rejected) |
| messages         | One-to-one chat messages                            |
| jobs             | Jobs posted by alumni                               |
| applications     | Students' job applications with status              |
| announcements    | Announcements posted by faculty                     |
| notifications    | Alerts shown to users (bell icon in the navbar)     |

## Notes

- This project is for learning purposes (MCA Minor Project).
- To start completely fresh, delete `alumni_hub.db` and run `python seed.py` again.
