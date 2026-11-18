"use strict";
/*
 * recommend.js - "Suggested for You" recommendations (KNN-style)
 *
 * WHAT IS KNN HERE?
 * -----------------
 * KNN = K-Nearest Neighbours, a classic machine-learning idea.
 * Think of every user as a POINT in a "feature space": the features are
 * the things on a profile - course/branch (domain), skills, interests
 * (keywords from the bio), batch/year and city. The DISTANCE between two
 * points is "how different are these two people?". This file computes the
 * opposite - a SIMILARITY score between 0 and 1 (1 = identical) - for the
 * logged-in user against every other member, sorts the scores, and
 * recommends the K highest-scoring people: the K nearest neighbours.
 * Jobs are recommended the same way: a job is "close" to a student when
 * the job's text mentions the student's skills and course keywords.
 *
 * No ML library is used on purpose: the maths is a weighted sum of small,
 * explainable pieces (see the WEIGHTS below), so every suggestion can
 * show WHY it was made ("3 common skills: Python, Java", ...).
 *
 * The two public functions:
 *   recommendPeople(db, currentUser, k = 6)  -> people suggestions
 *   recommendJobs(db, currentUser, k = 3)    -> job suggestions
 * Both also accept the caller's already-loaded profile row as an
 * optional last argument, so it is never fetched twice. Candidates
 * and their profiles are loaded with a single JOIN query and scored
 * in memory - the scores are identical to the old one-query-per-
 * person version, just with far fewer database round trips.
 * Both return objects with a ready-to-show matchPercent (0-100) and a
 * list of human-readable `reasons`.
 */

const models = require("./models");

// ---------------------------------------------------------------------------
// The weights of the similarity score (they add up to 1.00)
// ---------------------------------------------------------------------------
// Same course / domain matters most, together with shared skills.
// Interests, batch closeness and city are smaller "nice to have" signals.
const WEIGHTS = {
  domain: 0.30, // same course / branch / department
  skills: 0.30, // Jaccard overlap of the skills lists
  interests: 0.15, // Jaccard overlap of bio keywords
  batch: 0.15, // how close the batch / year numbers are
  city: 0.10, // same city (read from the bio text when mentioned)
};

// Preference boost: when a STUDENT looks at suggestions, alumni and
// faculty get a small extra push (+0.05) because they are the mentors /
// seniors a student usually wants to meet first. This is the
// "preference" part of the score; the final score is clamped to 1.
const MENTOR_BOOST = 0.05;

// Words that carry no meaning for matching (removed before comparing).
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "at", "on", "for", "to",
  "with", "who", "is", "am", "are", "was", "were", "i", "my", "me",
  "our", "your", "their", "it", "its", "this", "that", "from", "by",
  "student", "students", "alumni", "faculty", "professor", "working",
  "work", "interested", "exploring", "enjoys", "enjoy", "loves", "love",
  "likes", "happy", "mentor", "juniors", "seniors", "department",
  "final", "year", "years",
]);

// Cities we can recognise when a bio mentions one (there is no separate
// "city" column in the database, so the bio text is the only source).
const KNOWN_CITIES = [
  "Delhi", "New Delhi", "Mumbai", "Pune", "Bengaluru", "Bangalore",
  "Hyderabad", "Chennai", "Kolkata", "Ahmedabad", "Jaipur", "Lucknow",
  "Indore", "Kochi", "Chandigarh", "Noida", "Gurugram", "Surat",
  "Nagpur", "Bhopal", "Patna", "Kota",
];

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------
/** Split any text into a Set of lowercase word tokens. */
function tokenize(text) {
  const tokens = new Set();
  if (!text) return tokens;
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9+#.]+/)) {
    // Trim dots at the edges ("development." -> "development") but keep
    // inner ones ("b.tech" stays "b.tech")
    const word = raw.replace(/^\.+|\.+$/g, "");
    if (word.length > 1) tokens.add(word);
  }
  return tokens;
}

/** Like tokenize(), but removes stopwords (used for bio "interests"). */
function keywordTokens(text) {
  const tokens = tokenize(text);
  for (const word of [...tokens]) {
    if (STOPWORDS.has(word)) tokens.delete(word);
  }
  return tokens;
}

/** Jaccard similarity of two Sets: |A n B| / |A u B|, between 0 and 1. */
function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let common = 0;
  for (const item of setA) if (setB.has(item)) common++;
  return common / (setA.size + setB.size - common);
}

/** "Python, Java, HTML" -> Map of lowercase skill -> original spelling. */
function skillMap(skillsText) {
  const map = new Map();
  if (!skillsText) return map;
  for (const part of String(skillsText).split(",")) {
    const skill = part.trim();
    if (skill) map.set(skill.toLowerCase(), skill);
  }
  return map;
}

