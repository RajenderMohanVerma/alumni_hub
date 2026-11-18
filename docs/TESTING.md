# Testing — Alumni Hub

Testing was done in three layers: an automated end-to-end flow test with
Flask's test client, a real-browser test for the JavaScript behaviours, and
live checks against the deployed Vercel site. All tests were run against
throwaway copies / temporary databases, so the delivered project's database
contains only clean seed data.

## 1. Automated Full-Flow Test (Flask test client)

A fresh virtual environment was created, `pip install -r requirements.txt`
run, the database seeded, and **60 checks** were executed through the whole
user journey. Result: **60 / 60 passed.**

| Area | Checks |
|------|--------|
| Registration | New student registers; password stored as a hash (not plain text); profile row auto-created; duplicate email rejected |
| Login | Correct password logs in; wrong password rejected; blocked user cannot log in |
| Profile | Edit profile saves basic + role fields; profile page shows them |
| Directory | Members listed; text search works; role filter works |
| Connections | Student sends a request → alumni accepts → both see each other as connections; notifications created on request and on accept |
| Chat | Messages sent both ways appear in the thread; unread count decreases after opening the chat |
| Jobs | Alumni posts a job (all students get a notification); student applies; double-apply is blocked; alumni sees the applicant and sets status to *Shortlisted* (student is notified) |
| Announcements | Faculty posts an announcement; a student can read it |
| Role protection | Student is blocked from `/admin` and from posting a job (redirect/403 as designed) |
| Admin | Admin login works; dashboard, users page (search) load; block → user cannot log in; unblock restores access |
| Password | Change password works; login with the new password succeeds |
| Errors | Unknown URL returns the custom 404 page |

## 2. Common Pages & Contact Flow (polish pass)

Verified with the test client on a fresh seeded copy:

| Check | Result |
|-------|--------|
| Guest `GET /`, `/about`, `/services`, `/contact` | 200 each |
| `POST /contact` with name/email/subject/message | Row saved in `contact_messages`; success flash shown; redirect back to `/contact` |
| Admin `GET /admin/messages` | 200; the submitted message is listed (newest first) |
| Admin deletes the message | Row removed from `contact_messages`; no longer listed |
| Non-admin `GET /admin/messages` | Redirected (role protection intact) |
| Regression: register → login → connect → chat → post job → apply | All still pass after the polish changes |
| `python3 -m py_compile` on all `.py` files | Clean |

## 3. Browser Tests (real Chromium, local server)

| Check | Result |
|-------|--------|
| Home, login, student dashboard, jobs, admin dashboard render correctly (desktop + mobile viewport) | Passed (screenshots reviewed) |
| **Click-to-fill demo login**: clicking the *Student* demo button fills `student@demo.com / student123`, Login opens the dashboard; same for the *Admin* button → admin panel | Passed |
| Admin dashboard Chart.js "Users by Role" chart renders with seed data (3 students, 3 alumni, 2 faculty) | Passed |
| Mobile dashboard (390 px): stat-card labels fit after the small-screen CSS fix | Passed |

Note: the sandbox browser used for screenshots cannot reach public CDNs
directly, so Bootstrap/Font Awesome/Chart.js files were served to it
locally through request interception. The page HTML/JS under test was
identical to production.

## 4. Vercel Live Checks

Against **https://alumnihubclg.vercel.app**:

| Check | Result |
|-------|--------|
| First deployment (before fix) | `500 FUNCTION_INVOCATION_FAILED` — "could not import app.py" (DB opened in read-only bundle) |
| After the `/tmp` + auto-seed fix (commit `28a830a`) | Home page returns **200** with hero content |
| Demo student login on the live site | Works; dashboard opens |
| Jobs page on the live site (logged in) | Renders seeded jobs |
| After the demo-button commit (`5889a87`) | Live `/login` page contains the new demo-account buttons |
| Vercel-mode boot test locally (`VERCEL=1`, `/tmp` DB) | App boots, auto-seeds, home/login/jobs return 200 |

## 5. How to Re-run the Checks Quickly

```bash
pip install -r requirements.txt
python seed.py
python app.py            # then click through the flows in a browser
```

Key manual smoke test (2 minutes): register a student → log in → edit
profile → send a connection request to an alumnus → log in as the alumnus →
accept → exchange a chat message → alumnus posts a job → student applies →
alumnus shortlists → log in as admin → check the dashboard, block a test
user, and read the Contact inbox at `/admin/messages`.
