"""
app/services/chat/chat_compression.py — Moteur de compression de contexte et de génération automatique de titre de session.
"""
import re
import json
import time
import logging
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

from app.models import ChatSession, ChatMessage
from app.services.chat.ollama_client import call_ollama_sync

logger = logging.getLogger(__name__)

# Ratios mesurés avec Ollama (prompt_eval_count) sur le prompt système et les schémas d'outils réels :
# ~3,6 caractères par token pour du texte français/anglais, ~4,8 pour le JSON des outils.
TEXT_CHARS_PER_TOKEN = 3.6
TOOLS_CHARS_PER_TOKEN = 4.8
MESSAGE_OVERHEAD_TOKENS = 4  # balises de rôle du gabarit de chat

# Seuil de compaction : 75 % du contexte, plafonné. Le contexte (num_ctx) envoyé à Ollama, lui, ne change
# jamais : le modifier déchargerait puis rechargerait le modèle. Au-delà de ~32K, un petit modèle local
# répond plus lentement et moins bien ; mieux vaut résumer les anciens échanges.
COMPACTION_RATIO = 0.75
COMPACTION_CAP_TOKENS = 32768
# Derniers échanges (question + réponse) gardés mot pour mot lors d'une compaction
KEEP_RECENT_EXCHANGES = 2
SUMMARY_MIN_TOKENS = 500
SUMMARY_MAX_TOKENS = 3000

_THINK_RE = re.compile(r'<think>[\s\S]*?</think>\s*')
_TOOLS_META_RE = re.compile(r'<!--\s*TOOLS_USED:[^>]*-->\n?')
_ACTION_BLOCK_RE = re.compile(r'```action\s*[\s\S]*?```\n?')

# Correction de l'estimation par la dernière mesure réelle d'Ollama, par modèle (les tokenizers diffèrent)
_calibration: Dict[str, float] = {}


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, int(len(text) / TEXT_CHARS_PER_TOKEN))


def _raw_payload_tokens(messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None) -> int:
    total = sum(estimate_tokens(m.get("content") or "") + MESSAGE_OVERHEAD_TOKENS for m in messages)
    for m in messages:
        if m.get("tool_calls"):
            total += estimate_tokens(json.dumps(m["tool_calls"], ensure_ascii=False))
    if tools:
        total += int(len(json.dumps(tools, ensure_ascii=False)) / TOOLS_CHARS_PER_TOKEN)
    return total


def estimate_payload_tokens(messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None, model: Optional[str] = None) -> int:
    """Estimation du nombre de tokens d'un envoi à Ollama, corrigée par la dernière mesure réelle du modèle."""
    return int(_raw_payload_tokens(messages, tools) * _calibration.get(model or "", 1.0))


def record_real_usage(model: str, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]], real_prompt_tokens: Optional[int]) -> None:
    """Met à jour la correction de l'estimation à partir du prompt_eval_count renvoyé par Ollama."""
    if not model or not real_prompt_tokens:
        return
    raw = _raw_payload_tokens(messages, tools)
    if raw <= 0:
        return
    factor = min(2.0, max(0.5, real_prompt_tokens / raw))
    prev = _calibration.get(model)
    _calibration[model] = factor if prev is None else round(0.5 * prev + 0.5 * factor, 4)


def compaction_threshold(num_ctx: int) -> int:
    return min(COMPACTION_CAP_TOKENS, int(num_ctx * COMPACTION_RATIO))


def clean_for_replay(content: str) -> str:
    """Contenu d'un message tel que renvoyé au modèle : sans raisonnement, cartes d'action ni métadonnées."""
    clean = _TOOLS_META_RE.sub('', content or '')
    clean = _ACTION_BLOCK_RE.sub('', clean)
    return _THINK_RE.sub('', clean).strip()


