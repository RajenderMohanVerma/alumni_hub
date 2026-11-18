"use strict";
/*
 * seed.js - Fill the database with demo data (JavaScript version).
 *
 * Run once before using the app:   node seed.js
 *
 * It creates demo users (admin, students, alumni, faculty), a few jobs,
 * connections, chat messages, an announcement and applications - so the
 * app looks alive the first time you open it.
 *
 * This is the JavaScript twin of seed.py (kept in the project root as
 * the canonical record of the demo data). Both create EXACTLY the same
 * users in the same order, so user ids are identical either way.
 *
 * PASSWORDS: demo users must be able to log in through the Python auth
 * service, which verifies passwords with Werkzeug. So the hashes below
 * are written in Werkzeug's own format - "scrypt:32768:8:1$salt$hash" -
 * using Node's built-in crypto.scryptSync. Werkzeug's
 * check_password_hash() accepts them exactly like its own hashes.
 *
 * Demo logins (also written in README.md):
 *     Admin   : admin@alumnihub.com  / admin123
 *     Student : student@demo.com     / student123
 *     Alumni  : alumni@demo.com      / alumni123
 *     Faculty : faculty@demo.com     / faculty123
 */

const crypto = require("crypto");
const models = require("./models");

// ---------------------------------------------------------------------------
// Password hashing in Werkzeug's scrypt format
// ---------------------------------------------------------------------------
/**
 * Hash a password exactly the way Werkzeug's generate_password_hash()
 * does by default: scrypt with N=32768, r=8, p=1, a 16-character salt
 * and a 64-byte derived key, stored as "scrypt:32768:8:1$salt$hexhash".
 */
