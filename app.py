"""
app.py - Main application file of Alumni Hub (Minor Project)

Alumni Hub connects Students, Alumni and Faculty of a college on one
platform: they can build profiles, connect with each other, chat, share
jobs and read announcements. An Admin manages users and jobs.

All routes are written in this single file, grouped in sections:
    SETUP & HELPERS -> HOME -> AUTH -> DASHBOARDS -> PROFILE -> SEARCH
    -> CONNECTIONS -> CHAT -> JOBS -> ANNOUNCEMENTS -> NOTIFICATIONS -> ADMIN

Run with:  python app.py     (then open http://127.0.0.1:5000)
"""

import os
import sqlite3
from datetime import datetime
from functools import wraps

from flask import (Flask, abort, flash, redirect, render_template, request,
                   send_from_directory, url_for)
from flask_login import (LoginManager, UserMixin, current_user, login_required,
                         login_user, logout_user)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

import models
from config import ALLOWED_EXTENSIONS, UPLOAD_FOLDER
from models import get_db

# ---------------------------------------------------------------------------
# SETUP
# ---------------------------------------------------------------------------
app = Flask(__name__)
app.config.from_object("config")

# Create the uploads folder and all database tables when the app starts
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
models.init_db()

# --- Vercel demo support ---------------------------------------------------
# On Vercel the storage is temporary, so the database starts empty on every
# cold start. If there are no users yet, fill the demo data automatically
# (the same data seed.py creates) so the demo logins always work.
if os.environ.get("VERCEL"):
    _conn = models.get_raw_connection()
    _user_count = _conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
    _conn.close()
    if _user_count == 0:
        import seed
        seed.main()

# Close the database connection automatically at the end of each request
app.teardown_appcontext(models.close_db)

# Flask-Login setup (handles login sessions for us)
login_manager = LoginManager(app)
login_manager.login_view = "login"          # where to send guests
login_manager.login_message_category = "warning"


class User(UserMixin):
    """A logged-in user object, built from one row of the `users` table."""

    def __init__(self, row):
        self.id = row["id"]
        self.name = row["name"]
        self.email = row["email"]
        self.role = row["role"]
        self.phone = row["phone"]
        self.profile_pic = row["profile_pic"]
        self._is_active = bool(row["is_active"])

    @property
    def is_active(self):
        # A user blocked by the admin (is_active = 0) cannot stay logged in
        return self._is_active


@login_manager.user_loader
def load_user(user_id):
    """Flask-Login calls this on every request to reload the session user."""
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None or not row["is_active"]:
        return None
    return User(row)


# ---------------------------------------------------------------------------
# SMALL HELPERS
# ---------------------------------------------------------------------------
def role_required(*roles):
    """Decorator: allow only users whose role is in `roles`.

    Example:  @role_required('alumni')  -> only alumni can open the page.
    """
    def decorator(view):
        @wraps(view)
        @login_required
        def wrapped(*args, **kwargs):
            if current_user.role not in roles:
                flash("You do not have permission to open that page.", "danger")
                return redirect(url_for("dashboard"))
            return view(*args, **kwargs)
        return wrapped
    return decorator


def allowed_file(filename):
    """Check that an uploaded file is a png/jpg image."""
    return "." in filename and \
        filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def save_profile_picture(file, user_id):
    """Save an uploaded profile picture and return its new file name."""
    ext = file.filename.rsplit(".", 1)[1].lower()
    filename = secure_filename(f"user_{user_id}.{ext}")
    file.save(os.path.join(UPLOAD_FOLDER, filename))
    return filename


def avatar_url(person):
    """Return the profile-picture URL of a user (row, dict or User object)."""
    try:
        pic = person["profile_pic"]            # works for sqlite3.Row / dict
    except (TypeError, KeyError, IndexError):
        pic = getattr(person, "profile_pic", None)
    if pic:
        return url_for("uploaded_file", filename=pic)
    return url_for("static", filename="images/default-avatar.svg")


# Make avatar_url() usable inside every template
app.jinja_env.globals["avatar_url"] = avatar_url


@app.context_processor
def inject_badges():
    """Add unread notification/message counts to every page (navbar badges),
    plus the current year (used in the footer copyright line)."""
    if current_user.is_authenticated:
        return {
            "unread_notifications": models.unread_notification_count(current_user.id),
            "unread_messages": models.unread_message_count(current_user.id),
            "current_year": datetime.now().year,
        }
    return {"unread_notifications": 0, "unread_messages": 0,
            "current_year": datetime.now().year}