/** Find a known city mentioned in a text (or null). */
function detectCity(text) {
  if (!text) return null;
  const lower = " " + String(text).toLowerCase() + " ";
  for (const city of KNOWN_CITIES) {
    if (lower.includes(" " + city.toLowerCase() + " ") ||
        lower.includes(" " + city.toLowerCase() + ".") ||
        lower.includes(" " + city.toLowerCase() + ",")) {
      return city;
    }
  }
  return null;
}

/**
 * A single "batch number" used for the closeness formula:
 *  - a 4-digit passout year when the profile has one ("Batch of 2023")
 *  - otherwise the first number found: a student's year ("3rd Year" -> 3)
 *    or an alumnus's experience ("3 years" -> 3)
 * Returns { value, label } or null when nothing can be read.
 */
function batchInfo(profile, role) {
  if (!profile) return null;
  const raw = role === "student" ? profile.year
    : role === "alumni" ? profile.experience
    : null;
  if (!raw) return null;
  const yearMatch = String(raw).match(/(19|20)\d{2}/);
  if (yearMatch) return { value: parseInt(yearMatch[0], 10), label: "Batch of " + yearMatch[0] };
  const numMatch = String(raw).match(/\d+/);
  if (numMatch) return { value: parseInt(numMatch[0], 10), label: String(raw).trim() };
  return null;
}

// ---------------------------------------------------------------------------
// Feature extraction: turn a user + profile row into comparable features
// ---------------------------------------------------------------------------
function extractFeatures(user, profile) {
  const p = profile || {};
  // The "domain" of a person: course+branch (student), department
  // (faculty) or designation (alumni) - whatever the profile offers.
  const domainParts = [p.course, p.branch, p.department, p.designation]
    .filter(Boolean);
  return {
    user,
    profile: p,
    domainLabel: domainParts.join(" "),
    domainTokens: tokenize(domainParts.join(" ")),
    course: (p.course || "").trim().toLowerCase(),
    branch: (p.branch || "").trim().toLowerCase(),
    department: (p.department || "").trim().toLowerCase(),
    skills: skillMap(p.skills),
    interests: keywordTokens(p.bio),
    batch: batchInfo(p, user.role),
    city: detectCity(p.bio),
  };
}

/** Load the features of one user (user row + its role-profile row). */
function featuresFor(db, user) {
  return extractFeatures(user, models.getProfile(user.id, user.role));
}

/**
 * Split one row of the candidates JOIN query (see recommendPeople)
 * back into the plain user object + role-profile object (or null)
 * that the old two-step loading produced. The JOIN prefixes are:
 * s_ = student_profile, a_ = alumni_profile, f_ = faculty_profile.
 * A member has exactly one role, so at most one profile can exist;
 * the *_uid marker tells whether that profile row is really there
 * (all its other columns would be NULL as well when it is not).
 */
function splitCandidateRow(row) {
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    phone: row.phone,
    profile_pic: row.profile_pic,
    is_active: row.is_active,
    created_at: row.created_at,
    has_photo: row.has_photo,
    photo_updated_at: row.photo_updated_at,
  };
  let profile = null;
  if (row.role === "student" && row.s_uid != null) {
    profile = {
      user_id: row.s_uid, course: row.s_course, branch: row.s_branch,
      year: row.s_year, skills: row.s_skills, bio: row.s_bio,
    };
  } else if (row.role === "alumni" && row.a_uid != null) {
    profile = {
      user_id: row.a_uid, company: row.a_company,
      designation: row.a_designation, experience: row.a_experience,
      skills: row.a_skills, bio: row.a_bio,
    };
  } else if (row.role === "faculty" && row.f_uid != null) {
    profile = {
      user_id: row.f_uid, department: row.f_department,
      designation: row.f_designation,
      qualification: row.f_qualification, skills: row.f_skills,
      bio: row.f_bio,
    };
  }
  return { user, profile };
}

/**
 * Features of the logged-in user. The dashboard route has usually
 * loaded this profile already and passes it in, so it is not fetched
 * a second time here; when no profile is passed, load it as before.
 */
function myFeatures(currentUser, currentProfile) {
  return extractFeatures(
    currentUser,
    currentProfile !== undefined
      ? currentProfile
      : models.getProfile(currentUser.id, currentUser.role)
  );
}

