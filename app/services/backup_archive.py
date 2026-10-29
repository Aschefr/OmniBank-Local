"""
app/services/backup_archive.py — Sauvegarde / restauration globale (tous les profils).

Format 2 :
    omnibank_backup.json        manifeste (format, profils chiffrés, profils ignorés)
    profiles.json               sans secrets cassables hors-ligne (voir _archive_profile_entry)
    <fichiers des profils sans PIN, aux mêmes chemins que dans DATA_DIR>
    encrypted/<profile_id>.omnienc   profils protégés par PIN, chiffrés (backup_crypto)

Les profils protégés sont chiffrés avec leur clé publique : la sauvegarde ne nécessite aucun PIN.
Leur restauration exige le PIN (sur ce serveur) ou le code de récupération (ailleurs).
"""
import io
import json
import logging
import os
import zipfile
from datetime import datetime
from typing import Dict, List, Optional

from app.database import DATA_DIR, get_engine, dispose_engine
from app.profile_manager import (
    load_profiles_data, _save_profiles_data, ensure_profiles_initialized,
    has_pin, get_backup_key_entry, verify_pin, verify_recovery_code, set_pin,
)
from app.services import backup_crypto, pin_session

logger = logging.getLogger(__name__)

MANIFEST = "omnibank_backup.json"
FORMAT_VERSION = 2
PROTECTION_FIELDS = ("pin_hash", "pin_salt", "recovery_hash", "recovery_salt", "backup_keys", "backup_key_id")


class RestoreError(Exception):
    def __init__(self, status_code: int, detail, headers: Optional[dict] = None):
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail
        self.headers = headers


# ── Construction ─────────────────────────────────────────────────────

def _profile_files(profile: dict) -> List[tuple]:
    """(chemin absolu, chemin dans l'archive) des fichiers d'un profil."""
    files, seen = [], set()

    def add_file(abs_path):
        rel = os.path.relpath(abs_path, DATA_DIR).replace("\\", "/")
        if rel not in seen and not abs_path.endswith(("-wal", "-shm")):
            seen.add(rel)
            files.append((abs_path, rel))

    def add_tree(abs_dir):
        if os.path.isdir(abs_dir):
            for root, _dirs, names in os.walk(abs_dir):
                for name in names:
                    add_file(os.path.join(root, name))

    db_rel = profile.get("db_path", "omnibank.db")
    db_dir = os.path.dirname(db_rel)
    if db_dir:
        add_tree(os.path.join(DATA_DIR, db_dir))
    else:
        db_abs = os.path.join(DATA_DIR, db_rel)
        if os.path.isfile(db_abs):
            add_file(db_abs)
    add_tree(os.path.join(DATA_DIR, profile.get("uploads_dir", "uploads")))
    return files


def _archive_profile_entry(profile: dict) -> dict:
    """Entrée de profiles.json pour l'archive. Un PIN court se casse hors-ligne : pour un profil
    protégé, ni le hash du PIN ni la clé emballée par le PIN ne quittent le serveur."""
    clean = dict(profile)
    if has_pin(profile):
        clean["pin_hash"] = None
        clean["pin_salt"] = None
    clean["backup_keys"] = [backup_crypto.entry_for_archive(k) for k in profile.get("backup_keys") or []]
    return clean


def build_global_archive(zip_path: str) -> dict:
    """Écrit l'archive globale. Retourne {'encrypted': [...], 'skipped': [...]} (noms de profils)."""
    data = load_profiles_data()
    profiles = data.get("profiles", [])
    for p in profiles:
        try:
            with get_engine(p["id"]).connect() as conn:
                conn.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
        except Exception:
            pass

    encrypted, skipped = [], []
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for p in profiles:
            files = _profile_files(p)
            if not has_pin(p):
                for abs_path, arc in files:
                    zipf.write(abs_path, arcname=arc)
                continue
            entry = get_backup_key_entry(p)
            if not entry:
                # PIN défini avant cette fonctionnalité et jamais déverrouillé depuis : pas de clé.
                skipped.append(p)
                continue
            inner = io.BytesIO()
            with zipfile.ZipFile(inner, "w", zipfile.ZIP_DEFLATED) as inner_zip:
                for abs_path, arc in files:
                    inner_zip.write(abs_path, arcname=arc)
            blob = backup_crypto.encrypt_for(entry, inner.getvalue(), p["id"])
            zipf.writestr(f"encrypted/{p['id']}.omnienc", blob)
            encrypted.append(p)

        archive_data = dict(data)
        archive_data["profiles"] = [_archive_profile_entry(p) for p in profiles]
        zipf.writestr("profiles.json", json.dumps(archive_data, ensure_ascii=False, indent=2))
        zipf.writestr(MANIFEST, json.dumps({
            "format": FORMAT_VERSION,
            "created_at": datetime.now().isoformat(),
            "encrypted_profiles": [p["id"] for p in encrypted],
            "skipped_profiles": [p["id"] for p in skipped],
        }, indent=2))

    if skipped:
        logger.warning("[Backup] Profils protégés non sauvegardés (clé absente, à déverrouiller une fois) : "
                       + ", ".join(p["id"] for p in skipped))
    return {"encrypted": [p["name"] for p in encrypted], "skipped": [p["name"] for p in skipped]}


