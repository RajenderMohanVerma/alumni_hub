"""
config.py - Project settings for Alumni Hub (Minor Project)

All the basic configuration of the app lives in this one file so it is
easy to find and change. app.py and models.py import values from here.
"""

import os

# Base folder of the project (the folder where this file lives)
BASE_DIR = os.path.abspath(os.path.dirname(__file__))

# Secret key is used by Flask to sign session cookies.
# On a hosted deployment (e.g. Vercel) a different, random SECRET_KEY can
# be set as an environment variable; the value below is only for local use.
SECRET_KEY = os.environ.get("SECRET_KEY", "alumni-hub-minor-secret-key")

# On Vercel the project folder is read-only and storage is temporary, so
# the database and uploads must live in /tmp there. Locally (and on normal
# hosting) everything stays inside the project folder as usual.
if os.environ.get("VERCEL"):
    DATABASE = "/tmp/alumni_hub.db"
    UPLOAD_FOLDER = "/tmp/uploads"
else:
    # Path of the SQLite database file
    DATABASE = os.path.join(BASE_DIR, "alumni_hub.db")

    # Folder where profile pictures uploaded by users are saved
    UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")

# Only these image types are allowed for profile pictures
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg"}

# Maximum upload size = 2 MB
MAX_CONTENT_LENGTH = 2 * 1024 * 1024