// ---------------------------------------------------------------------------
// Similarity between two people (0..1) + the reasons behind the score
// ---------------------------------------------------------------------------
function similarity(me, other) {
  const reasons = [];
  let score = 0;

  // --- 1) Domain (weight 0.30) -------------------------------------------
  // Exact structured matches score best; otherwise fall back to the
  // overlap of domain words (e.g. branch "Computer Science" vs faculty
  // department "Computer Science").
  let domainScore = 0;
  if (me.course && other.course && me.course === other.course) {
    domainScore = me.branch && me.branch === other.branch ? 1 : 0.6;
    if (domainScore === 1) {
      reasons.push(`Same course: ${other.profile.course} (${other.profile.branch})`);
    } else {
      reasons.push(`Same course: ${other.profile.course}`);
    }
  } else if (
    (me.branch && other.department && me.branch === other.department) ||
    (other.branch && me.department && other.branch === me.department)
  ) {
    domainScore = 1;
    reasons.push(`Same domain: ${other.profile.department || other.profile.branch}`);
  } else {
    domainScore = jaccard(me.domainTokens, other.domainTokens);
    if (domainScore >= 0.34) {
      const shared = [...me.domainTokens].filter((t) => other.domainTokens.has(t));
      if (shared.length) {
        reasons.push("Similar domain: " + shared.map(titleCase).join(", "));
      }
    }
  }
  score += WEIGHTS.domain * domainScore;

  // --- 2) Skills overlap - Jaccard (weight 0.30) --------------------------
  const mySkills = new Set(me.skills.keys());
  const theirSkills = new Set(other.skills.keys());
  const skillsScore = jaccard(mySkills, theirSkills);
  score += WEIGHTS.skills * skillsScore;
  const commonSkills = [...mySkills].filter((s) => theirSkills.has(s));
  if (commonSkills.length) {
    const names = commonSkills.slice(0, 3).map((s) => other.skills.get(s));
    reasons.push(
      `${commonSkills.length} common skill${commonSkills.length > 1 ? "s" : ""}: ${names.join(", ")}`
    );
  }

  // --- 3) Interests overlap - bio keywords, Jaccard (weight 0.15) ---------
  const interestsScore = jaccard(me.interests, other.interests);
  score += WEIGHTS.interests * interestsScore;
  const commonInterests = [...me.interests].filter((t) => other.interests.has(t));
  if (commonInterests.length >= 2) {
    reasons.push("Shared interests: " + commonInterests.slice(0, 2).join(", "));
  }

  // --- 4) Batch closeness (weight 0.15) ------------------------------------
  // closeness = 1 - min(|yearA - yearB|, 5) / 5   (same batch -> 1,
  // 5 or more years apart -> 0)
  if (me.batch && other.batch) {
    const gap = Math.abs(me.batch.value - other.batch.value);
    const closeness = 1 - Math.min(gap, 5) / 5;
    score += WEIGHTS.batch * closeness;
    if (gap === 0 && me.batch.label === other.batch.label) {
      reasons.push(
        me.batch.label.startsWith("Batch of")
          ? me.batch.label
          : `Same batch: ${me.batch.label}`
      );
    }
  }

  // --- 5) Same city (weight 0.10) ------------------------------------------
  if (me.city && other.city && me.city === other.city) {
    score += WEIGHTS.city;
    reasons.push(`Same city: ${me.city}`);
  }

  // --- Preference boost: students meet mentors first -----------------------
  if (me.user.role === "student" &&
      (other.user.role === "alumni" || other.user.role === "faculty")) {
    score += MENTOR_BOOST;
  }

  return { score: Math.min(score, 1), reasons: reasons.slice(0, 4) };
}

/** "computer" -> "Computer" (only for pretty reason text). */
function titleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ---------------------------------------------------------------------------
// Public API: people recommendations
// ---------------------------------------------------------------------------
/**
 * The K nearest neighbours of the logged-in user, as people suggestions.
 * Candidates: every active member except the user himself, EXCLUDING
 * people he is already connected with or has a pending request with
 * (in either direction) - suggesting them again would be useless.
 */