@app.template_filter("datetimeformat")
def datetimeformat(value):
    """Turn '2026-11-18 10:15:49' into '18 Nov 2026, 10:15 AM' for display."""
    if not value:
        return ""
    try:
        dt = datetime.strptime(str(value), "%Y-%m-%d %H:%M:%S")
        return dt.strftime("%d %b %Y, %I:%M %p")
    except ValueError:
        return value


@app.template_filter("dateformat")
def dateformat(value):
    """Turn a job deadline '2026-12-31' into '31 Dec 2026' for display."""
    if not value:
        return "No deadline"
    try:
        dt = datetime.strptime(str(value), "%Y-%m-%d")
        return dt.strftime("%d %b %Y")
    except ValueError:
        return value


def connection_status(me_id, other_id):
    """Relationship between two users: none / pending_sent /
    pending_received / accepted. Used to draw the right button."""
    db = get_db()
    row = db.execute(
        """SELECT * FROM connections
           WHERE (sender_id = ? AND receiver_id = ?)
              OR (sender_id = ? AND receiver_id = ?)""",
        (me_id, other_id, other_id, me_id),
    ).fetchone()
    if row is None:
        return "none"
    if row["status"] == "accepted":
        return "accepted"
    if row["status"] == "pending":
        return "pending_sent" if row["sender_id"] == me_id else "pending_received"
    return "none"      # a rejected request can be sent again


@app.route("/uploads/<filename>")
@login_required
def uploaded_file(filename):
    """Serve uploaded profile pictures."""
    return send_from_directory(UPLOAD_FOLDER, filename)


# ---------------------------------------------------------------------------
# HOME (public pages)
# ---------------------------------------------------------------------------
@app.route("/")
def home():
    db = get_db()
    stats = {
        "students": db.execute("SELECT COUNT(*) c FROM users WHERE role='student'").fetchone()["c"],
        "alumni": db.execute("SELECT COUNT(*) c FROM users WHERE role='alumni'").fetchone()["c"],
        "faculty": db.execute("SELECT COUNT(*) c FROM users WHERE role='faculty'").fetchone()["c"],
        "jobs": db.execute("SELECT COUNT(*) c FROM jobs").fetchone()["c"],
    }
    latest_jobs = db.execute(
        """SELECT j.*, u.name AS alumni_name FROM jobs j
           JOIN users u ON u.id = j.alumni_id ORDER BY j.id DESC LIMIT 3"""
    ).fetchall()
    return render_template("home.html", stats=stats, latest_jobs=latest_jobs)


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/services")
def services():
    """Public page describing what the platform offers."""
    return render_template("services.html")


@app.route("/contact", methods=["GET", "POST"])
def contact():
    """Public contact page. Submitted messages are saved in the
    `contact_messages` table so the admin can read them later."""
    if request.method == "POST":
        name = request.form["name"].strip()
        email = request.form["email"].strip()
        subject = request.form.get("subject", "").strip()
        message = request.form["message"].strip()
        if not name or not email or not message:
            flash("Please fill your name, email and message.", "warning")
        else:
            db = get_db()
            db.execute(
                """INSERT INTO contact_messages (name, email, subject, message)
                   VALUES (?, ?, ?, ?)""",
                (name, email, subject, message),
            )
            db.commit()
            flash("Thank you! Your message has been sent. "
                  "We will get back to you soon.", "success")
            return redirect(url_for("contact"))
    return render_template("contact.html")


