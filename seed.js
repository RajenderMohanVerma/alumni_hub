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
// The work is split into one small function per demo-content section.
// seedDemoData() (used by `node seed.js`) runs them all, in the same
// order as always. seedMissingSections() (used by the Express app when
// it boots against a SHARED database) runs only the sections whose
// table is still completely empty - see its comment further below.
//
// Every reference between sections is resolved by a NATURAL key
// (users by email, jobs by title + company), never by assuming numeric
// ids: in the shared database the users may have been inserted by the
// Python auth service, so their ids can differ from a local seed.
// Each section function returns true when it inserted at least one row,
// and quietly skips any row whose referenced user/job does not exist.

/** Number of rows in a table. */
function tableCount(db, table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

/** Id of the user with this email, or null when there is no such user. */
function userIdByEmail(db, email) {
  const row = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  return row ? row.id : null;
}

/** Id of the job with this title + company, or null when absent. */
function jobIdByTitleCompany(db, title, company) {
  const row = db
    .prepare("SELECT id FROM jobs WHERE title = ? AND company = ?")
    .get(title, company);
  return row ? row.id : null;
}

/** Resolve the demo users' ids by email (no inserts). Missing -> absent. */
function demoUserIds(db) {
  const ids = {};
  for (const [, email] of USERS) {
    const id = userIdByEmail(db, email);
    if (id !== null) ids[email] = id;
  }
  return ids;
}

// --- users + profiles (INSERT OR IGNORE = safe to run seed twice) ---
function seedUsersAndProfiles(db) {
  const ids = {};
  const insertUser = db.prepare(
    `INSERT OR IGNORE INTO users (name, email, password_hash, role, phone)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const [name, email, password, role, phone] of USERS) {
    insertUser.run(name, email, werkzeugHash(password), role, phone);
    ids[email] = userIdByEmail(db, email);
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
  return ids;
}

// --- connections: Rahul<->Neha accepted, Priya<->Neha accepted,
//     Rahul->Vikram pending ---
function seedConnections(db, ids) {
  const rahul = ids["student@demo.com"];
  const priya = ids["priya@demo.com"];
  const neha = ids["alumni@demo.com"];
  const vikram = ids["vikram@demo.com"];
  const insertConn = db.prepare(
    "INSERT OR IGNORE INTO connections (sender_id, receiver_id, status) VALUES (?, ?, ?)"
  );
  let inserted = false;
  if (rahul && neha) { insertConn.run(rahul, neha, "accepted"); inserted = true; }
  if (priya && neha) { insertConn.run(priya, neha, "accepted"); inserted = true; }
  if (rahul && vikram) { insertConn.run(rahul, vikram, "pending"); inserted = true; }
  return inserted;
}

// --- a small chat between Rahul and Neha ---
function seedMessages(db, ids) {
  const rahul = ids["student@demo.com"];
  const neha = ids["alumni@demo.com"];
  if (!rahul || !neha) return false;
  if (tableCount(db, "messages") !== 0) return false;
  const chat = [
    [neha, rahul, "Hi Rahul! I saw your profile - you are learning Flask, great!"],
    [rahul, neha, "Hello ma'am! Yes, I am building my project on Flask."],
    [neha, rahul, "Nice. Feel free to ask me if you get stuck anywhere."],
  ];
  const insertMsg = db.prepare(
    "INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)"
  );
  for (const m of chat) insertMsg.run(...m);
  return true;
}

// --- jobs posted by alumni ---
function seedJobs(db, ids) {
  const jobs = [
    [ids["alumni@demo.com"], "Software Developer Intern", "TCS", "Pune", "25,000/month",
     "Work with the web team on live projects. Good knowledge of Python " +
     "and basic HTML/CSS is required. Stipend for 6 months internship.",
     isoPlusDays(30)],
    [ids["vikram@demo.com"], "Junior Web Developer", "Infosys", "Bengaluru", "4.5 LPA",
     "Entry-level web developer role. You will build and maintain " +
     "company websites using JavaScript and Java.",
     isoPlusDays(20)],
    [ids["sneha@demo.com"], "Data Analyst Trainee", "Wipro", "Hyderabad",
     "3.8 LPA",
     "Analyse business data and prepare reports using SQL and Excel. " +
     "Freshers with good SQL skills can apply.",
     isoPlusDays(45)],
  ];
  const insertJob = db.prepare(
    `INSERT INTO jobs (alumni_id, title, company, location, salary,
                       description, deadline)
     SELECT ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE title = ? AND company = ?)`
  );
  let inserted = false;
  for (const job of jobs) {
    if (!job[0]) continue; // the posting alumnus is not in this database
    insertJob.run(...job, job[1], job[2]);
    inserted = true;
  }
  return inserted;
}

// --- applications: Rahul applied to Infosys job, Priya shortlisted at TCS ---
function seedApplications(db, ids) {
  const rahul = ids["student@demo.com"];
  const priya = ids["priya@demo.com"];
  // The referenced jobs are looked up by (title, company): they may
  // have just been inserted by seedJobs(), or may not exist at all
  // (in which case there is simply nothing to apply to).
  const infosysJob = jobIdByTitleCompany(db, "Junior Web Developer", "Infosys");
  const tcsJob = jobIdByTitleCompany(db, "Software Developer Intern", "TCS");
  const insertApp = db.prepare(
    `INSERT OR IGNORE INTO applications (job_id, student_id, cover_note, status)
     VALUES (?, ?, ?, ?)`
  );
  let inserted = false;
  if (infosysJob && rahul) {
    insertApp.run(infosysJob, rahul,
      "I have built two Flask projects and I am eager to learn.", "Applied");
    inserted = true;
  }
  if (tcsJob && priya) {
    insertApp.run(tcsJob, priya,
      "I am good at Python and SQL. Please consider my application.", "Shortlisted");
    inserted = true;
  }
  return inserted;
}

// --- one announcement by faculty ---
function seedAnnouncement(db, ids) {
  const rajesh = ids["faculty@demo.com"];
  if (!rajesh) return false;
  if (tableCount(db, "announcements") !== 0) return false;
  db.prepare(
    "INSERT INTO announcements (faculty_id, title, body) VALUES (?, ?, ?)"
  ).run(
    rajesh,
    "Alumni Meet 2026",
    "The annual Alumni Meet will be held on 20 December in the college " +
      "auditorium. All students and alumni are invited. Please register " +
      "at the department office."
  );
  return true;
}

// --- a welcome notification for the demo student ---
function seedWelcomeNotification(db, ids) {
  const rahul = ids["student@demo.com"];
  if (!rahul) return false;
  if (tableCount(db, "notifications") !== 0) return false;
  db.prepare(
    "INSERT INTO notifications (user_id, text, link) VALUES (?, ?, ?)"
  ).run(
    rahul,
    "Welcome to Alumni Hub! Complete your profile to connect " +
      "with more people.",
    "/profile/edit"
  );
  return true;
}

/**
 * Fill the database with the full demo dataset (used by `node seed.js`).
 * Same steps, same order, same output as always.
 */
function seedDemoData() {
  models.initDb();
  const db = models.openDb();

  const ids = seedUsersAndProfiles(db);
  seedConnections(db, ids);
  seedMessages(db, ids);
  seedJobs(db, ids);
  seedApplications(db, ids);
  seedAnnouncement(db, ids);
  seedWelcomeNotification(db, ids);

  console.log("Demo data created successfully!");
  console.log("Login with: student@demo.com / student123 (see README for all accounts)");
}

/**
 * Granular boot seed for the SHARED-database deployment (Vercel/Turso).
 *
 * The two services boot independently against the same cloud database,
 * and either one may seed first: the Python auth service fills the
 * demo users + profiles, which used to leave the Express app seeing
 * "users exist" and skipping the demo content entirely (no jobs, no
 * announcements, no connections). So instead of one all-or-nothing
 * check, every demo section is filled ONLY when its own table is
 * completely empty. That per-section "table completely empty" guard
 * is the safety boundary: a table that already holds real data (say,
 * a job a real alumnus posted) is never given demo rows.
 */
function seedMissingSections() {
  models.initDb();
  const db = models.openDb();
  const filled = [];

  let ids;
  if (tableCount(db, "users") === 0) {
    ids = seedUsersAndProfiles(db);
    filled.push("users");
  } else {
    ids = demoUserIds(db);
  }
  if (tableCount(db, "jobs") === 0 && seedJobs(db, ids)) {
    filled.push("jobs");
  }
  if (tableCount(db, "connections") === 0 && seedConnections(db, ids)) {
    filled.push("connections");
  }
  if (tableCount(db, "messages") === 0 && seedMessages(db, ids)) {
    filled.push("messages");
  }
  if (tableCount(db, "applications") === 0 && seedApplications(db, ids)) {
    filled.push("applications");
  }
  if (tableCount(db, "announcements") === 0 && seedAnnouncement(db, ids)) {
    filled.push("announcements");
  }
  if (tableCount(db, "notifications") === 0 && seedWelcomeNotification(db, ids)) {
    filled.push("notifications");
  }

  if (filled.length > 0) {
    console.log(`Demo auto-seed: filled empty section(s): ${filled.join(", ")}`);
  }
}

// Run directly:  node seed.js
if (require.main === module) {
  seedDemoData();
}

module.exports = { seedDemoData, seedMissingSections, werkzeugHash };
