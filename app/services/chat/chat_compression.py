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

def generate_session_title(db_session_factory, session_id: int, user_message: str, cfg: dict):
    """Generate a session title in a background task using its own DB session.
    Uses a dedicated DB session to avoid conflicts with the streaming response,
    and retries once after a delay if Ollama is busy."""
    import time
    prompt = f"""Conversation first message: "{user_message}"

=== INSTRUCTIONS ===
Generate a concise 3-5 word title for this conversation based on the user's first message. 
Output ONLY the title, no quotation marks, no commentary, no intro, nothing else.
Write the title in the same language as the message.

NOW GENERATE THE TITLE:"""

    max_attempts = 2
    for attempt in range(1, max_attempts + 1):
        db = None
        try:
            # Wait for the main Ollama response to likely finish before requesting title
            if attempt == 1:
                time.sleep(3)
            else:
                time.sleep(10)

            title = call_ollama_sync(prompt, cfg)
            if title:
                clean_title = title.strip().strip('"').strip("'").split("\n")[0].strip()
                if clean_title:
                    db = db_session_factory()
                    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
                    if session:
                        session.title = clean_title
                        db.commit()
                        print(f"[Chat] Auto-title for session {session_id}: {clean_title}")
                    return  # Success
        except Exception as e:
            print(f"[Chat] Title generation attempt {attempt}/{max_attempts} failed for session {session_id}: {e}")
        finally:
            if db is not None:
                try:
                    db.close()
                except Exception:
                    pass

    print(f"[Chat] All title generation attempts failed for session {session_id}")
