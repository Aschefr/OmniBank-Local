"""License HMAC secret – DO NOT COMMIT (gitignored)."""
import base64

_KA = "T21uaUJhbmtMaWNl"
_KB = "bnNlS2V5MjAyNg=="
SECRET = base64.b64decode(_KA + _KB)
