"""
OmniBank-Local — Service de Synchronisation Bancaire Universelle (Woob).
Gère la découverte dynamique des banques, l'authentification sécurisée,
le 2FA interactif, le mapping de comptes et la déduplication des écritures.
"""

import hashlib
import json
import logging
import queue
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, Generator, List, Optional, Tuple

from sqlalchemy.orm import Session
from woob.core import Woob
from woob.exceptions import (
    ActionNeeded,
    AppValidation,
    AppValidationCancelled,
    AppValidationExpired,
    BrowserIncorrectPassword,
    BrowserQuestion,
    BrowserUnavailable,
    NeedInteractiveFor2FA,
    OTPQuestion,
    SentOTPQuestion,
)

from app.models import Account, BankConnection, Transaction
from app.schemas.bank_sync_schemas import (
    BackendConfigField,
    BankBackendInfo,
    RemoteAccountOut,
)
from app.services import stats_cache
from app.services.credential_vault import CredentialVault
from app.services.history_service import record_action, snapshot_entity

logger = logging.getLogger(__name__)

# Cache mémoire pour les sessions 2FA interactives
# session_id -> {"queue": Queue, "event": threading.Event, "response": None}
_TWOFA_SESSIONS: Dict[str, Dict[str, Any]] = {}
_TWOFA_LOCK = threading.Lock()

# Cache singleton pour l'instance Woob
_WOOB_INSTANCE: Optional[Woob] = None
_BACKENDS_CACHE: Optional[List[BankBackendInfo]] = None
_CACHE_TIMESTAMP: float = 0


def get_woob() -> Woob:
    """Retourne une instance Woob réutilisable."""
    global _WOOB_INSTANCE
    if _WOOB_INSTANCE is None:
        _WOOB_INSTANCE = Woob()
    return _WOOB_INSTANCE


def _apply_module_hotfixes(w: Woob, backend_name: str):
    """Applique les correctifs de compatibilité connus sur les modules Woob si nécessaire."""
    if backend_name == "boursorama":
        try:
            import pathlib
            mod = w.modules_loader.get_or_load_module("boursorama")
            if hasattr(mod, "package") and hasattr(mod.package, "__file__"):
                pkg_dir = pathlib.Path(mod.package.__file__).parent
                pages_file = pkg_dir / "pages.py"
                if pages_file.exists():
                    content = pages_file.read_text(encoding="utf-8")
                    target_old = 'return HasElement("//title")(self.doc)'
                    target_new = 'return HasElement(\'//form[@name="form"]\')(self.doc)'
                    if target_old in content:
                        content = content.replace(target_old, target_new)
                        pages_file.write_text(content, encoding="utf-8")
                        logger.info("[BankSync] Hotfix BoursoBank appliqué avec succès.")
        except Exception as e:
            logger.debug(f"[BankSync] Hotfix BoursoBank notice: {e}")


def get_all_bank_backends(force_refresh: bool = False) -> List[BankBackendInfo]:
    """
    Découverte dynamique de tous les modules bancaires disponibles dans Woob.
    Retourne la liste des banques avec la description et les champs de configuration attendus.
    """
    global _BACKENDS_CACHE, _CACHE_TIMESTAMP
    now = time.time()
    if _BACKENDS_CACHE is not None and not force_refresh and (now - _CACHE_TIMESTAMP < 3600):
        return _BACKENDS_CACHE

    w = get_woob()
    try:
        mods_info = w.repositories.get_all_modules_info()
    except Exception as e:
        logger.warning(f"[BankSync] Erreur lors de la récupération des modules distants : {e}")
        mods_info = {}

    backends = []
    # Priorité d'affichage pour les banques courantes
    priority_order = [
        "cragr", "boursorama", "bnp", "societegenerale", "bp", "lcl",
        "caissedepargne", "banquepopulaire", "creditmutuel", "cic",
        "fortuneo", "hellobank", "bforbank", "n26", "monabanq", "revolut"
    ]

    for name, info in mods_info.items():
        caps = getattr(info, "capabilities", []) or []
        cap_names = [c if isinstance(c, str) else getattr(c, "__name__", str(c)) for c in caps]
        if not any("Bank" in c or "CapBank" in c for c in cap_names):
            continue

        desc = getattr(info, "description", name) or name
        is_installed = name in w.modules_loader.loaded

        # Inspecter les champs requis si le module est déjà chargé
        fields = _inspect_module_fields(w, name)

        backends.append(BankBackendInfo(
            name=name,
            description=desc,
            is_installed=is_installed,
            fields=fields
        ))

    # Tri : banques prioritaires d'abord, puis ordre alphabétique
    def sort_key(b: BankBackendInfo):
        if b.name in priority_order:
            return (0, priority_order.index(b.name))
        return (1, b.description.lower())

    backends.sort(key=sort_key)
    _BACKENDS_CACHE = backends
    _CACHE_TIMESTAMP = now
    logger.info(f"[BankSync] {len(backends)} backends bancaires découverts.")
    return backends


