"""
seed.py - Fill the database with demo data.

Run once before using the app:   python seed.py

It creates demo users (admin, students, alumni, faculty), a few jobs,
connections, chat messages, an announcement and applications - so the
app looks alive the first time you open it.

Demo logins (also written in README.md):
    Admin   : admin@alumnihub.com  / admin123
    Student : student@demo.com     / student123
    Alumni  : alumni@demo.com      / alumni123
    Faculty : faculty@demo.com     / faculty123
"""

from datetime import date, timedelta

from werkzeug.security import generate_password_hash

import models
from models import get_raw_connection

# (name, email, password, role, phone)
USERS = [
    ("Admin", "admin@alumnihub.com", "admin123", "admin", "9999999999"),
    ("Rahul Sharma", "student@demo.com", "student123", "student", "9876543210"),
    ("Priya Patel", "priya@demo.com", "student123", "student", "9876543211"),
    ("Amit Verma", "amit@demo.com", "student123", "student", "9876543212"),
    ("Neha Gupta", "alumni@demo.com", "alumni123", "alumni", "9876543213"),
    ("Vikram Singh", "vikram@demo.com", "alumni123", "alumni", "9876543214"),
    ("Sneha Reddy", "sneha@demo.com", "alumni123", "alumni", "9876543215"),
    ("Dr. Rajesh Kumar", "faculty@demo.com", "faculty123", "faculty", "9876543216"),
    ("Dr. Ananya Iyer", "ananya@demo.com", "faculty123", "faculty", "9876543217"),
]

# email -> profile fields for that user
STUDENT_PROFILES = {
    "student@demo.com": ("B.Tech", "Computer Science", "3rd Year",
        "Python, Java, HTML, CSS", "Final-year student interested in web development."),
    "priya@demo.com": ("MCA", "Information Technology", "1st Year",
        "Python, SQL, JavaScript", "MCA student who loves building small web apps."),
    "amit@demo.com": ("B.Tech", "Electronics", "2nd Year",
        "C, Python, IoT", "Electronics student exploring embedded systems."),
}
ALUMNI_PROFILES = {
    "alumni@demo.com": ("TCS", "Software Engineer", "3 years",
        "Python, Flask, React", "Working at TCS, Pune. Happy to mentor juniors."),
    "vikram@demo.com": ("Infosys", "Senior Developer", "5 years",
        "Java, Spring, AWS", "Full-stack developer at Infosys, Bengaluru."),
    "sneha@demo.com": ("Wipro", "Data Analyst", "2 years",
        "SQL, Python, Excel", "Data analyst who enjoys dashboards and reports."),
}
FACULTY_PROFILES = {
    "faculty@demo.com": ("Computer Science", "Professor", "PhD",
        "Machine Learning, Databases", "Professor and Head of the CS department."),
    "ananya@demo.com": ("Information Technology", "Assistant Professor", "M.Tech",
        "Web Technologies, Cloud", "Assistant Professor, IT department."),
}


