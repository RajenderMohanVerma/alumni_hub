"""
index.py - Vercel entrypoint for the auth service.

Vercel's Python runtime looks for a file named index.py (or app.py)
that contains the Flask application object. The real code lives in
auth.py; this file simply re-exports its `app` so Vercel can find it
when this folder (auth_service/) is deployed as its own project.
"""

from auth import app  # noqa: F401  (the Flask application object)