CRAGR_CAISSES_CHOICES = {
    "www.ca-alpesprovence.fr": "Alpes Provence (www.ca-alpesprovence.fr)",
    "www.ca-alsace-vosges.fr": "Alsace-Vosges (www.ca-alsace-vosges.fr)",
    "www.ca-anjou-maine.fr": "Anjou Maine (www.ca-anjou-maine.fr)",
    "www.ca-aquitaine.fr": "Aquitaine (www.ca-aquitaine.fr)",
    "www.ca-atlantique-vendee.fr": "Atlantique Vendée (www.ca-atlantique-vendee.fr)",
    "www.ca-briepicardie.fr": "Brie Picardie (www.ca-briepicardie.fr)",
    "www.ca-cb.fr": "Champagne Bourgogne (www.ca-cb.fr)",
    "www.ca-centrefrance.fr": "Centre France (www.ca-centrefrance.fr)",
    "www.ca-centreloire.fr": "Centre Loire (www.ca-centreloire.fr)",
    "www.ca-centreouest.fr": "Centre Ouest (www.ca-centreouest.fr)",
    "www.ca-centrest.fr": "Centre Est (www.ca-centrest.fr)",
    "www.ca-charente-perigord.fr": "Charente Périgord (www.ca-charente-perigord.fr)",
    "www.ca-cmds.fr": "Charente-Maritime Deux-Sèvres (www.ca-cmds.fr)",
    "www.ca-corse.fr": "Corse (www.ca-corse.fr)",
    "www.ca-cotesdarmor.fr": "Côtes d'Armor (www.ca-cotesdarmor.fr)",
    "www.ca-des-savoie.fr": "Des Savoie (www.ca-des-savoie.fr)",
    "www.ca-finistere.fr": "Finistère (www.ca-finistere.fr)",
    "www.ca-franchecomte.fr": "Franche-Comté (www.ca-franchecomte.fr)",
    "www.ca-guadeloupe.fr": "Guadeloupe (www.ca-guadeloupe.fr)",
    "www.ca-illeetvilaine.fr": "Ille-et-Vilaine (www.ca-illeetvilaine.fr)",
    "www.ca-languedoc.fr": "Languedoc (www.ca-languedoc.fr)",
    "www.ca-loirehauteloire.fr": "Loire Haute Loire (www.ca-loirehauteloire.fr)",
    "www.ca-lorraine.fr": "Lorraine (www.ca-lorraine.fr)",
    "www.ca-martinique.fr": "Martinique Guyane (www.ca-martinique.fr)",
    "www.ca-morbihan.fr": "Morbihan (www.ca-morbihan.fr)",
    "www.ca-nmp.fr": "Nord Midi-Pyrénées (www.ca-nmp.fr)",
    "www.ca-nord-est.fr": "Nord Est (www.ca-nord-est.fr)",
    "www.ca-norddefrance.fr": "Nord de France (www.ca-norddefrance.fr)",
    "www.ca-normandie-seine.fr": "Normandie Seine (www.ca-normandie-seine.fr)",
    "www.ca-normandie.fr": "Normandie (www.ca-normandie.fr)",
    "www.ca-paris.fr": "Ile-de-France (www.ca-paris.fr)",
    "www.ca-pca.fr": "Provence Côte d'Azur (www.ca-pca.fr)",
    "www.ca-pyrenees-gascogne.fr": "Pyrénées Gascogne (www.ca-pyrenees-gascogne.fr)",
    "www.ca-reunion.fr": "Réunion (www.ca-reunion.fr)",
    "www.ca-sudmed.fr": "Sud Méditerranée (www.ca-sudmed.fr)",
    "www.ca-sudrhonealpes.fr": "Sud Rhône Alpes (www.ca-sudrhonealpes.fr)",
    "www.ca-toulouse31.fr": "Toulouse 31 (www.ca-toulouse31.fr)",
    "www.ca-tourainepoitou.fr": "Touraine Poitou (www.ca-tourainepoitou.fr)",
    "www.ca-valdefrance.fr": "Val de France (www.ca-valdefrance.fr)"
}