def main():
    models.init_db()
    conn = get_raw_connection()

    # --- users + profiles (INSERT OR IGNORE = safe to run seed twice) ---
    ids = {}
    for name, email, password, role, phone in USERS:
        conn.execute(
            """INSERT OR IGNORE INTO users (name, email, password_hash, role, phone)
               VALUES (?, ?, ?, ?, ?)""",
            (name, email, generate_password_hash(password), role, phone),
        )
        row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        ids[email] = row["id"]

    for email, (course, branch, year, skills, bio) in STUDENT_PROFILES.items():
        conn.execute(
            """INSERT OR IGNORE INTO student_profile
               (user_id, course, branch, year, skills, bio) VALUES (?, ?, ?, ?, ?, ?)""",
            (ids[email], course, branch, year, skills, bio),
        )
    for email, (company, desig, exp, skills, bio) in ALUMNI_PROFILES.items():
        conn.execute(
            """INSERT OR IGNORE INTO alumni_profile
               (user_id, company, designation, experience, skills, bio)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (ids[email], company, desig, exp, skills, bio),
        )
    for email, (dept, desig, qual, skills, bio) in FACULTY_PROFILES.items():
        conn.execute(
            """INSERT OR IGNORE INTO faculty_profile
               (user_id, department, designation, qualification, skills, bio)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (ids[email], dept, desig, qual, skills, bio),
        )

    rahul, priya = ids["student@demo.com"], ids["priya@demo.com"]
    neha, vikram = ids["alumni@demo.com"], ids["vikram@demo.com"]
    rajesh = ids["faculty@demo.com"]

    # --- connections: Rahul<->Neha accepted, Rahul->Vikram pending ---
    conn.execute(
        "INSERT OR IGNORE INTO connections (sender_id, receiver_id, status) VALUES (?, ?, 'accepted')",
        (rahul, neha),
    )
    conn.execute(
        "INSERT OR IGNORE INTO connections (sender_id, receiver_id, status) VALUES (?, ?, 'accepted')",
        (priya, neha),
    )
    conn.execute(
        "INSERT OR IGNORE INTO connections (sender_id, receiver_id, status) VALUES (?, ?, 'pending')",
        (rahul, vikram),
    )

    # --- a small chat between Rahul and Neha ---
    chat = [
        (neha, rahul, "Hi Rahul! I saw your profile - you are learning Flask, great!"),
        (rahul, neha, "Hello ma'am! Yes, I am building my project on Flask."),
        (neha, rahul, "Nice. Feel free to ask me if you get stuck anywhere."),
    ]
    existing = conn.execute("SELECT COUNT(*) c FROM messages").fetchone()["c"]
    if existing == 0:
        conn.executemany(
            "INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)", chat
        )

    # --- jobs posted by alumni ---
    deadline1 = (date.today() + timedelta(days=30)).isoformat()
    deadline2 = (date.today() + timedelta(days=20)).isoformat()
    deadline3 = (date.today() + timedelta(days=45)).isoformat()
    jobs = [
        (neha, "Software Developer Intern", "TCS", "Pune", "25,000/month",
         "Work with the web team on live projects. Good knowledge of Python "
         "and basic HTML/CSS is required. Stipend for 6 months internship.",
         deadline1),
        (vikram, "Junior Web Developer", "Infosys", "Bengaluru", "4.5 LPA",
         "Entry-level web developer role. You will build and maintain "
         "company websites using JavaScript and Java.",
         deadline2),
        (ids["sneha@demo.com"], "Data Analyst Trainee", "Wipro", "Hyderabad",
         "3.8 LPA",
         "Analyse business data and prepare reports using SQL and Excel. "
         "Freshers with good SQL skills can apply.",
         deadline3),
    ]
    job_ids = []
    for job in jobs:
        cur = conn.execute(
            """INSERT INTO jobs (alumni_id, title, company, location, salary,
                                 description, deadline)
               SELECT ?, ?, ?, ?, ?, ?, ?
               WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE title = ?)""",
            (*job, job[1]),
        )
        row = conn.execute("SELECT id FROM jobs WHERE title = ?", (job[1],)).fetchone()
        job_ids.append(row["id"])

    # --- applications: Rahul applied to Infosys job, Priya shortlisted at TCS ---
    conn.execute(
        """INSERT OR IGNORE INTO applications (job_id, student_id, cover_note, status)
           VALUES (?, ?, ?, 'Applied')""",
        (job_ids[1], rahul, "I have built two Flask projects and I am eager to learn."),
    )
    conn.execute(
        """INSERT OR IGNORE INTO applications (job_id, student_id, cover_note, status)
           VALUES (?, ?, ?, 'Shortlisted')""",
        (job_ids[0], priya, "I am good at Python and SQL. Please consider my application."),
    )

    # --- one announcement by faculty ---
    existing = conn.execute("SELECT COUNT(*) c FROM announcements").fetchone()["c"]
    if existing == 0:
        conn.execute(
            "INSERT INTO announcements (faculty_id, title, body) VALUES (?, ?, ?)",
            (rajesh, "Alumni Meet 2026",
             "The annual Alumni Meet will be held on 20 December in the college "
             "auditorium. All students and alumni are invited. Please register "
             "at the department office."),
        )

    # --- a welcome notification for the demo student ---
    existing = conn.execute("SELECT COUNT(*) c FROM notifications").fetchone()["c"]
    if existing == 0:
        conn.execute(
            "INSERT INTO notifications (user_id, text, link) VALUES (?, ?, ?)",
            (rahul, "Welcome to Alumni Hub! Complete your profile to connect "
                    "with more people.", "/profile/edit"),
        )

    conn.commit()
    conn.close()
    print("Demo data created successfully!")
    print("Login with: student@demo.com / student123 (see README for all accounts)")


if __name__ == "__main__":
    main()
