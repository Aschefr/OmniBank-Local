"""
app/services/chat/chat_compression.py — Moteur de compression de contexte et de génération automatique de titre de session.
"""
import json
import time
import logging
from typing import List, Optional
from sqlalchemy.orm import Session

from app.models import ChatSession, ChatMessage
from app.services.chat.ollama_client import call_ollama_sync

logger = logging.getLogger(__name__)

def estimate_tokens(text: str) -> int:
    return len(text) // 4

def start_compression(db: Session, session: ChatSession, messages: List[ChatMessage], cfg: dict, lang: str = "fr", custom_instruction: str = None, trigger_msg_id: int = None) -> str | None:
    """Compress conversation history into compressed_context without deleting any messages.
    
    Compresses from the last compression point (or beginning) up to the last AI message
    before the trigger. The trigger message and the future AI response remain uncompressed.
    Uses dedicated LLM parameters (temperature=0.1, num_predict=2048) for faithful, concise summaries.
    Returns the new compressed_context string, or None on failure.
    """
    # Compress all messages from the last boundary (or beginning) up to (not including) the trigger
    if trigger_msg_id:
        if session.last_compressed_message_id:
            to_compress = [m for m in messages if m.id > session.last_compressed_message_id and m.id < trigger_msg_id]
        else:
            to_compress = [m for m in messages if m.id < trigger_msg_id]
    else:
        # Fallback (regenerate without trigger): use existing last_compressed_message_id or compress all
        if session.last_compressed_message_id:
            to_compress = [m for m in messages if m.id > session.last_compressed_message_id]
        else:
            to_compress = messages
    
    if not to_compress:
        return None  # Nothing new to compress

    formatted_history = []
    if session.compressed_context:
        formatted_history.append(f"[Previously compressed summary]\n{session.compressed_context}\n\n[New messages to add to summary]")
    for msg in to_compress:
        role_prefix = "U" if msg.role == "user" else "A"
        formatted_history.append(f"{role_prefix}: {msg.content}")
    history_text = "\n".join(formatted_history)

    # Prompt in English, with language instruction for the response
    lang_instruction = ""
    if lang and lang.lower() == "fr":
        lang_instruction = "\nIMPORTANT: Write the summary in French."
    elif lang and lang.lower() != "en":
        lang_instruction = f"\nIMPORTANT: Write the summary in {lang}."
    else:
        lang_instruction = "\nIMPORTANT: Write the summary in English."

    custom_instr_block = ""
    if custom_instruction:
        custom_instr_block = f"\nAdditional user instruction for this summary: {custom_instruction}"

    prompt = f"""{history_text}

=== COMPRESSION INSTRUCTIONS (CRITICAL — READ CAREFULLY) ===
You are a memory compactor for a financial AI assistant. Summarize the conversation ABOVE.

RULES:
1. Output ONLY the summary. No intro, no commentary, no titles.
2. Use bullet points for key facts. Keep it dense and informative.
3. U: = user said, A: = assistant said.
4. Remove ALL greetings, politeness, filler, repetitions.
5. KEEP ALL financial data: amounts, dates, account names, categories, decisions made.
6. KEEP conversation flow (who asked what, what was decided).
7. Target: 30-50% of original size.{lang_instruction}{custom_instr_block}

NOW WRITE THE SUMMARY BELOW:"""

    # Use dedicated compression parameters: lower temperature for faithfulness, limited output length
    compression_cfg = dict(cfg)
    compression_cfg["temperature"] = 0.1
    compression_options = {"temperature": 0.1, "num_ctx": cfg["num_ctx"], "num_predict": 2048}

    try:
        compacted = call_ollama_sync(prompt, compression_cfg, extra_options={"num_predict": 2048})
        if compacted:
            compacted = compacted.strip()
            # If this is a subsequent compression, push the old context onto the stack
            if session.bubble_after_id and session.compressed_context:
                import json
                stack = json.loads(session.compression_stack) if session.compression_stack else []
                stack.append({
                    "context": session.compressed_context,
                    "after_id": session.bubble_after_id
                })
                session.compression_stack = json.dumps(stack)

            session.compressed_context = compacted
            # Track the last message ID that is now covered by the compressed context
            session.last_compressed_message_id = to_compress[-1].id
            # Place bubble after the last compressed message (not after the trigger)
            session.bubble_after_id = to_compress[-1].id
            session.compressing = False
            session.buffered_message = None
            session.compression_started_at = None
            db.commit()
            db.refresh(session)
            return compacted
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
            raw_title = call_ollama_sync(prompt, cfg, extra_options={"temperature": 0.2, "num_predict": 30})
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