# ---------------------------------------------------------------------------
# AUTH - register, login, logout, change password
# ---------------------------------------------------------------------------
@app.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("dashboard"))
    if request.method == "POST":
        name = request.form["name"].strip()
        email = request.form["email"].strip().lower()
        phone = request.form.get("phone", "").strip()
        role = request.form["role"]
        password = request.form["password"]
        confirm = request.form["confirm_password"]

        # --- simple validations ---
        if role not in ("student", "alumni", "faculty"):
            flash("Please choose a valid role.", "danger")
        elif len(password) < 6:
            flash("Password must be at least 6 characters long.", "danger")
        elif password != confirm:
            flash("Passwords do not match.", "danger")
        else:
            db = get_db()
            existing = db.execute(
                "SELECT id FROM users WHERE email = ?", (email,)
            ).fetchone()
            if existing:
                flash("This email is already registered. Please login.", "warning")
            else:
                # Password is never stored directly - only its hash
                cur = db.execute(
                    """INSERT INTO users (name, email, password_hash, role, phone)
                       VALUES (?, ?, ?, ?, ?)""",
                    (name, email, generate_password_hash(password), role, phone),
                )
                user_id = cur.lastrowid
                # Create an empty profile row in the role's profile table
                table = models.PROFILE_TABLES[role]
                db.execute(f"INSERT INTO {table} (user_id) VALUES (?)", (user_id,))
                db.commit()
                flash("Account created successfully! Please login.", "success")
                return redirect(url_for("login"))
    return render_template("auth/register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("dashboard"))
    if request.method == "POST":
        email = request.form["email"].strip().lower()
        password = request.form["password"]
        db = get_db()
        row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if row is None or not check_password_hash(row["password_hash"], password):
            flash("Invalid email or password.", "danger")
        elif not row["is_active"]:
            flash("Your account has been blocked by the admin.", "danger")
        else:
            login_user(User(row))
            flash(f"Welcome back, {row['name']}!", "success")
            return redirect(url_for("dashboard"))
    return render_template("auth/login.html")


@app.route("/logout")
@login_required
def logout():
    logout_user()
    flash("You have been logged out.", "info")
    return redirect(url_for("home"))


@app.route("/change-password", methods=["GET", "POST"])
@login_required
def change_password():
    if request.method == "POST":
        current = request.form["current_password"]
        new = request.form["new_password"]
        confirm = request.form["confirm_password"]
        db = get_db()
        row = db.execute(
            "SELECT password_hash FROM users WHERE id = ?", (current_user.id,)
        ).fetchone()
        if not check_password_hash(row["password_hash"], current):
            flash("Current password is wrong.", "danger")
        elif len(new) < 6:
            flash("New password must be at least 6 characters long.", "danger")
        elif new != confirm:
            flash("New passwords do not match.", "danger")
        else:
            db.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (generate_password_hash(new), current_user.id),
            )
            db.commit()
            flash("Password changed successfully.", "success")
            return redirect(url_for("dashboard"))
    return render_template("auth/change_password.html")


# ---------------------------------------------------------------------------
# DASHBOARDS - one per role, each with a few stat cards
# ---------------------------------------------------------------------------
@app.route("/dashboard")
@login_required
def dashboard():
    """Show the dashboard of the logged-in user's role."""
    if current_user.role == "admin":
        return redirect(url_for("admin_dashboard"))

    db = get_db()
    uid = current_user.id
    connections = db.execute(
        """SELECT COUNT(*) c FROM connections
           WHERE status = 'accepted' AND (sender_id = ? OR receiver_id = ?)""",
        (uid, uid),
    ).fetchone()["c"]
    profile = models.get_profile(uid, current_user.role)

    if current_user.role == "student":
        stats = {
            "connections": connections,
            "unread_messages": models.unread_message_count(uid),
            "jobs": db.execute("SELECT COUNT(*) c FROM jobs").fetchone()["c"],
            "applications": db.execute(
                "SELECT COUNT(*) c FROM applications WHERE student_id = ?", (uid,)
            ).fetchone()["c"],
        }
        return render_template("dashboard_student.html", stats=stats, profile=profile)

    if current_user.role == "alumni":
        stats = {
            "jobs_posted": db.execute(
                "SELECT COUNT(*) c FROM jobs WHERE alumni_id = ?", (uid,)
            ).fetchone()["c"],
            "applicants": db.execute(
                """SELECT COUNT(*) c FROM applications a
                   JOIN jobs j ON j.id = a.job_id WHERE j.alumni_id = ?""",
                (uid,),
            ).fetchone()["c"],
            "connections": connections,
            "unread_messages": models.unread_message_count(uid),
        }
        return render_template("dashboard_alumni.html", stats=stats, profile=profile)

    # faculty
    stats = {
        "announcements": db.execute(
            "SELECT COUNT(*) c FROM announcements WHERE faculty_id = ?", (uid,)
        ).fetchone()["c"],
        "connections": connections,
        "students": db.execute(
            "SELECT COUNT(*) c FROM users WHERE role = 'student'"
        ).fetchone()["c"],
        "unread_messages": models.unread_message_count(uid),
    }
    return render_template("dashboard_faculty.html", stats=stats, profile=profile)


# ---------------------------------------------------------------------------
# PROFILE - view and edit
# ---------------------------------------------------------------------------
@app.route("/profile/<int:user_id>")
@login_required
def profile(user_id):
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None:
        abort(404)
    prof = models.get_profile(user_id, user["role"])
    status = None
    if user_id != current_user.id:
        status = connection_status(current_user.id, user_id)
    return render_template("profile.html", user=user, profile=prof, status=status)