def is_v2_archive(zip_path: str) -> bool:
    try:
        with zipfile.ZipFile(zip_path) as z:
            return MANIFEST in z.namelist()
    except Exception:
        return False


# ── Restauration ─────────────────────────────────────────────────────

def _check_paths(names: List[str]):
    abs_data_dir = os.path.realpath(DATA_DIR)
    for member in names:
        member_path = os.path.realpath(os.path.join(DATA_DIR, member))
        if not member_path.startswith(abs_data_dir + os.sep) and member_path != abs_data_dir:
            raise RestoreError(400, f"Archive ZIP suspecte : chemin interdit détecté ({member})")


def _unlock_archive_key(blob: bytes, secret: str, local: Optional[dict], archived: dict) -> Optional[bytes]:
    key_id = backup_crypto.read_header(blob)["key_id"]
    candidates = [k for k in (local or {}).get("backup_keys") or [] if k["id"] == key_id]
    candidates += [k for k in archived.get("backup_keys") or [] if k["id"] == key_id]
    for entry in candidates:
        raw = backup_crypto.unwrap_entry(entry, secret)
        if raw:
            return raw
    return None


def _merge_keys(local: Optional[dict], archived: dict) -> list:
    """Union des clés ; la version locale (qui garde le slot PIN) est prioritaire."""
    merged = {k["id"]: k for k in archived.get("backup_keys") or []}
    merged.update({k["id"]: k for k in (local or {}).get("backup_keys") or []})
    return list(merged.values())


def _check_secret(profile_id: str, ok: bool, message: str):
    if not ok:
        pin_session.record_failure(profile_id)
        raise RestoreError(401, message)
    pin_session.clear_failures(profile_id)