function recommendPeople(db, currentUser, k = 6, currentProfile) {
  const me = myFeatures(currentUser, currentProfile);

  const excluded = new Set([currentUser.id]);
  const links = db
    .prepare(
      `SELECT sender_id, receiver_id FROM connections
        WHERE (sender_id = ? OR receiver_id = ?)
          AND status IN ('accepted', 'pending')`
    )
    .all(currentUser.id, currentUser.id);
  for (const link of links) {
    excluded.add(link.sender_id);
    excluded.add(link.receiver_id);
  }

  // Candidates AND their profiles in ONE query: users LEFT JOINed
  // with all three profile tables. This replaces a candidates query
  // plus one full-table query per profile table (4 round trips ->
  // 1); splitCandidateRow restores the exact user / profile shapes
  // the old loading produced, so the scoring below is unchanged.
  const candidateRows = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.phone, u.profile_pic,
              u.is_active, u.created_at,
              (u.photo_data IS NOT NULL) AS has_photo,
              u.photo_updated_at,
              sp.user_id AS s_uid, sp.course AS s_course,
              sp.branch AS s_branch, sp.year AS s_year,
              sp.skills AS s_skills, sp.bio AS s_bio,
              ap.user_id AS a_uid, ap.company AS a_company,
              ap.designation AS a_designation,
              ap.experience AS a_experience, ap.skills AS a_skills,
              ap.bio AS a_bio,
              fp.user_id AS f_uid, fp.department AS f_department,
              fp.designation AS f_designation,
              fp.qualification AS f_qualification,
              fp.skills AS f_skills, fp.bio AS f_bio
         FROM users u
         LEFT JOIN student_profile sp ON sp.user_id = u.id
         LEFT JOIN alumni_profile ap ON ap.user_id = u.id
         LEFT JOIN faculty_profile fp ON fp.user_id = u.id
        WHERE u.is_active = 1 AND u.role != 'admin'
        ORDER BY u.name`
    )
    .all();

  const scored = [];
  for (const row of candidateRows) {
    if (excluded.has(row.id)) continue;
    const { user, profile } = splitCandidateRow(row);
    const features = extractFeatures(user, profile);
    const { score, reasons } = similarity(me, features);
    if (score <= 0) continue; // nothing in common at all
    scored.push({
      user,
      profile: features.profile,
      score,
      matchPercent: Math.round(score * 100),
      reasons,
    });
  }
  // Highest score first (the "nearest" neighbours); name breaks ties so
  // the order is stable between page loads.
  scored.sort((a, b) => b.score - a.score || a.user.name.localeCompare(b.user.name));
  return scored.slice(0, k);
}

// ---------------------------------------------------------------------------
// Public API: job recommendations
// ---------------------------------------------------------------------------
/**
 * Jobs that are "close" to the user: the job text (title, company,
 * description, location) is searched for the user's skills and for
 * course/domain keywords. score = matched keywords / all keywords.
 * Jobs the user posted himself, or already applied to, are skipped.
 */
function recommendJobs(db, currentUser, k = 3, currentProfile) {
  const me = myFeatures(currentUser, currentProfile);

  // The keyword set we look for inside job texts
  const keywords = new Map(); // lowercase -> display text
  for (const [lower, original] of me.skills) keywords.set(lower, original);
  for (const token of me.domainTokens) {
    if (!STOPWORDS.has(token) && !keywords.has(token)) {
      keywords.set(token, titleCase(token));
    }
  }
  if (!keywords.size) return [];

  // Jobs the student already applied to are filtered out inside the
  // query itself (NOT IN subquery) - this used to cost a separate
  // "my applications" query plus an in-memory skip per job; the job
  // list that reaches the scoring loop is exactly the same.
  const jobs = db
    .prepare(
      `SELECT jobs.*, users.name AS poster_name FROM jobs
         JOIN users ON users.id = jobs.alumni_id
        WHERE jobs.alumni_id != ?
          AND jobs.id NOT IN (
            SELECT job_id FROM applications WHERE student_id = ?
          )
        ORDER BY jobs.id DESC`
    )
    .all(currentUser.id, currentUser.id);

  const scored = [];
  for (const job of jobs) {
    const text = [job.title, job.company, job.location, job.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const jobTokens = tokenize(text);
    const matched = [];
    for (const [lower, display] of keywords) {
      // A keyword matches when it is a whole word in the job text, or -
      // for multi-word skills like "Machine Learning" - a phrase in it.
      if (jobTokens.has(lower) || (lower.includes(" ") && text.includes(lower))) {
        matched.push(display);
      }
    }
    if (!matched.length) continue;
    const score = matched.length / keywords.size;
    const skillMatches = matched.filter((m) => me.skills.has(m.toLowerCase()));
    scored.push({
      job,
      score,
      matchPercent: Math.round(score * 100),
      matched,
      reason: skillMatches.length
        ? "Matches your skills: " + skillMatches.slice(0, 3).join(", ")
        : "Matches your course: " + matched.slice(0, 3).join(", "),
    });
  }
  scored.sort((a, b) => b.score - a.score || b.job.id - a.job.id);
  return scored.slice(0, k);
}

module.exports = {
  recommendPeople,
  recommendJobs,
  // Exported for tests / the documentation's worked example:
  similarity,
  featuresFor,
  WEIGHTS,
  MENTOR_BOOST,
};