@app.route("/profile/edit", methods=["GET", "POST"])
@login_required
def edit_profile():
    db = get_db()
    prof = models.get_profile(current_user.id, current_user.role)

    if request.method == "POST":
        # 1) Basic fields live in the `users` table
        db.execute(
            "UPDATE users SET name = ?, phone = ? WHERE id = ?",
            (request.form["name"].strip(), request.form.get("phone", "").strip(),
             current_user.id),
        )
        # 2) Role-specific fields live in the role's profile table
        role = current_user.role
        if role == "student":
            db.execute(
                """UPDATE student_profile
                   SET course = ?, branch = ?, year = ?, skills = ?, bio = ?
                   WHERE user_id = ?""",
                (request.form.get("course"), request.form.get("branch"),
                 request.form.get("year"), request.form.get("skills"),
                 request.form.get("bio"), current_user.id),
            )
        elif role == "alumni":
            db.execute(
                """UPDATE alumni_profile
                   SET company = ?, designation = ?, experience = ?, skills = ?, bio = ?
                   WHERE user_id = ?""",
                (request.form.get("company"), request.form.get("designation"),
                 request.form.get("experience"), request.form.get("skills"),
                 request.form.get("bio"), current_user.id),
            )
        elif role == "faculty":
            db.execute(
                """UPDATE faculty_profile
                   SET department = ?, designation = ?, qualification = ?, skills = ?, bio = ?
                   WHERE user_id = ?""",
                (request.form.get("department"), request.form.get("designation"),
                 request.form.get("qualification"), request.form.get("skills"),
                 request.form.get("bio"), current_user.id),
            )
        # 3) Profile picture (only if a new file was chosen)
        file = request.files.get("profile_pic")
        if file and file.filename:
            if allowed_file(file.filename):
                filename = save_profile_picture(file, current_user.id)
                db.execute(
                    "UPDATE users SET profile_pic = ? WHERE id = ?",
                    (filename, current_user.id),
                )
            else:
                flash("Only PNG or JPG images are allowed.", "warning")
        db.commit()
        flash("Profile updated successfully.", "success")
        return redirect(url_for("profile", user_id=current_user.id))

    return render_template("edit_profile.html", profile=prof)


# ---------------------------------------------------------------------------
# SEARCH / DIRECTORY - list of all members
# ---------------------------------------------------------------------------
@app.route("/search")
@login_required
def search():
    q = request.args.get("q", "").strip()
    role = request.args.get("role", "").strip()
    db = get_db()
    # LEFT JOIN all three profile tables - only the user's own role table
    # will have a row, the other two give NULL (handled with COALESCE).
    sql = """
        SELECT u.*,
               COALESCE(sp.skills, ap.skills, fp.skills)   AS skills,
               COALESCE(sp.bio, ap.bio, fp.bio)            AS bio,
               ap.company AS company, sp.branch AS branch,
               sp.course AS course, fp.department AS department
        FROM users u
        LEFT JOIN student_profile sp ON sp.user_id = u.id
        LEFT JOIN alumni_profile  ap ON ap.user_id = u.id
        LEFT JOIN faculty_profile fp ON fp.user_id = u.id
        WHERE u.role != 'admin' AND u.is_active = 1
    """
    params = []
    if role in ("student", "alumni", "faculty"):
        sql += " AND u.role = ?"
        params.append(role)
    if q:
        sql += """ AND (u.name LIKE ? OR sp.skills LIKE ? OR ap.skills LIKE ?
                        OR fp.skills LIKE ? OR ap.company LIKE ?)"""
        like = f"%{q}%"
        params += [like, like, like, like, like]
    sql += " ORDER BY u.name"
    members = db.execute(sql, params).fetchall()

    # Relationship of the logged-in user with every member (for the button)
    statuses = {m["id"]: connection_status(current_user.id, m["id"]) for m in members}
    return render_template("search.html", members=members, statuses=statuses,
                           q=q, role=role)


# ---------------------------------------------------------------------------
# CONNECTIONS - send / accept / reject requests
# ---------------------------------------------------------------------------
@app.route("/connections")
@login_required
def connections():
    db = get_db()
    uid = current_user.id
    my_connections = db.execute(
        """SELECT u.* FROM connections c JOIN users u
             ON u.id = CASE WHEN c.sender_id = ? THEN c.receiver_id ELSE c.sender_id END
           WHERE c.status = 'accepted' AND (c.sender_id = ? OR c.receiver_id = ?)
           ORDER BY u.name""",
        (uid, uid, uid),
    ).fetchall()
    pending_received = db.execute(
        """SELECT c.id AS conn_id, u.* FROM connections c
           JOIN users u ON u.id = c.sender_id
           WHERE c.receiver_id = ? AND c.status = 'pending' ORDER BY c.id DESC""",
        (uid,),
    ).fetchall()
    pending_sent = db.execute(
        """SELECT c.id AS conn_id, u.* FROM connections c
           JOIN users u ON u.id = c.receiver_id
           WHERE c.sender_id = ? AND c.status = 'pending' ORDER BY c.id DESC""",
        (uid,),
    ).fetchall()
    return render_template("connections.html", my_connections=my_connections,
                           pending_received=pending_received,
                           pending_sent=pending_sent)


