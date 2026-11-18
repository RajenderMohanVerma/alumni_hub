"""
config.py - Project settings for Alumni Hub (Minor Project)

All the basic configuration of the app lives in this one file so it is
easy to find and change. app.py and models.py import values from here.
"""

import os

# Base folder of the project (the folder where this file lives)
BASE_DIR = os.path.abspath(os.path.dirname(__file__))

# Secret key is used by Flask to sign session cookies.
# NOTE: In a real production project this should be random and secret.
SECRET_KEY = "alumni-hub-minor-secret-key"

# Path of the SQLite database file
DATABASE = os.path.join(BASE_DIR, "alumni_hub.db")

# Folder where profile pictures uploaded by users are saved
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")

# Only these image types are allowed for profile pictures
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg"}

# Maximum upload size = 2 MB
MAX_CONTENT_LENGTH = 2 * 1024 * 1024
