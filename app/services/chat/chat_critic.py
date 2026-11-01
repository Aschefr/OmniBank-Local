"""
app/services/chat/chat_critic.py — Background Critic & Auto-Correction Worker

Audite de manière asynchrone les réponses de l'assistant, sans appel au modèle :
vérifie que les actions promises dans le texte ont bien été émises et, sinon, enregistre
une variante complétée ("origin": "auto_correction") avec une notification non intrusive.

Aucune réécriture par le modèle : une relecture sans le dossier financier ni les outils
ne peut que reformuler, voire inventer des chiffres.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session, sessionmaker
from app.database import SessionLocal, get_engine
from app.models import ChatMessage, Notification
from app.services.chat.chat_action_recovery import find_missing_promised_actions, append_actions_to_text

logger = logging.getLogger(__name__)


def should_critique(message_content: str, role: str) -> bool:
    """Filtre rapide : n'audite que les réponses substantielles de l'assistant."""
    if role != "assistant" or not message_content:
        return False
    if len(message_content) < 150:
        return False
    financial_keywords = ("virement", "budget", "épargne", "découvert", "recommandation", "solde", "compte", "transfer")
    content_lower = message_content.lower()
    return any(kw in content_lower for kw in financial_keywords)


def _open_profile_session(profile_id: Optional[str]) -> Session:
    """Session sur la base du profil de la conversation (et non du profil actif à cet instant)."""
    if profile_id:
        return sessionmaker(autocommit=False, autoflush=False, bind=get_engine(profile_id))()
    return SessionLocal()


def run_background_critic(profile_id: Optional[str], session_id: int, message_id: int):
    """Point d'entrée exécuté en tâche de fond (Thread démon)."""
    db: Session = _open_profile_session(profile_id)
    try:
        msg = db.query(ChatMessage).filter(
            ChatMessage.id == message_id,
            ChatMessage.session_id == session_id,
        ).first()
        if not msg or msg.role != "assistant" or not msg.content:
            return

        # Ne pas relancer si une variante issue d'auto_correction existe déjà
        variants = msg.get_variants_list()
        if any(v.get("origin") == "auto_correction" for v in variants):
            return

        # Le modèle a déjà émis ses actions : ne pas en deviner d'autres à partir du texte
        if "```action" in msg.content:
            return

        # Audit déterministe : actions promises manquantes (0 ms GPU)
        missing = find_missing_promised_actions(msg.content, db)
        if missing:
            logger.info(f"[Chat Critic] Fast-audit : {len(missing)} action(s) manquante(s) détectée(s) pour le message #{message_id}")
            improved_content = append_actions_to_text(msg.content, missing)
            _save_auto_corrected_variant(db, msg, improved_content, session_id, critique_note="Complétion automatique des actions promises")

    except Exception as err:
        logger.warning(f"[Chat Critic] Erreur audit fond message #{message_id} : {err}")
    finally:
        db.close()


def _save_auto_corrected_variant(db: Session, msg: ChatMessage, new_content: str, session_id: int, critique_note: str = ""):
    """Enregistre la variante optimisée sans forcer le remplacement immédiat de la vue active."""
    v_list = msg.get_variants_list()
    if not v_list:
        v_list = [{
            "index": 0,
            "content": msg.content,
            "created_at": msg.timestamp.isoformat() if msg.timestamp else datetime.now(timezone.utc).isoformat(),
            "origin": "initial"
        }]

    new_idx = len(v_list)
    v_list.append({
        "index": new_idx,
        "content": new_content,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "origin": "auto_correction",
        "critique": critique_note
    })
    msg.variants = json.dumps(v_list, ensure_ascii=False)
    db.commit()

    # Création d'une notification discrète pour informer l'utilisateur
    notif = Notification(
        type="chat_variant",
        title="Version optimisée disponible ✨",
        content="L'assistant a enrichi sa recommandation avec des précisions complémentaires.",
        link_data=json.dumps({"session_id": session_id, "message_id": msg.id, "variant_index": new_idx}),
        is_read=False,
        created_at=datetime.now(timezone.utc)
    )
    db.add(notif)
    db.commit()
    logger.info(f"[Chat Critic] Variante v{new_idx + 1} auto_correction enregistrée pour message #{msg.id}")
