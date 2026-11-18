# Project Overview — Alumni Hub

## What is Alumni Hub?

**Alumni Hub** is a web application that connects the **Students**, **Alumni**
and **Faculty** of a college on a single platform. Students build a profile,
find and connect with alumni, chat with them and apply for jobs that alumni
post. Faculty members post announcements for the whole community, and an
**Admin** manages users, jobs and contact messages.

It is the *minor project* version of a larger Alumni Hub concept: the scope is
deliberately small, the code is a single well-commented Flask application, and
every feature can be explained easily in a viva.

## Problem Statement

After graduation, students lose touch with their college. Juniors have no easy
way to reach seniors for career guidance or referrals, alumni have no channel
to share job openings with their own college, and faculty announcements get
scattered across notice boards and chat groups. Colleges typically have no
single, simple system that keeps all three groups connected.

## Objectives

1. Provide one common platform for students, alumni and faculty of a college.
2. Let members create rich profiles (photo, skills, role-specific details).
3. Enable networking through connection requests (send / accept / reject).
4. Provide simple one-to-one messaging between connected members.
5. Let alumni share jobs/internships and let students apply online.
6. Give faculty a channel for announcements to all members.
7. Give the admin tools to manage users and content, with basic statistics.
8. Offer public pages (Home, About, Services, Contact) so visitors can learn
   about the platform before joining.

## Scope

**In scope**

- Role-based accounts: Student, Alumni, Faculty, Admin
- Profiles, member directory with search, connections, 1-to-1 chat
- Job board with applications and status tracking
- Announcements and in-app notifications
- Admin panel (statistics, user/job management, contact-message inbox)
- Public pages: Home, About, Services, Contact (with a working contact form)

**Out of scope (by design — see [MEMORY.md](MEMORY.md))**

- Email verification / OTP, password reset by email
- Real-time (websocket) chat, group chat, file sharing in chat
- Online payments, resume parsing, job recommendations
- Mobile apps (the website itself is responsive)

## Target Users

| User | What they do on the platform |
|------|------------------------------|
| **Student** | Creates a profile, connects with alumni/faculty, chats, applies for jobs, reads announcements |
| **Alumni** | Connects with juniors and teachers, posts jobs from their company, manages applicants |
| **Faculty** | Posts announcements, connects with students and alumni |
| **Admin** | Manages users (block/unblock/delete), manages jobs, reads contact messages, views statistics |
| **Visitor (guest)** | Reads the public pages (Home, About, Services, Contact) and registers |

## Feature List

- **Authentication** — register, login, logout, change password; passwords
  stored only as hashes (Werkzeug); role-based access control on every route
- **Profiles** — view/edit profile, profile-picture upload, role-specific
  fields (course/branch/year for students; company/designation/experience for
  alumni; department/designation/qualification for faculty)
- **Member Directory** — search by name/skills/company, filter by role,
  plus instant live filtering while typing
- **Connections** — send, accept and reject connection requests; lists of
  my connections, received requests and sent requests
- **Chat** — one-to-one messaging, conversation list with last message and
  unread counts, navbar unread badge
- **Job Portal** — alumni post/edit/delete jobs; students search and apply
  with a cover note; alumni see applicants and set status
  (Applied / Shortlisted / Rejected); students track "My Applications"
- **Announcements** — faculty posts announcements visible to all members
- **Notifications** — automatic alerts for connection requests, new jobs,
  applications and status changes; bell badge in the navbar
- **Admin Panel** — dashboard with counts and a Chart.js "Users by Role"
  chart, manage users (search, block/unblock, delete), manage jobs (delete),
  and an inbox for messages sent from the Contact page
- **Public Pages** — Home (live statistics with count-up animation, latest
  jobs), About (mission & vision), Services, Contact (form saved to the
  database), a common rich footer on every page
