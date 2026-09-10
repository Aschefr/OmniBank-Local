"""
OmniBank-Local — Service d'orchestration de la synchronisation bancaire.
Intègre l'authentification Woob, le flux 2FA interactif, la prévisualisation
du rapprochement bancaire et l'enregistrement définitif des écritures.
"""

import hashlib
import json
import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.orm import Session
from woob.core import Woob
from woob.exceptions import (
    AppValidation,
    BrowserIncorrectPassword,
    BrowserQuestion,
    DecoupledValidation,
    NeedInteractiveFor2FA,
    OTPQuestion,
    SentOTPQuestion,
)

from app.models import Account, BankConnection, Transaction
from app.schemas.bank_sync_schemas import RemoteAccountOut
from app.services.bank_sync.twofa_manager import (
    _TWOFA_SESSIONS,
    is_2fa_session_cancelled,
)
from app.services.bank_sync.woob_adapter import (
    _clean_str,
    _format_account_type,
    clean_error_message,
)
from app.services.bank_sync.woob_adapter import (
    _apply_module_hotfixes as default_apply_hotfixes,
)
from app.services.bank_sync.woob_adapter import (
    get_woob as default_get_woob,
    get_woob_storage as default_get_woob_storage,
)
from app.services.credential_vault import CredentialVault
from app.services.history_service import record_action, snapshot_entity

logger = logging.getLogger(__name__)


def _get_woob() -> Woob:
    """Accès dynamique supportant le monkeypatching de bss.get_woob dans les tests existants."""
    import app.services.bank_sync_service as bss
    if hasattr(bss, "get_woob") and bss.get_woob is not None:
        return bss.get_woob()
    return default_get_woob()


def _get_woob_storage():
    """Accès dynamique supportant le stockage de sessions et cookies 2FA."""
    import app.services.bank_sync_service as bss
    if hasattr(bss, "get_woob_storage") and bss.get_woob_storage is not None:
        return bss.get_woob_storage()
    return default_get_woob_storage()


def _apply_hotfixes(w: Woob, backend_name: str, backend: Any = None):
    """Accès dynamique supportant le monkeypatching de bss._apply_module_hotfixes."""
    import app.services.bank_sync_service as bss
    if hasattr(bss, "_apply_module_hotfixes") and bss._apply_module_hotfixes is not None:
        return bss._apply_module_hotfixes(w, backend_name, backend=backend)
    return default_apply_hotfixes(w, backend_name, backend=backend)


def _safe_unload_backend(w: Any, instance_name: str):
    """Décharge proprement une instance backend dans Woob et sauvegarde l'état sur disque."""
    instances = getattr(w, "backend_instances", None)
    if isinstance(instances, dict) and instance_name in instances:
        try:
            if hasattr(w, "unload_backends"):
                w.unload_backends([instance_name])
            else:
                instances.pop(instance_name, None)
        except Exception as err:
            logger.debug(f"[BankSync] Erreur lors du déchargement de '{instance_name}': {err}")


