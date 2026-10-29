# 🔒 Documentation Page: Profile Security (PIN) & Encrypted Backups

Each master profile can be protected by an **optional PIN**. This page explains what the PIN protects, how to recover from a forgotten PIN, and how backups handle protected profiles.

---

## 🎯 1. What the PIN protects

A profile **without a PIN** stays freely accessible, as before.

A profile **with a PIN**:
- **Blocks data access on the server**: until the PIN is entered, the server refuses to read or change the profile's data (transactions, accounts, attachments, exports…). It is not just a screen drawn over the app: another tab, another browser or the mobile app is refused too.
- **Really locks**: the *Lock session* button and the inactivity auto-lock cut access on the server. The PIN is also asked again after a server restart, or after 24 hours without use.
- **Resists repeated guesses**: after **5 wrong PINs**, you must wait **5 minutes**, even with the right PIN. This prevents trying all 10,000 combinations of a 4-digit PIN.

> [!IMPORTANT]
> **Know the limit:** the PIN protects access *through the app*. The data files on the server's disk are not encrypted. On a shared computer, the real protection of the files comes from Windows accounts (each user has their own account and data folder).
>
> In **shared mode**, data lives in `C:\ProgramData\OmniBank`, a folder often readable by every user of the computer.

---

## ⚙️ 2. Set, change or remove the PIN

In **Settings → Master profiles**, on the active profile:
- **🔒 PIN**: set, change (the current PIN is required) or remove the PIN.
- **🗝️ Recovery code**: generate a new recovery code (the current PIN is required; the old code stops working).

Only the **currently active** profile can manage its PIN.

---

## 🗝️ 3. The recovery code

Each time a PIN is created or changed, OmniBank shows a 16-character recovery code **only once**, for example `JZNG-KKY3-DAJZ-6EVL`.

**Write it down and keep it somewhere safe** (password manager, paper kept away…). It is used to:
1. **Reset a forgotten PIN** from the lock screen;
2. **Restore this profile on another machine** from a global backup.

Upper/lower case, spaces and dashes don't matter when typing it.

> [!WARNING]
> A profile protected before this version has no recovery code yet. A ⚠️ warning then appears on its card: click **🗝️ Create a recovery code**.

---

## 🆘 4. Forgotten PIN

### With the recovery code
1. On the lock screen, choose the profile then click **Code PIN oublié ?** (forgotten PIN).
2. Enter the recovery code.
3. Enter a new PIN, or leave the field empty to **remove** the protection.
4. A **new** recovery code is shown: write it down, the old one no longer works.

### Without the recovery code (server-side fallback)
On the machine hosting OmniBank, in the application folder:

```bash
python -m app.reset_pin              # list protected profiles
python -m app.reset_pin <profile_id> # remove this profile's PIN
```

With Docker:

```bash
docker exec -it <container> python -m app.reset_pin <profile_id>
```

The profile's data is not changed and OmniBank does not need to be restarted.

> [!WARNING]
> This command restores access to the profile, but **not** to encrypted global backups made with the old PIN (see § 5). They stay readable with the old recovery code if it turns up.

---

## 📦 5. Global backups and protected profiles

The global backup (**📦 Backup all profiles**) and the **automatic backup** contain every profile:
- profiles **without a PIN** are stored normally;
- profiles **with a PIN** are **encrypted**: without their PIN or recovery code, their content is unreadable.

The backup **asks for no PIN**: it works even while profiles are locked (for example on a shared computer where everyone has their own profile).

### Restoring a global backup
With **📂 Restore all profiles**, OmniBank asks for the code of each protected profile:

| Situation | Code to enter |
| :--- | :--- |
| Restoring on **the same server** | The profile's **PIN** (or its recovery code) |
| Restoring on **another machine** | The **recovery code**, then a **new PIN** for this profile |
| Field left **empty** | The profile is **skipped**: its current data on this server is kept |

Other profiles are restored normally. Profiles present on the server but missing from the archive are kept.

> [!NOTE]
> **Why isn't the PIN enough on another machine?** A 4-digit PIN has only 10,000 combinations. On the server, the attempt limit protects it, but a copy of the backup file could be attacked offline in minutes. The archive therefore only contains the key protected by the **recovery code** (practically impossible to guess); the PIN-protected key never leaves the server.

### Good to know
- **Changing the PIN** does not make older backups unreadable: they open with the new PIN.
- **Profile protected before this version**: it has no encryption key yet. It is **left out** of global backups (a message says so) until it is **unlocked once** with its PIN.
- **Older automatic backups** (before this version) contain everything unencrypted. They can only be downloaded if no other profile has a PIN, and disappear through automatic rotation.
- **Single-profile backup** (💾 *Download Full Backup*): it covers the active, already unlocked profile and is not encrypted. Keep it somewhere safe.

---

## 🛠️ 6. Technical details

- **Sessions**: unlocking a profile creates a server-side session (`app/services/pin_session.py`), sent via the `X-OmniBank-Session` header, an `omni_session` cookie (HttpOnly, SameSite=Strict) or the `?omni_session=` parameter (EventSource streams, downloads). A middleware (`pin_session_guard` in `app/main.py`) rejects `/api/*` and `/uploads/*` requests for a protected active profile with `401` `{"code": "pin_required"}`; only a few endpoints stay open (health, version, profile list, unlock, recovery).
- **Secret storage** (`data/profiles.json`): PIN and recovery code are hashed (PBKDF2-SHA256, 100,000 iterations, random salt).
- **Backup encryption** (`app/services/backup_crypto.py`): one X25519 key pair per protected profile. The private key is wrapped with AES-256-GCM by the PIN (slot kept on the server only) and by the recovery code (slot included in archives), using PBKDF2-SHA256 with 200,000 iterations. Each profile is encrypted with AES-256-GCM using a key from an ephemeral X25519 exchange (HKDF-SHA256).
- **Archive format** (`app/services/backup_archive.py`): `omnibank_backup.json` (manifest, format 2), `profiles.json` (no PIN hash or PIN slot for protected profiles), files of unprotected profiles, and `encrypted/<profile_id>.omnienc`.
- **API**:
  - `POST /api/profiles/{id}/activate`: switch or unlock; returns `session_token`.
  - `POST /api/profiles/lock`: lock the current session.
  - `POST /api/profiles/{id}/pin/recover`: recovery by code (`recovery_code`, optional `new_pin`).
  - `POST /api/profiles/{id}/pin/recovery-code`: new recovery code (`current_pin`).
  - `POST /api/backup/upload-all`: without a `secrets` field, answers `409` `{"code": "secrets_required", "profiles": [...]}`; with `secrets` (JSON `{profile_id: {"secret", "new_pin"}}`), restores.