@app.route("/connect/<int:user_id>", methods=["POST"])
@login_required
def send_connection(user_id):
    if user_id == current_user.id:
        abort(404)
    db = get_db()
    target = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if target is None:
        abort(404)
    status = connection_status(current_user.id, user_id)
    if status == "none":
        try:
            db.execute(
                "INSERT INTO connections (sender_id, receiver_id) VALUES (?, ?)",
                (current_user.id, user_id),
            )
            db.commit()
            models.create_notification(
                user_id,
                f"{current_user.name} sent you a connection request.",
                url_for("connections"),
            )
            flash(f"Connection request sent to {target['name']}.", "success")
        except sqlite3.IntegrityError:
            flash("A request already exists between you two.", "warning")
    elif status == "pending_received":
        flash("This user has already sent you a request - please respond to it.",
              "info")
    else:
        flash("You are already connected or a request is pending.", "info")
    return redirect(request.referrer or url_for("search"))


@app.route("/connections/<int:conn_id>/respond/<action>", methods=["POST"])
@login_required
def respond_connection(conn_id, action):
    db = get_db()
    conn = db.execute("SELECT * FROM connections WHERE id = ?", (conn_id,)).fetchone()
    # Only the receiver of a pending request can respond to it
    if conn is None or conn["receiver_id"] != current_user.id \
            or conn["status"] != "pending":
        abort(404)
    if action == "accept":
        db.execute("UPDATE connections SET status = 'accepted' WHERE id = ?",
                   (conn_id,))
        db.commit()
        models.create_notification(
            conn["sender_id"],
            f"{current_user.name} accepted your connection request.",
            url_for("connections"),
        )
        flash("Connection accepted.", "success")
    elif action == "reject":
        db.execute("UPDATE connections SET status = 'rejected' WHERE id = ?",
                   (conn_id,))
        db.commit()
        flash("Connection request rejected.", "info")
    else:
        abort(404)
    return redirect(url_for("connections"))


# ---------------------------------------------------------------------------
# CHAT - simple 1-to-1 messaging (form POST + page refresh, no websockets)
# ---------------------------------------------------------------------------
@app.route("/chat")
@login_required
def chat():
    """Conversation list: people I have chatted with + my connections."""
    db = get_db()
    uid = current_user.id
    partners = db.execute(
        """SELECT u.*,
                  (SELECT body FROM messages
                    WHERE (sender_id = u.id AND receiver_id = ?)
                       OR (sender_id = ? AND receiver_id = u.id)
                    ORDER BY id DESC LIMIT 1) AS last_message,
                  (SELECT COUNT(*) FROM messages
                    WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0)
                    AS unread
           FROM users u
           WHERE u.id IN (
               SELECT sender_id FROM messages WHERE receiver_id = ?
               UNION
               SELECT receiver_id FROM messages WHERE sender_id = ?
           )
           ORDER BY (SELECT MAX(id) FROM messages
                     WHERE (sender_id = u.id AND receiver_id = ?)
                        OR (sender_id = ? AND receiver_id = u.id)) DESC""",
        (uid, uid, uid, uid, uid, uid, uid),
    ).fetchall()
    my_connections = db.execute(
        """SELECT u.* FROM connections c JOIN users u
             ON u.id = CASE WHEN c.sender_id = ? THEN c.receiver_id ELSE c.sender_id END
           WHERE c.status = 'accepted' AND (c.sender_id = ? OR c.receiver_id = ?)
           ORDER BY u.name""",
        (uid, uid, uid),
    ).fetchall()
    return render_template("chat.html", partners=partners,
                           my_connections=my_connections)