function werkzeugHash(password) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let salt = "";
  for (let i = 0; i < 16; i++) {
    salt += chars[crypto.randomInt(chars.length)];
  }
  const hash = crypto.scryptSync(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024, // scrypt with these settings needs ~33 MB
  });
  return `scrypt:32768:8:1$${salt}$${hash.toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Demo data (identical to seed.py)
// ---------------------------------------------------------------------------
// [name, email, password, role, phone]
const USERS = [
  ["Admin", "admin@alumnihub.com", "admin123", "admin", "9999999999"],
  ["Rahul Sharma", "student@demo.com", "student123", "student", "9876543210"],
  ["Priya Patel", "priya@demo.com", "student123", "student", "9876543211"],
  ["Amit Verma", "amit@demo.com", "student123", "student", "9876543212"],
  ["Neha Gupta", "alumni@demo.com", "alumni123", "alumni", "9876543213"],
  ["Vikram Singh", "vikram@demo.com", "alumni123", "alumni", "9876543214"],
  ["Sneha Reddy", "sneha@demo.com", "alumni123", "alumni", "9876543215"],
  ["Dr. Rajesh Kumar", "faculty@demo.com", "faculty123", "faculty", "9876543216"],
  ["Dr. Ananya Iyer", "ananya@demo.com", "faculty123", "faculty", "9876543217"],
];

// email -> profile fields for that user
const STUDENT_PROFILES = {
  "student@demo.com": ["B.Tech", "Computer Science", "3rd Year",
    "Python, Java, HTML, CSS", "Final-year student interested in web development."],
  "priya@demo.com": ["MCA", "Information Technology", "1st Year",
    "Python, SQL, JavaScript", "MCA student who loves building small web apps."],
  "amit@demo.com": ["B.Tech", "Electronics", "2nd Year",
    "C, Python, IoT", "Electronics student exploring embedded systems."],
};
const ALUMNI_PROFILES = {
  "alumni@demo.com": ["TCS", "Software Engineer", "3 years",
    "Python, Flask, React", "Working at TCS, Pune. Happy to mentor juniors."],
  "vikram@demo.com": ["Infosys", "Senior Developer", "5 years",
    "Java, Spring, AWS", "Full-stack developer at Infosys, Bengaluru."],
  "sneha@demo.com": ["Wipro", "Data Analyst", "2 years",
    "SQL, Python, Excel", "Data analyst who enjoys dashboards and reports."],
};
const FACULTY_PROFILES = {
  "faculty@demo.com": ["Computer Science", "Professor", "PhD",
    "Machine Learning, Databases", "Professor and Head of the CS department."],
  "ananya@demo.com": ["Information Technology", "Assistant Professor", "M.Tech",
    "Web Technologies, Cloud", "Assistant Professor, IT department."],
};

/** 'YYYY-MM-DD' of today + the given number of days (local date). */
function isoPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// The seeding itself (same steps, same order as seed.py)
// ---------------------------------------------------------------------------
function seedDemoData() {
  models.initDb();
  const db = models.openDb();

  // --- users + profiles (INSERT OR IGNORE = safe to run seed twice) ---
  const ids = {};
  const insertUser = db.prepare(
    `INSERT OR IGNORE INTO users (name, email, password_hash, role, phone)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const [name, email, password, role, phone] of USERS) {
    insertUser.run(name, email, werkzeugHash(password), role, phone);
    const row = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    ids[email] = row.id;
  }

  const insertStudent = db.prepare(
    `INSERT OR IGNORE INTO student_profile
       (user_id, course, branch, year, skills, bio) VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const [email, fields] of Object.entries(STUDENT_PROFILES)) {
    insertStudent.run(ids[email], ...fields);
  }
  const insertAlumni = db.prepare(
    `INSERT OR IGNORE INTO alumni_profile
       (user_id, company, designation, experience, skills, bio)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const [email, fields] of Object.entries(ALUMNI_PROFILES)) {
    insertAlumni.run(ids[email], ...fields);
  }
  const insertFaculty = db.prepare(
    `INSERT OR IGNORE INTO faculty_profile
       (user_id, department, designation, qualification, skills, bio)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const [email, fields] of Object.entries(FACULTY_PROFILES)) {
    insertFaculty.run(ids[email], ...fields);
  }

  const rahul = ids["student@demo.com"];
  const priya = ids["priya@demo.com"];
  const neha = ids["alumni@demo.com"];
  const vikram = ids["vikram@demo.com"];
  const rajesh = ids["faculty@demo.com"];

  // --- connections: Rahul<->Neha accepted, Priya<->Neha accepted,
  //     Rahul->Vikram pending ---
  const insertConn = db.prepare(
    "INSERT OR IGNORE INTO connections (sender_id, receiver_id, status) VALUES (?, ?, ?)"
  );
  insertConn.run(rahul, neha, "accepted");
  insertConn.run(priya, neha, "accepted");
  insertConn.run(rahul, vikram, "pending");

  // --- a small chat between Rahul and Neha ---
  const chat = [
    [neha, rahul, "Hi Rahul! I saw your profile - you are learning Flask, great!"],
    [rahul, neha, "Hello ma'am! Yes, I am building my project on Flask."],
    [neha, rahul, "Nice. Feel free to ask me if you get stuck anywhere."],
  ];
  const msgCount = db.prepare("SELECT COUNT(*) AS c FROM messages").get().c;
  if (msgCount === 0) {
    const insertMsg = db.prepare(
      "INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)"
    );
    for (const m of chat) insertMsg.run(...m);
  }

  // --- jobs posted by alumni ---
  const jobs = [
    [neha, "Software Developer Intern", "TCS", "Pune", "25,000/month",
     "Work with the web team on live projects. Good knowledge of Python " +
     "and basic HTML/CSS is required. Stipend for 6 months internship.",
     isoPlusDays(30)],
    [vikram, "Junior Web Developer", "Infosys", "Bengaluru", "4.5 LPA",
     "Entry-level web developer role. You will build and maintain " +
     "company websites using JavaScript and Java.",
     isoPlusDays(20)],
    [ids["sneha@demo.com"], "Data Analyst Trainee", "Wipro", "Hyderabad",
     "3.8 LPA",
     "Analyse business data and prepare reports using SQL and Excel. " +
     "Freshers with good SQL skills can apply.",
     isoPlusDays(45)],
  ];
  const jobIds = [];
  const insertJob = db.prepare(
    `INSERT INTO jobs (alumni_id, title, company, location, salary,
                       description, deadline)
     SELECT ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE title = ?)`
  );
  for (const job of jobs) {
    insertJob.run(...job, job[1]);
    const row = db.prepare("SELECT id FROM jobs WHERE title = ?").get(job[1]);
    jobIds.push(row.id);
  }

  // --- applications: Rahul applied to Infosys job, Priya shortlisted at TCS ---
  const insertApp = db.prepare(
    `INSERT OR IGNORE INTO applications (job_id, student_id, cover_note, status)
     VALUES (?, ?, ?, ?)`
  );
  insertApp.run(jobIds[1], rahul,
    "I have built two Flask projects and I am eager to learn.", "Applied");
  insertApp.run(jobIds[0], priya,
    "I am good at Python and SQL. Please consider my application.", "Shortlisted");

  // --- one announcement by faculty ---
  const annCount = db.prepare("SELECT COUNT(*) AS c FROM announcements").get().c;
  if (annCount === 0) {
    db.prepare(
      "INSERT INTO announcements (faculty_id, title, body) VALUES (?, ?, ?)"
    ).run(
      rajesh,
      "Alumni Meet 2026",
      "The annual Alumni Meet will be held on 20 December in the college " +
        "auditorium. All students and alumni are invited. Please register " +
        "at the department office."
    );
  }

  // --- a welcome notification for the demo student ---
  const notifCount = db.prepare("SELECT COUNT(*) AS c FROM notifications").get().c;
  if (notifCount === 0) {
    db.prepare(
      "INSERT INTO notifications (user_id, text, link) VALUES (?, ?, ?)"
    ).run(
      rahul,
      "Welcome to Alumni Hub! Complete your profile to connect " +
        "with more people.",
      "/profile/edit"
    );
  }

  console.log("Demo data created successfully!");
  console.log("Login with: student@demo.com / student123 (see README for all accounts)");
}

// Run directly:  node seed.js
if (require.main === module) {
  seedDemoData();
}

module.exports = { seedDemoData, werkzeugHash };
