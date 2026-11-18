# The Recommendation System — "Suggested for You"

Alumni Hub suggests people (and, for students, jobs) on the dashboard.
The code lives in **`recommend.js`** — plain JavaScript, no ML library —
and this document explains the idea in simple words.

---

## 1. What is KNN?

**KNN = K-Nearest Neighbours**, one of the oldest and simplest
machine-learning algorithms.

Imagine every member plotted as a **point on a map**. The position of a
point is decided by the member's profile: course, skills, interests,
batch, city. Two members whose profiles are similar stand **close
together** on this map; two very different members stand far apart.

To recommend people for you, the system:

1. measures the distance between **you** and **every other member**,
2. converts distance into a **similarity score** (0 = nothing in common,
   1 = identical),
3. picks the **K highest scores** — your **K nearest neighbours** —
   and shows them as *"Suggested for You"*.

That is all KNN is: *find the K most similar items*. Here K = 6 for
people and K = 3 for jobs.

---

## 2. The features (what is compared)

Every user is turned into a small feature set from the `users` row plus
their role-profile row (`student_profile` / `alumni_profile` /
`faculty_profile`):

| Feature | Where it comes from | Example (Rahul, student) |
|---|---|---|
| **Domain** | course + branch (student), department (faculty), designation (alumni) | B.Tech, Computer Science |
| **Skills** | the `skills` field, split on commas | Python, Java, HTML, CSS |
| **Interests** | keywords of the `bio` text, common filler words removed | web, development |
| **Batch** | student's `year` ("3rd Year" → 3), a 4-digit passout year if present, alumnus's `experience` ("3 years" → 3) | 3 |
| **City** | a known city name mentioned in the `bio` text (there is no city column in the database) | — (not mentioned) |
| **Role** | `users.role` | student |

---

## 3. The similarity score and its weights

```
score = 0.30 × domain
      + 0.30 × skills overlap
      + 0.15 × interests overlap
      + 0.15 × batch closeness
      + 0.10 × same city
      + 0.05   mentor boost (only for students, see below)
      (final score is clamped to a maximum of 1)
```

| Part | Weight | How it is calculated |
|---|---|---|
| Domain | 0.30 | Same course **and** branch = 1 · same course only = 0.6 · a faculty department equal to the student's branch = 1 · otherwise word overlap of the domain words |
| Skills | 0.30 | **Jaccard overlap** = common skills ÷ all skills of both people together |
| Interests | 0.15 | Jaccard overlap of the bio keyword sets |
| Batch | 0.15 | closeness = `1 − min(|yearA − yearB|, 5) / 5` — same batch = 1, five or more years apart = 0 |
| City | 0.10 | 1 when both bios mention the same city, else 0 |
| Mentor boost | +0.05 | A **preference**: when a *student* is the viewer, alumni and faculty get a small push, because meeting seniors/mentors is usually the student's goal |

**Jaccard overlap** is just: *shared items ÷ total different items*.
If A knows {Python, Java} and B knows {Python, SQL}, the shared set is
{Python} (1 item) and the combined set is {Python, Java, SQL}
(3 items), so the overlap is 1/3 ≈ 0.33.

**Match %** shown on the dashboard is simply `round(score × 100)`.

**Who is never suggested:** yourself, blocked/inactive accounts, the
admin, and — importantly — people you are **already connected with**
or have a **pending request** with. Suggesting them again would be
useless.

**Reasons:** every suggestion card shows *why* — e.g. *"Same course:
B.Tech (Computer Science)"*, *"3 common skills: Python, Java"*,
*"Same city: Pune"*. A recommendation that cannot be explained is not
shown with fake reasons; if nothing matched, the member is not
suggested at all.

---

## 4. Job recommendations

Jobs are matched the same KNN way, with text instead of a profile:

- The student's keyword set = **skills + course/branch words**
  (for Rahul: Python, Java, HTML, CSS, B.Tech, Computer, Science → 7 keywords).
- Each job's title, company, location and description are searched for
  those keywords.
- `score = matched keywords ÷ all keywords`.
- Jobs the student already applied to, and jobs posted by the student
  himself, are skipped. Top 3 are shown as *"Recommended Jobs for You"*.

---

## 5. Worked example (the real demo data)

**Rahul Sharma** — student, B.Tech (Computer Science), 3rd Year,
skills *Python, Java, HTML, CSS*, bio *"…interested in web development."*

### Rahul ↔ Amit Verma (student, B.Tech Electronics, 2nd Year, skills C, Python, IoT)

| Part | Calculation | Points |
|---|---|---|
| Domain | same course (B.Tech), different branch → 0.6 × 0.30 | 0.180 |
| Skills | common = {Python}; combined = {Python, Java, HTML, CSS, C, IoT} → 1/6 ≈ 0.167 × 0.30 | 0.050 |
| Interests | {web, development} vs {electronics, embedded, systems} → no overlap | 0.000 |
| Batch | \|3 − 2\| = 1 → closeness 0.8 × 0.15 | 0.120 |
| City | neither bio names a city | 0.000 |
| **Total** | | **0.350 → 35% match** |

### Rahul's actual suggestion list on the seeded demo data

| Member | Match | Main reasons |
|---|---|---|
| Amit Verma (student) | 35% | Same course B.Tech · 1 common skill: Python |
| Dr. Rajesh Kumar (faculty) | 35% | Same domain: Computer Science (his department = Rahul's branch) + mentor boost |
| Sneha Reddy (alumni) | 22% | 1 common skill: Python · batch closeness · mentor boost |
| Priya Patel (student) | 16% | 1 common skill: Python · batch closeness · shared interest "web" |
| Dr. Ananya Iyer (faculty) | 5% | mentor boost only |

**Not suggested, on purpose:** Neha Gupta (would score 25%) is already
Rahul's accepted connection, and Vikram Singh has a pending request
from Rahul — both are excluded by the rules in §3.

### Rahul's top job

**Software Developer Intern @ TCS — 43% match.** The job description
mentions *Python* and *HTML/CSS*: 3 of Rahul's 7 keywords match
(Python, HTML, CSS) → 3/7 ≈ 0.43. The Infosys job is not shown because
Rahul already applied to it.

---

## 6. Where things live

| Piece | File |
|---|---|
| Feature extraction, similarity, `recommendPeople`, `recommendJobs` | `recommend.js` |
| Dashboard wiring (calls the recommender, passes results to views) | `app.js` → `GET /dashboard` |
| People cards ("Suggested for You") | `views/partials/suggestions.ejs` |
| Job cards ("Recommended Jobs for You") | `views/dashboard_student.ejs` |
| Profile completeness meter (better profile → better matches) | `views/partials/profile_meter.ejs` |