@app.route("/chat/<int:user_id>", methods=["GET", "POST"])
@login_required
def conversation(user_id):
    if user_id == current_user.id:
        return redirect(url_for("chat"))
    db = get_db()
    other = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if other is None:
        abort(404)

    if request.method == "POST":
        body = request.form["body"].strip()
        if body:
            db.execute(
                "INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)",
                (current_user.id, user_id, body),
            )
            db.commit()
        return redirect(url_for("conversation", user_id=user_id))

    history = db.execute(
        """SELECT * FROM messages
           WHERE (sender_id = ? AND receiver_id = ?)
              OR (sender_id = ? AND receiver_id = ?)
           ORDER BY id""",
        (current_user.id, user_id, user_id, current_user.id),
    ).fetchall()
    # Opening the conversation marks the other person's messages as read
    db.execute(
        "UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?",
        (user_id, current_user.id),
    )
    db.commit()
    return render_template("conversation.html", other=other, history=history)


# ---------------------------------------------------------------------------
# JOBS - alumni post jobs, students apply
# ---------------------------------------------------------------------------
@app.route("/jobs")
@login_required
def jobs():
    q = request.args.get("q", "").strip()
    db = get_db()
    sql = """SELECT j.*, u.name AS alumni_name FROM jobs j
             JOIN users u ON u.id = j.alumni_id"""
    params = []
    if q:
        sql += " WHERE j.title LIKE ? OR j.company LIKE ? OR j.location LIKE ?"
        like = f"%{q}%"
        params = [like, like, like]
    sql += " ORDER BY j.id DESC"
    all_jobs = db.execute(sql, params).fetchall()
    # Job ids the logged-in student has already applied to
    applied_ids = set()
    if current_user.role == "student":
        rows = db.execute(
            "SELECT job_id FROM applications WHERE student_id = ?",
            (current_user.id,),
        ).fetchall()
        applied_ids = {r["job_id"] for r in rows}
    return render_template("jobs.html", jobs=all_jobs, q=q, applied_ids=applied_ids)


@app.route("/jobs/<int:job_id>")
@login_required
def job_detail(job_id):
    db = get_db()
    job = db.execute(
        """SELECT j.*, u.name AS alumni_name, u.email AS alumni_email
           FROM jobs j JOIN users u ON u.id = j.alumni_id WHERE j.id = ?""",
        (job_id,),
    ).fetchone()
    if job is None:
        abort(404)
    applied = None
    if current_user.role == "student":
        applied = db.execute(
            "SELECT * FROM applications WHERE job_id = ? AND student_id = ?",
            (job_id, current_user.id),
        ).fetchone()
    return render_template("job_detail.html", job=job, applied=applied)