def build_replay_messages(sys_prompt: str, session: ChatSession, messages: List[ChatMessage]) -> List[Dict[str, Any]]:
    """Messages envoyés à Ollama : prompt système + dernier résumé + échanges postérieurs au résumé.
    Le dernier résumé couvre déjà les précédents (chaque compaction les fusionne) : la pile
    compression_stack ne sert qu'à l'affichage et n'est pas renvoyée au modèle."""
    sys_content = sys_prompt
    if session.compressed_context:
        sys_content += f"\n\n[CONTEXT SUMMARY — earlier conversation]\n{session.compressed_context}"
    payload = [{"role": "system", "content": sys_content}]
    boundary = session.last_compressed_message_id
    for m in messages:
        if boundary and m.id <= boundary:
            continue
        payload.append({"role": m.role, "content": clean_for_replay(m.content)})
    return payload


def context_usage(sys_prompt: str, session: ChatSession, messages: List[ChatMessage], tools, cfg: dict) -> Dict[str, int]:
    """Jauge « Mémoire » : taille de la conversation au prochain envoi, rapportée au seuil de compaction."""
    used = estimate_payload_tokens(build_replay_messages(sys_prompt, session, messages), tools, cfg.get("model"))
    return {"used": used, "limit": compaction_threshold(cfg["num_ctx"]), "num_ctx": cfg["num_ctx"]}


def _select_messages_to_compress(session: ChatSession, messages: List[ChatMessage], trigger_msg_id: Optional[int]) -> List[ChatMessage]:
    """Messages à résumer : depuis le dernier résumé jusqu'avant le message déclencheur,
    en gardant intacts les KEEP_RECENT_EXCHANGES derniers échanges si cela laisse quelque chose à résumer."""
    boundary = session.last_compressed_message_id
    candidates = [m for m in messages
                  if (not boundary or m.id > boundary) and (not trigger_msg_id or m.id < trigger_msg_id)]
    user_idx = [i for i, m in enumerate(candidates) if m.role == "user"]
    for keep in range(KEEP_RECENT_EXCHANGES, 0, -1):
        if len(user_idx) > keep:
            return candidates[:user_idx[-keep]]
    return candidates


def _summary_prompt(previous_summary: Optional[str], chunk: List[ChatMessage], target_words: int, lang: str, custom_instruction: Optional[str]) -> str:
    parts = []
    if previous_summary:
        parts.append(f"[Previous summary]\n{previous_summary}\n\n[New messages to merge into the summary]")
    for msg in chunk:
        parts.append(f"{'U' if msg.role == 'user' else 'A'}: {clean_for_replay(msg.content)}")
    language = {"fr": "French", "en": "English"}.get((lang or "fr").lower(), lang)
    custom = f"\nAdditional user instruction for this summary: {custom_instruction}" if custom_instruction else ""
    return f"""{chr(10).join(parts)}

=== COMPRESSION INSTRUCTIONS ===
You are the memory of a personal finance assistant. Write ONE summary of the whole conversation above
(previous summary included) so the assistant can continue it without the original messages.

RULES:
1. Output ONLY the summary: no intro, no commentary, no title.
2. Dense bullet points. U: = user, A: = assistant.
3. Drop greetings, politeness, filler and repetitions.
4. KEEP every financial fact: amounts, dates, account names, categories, figures computed.
5. KEEP what the user asked, what was decided or done (operations recorded, validated or refused), and open questions.
6. At most about {target_words} words.
7. Write the summary in {language}.{custom}

SUMMARY:"""


async def _summarize(prompt: str, cfg: dict, num_predict: int) -> tuple:
    """Appel Ollama non bloquant, sans raisonnement (think=false) pour un résumé direct.
    Même num_ctx que le chat : aucun rechargement du modèle."""
    url = (cfg.get("url") or "").rstrip("/")
    payload = {
        "model": cfg.get("model"),
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "think": False,
        "options": {"temperature": 0.1, "num_ctx": cfg["num_ctx"], "num_predict": num_predict},
        "keep_alive": "30m",
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=10.0)) as client:
        resp = await client.post(f"{url}/api/chat", json=payload)
        if resp.status_code == 400 and "think" in resp.text.lower():
            # Modèle sans mode raisonnement : même appel sans le paramètre
            payload.pop("think")
            resp = await client.post(f"{url}/api/chat", json=payload)
    resp.raise_for_status()
    data = resp.json()
    content = _THINK_RE.sub('', (data.get("message") or {}).get("content") or "").strip()
    return content, data.get("done_reason")