def restore_global_archive(zip_path: str, provided: Optional[Dict[str, dict]]) -> dict:
    """Restaure une archive globale.

    provided : {profile_id: {"secret": PIN ou code de récupération, "new_pin": ...}} ;
    None = première passe : lève RestoreError(409) listant les profils qui demandent un secret.
    Un profil demandant un secret non fourni est ignoré (ses données locales sont conservées)."""
    with zipfile.ZipFile(zip_path, "r") as zip_ref:
        names = zip_ref.namelist()
        if "profiles.json" not in names:
            raise RestoreError(400, "Cette archive est une sauvegarde de profil unique. "
                                    "Utilisez le bouton 'Restaurer Sauvegarde' à la place.")
        _check_paths(names)
        archive_data = json.loads(zip_ref.read("profiles.json").decode("utf-8"))
        encrypted_ids = {n[len("encrypted/"):-len(".omnienc")] for n in names
                         if n.startswith("encrypted/") and n.endswith(".omnienc")}

        local_data = load_profiles_data()
        local_by_id = {p["id"]: p for p in local_data.get("profiles", [])}
        archived_by_id = {p["id"]: p for p in archive_data.get("profiles", [])}

        # 1. Profils exigeant un secret
        needs = []
        for pid, archived in archived_by_id.items():
            local = local_by_id.get(pid)
            is_encrypted = pid in encrypted_ids
            if is_encrypted or has_pin(local):
                needs.append({
                    "id": pid,
                    "name": archived.get("name") or (local or {}).get("name") or pid,
                    "encrypted": is_encrypted,
                    "needs_new_pin": is_encrypted and not has_pin(local),
                })
        if provided is None and needs:
            raise RestoreError(409, {"code": "secrets_required", "profiles": needs})
        provided = provided or {}

        # 2. Vérification de tous les secrets AVANT toute écriture
        plan, decrypted, skipped = {}, {}, []
        for pid, archived in archived_by_id.items():
            local = local_by_id.get(pid)
            need = next((n for n in needs if n["id"] == pid), None)
            if not need:
                plan[pid] = "plain"
                continue
            item = provided.get(pid) or {}
            secret = (item.get("secret") or "").strip()
            if not secret:
                skipped.append(need["name"])
                continue
            wait = pin_session.retry_after_seconds(pid)
            if wait:
                raise RestoreError(429, f"Trop d'essais incorrects pour « {need['name']} ». Réessayez dans {wait} secondes.",
                                   {"Retry-After": str(wait)})
            if has_pin(local):
                _check_secret(pid, verify_pin(pid, secret) or verify_recovery_code(pid, secret),
                              f"Code PIN ou code de récupération incorrect pour « {need['name']} ».")
            if need["encrypted"]:
                blob = zip_ref.read(f"encrypted/{pid}.omnienc")
                raw = _unlock_archive_key(blob, secret, local, archived)
                _check_secret(pid, raw is not None,
                              f"Impossible de déchiffrer « {need['name']} » : PIN (sur ce serveur) ou code de récupération incorrect.")
                new_pin = (item.get("new_pin") or "").strip()
                if need["needs_new_pin"] and len(new_pin) < 4:
                    raise RestoreError(400, f"Choisissez un nouveau code PIN (4 caractères minimum) pour « {need['name']} ».")
                inner = backup_crypto.decrypt_with(blob, raw)
                with zipfile.ZipFile(io.BytesIO(inner)) as inner_zip:
                    _check_paths(inner_zip.namelist())
                decrypted[pid] = {"inner": inner, "secret": secret, "new_pin": new_pin}
            plan[pid] = "encrypted" if need["encrypted"] else "plain"

        # 3. Écriture
        for pid in list(local_by_id) + list(archived_by_id):
            dispose_engine(pid)

        for member in names:
            if member in (MANIFEST, "profiles.json") or member.startswith("encrypted/"):
                continue
            if _belongs_to(member, [archived_by_id[pid] for pid, m in plan.items() if m == "plain"]) \
                    or not _belongs_to(member, list(archived_by_id.values())):
                zip_ref.extract(member, DATA_DIR)
        for pid, info in decrypted.items():
            with zipfile.ZipFile(io.BytesIO(info["inner"])) as inner_zip:
                inner_zip.extractall(DATA_DIR)

    # 4. profiles.json fusionné
    result_profiles, new_codes = [], {}
    restored_ids = set(plan)
    for pid, archived in archived_by_id.items():
        local = local_by_id.get(pid)
        if pid not in restored_ids:
            if local:
                result_profiles.append(local)
            continue
        entry = dict(archived)
        entry["backup_keys"] = _merge_keys(local, archived)
        if has_pin(local):
            for field in PROTECTION_FIELDS:
                if field != "backup_keys":
                    entry[field] = local.get(field)
        result_profiles.append(entry)
    for pid, local in local_by_id.items():
        if pid not in archived_by_id:
            result_profiles.append(local)  # profils locaux absents de l'archive : conservés

    ids = {p["id"] for p in result_profiles}
    active = archive_data.get("active_profile_id")
    if active not in ids:
        active = local_data.get("active_profile_id") if local_data.get("active_profile_id") in ids else "default"
    _save_profiles_data({**archive_data, "profiles": result_profiles, "active_profile_id": active})

    # Profils chiffrés restaurés sur une machine où ils n'avaient pas de PIN : nouveau PIN,
    # en conservant la clé de l'archive (les anciennes sauvegardes restent lisibles).
    for pid, info in decrypted.items():
        local = local_by_id.get(pid)
        if not has_pin(local):
            data = load_profiles_data()
            target = next(p for p in data["profiles"] if p["id"] == pid)
            target["backup_key_id"] = archived_by_id[pid].get("backup_key_id")
            target["pin_hash"] = target["pin_salt"] = None
            _save_profiles_data(data)
            new_codes[pid] = set_pin(pid, info["new_pin"], unlock_secret=info["secret"])
        pin_session.revoke_profile(pid)

    ensure_profiles_initialized()
    return {"skipped": skipped, "recovery_codes": new_codes}


def _belongs_to(member: str, profiles: List[dict]) -> bool:
    """Le chemin d'archive appartient-il aux fichiers de l'un de ces profils ?"""
    for p in profiles:
        db_rel = p.get("db_path", "omnibank.db")
        db_dir = os.path.dirname(db_rel)
        roots = [p.get("uploads_dir", "uploads").rstrip("/") + "/"]
        if db_dir:
            roots.append(db_dir.rstrip("/") + "/")
        if member == db_rel or any(member.startswith(r) for r in roots):
            return True
    return False