def _inspect_module_fields(w: Woob, module_name: str) -> List[BackendConfigField]:
    """Inspecte la configuration d'un module pour générer les champs du formulaire UI."""
    fields = []
    try:
        mod = w.modules_loader.get_or_load_module(module_name)
        config = getattr(mod, "config", {})
        for key, val_obj in config.items():
            if key in ["resume", "request_information", "code", "email_code", "otp", "digital_key", "rotating_password"]:
                # Champs transient/2FA, non demandés au formulaire initial
                continue

            val_type = type(val_obj).__name__.lower()
            field_type = "text"
            if "password" in val_type or "password" in key.lower() or "secret" in key.lower() or "pin" in key.lower():
                field_type = "password"
            elif "bool" in val_type:
                field_type = "checkbox"

            choices_dict = None
            if hasattr(val_obj, "choices") and val_obj.choices:
                field_type = "select"
                choices_dict = {str(k): str(v) for k, v in val_obj.choices.items()}
            elif module_name == "cragr" and key == "website":
                field_type = "select"
                choices_dict = CRAGR_CAISSES_CHOICES

            label = getattr(val_obj, "label", key) or key
            description = getattr(val_obj, "description", None)
            required = getattr(val_obj, "required", True)
            default = str(getattr(val_obj, "default", "")) if getattr(val_obj, "default", None) is not None else ("www.ca-centrest.fr" if module_name == "cragr" and key == "website" else None)

            fields.append(BackendConfigField(
                id=key,
                label=label,
                type=field_type,
                description=description,
                required=required,
                choices=choices_dict,
                default=default
            ))
    except Exception:
        # Fallback générique si le module n'est pas encore installé
        fields = [
            BackendConfigField(id="login", label="Identifiant client", type="text", required=True),
            BackendConfigField(id="password", label="Mot de passe / Code secret", type="password", required=True),
        ]
        if module_name == "cragr":
            fields.append(BackendConfigField(
                id="website",
                label="Caisse régionale",
                type="select",
                choices=CRAGR_CAISSES_CHOICES,
                default="www.ca-centrest.fr",
                required=True
            ))

    return fields


def register_2fa_session(session_id: str) -> queue.Queue:
    """Enregistre une session 2FA pour attendre une réponse du frontend."""
    q: queue.Queue = queue.Queue()
    with _TWOFA_LOCK:
        _TWOFA_SESSIONS[session_id] = {
            "queue": q,
            "created_at": time.time()
        }
    return q


def deliver_2fa_response(session_id: str, response_data: Dict[str, Any]) -> bool:
    """Distribue la réponse 2FA (code OTP ou validation smartphone) à la tâche en attente."""
    with _TWOFA_LOCK:
        session = _TWOFA_SESSIONS.get(session_id)
        if session:
            session["queue"].put(response_data)
            return True
    return False


def unregister_2fa_session(session_id: str):
    """Nettoie la session 2FA."""
    with _TWOFA_LOCK:
        _TWOFA_SESSIONS.pop(session_id, None)


ACCOUNT_TYPE_LABELS = {
    1: "Compte courant",
    2: "Livret / Épargne",
    3: "Dépôt",
    4: "Prêt / Emprunt",
    5: "Compte Titres",
    6: "Compte Joint",
    7: "Carte",
    8: "Assurance-Vie",
    9: "Épargne Salariale (PEE)",
    10: "PERCO",
    13: "PEA",
    17: "Prêt Immobilier",
    18: "Crédit Consommation",
    23: "LDDS",
    24: "PEL",
    25: "CSL",
    26: "CEL",
    28: "Livret A",
    29: "Livret B",
}


def _clean_str(val, default=None) -> Optional[str]:
    """Nettoie les valeurs spéciales Woob (NotLoaded, NotAvailable) vers str propre ou None."""
    if val is None:
        return default
    s = str(val).strip()
    if not s or s in ("NotLoaded", "NotAvailable", "<NotLoaded>"):
        return default
    return s


