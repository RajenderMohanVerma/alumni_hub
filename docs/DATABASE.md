# Database — Alumni Hub

- **Engine:** SQLite 3, through Python's built-in `sqlite3` module
- **File:** `alumni_hub.db` in the project folder (on Vercel: `/tmp/alumni_hub.db` — see [DEPLOYMENT.md](DEPLOYMENT.md))
- **Created by:** `models.init_db()` — runs automatically on app startup;
  every statement uses `CREATE TABLE IF NOT EXISTS`, so it is idempotent
- **Conventions:** `id INTEGER PRIMARY KEY AUTOINCREMENT` on main tables;
  `created_at TEXT DEFAULT (datetime('now', 'localtime'))`; foreign keys are
  switched ON (`PRAGMA foreign_keys = ON`) and use `ON DELETE CASCADE`

## Tables (11)

### 1. `users` — every account

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| name | TEXT NOT NULL | Full name |
| email | TEXT UNIQUE NOT NULL | Login id; stored lower-cased |
| password_hash | TEXT NOT NULL | Werkzeug hash — never plain text |
| role | TEXT NOT NULL | CHECK: `student` / `alumni` / `faculty` / `admin` |
| phone | TEXT | Optional |
| profile_pic | TEXT | File name inside `uploads/` (NULL = default avatar) |
| is_active | INTEGER NOT NULL DEFAULT 1 | 0 = blocked by admin |
| created_at | TEXT | Auto timestamp |

### 2. `student_profile` — one-to-one with `users`

| Column | Type | Notes |
|--------|------|-------|
| user_id | INTEGER PK, FK → users(id) CASCADE | |
| course, branch, year | TEXT | e.g. B.Tech / MCA, Computer Science, 3rd Year |
| skills, bio | TEXT | Comma-separated skills; short bio |

### 3. `alumni_profile` — one-to-one with `users`

| Column | Type | Notes |
|--------|------|-------|
| user_id | INTEGER PK, FK → users(id) CASCADE | |
| company, designation, experience | TEXT | e.g. TCS, Software Engineer, 3 years |
| skills, bio | TEXT | |

### 4. `faculty_profile` — one-to-one with `users`

| Column | Type | Notes |
|--------|------|-------|
| user_id | INTEGER PK, FK → users(id) CASCADE | |
| department, designation, qualification | TEXT | e.g. Computer Science, Professor, PhD |
| skills, bio | TEXT | |

### 5. `connections` — connection requests between two users

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| sender_id | INTEGER NOT NULL, FK → users(id) CASCADE | Who sent the request |
| receiver_id | INTEGER NOT NULL, FK → users(id) CASCADE | Who received it |
| status | TEXT NOT NULL DEFAULT 'pending' | CHECK: `pending` / `accepted` / `rejected` |
| created_at | TEXT | |
| | | UNIQUE (sender_id, receiver_id) — one row per pair |

### 6. `messages` — one-to-one chat

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | Also defines message order |
| sender_id / receiver_id | INTEGER NOT NULL, FK → users(id) CASCADE | |
| body | TEXT NOT NULL | Message text |
| is_read | INTEGER NOT NULL DEFAULT 0 | Set to 1 when the receiver opens the chat |
| created_at | TEXT | |

### 7. `jobs` — jobs posted by alumni

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| alumni_id | INTEGER NOT NULL, FK → users(id) CASCADE | The posting alumnus |
| title, company | TEXT NOT NULL | |
| location, salary | TEXT | Salary is free text, e.g. "₹20,000/month", "3.8 LPA" |
| description | TEXT | |
| deadline | TEXT | Date `YYYY-MM-DD`, may be NULL |
| created_at | TEXT | |

### 8. `applications` — students applying to jobs

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| job_id | INTEGER NOT NULL, FK → jobs(id) CASCADE | |
| student_id | INTEGER NOT NULL, FK → users(id) CASCADE | |
| cover_note | TEXT | Optional note from the student |
| status | TEXT NOT NULL DEFAULT 'Applied' | CHECK: `Applied` / `Shortlisted` / `Rejected` |
| created_at | TEXT | |
| | | UNIQUE (job_id, student_id) — a student can apply only once per job |