async def start_compression(db: Session, session: ChatSession, messages: List[ChatMessage], cfg: dict, lang: str = "fr", custom_instruction: str = None, trigger_msg_id: int = None) -> str | None:
    """Résume l'historique dans compressed_context sans supprimer de message.

    Le nouveau résumé fusionne le précédent et les messages depuis la dernière compaction, en gardant
    intacts les derniers échanges et le message déclencheur. Un historique trop long pour une seule
    requête est résumé par morceaux successifs. Retourne le nouveau résumé, ou None en cas d'échec.
    """
    to_compress = _select_messages_to_compress(session, messages, trigger_msg_id)
    if not to_compress:
        return None

    num_ctx = int(cfg["num_ctx"])
    try:
        summary = session.compressed_context or None
        pending = list(to_compress)
        while pending:
            # Morceau le plus long tenant dans le contexte avec le résumé courant et la réponse attendue
            reserve = SUMMARY_MAX_TOKENS * 2 + 1500
            room = num_ctx - reserve - estimate_tokens(summary or "")
            chunk, size = [], 0
            for m in pending:
                t = estimate_tokens(clean_for_replay(m.content)) + MESSAGE_OVERHEAD_TOKENS
                if chunk and size + t > room:
                    break
                chunk.append(m)
                size += t
            pending = pending[len(chunk):]

            input_tokens = size + estimate_tokens(summary or "")
            target = min(SUMMARY_MAX_TOKENS, max(SUMMARY_MIN_TOKENS, input_tokens // 4))
            prompt = _summary_prompt(summary, chunk, int(target * 0.7), lang, custom_instruction)
            content, done_reason = await _summarize(prompt, cfg, num_predict=target * 2)
            if done_reason == "length":
                logger.warning(f"[Compression] Résumé tronqué par la limite de longueur ({target * 2} tokens)")
            if not content:
                raise ValueError("résumé vide")
            summary = content

        # Les résumés précédents restent visibles dans l'interface (pile), le modèle ne reçoit que le dernier
        if session.bubble_after_id and session.compressed_context:
            stack = json.loads(session.compression_stack) if session.compression_stack else []
            stack.append({"context": session.compressed_context, "after_id": session.bubble_after_id})
            session.compression_stack = json.dumps(stack)

        session.compressed_context = summary
        session.last_compressed_message_id = to_compress[-1].id
        session.bubble_after_id = to_compress[-1].id
        session.compressing = False
        session.buffered_message = None
        session.compression_started_at = None
        db.commit()
        db.refresh(session)
        return summary
    except Exception as e:
        logger.error(f"[Compression] Error during start_compression: {e}")
        session.compressing = False
        session.compression_started_at = None
        db.commit()
    return None

def extract_fallback_title(user_message: str, context_hint: str = None) -> str:
    """Génère immédiatement un titre concis et pertinent (3 à 5 mots) en français
    de manière heuristique sans bloquer en cas de lenteur ou d'indisponibilité d'Ollama."""
    import re

    # 1. Traitement spécifique des approfondissements de bilans ou d'alertes IA
    if context_hint:
        clean_hint = re.sub(r'[\U00010000-\U0010ffff]', '', context_hint)
        clean_hint = clean_hint.replace("📊", "").replace("💬", "").replace("##", "").strip()
        clow_hint = clean_hint.lower()
        if "bilan" in clow_hint or "santé financière" in clow_hint:
            months_fr = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
            combined = (user_message + " " + clean_hint).lower()
            found_month = next((m for m in months_fr if m in combined), None)
            if found_month:
                return f"Bilan {found_month.capitalize()} (Approfondissement)"
            return "Bilan financier (Approfondissement)"
        elif "alerte" in clow_hint or "anomalie" in clow_hint:
            return "Analyse alerte financière"

    if not user_message:
        return "Nouvelle discussion"

    text = user_message.strip()
    text = re.sub(r'https?://\S+', '', text)
    text = re.sub(r'```[\s\S]*?```', '', text)
    text = re.sub(r'[?!:;.,]+$', '', text)

    fillers = [
        r'^(bonjour|salut|coucou|hello|bonsoir)\s*[,!]*\s*',
        r'^(dis[\s-]moi|peux[\s-]tu me dire|peux[\s-]tu|pourrais[\s-]tu|est[\s-]ce que tu peux|est[\s-]ce que)\s*',
        r'^(je voudrais savoir|j\'aimerais savoir|je veux savoir|je souhaite savoir)\s*',
        r'^(donne[\s-]moi|affiche[\s-]moi|montre[\s-]moi|calcule[\s-]moi|fais[\s-]moi|sort[\s-]moi)\s*',
        r'^(quel est|quelle est|quels sont|quelles sont|combien ai[\s-]je|combien de)\s*',
        r'^(comment faire pour|comment|pourquoi|qu\'est[\s-]ce que)\s*',
    ]
    cleaned = text
    for f in fillers:
        cleaned = re.sub(f, '', cleaned, flags=re.IGNORECASE).strip()

    clow = cleaned.lower()
    if "reste à vivre" in clow or "reste a vivre" in clow:
        return "Calcul du reste à vivre"
    if "solde" in clow or "soldes" in clow:
        return "Solde des comptes"
    if "patrimoine" in clow:
        return "Analyse du patrimoine net"
    if "simulateur" in clow or "simulation" in clow or "what-if" in clow or "what if" in clow:
        return "Simulation financière"
    if "crédit" in clow or "pret" in clow or "prêt" in clow or "emprunt" in clow:
        return "Simulation de prêt"
    if "abonnement" in clow or "abonnements" in clow:
        return "Audit des abonnements"
    if "livret" in clow or "épargne" in clow or "epargne" in clow:
        return "Épargne & Livrets"
    if "courses" in clow or "supermarché" in clow or "alimentation" in clow:
        return "Budget Courses & Alimentation"
    if "virement" in clow:
        return "Opération de virement"
    if "catégorie" in clow or "categorie" in clow:
        return "Gestion des catégories"
    if "salaire" in clow or "paie" in clow:
        return "Prévision salaire & paie"
    if "budget" in clow:
        return "Gestion des budgets"

    words = cleaned.split()
    if words:
        short_title = " ".join(words[:5])
        if len(short_title) > 60:
            short_title = short_title[:60].rstrip()
        return short_title[0].upper() + short_title[1:] if len(short_title) > 1 else short_title.upper()

    return "Discussion financière"


def clean_llm_title(raw_text: str) -> Optional[str]:
    """Nettoie minutieusement la réponse d'Ollama : élimination des blocs <think>,
    des préambules, citations, ponctuation superflue et contrainte à 3-5 mots."""
    import re
    if not raw_text:
        return None
    # Suppression intégrale des balises de raisonnement (<think>...</think>)
    text = re.sub(r'<think>[\s\S]*?</think>', '', raw_text, flags=re.IGNORECASE)
    text = re.sub(r'```[\s\S]*?```', '', text)
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if not lines:
        return None
    candidate = lines[0]
    
    # Nettoyage itératif des préambules, ponctuation et balises markdown (*, _, `, ", ')
    for _ in range(3):
        candidate = re.sub(r'^(titre\s*:\s*|title\s*:\s*|voici le titre\s*:\s*|sujet\s*:\s*)', '', candidate, flags=re.IGNORECASE)
        candidate = candidate.strip(' \t\n\r"\'`*#_~:')
        candidate = re.sub(r'[:;,.!?]+$', '', candidate).strip()

    if not candidate:
        return None
    words = candidate.split()
    if len(words) > 5:
        candidate = " ".join(words[:5])
    if len(candidate) > 60:
        candidate = candidate[:60].rstrip()
    if len(candidate) < 3:
        return None
    return candidate[0].upper() + candidate[1:]


def generate_session_title(profile_or_factory, session_id: int, user_message: str, cfg: dict, context_hint: str = None):
    """Génère un titre concis (3 à 5 mots) pour la conversation.
    Applique immédiatement un titre heuristique soigné, puis tente d'affiner via Ollama en tâche de fond."""
    import time
    from app.database import get_engine
    from sqlalchemy.orm import sessionmaker

    def _create_db_session():
        if isinstance(profile_or_factory, str):
            eng = get_engine(profile_or_factory)
            factory = sessionmaker(autocommit=False, autoflush=False, bind=eng)
            return factory()
        elif callable(profile_or_factory):
            return profile_or_factory()
        else:
            from app.database import SessionLocal
            return SessionLocal()

    fallback = extract_fallback_title(user_message, context_hint)

    # 1. Application immédiate du titre heuristique si le titre actuel est un placeholder générique
    db_init = None
    try:
        db_init = _create_db_session()
        session = db_init.query(ChatSession).filter(ChatSession.id == session_id).first()
        if session:
            current_title = (session.title or "").strip()
            is_placeholder = (
                not current_title
                or current_title in ("Nouvelle conversation", "New conversation", "Approfondissement Bilan IA", "AI Financial Report Deepening")
                or current_title.startswith("Nouvelle conversation")
                or current_title.startswith("Approfondissement")
                or current_title.startswith("AI Financial Report")
            )
            if is_placeholder:
                session.title = fallback
                db_init.commit()
                logger.info(f"[Chat] Titre heuristique immédiat appliqué pour session {session_id}: '{fallback}'")
    except Exception as e:
        logger.warning(f"[Chat] Impossible d'appliquer le titre heuristique immédiat: {e}")
    finally:
        if db_init is not None:
            try:
                db_init.close()
            except Exception:
                pass

    # 2. Affinage via Ollama si disponible
    prompt = f"""Tu es un assistant bancaire. Résume le sujet de cette conversation financière en un titre ultra-concis de 3 à 5 mots en français.
Message de l'utilisateur : "{user_message[:200]}"
{f"Contexte du rapport : {context_hint[:150]}" if context_hint else ""}

RÈGLES STRICTES :
- 3 à 5 mots maximum
- Pas de ponctuation finale
- En français
- Réponds UNIQUEMENT avec le titre, aucun commentaire, aucune balise, aucune citation.

TITRE :"""

    max_attempts = 2
    for attempt in range(1, max_attempts + 1):
        db = None
        try:
            time.sleep(2 if attempt == 1 else 6)
            # Sans raisonnement : un modèle qui réfléchit épuiserait les 30 tokens avant d'écrire le titre
            raw_title = call_ollama_sync(prompt, cfg, extra_options={"temperature": 0.2, "num_predict": 30, "think": False})
            clean_title = clean_llm_title(raw_title)
            if clean_title:
                db = _create_db_session()
                session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
                if session:
                    # Ne pas écraser si l'utilisateur a renommé manuellement entre-temps
                    if session.title in (fallback, "Nouvelle conversation", "Approfondissement Bilan IA", "AI Financial Report Deepening"):
                        session.title = clean_title
                        db.commit()
                        logger.info(f"[Chat] Titre affiné par Ollama pour session {session_id} (profil={profile_or_factory}): '{clean_title}'")
                return
        except Exception as e:
            logger.debug(f"[Chat] Tentative {attempt}/{max_attempts} d'affinage de titre échouée pour session {session_id}: {e}")
        finally:
            if db is not None:
                try:
                    db.close()
                except Exception:
                    pass

    logger.info(f"[Chat] Titre conservé pour session {session_id}: '{fallback}'")
