"""
app/services/chat/chat_critic.py — Background Critic & Auto-Correction Worker

Audite de manière asynchrone les réponses de l'assistant :
1. Fast-audit déterministe (actions promises vs émises).
2. Évaluation de pertinence/omission avec prompt concis (format: json).
3. Génération d'une variante corrigée ("origin": "auto_correction") et notification non intrusive.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import ChatMessage, Notification
from app.services.chat.ollama_client import get_ollama_config, call_ollama_sync, strip_thinking
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


def run_background_critic(profile_id: Optional[int], session_id: int, message_id: int):
    """Point d'entrée exécuté en tâche de fond (Thread démon)."""
    db: Session = SessionLocal()
    try:
        msg = db.query(ChatMessage).filter(ChatMessage.id == message_id).first()
        if not msg or msg.role != "assistant" or not msg.content:
            return

        # Ne pas relancer si une variante issue d'auto_correction existe déjà
        variants = msg.get_variants_list()
        if any(v.get("origin") == "auto_correction" for v in variants):
            return

        # 1. Audit rapide déterministe : actions promises manquantes (0 ms GPU)
        missing = find_missing_promised_actions(msg.content, db)
        if missing:
            logger.info(f"[Chat Critic] Fast-audit : {len(missing)} action(s) manquante(s) détectée(s) pour le message #{message_id}")
            improved_content = append_actions_to_text(msg.content, missing)
            _save_auto_corrected_variant(db, msg, improved_content, session_id, critique_note="Complétion automatique des actions promises")
            return

        # 2. Audit LLM ciblé si le message formule une stratégie complexe
        if any(w in msg.content.lower() for w in ("stratégie", "virement", "recommandation", "plan d'action")):
            cfg = get_ollama_config(db)
            if not cfg.get("enabled") or not cfg.get("url") or not cfg.get("model"):
                return

            critique_prompt = f"""Tu es un auditeur financier rigoureux. Évalue la réponse suivante donnée à l'utilisateur :
\"\"\"{msg.content[:1500]}\"\"\"

Règles d'évaluation :
- Note de 1 à 10 la clarté, la rigueur et l'exhaustivité des conseils.
- Si une opération essentielle a été omise ou si une incohérence apparaît, mets une note inférieure à 7 et explique brièvement.
- Réponds au format JSON strict :
{{"score": 8, "needs_improvement": false, "critique": ""}} ou {{"score": 5, "needs_improvement": true, "critique": "Raison courte"}}"""

            try:
                resp_str = call_ollama_sync(critique_prompt, cfg, extra_options={"format": "json"})
                if not resp_str:
                    return

                cleaned_json = strip_thinking(resp_str)
                eval_data = json.loads(cleaned_json)
                if eval_data.get("needs_improvement") and eval_data.get("critique"):
                    critique_note = str(eval_data.get("critique"))
                    logger.info(f"[Chat Critic] Amélioration requise (score {eval_data.get('score')}) : {critique_note}")

                    refine_prompt = f"""Voici ta réponse précédente :
\"\"\"{msg.content[:1500]}\"\"\"

Remarque d'audit : {critique_note}.
Réécris la réponse de manière fluide, complète et corrigée en intégrant cette précision."""

                    refined_resp = call_ollama_sync(refine_prompt, cfg)
                    refined_clean = strip_thinking(refined_resp)
                    if refined_clean and len(refined_clean.strip()) > 100:
                        _save_auto_corrected_variant(db, msg, refined_clean.strip(), session_id, critique_note=critique_note)
            except Exception as e:
                logger.debug(f"[Chat Critic] Erreur LLM critic (bénigne) : {e}")

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
