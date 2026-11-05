"""Build check: woob must be able to verify module signatures in this image.

Without gpg or gpgv, woob installs its bank modules without checking them, and
only prints a message. A keyring named after a different repository URL would
be ignored, and woob would then trust whatever key the repository serves.
"""
import os
import re
import sys

import packaging.version
from woob import __version__
from woob.core.repositories import DEFAULT_SOURCES_LIST, Keyring, Repositories

if not (Keyring.find_gpg() or Keyring.find_gpgv()):
    sys.exit("gpg or gpgv is missing: woob would not check module signatures")

major = packaging.version.Version(__version__).major
sources = re.findall(r"^https?://\S+", DEFAULT_SOURCES_LIST % {"version": major}, re.M)
if not sources:
    sys.exit("no default woob repository found")

datadir = os.path.expanduser("~/.local/share/woob")
for url in sources:
    keyring = Keyring(os.path.join(datadir, Repositories.KEYRINGS_DIR, Repositories.url2filename(url)))
    if not keyring.exists():
        sys.exit(f"no pinned keyring for {url}: update docker/woob-keyring")

print(f"woob {__version__}: signature check available, keyring pinned for {', '.join(sources)}")