@app.route("/jobs/new", methods=["GET", "POST"])
@role_required("alumni")
def post_job():
    if request.method == "POST":
        db = get_db()
        cur = db.execute(
            """INSERT INTO jobs (alumni_id, title, company, location, salary,
                                 description, deadline)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (current_user.id, request.form["title"].strip(),
             request.form["company"].strip(), request.form.get("location"),
             request.form.get("salary"), request.form.get("description"),
             request.form.get("deadline") or None),
        )
        db.commit()
        # Tell every student that a new job has been posted
        students = db.execute("SELECT id FROM users WHERE role = 'student'").fetchall()
        for s in students:
            models.create_notification(
                s["id"],
                f"New job posted: {request.form['title']} at {request.form['company']}",
                url_for("job_detail", job_id=cur.lastrowid),
            )
        flash("Job posted successfully.", "success")
        return redirect(url_for("my_jobs"))
    return render_template("post_job.html", job=None)


@app.route("/jobs/<int:job_id>/edit", methods=["GET", "POST"])
@role_required("alumni")
def edit_job(job_id):
    db = get_db()
    job = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if job is None or job["alumni_id"] != current_user.id:
        abort(404)
    if request.method == "POST":
        db.execute(
            """UPDATE jobs SET title = ?, company = ?, location = ?, salary = ?,
                              description = ?, deadline = ? WHERE id = ?""",
            (request.form["title"].strip(), request.form["company"].strip(),
             request.form.get("location"), request.form.get("salary"),
             request.form.get("description"),
             request.form.get("deadline") or None, job_id),
        )
        db.commit()
        flash("Job updated successfully.", "success")
        return redirect(url_for("my_jobs"))
    return render_template("post_job.html", job=job)


@app.route("/jobs/<int:job_id>/delete", methods=["POST"])
@role_required("alumni")
def delete_job(job_id):
    db = get_db()
    job = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if job is None or job["alumni_id"] != current_user.id:
        abort(404)
    db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))  # applications go too (CASCADE)
    db.commit()
    flash("Job deleted.", "info")
    return redirect(url_for("my_jobs"))


@app.route("/my-jobs")
@role_required("alumni")
def my_jobs():
    db = get_db()
    rows = db.execute(
        """SELECT j.*, (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id)
               AS applicant_count
           FROM jobs j WHERE j.alumni_id = ? ORDER BY j.id DESC""",
        (current_user.id,),
    ).fetchall()
    return render_template("my_jobs.html", jobs=rows)


@app.route("/jobs/<int:job_id>/apply", methods=["POST"])
@role_required("student")
def apply_job(job_id):
    db = get_db()
    job = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if job is None:
        abort(404)
    try:
        db.execute(
            "INSERT INTO applications (job_id, student_id, cover_note) VALUES (?, ?, ?)",
            (job_id, current_user.id, request.form.get("cover_note", "").strip()),
        )
        db.commit()
        models.create_notification(
            job["alumni_id"],
            f"{current_user.name} applied for your job '{job['title']}'.",
            url_for("applicants", job_id=job_id),
        )
        flash("Application submitted successfully.", "success")
    except sqlite3.IntegrityError:
        flash("You have already applied for this job.", "warning")
    return redirect(url_for("job_detail", job_id=job_id))


@app.route("/jobs/<int:job_id>/applicants")
@role_required("alumni")
def applicants(job_id):
    db = get_db()
    job = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if job is None or job["alumni_id"] != current_user.id:
        abort(404)
    rows = db.execute(
        """SELECT a.*, u.name AS student_name, u.email AS student_email,
                  sp.course, sp.branch, sp.year
           FROM applications a
           JOIN users u ON u.id = a.student_id
           LEFT JOIN student_profile sp ON sp.user_id = u.id
           WHERE a.job_id = ? ORDER BY a.id DESC""",
        (job_id,),
    ).fetchall()
    return render_template("applicants.html", job=job, applications=rows)


@app.route("/applications/<int:app_id>/status", methods=["POST"])
@role_required("alumni")
def update_application_status(app_id):
    db = get_db()
    row = db.execute(
        """SELECT a.*, j.title AS job_title, j.alumni_id FROM applications a
           JOIN jobs j ON j.id = a.job_id WHERE a.id = ?""",
        (app_id,),
    ).fetchone()
    if row is None or row["alumni_id"] != current_user.id:
        abort(404)
    new_status = request.form["status"]
    if new_status in ("Applied", "Shortlisted", "Rejected"):
        db.execute("UPDATE applications SET status = ? WHERE id = ?",
                   (new_status, app_id))
        db.commit()
        models.create_notification(
            row["student_id"],
            f"Your application for '{row['job_title']}' is now: {new_status}.",
            url_for("applied_jobs"),
        )
        flash("Application status updated.", "success")
    return redirect(url_for("applicants", job_id=row["job_id"]))


@app.route("/my-applications")
@role_required("student")
def applied_jobs():
    db = get_db()
    rows = db.execute(
        """SELECT a.*, j.title, j.company, j.location
           FROM applications a JOIN jobs j ON j.id = a.job_id
           WHERE a.student_id = ? ORDER BY a.id DESC""",
        (current_user.id,),
    ).fetchall()
    return render_template("applied_jobs.html", applications=rows)


# ---------------------------------------------------------------------------
# ANNOUNCEMENTS - faculty posts, everyone reads
# ---------------------------------------------------------------------------
@app.route("/announcements", methods=["GET", "POST"])
@login_required
def announcements():
    db = get_db()
    if request.method == "POST":
        if current_user.role != "faculty":
            abort(403)
        db.execute(
            "INSERT INTO announcements (faculty_id, title, body) VALUES (?, ?, ?)",
            (current_user.id, request.form["title"].strip(),
             request.form.get("body", "").strip()),
        )
        db.commit()
        flash("Announcement posted.", "success")
        return redirect(url_for("announcements"))
    rows = db.execute(
        """SELECT a.*, u.name AS faculty_name FROM announcements a
           JOIN users u ON u.id = a.faculty_id ORDER BY a.id DESC"""
    ).fetchall()
    return render_template("announcements.html", announcements=rows)


# ---------------------------------------------------------------------------
# NOTIFICATIONS
# ---------------------------------------------------------------------------
@app.route("/notifications")
@login_required
def notifications():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC",
        (current_user.id,),
    ).fetchall()
    # Opening the page marks everything as read (badge becomes 0)
    db.execute(
        "UPDATE notifications SET is_read = 1 WHERE user_id = ?", (current_user.id,)
    )
    db.commit()
    return render_template("notifications.html", notifications=rows)


# ---------------------------------------------------------------------------
# ADMIN - dashboard, manage users, manage jobs
# ---------------------------------------------------------------------------
@app.route("/admin")
@role_required("admin")
def admin_dashboard():
    db = get_db()
    counts = {
        "students": db.execute("SELECT COUNT(*) c FROM users WHERE role='student'").fetchone()["c"],
        "alumni": db.execute("SELECT COUNT(*) c FROM users WHERE role='alumni'").fetchone()["c"],
        "faculty": db.execute("SELECT COUNT(*) c FROM users WHERE role='faculty'").fetchone()["c"],
        "total_users": db.execute("SELECT COUNT(*) c FROM users WHERE role != 'admin'").fetchone()["c"],
        "jobs": db.execute("SELECT COUNT(*) c FROM jobs").fetchone()["c"],
        "applications": db.execute("SELECT COUNT(*) c FROM applications").fetchone()["c"],
        "connections": db.execute("SELECT COUNT(*) c FROM connections WHERE status='accepted'").fetchone()["c"],
        "contact_messages": db.execute("SELECT COUNT(*) c FROM contact_messages").fetchone()["c"],
    }
    recent_users = db.execute(
        "SELECT * FROM users WHERE role != 'admin' ORDER BY id DESC LIMIT 5"
    ).fetchall()
    return render_template("admin/dashboard.html", counts=counts,
                           recent_users=recent_users)


@app.route("/admin/users")
@role_required("admin")
def admin_users():
    q = request.args.get("q", "").strip()
    role = request.args.get("role", "").strip()
    db = get_db()
    sql = "SELECT * FROM users WHERE role != 'admin'"
    params = []
    if role in ("student", "alumni", "faculty"):
        sql += " AND role = ?"
        params.append(role)
    if q:
        sql += " AND (name LIKE ? OR email LIKE ?)"
        params += [f"%{q}%", f"%{q}%"]
    sql += " ORDER BY id DESC"
    users = db.execute(sql, params).fetchall()
    return render_template("admin/users.html", users=users, q=q, role=role)


@app.route("/admin/users/<int:user_id>/toggle", methods=["POST"])
@role_required("admin")
def admin_toggle_user(user_id):
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None or user["role"] == "admin":
        abort(404)
    new_value = 0 if user["is_active"] else 1
    db.execute("UPDATE users SET is_active = ? WHERE id = ?", (new_value, user_id))
    db.commit()
    flash(f"{user['name']} has been {'unblocked' if new_value else 'blocked'}.",
          "success")
    return redirect(url_for("admin_users"))


@app.route("/admin/users/<int:user_id>/delete", methods=["POST"])
@role_required("admin")
def admin_delete_user(user_id):
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None or user["role"] == "admin":
        abort(404)
    # ON DELETE CASCADE removes the profile, connections, messages, etc.
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()
    flash(f"User {user['name']} deleted.", "info")
    return redirect(url_for("admin_users"))


@app.route("/admin/jobs")
@role_required("admin")
def admin_jobs():
    db = get_db()
    rows = db.execute(
        """SELECT j.*, u.name AS alumni_name,
                  (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id)
                  AS applicant_count
           FROM jobs j JOIN users u ON u.id = j.alumni_id ORDER BY j.id DESC"""
    ).fetchall()
    return render_template("admin/jobs.html", jobs=rows)


@app.route("/admin/jobs/<int:job_id>/delete", methods=["POST"])
@role_required("admin")
def admin_delete_job(job_id):
    db = get_db()
    db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    db.commit()
    flash("Job deleted.", "info")
    return redirect(url_for("admin_jobs"))


@app.route("/admin/messages")
@role_required("admin")
def admin_messages():
    """Messages sent from the public Contact page, newest first."""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM contact_messages ORDER BY id DESC"
    ).fetchall()
    return render_template("admin/messages.html", messages=rows)


@app.route("/admin/messages/<int:msg_id>/delete", methods=["POST"])
@role_required("admin")
def admin_delete_message(msg_id):
    db = get_db()
    db.execute("DELETE FROM contact_messages WHERE id = ?", (msg_id,))
    db.commit()
    flash("Contact message deleted.", "info")
    return redirect(url_for("admin_messages"))


# ---------------------------------------------------------------------------
# ERROR PAGES
# ---------------------------------------------------------------------------
@app.errorhandler(404)
def page_not_found(error):
    return render_template("errors/404.html"), 404


@app.errorhandler(500)
def server_error(error):
    return render_template("errors/500.html"), 500


# ---------------------------------------------------------------------------
# RUN THE APP  ->  python app.py
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(debug=True)