### 9. `announcements` — posts by faculty

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| faculty_id | INTEGER NOT NULL, FK → users(id) CASCADE | |
| title | TEXT NOT NULL | |
| body | TEXT | |
| created_at | TEXT | |

### 10. `notifications` — in-app alerts

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| user_id | INTEGER NOT NULL, FK → users(id) CASCADE | Who receives the alert |
| text | TEXT NOT NULL | e.g. "Neha Gupta sent you a connection request." |
| link | TEXT | Page to open (may be NULL) |
| is_read | INTEGER NOT NULL DEFAULT 0 | All marked read when the Notifications page opens |
| created_at | TEXT | |

### 11. `contact_messages` — messages from the public Contact page

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| name | TEXT NOT NULL | Visitor's name (no account needed) |
| email | TEXT NOT NULL | Visitor's email |
| subject | TEXT | Optional |
| message | TEXT NOT NULL | |
| created_at | TEXT | Read/deleted by the admin at `/admin/messages` |

## Relationships (summary)

- `users` 1—0/1 `student_profile` / `alumni_profile` / `faculty_profile`
  (exactly one profile row, chosen by `users.role`; admins have none)
- `users` 1—N `connections` (twice: as sender and as receiver)
- `users` 1—N `messages` (twice: as sender and as receiver)
- `users` (alumni) 1—N `jobs`; `jobs` 1—N `applications`;
  `users` (student) 1—N `applications`
- `users` (faculty) 1—N `announcements`
- `users` 1—N `notifications`
- `contact_messages` — standalone (public visitors)

Deleting a user cascades: their profile, connections, messages, jobs
(and those jobs' applications), announcements and notifications are removed
automatically.

## Sample Queries Used by the App

All queries in `app.py` are **parameterised** (`?` placeholders).

**Member directory** — one query joins all three profile tables; `COALESCE`
picks whichever profile the member actually has:

```sql
SELECT u.*,
       COALESCE(sp.skills, ap.skills, fp.skills) AS skills,
       COALESCE(sp.bio, ap.bio, fp.bio)          AS bio,
       ap.company, sp.branch, sp.course, fp.department
FROM users u
LEFT JOIN student_profile sp ON sp.user_id = u.id
LEFT JOIN alumni_profile  ap ON ap.user_id  = u.id
LEFT JOIN faculty_profile fp ON fp.user_id  = u.id
WHERE u.role != 'admin' AND u.is_active = 1
  AND (u.name LIKE ? OR sp.skills LIKE ? OR ap.skills LIKE ?
       OR fp.skills LIKE ? OR ap.company LIKE ?)
ORDER BY u.name;
```

**Relationship between two users** (drives the Connect/Message button):

```sql
SELECT * FROM connections
WHERE (sender_id = ? AND receiver_id = ?)
   OR (sender_id = ? AND receiver_id = ?);
```

**Unread badges** (navbar, run on every page through the context processor):

```sql
SELECT COUNT(*) FROM messages
WHERE receiver_id = ? AND is_read = 0;

SELECT COUNT(*) FROM notifications
WHERE user_id = ? AND is_read = 0;
```

**Job list with the poster's name:**

```sql
SELECT j.*, u.name AS alumni_name
FROM jobs j JOIN users u ON u.id = j.alumni_id
ORDER BY j.id DESC;
```

**Applicants of one job** (for the alumni):

```sql
SELECT a.*, u.name AS student_name, u.email AS student_email,
       sp.course, sp.branch, sp.year
FROM applications a
JOIN users u ON u.id = a.student_id
LEFT JOIN student_profile sp ON sp.user_id = u.id
WHERE a.job_id = ?
ORDER BY a.id DESC;
```

**Saving a contact-form message:**

```sql
INSERT INTO contact_messages (name, email, subject, message)
VALUES (?, ?, ?, ?);
```