def _format_account_type(acc_type) -> str:
    """Traduit les codes types Woob en libellés français clairs."""
    if isinstance(acc_type, int) and acc_type in ACCOUNT_TYPE_LABELS:
        return ACCOUNT_TYPE_LABELS[acc_type]
    s = _clean_str(acc_type, "Compte")
    if s.isdigit() and int(s) in ACCOUNT_TYPE_LABELS:
        return ACCOUNT_TYPE_LABELS[int(s)]
    return s


def clean_error_message(e: Exception) -> str:
    """Fournit un message d'erreur clair et lisible pour l'UI, évitant les chaînes vides ou obscures."""
    msg = str(e).strip()
    if not msg or msg in ("{}", "''", '""'):
        exc_name = type(e).__name__
        if exc_name in ("NeedInteractiveFor2FA", "AppValidation"):
            return "Authentification mobile ou validation 2FA requise par votre banque."
        elif exc_name == "BrowserIncorrectPassword":
            return "Identifiant ou mot de passe bancaire incorrect."
        elif exc_name in ("BrowserUnavailable", "ActionNeeded"):
            return "Action requise sur le site ou l'application mobile de votre banque."
        return f"Erreur de communication avec la banque ({exc_name})."
    return msg


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
        w = get_woob()
        # Assurer l'installation du module si nécessaire
        try:
            w.repositories.install(backend_name)
        except Exception as e:
            logger.debug(f"[BankSync] Module install notice: {e}")

        # Appliquer les correctifs si nécessaire
        _apply_module_hotfixes(w, backend_name)

        # Nettoyage des credentials : suppression des valeurs vides
        clean_creds = {k: v for k, v in credentials.items() if v is not None and v != ""}

        backend_instance_name = f"test_{backend_name}_{int(time.time())}"
        backend = w.load_backend(
            backend_name,
            backend_instance_name,
            params=clean_creds,
            storage=None
        )

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

        try:
            return _do_fetch_accounts()
        except AppValidation as av:
            if not session_id or not event_callback:
                raise Exception(f"Authentification mobile requise sur votre application bancaire (SCA).")
            # Émettre l'événement 2FA vers l'UI
            event_callback("2fa_required", {
                "type": "app_validation",
                "message": str(av) or "Veuillez valider la connexion sur votre application bancaire mobile."
            })
            # Attendre la confirmation utilisateur
            q = _TWOFA_SESSIONS.get(session_id, {}).get("queue")
            if not q:
                raise Exception("Session 2FA expirée ou introuvable.")
            resp = q.get(timeout=120)
            if resp.get("response_type") == "cancel":
                raise Exception("Authentification annulée par l'utilisateur.")
            if hasattr(backend, "browser") and hasattr(backend.browser, "check_interactive"):
                backend.browser.check_interactive()
            return _do_fetch_accounts()

        except (BrowserQuestion, OTPQuestion, SentOTPQuestion, NeedInteractiveFor2FA) as bq:
            if not session_id or not event_callback:
                raise Exception("Code de sécurité (SMS/Email) requis par votre banque.")
            msg = getattr(bq, "message", None) or "Veuillez entrer le code de sécurité reçu par SMS ou Email."
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
            if "code" in backend.config:
                backend.config["code"].set(otp_val)
            elif "otp" in backend.config:
                backend.config["otp"].set(otp_val)
            return _do_fetch_accounts()

        except BrowserIncorrectPassword:
            raise Exception("Identifiant ou mot de passe bancaire incorrect.")
        except Exception as e:
            logger.error(f"[BankSync] Erreur lors de l'appel bancaire {backend_name} : {e}")
            raise Exception(clean_error_message(e))

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
        from app.routers.csv_parser import check_reconciliation

        creds = CredentialVault.retrieve_credentials(db, connection.id, master_password)
        if not creds:
            raise Exception("Mot de passe maître incorrect ou identifiants introuvables.")

        mapping = {}
        if connection.account_mapping:
            try:
                mapping = json.loads(connection.account_mapping)
            except Exception:
                mapping = {}

        if not mapping:
            raise Exception("Aucun compte OmniBank n'est associé à cette connexion. Veuillez configurer le mapping.")

        w = get_woob()
        backend_name = connection.backend
        backend_instance_name = f"preview_{backend_name}_{connection.id}_{int(time.time())}"

        _apply_module_hotfixes(w, backend_name)

        clean_creds = {k: v for k, v in creds.items() if v is not None and v != ""}
        backend = w.load_backend(
            backend_name,
            backend_instance_name,
            params=clean_creds,
            storage=None
        )

        if event_callback:
            event_callback("progress", {"step": "auth", "message": "Connexion sécurisée à la banque..."})

        # Gestion 2FA
        def _get_accounts_with_2fa():
            try:
                return list(backend.iter_accounts())
            except AppValidation as av:
                if not session_id or not event_callback:
                    raise Exception(f"Authentification mobile requise : {av}")
                event_callback("2fa_required", {
                    "type": "app_validation",
                    "message": str(av) or "Veuillez valider la connexion sur votre application bancaire."
                })
                q = _TWOFA_SESSIONS.get(session_id, {}).get("queue")
                if not q:
                    raise Exception("Session 2FA expirée.")
                resp = q.get(timeout=120)
                if resp.get("response_type") == "cancel":
                    raise Exception("Authentification annulée.")
                if hasattr(backend, "browser") and hasattr(backend.browser, "check_interactive"):
                    backend.browser.check_interactive()
                return list(backend.iter_accounts())
            except (BrowserQuestion, OTPQuestion, SentOTPQuestion, NeedInteractiveFor2FA) as bq:
                if not session_id or not event_callback:
                    raise Exception(f"Code SMS/Email requis.")
                msg = getattr(bq, "message", "Entrez le code de sécurité reçu.")
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
                if "code" in backend.config:
                    backend.config["code"].set(otp_val)
                elif "otp" in backend.config:
                    backend.config["otp"].set(otp_val)
                return list(backend.iter_accounts())

        raw_accounts = _get_accounts_with_2fa()
        cutoff_date = date.today() - timedelta(days=since_days)

        matched_ids_global = set()
        accounts_preview = []

        for acc in raw_accounts:
            remote_id = _clean_str(getattr(acc, "id", None), "")
            if remote_id not in mapping:
                continue

            local_account_id = mapping[remote_id]
            local_acc = db.query(Account).filter(Account.id == local_account_id).first()
            if not local_acc:
                continue

            acc_label = _clean_str(getattr(acc, "label", None), remote_id)
            if event_callback:
                event_callback("progress", {
                    "step": "sync_account",
                    "account": acc_label,
                    "message": f"Récupération des opérations de [{acc_label}]..."
                })

            parsed_txs = []
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

                    # Matching de rapprochement contextualisé au compte et aux virements internes
                    rec_info = check_reconciliation(db, tx_date, raw_amount, matched_ids=matched_ids_global, account_id=local_acc.id)
                    is_reconciled = False
                    already_reconciled = False
                    is_mirror = False
                    matched_id = None
                    db_desc = None

                    if rec_info:
                        is_reconciled = True
                        already_reconciled = rec_info.get("already_reconciled", False)
                        is_mirror = rec_info.get("is_mirror_transfer", False)
                        matched_id = rec_info.get("id")
                        db_desc = rec_info.get("description")
                        if matched_id:
                            matched_ids_global.add(matched_id)

                    raw_hash = hashlib.sha256(f"{connection.backend}_{remote_id}_{tx_date}_{raw_amount}_{tx_label}".encode("utf-8")).hexdigest()[:12]
                    csv_id = f"woob_{connection.backend}_{remote_id}_{raw_hash}"

                    parsed_txs.append({
                        "date_operation": tx_date.isoformat(),
                        "description": tx_label,
                        "raw_description": tx_label,
                        "amount": amount,
                        "raw_amount": raw_amount,
                        "is_reconciled": is_reconciled,
                        "already_reconciled": already_reconciled,
                        "is_mirror_transfer": is_mirror,
                        "matched_db_id": matched_id,
                        "db_description": db_desc,
                        "category": None,
                        "csv_id": csv_id,
                        "account_id": local_acc.id,
                        "account_name": local_acc.name,
                        "remote_id": remote_id
                    })
            except Exception as hist_err:
                logger.warning(f"[BankSync] Erreur lecture historique de {acc_label}: {hist_err}")

            accounts_preview.append({
                "remote_id": remote_id,
                "account_id": local_acc.id,
                "account_name": local_acc.name,
                "account_type": local_acc.type,
                "transactions": parsed_txs
            })

        # Résolution automatique des libellés et catégories (Smart Label / Règles bancaires / Historique)
        try:
            from app.services.smart_label_service import resolve_smart_labels_batch
            all_raw_labels = []
            for acc in accounts_preview:
                for tx in acc.get("transactions", []):
                    if not tx.get("is_reconciled"):
                        all_raw_labels.append(tx.get("raw_description") or tx.get("description") or "")

            if all_raw_labels:
                resolutions = resolve_smart_labels_batch(db, all_raw_labels)
                for acc in accounts_preview:
                    for tx in acc.get("transactions", []):
                        if not tx.get("is_reconciled"):
                            raw = tx.get("raw_description") or tx.get("description") or ""
                            if raw in resolutions:
                                res = resolutions[raw]
                                if res.get("source") in ("rule", "history"):
                                    tx["description"] = res["description"]
                                    if res.get("category"):
                                        tx["category"] = res["category"]
                                    tx["smart_suggested"] = True
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

            # 1. Si déjà rapproché : on ignore (doublon)
            if is_rec and already_rec:
                continue

            # 2. Si prédiction existante en attente de pointage :
            if is_rec and matched_id:
                existing = db.query(Transaction).filter(Transaction.id == matched_id).first()
                if existing:
                    before_snap = snapshot_entity(existing)
                    existing.reconciliation_date = date.today()
                    if item.get("category"):
                        existing.category = item["category"]
                    record_action(db, "transaction", existing.id, "UPDATE", before_snap, snapshot_entity(existing), user_name="Banque (Sync)")
                    reconciled_count += 1
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

            new_tx = Transaction(
                csv_id=csv_id,
                date_saisie=date.today(),
                date_operation=op_date,
                description=item.get("description", "Opération bancaire"),
                amount=amt,
                type=t_type,
                category=item.get("category"),
                reconciliation_date=date.today(),
                from_account_id=from_acc,
                to_account_id=to_acc,
                created_by="Banque (Sync)"
            )
            db.add(new_tx)
            db.flush()
            if csv_id:
                existing_csv_ids.add(csv_id)

            record_action(db, "transaction", new_tx.id, "CREATE", None, snapshot_entity(new_tx), user_name="Banque (Sync)")
            imported += 1
            account_net_flows[account_id] += raw_amt

            # Auto-apprentissage transparent dans la base de connaissances Smart Label
            raw_lbl = item.get("raw_description") or item.get("raw_label") or item.get("description")
            clean_lbl = item.get("description")
            if raw_lbl and clean_lbl:
                try:
                    from app.services.smart_label_service import learn_label_mapping
                    learn_label_mapping(db, raw_label=raw_lbl, clean_description=clean_lbl, category=item.get("category"))
                except Exception as ex_learn:
                    logger.debug(f"[BankSync] Ignoré échec apprentissage smart label: {ex_learn}")

        # Rétro-calcul automatique du solde initial pour les comptes nouvellement alimentés :
        # Pour que Solde Initial + Somme(opérations_importées) == Solde Réel de la banque au départ.
        for acc_id, initial_tx_count in account_initial_tx_counts.items():
            if initial_tx_count == 0 and account_net_flows.get(acc_id, 0.0) != 0.0:
                acc = db.query(Account).filter(Account.id == acc_id).first()
                if acc and acc.initial_balance is not None:
                    original_init = acc.initial_balance
                    acc.initial_balance = round(acc.initial_balance - account_net_flows[acc_id], 2)
                    logger.info(
                        f"[BankSync] Rétro-calcul solde initial pour compte #{acc.id} '{acc.name}' : "
                        f"{original_init:.2f} -> {acc.initial_balance:.2f} (flux net importé : {account_net_flows[acc_id]:+.2f} €)"
                    )

        if conn:
            conn.last_sync_at = datetime.now(timezone.utc)
            conn.last_sync_status = "success"
            conn.last_sync_count = imported + reconciled_count
            conn.last_error = None

        db.commit()
        stats_cache.invalidate()

        return {
            "imported": imported,
            "reconciled": reconciled_count,
            "total": imported + reconciled_count
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
        return preview