class BankSyncService:
    @staticmethod
    def test_connection_and_list_accounts(
        backend_name: str,
        credentials: Dict[str, Any],
        session_id: Optional[str] = None,
        event_callback: Optional[Callable[[str, Dict[str, Any]], None]] = None
    ) -> List[RemoteAccountOut]:
        """
        Teste les identifiants et liste les comptes distants disponibles (courants, livrets, etc.).
        Gère les flux 2FA interactifs si un session_id et event_callback sont fournis.
        """
        w = _get_woob()
        # Assurer l'installation du module si nécessaire
        try:
            w.repositories.install(backend_name)
        except Exception as e:
            logger.debug(f"[BankSync] Module install notice: {e}")

        # Appliquer les correctifs si nécessaire
        _apply_hotfixes(w, backend_name)

        # Nettoyage des credentials : suppression des valeurs vides
        clean_creds = {k: v for k, v in credentials.items() if v is not None and v != ""}
        if session_id:
            clean_creds["request_information"] = {}

        backend_instance_name = f"test_{backend_name}_{session_id or int(time.time())}"
        storage = _get_woob_storage()
        _safe_unload_backend(w, backend_instance_name)
        backend = w.load_backend(
            backend_name,
            backend_instance_name,
            params=clean_creds,
            storage=storage
        )

        # Ré-application du hotfix ciblé sur l'instance backend et ses classes chargées
        _apply_hotfixes(w, backend_name, backend=backend)

        if session_id:
            if "request_information" in backend.config:
                backend.config["request_information"].set({})
            if hasattr(backend, "browser"):
                backend.browser.is_interactive = True

        def _do_fetch_accounts():
            raw_accounts = list(backend.iter_accounts())
            result = []
            for acc in raw_accounts:
                label = _clean_str(getattr(acc, "label", None), "Compte sans nom")
                acc_id = _clean_str(getattr(acc, "id", None), "")
                acc_type = _format_account_type(getattr(acc, "type", 1))

                raw_bal = getattr(acc, "balance", 0.0)
                try:
                    balance = float(raw_bal) if _clean_str(raw_bal) is not None else 0.0
                except (ValueError, TypeError):
                    balance = 0.0

                currency = _clean_str(getattr(acc, "currency", None), "EUR")
                iban = _clean_str(getattr(acc, "iban", None), None)

                result.append(RemoteAccountOut(
                    id=acc_id,
                    label=label,
                    type=acc_type,
                    balance=balance,
                    currency=currency,
                    iban=iban
                ))
            return result

        app_val_attempts = 0
        try:
            while True:
                try:
                    return _do_fetch_accounts()
                except NeedInteractiveFor2FA:
                    if not session_id or not event_callback:
                        raise Exception("Authentification interactive 2FA requise par votre banque.")
                    if "request_information" in backend.config:
                        backend.config["request_information"].set({})
                    if hasattr(backend, "browser"):
                        backend.browser.is_interactive = True
                    continue

                except (AppValidation, DecoupledValidation) as av:
                    if not session_id or not event_callback:
                        raise Exception("Authentification mobile requise sur votre application bancaire (SCA).")
                    app_val_attempts += 1
                    if app_val_attempts > 5:
                        raise Exception("Délai d'attente de validation mobile dépassé.")
                    # Émettre l'événement 2FA vers l'UI
                    event_callback("2fa_required", {
                        "type": "app_validation",
                        "auto_poll": True,
                        "message": str(av) or getattr(av, "message", None) or "Veuillez valider la notification sur votre application mobile bancaire."
                    })
                    if event_callback:
                        event_callback("progress", {"step": "2fa_checking", "message": "En attente de validation sur votre smartphone (détection automatique)..."})
                    # Déclencher immédiatement la reprise/polling Woob sans bloquer l'utilisateur sur le PC
                    if "resume" in backend.config:
                        backend.config["resume"].set(True)
                    if hasattr(backend, "browser") and hasattr(backend.browser, "check_interactive"):
                        backend.browser.check_interactive()
                    if is_2fa_session_cancelled(session_id):
                        raise Exception("Authentification annulée par l'utilisateur.")
                    continue

                except (BrowserQuestion, OTPQuestion, SentOTPQuestion) as bq:
                    if not session_id or not event_callback:
                        raise Exception("Code de sécurité (SMS/Email) requis par votre banque.")
                    msg = getattr(bq, "message", None)
                    if not msg and hasattr(bq, "fields") and bq.fields:
                        msg = getattr(bq.fields[0], "label", None)
                    if not msg:
                        msg = "Veuillez entrer le code de sécurité reçu par SMS ou Email."
                    event_callback("2fa_required", {
                        "type": "otp_code",
                        "message": msg
                    })
                    q = _TWOFA_SESSIONS.get(session_id, {}).get("queue")
                    if not q:
                        raise Exception("Session 2FA expirée.")
                    resp = q.get(timeout=120)
                    if resp.get("response_type") == "cancel":
                        raise Exception("Authentification annulée par l'utilisateur.")
                    otp_val = resp.get("value", "").strip()
                    if not otp_val:
                        raise Exception("Aucun code fourni.")
                    # Injecter le code dans la config du backend
                    field_id = None
                    if hasattr(bq, "fields") and bq.fields:
                        field_id = getattr(bq.fields[0], "id", None)
                    if field_id and field_id in backend.config:
                        backend.config[field_id].set(otp_val)
                    elif "code" in backend.config:
                        backend.config["code"].set(otp_val)
                    elif "otp" in backend.config:
                        backend.config["otp"].set(otp_val)
                    elif "email_code" in backend.config:
                        backend.config["email_code"].set(otp_val)
                    continue

                except BrowserIncorrectPassword:
                    raise Exception("Identifiant ou mot de passe bancaire incorrect.")
                except Exception as e:
                    logger.error(f"[BankSync] Erreur lors de l'appel bancaire {backend_name} : {e}")
                    raise Exception(clean_error_message(e))
        finally:
            _safe_unload_backend(w, backend_instance_name)

    @staticmethod
    def fetch_preview_transactions(
        db: Session,
        connection: BankConnection,
        master_password: str,
        since_days: int = 90,
        event_callback: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Récupère les transactions distantes sans les enregistrer, et calcule les correspondances
        de rapprochement (déjà rapprochées, à rapprocher, à ajouter) pour prévisualisation dans la modale.
        """
        from app.services.reconciliation_engine import check_reconciliation

        if not master_password:
            raise Exception("Coffre-fort verrouillé : veuillez déverrouiller votre coffre pour synchroniser vos comptes.")

        if not CredentialVault.has_credentials(db, connection.id):
            raise Exception("Aucun identifiant configuré pour cette connexion bancaire.")

        creds = CredentialVault.retrieve_credentials(db, connection.id, master_password)
        if not creds:
            raise Exception("Mot de passe maître incorrect : impossible de déchiffrer les identifiants.")

        mapping = {}
        if connection.account_mapping:
            try:
                mapping = json.loads(connection.account_mapping)
            except Exception:
                mapping = {}

        if not mapping:
            raise Exception("Aucun compte OmniBank n'est associé à cette connexion. Veuillez configurer le mapping.")

        w = _get_woob()
        storage = _get_woob_storage()
        backend_name = connection.backend
        backend_instance_name = f"conn_{connection.id}_{backend_name}"

        _apply_hotfixes(w, backend_name)

        clean_creds = {k: v for k, v in creds.items() if v is not None and v != ""}
        if session_id:
            clean_creds["request_information"] = {}

        _safe_unload_backend(w, backend_instance_name)

        backend = w.load_backend(
            backend_name,
            backend_instance_name,
            params=clean_creds,
            storage=storage
        )

        # Ré-application du hotfix ciblé sur l'instance backend et ses classes chargées
        _apply_hotfixes(w, backend_name, backend=backend)

        if session_id:
            if "request_information" in backend.config:
                backend.config["request_information"].set({})
            if hasattr(backend, "browser"):
                backend.browser.is_interactive = True

        if event_callback:
            event_callback("progress", {"step": "auth", "message": "Connexion sécurisée à la banque..."})

        # Gestion 2FA
        app_val_attempts = 0
        def _get_accounts_with_2fa():
            nonlocal app_val_attempts
            while True:
                try:
                    return list(backend.iter_accounts())
                except NeedInteractiveFor2FA:
                    if not session_id or not event_callback:
                        raise Exception("Authentification interactive 2FA requise par votre banque.")
                    if "request_information" in backend.config:
                        backend.config["request_information"].set({})
                    if hasattr(backend, "browser"):
                        backend.browser.is_interactive = True
                    continue
                except (AppValidation, DecoupledValidation) as av:
                    if not session_id or not event_callback:
                        raise Exception("Authentification mobile requise sur votre application bancaire (SCA).")
                    app_val_attempts += 1
                    if app_val_attempts > 5:
                        raise Exception("Délai d'attente de validation mobile dépassé.")
                    event_callback("2fa_required", {
                        "type": "app_validation",
                        "auto_poll": True,
                        "message": str(av) or getattr(av, "message", None) or "Veuillez valider la connexion sur votre application bancaire mobile."
                    })
                    if event_callback:
                        event_callback("progress", {"step": "2fa_checking", "message": "En attente de confirmation sur votre smartphone (détection automatique)..."})
                    if "resume" in backend.config:
                        backend.config["resume"].set(True)
                    if hasattr(backend, "browser") and hasattr(backend.browser, "check_interactive"):
                        backend.browser.check_interactive()
                    if is_2fa_session_cancelled(session_id):
                        raise Exception("Authentification annulée par l'utilisateur.")
                    continue
                except (BrowserQuestion, OTPQuestion, SentOTPQuestion) as bq:
                    if not session_id or not event_callback:
                        raise Exception("Code SMS/Email requis par votre banque.")
                    msg = getattr(bq, "message", None)
                    if not msg and hasattr(bq, "fields") and bq.fields:
                        msg = getattr(bq.fields[0], "label", None)
                    if not msg:
                        msg = "Entrez le code de sécurité reçu."
                    event_callback("2fa_required", {
                        "type": "otp_code",
                        "message": msg
                    })
                    q = _TWOFA_SESSIONS.get(session_id, {}).get("queue")
                    if not q:
                        raise Exception("Session 2FA expirée.")
                    resp = q.get(timeout=120)
                    if resp.get("response_type") == "cancel":
                        raise Exception("Authentification annulée.")
                    otp_val = resp.get("value", "").strip()
                    if not otp_val:
                        raise Exception("Aucun code fourni.")
                    field_id = None
                    if hasattr(bq, "fields") and bq.fields:
                        field_id = getattr(bq.fields[0], "id", None)
                    if field_id and field_id in backend.config:
                        backend.config[field_id].set(otp_val)
                    elif "code" in backend.config:
                        backend.config["code"].set(otp_val)
                    elif "otp" in backend.config:
                        backend.config["otp"].set(otp_val)
                    elif "email_code" in backend.config:
                        backend.config["email_code"].set(otp_val)
                    continue

        try:
            raw_accounts = _get_accounts_with_2fa()
            cutoff_date = date.today() - timedelta(days=since_days)

            matched_ids_global = set()
            accounts_preview = []
            from app.services.finance_engine import calculate_balances
            balances_reconciled = calculate_balances(db, only_reconciled=True)

            for acc in raw_accounts:
                remote_id = _clean_str(getattr(acc, "id", None), "")
                if remote_id not in mapping:
                    continue

                local_account_id = mapping[remote_id]
                local_acc = db.query(Account).filter(Account.id == local_account_id).first()
                if not local_acc:
                    continue

                acc_label = _clean_str(getattr(acc, "label", None), remote_id)

                raw_bal = getattr(acc, "balance", None)
                try:
                    bank_balance = float(raw_bal) if _clean_str(raw_bal) is not None else None
                except (ValueError, TypeError):
                    bank_balance = None

                local_reconciled_bal = round(balances_reconciled.get(local_acc.id, local_acc.initial_balance or 0.0), 2)

                if event_callback:
                    event_callback("progress", {
                        "step": "sync_account",
                        "account": acc_label,
                        "message": f"Récupération des opérations de [{acc_label}]..."
                    })

                history_raw = []
                try:
                    for tx in backend.iter_history(acc):
                        tx_date = getattr(tx, "date", None)
                        if hasattr(tx_date, "date"):
                            tx_date = tx_date.date()
                        elif isinstance(tx_date, datetime):
                            tx_date = tx_date.date()
                        elif isinstance(tx_date, str):
                            try:
                                tx_date = datetime.strptime(tx_date[:10], "%Y-%m-%d").date()
                            except Exception:
                                continue

                        if not tx_date or tx_date < cutoff_date:
                            continue

                        raw_amount = float(getattr(tx, "amount", 0.0) or 0.0)
                        amount = abs(raw_amount)
                        tx_label = (getattr(tx, "label", "") or "Opération bancaire").strip()

                        raw_hash = hashlib.sha256(f"{connection.backend}_{remote_id}_{tx_date}_{raw_amount}_{tx_label}".encode("utf-8")).hexdigest()[:12]
                        csv_id = f"woob_{connection.backend}_{remote_id}_{raw_hash}"

                        history_raw.append({
                            "date_operation": tx_date.isoformat(),
                            "tx_date_obj": tx_date,
                            "description": tx_label,
                            "raw_description": tx_label,
                            "amount": amount,
                            "raw_amount": raw_amount,
                            "csv_id": csv_id,
                            "account_id": local_acc.id,
                            "account_name": local_acc.name,
                            "remote_id": remote_id,
                            "is_coming": False
                        })
                except Exception as hist_err:
                    logger.warning(f"[BankSync] Erreur lecture historique de {acc_label}: {hist_err}")

                coming_raw = []
                # Récupération des opérations à venir (cartes à débit immédiat en attente, prélèvements programmés)
                try:
                    for tx in backend.iter_coming(acc):
                        tx_date = getattr(tx, "date", None)
                        if hasattr(tx_date, "date"):
                            tx_date = tx_date.date()
                        elif isinstance(tx_date, datetime):
                            tx_date = tx_date.date()
                        elif isinstance(tx_date, str):
                            try:
                                tx_date = datetime.strptime(tx_date[:10], "%Y-%m-%d").date()
                            except Exception:
                                tx_date = date.today()

                        if not tx_date:
                            tx_date = date.today()

                        raw_amount = float(getattr(tx, "amount", 0.0) or 0.0)
                        amount = abs(raw_amount)
                        tx_label = (getattr(tx, "label", "") or "Opération à venir").strip()

                        raw_hash = hashlib.sha256(f"{connection.backend}_{remote_id}_{tx_date}_{raw_amount}_{tx_label}".encode("utf-8")).hexdigest()[:12]
                        csv_id = f"woob_coming_{connection.backend}_{remote_id}_{raw_hash}"

                        coming_raw.append({
                            "date_operation": tx_date.isoformat(),
                            "tx_date_obj": tx_date,
                            "description": tx_label,
                            "raw_description": tx_label,
                            "amount": amount,
                            "raw_amount": raw_amount,
                            "csv_id": csv_id,
                            "account_id": local_acc.id,
                            "account_name": local_acc.name,
                            "remote_id": remote_id,
                            "is_coming": True
                        })
                except Exception as coming_err:
                    logger.debug(f"[BankSync] iter_coming non supporté ou ignoré pour {acc_label}: {coming_err}")

                parsed_txs = []

                # Tri chronologique strict (du plus ancien au plus récent) pour ingestion ordonnée
                history_raw.sort(key=lambda x: x.get("tx_date_obj") or date.min)
                coming_raw.sort(key=lambda x: x.get("tx_date_obj") or date.min)

                # ── PASSE 1 : Matching des opérations confirmées (historique) en priorité ──
                for item in history_raw:
                    tx_date = item["tx_date_obj"]
                    raw_amount = item["raw_amount"]
                    rec_info = check_reconciliation(
                        db,
                        tx_date,
                        raw_amount,
                        matched_ids=matched_ids_global,
                        account_id=local_acc.id,
                        is_coming=False,
                        bank_label=item.get("raw_description") or item.get("description"),
                        csv_id=item.get("csv_id")
                    )
                    is_reconciled = False
                    already_reconciled = False
                    is_mirror = False
                    is_orphan_link = False
                    orphan_acc_id = None
                    orphan_acc_name = None
                    matched_id = None
                    db_desc = None
                    match_score = 0

                    if rec_info:
                        is_reconciled = True
                        already_reconciled = rec_info.get("already_reconciled", False)
                        is_mirror = rec_info.get("is_mirror_transfer", False)
                        is_orphan_link = rec_info.get("is_orphan_transfer_link", False)
                        orphan_acc_id = rec_info.get("orphan_account_id")
                        orphan_acc_name = rec_info.get("orphan_account_name")
                        matched_id = rec_info.get("id")
                        db_desc = rec_info.get("description")
                        match_score = rec_info.get("match_score", 0)
                        if matched_id:
                            matched_ids_global.add(matched_id)

                    parsed_txs.append({
                        "date_operation": item["date_operation"],
                        "description": item["description"],
                        "raw_description": item["raw_description"],
                        "amount": item["amount"],
                        "raw_amount": raw_amount,
                        "is_reconciled": is_reconciled,
                        "already_reconciled": already_reconciled,
                        "is_mirror_transfer": is_mirror,
                        "is_orphan_transfer_link": is_orphan_link,
                        "orphan_account_id": orphan_acc_id,
                        "orphan_account_name": orphan_acc_name,
                        "matched_db_id": matched_id,
                        "db_description": db_desc,
                        "match_score": match_score,
                        "category": None,
                        "csv_id": item["csv_id"],
                        "account_id": local_acc.id,
                        "account_name": local_acc.name,
                        "remote_id": remote_id,
                        "is_coming": False
                    })

                # ── PASSE 2 : Matching des opérations à venir (en attente bancaire) ──
                for item in coming_raw:
                    tx_date = item["tx_date_obj"]
                    raw_amount = item["raw_amount"]
                    rec_info = check_reconciliation(
                        db,
                        tx_date,
                        raw_amount,
                        matched_ids=matched_ids_global,
                        account_id=local_acc.id,
                        is_coming=True,
                        bank_label=item.get("raw_description") or item.get("description"),
                        csv_id=item.get("csv_id")
                    )
                    is_reconciled = False
                    already_reconciled = False
                    is_mirror = False
                    is_orphan_link = False
                    orphan_acc_id = None
                    orphan_acc_name = None
                    matched_id = None
                    db_desc = None
                    match_score = 0

                    if rec_info:
                        is_reconciled = True
                        already_reconciled = rec_info.get("already_reconciled", False)
                        is_mirror = rec_info.get("is_mirror_transfer", False)
                        is_orphan_link = rec_info.get("is_orphan_transfer_link", False)
                        orphan_acc_id = rec_info.get("orphan_account_id")
                        orphan_acc_name = rec_info.get("orphan_account_name")
                        matched_id = rec_info.get("id")
                        db_desc = rec_info.get("description")
                        match_score = rec_info.get("match_score", 0)
                        if matched_id:
                            matched_ids_global.add(matched_id)

                    parsed_txs.append({
                        "date_operation": item["date_operation"],
                        "description": item["description"],
                        "raw_description": item["raw_description"],
                        "amount": item["amount"],
                        "raw_amount": raw_amount,
                        "is_reconciled": is_reconciled,
                        "already_reconciled": already_reconciled,
                        "is_mirror_transfer": is_mirror,
                        "is_orphan_transfer_link": is_orphan_link,
                        "orphan_account_id": orphan_acc_id,
                        "orphan_account_name": orphan_acc_name,
                        "matched_db_id": matched_id,
                        "db_description": db_desc,
                        "match_score": match_score,
                        "category": None,
                        "csv_id": item["csv_id"],
                        "account_id": local_acc.id,
                        "account_name": local_acc.name,
                        "remote_id": remote_id,
                        "is_coming": True
                    })

                # Tri chronologique décroissant des opérations (les plus récentes en premier)
                parsed_txs.sort(key=lambda x: str(x.get("date_operation") or ""), reverse=True)

                accounts_preview.append({
                    "remote_id": remote_id,
                    "account_id": local_acc.id,
                    "account_name": local_acc.name,
                    "account_type": local_acc.type,
                    "bank_balance": bank_balance,
                    "local_reconciled_balance": local_reconciled_bal,
                    "transactions": parsed_txs
                })

            # Résolution automatique des libellés et catégories (Smart Label / Règles bancaires / Historique / IA)
            try:
                from app.services.chat.ollama_client import get_ollama_config
                from app.services.smart_label_service import resolve_smart_labels_batch
                cfg = get_ollama_config(db)
                ai_active = bool(cfg and cfg.get("enabled"))

                all_raw_labels = []
                tx_types_map = {}
                for acc in accounts_preview:
                    for tx in acc.get("transactions", []):
                        if not tx.get("is_reconciled"):
                            raw_lbl = tx.get("raw_description") or tx.get("description") or ""
                            if raw_lbl:
                                all_raw_labels.append(raw_lbl)
                                raw_amt = float(tx.get("raw_amount") if tx.get("raw_amount") is not None else (tx.get("amount") or 0.0))
                                tx_types_map[raw_lbl] = "expense_var" if raw_amt < 0 else "income"

                if all_raw_labels:
                    resolutions = resolve_smart_labels_batch(
                        db,
                        all_raw_labels,
                        use_ai_fallback=ai_active,
                        tx_types=tx_types_map,
                        auto_fallback_category=True
                    )
                    for acc in accounts_preview:
                        for tx in acc.get("transactions", []):
                            if not tx.get("is_reconciled"):
                                raw = tx.get("raw_description") or tx.get("description") or ""
                                if raw in resolutions:
                                    res = resolutions[raw]
                                    if res.get("source") in ("rule", "history", "multi_category", "ai", "fallback"):
                                        tx["description"] = res["description"]
                                        if res.get("category"):
                                            tx["category"] = res["category"]
                                        tx["smart_suggested"] = True
                                        tx["smart_source"] = res.get("source")
                                        tx["smart_is_manual"] = res.get("is_manual", False)
                                        tx["smart_is_provisional"] = res.get("is_provisional", False)
                                        tx["smart_is_multi_category"] = res.get("is_multi_category", False)
                                        tx["smart_is_fallback"] = res.get("smart_is_fallback", False)
                                        tx["smart_is_new_category"] = res.get("smart_is_new_category", False)
                                        tx["smart_confidence"] = res.get("confidence", 0.0)
            except Exception as sl_err:
                logger.warning(f"[BankSync] Erreur résolution smart labels: {sl_err}")

            summary = {
                "connection_id": connection.id,
                "connection_label": connection.label,
                "accounts": accounts_preview
            }

            try:
                from app.services.bank_sync_scheduler import save_pending_sync_data
                save_pending_sync_data(db, connection.id, summary)
            except Exception as pend_err:
                logger.warning(f"[BankSync] Erreur enregistrement pending data: {pend_err}")

            if event_callback:
                event_callback("preview_ready", summary)

            return summary
        finally:
            _safe_unload_backend(w, backend_instance_name)

    @staticmethod
    def commit_reviewed_transactions(
        db: Session,
        connection_id: int,
        transactions_data: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Enregistre et rapproche en base la liste d'opérations validée par l'utilisateur.
        """
        conn = db.query(BankConnection).filter(BankConnection.id == connection_id).first()
        imported = 0
        reconciled_count = 0
        created_ids = []

        # Indexer les csv_id existants en base pour éviter tout doublon
        existing_csv_ids = set(
            row[0] for row in db.query(Transaction.csv_id).filter(Transaction.csv_id.isnot(None)).all()
        )

        # Suivi des comptes vierges pour ajustement rétroactif automatique du solde initial
        distinct_account_ids = set(item.get("account_id") for item in transactions_data if item.get("account_id"))
        account_initial_tx_counts = {}
        for acc_id in distinct_account_ids:
            tx_count = db.query(Transaction).filter(
                (Transaction.from_account_id == acc_id) | (Transaction.to_account_id == acc_id)
            ).count()
            account_initial_tx_counts[acc_id] = tx_count

        account_net_flows = {acc_id: 0.0 for acc_id in distinct_account_ids}

        for item in transactions_data:
            account_id = item.get("account_id")
            if not account_id:
                continue

            is_rec = item.get("is_reconciled", False)
            already_rec = item.get("already_rec", False) or item.get("already_reconciled", False)
            matched_id = item.get("matched_db_id")
            is_coming = bool(item.get("is_coming", False))

            # 1. Si déjà rapproché : on ignore (doublon)
            if is_rec and already_rec:
                continue

            is_orphan_link = item.get("is_orphan_transfer_link", False)
            creator_name = "Import Relevé" if (not conn or connection_id == -1) else "Banque (Sync)"

            # 2. Si liaison de virement orphelin (Auto-linking multi-comptes) :
            if is_rec and matched_id and is_orphan_link:
                existing = db.query(Transaction).filter(Transaction.id == matched_id).first()
                if existing:
                    before_snap = snapshot_entity(existing)
                    raw_amt = float(item.get("raw_amount") if item.get("raw_amount") is not None else (item.get("amount") or 0.0))
                    # Si raw_amt < 0, l'opération courante est le débit (from_account = account_id)
                    # et l'écriture existante était le crédit isolé sur l'autre compte
                    if raw_amt < 0:
                        existing.from_account_id = account_id
                    else:
                        # Si raw_amt > 0, l'opération courante est le crédit (to_account = account_id)
                        # et l'écriture existante était le débit isolé sur l'autre compte
                        existing.to_account_id = account_id

                    existing.type = "transfer"
                    if not is_coming:
                        existing.reconciliation_date = date.today()
                        reconciled_count += 1
                    if item.get("category"):
                        existing.category = item["category"]
                    record_action(db, "transaction", existing.id, "UPDATE", before_snap, snapshot_entity(existing), user_name=f"{creator_name} (Liaison Virement)")
                continue

            # 2.B Si prédiction existante en attente de pointage classique :
            if is_rec and matched_id:
                existing = db.query(Transaction).filter(Transaction.id == matched_id).first()
                if existing:
                    before_snap = snapshot_entity(existing)
                    if not is_coming:
                        existing.reconciliation_date = date.today()
                        reconciled_count += 1
                    if item.get("category"):
                        existing.category = item["category"]
                    csv_id = item.get("csv_id")
                    if csv_id:
                        existing.csv_id = csv_id
                        existing_csv_ids.add(csv_id)
                    record_action(db, "transaction", existing.id, "UPDATE", before_snap, snapshot_entity(existing), user_name=creator_name)
                continue

            # 3. Nouvelle transaction à ajouter :
            csv_id = item.get("csv_id")
            if csv_id and csv_id in existing_csv_ids:
                continue

            raw_amt = float(item.get("raw_amount") if item.get("raw_amount") is not None else (item.get("amount") or 0.0))
            amt = abs(float(item.get("amount", 0.0) or raw_amt))

            if raw_amt < 0:
                t_type = "expense_var"
                from_acc = account_id
                to_acc = None
            else:
                t_type = "income"
                from_acc = None
                to_acc = account_id

            op_date_str = item.get("date_operation") or item.get("date")
            try:
                op_date = datetime.strptime(str(op_date_str)[:10], "%Y-%m-%d").date()
            except Exception:
                op_date = date.today()

            is_coming = bool(item.get("is_coming", False))
            recon_date_val = None
            if item.get("reconciliation_date"):
                try:
                    recon_date_val = datetime.strptime(str(item["reconciliation_date"])[:10], "%Y-%m-%d").date()
                except Exception:
                    recon_date_val = None
            elif not is_coming:
                recon_date_val = date.today()

            if item.get("category"):
                from app.services.smart_label_service import ensure_category_exists
                ensure_category_exists(db, item["category"], t_type)

            new_tx = Transaction(
                csv_id=csv_id,
                date_saisie=date.today(),
                date_operation=op_date,
                description=item.get("description", "Opération bancaire"),
                amount=amt,
                type=t_type,
                category=item.get("category"),
                reconciliation_date=recon_date_val,
                from_account_id=from_acc,
                to_account_id=to_acc,
                attachments=item.get("attachments"),
                check_slip_number=item.get("check_slip_number"),
                created_by=creator_name
            )
            db.add(new_tx)
            db.flush()
            created_ids.append(new_tx.id)
            if csv_id:
                existing_csv_ids.add(csv_id)

            record_action(db, "transaction", new_tx.id, "CREATE", None, snapshot_entity(new_tx), user_name=creator_name)
            imported += 1
            if not is_coming and recon_date_val is not None:
                account_net_flows[account_id] += raw_amt

            # Auto-apprentissage transparent dans la base de connaissances Smart Label
            raw_lbl = item.get("raw_description") or item.get("raw_label") or item.get("description")
            clean_lbl = item.get("description")
            if raw_lbl and clean_lbl:
                try:
                    from app.services.smart_label_service import learn_label_mapping
                    learn_label_mapping(db, raw_label=raw_lbl, clean_description=clean_lbl, category=item.get("category"), is_manual=False)
                except Exception as ex_learn:
                    logger.debug(f"[BankSync] Ignoré échec apprentissage smart label: {ex_learn}")

        # Rétro-calcul automatique du solde initial pour les comptes nouvellement alimentés :
        # Pour que Solde Initial + Somme(opérations_importées) == Solde Réel de la banque au départ.
        for acc_id, initial_tx_count in account_initial_tx_counts.items():
            if initial_tx_count == 0 and account_net_flows[acc_id] != 0.0:
                acc = db.query(Account).filter(Account.id == acc_id).first()
                if acc:
                    # Trouver le solde bancaire distant associé à ce compte s'il existe dans le preview
                    matching_preview_acc = None
                    for prev_acc in summary.get("accounts", []) if 'summary' in locals() else []:
                        if prev_acc.get("account_id") == acc_id and prev_acc.get("bank_balance") is not None:
                            matching_preview_acc = prev_acc
                            break

                    if matching_preview_acc and matching_preview_acc.get("bank_balance") is not None:
                        bank_bal = float(matching_preview_acc["bank_balance"])
                        computed_init_bal = round(bank_bal - account_net_flows[acc_id], 2)
                        acc.initial_balance = computed_init_bal
                        logger.info(f"[BankSync] Ajustement rétroactif automatique du solde initial pour le compte '{acc.name}' (id={acc.id}) : {computed_init_bal} €")

        if conn:
            conn.last_sync_at = datetime.now(timezone.utc)
            conn.last_sync_status = "success"
            conn.last_sync_count = imported + reconciled_count
            conn.last_error = None
            from app.models import Notification
            db.query(Notification).filter(
                Notification.type == "bank_sync_error",
                Notification.link_data.like(f'%"conn_id": {conn.id}%')
            ).update({"is_read": True, "is_archived": True}, synchronize_session=False)

        db.commit()

        # Invalider le cache et recalculer
        try:
            from app.services.finance_engine import invalidate_cache
            invalidate_cache()
        except Exception:
            pass

        return {
            "imported": imported,
            "reconciled": reconciled_count,
            "total": imported + reconciled_count,
            "created_ids": created_ids
        }

    @staticmethod
    def sync_connection(
        db: Session,
        connection: BankConnection,
        master_password: str,
        since_days: int = 90,
        event_callback: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Exécute la synchronisation en mode streaming : extrait les données et les prépare pour la vue.
        """
        preview = BankSyncService.fetch_preview_transactions(
            db=db,
            connection=connection,
            master_password=master_password,
            since_days=since_days,
            event_callback=event_callback,
            session_id=session_id
        )

        # Détection des exclusions persistantes et auto-exclusion sur solde conforme
        from app.services.bank_sync_scheduler import get_dismissed_transactions
        dismissed_tx_map = get_dismissed_transactions(db)

        for acc in preview.get("accounts", []):
            bank_balance = acc.get("bank_balance")
            local_reconciled_bal = acc.get("local_reconciled_balance")
            is_balance_conformed = False
            if bank_balance is not None and local_reconciled_bal is not None:
                is_balance_conformed = abs(bank_balance - local_reconciled_bal) < 0.005

            for tx_item in acc.get("transactions", []):
                csv_id = tx_item.get("csv_id")
                is_dismissed = bool(csv_id and csv_id in dismissed_tx_map)
                tx_item["is_dismissed"] = is_dismissed
                tx_item["is_auto_dismissed"] = False

                if is_dismissed:
                    tx_item["_excluded"] = True
                elif is_balance_conformed and not tx_item.get("is_reconciled") and not tx_item.get("is_coming"):
                    tx_date_str = tx_item.get("date_operation")
                    if tx_date_str:
                        try:
                            tx_dt = date.fromisoformat(str(tx_date_str)[:10])
                            if tx_dt < date.today() - timedelta(days=15):
                                tx_item["is_auto_dismissed"] = True
                                tx_item["_excluded"] = True
                        except Exception:
                            pass
        return preview
