"""
app/services/restore_points.py — Points de restauration de l'Auto-Pilote.

Avant chaque lot que l'Auto-Pilote traite (relevé bancaire ou import de fichier), une copie de la base du profil est
gardée avec les lignes reçues. Restaurer un point remet les données de ce moment-là ; les réglages et l'accès bancaire
d'aujourd'hui sont conservés. Les lignes gardées peuvent ensuite être rejouées avec la version actuelle, sans contacter
la banque. Un point est pris avant chaque restauration, pour pouvoir revenir en arrière.

Les points vivent hors des dossiers de profil ({DATA_DIR}/restore_points/{profil}/) : ils n'alourdissent pas les
sauvegardes. Ils sont gardés 14 jours.
"""
import json
import logging
import os
import re
import sqlite3
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from app.database import DATA_DIR

logger = logging.getLogger(__name__)

RETENTION_DAYS = 14
# Tables qui restent celles d'aujourd'hui quand on restaure : réglages (dont le coffre-fort) et connexions bancaires
KEPT_TABLES = ("global_config", "bank_connections")
_POINT_ID = re.compile(r"^rp_\d{8}_\d{6}_\d{6}$")


def points_dir(profile_id: str) -> str:
    return os.path.join(DATA_DIR, "restore_points", re.sub(r"[^A-Za-z0-9_-]", "_", profile_id or "default"))


def _copy_database(src_path: str, dst_path: str) -> None:
    """Copie cohérente d'une base SQLite, même ouverte ailleurs en WAL."""
    src = sqlite3.connect(src_path)
    try:
        dst = sqlite3.connect(dst_path)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def _session_db_path(db) -> Optional[str]:
    try:
        path = db.get_bind().url.database
    except Exception:
        return None
    if not path or path == ":memory:" or path.startswith("file:"):
        return None
    return path


def create_point(db_path: str, profile_id: str, source: str, batch_id: Optional[str] = None,
                 conn_id: Optional[int] = None, preview_data: Optional[Dict[str, Any]] = None,
                 extra: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Copie la base et garde les lignes du lot. Retourne l'identifiant du point."""
    if not db_path or not os.path.exists(db_path):
        return None
    folder = points_dir(profile_id)
    os.makedirs(folder, exist_ok=True)
    now = datetime.now()
    point_id = f"rp_{now.strftime('%Y%m%d_%H%M%S')}_{now.microsecond:06d}"
    _copy_database(db_path, os.path.join(folder, f"{point_id}.db"))
    meta = {
        "id": point_id,
        "created_at": now.isoformat(timespec="seconds"),
        "source": source,
        "batch_id": batch_id,
        "conn_id": conn_id,
        "line_count": sum(len(a.get("transactions") or []) for a in (preview_data or {}).get("accounts") or []),
        "preview_data": preview_data,
        **(extra or {}),
    }
    with open(os.path.join(folder, f"{point_id}.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, default=str)
    prune(profile_id)
    return point_id


def create_point_for_batch(db, profile_id: str, batch_id: str, conn_id: int, preview_data: Dict[str, Any]) -> None:
    """Point pris juste avant qu'un lot Auto-Pilote touche à la base. Ne bloque jamais le lot."""
    path = _session_db_path(db)
    if not path:
        return
    try:
        create_point(path, profile_id, "batch", batch_id=batch_id, conn_id=conn_id, preview_data=preview_data)
    except Exception as err:
        logger.warning(f"[RestorePoints] Point de restauration non créé avant le lot {batch_id} : {err}")


def prune(profile_id: str, now: Optional[datetime] = None) -> None:
    limit = (now or datetime.now()) - timedelta(days=RETENTION_DAYS)
    for meta in list_points(profile_id, with_preview=False):
        try:
            if datetime.fromisoformat(meta["created_at"]) < limit:
                for ext in (".db", ".json"):
                    path = os.path.join(points_dir(profile_id), meta["id"] + ext)
                    if os.path.exists(path):
                        os.remove(path)
        except (KeyError, ValueError, OSError) as err:
            logger.warning(f"[RestorePoints] Nettoyage du point {meta.get('id')} impossible : {err}")


def _read_meta(profile_id: str, point_id: str) -> Optional[Dict[str, Any]]:
    path = os.path.join(points_dir(profile_id), f"{point_id}.json")
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def list_points(profile_id: str, with_preview: bool = False) -> List[Dict[str, Any]]:
    """Points du profil, du plus récent au plus ancien."""
    folder = points_dir(profile_id)
    if not os.path.isdir(folder):
        return []
    points = []
    for name in os.listdir(folder):
        point_id = name[:-5] if name.endswith(".json") else None
        if not point_id or not _POINT_ID.match(point_id) or not os.path.exists(os.path.join(folder, point_id + ".db")):
            continue
        meta = _read_meta(profile_id, point_id)
        if not meta:
            continue
        meta["has_lines"] = bool(meta.get("preview_data"))
        if not with_preview:
            meta.pop("preview_data", None)
        points.append(meta)
    # L'identifiant porte la date à la microseconde : deux points de la même seconde restent dans l'ordre
    points.sort(key=lambda m: m.get("id", ""), reverse=True)
    return points


def _read_rows(path: str, table: str):
    con = sqlite3.connect(path)
    try:
        cur = con.execute(f"SELECT * FROM {table}")
        return [d[0] for d in cur.description], cur.fetchall()
    except sqlite3.OperationalError:
        return None, []
    finally:
        con.close()


def restore_point(db_path: str, profile_id: str, point_id: str) -> Dict[str, Any]:
    """
    Remet la base du profil telle qu'au point, en gardant les réglages et les connexions bancaires d'aujourd'hui.
    Un point « avant restauration » est pris d'abord. Le moteur SQLAlchemy du profil doit être fermé par l'appelant.
    Retourne les métadonnées du point restauré (lignes du lot comprises) et l'identifiant du point d'annulation.
    """
    if not _POINT_ID.match(point_id or ""):
        raise ValueError("Point de restauration inconnu.")
    meta = _read_meta(profile_id, point_id)
    snapshot = os.path.join(points_dir(profile_id), f"{point_id}.db")
    if not meta or not os.path.exists(snapshot):
        raise ValueError("Point de restauration introuvable.")

    kept = {table: _read_rows(db_path, table) for table in KEPT_TABLES}
    undo_id = create_point(db_path, profile_id, "before_restore", extra={"restored_point": point_id})

    _copy_database(snapshot, db_path)
    con = sqlite3.connect(db_path)
    try:
        for table, (columns, rows) in kept.items():
            if columns is None:
                continue
            present = [r[1] for r in con.execute(f"PRAGMA table_info({table})")]
            if not present:
                continue
            shared = [c for c in columns if c in present]
            idx = [columns.index(c) for c in shared]
            con.execute(f"DELETE FROM {table}")
            con.executemany(
                f"INSERT INTO {table} ({', '.join(shared)}) VALUES ({', '.join('?' for _ in shared)})",
                [tuple(row[i] for i in idx) for row in rows],
            )
        con.commit()
    finally:
        con.close()
    logger.info(f"[RestorePoints] Profil {profile_id} restauré au point {point_id} (annulation : {undo_id})")
    return {"point": meta, "undo_point_id": undo_id}
